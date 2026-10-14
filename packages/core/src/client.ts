import { ProviderError } from './errors';
import { createSSEParser } from './sse';
import type { ChatMessage, ProviderConfig } from './types';

export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

export interface StreamOptions {
  /** 等待响应头的时间，超时视为连接失败 */
  connectTimeoutMs?: number;
  /** 开始返回后，两次收到数据（包括服务端的心跳注释）之间允许的最长间隔 */
  idleTimeoutMs?: number;
}

/** 到点就中止请求的计时器，可以反复重置 */
class Watchdog {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly signal = this.controller.signal;

  arm(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.controller.abort(), ms);
  }

  stop() {
    clearTimeout(this.timer);
  }

  get fired() {
    return this.controller.signal.aborted;
  }
}

const seconds = (ms: number) => Math.round(ms / 1000);

/**
 * 调用 OpenAI 兼容的流式 chat completions 接口，逐段产出增量文本。
 * 连接失败或超时会自动重试一次（此时还没有任何输出，重试不会重复内容）；
 * 返回途中卡住超过 idleTimeoutMs 就中止，免得一个卡住的请求堵住后面的翻译。
 */
export async function* streamChatCompletion(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  { connectTimeoutMs = 15_000, idleTimeoutMs = 30_000 }: StreamOptions = {},
): AsyncGenerator<string> {
  if (!config.baseUrl.trim()) throw new ProviderError('未配置 API 地址');
  if (!config.model.trim()) throw new ProviderError('未配置模型');

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...config.headers };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const body = JSON.stringify({ ...config.extraBody, model: config.model, messages, stream: true });

  let res!: Response;
  let watchdog!: Watchdog;
  for (let attempt = 1; ; attempt++) {
    watchdog = new Watchdog();
    watchdog.arm(connectTimeoutMs);
    try {
      res = await fetch(chatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers,
        body,
        signal: signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal,
      });
      break;
    } catch (err) {
      watchdog.stop();
      if (signal?.aborted) throw err;
      if (attempt < 2) continue;
      throw new ProviderError(
        watchdog.fired ? `连接超时：${seconds(connectTimeoutMs)} 秒没有响应` : `网络请求失败：${(err as Error).message}`,
      );
    }
  }

  try {
    watchdog.arm(idleTimeoutMs);
    if (!res.ok) throw new ProviderError(await describeHttpError(res), res.status);
    if (!res.body) throw new ProviderError('服务没有返回内容');

    const events: string[] = [];
    const parser = createSSEParser((data) => events.push(data));
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<string>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (watchdog.fired && !signal?.aborted) throw new ProviderError(`请求超时：${seconds(idleTimeoutMs)} 秒没有收到数据`);
          throw err;
        }
        watchdog.arm(idleTimeoutMs);
        if (chunk.done) parser.end();
        else parser.feed(chunk.value);

        for (const data of events.splice(0)) {
          if (data === '[DONE]') return;
          const delta = parseDelta(data);
          if (delta) yield delta;
        }
        if (chunk.done) return;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  } finally {
    watchdog.stop();
  }
}

function parseDelta(data: string): string {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return '';
  }
  if (json?.error) throw new ProviderError(json.error.message ?? JSON.stringify(json.error));
  const content = json?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

async function describeHttpError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  let detail = text.slice(0, 300);
  try {
    const json = JSON.parse(text);
    detail = json?.error?.message ?? json?.message ?? detail;
  } catch {}
  return `HTTP ${res.status}${detail ? `：${detail}` : ''}`;
}
