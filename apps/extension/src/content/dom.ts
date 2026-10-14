import type { DisplayStyle } from '../shared/messages';

/** 译文的外层元素（决定换行与否、状态），里面的 TEXT_TAG 放文字（决定下划线等样式） */
export const TAG = 'ai-translation';
const TEXT_TAG = 'ai-translation-text';

/** 个别网站上不该翻译的部分 */
const SITE_RULES: Array<{ host: RegExp; exclude: string[] }> = [
  // 标题旁的 [编辑]、参考文献回链、正文里的引用角标、侧栏目录
  { host: /(^|\.)wikipedia\.org$/, exclude: ['.mw-editsection', '.mw-cite-backlink', 'sup.reference', '#mw-panel-toc'] },
];
const SITE_EXCLUDED = SITE_RULES.filter((r) => r.host.test(location.hostname)).flatMap((r) => r.exclude);

/** 这些元素里的文字不会作为翻译的起点 */
const EXCLUDED = [
  TAG,
  'script', 'style', 'noscript', 'template', 'iframe', 'canvas', 'svg', 'math',
  'textarea', 'input', 'select', 'option', 'button',
  'pre', 'code', 'kbd', 'samp',
  '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
  '[translate="no"]', '.notranslate',
  ...SITE_EXCLUDED,
].join(',');

/** 计算段落文本时跳过的元素（行内 code 等仍然算作原文的一部分） */
const NOT_TEXT = [TAG, 'script', 'style', 'noscript', 'template', ...SITE_EXCLUDED].join(',');

const ACCENT = '#5083e4';
const STYLE_ID = 'ai-translation-style';
// 字体、颜色、对齐都继承原文；只用一条虚线下划线（或半透明）把译文和原文区分开
const CSS = `
${TAG} {
  display: block !important;
  margin: 0.4em 0 !important;
  padding: 0 !important;
  border: 0 !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  text-indent: 0;
}
${TAG}[data-layout="inline"] {
  display: inline !important;
  margin: 0 0 0 0.5em !important;
}
${TEXT_TAG} {
  display: inline !important;
}
${TAG}[data-style="underline"] > ${TEXT_TAG} {
  background: linear-gradient(to right, ${ACCENT} 0 50%, transparent 50% 100%) repeat-x left bottom / 8px 2px;
  padding-bottom: 2px;
}
${TAG}[data-style="weak"] > ${TEXT_TAG} {
  opacity: 0.55;
}
${TAG}[data-state="loading"] > ${TEXT_TAG} {
  display: inline-block !important;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  padding: 0;
  vertical-align: middle;
  background: none;
  border: 2px solid rgba(128, 128, 128, 0.25);
  border-top-color: ${ACCENT};
  border-radius: 50%;
  animation: ai-translation-spin 0.75s linear infinite;
}
@keyframes ai-translation-spin {
  to { transform: rotate(360deg); }
}
${TAG}[data-state="error"] > ${TEXT_TAG} {
  background: none;
  color: #d93025 !important;
  font-size: 0.85em;
  cursor: pointer;
}
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

/** from 和 to（同一父节点下的兄弟节点）之间是否隔着块级元素或 <br>，是的话两边各自成段 */
export function hasBreakBetween(from: Node, to: Node, displayOf: DisplayOf): boolean {
  for (let n = from.nextSibling; n && n !== to; n = n.nextSibling) {
    if (isBr(n) || isBlockLevel(n, displayOf)) return true;
  }
  return false;
}

function isBr(node: Node | null): boolean {
  return node instanceof Element && node.localName === 'br';
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
/** inline：译文接在原文同一行后面；block：另起一行 */
export type Layout = 'inline' | 'block';

let displayStyle: DisplayStyle = 'underline';

/** 设置译文样式，并应用到页面上已有的译文 */
export function setDisplayStyle(style: DisplayStyle) {
  displayStyle = style;
  for (const el of document.querySelectorAll<HTMLElement>(TAG)) el.dataset.style = style;
}

/**
 * 短文本（菜单、按钮、标签、短标题）的译文放在同一行，不会把导航栏、标签页撑高；
 * 长文本另起一行。中日韩字符按两个宽度算。
 */
export function layoutFor(text: string): Layout {
  const words = text.split(/\s+/).filter(Boolean).length;
  let width = 0;
  for (const ch of text) width += /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(ch) ? 2 : 1;
  return words < 5 && width < 32 && !text.includes('\n') ? 'inline' : 'block';
}

export function createTranslationElement(mode: Mode, layout: Layout = 'block'): HTMLElement {
  ensureStyles();
  const el = document.createElement(TAG);
  el.dataset.mode = mode;
  el.dataset.layout = layout;
  el.dataset.style = displayStyle;
  el.setAttribute('translate', 'no');
  el.append(document.createElement(TEXT_TAG));
  return el;
}

/**
 * 另起一行的译文要插在哪个节点后面，才能出现在这一段原文的下方：
 * 普通块级元素里就插在 last 后面（在块内、继承原文样式），这一行以 <br> 结尾时插在 <br> 后面，免得多出空行；
 * flex / grid 容器里插进去会变成并排的子项，所以改为插在容器后面。
 */
export function insertionAnchor(block: Element, last: Node, displayOf: DisplayOf): Node {
  if (block !== document.body && isFlexOrGrid(block, displayOf)) return block;
  let next = last.nextSibling;
  while (next?.nodeType === Node.TEXT_NODE && !/\S/.test(next.nodeValue ?? '')) next = next.nextSibling;
  return isBr(next) ? next! : last;
}

export function insertAfter(el: Node, anchor: Node) {
  anchor.parentNode!.insertBefore(el, anchor.nextSibling);
}

const textEl = (el: HTMLElement) => el.firstElementChild as HTMLElement;

/** 加载中显示一个小圆圈 */
export function showLoading(el: HTMLElement) {
  el.dataset.state = 'loading';
  el.title = '翻译中…';
  textEl(el).textContent = '';
  el.onclick = null;
}

export function showText(el: HTMLElement, text: string, done = false) {
  const t = done ? text.trim() : text.trimStart();
  el.dataset.state = done ? 'done' : 'streaming';
  el.removeAttribute('title');
  if (textEl(el).textContent !== t) textEl(el).textContent = t;
  el.onclick = null;
}

/** 显示错误，点击重试 */
export function showError(el: HTMLElement, message: string, retry: () => void) {
  el.dataset.state = 'error';
  el.removeAttribute('title');
  textEl(el).textContent = `翻译失败：${message}（点击重试）`;
  el.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    retry();
  };
}
