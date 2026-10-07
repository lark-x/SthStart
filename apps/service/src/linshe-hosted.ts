import type { LinsheHostedReadiness } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { resolveWorkflowAndEngine } from './generation/task-store.js';
import { resolveAppLlmBindingStatus } from './llm-status.js';
import { resolveProfile } from './providers.js';
import { hashToken } from './security.js';
import type { SecretStore } from './security.js';

const IMAGE_PURPOSE = 'linshe-chat-image' as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasBoundPositivePrompt(inputSchema: Record<string, unknown>, nodeBindings: Record<string, string[]>) {
  return Object.entries(inputSchema).some(([key, raw]) => {
    const entry = object(raw);
    const semantic = String(entry.semantic ?? '').toLowerCase();
    const normalized = key.toLowerCase().replaceAll('_', '');
    const isPrompt = semantic === 'prompt' || normalized === 'prompt' || normalized === 'positiveprompt';
    const binding = nodeBindings[key];
    return isPrompt && Array.isArray(binding) && binding.length === 3 && binding[1] === 'inputs';
  });
}

async function localVectorHealthy(url: string, fetcher: typeof fetch) {
  try {
    const parsed = new URL(url);
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return true;
    const response = await fetcher(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function inspectLinsheHostedReadiness(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  token: string | null | undefined,
  fetcher: typeof fetch = fetch,
  // Linshe generates images with its own ComfyUI unless the project is
  // explicitly configured to route them through the SthStart gateway.
  imageViaGateway = false,
): Promise<LinsheHostedReadiness> {
  const missing: string[] = [];
  const app = database.connection.prepare('SELECT token_hash,capabilities_json FROM managed_apps WHERE id=? AND enabled=1')
    .get('linshe') as { token_hash: string; capabilities_json: string } | undefined;
  let capabilities: string[] = [];
  try { capabilities = JSON.parse(app?.capabilities_json ?? '[]') as string[]; } catch { /* invalid stored value */ }
  const appTokenValid = Boolean(app && token?.trim() && hashToken(token.trim()) === app.token_hash);
  if (!appTokenValid) missing.push('邻舍应用令牌未配置或与公共服务中的邻舍身份不匹配；请同步 STHSTART_APP_TOKEN。');
  const requiredCapabilities = ['llm', 'vector', 'image', 'generation'];
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  if (missingCapabilities.length) missing.push(`邻舍应用缺少托管能力：${missingCapabilities.join('、')}；请在公共服务应用设置中启用。`);

  const [textStatus, multimodalStatus, vectorProfile] = await Promise.all([
    resolveAppLlmBindingStatus(database, secrets, 'linshe', 'text'),
    resolveAppLlmBindingStatus(database, secrets, 'linshe', 'multimodal'),
    resolveProfile(database, secrets, 'vector'),
  ]);
  if (!textStatus.ready) missing.push(`邻舍文本模型未就绪：${textStatus.message ?? '请配置公共模型路由。'}`);
  if (!multimodalStatus.ready) missing.push(`邻舍多模态模型未就绪：${multimodalStatus.message ?? '请配置公共模型路由。'}`);

  const vectorMode: LinsheHostedReadiness['vectorMode'] = vectorProfile ? 'profile' : config.vectorDefaultUrl ? 'default' : 'unavailable';
  const vectorReady = vectorProfile ? Boolean(vectorProfile.baseUrl) : vectorMode === 'default' && await localVectorHealthy(config.vectorDefaultUrl, fetcher);
  if (!vectorReady) missing.push('邻舍向量服务未就绪；请配置公共向量模型，或安装并启动项目向量服务（npm run setup:vector）。');

  let imageWorkflowId: string | null = null;
  let imageWorkflowVersion: number | null = null;
  // When image hosting is off the Linshe agent talks to its own ComfyUI, so the
  // binding is neither required nor reported as missing. The resolution code is
  // kept dormant so re-enabling the switch restores the full check.
  let imageReady = !imageViaGateway;
  if (imageViaGateway) {
    imageReady = false;
    try {
      const resolved = resolveWorkflowAndEngine(database, 'linshe', { purpose: IMAGE_PURPOSE });
      imageWorkflowId = resolved.workflow.id;
      imageWorkflowVersion = resolved.workflow.version;
      const category = resolved.workflow.category.toLowerCase();
      const imageOutput = resolved.workflow.outputMediaTypes.some((mediaType) => mediaType === 'image' || mediaType.toLowerCase().startsWith('image/'));
      const positivePrompt = hasBoundPositivePrompt(resolved.workflow.inputSchema, resolved.workflow.nodeBindings);
      imageReady = category.includes('image') && imageOutput && positivePrompt;
      if (!imageReady) {
        missing.push(`用途 ${IMAGE_PURPOSE} 的工作流必须是已发布的图片工作流，声明图片输出并绑定正向提示词输入；请在生成配置中修复。`);
      }
    } catch {
      missing.push(`未为邻舍绑定用途 ${IMAGE_PURPOSE} 的已发布图片工作流；请在生成配置中完成绑定。`);
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    appTokenValid,
    llmTextReady: textStatus.ready,
    llmMultimodalReady: multimodalStatus.ready,
    vectorReady,
    vectorMode,
    imageReady,
    imagePurpose: IMAGE_PURPOSE,
    imageWorkflowId,
    imageWorkflowVersion,
  };
}
