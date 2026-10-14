export const TAG = 'ai-translation';

/** 这些元素里的文字不会作为翻译的起点 */
const EXCLUDED = [
  TAG,
  'script', 'style', 'noscript', 'template', 'iframe', 'canvas', 'svg', 'math',
  'textarea', 'input', 'select', 'option', 'button',
  'pre', 'code', 'kbd', 'samp',
  '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
  '[translate="no"]', '.notranslate',
].join(',');

/** 计算段落文本时跳过的元素（行内 code 等仍然算作原文的一部分） */
const NOT_TEXT = [TAG, 'script', 'style', 'noscript', 'template'].join(',');

const STYLE_ID = 'ai-translation-style';
const CSS = `
${TAG} {
  display: block !important;
  margin: 0.3em 0 0.15em !important;
  padding: 0 0 0 0.6em !important;
  border-left: 2px solid rgba(128, 128, 128, 0.45) !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  text-align: start;
  text-indent: 0;
  font-style: normal;
}
${TAG}[data-state="loading"] { opacity: 0.55; }
${TAG}[data-state="error"] { color: #d93025 !important; cursor: pointer; }
`;

export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

export function isExcluded(el: Element): boolean {
  return el.closest(EXCLUDED) !== null;
}

export type DisplayOf = (el: Element) => string;

/** 同一轮扫描里缓存 getComputedStyle 的结果 */
export function createDisplayCache(): DisplayOf {
  const cache = new Map<Element, string>();
  return (el) => {
    let d = cache.get(el);
    if (d === undefined) cache.set(el, (d = getComputedStyle(el).display));
    return d;
  };
}

export function isBlockLevel(node: Node, displayOf: DisplayOf): boolean {
  if (!(node instanceof Element)) return false;
  const d = displayOf(node);
  return d !== 'none' && d !== 'contents' && !d.startsWith('inline');
}

export function isFlexOrGrid(el: Element, displayOf: DisplayOf): boolean {
  return /\b(flex|grid)\b/.test(displayOf(el));
}

export function nearestBlock(el: Element, displayOf: DisplayOf): Element {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (cur === document.body || cur === document.documentElement) return cur;
    if (isBlockLevel(cur, displayOf)) return cur;
  }
  return document.body;
}

/** block 的子节点中包含 node 的那一个 */
export function childOf(block: Element, node: Node): Node {
  let cur = node;
  while (cur.parentNode && cur.parentNode !== block) cur = cur.parentNode;
  return cur;
}

export function hasBlockBetween(from: Node, to: Node, displayOf: DisplayOf): boolean {
  for (let n = from.nextSibling; n && n !== to; n = n.nextSibling) {
    if (isBlockLevel(n, displayOf)) return true;
  }
  return false;
}

/**
 * 从 first 到 last（同一父节点下的兄弟节点，含两端）的文字，空白折叠。
 * visibleOnly 时跳过 display:none / visibility:hidden 的文字（表单错误提示、未展开的步骤等）。
 */
export function textOfRange(first: Node, last: Node, visibleOnly = false): string {
  let out = '';
  for (let n: Node | null = first; n; n = n.nextSibling) {
    out += textOf(n, visibleOnly);
    if (n === last) break;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function textOf(node: Node, visibleOnly: boolean): string {
  const visible = (el: Element | null) => !visibleOnly || !el || el.checkVisibility({ visibilityProperty: true });
  if (node.nodeType === Node.TEXT_NODE) return visible(node.parentElement) ? (node.nodeValue ?? '') : '';
  if (!(node instanceof Element) || node.matches(NOT_TEXT)) return '';
  let out = '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) =>
      t.parentElement?.closest(NOT_TEXT) || !visible(t.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let t = walker.nextNode(); t; t = walker.nextNode()) out += t.nodeValue;
  return out;
}

export function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

export type Mode = 'page' | 'selection';

export function createTranslationElement(mode: Mode): HTMLElement {
  ensureStyles();
  const el = document.createElement(TAG);
  el.dataset.mode = mode;
  el.setAttribute('translate', 'no');
  return el;
}

/**
 * 译文要插在哪个节点后面，才能出现在这一段原文的下方：
 * 普通块级元素里就插在 last 后面（在块内、继承原文样式）；
 * flex / grid 容器里插进去会变成并排的子项，所以改为插在容器后面。
 */
export function insertionAnchor(block: Element, last: Node, displayOf: DisplayOf): Node {
  return block !== document.body && isFlexOrGrid(block, displayOf) ? block : last;
}

export function insertAfter(el: Node, anchor: Node) {
  anchor.parentNode!.insertBefore(el, anchor.nextSibling);
}

/** 流式渲染一次翻译，失败时显示错误，点击可重试 */
export function renderTranslation(el: HTMLElement, run: (onUpdate: (text: string) => void) => Promise<string>, isCancelled: (err: unknown) => boolean) {
  el.dataset.state = 'loading';
  el.textContent = '翻译中…';
  el.onclick = null;
  run((text) => {
    el.dataset.state = 'streaming';
    el.textContent = text.trimStart();
  }).then(
    (text) => {
      el.dataset.state = 'done';
      el.textContent = text.trim();
    },
    (err: unknown) => {
      if (isCancelled(err)) return;
      el.dataset.state = 'error';
      el.textContent = `翻译失败：${(err as Error).message}（点击重试）`;
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderTranslation(el, run, isCancelled);
      };
    },
  );
}
