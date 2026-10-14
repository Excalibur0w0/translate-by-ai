import { TRANSLATE_PORT, type PortRequest, type PortResponse } from '../shared/messages';

export interface Translator {
  /** onUpdate 收到的是到目前为止累计的完整译文 */
  translate(text: string, onUpdate: (text: string) => void): Promise<string>;
  cancelAll(): void;
}

export class CancelledError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelledError';
  }
}

interface Pending {
  onDelta(text: string): void;
  resolve(): void;
  reject(err: Error): void;
}

/** 通过长连接把翻译请求交给 background 执行（API Key 不会暴露给网页），并限制并发数 */
export class PortTranslator implements Translator {
  private port: chrome.runtime.Port | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private running = 0;
  private queue: Array<{ start(): void; reject(err: Error): void }> = [];

  constructor(private readonly maxConcurrent = 4) {}

  translate(text: string, onUpdate: (text: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.running++;
        this.request(text, onUpdate)
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

  disconnect() {
    this.cancelAll();
    this.port?.disconnect();
    this.port = null;
  }

  private request(text: string, onUpdate: (text: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      let acc = '';
      this.pending.set(id, {
        onDelta: (delta) => onUpdate((acc += delta)),
        resolve: () => resolve(acc),
        reject,
      });
      try {
        this.send({ type: 'translate', id, text });
      } catch {
        this.pending.delete(id);
        reject(new Error('扩展已更新或重新加载，请刷新页面后重试'));
      }
    });
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
