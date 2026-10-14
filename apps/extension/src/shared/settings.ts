import { getPreset, type ProviderConfig } from '@translate-by-ai/core';

export interface Settings {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** JSON 文本，保存原样以便用户编辑 */
  extraBody: string;
  targetLang: string;
}

const openrouter = getPreset('openrouter')!;

export const DEFAULT_SETTINGS: Settings = {
  providerId: openrouter.id,
  baseUrl: openrouter.baseUrl,
  apiKey: '',
  model: openrouter.defaultModel,
  extraBody: formatExtraBody(openrouter.extraBody),
  targetLang: 'zh-CN',
};

const STORAGE_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export function formatExtraBody(body: Record<string, unknown> | undefined): string {
  return body ? JSON.stringify(body, null, 2) : '';
}

export function parseExtraBody(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('额外请求参数不是合法的 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('额外请求参数必须是 JSON 对象');
  return value as Record<string, unknown>;
}

export function toProviderConfig(settings: Settings): ProviderConfig {
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    extraBody: parseExtraBody(settings.extraBody),
  };
}

/** 是否缺少必要配置（自定义接口允许不填 Key，比如本地 Ollama） */
export function needsSetup(settings: Settings): boolean {
  return !settings.baseUrl.trim() || !settings.model.trim() || (!settings.apiKey && settings.providerId !== 'custom');
}
