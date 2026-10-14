export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 为空表示需要用户自己填写 */
  defaultModel: string;
  extraBody?: Record<string, unknown>;
  apiKeyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    // 该模型默认开启推理，翻译用不上，关掉能明显降低延迟和费用
    extraBody: { reasoning: { enabled: false } },
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: '',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容接口）',
    baseUrl: '',
    defaultModel: '',
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
