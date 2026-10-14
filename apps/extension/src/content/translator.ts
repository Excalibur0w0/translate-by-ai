import { parseNumbered, recentHistory, type PageContext, type TranslationTurn } from '@translate-by-ai/core';
import { TRANSLATE_PORT, type PortRequest, type PortResponse } from '../shared/messages';

export interface Translator {
  /** 一次请求翻译一批文本；onUpdate 收到每段到目前为止的译文。模型漏掉的段返回空字符串 */
  translate(segments: string[], onUpdate: (parts: string[]) => void): Promise<string[]>;
  cancelAll(): void;
  /** 清空本页的翻译会话（恢复原文时调用） */
  resetContext(): void;
}

export class CancelledError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelledError';
  }
}

/** 随请求附带的会话历史上限（原文+译文字符数），只保留最近的几轮，也就是视口附近刚翻过的内容 */
const HISTORY_MAX_CHARS = 4000;

interface Pending {
  onDelta(text: string): void;
  resolve(): void;
  reject(err: Error): void;
}

/**
 * 通过长连接把翻译请求交给 background 执行（API Key 不会暴露给网页）。
 * 同一页面的所有翻译是一个会话：每个请求都带上最近几轮的原文和译文，让术语和指代前后一致。
 */
export class PortTranslator implements Translator {
  private port: chrome.runtime.Port | null = null;
  private history: TranslationTurn[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private running = 0;
  private queue: Array<{ start(): void; reject(err: Error): void }> = [];

  constructor(private readonly maxConcurrent = 4) {}

  translate(segments: string[], onUpdate: (parts: string[]) => void): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.running++;
        this.request(segments, onUpdate)
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this.queue.shift()?.start();
          });
      };
      if (this.running < this.maxConcurrent) start();
      else this.queue.push({ start, reject });
    });
  }

  cancelAll() {
    for (const task of this.queue.splice(0)) task.reject(new CancelledError());
    for (const [id, p] of this.pending) {
      try {
        this.port?.postMessage({ type: 'cancel', id } satisfies PortRequest);
      } catch {}
      p.reject(new CancelledError());
    }
    this.pending.clear();
  }

  resetContext() {
    this.history = [];
  }

  disconnect() {
    this.cancelAll();
    this.port?.disconnect();
    this.port = null;
  }

  private request(segments: string[], onUpdate: (parts: string[]) => void): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      let raw = '';
      this.pending.set(id, {
        onDelta: (delta) => onUpdate(parseNumbered((raw += delta), segments.length)),
        resolve: () => {
          const parts = parseNumbered(raw, segments.length);
          this.remember(segments, parts);
          resolve(parts);
        },
        reject,
      });
      try {
        this.send({ type: 'translate', id, segments, page: currentPage(), history: this.history });
      } catch {
        this.pending.delete(id);
        reject(new Error('扩展已更新或重新加载，请刷新页面后重试'));
      }
    });
  }

  private remember(segments: string[], parts: string[]) {
    const turn: TranslationTurn = { sources: [], translations: [] };
    segments.forEach((source, i) => {
      if (!parts[i]) return;
      turn.sources.push(source);
      turn.translations.push(parts[i]!);
    });
    if (turn.sources.length > 0) this.history = recentHistory([...this.history, turn], HISTORY_MAX_CHARS);
  }

  private send(msg: PortRequest) {
    this.getPort().postMessage(msg);
  }

  private getPort(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: TRANSLATE_PORT });
    port.onMessage.addListener((msg: PortResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'delta') return p.onDelta(msg.text);
      this.pending.delete(msg.id);
      if (msg.type === 'done') p.resolve();
      else p.reject(new Error(msg.message));
    });
    port.onDisconnect.addListener(() => {
      // service worker 被回收或扩展重载时连接会断开，下次请求重新建立
      this.port = null;
      for (const p of this.pending.values()) p.reject(new Error('与扩展的连接已断开，请重试'));
      this.pending.clear();
    });
    return (this.port = port);
  }
}

function currentPage(): PageContext {
  return { title: document.title.trim(), host: location.hostname };
}
