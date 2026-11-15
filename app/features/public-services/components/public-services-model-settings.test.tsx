import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import type {
  LlmModelCapability,
  ManagedApp,
  ModelProfile,
  ModelRoute,
  ModelRouteScope,
  ServiceConnection,
} from '@sthstart/contracts';
import { AppExceptionsSummary } from './app-exceptions-summary';
import {
  buildAppExceptionRows,
  buildAppRouteSave,
  buildPublicRouteSaves,
  buildPublicServicesSearch,
  generateInternalId,
  groupModelsByConnection,
  groupModelsBySupplier,
  modelParameterSummary,
  normalizeFallbackIds,
  selectConnectionForModelType,
  supplierModelTypeLabel,
  modelsForCapability,
  parsePublicServicesLocation,
  summarizeAppExceptions,
  type CommonModelFormState,
} from './public-services-model-settings';

const NOW = '2026-11-15T00:00:00.000Z';

function profile(
  id: string,
  capabilities: LlmModelCapability[],
  overrides: Partial<ModelProfile> = {},
): ModelProfile {
  return {
    id,
    connectionId: 'conn-main',
    name: id.toUpperCase(),
    modelId: `${id}-model`,
    capabilities,
    contextLength: 128000,
    maxOutputTokens: 8192,
    defaultParams: {},
    advancedJson: {},
    testStatus: 'untested',
    lastTestedAt: null,
    thinkingLevel: 'auto',
    timeoutMs: null,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function route(
  scope: ModelRouteScope,
  capability: LlmModelCapability,
  primaryModelId: string,
  fallbackModelIds: string[] = [],
  appId: string | null = null,
): ModelRoute {
  return {
    id: `route:${scope}:${appId ?? ''}:${capability}`,
    scope,
    appId,
    capability,
    primaryModelId,
    fallbackModelIds,
    inheritPublicFallbacks: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function app(id: string, name = id, capabilities: ManagedApp['capabilities'] = ['llm']): ManagedApp {
  return {
    id,
    name,
    enabled: true,
    capabilities,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test('old public-service URLs map to the two new tabs', () => {
  assert.deepEqual(parsePublicServicesLocation('?tab=connections'), {
    tab: 'models',
    openAppExceptions: false,
    highlightAppId: null,
    redirectTo: null,
  });
  assert.equal(parsePublicServicesLocation('?tab=text-models').tab, 'models');

  assert.deepEqual(parsePublicServicesLocation('?tab=purposes&app=writer'), {
    tab: 'models',
    openAppExceptions: true,
    highlightAppId: 'writer',
    redirectTo: null,
  });
  assert.deepEqual(parsePublicServicesLocation('', '#app-model-routing'), {
    tab: 'models',
    openAppExceptions: true,
    highlightAppId: null,
    redirectTo: null,
  });

  assert.deepEqual(parsePublicServicesLocation('?tab=image-models'), {
    tab: 'models',
    openAppExceptions: false,
    highlightAppId: null,
    redirectTo: '/settings/generation',
  });

  assert.equal(parsePublicServicesLocation('?tab=other').tab, 'extensions');
  assert.equal(parsePublicServicesLocation('?section=access').tab, 'extensions');
  assert.equal(parsePublicServicesLocation('?section=models').tab, 'models');
  assert.equal(buildPublicServicesSearch('extensions'), 'tab=extensions');
  assert.equal(
    buildPublicServicesSearch('models', { openAppExceptions: true, appId: 'writer' }),
    'apps=1&app=writer',
  );
});

test('fallback chain removes the primary, duplicates and keeps at most two', () => {
  assert.deepEqual(
    normalizeFallbackIds('primary', ['first', 'first', 'primary', '', 'second', 'third']),
    ['first', 'second'],
  );
  assert.deepEqual(normalizeFallbackIds('primary', ['only']), ['only']);
});

test('common route saves inherit vision from a multimodal text primary', () => {
  const textPrimary = profile('text-vision', ['text', 'multimodal']);
  const textFallback = profile('text-vision-backup', ['text', 'multimodal']);
  const textOnlyFallback = profile('text-only-backup', ['text']);
  const separateVision = profile('vision', ['multimodal']);
  const form: CommonModelFormState = {
    textPrimaryId: textPrimary.id,
    textFallbackIds: [textFallback.id, textOnlyFallback.id],
    visionPrimaryId: separateVision.id,
    visionFallbackIds: ['', ''],
  };

  const planned = buildPublicRouteSaves(form, [
    textPrimary,
    textFallback,
    textOnlyFallback,
    separateVision,
  ]);
  assert.equal(planned.error, null);
  assert.equal(planned.visionMirrorsText, true);
  assert.equal(planned.routes.length, 2);
  assert.deepEqual(planned.routes[0], {
    scope: 'public',
    capability: 'text',
    primaryModelId: textPrimary.id,
    fallbackModelIds: [textFallback.id, textOnlyFallback.id],
    inheritPublicFallbacks: false,
  });
  assert.deepEqual(planned.routes[1], {
    scope: 'public',
    capability: 'multimodal',
    primaryModelId: textPrimary.id,
    fallbackModelIds: [textFallback.id],
    inheritPublicFallbacks: false,
  });
});

test('text-only common route requires and saves a separate multimodal chain', () => {
  const textPrimary = profile('text', ['text']);
  const textFallback = profile('text-backup', ['text']);
  const visionPrimary = profile('vision', ['multimodal']);
  const visionFallback = profile('vision-backup', ['multimodal']);
  const form: CommonModelFormState = {
    textPrimaryId: textPrimary.id,
    textFallbackIds: [textFallback.id, textFallback.id],
    visionPrimaryId: visionPrimary.id,
    visionFallbackIds: [visionFallback.id, visionFallback.id],
  };

  const planned = buildPublicRouteSaves(form, [
    textPrimary,
    textFallback,
    visionPrimary,
    visionFallback,
  ]);
  assert.equal(planned.error, null);
  assert.equal(planned.visionMirrorsText, false);
  assert.deepEqual(
    planned.routes.map((item) => [item.capability, item.primaryModelId, item.fallbackModelIds]),
    [
      ['text', 'text', ['text-backup']],
      ['multimodal', 'vision', ['vision-backup']],
    ],
  );

  const missingVision = buildPublicRouteSaves(
    { ...form, visionPrimaryId: '' },
    [textPrimary, textFallback, visionPrimary, visionFallback],
  );
  assert.match(missingVision.error ?? '', /看图模型/);
});

test('application exceptions distinguish inherited and custom capabilities', () => {
  const apps = [app('writer', '写作应用'), app('reader', '阅读应用'), app('vector-only', '仅向量', [])];
  const rows = buildAppExceptionRows(apps, [
    route('app', 'text', 'custom-text', [], 'writer'),
  ]);

  assert.equal(rows.length, 2);
  const writer = rows.find((row) => row.app.id === 'writer');
  const reader = rows.find((row) => row.app.id === 'reader');
  assert.deepEqual(writer?.customCapabilities, ['text']);
  assert.equal(writer?.custom, true);
  assert.deepEqual(reader?.customCapabilities, []);
  assert.equal(reader?.custom, false);
  assert.deepEqual(summarizeAppExceptions(rows), { total: 2, inherited: 1, custom: 1 });

  const html = renderToStaticMarkup(
    React.createElement(
      HeadlessMantineProvider,
      null,
      React.createElement(AppExceptionsSummary, {
        rows,
        models: [profile('custom-text', ['text'], { name: '自定义文本模型' })],
        loading: false,
        onOpen: () => {},
      }),
    ),
  );
  assert.match(html, /1 个应用继承常用模型，1 个自定义/);
  assert.match(html, /写作应用/);

  assert.deepEqual(buildAppRouteSave('writer', 'multimodal', 'vision-custom'), {
    scope: 'app',
    appId: 'writer',
    capability: 'multimodal',
    primaryModelId: 'vision-custom',
    fallbackModelIds: [],
    inheritPublicFallbacks: true,
  });
});

test('model summary stays compact and never exposes temperature or top_p controls', () => {
  const model = profile('summary', ['text'], {
    contextLength: 128000,
    maxOutputTokens: 8192,
    thinkingLevel: 'high',
    testStatus: 'passed',
    defaultParams: { temperature: 0.7, top_p: 0.9 },
  });
  const summary = modelParameterSummary(model);
  assert.match(summary, /文本/);
  assert.match(summary, /上下文 128k/);
  assert.match(summary, /输出 8\.2k/);
  assert.match(summary, /思考 高/);
  assert.match(summary, /测试通过/);
  assert.doesNotMatch(summary, /temperature/i);
  assert.doesNotMatch(summary, /top_p/i);
});

test('library groups models by connection and auto IDs avoid collisions', () => {
  const connections: ServiceConnection[] = [
    {
      id: 'conn-main',
      name: '主连接',
      kind: 'openai-compatible-text',
      baseUrl: 'https://example.test/v1',
      credentialAccount: null,
      hasCredential: false,
      credentialSource: 'none',
      timeoutMs: 60000,
      headers: {},
      options: {},
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  const groups = groupModelsByConnection(
    [
      profile('a', ['text']),
      profile('b', ['multimodal'], { connectionId: 'missing' }),
    ],
    connections,
  );
  assert.deepEqual(groups.map((group) => group.name), ['主连接', '未归属连接']);
  assert.equal(groups[0]?.models.length, 1);
  assert.equal(groups[1]?.kindLabel, '连接可能已移除');
  const emptyGroups = groupModelsByConnection([], connections);
  assert.equal(emptyGroups.length, 1, '供应商尚无模型时也必须显示，才能继续添加');
  assert.equal(emptyGroups[0].models.length, 0);

  assert.equal(
    generateInternalId('model', 'gpt-4o mini', new Set(['model-gpt-4o-mini']), 'v2'),
    'model-gpt-4o-mini-v2',
  );
});

test('supplier view groups legacy connections by endpoint and routes new models by purpose', () => {
  const common = {
    credentialAccount: null, hasCredential: true, credentialSource: 'none' as const,
    timeoutMs: 60000, headers: {}, options: {}, enabled: true, createdAt: NOW, updatedAt: NOW,
  };
  const connections: ServiceConnection[] = [
    { ...common, id: 'conn-chat', name: 'Magpie', kind: 'openai-compatible-text', baseUrl: 'https://provider.example/v1/' },
    { ...common, id: 'conn-image', name: 'Magpie · GPT Image', kind: 'openai-compatible-image', baseUrl: 'https://provider.example/v1' },
    { ...common, id: 'conn-vector', name: '本地向量', kind: 'vector', baseUrl: 'http://127.0.0.1:8765' },
  ];
  const models = [
    profile('chat', ['text'], { connectionId: 'conn-chat' }),
    profile('image', [], { connectionId: 'conn-image', modelType: 'image' }),
  ];
  const groups = groupModelsBySupplier(models, connections);
  assert.equal(groups.length, 2);
  const magpie = groups.find(group => group.name === 'Magpie');
  assert.equal(magpie?.connections.length, 2);
  assert.equal(magpie?.modelCounts.chat, 1);
  assert.equal(magpie?.modelCounts.image, 1);
  assert.equal(magpie?.baseUrl, 'https://provider.example/v1');
  assert.equal(selectConnectionForModelType(magpie!.connections, 'image')?.id, 'conn-image');
  assert.equal(selectConnectionForModelType(magpie!.connections, 'chat')?.id, 'conn-chat');
  assert.equal(supplierModelTypeLabel(models[1]), '绘图');
  assert.equal(groups.find(group => group.name === '本地向量')?.modelCounts.embedding, 0);
});

test('non-chat models never appear in text or vision routes, even with historical capability labels', () => {
  const models = [
    profile('chat', ['text', 'multimodal']),
    profile('embed', ['text'], { modelType: 'embedding' }),
    profile('image', ['text', 'multimodal'], { modelType: 'image' }),
  ];
  assert.deepEqual(modelsForCapability(models, 'text').map(model => model.id), ['chat']);
  assert.deepEqual(modelsForCapability(models, 'multimodal').map(model => model.id), ['chat']);
  assert.match(modelParameterSummary(models[1]), /向量计算/);
  assert.doesNotMatch(modelParameterSummary(models[1]), /上下文|思考/);
});
