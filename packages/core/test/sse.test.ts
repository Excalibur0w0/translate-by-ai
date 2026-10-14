import { describe, expect, it } from 'vitest';
import { createSSEParser } from '../src/sse';

function parseChunks(chunks: string[]): string[] {
  const out: string[] = [];
  const parser = createSSEParser((d) => out.push(d));
  for (const c of chunks) parser.feed(c);
  parser.end();
  return out;
}

describe('createSSEParser', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const raw = 'data: {"a":1}\n\n: OPENROUTER PROCESSING\n\ndata: {"b":2}\r\n\r\ndata: [DONE]\n\n';
    const expected = ['{"a":1}', '{"b":2}', '[DONE]'];
    for (let size = 1; size <= raw.length; size++) {
      const chunks = [];
      for (let i = 0; i < raw.length; i += size) chunks.push(raw.slice(i, i + size));
      expect(parseChunks(chunks)).toEqual(expected);
    }
  });

  it('joins multi-line data and flushes a trailing event without blank line', () => {
    expect(parseChunks(['data: a\ndata: b\n\nevent: x\ndata: c'])).toEqual(['a\nb', 'c']);
  });
});
