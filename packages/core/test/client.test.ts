import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsUrl, streamChatCompletion } from '../src/client';
import { translateText } from '../src/translate';

const config = { baseUrl: 'https://example.com/v1/', apiKey: 'sk-test', model: 'm', extraBody: { reasoning: { enabled: false } } };

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

afterEach(() => vi.unstubAllGlobals());

describe('chatCompletionsUrl', () => {
  it('appends the endpoint unless already present', () => {
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
  });
});

describe('streamChatCompletion', () => {
  it('sends an OpenAI-compatible request and yields content deltas', async () => {
    const fetchMock = vi.fn(async () => sseResponse([': keep-alive\n\n', chunk('你好'), chunk('，世界'), 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const text = await translateText({ config, text: 'Hello, world', targetLang: 'zh-CN' });
    expect(text).toBe('你好，世界');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'm', stream: true, reasoning: { enabled: false } });
    expect(body.messages[0].content).toContain('Simplified Chinese');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello, world' });
  });

  it('surfaces HTTP errors with the provider message', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'No auth credentials found' } }), { status: 401 }));
    const gen = streamChatCompletion(config, []);
    await expect(gen.next()).rejects.toMatchObject({ name: 'ProviderError', status: 401, message: 'HTTP 401：No auth credentials found' });
  });

  it('surfaces errors sent mid-stream', async () => {
    vi.stubGlobal('fetch', async () => sseResponse([chunk('部分'), `data: ${JSON.stringify({ error: { message: 'upstream overloaded' } })}\n\n`]));
    await expect(translateText({ config, text: 'x', targetLang: 'zh-CN' })).rejects.toThrow('upstream overloaded');
  });

  it('omits Authorization when no API key is configured', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    await translateText({ config: { ...config, apiKey: '' }, text: 'x', targetLang: 'en' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
