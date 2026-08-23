import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(import.meta.dirname, '..');
const vectorRoot = resolve(root, 'upstream/linshe/vector-service');
const venvRoot = resolve(vectorRoot, 'venv');
const systemCandidates = process.platform === 'win32'
  ? ['python', 'py']
  : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'];
const supportsProject = (candidate) => spawnSync(candidate, [
  '-c',
  'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)',
], { stdio: 'ignore' }).status === 0;
const systemPython = systemCandidates.find(supportsProject);

if (!systemPython) {
  console.error('需要 Python 3.10+ 才能初始化向量服务。');
  process.exit(1);
}

function run(command, args, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd: vectorRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runRequired(command, args, extraEnvironment) {
  const status = run(command, args, extraEnvironment);
  if (status !== 0) process.exit(status);
}

const modelFiles = [
  'onnx/model_int8.onnx',
  'tokenizer.json',
  'vocab.json',
  'merges.txt',
  'config.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
];
const modelRoot = resolve(vectorRoot, 'models/jina-embeddings-v2-base-zh');

function hasFile(path) {
  return existsSync(path) && statSync(path).size > 0;
}

async function downloadModelFiles(endpoint) {
  console.warn('上游下载器未完成，改用主项目的直接下载后备方案。');
  for (const relativePath of modelFiles) {
    const destination = resolve(modelRoot, relativePath);
    if (hasFile(destination)) {
      console.log(`[已存在] ${relativePath}`);
      continue;
    }

    mkdirSync(resolve(destination, '..'), { recursive: true });
    const temporary = `${destination}.part`;
    if (existsSync(temporary)) unlinkSync(temporary);
    const url = `${endpoint}/Xenova/jina-embeddings-v2-base-zh/resolve/main/${relativePath}`;
    console.log(`[下载] ${relativePath}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`模型文件下载失败（HTTP ${response.status}）：${relativePath}`);
    }

    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      renameSync(temporary, destination);
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }

  const missing = modelFiles.filter((relativePath) => !hasFile(resolve(modelRoot, relativePath)));
  if (missing.length > 0) throw new Error(`模型文件不完整：${missing.join(', ')}`);
}

let python = process.platform === 'win32'
  ? resolve(venvRoot, 'Scripts/python.exe')
  : resolve(venvRoot, 'bin/python');
if (existsSync(python) && !supportsProject(python)) {
  const backup = `${venvRoot}-incompatible-${Date.now()}`;
  renameSync(venvRoot, backup);
  console.warn(`已将不兼容的旧虚拟环境移动到 ${backup}`);
}
if (!existsSync(venvRoot)) runRequired(systemPython, ['-m', 'venv', 'venv']);
python = process.platform === 'win32'
  ? resolve(venvRoot, 'Scripts/python.exe')
  : resolve(venvRoot, 'bin/python');

runRequired(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
runRequired(python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
const huggingFaceEndpoint = process.env.HF_ENDPOINT ?? 'https://huggingface.co';
const upstreamStatus = run(python, ['download_model.py'], { HF_ENDPOINT: huggingFaceEndpoint });
if (upstreamStatus !== 0) await downloadModelFiles(huggingFaceEndpoint);
console.log('邻舍向量服务与 Jina 模型已准备完成。');
