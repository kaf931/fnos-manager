import type { AiProtocol } from './contracts/ai.js';
export const aiProtocols: { value: AiProtocol; label: string; baseUrl: string; model: string }[] = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  { value: 'claude', label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', model: '' },
  { value: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434', model: '' },
  {
    value: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: '',
  },
  { value: 'glm', label: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '' },
  { value: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.cn/v1', model: '' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: '' },
  { value: 'mimo', label: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: '' },
];
