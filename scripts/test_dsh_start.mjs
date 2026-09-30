const baseUrl = 'http://127.0.0.1:4173';

async function main() {
  const sessionRes = await fetch(`${baseUrl}/api/auth/admin-session`, {
    method: 'POST',
    headers: { origin: baseUrl },
  });
  const cookieHeader = sessionRes.headers.get('set-cookie');
  let sessionCookie = '';
  if (cookieHeader) {
    const match = cookieHeader.match(/sthstart_admin_session=([^;]+)/);
    if (match) sessionCookie = match[1];
  }

  const sessionData = await sessionRes.json();
  const csrfToken = sessionData.csrfToken;
  console.log('CSRF Token 获取成功');

  // 获取第一个项目
  const projectsRes = await fetch(`${baseUrl}/api/admin/story/projects`, {
    headers: { cookie: `sthstart_admin_session=${sessionCookie}` },
  });
  const { items } = await projectsRes.json();
  const projectId = items[0].id;
  console.log('测试项目 ID:', projectId);

  // 测试 DSH 状态
  const statusRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/status`, {
    headers: { cookie: `sthstart_admin_session=${sessionCookie}` },
  });
  console.log('初始 DSH 状态:', await statusRes.json());

  // 尝试启动 DSH
  console.log('发起启动 DSH 请求...');
  const startRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/start`, {
    method: 'POST',
    headers: {
      cookie: `sthstart_admin_session=${sessionCookie}`,
      origin: baseUrl,
      'x-sthstart-csrf': csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const startData = await startRes.json();
  console.log('启动 DSH 响应:', startData);

  // 再次检查状态
  const afterStatusRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/status`, {
    headers: { cookie: `sthstart_admin_session=${sessionCookie}` },
  });
  console.log('启动后 DSH 状态:', await afterStatusRes.json());

  // 停止 DSH 守护进程
  console.log('发起停止 DSH 请求...');
  const stopRes = await fetch(`${baseUrl}/api/admin/story/projects/${projectId}/dsh/stop`, {
    method: 'POST',
    headers: {
      cookie: `sthstart_admin_session=${sessionCookie}`,
      origin: baseUrl,
      'x-sthstart-csrf': csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log('停止 DSH 响应:', await stopRes.json());
}

main().catch(console.error);
