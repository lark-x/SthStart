const serviceUrl = (process.env.STHSTART_SERVICE_URL ?? process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');

export async function GET() {
  try {
    const response = await fetch(`${serviceUrl}/api/v1/apps/linshe`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'cache-control': 'no-store',
        'content-type': response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    return Response.json({ error: 'service_unavailable', message: '公共服务当前不可用。' }, { status: 503 });
  }
}
