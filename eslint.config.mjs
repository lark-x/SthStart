import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.vinext/**',
    '.wrangler/**',
    '.dsh-tmp/**',
    '.pai/**',
    '.zcode/**',
    '**/.venv/**',
    '**/*.min.js',
    'out/**',
    'build/**',
    'dist/**',
    '**/dist/**',
    'coverage/**',
    'artifacts/**',
    'data/**',
    'workers/**/data/**',
    'scratch/**',
    'test-results/**',
    'playwright-report/**',
    'temp_harness_output/**',
    'experiments/**',
    'upstream/**',
    'dsh-mcp-servers/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
