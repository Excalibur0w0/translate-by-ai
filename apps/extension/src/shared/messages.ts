/** background → content script 的指令（通过 chrome.scripting.executeScript 传入） */
export type TabCommand =
  | { type: 'translate-selection'; targetLang: string; /** 右键菜单拿到的选中文本，输入框里的选区只能靠它 */ text: string }
  | { type: 'toggle-page'; targetLang: string };

/** content script 挂在其 isolated world 全局上的入口 */
export interface ContentApi {
  isAlive(): boolean;
  dispose(): void;
  handle(cmd: TabCommand): void;
}

declare global {
  var __aiTranslate: ContentApi | undefined;
}

/** content script ↔ background 的长连接，用于流式返回译文 */
export const TRANSLATE_PORT = 'translate';

export type PortRequest = { type: 'translate'; id: number; text: string } | { type: 'cancel'; id: number };

export type PortResponse =
  | { type: 'delta'; id: number; text: string }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };
