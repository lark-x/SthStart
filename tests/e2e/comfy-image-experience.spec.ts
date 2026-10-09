import { test, expect, type Page } from '@playwright/test';
import type { CreativePurposeOptions, CreativeTaskResponse, ImageConfiguration } from '@sthstart/contracts';

const fields: ImageConfiguration['fields'] = [
  { key: 'prompt', label: '正面提示词', description: null, type: 'long-text', section: 'basic', order: 0, defaultValue: '', required: true },
  { key: 'negativePrompt', label: '负面提示词', description: null, type: 'long-text', section: 'advanced', order: 1, defaultValue: 'blurry', required: false },
  { key: 'width', label: '宽度', description: null, type: 'integer', section: 'advanced', order: 2, defaultValue: 768, minimum: 256, maximum: 2048, step: 8, required: false },
  { key: 'height', label: '高度', description: null, type: 'integer', section: 'advanced', order: 3, defaultValue: 512, minimum: 256, maximum: 2048, step: 8, required: false },
  { key: 'steps', label: '步数', description: '更多步数会增加生成耗时。', type: 'integer', section: 'advanced', order: 4, defaultValue: 31, minimum: 1, maximum: 60, required: false },
  { key: 'seed', label: '种子', description: '留空使用随机种子。', type: 'seed', section: 'advanced', order: 5, defaultValue: null, minimum: 0, maximum: 2147483647, required: false },
  { key: 'unet', label: '扩散模型', description: null, type: 'model', section: 'advanced', order: 6, defaultValue: 'anima_base.safetensors', required: false, modelEditable: false },
];
const configuration: ImageConfiguration = { configurationHash: 'a'.repeat(64), outputFormat: 'prose', fields,
  sizePresets: [{ label: '标准横图', width: 768, height: 512 }, { label: '清晰横图', width: 1024, height: 768 }],
  promptMode: 'service-finalized-v1', promptKey: 'prompt', negativePromptKey: 'negativePrompt', modelChoices: [], modelChoicesStale: false, warnings: [] };
const options: CreativePurposeOptions = { purpose: 'text-to-image', ready: true, status: 'ready',
  workflow: { id: 'flow', name: 'Anima', version: 1 }, engine: { id: 'engine', name: 'ComfyUI', kind: 'comfyui', enabled: true },
  defaultPresetId: 'base', fields, modelChoices: [], configuration,
  presets: [{ id: 'base', name: 'Base · 细节优先', description: '适合正式插图，使用完整模型与采样配置。', revision: 1, isDefault: true,
    workflowId: 'flow', workflowName: 'Anima', workflowVersion: 1, modelSummary: 'anima_base', values: { steps: 31 }, configuration },
  { id: 'turbo', name: 'Turbo · 快速试稿', description: '适合构图探索。', revision: 1, isDefault: false, workflowId: 'turbo-flow',
    workflowName: 'Anima Turbo', workflowVersion: 1, modelSummary: 'anima_turbo', values: { steps: 12 },
    configuration: { ...configuration, configurationHash: 'b'.repeat(64), fields: fields.map(field => field.key === 'steps' ? { ...field, defaultValue: 12, maximum: 20 } : field) } }],
};

