import { streamChatCompletion } from './client';
import { getLanguage } from './languages';
import { buildTranslateMessages } from './prompt';
import type { ProviderConfig } from './types';

export interface TranslateParams {
  config: ProviderConfig;
  text: string;
  /** 语言代码，见 LANGUAGES */
  targetLang: string;
  signal?: AbortSignal;
}

export function translateStream({ config, text, targetLang, signal }: TranslateParams): AsyncGenerator<string> {
  const messages = buildTranslateMessages(text, getLanguage(targetLang).englishName);
  return streamChatCompletion(config, messages, signal);
}

export async function translateText(params: TranslateParams): Promise<string> {
  let out = '';
  for await (const delta of translateStream(params)) out += delta;
  return out.trim();
}
