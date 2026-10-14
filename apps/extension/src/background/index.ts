import { isAbortError, translateStream } from '@translate-by-ai/core';
import { TRANSLATE_PORT, type PortRequest, type PortResponse, type TabCommand } from '../shared/messages';
import { loadSettings, needsSetup, toProviderConfig } from '../shared/settings';

const MENU_SELECTION = 'translate-selection';
const MENU_PAGE = 'translate-page';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: '用 AI 翻译「%s」', contexts: ['selection'] });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: '用 AI 翻译此页面（再次点击恢复原文）',
      contexts: ['page', 'frame', 'link', 'image'],
    });
  });
});

chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  if (tab?.id === undefined) return;
  const settings = await loadSettings();
  if (needsSetup(settings)) {
    await chrome.runtime.openOptionsPage();
    return;
  }

  const cmd: TabCommand =
    info.menuItemId === MENU_SELECTION
      ? { type: 'translate-selection', targetLang: settings.targetLang, text: info.selectionText ?? '' }
      : { type: 'toggle-page', targetLang: settings.targetLang };

  try {
    await runInTab(tab.id, info.frameId ?? 0, cmd);
  } catch (err) {
    // chrome:// 页面、应用商店、PDF 查看器等不允许注入脚本
    console.warn('[AI 翻译] 无法在此页面运行：', err);
  }
}

/** 借助右键菜单授予的 activeTab 权限按需注入 content script，再把指令交给它 */
async function runInTab(tabId: number, frameId: number, cmd: TabCommand) {
  const target = { tabId, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, files: ['content.js'] });
  await chrome.scripting.executeScript({
    target,
    func: (c: TabCommand) => globalThis.__aiTranslate?.handle(c),
    args: [cmd],
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== TRANSLATE_PORT) return;
  const controllers = new Map<number, AbortController>();

  port.onDisconnect.addListener(() => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
  });

  port.onMessage.addListener((msg: PortRequest) => {
    if (msg.type === 'cancel') {
      controllers.get(msg.id)?.abort();
      controllers.delete(msg.id);
      return;
    }
    const controller = new AbortController();
    controllers.set(msg.id, controller);
    void translate(msg.id, msg.text, controller.signal).finally(() => controllers.delete(msg.id));
  });

  async function translate(id: number, text: string, signal: AbortSignal) {
    const post = (res: PortResponse) => {
      if (!signal.aborted) port.postMessage(res);
    };
    try {
      const settings = await loadSettings();
      const config = toProviderConfig(settings);
      for await (const delta of translateStream({ config, text, targetLang: settings.targetLang, signal })) {
        post({ type: 'delta', id, text: delta });
      }
      post({ type: 'done', id });
    } catch (err) {
      if (!isAbortError(err)) post({ type: 'error', id, message: (err as Error).message });
    }
  }
});
