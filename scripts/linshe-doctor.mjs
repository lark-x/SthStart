import { resolve } from 'node:path';
import { resolveLinsheEnvironment } from './linshe-env.mjs';

const root = resolve(import.meta.dirname, '..');
const environment = resolveLinsheEnvironment(root);
const line = (ok, label) => console.log(`${ok ? '✓' : '✗'} ${label}`);

console.log(`邻舍环境检查${environment.version ? `（v${environment.version}）` : ''}`);
line(environment.agentReady, 'Node 后端依赖');
line(environment.webReady, 'Web 前端依赖');
line(environment.python !== null, `Python 3.10+${environment.python ? `：${environment.python}` : ''}`);
line(environment.vectorDependenciesReady, '向量服务 Python 依赖');
line(environment.vectorModelReady, 'Jina 向量模型');

if (!environment.vectorReady) {
  console.log('提示：门户、聊天和多数邻舍功能仍可启动；长期向量记忆会降级。');
  console.log('如需完整向量能力，请运行 npm run setup:vector。');
}

if (!environment.agentReady || !environment.webReady) {
  console.error('邻舍核心依赖未准备好，请先运行 npm run setup。');
  process.exitCode = 1;
}
