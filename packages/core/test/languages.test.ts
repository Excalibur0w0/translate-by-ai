import { describe, expect, it } from 'vitest';
import { isLikelyInLanguage } from '../src/languages';

describe('isLikelyInLanguage', () => {
  it('detects text already in a script-distinct target language', () => {
    expect(isLikelyInLanguage('这是一段中文 with a little English', 'zh-CN')).toBe(true);
    expect(isLikelyInLanguage('使用 React Server Components 构建界面', 'zh-CN')).toBe(true);
    expect(isLikelyInLanguage('This is English text', 'zh-CN')).toBe(false);
    expect(isLikelyInLanguage('The 中国 market is growing fast this year', 'zh-CN')).toBe(false);
    expect(isLikelyInLanguage('日本語のテキストです', 'zh-CN')).toBe(false);
    expect(isLikelyInLanguage('日本語のテキストです', 'ja')).toBe(true);
    expect(isLikelyInLanguage('한국어 문장입니다', 'ko')).toBe(true);
    expect(isLikelyInLanguage('Привет, мир', 'ru')).toBe(true);
  });

  it('never skips for Latin-script targets or letterless text', () => {
    expect(isLikelyInLanguage('This is English text', 'en')).toBe(false);
    expect(isLikelyInLanguage('12,345 — 67%', 'zh-CN')).toBe(false);
  });
});
