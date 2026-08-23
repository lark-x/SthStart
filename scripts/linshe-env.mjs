import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveLinsheEnvironment(root) {
  const linsheRoot = resolve(root, 'upstream/linshe');
  const agentRoot = resolve(linsheRoot, 'agent-core');
  const webRoot = resolve(linsheRoot, 'web-ui');
  const vectorRoot = resolve(linsheRoot, 'vector-service');
  const venvPython = process.platform === 'win32'
    ? resolve(vectorRoot, 'venv/Scripts/python.exe')
    : resolve(vectorRoot, 'venv/bin/python');
  const pythonCandidates = [
    venvPython,
    ...(process.platform === 'win32'
      ? ['python', 'py']
      : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python']),
  ];
  const python = pythonCandidates.find((candidate) => {
    if (candidate.includes('/') && !existsSync(candidate)) return false;
    const result = spawnSync(candidate, [
      '-c',
      'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)',
    ], { stdio: 'ignore' });
    return result.status === 0;
  }) ?? null;

  const checkNodeModule = (cwd, expression) => spawnSync(process.execPath, ['-e', expression], {
    cwd,
    stdio: 'ignore',
  }).status === 0;

  let vectorDependenciesReady = false;
  if (python !== null) {
    const importCheckRoot = mkdtempSync(join(tmpdir(), 'sthstart-vector-check-'));
    try {
      vectorDependenciesReady = spawnSync(python, [
        '-c',
        'import fastapi, uvicorn, chromadb, onnxruntime, transformers',
      ], { cwd: importCheckRoot, stdio: 'ignore' }).status === 0;
    } finally {
      rmSync(importCheckRoot, { recursive: true, force: true });
    }
  }
  const vectorModelReady = [
    'models/jina-embeddings-v2-base-zh/onnx/model_int8.onnx',
    'models/jina-embeddings-v2-base-zh/tokenizer.json',
    'models/jina-embeddings-v2-base-zh/config.json',
  ].every((relativePath) => existsSync(resolve(vectorRoot, relativePath)));

  let version = null;
  try {
    version = readFileSync(resolve(linsheRoot, 'VERSION'), 'utf8').trim() || null;
  } catch {
    // An uninitialized submodule is reported by the manifest checks below.
  }

  return {
    linsheRoot,
    agentRoot,
    webRoot,
    vectorRoot,
    python,
    version,
    agentReady:
      existsSync(resolve(agentRoot, 'package.json')) &&
      checkNodeModule(agentRoot, "import('better-sqlite3').then(({default:Database})=>{const db=new Database(':memory:');db.close()})"),
    webReady:
      existsSync(resolve(webRoot, 'package.json')) &&
      checkNodeModule(webRoot, "import('vite')"),
    vectorDependenciesReady,
    vectorModelReady,
    vectorReady: vectorDependenciesReady && vectorModelReady,
  };
}
