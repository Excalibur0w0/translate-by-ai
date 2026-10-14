/** 任意 OpenAI 兼容（/chat/completions）服务的连接配置 */
export interface ProviderConfig {
  /** 例如 https://openrouter.ai/api/v1；也可以直接填完整的 .../chat/completions */
  baseUrl: string;
  /** 本地模型（如 Ollama）可以留空 */
  apiKey: string;
  model: string;
  /** 合并进请求体的额外参数，例如 OpenRouter 的 { reasoning: { enabled: false } } */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
