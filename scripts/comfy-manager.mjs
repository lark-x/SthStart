import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

const COMFY_DIR = 'F:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable';
const PYTHON_PATH = resolve(COMFY_DIR, 'python_embeded\\python.exe');
const PORT = 8188;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function getListeners() {
  if (process.platform === 'win32') {
    const cmd = `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
    try {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
      return output.trim().split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }
  return [];
}

async function getStats() {
  try {
    const res = await fetch(`${BASE_URL}/system_stats`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

async function status() {
  const pids = getListeners();
  if (pids.length === 0) {
    console.log(`⚪ ComfyUI 当前未在运行（端口 ${PORT} 空闲）。`);
    return false;
  }

  console.log(`🟢 ComfyUI 正在运行中！`);
  console.log(`   - 监听端口: ${PORT} (${BASE_URL})`);
  console.log(`   - 进程 PID: ${pids.join(', ')}`);

  const stats = await getStats();
  if (stats) {
    const dev = stats.devices?.[0];
    if (dev) {
      const freeMb = ((dev.vram_free || 0) / 1024 / 1024).toFixed(0);
      const totalMb = ((dev.vram_total || 0) / 1024 / 1024).toFixed(0);
      console.log(`   - 计算设备: ${dev.name || 'GPU'}`);
      console.log(`   - 显存状态: 空闲 ${freeMb} MB / 总计 ${totalMb} MB`);
    }
    const ram = stats.system?.ram;
    if (ram) {
      console.log(`   - 系统内存: 空闲 ${(ram.free / 1024 / 1024 / 1024).toFixed(1)} GB / 总计 ${(ram.total / 1024 / 1024 / 1024).toFixed(1)} GB`);
    }
  }
  return true;
}

async function freeMemory() {
  console.log('🔄 正在向 ComfyUI 发送模型卸载与显存回收请求...');
  try {
    const res = await fetch(`${BASE_URL}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log('✨ 显存回收成功！已卸载常驻显存的模型并触发垃圾回收。');
      await status();
      return true;
    }
    console.warn(`⚠️ 响应异常状态: ${res.status}`);
  } catch (err) {
    console.log(`❌ 无法连接 ComfyUI: ${err.message}`);
  }
  return false;
}

async function stop() {
  const pids = getListeners();
  if (pids.length === 0) {
    console.log(`⚪ ComfyUI 已经处于停止状态，端口 ${PORT} 未被占用。`);
    return true;
  }

  console.log(`🛑 正在关闭 ComfyUI (PID: ${pids.join(', ')})...`);

  // 1. 尝试优雅释放显存与模型
  try {
    await fetch(`${BASE_URL}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}

  // 2. 终止进程树
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {}
  }

  // 3. 等待端口完全释放
  let retries = 10;
  while (retries-- > 0) {
    await new Promise((r) => setTimeout(r, 400));
    const remaining = getListeners();
    if (remaining.length === 0) {
      console.log(`✅ ComfyUI 已安全停止，端口 ${PORT} 与 GPU 显存已完全释放！`);
      return true;
    }
  }

  console.warn(`⚠️ 端口可能仍在等待释放，请稍后再查。`);
  return false;
}

async function start() {
  const pids = getListeners();
  if (pids.length > 0) {
    console.log(`⚠️ ComfyUI 已在运行中 (PID: ${pids.join(', ')})，请勿重复启动。`);
    await status();
    return true;
  }

  if (!existsSync(PYTHON_PATH)) {
    console.error(`❌ 未找到便携版 Python 解释器: ${PYTHON_PATH}`);
    process.exit(1);
  }

  console.log(`🚀 正在启动 ComfyUI (独立便携版，RTX 加速模式)...`);

  const logsDir = resolve(process.cwd(), 'data/logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  const logFile = resolve(logsDir, 'comfyui.log');
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const args = [
    '-s',
    'ComfyUI\\main.py',
    '--windows-standalone-build',
    '--fast',
    'fp16_accumulation',
    '--port',
    String(PORT),
    '--listen',
    '127.0.0.1',
  ];

  const child = spawn(PYTHON_PATH, args, {
    cwd: COMFY_DIR,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: false,
  });

  child.unref();
  console.log(`⏳ 进程已拉起 (PID: ${child.pid})，正在等待服务就绪... (日志输出至 data/logs/comfyui.log)`);

  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < 90000) {
    await new Promise((r) => setTimeout(r, 1000));
    const stats = await getStats();
    if (stats) {
      ready = true;
      break;
    }
  }

  if (ready) {
    console.log(`\n🎉 ComfyUI 启动成功！`);
    console.log(`🌐 访问地址: ${BASE_URL}`);
    await status();
    return true;
  } else {
    console.warn(`⚠️ 90 秒内未检测到 HTTP 就绪，请检查日志: ${logFile}`);
    return false;
  }
}

async function restart() {
  console.log('🔄 正在重启 ComfyUI...');
  await stop();
  await new Promise((r) => setTimeout(r, 1500));
  await start();
}

const action = process.argv[2] || 'status';

switch (action) {
  case 'start':
    await start();
    break;
  case 'stop':
    await stop();
    break;
  case 'restart':
    await restart();
    break;
  case 'status':
    await status();
    break;
  case 'free':
    await freeMemory();
    break;
  default:
    console.log(`用法: node scripts/comfy-manager.mjs [start|stop|restart|status|free]`);
    break;
}
