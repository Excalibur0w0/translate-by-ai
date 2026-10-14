import type { ContentApi, TabCommand } from '../shared/messages';
import { setDisplayStyle } from './dom';
import { PageTranslator } from './page';
import { translateSelection } from './selection';
import { PortTranslator } from './translator';

function createContentApi(): ContentApi {
  const translator = new PortTranslator();
  let page: PageTranslator | null = null;

  return {
    isAlive() {
      try {
        return chrome.runtime?.id !== undefined;
      } catch {
        return false;
      }
    },
    dispose() {
      page?.stop();
      page = null;
      translator.disconnect();
    },
    handle(cmd: TabCommand) {
      setDisplayStyle(cmd.style ?? 'underline');
      if (cmd.type === 'translate-selection') {
        translateSelection(translator, cmd.text);
      } else if (page) {
        page.stop();
        page = null;
      } else {
        page = new PageTranslator(translator, cmd.targetLang);
        page.start();
      }
    },
  };
}

// 每次右键都会重新注入本脚本：已有可用实例就复用（保留整页翻译的状态），
// 扩展重新加载后旧实例会失效，此时清理掉再新建
const existing = globalThis.__aiTranslate;
if (!(typeof existing?.isAlive === 'function' && existing.isAlive())) {
  try {
    existing?.dispose();
  } catch {}
  globalThis.__aiTranslate = createContentApi();
}
