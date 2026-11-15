import type { LlmModelCapability, ModelThinkingLevel, ServiceConnectionKind } from '@sthstart/contracts';

export interface ProviderPreset {
  id: string;
  label: string;
  hint: string;
  kind: ServiceConnectionKind;
  baseUrlPlaceholder: string;
  capabilities: LlmModelCapability[];
  thinkingLevel: ModelThinkingLevel;
  supportsDiscovery: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容',
    hint: '适用于大多数聚合服务、DeepSeek、OpenRouter 和本地 OpenAI 兼容网关。',
    kind: 'openai-compatible-text',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    capabilities: ['text'],
    thinkingLevel: 'auto',
    supportsDiscovery: true,
  },
  {
    id: 'magpie',
    label: 'Magpie / ChatFlows',
    hint: '使用 Magpie 的模型网关地址；模型与能力可在下一步选择。',
    kind: 'openai-compatible-text',
    baseUrlPlaceholder: 'http://127.0.0.1:3425/v1',
    capabilities: ['text'],
    thinkingLevel: 'auto',
    supportsDiscovery: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: 'OpenAI 兼容服务；填写实际 Base URL 与 API Key。',
    kind: 'openai-compatible-text',
    baseUrlPlaceholder: 'https://api.deepseek.com/v1',
    capabilities: ['text'],
    thinkingLevel: 'auto',
    supportsDiscovery: true,
  },
  {
    id: 'ollama',
    label: 'Ollama / 本地模型',
    hint: '本地 OpenAI 兼容地址，通常以 /v1 结尾。',
    kind: 'openai-compatible-text',
    baseUrlPlaceholder: 'http://127.0.0.1:11434/v1',
    capabilities: ['text'],
    thinkingLevel: 'auto',
    supportsDiscovery: true,
  },
  {
    id: 'comfyui',
    label: 'ComfyUI 本地',
    hint: '仅用于图片工作流，不填上下文或思考参数。',
    kind: 'comfyui',
    baseUrlPlaceholder: 'http://127.0.0.1:8188',
    capabilities: [],
    thinkingLevel: 'off',
    supportsDiscovery: false,
  },
  {
    id: 'worker',
    label: 'Windows Worker',
    hint: '用于本地媒体 Worker，不填聊天模型参数。',
    kind: 'worker',
    baseUrlPlaceholder: 'http://127.0.0.1:8190',
    capabilities: [],
    thinkingLevel: 'off',
    supportsDiscovery: false,
  },
];

export function providerPreset(id: string) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[0];
}
