import { describe, expect, it } from 'vitest';
import { buildTranslateMessages, parseNumbered, recentHistory } from '../src/prompt';

describe('buildTranslateMessages', () => {
  it('numbers the segments in a single user message', () => {
    const messages = buildTranslateMessages(['Hello', 'World'], 'Simplified Chinese');
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]!.content).toBe('[1] Hello\n[2] World');
    expect(messages[0]!.content).not.toContain('Context:');
    expect(messages[0]!.content).not.toContain('Earlier turns');
  });

  it('puts page info in the system prompt and earlier turns before the current batch', () => {
    const messages = buildTranslateMessages(['Third'], 'Simplified Chinese', {
      page: { title: 'Service workers', host: 'developer.chrome.com' },
      history: [{ sources: ['First', 'Second'], translations: ['第一', '第二'] }],
    });
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['system', expect.stringContaining('titled "Service workers" on developer.chrome.com')],
      ['user', '[1] First\n[2] Second'],
      ['assistant', '[1] 第一\n[2] 第二'],
      ['user', '[1] Third'],
    ]);
    expect(messages[0]!.content).toContain('translate only the latest user message');
  });
});

describe('parseNumbered', () => {
  it('splits numbered output back into segments', () => {
    expect(parseNumbered('[1] 你好\n[2] 世界\n', 2)).toEqual(['你好', '世界']);
  });

  it('works on partial streaming output without leaking half-written markers', () => {
    expect(parseNumbered('[1] 你好\n[', 3)).toEqual(['你好', '', '']);
    expect(parseNumbered('[1] 你好\n[2', 3)).toEqual(['你好', '', '']);
    expect(parseNumbered('[1] 你好\n[2] 世', 3)).toEqual(['你好', '世', '']);
    expect(parseNumbered('[', 1)).toEqual(['']);
  });

  it('keeps multi-line segments and leaves skipped segments empty', () => {
    expect(parseNumbered('[1] 第一行\n第二行\n[3] 三', 3)).toEqual(['第一行\n第二行', '', '三']);
  });

  it('treats out-of-range markers as text and accepts a single unnumbered answer', () => {
    expect(parseNumbered('[1] 见 [18]\n[18] 参考', 2)).toEqual(['见 [18]\n[18] 参考', '']);
    expect(parseNumbered('你好，世界', 1)).toEqual(['你好，世界']);
  });
});

describe('recentHistory', () => {
  const turn = (n: number) => ({ sources: ['x'.repeat(n)], translations: ['y'.repeat(n)] });

  it('keeps the most recent turns that fit in the budget, in order', () => {
    const h = [turn(10), turn(10), turn(10)];
    expect(recentHistory(h, 45)).toEqual([h[1], h[2]]);
    expect(recentHistory(h, 60)).toEqual(h);
    expect(recentHistory(h, 19)).toEqual([]);
  });
});
