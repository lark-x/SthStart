import { createHash, randomBytes } from 'node:crypto';
import { BackupProviderError } from './types.js';

/**
 * 本地公共客户端的 OAuth 辅助：使用 PKCE，不在代码或日志里硬编码任何真实凭据。
 * 每个平台的授权端点与 scope 分开配置，都不共用一套写死参数。
 */
export interface OAuthEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

/**
 * base64url 编码。本仓库同时被两套 tsconfig 编译，全局 Buffer 的类型解析不一致，
 * 这里统一收口，避免依赖 Buffer 实例方法的类型推断。
 */
function toBase64Url(bytes: Uint8Array): string {
  return (bytes as unknown as { toString(encoding: string): string }).toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(48));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return toBase64Url(randomBytes(24));
}

/** Google 要求 code_challenge_method=S256；Microsoft 支持同一参数。 */
export function buildAuthorizationUrl(endpoints: OAuthEndpoints, input: {
  clientId: string;
  state: string;
  codeChallenge: string;
  extra?: Record<string, string>;
}): string {
  const url = new URL(endpoints.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', endpoints.redirectUri);
  url.searchParams.set('scope', endpoints.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(input.extra ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}

export async function exchangeAuthorizationCode(endpoints: OAuthEndpoints, input: {
  fetcher: typeof fetch;
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: endpoints.redirectUri,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  return requestToken(input.fetcher, endpoints.tokenUrl, body);
}

export async function refreshAccessToken(endpoints: Pick<OAuthEndpoints, 'tokenUrl'>, input: {
  fetcher: typeof fetch;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  return requestToken(input.fetcher, endpoints.tokenUrl, body);
}

async function requestToken(fetcher: typeof fetch, tokenUrl: string, body: URLSearchParams): Promise<TokenSet> {
  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    // 不把响应正文原样写进日志或界面：只给出可理解的原因。
    if (response.status === 400 || response.status === 401) throw new BackupProviderError('backup_auth_expired', '网盘授权已失效，需要重新连接该目标。', false);
    throw new BackupProviderError('backup_network', '换取访问令牌失败（HTTP ' + response.status + '）。', true);
  }
  const payload = await response.json() as Record<string, unknown>;
  const accessToken = String(payload.access_token ?? '');
  if (!accessToken) throw new BackupProviderError('backup_auth_expired', '网盘授权响应缺少访问令牌。', false);
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken,
    ...(payload.refresh_token ? { refreshToken: String(payload.refresh_token) } : {}),
    expiresAt: Date.now() + Math.max(expiresIn - 60, 30) * 1_000,
    ...(payload.scope ? { scope: String(payload.scope) } : {}),
    ...(payload.token_type ? { tokenType: String(payload.token_type) } : {}),
  };
}
