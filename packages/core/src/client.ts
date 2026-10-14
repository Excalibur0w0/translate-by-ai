import { ProviderError } from './errors';
import { createSSEParser } from './sse';
import type { ChatMessage, ProviderConfig } from './types';

export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/** 调用 OpenAI 兼容的流式 chat completions 接口，逐段产出增量文本 */
export async function* streamChatCompletion(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!config.baseUrl.trim()) throw new ProviderError('未配置 API 地址');
  if (!config.model.trim()) throw new ProviderError('未配置模型');

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...config.headers };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...config.extraBody, model: config.model, messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ProviderError(`网络请求失败：${(err as Error).message}`);
  }
  if (!res.ok) throw new ProviderError(await describeHttpError(res), res.status);
  if (!res.body) throw new ProviderError('服务没有返回内容');

  const events: string[] = [];
  const parser = createSSEParser((data) => events.push(data));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) parser.end();
      else parser.feed(value);

      for (const data of events.splice(0)) {
        if (data === '[DONE]') return;
        const delta = parseDelta(data);
        if (delta) yield delta;
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => {});
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
