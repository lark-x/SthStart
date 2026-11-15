import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderWithUi } from '../../lib/render-with-ui-test';
import {
  LazyLoadingStatus,
  LazyErrorAlert,
  LazyPanelErrorBoundary,
  LazyPanel,
} from './lazy-panel';

test('LazyLoadingStatus renders accessible status and default or custom label', () => {
  const htmlDefault = renderWithUi(<LazyLoadingStatus label="测试工作台" />);
  assert.ok(htmlDefault.includes('role="status"'), 'must include role="status"');
  assert.ok(htmlDefault.includes('正在加载测试工作台…'), 'must include label message');

  const htmlCustom = renderWithUi(<LazyLoadingStatus message="请稍候…" />);
  assert.ok(htmlCustom.includes('请稍候…'), 'must include custom message');
});

test('LazyErrorAlert renders error alert with detail and retry button', () => {
  const error = new Error('网络断开');
  const html = renderWithUi(
    <LazyErrorAlert
      label="分镜面板"
      error={error}
      onRetry={() => {}}
    />
  );

  assert.ok(html.includes('role="alert"'), 'must include role="alert"');
  assert.ok(html.includes('无法加载分镜面板。'), 'must include failure headline');
  assert.ok(html.includes('（网络断开）'), 'must include error message detail');
  assert.ok(html.includes('重新加载'), 'must include retry button text');
  assert.ok(
    html.includes('无需刷新整页'),
    'must inform user that full page refresh is not needed'
  );
});

test('LazyPanelErrorBoundary renders children when healthy and errorFallback on error', () => {
  const healthy = renderWithUi(
    <LazyPanelErrorBoundary label="健康面板">
      <div id="content">正常内容</div>
    </LazyPanelErrorBoundary>
  );
  assert.ok(healthy.includes('id="content"'));
  assert.ok(healthy.includes('正常内容'));

  const boundary = new LazyPanelErrorBoundary({
    label: '测试面板',
    children: null,
  });

  // Verify derived state
  const err = new Error('Chunk load error');
  const state = LazyPanelErrorBoundary.getDerivedStateFromError(err);
  assert.equal(state.error, err);

  // Set boundary state and test render fallback
  boundary.state = state;
  const errorHtml = renderWithUi(boundary.render());
  assert.ok(errorHtml.includes('role="alert"'));
  assert.ok(errorHtml.includes('无法加载测试面板。'));
  assert.ok(errorHtml.includes('Chunk load error'));

  // Test custom function errorFallback
  const customBoundary = new LazyPanelErrorBoundary({
    label: '自定义面板',
    errorFallback: (error, retry) => (
      <div id="custom-error">
        <span>错误：{error.message}</span>
        <button type="button" onClick={retry}>
          重试
        </button>
      </div>
    ),
    children: null,
  });
  customBoundary.state = { error: new Error('自定义失败') };
  const customHtml = renderWithUi(customBoundary.render());
  assert.ok(customHtml.includes('id="custom-error"'));
  assert.ok(customHtml.includes('错误：自定义失败'));

});

test('LazyPanel accepts loader and renders initial container markup', () => {
  const mockLoader = async () => {
    return {
      default: () => <div>异步内容</div>,
    };
  };

  const html = renderWithUi(
    <LazyPanel
      label="延迟组件"
      loader={mockLoader}
      componentProps={{ foo: 'bar' }}
      className="custom-lazy-container"
    />
  );

  assert.ok(html.includes('custom-lazy-container'));
  // Server rendering shows the loading state; browser effects load the module.
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('正在加载延迟组件…'));
});
