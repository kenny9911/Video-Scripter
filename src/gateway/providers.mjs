// Provider presets for the LLM gateway.
// `protocol` decides which wire adapter is used:
//   - "openai"    : POST {baseUrl}/chat/completions  (OpenAI-compatible; most vendors)
//   - "anthropic" : POST {baseUrl}/v1/messages       (Anthropic Messages API)
//   - "mock"      : offline canned output, for trying the UI without a key
// baseUrl and model are only defaults; both are editable in Settings.

export const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', needsKey: true },
  { id: 'anthropic', label: 'Anthropic (Claude)', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', needsKey: true },
  { id: 'qwen', label: '通义千问 Qwen (DashScope)', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', needsKey: true },
  { id: 'doubao', label: '豆包 Doubao (Volcengine Ark)', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', modelHint: 'Ark endpoint ID or model name', needsKey: true },
  { id: 'moonshot', label: 'Moonshot Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', needsKey: true },
  { id: 'zhipu', label: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', needsKey: true },
  { id: 'gemini', label: 'Google Gemini (OpenAI-compatible)', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', modelHint: 'e.g. vendor/model-name', needsKey: true },
  { id: 'ollama', label: 'Ollama (local)', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', modelHint: 'a model you have pulled', needsKey: false },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', protocol: 'openai', baseUrl: '', model: '', needsKey: false },
  { id: 'custom-anthropic', label: 'Custom (Anthropic-compatible)', protocol: 'anthropic', baseUrl: '', model: '', needsKey: false },
  { id: 'mock', label: 'Demo (offline, no key)', protocol: 'mock', baseUrl: '', model: 'demo', needsKey: false },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}
