import { isLikelyInLanguage } from '@translate-by-ai/core';
import {
  TAG,
  childOf,
  createDisplayCache,
  createTranslationElement,
  hasBreakBetween,
  hasLetters,
  insertAfter,
  insertionAnchor,
  isExcluded,
  layoutFor,
  nearestBlock,
  showError,
  showLoading,
  showText,
  textOfRange,
} from './dom';
import { CancelledError, type Translator } from './translator';

/** 同一个块级元素里一段连续的行内内容，first..last 是该块的直接子节点 */
interface Segment {
  block: Element;
  first: Node;
  last: Node;
}

/** 一段待翻译的文字和它的译文元素 */
interface Job {
  text: string;
  el: HTMLElement;
  attempts: number;
}

/** 短于这个长度的段落翻译失败时不显示错误（菜单、按钮满屏红字反而干扰阅读） */
const MIN_ERROR_TEXT_LENGTH = 50;

/** 一次请求最多带多少段 / 多少字符；一屏内容通常一批就够 */
const MAX_BATCH_SEGMENTS = 40;
const MAX_BATCH_CHARS = 3000;

/**
 * 整页双语翻译：把页面切成段落，段落进入视口附近时才翻译（省钱），
 * 译文插在每段原文下方；页面后续动态加载的内容也会被处理。
 *
 * 同时进入视口的段落合成一批、编号后一次请求翻译，一屏内容互为上下文；
 * 批次之间排队依次发送，每批都带着本页会话的历史，所以整页术语前后一致。
 */
export class PageTranslator {
  private active = false;
  private seen = new WeakSet<Node>();
  private pending = new Map<Element, Segment[]>();
  private queue: Job[] = [];
  private busy = false;
  private dirtyRoots = new Set<Element>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly io = new IntersectionObserver((entries) => this.onIntersect(entries), { rootMargin: '400px 0px' });
  private readonly mo = new MutationObserver((records) => this.onMutations(records));

  constructor(
    private readonly translator: Translator,
    private readonly targetLang: string,
  ) {}

  get isActive() {
    return this.active;
  }

  start() {
    if (this.active || !document.body) return;
    this.active = true;
    this.scan(document.body);
    this.mo.observe(document.body, { childList: true, subtree: true });
  }

  /** 停止并移除页面上所有译文（包括划词翻译的） */
  stop() {
    this.active = false;
    this.io.disconnect();
    this.mo.disconnect();
    clearTimeout(this.flushTimer);
    this.pending.clear();
    this.queue = [];
    this.dirtyRoots.clear();
    this.translator.cancelAll();
    this.translator.resetContext();
    for (const el of document.querySelectorAll(TAG)) el.remove();
  }

  private scan(root: Element) {
    const displayOf = createDisplayCache();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (this.seen.has(node) || !parent || !/\S/.test(node.nodeValue ?? '') || isExcluded(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const segments: Segment[] = [];
    let current: Segment | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      this.seen.add(node);
      const block = nearestBlock(node.parentElement!, displayOf);
      const top = childOf(block, node);
      if (current?.block === block && (current.last === top || !hasBreakBetween(current.last, top, displayOf))) {
        current.last = top;
      } else {
        current = { block, first: top, last: top };
        segments.push(current);
      }
    }

    for (const seg of segments) {
      // 这里先不管可见性：隐藏的块（如折叠菜单）留在 pending 里，等它出现在视口时再翻译
      if (!this.worthTranslating(textOfRange(seg.first, seg.last))) continue;
      const list = this.pending.get(seg.block);
      if (list) {
        list.push(seg);
      } else {
        this.pending.set(seg.block, [seg]);
        this.io.observe(seg.block);
      }
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]) {
    const displayOf = createDisplayCache();
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const block = entry.target;
      this.io.unobserve(block);
      const segments = this.pending.get(block) ?? [];
      this.pending.delete(block);

      for (const seg of segments) {
        if (!seg.last.isConnected) continue;
        // 真正翻译时只取当前渲染出来的文字，块里隐藏的提示、表单步骤等不算
        const text = textOfRange(seg.first, seg.last, true);
        if (!this.worthTranslating(text)) continue;
        const layout = layoutFor(text);
        const el = createTranslationElement('page', layout);
        insertAfter(el, layout === 'inline' ? seg.last : insertionAnchor(block, seg.last, displayOf));
        showLoading(el);
        this.queue.push({ text, el, attempts: 0 });
      }
    }
    this.pump();
  }

  /** 一次只发一批：等它完成、写入会话历史后再发下一批 */
  private pump() {
    if (this.busy || !this.active || this.queue.length === 0) return;
    const batch = takeBatch(this.queue);
    this.busy = true;
    this.translator
      .translate(
        batch.map((job) => job.text),
        (parts) => batch.forEach((job, i) => parts[i] && showText(job.el, parts[i])),
      )
      .then(
        (parts) =>
          batch.forEach((job, i) => {
            if (parts[i]) showText(job.el, parts[i], true);
            else if (job.attempts++ < 1) this.queue.push(job); // 模型漏了这一段：放回队列再试一次
            else this.fail(job, '模型没有返回这一段的译文');
          }),
        (err: Error) => {
          if (err instanceof CancelledError) return;
          for (const job of batch) this.fail(job, err.message);
        },
      )
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }

  private fail(job: Job, message: string) {
    if (job.text.length < MIN_ERROR_TEXT_LENGTH) job.el.remove();
    else showError(job.el, message, () => this.retry(job));
  }

  private retry(job: Job) {
    job.attempts = 0;
    showLoading(job.el);
    this.queue.push(job);
    this.pump();
  }

  private worthTranslating(text: string): boolean {
    return text.length >= 2 && hasLetters(text) && !isLikelyInLanguage(text, this.targetLang);
  }

  private onMutations(records: MutationRecord[]) {
    for (const record of records) {
      // 忽略我们自己插入、流式更新译文引起的变化
      if (record.target instanceof Element && record.target.closest(TAG)) continue;
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          if (node.localName !== TAG) this.dirtyRoots.add(node);
        } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
          this.dirtyRoots.add(node.parentElement);
        }
      }
    }
    if (this.dirtyRoots.size > 0 && this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        const roots = [...this.dirtyRoots];
        this.dirtyRoots.clear();
        if (!this.active) return;
        for (const root of roots) if (root.isConnected) this.scan(root);
      }, 500);
    }
  }
}

function takeBatch(queue: Job[]): Job[] {
  let n = 0;
  let chars = 0;
  while (n < queue.length && n < MAX_BATCH_SEGMENTS) {
    chars += queue[n]!.text.length;
    if (n > 0 && chars > MAX_BATCH_CHARS) break;
    n++;
  }
  return queue.splice(0, n);
}
