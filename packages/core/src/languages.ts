export interface Language {
  code: string;
  /** 设置页里显示的名字 */
  label: string;
  /** 写进 prompt 的名字 */
  englishName: string;
}

export const LANGUAGES: Language[] = [
  { code: 'zh-CN', label: '简体中文', englishName: 'Simplified Chinese' },
  { code: 'zh-TW', label: '繁體中文', englishName: 'Traditional Chinese' },
  { code: 'en', label: 'English', englishName: 'English' },
  { code: 'ja', label: '日本語', englishName: 'Japanese' },
  { code: 'ko', label: '한국어', englishName: 'Korean' },
  { code: 'fr', label: 'Français', englishName: 'French' },
  { code: 'de', label: 'Deutsch', englishName: 'German' },
  { code: 'es', label: 'Español', englishName: 'Spanish' },
  { code: 'ru', label: 'Русский', englishName: 'Russian' },
];

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
}

/**
 * 粗略判断文本是否已经是目标语言，用于整页翻译时跳过无需翻译的段落。
 * 只对有独特文字的语言生效；拉丁字母语言之间无法这样区分，一律返回 false。
 */
export function isLikelyInLanguage(text: string, code: string): boolean {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const han = count(/\p{Script=Han}/gu);
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  // 一个汉字/假名/谚文音节大致相当于拼音文字的一个单词，按这个单位比较占比
  const words = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/\p{L}+/gu) ?? [];
  const total = han + kana + hangul + words.length;
  if (total === 0) return false;

  switch (code.split('-')[0]) {
    case 'zh':
      return kana === 0 && han / total > 0.5;
    case 'ja':
      return kana > 0 && (kana + han) / total > 0.5;
    case 'ko':
      return hangul / total > 0.5;
    case 'ru':
      return words.filter((w) => /\p{Script=Cyrillic}/u.test(w)).length / total > 0.5;
    default:
      return false;
  }
}
