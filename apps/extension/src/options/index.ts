import { LANGUAGES, PROVIDER_PRESETS, getPreset, parseNumbered, translateStream } from '@translate-by-ai/core';
import { createTranslationElement, layoutFor, setDisplayStyle, showText } from '../content/dom';
import type { DisplayStyle } from '../shared/messages';
import { formatExtraBody, loadSettings, saveSettings, toProviderConfig, type Settings } from '../shared/settings';

const TEST_TEXT = 'Large language models make it easy to read the web in your own language.';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const fields = {
  providerId: $<HTMLSelectElement>('providerId'),
  baseUrl: $<HTMLInputElement>('baseUrl'),
  apiKey: $<HTMLInputElement>('apiKey'),
  model: $<HTMLInputElement>('model'),
  targetLang: $<HTMLSelectElement>('targetLang'),
  extraBody: $<HTMLTextAreaElement>('extraBody'),
  displayStyle: $<HTMLSelectElement>('displayStyle'),
};
const apiKeyLink = $<HTMLAnchorElement>('apiKeyLink');
const testButton = $<HTMLButtonElement>('test');
const status = $<HTMLSpanElement>('status');

for (const p of PROVIDER_PRESETS) fields.providerId.add(new Option(p.name, p.id));
for (const l of LANGUAGES) fields.targetLang.add(new Option(l.label, l.code));

function readForm(): Settings {
  return {
    providerId: fields.providerId.value,
    baseUrl: fields.baseUrl.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    targetLang: fields.targetLang.value,
    extraBody: fields.extraBody.value,
    displayStyle: fields.displayStyle.value as DisplayStyle,
  };
}

function fillForm(s: Settings) {
  for (const key of Object.keys(fields) as Array<keyof Settings>) fields[key].value = s[key];
  updateApiKeyLink();
  setDisplayStyle(s.displayStyle);
}

/** 用和网页里完全相同的元素和样式渲染预览 */
function renderPreview() {
  const samples = [
    { tag: 'h3', source: 'Getting started', translation: '入门指南' },
    {
      tag: 'p',
      source: 'Large language models make it easy to read the web in your own language.',
      translation: '大语言模型让你可以轻松地用自己的语言阅读网页。',
    },
  ];
  const box = $<HTMLDivElement>('stylePreview');
  for (const { tag, source, translation } of samples) {
    const host = document.createElement(tag);
    host.textContent = source;
    const el = createTranslationElement('page', layoutFor(source));
    showText(el, translation, true);
    host.append(el);
    box.append(host);
  }
}

renderPreview();
fields.displayStyle.addEventListener('change', () => setDisplayStyle(fields.displayStyle.value as DisplayStyle));

function updateApiKeyLink() {
  const url = getPreset(fields.providerId.value)?.apiKeyUrl;
  apiKeyLink.hidden = !url;
  if (url) apiKeyLink.href = url;
}

function setStatus(text: string, kind: 'ok' | 'err' | '' = '') {
  status.textContent = text;
  status.className = kind;
}

fields.providerId.addEventListener('change', () => {
  const preset = getPreset(fields.providerId.value);
  if (!preset) return;
  fields.baseUrl.value = preset.baseUrl;
  fields.model.value = preset.defaultModel;
  fields.extraBody.value = formatExtraBody(preset.extraBody);
  updateApiKeyLink();
  (preset.baseUrl ? fields.model : fields.baseUrl).focus();
});

/**
 * 非预置域名需要额外授权，扩展才能跨域请求。
 * 必须在点击事件里同步调用（不能先 await 别的），否则会丢失用户手势导致授权失败。
 */
function requestHostPermission(baseUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return Promise.resolve(false);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return Promise.resolve(false);
  return chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] }).catch(() => false);
}

function validate(settings: Settings): void {
  if (!/^https?:\/\//.test(settings.baseUrl)) throw new Error('API 地址需要以 http:// 或 https:// 开头');
  toProviderConfig(settings); // 校验 JSON
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = readForm();
  const permission = requestHostPermission(settings.baseUrl);
  try {
    validate(settings);
    await saveSettings(settings);
    if (await permission) setStatus('已保存', 'ok');
    else setStatus(`已保存，但未获得访问 ${new URL(settings.baseUrl).hostname} 的权限，请求可能失败`, 'err');
  } catch (err) {
    setStatus((err as Error).message, 'err');
  }
});

testButton.addEventListener('click', async () => {
  const settings = readForm();
  const permission = requestHostPermission(settings.baseUrl);
  const output = $<HTMLParagraphElement>('testOutput');
  $<HTMLParagraphElement>('testSource').textContent = TEST_TEXT;
  $<HTMLElement>('testResult').hidden = false;
  output.textContent = '';
  testButton.disabled = true;
  setStatus('翻译中…');
  const started = performance.now();
  try {
    validate(settings);
    await permission;
    let raw = '';
    for await (const delta of translateStream({ config: toProviderConfig(settings), segments: [TEST_TEXT], targetLang: settings.targetLang })) {
      output.textContent = parseNumbered((raw += delta), 1)[0]!;
    }
    setStatus(`成功，用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒（测试不会自动保存）`, 'ok');
  } catch (err) {
    setStatus(`失败：${(err as Error).message}`, 'err');
  } finally {
    testButton.disabled = false;
  }
});

void loadSettings().then(fillForm);
