export function normalizeServiceUrl(value) {
  const parsed = new URL(value || 'http://127.0.0.1:4100');
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('STHSTART_SERVICE_URL must use http or https');
  return parsed.toString().replace(/\/+$/, '');
}

export function createLinsheHostedEnvironment(serviceUrl, appToken, { imageViaGateway = false } = {}) {
  if (!appToken?.trim()) throw new Error('missing_STHSTART_APP_TOKEN');
  const environment = {
    STHSTART_APP_TOKEN: appToken.trim(),
    STHSTART_SERVICE_URL: normalizeServiceUrl(serviceUrl),
    STHSTART_PUBLIC_LLM: 'true',
    STHSTART_PUBLIC_VECTOR: 'true',
    // Linshe renders images with its own ComfyUI by default. The SthStart image
    // gateway stays opt-in and must never be implied by the other gateways.
    STHSTART_PUBLIC_IMAGE: imageViaGateway === true ? 'true' : 'false',
    STHSTART_GENERATION_PURPOSE: 'linshe-chat-image',
  };
  return environment;
}

export function hostedReadinessFailure(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['公共服务返回了无法识别的托管状态。'];
  if (payload.ready === true) return [];
  return Array.isArray(payload.missing) && payload.missing.length
    ? payload.missing.map((item) => String(item))
    : ['公共服务报告邻舍托管配置未就绪。'];
}
