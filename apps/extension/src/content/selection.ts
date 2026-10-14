import {
  TAG,
  childOf,
  createDisplayCache,
  createTranslationElement,
  insertAfter,
  insertionAnchor,
  isBlockLevel,
  nearestBlock,
  renderTranslation,
  type DisplayOf,
} from './dom';
import { CancelledError, type Translator } from './translator';

/** 翻译当前选中的文字，译文插在选区所在段落的下方 */
export function translateSelection(translator: Translator, fallbackText: string) {
  const displayOf = createDisplayCache();
  const selection = window.getSelection();
  const text = selection?.toString().trim() || fallbackText.trim();
  if (!text) return;

  const endText = selection && !selection.isCollapsed && selection.rangeCount > 0 ? lastTextNodeIn(selection.getRangeAt(0)) : null;
  let anchor: Node;
  if (endText?.parentElement) {
    const host = endText.parentElement.closest(TAG);
    if (host) {
      // 在译文里又划词翻译：放到这条译文后面
      anchor = host;
    } else {
      const block = nearestBlock(endText.parentElement, displayOf);
      anchor = insertionAnchor(block, runEnd(childOf(block, endText), displayOf), displayOf);
    }
  } else {
    // 输入框里的选区拿不到 Range，把译文放在输入框后面
    const active = document.activeElement;
    if (!active?.parentElement || active === document.body) return;
    anchor = active;
  }

  // 对同一段重复翻译时复用之前的译文元素
  const next = anchor.nextSibling;
  let el: HTMLElement;
  if (next instanceof HTMLElement && next.localName === TAG && next.dataset.mode === 'selection') {
    el = next;
  } else {
    el = createTranslationElement('selection');
    insertAfter(el, anchor);
  }
  renderTranslation(
    el,
    (onUpdate) => translator.translate(text, onUpdate),
    (err) => err instanceof CancelledError,
  );
}

/** 选区中最后一个有内容的文本节点（三击选中段落时，选区终点常落在下一段的开头，需要排除） */
function lastTextNodeIn(range: Range): Text | null {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return root as Text;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === range.endContainer && range.endOffset === 0) break;
    if (/\S/.test(n.nodeValue ?? '') && range.intersectsNode(n)) last = n as Text;
  }
  return last;
}

/** 从 node 往后延伸到这一行内内容的末尾，避免把译文插在段落中间 */
function runEnd(node: Node, displayOf: DisplayOf): Node {
  let last = node;
  for (let n = node.nextSibling; n && !isBlockLevel(n, displayOf); n = n.nextSibling) {
    if (n instanceof Element && n.localName === TAG) break;
    last = n;
  }
  return last;
}
