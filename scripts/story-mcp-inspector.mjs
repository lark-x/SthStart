#!/usr/bin/env node

/**
 * SthStart Story MCP Inspector 启动助手
 * 用于启动 Anthropic 官方 @modelcontextprotocol/inspector 进行可视化交互调试
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const portalUrl = process.env.STHSTART_STORY_PORTAL_URL || 'http://127.0.0.1:4173';
const serviceUrl = process.env.STHSTART_SERVICE_URL || 'http://127.0.0.1:4100';

async function main() {
  console.log('='.repeat(64));
  console.log('  SthStart Story MCP Inspector (官方可视化交互调试面板)');
  console.log('='.repeat(64));

  let projectId = process.env.STHSTART_STORY_PROJECT_ID;
  let token = process.env.STHSTART_STORY_BRIDGE_TOKEN;

  // 如果未指定项目 ID，从后端自动查询第一个项目
  if (!projectId) {
    try {
      const res = await fetch(`${serviceUrl}/api/v1/admin/story/projects`);
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          projectId = data.items[0].id;
          console.log(`[Inspector] 自动发现活跃项目: ${data.items[0].title} (${projectId})`);
        }
      }
    } catch {
      // 无法自动读取时提示
    }
  }

  if (!projectId) {
    console.error('[Error] 未找到可用的小说项目。请先通过 Web 界面创建项目，或设置环境变量 STHSTART_STORY_PROJECT_ID。');
    process.exit(1);
  }

  // 如果未指定 Token，通过服务接口自动申请一个临时 Grant Token
  if (!token) {
    try {
      const res = await fetch(`${serviceUrl}/api/v1/admin/story/projects/${encodeURIComponent(projectId)}/bridge-grant`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        token = data.token;
        console.log(`[Inspector] 自动生成 Bridge 访问令牌: ${token.slice(0, 8)}...`);
      }
    } catch (e) {
      console.warn('[Inspector] 无法自动生成令牌，将尝试空令牌启动。', e);
    }
  }

  if (!token) {
    console.error('[Error] 缺少 Bridge 访问令牌。请先在工作台中点击「AI 协作 (MCP)」生成令牌。');
    process.exit(1);
  }

  console.log(`[Inspector] 目标网关: ${portalUrl}`);
  console.log(`[Inspector] 目标项目 ID: ${projectId}`);
  console.log(`[Inspector] 正在启动 @modelcontextprotocol/inspector ...`);
  console.log(`[Inspector] 提示：启动成功后，浏览器将自动弹出交互调试控制台。`);
  console.log('-'.repeat(64));

  const serverScript = path.join(rootDir, 'apps', 'service', 'src', 'story', 'native-mcp-server.ts');
  const env = {
    ...process.env,
    STHSTART_STORY_PORTAL_URL: portalUrl,
    STHSTART_STORY_PROJECT_ID: projectId,
    STHSTART_STORY_BRIDGE_TOKEN: token,
  };

  // 使用 npx 启动 @modelcontextprotocol/inspector
  const child = spawn(
    'npx',
    [
      '-y',
      '@modelcontextprotocol/inspector',
      process.execPath,
      '--import',
      'tsx/esm',
      serverScript,
    ],
    {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    }
  );

  child.on('error', (err) => {
    console.error('[Inspector Error]', err);
  });

  child.on('exit', (code, signal) => {
    console.log(`[Inspector] 进程退出，状态码: ${code}, 信号: ${signal}`);
  });
}

main().catch((err) => {
  console.error('[Inspector Fatal Error]', err);
  process.exit(1);
});
