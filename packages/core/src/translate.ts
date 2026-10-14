import { streamChatCompletion } from './client';
import { getLanguage } from './languages';
import { buildTranslateMessages, parseNumbered } from './prompt';
import type { PageContext, ProviderConfig, TranslationTurn } from './types';

export interface TranslateParams {
  config: ProviderConfig;
  /** 一次请求要翻译的若干段 */
  segments: string[];
  /** 语言代码，见 LANGUAGES */
  targetLang: string;
  page?: PageContext;
  history?: TranslationTurn[];
  signal?: AbortSignal;
}

/** 产出模型的原始编号输出增量，用 parseNumbered 拆回各段 */
export function translateStream({ config, segments, targetLang, page, history, signal }: TranslateParams): AsyncGenerator<string> {
  const messages = buildTranslateMessages(segments, getLanguage(targetLang).englishName, { page, history });
  return streamChatCompletion(config, messages, signal);
}

/** 翻译一批文本，返回与 segments 一一对应的译文；模型漏掉的段为空字符串 */
export async function translateSegments(params: TranslateParams): Promise<string[]> {
  let out = '';
  for await (const delta of translateStream(params)) out += delta;
  return parseNumbered(out, params.segments.length);
}