async function mock(page: Page, failAI = false, purposeOptions = options) {
  const preparations: Array<Record<string, unknown>> = [];
  const submissions: Array<Record<string, unknown>> = [];
  const tasks: CreativeTaskResponse[] = [];
  await page.route('**/api/auth/admin-session', route => route.fulfill({ json: { csrfToken: 'offline-csrf' } }));
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/creative/options')) return route.fulfill({ json: { app: { id: 'creative-center', name: '创作中心' }, purposes: [purposeOptions] } });
    if (path.endsWith('/creative/status')) return route.fulfill({ json: { app: { id: 'creative-center', name: '创作中心' }, modes: Object.fromEntries([
      ['textToImage', 'text-to-image'], ['imageToImage', 'image-to-image'], ['h3T2v', 'h3-t2v'], ['h3I2v', 'h3-i2v'], ['h3Fl2va', 'h3-fl2va'],
    ].map(([key, purpose]) => [key, { purpose, ready: !purpose.startsWith('h3-'), status: 'ready', workflow: options.workflow, engine: options.engine }])) } });
    if (path.endsWith('/creative/artifacts')) return route.fulfill({ json: { items: [], total: 0 } });
    if (path.endsWith('/generation/image/prepare')) {
      const request = route.request().postDataJSON(); preparations.push(request);
      if (failAI && request.ai) return route.fulfill({ status: 409, json: { error: 'prompt_optimizer_not_configured', message: '当前应用未配置文本模型，请关闭 AI 后继续。' } });
      const prompt = request.ai ? 'one girl reading by a window' : request.description;
      return route.fulfill({ json: { originalDescription: request.description, positivePrompt: prompt,
        negativePrompt: request.parameters.negativePrompt ?? null, parameters: { ...request.parameters, prompt },
        configurationHash: request.presetId === 'turbo' ? 'b'.repeat(64) : configuration.configurationHash,
        promptMode: 'service-finalized-v1', optimizerCallId: request.ai ? 'call-1' : null, warnings: [] } });
    }
    if (path.endsWith('/creative/tasks')) {
      if (route.request().method() === 'POST') {
        const request = route.request().postDataJSON(); submissions.push(request);
        const task: CreativeTaskResponse = { id: `task-${submissions.length}`, appId: 'creative-center', engineId: 'engine', workflowId: 'flow', workflowVersion: 1,
          purpose: 'text-to-image', idempotencyKey: request.idempotencyKey, status: 'queued', actualSeed: 12, providerTaskId: null,
          errorCode: null, errorMessage: null, upstreamMayContinue: false, cancellationScope: 'none', retryOf: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: null, artifacts: [],
          replay: { mode: 'text-to-image', inputs: request.parameters, inputArtifactIds: [], presetId: request.presetId } };
        tasks.unshift(task); return route.fulfill({ status: 202, json: task });
      }
      return route.fulfill({ json: { items: tasks } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  return { preparations, submissions };
}

test('simple/advanced modes preserve drafts and manual final prompts bypass AI', async ({ page }, info) => {
  const requests = await mock(page);
  await page.goto('/apps/creative');
  await page.getByLabel('描述你的画面').fill('一个女孩在窗边读书');
  await expect(page.getByLabel('步数', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: '高级模式', exact: true }).click();
  await page.getByLabel('步数', { exact: true }).fill('25');
  await page.getByLabel('正面提示词', { exact: true }).fill('(red hair:1.2), reading by a window');
  await page.getByLabel('负面提示词', { exact: true }).fill('');
  await page.getByRole('button', { name: '简单模式', exact: true }).click();
  await expect(page.getByText('已自定义 1 项高级参数', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop-simple.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect.poll(() => requests.submissions.length).toBe(1);
  expect(requests.preparations[0].ai).toBe(false);
  expect(requests.submissions[0].parameters).toMatchObject({ prompt: '(red hair:1.2), reading by a window', negativePrompt: '', steps: 25 });
  await page.reload();
  await expect(page.getByLabel('描述你的画面')).toHaveValue('一个女孩在窗边读书');
});

test('mobile retains configuration across tabs and AI failure can recover without losing input', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const requests = await mock(page, true);
  await page.goto('/apps/creative');
  const description = '夜晚窗边的少女，保持角色服装，远处是城市灯光。'.repeat(15);
  await page.getByLabel('描述你的画面').fill(description);
  await page.getByRole('button', { name: '结果', exact: true }).click();
  await expect(page.getByRole('heading', { name: '图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.getByLabel('描述你的画面')).toHaveValue(description);
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.getByText('本次生成未完成')).toBeVisible();
  await expect(page.getByLabel('描述你的画面')).toHaveValue(description);
  await page.screenshot({ path: info.outputPath('mobile-failure.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭 AI 后继续编辑' }).click();
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect.poll(() => requests.submissions.length).toBe(1);
  expect(requests.submissions[0].parameters).toMatchObject({ prompt: description });
});

test('switching a workflow uses its own parameter bounds and confirms edited overrides', async ({ page }, info) => {
  await mock(page);
  await page.goto('/apps/creative');
  await page.getByRole('button', { name: '高级模式', exact: true }).click();
  await page.getByLabel('步数', { exact: true }).fill('28');
  await page.getByLabel('工作流', { exact: true }).selectOption('turbo-flow');
  await expect(page.getByRole('dialog', { name: '切换生成方案' })).toBeVisible();
  await page.getByRole('button', { name: '应用新方案' }).click();
  await expect(page.getByLabel('步数', { exact: true })).toHaveValue('12');
  await expect(page.getByLabel('步数', { exact: true })).toHaveAttribute('max', '20');
  await page.screenshot({ path: info.outputPath('desktop-advanced.png'), fullPage: true, animations: 'disabled' });
});


test('a direct workflow binding is retained when no default preset was selected', async ({ page }) => {
  await mock(page, false, { ...options, defaultPresetId: null,
    configuration: { ...configuration, fields: fields.map(field => field.key === 'steps' ? { ...field, defaultValue: 17 } : field) } });
  await page.goto('/apps/creative');
  await expect(page.getByLabel('描述你的画面')).toBeEnabled();
  await expect(page.getByLabel('生成方案', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '高级模式', exact: true }).click();
  await expect(page.getByLabel('步数', { exact: true })).toHaveValue('17');
});

test('a changed configuration requires review and restores its own defaults', async ({ page }) => {
  await mock(page);
  await page.goto('/apps/creative');
  await page.getByLabel('描述你的画面').fill('窗边读书的女孩');
  await page.getByRole('button', { name: '高级模式', exact: true }).click();
  await page.getByRole('button', { name: '准备提示词', exact: true }).click();
  await expect(page.getByLabel('正面提示词', { exact: true })).toHaveValue('one girl reading by a window');
  const updated = { ...configuration, configurationHash: 'c'.repeat(64), fields: fields.map(field => field.key === 'steps' ? { ...field, defaultValue: 19 } : field) };
  await page.route('**/api/admin/creative/options', route => route.fulfill({ json: {
    app: { id: 'creative-center', name: '创作中心' }, purposes: [{ ...options, configuration: updated,
      presets: options.presets.map(preset => preset.id === 'base' ? { ...preset, revision: 2, configuration: updated } : preset) }],
  } }));
  await page.getByRole('button', { name: '刷新', exact: true }).first().click();
  await expect(page.getByText('生成配置已更新', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '采用新配置，保留提示词', exact: true }).click();
  await expect(page.getByLabel('步数', { exact: true })).toHaveValue('19');
  await expect(page.getByLabel('正面提示词', { exact: true })).toHaveValue('one girl reading by a window');
  await expect(page.getByLabel('描述你的画面')).toHaveValue('窗边读书的女孩');
});
