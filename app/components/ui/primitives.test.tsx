import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlessMantineProvider } from '@mantine/core';
import { Button, type ButtonProps } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Select } from './select';
import { Checkbox } from './checkbox';
import { Switch } from './switch';
import { FormField } from './form-field';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { RowActionsMenu } from './row-actions-menu';
import { OverlayFlexScrollArea, isCommandShortcut } from './overlay-policy';

const renderControl = (markup: React.ReactElement) => renderToStaticMarkup(
  <HeadlessMantineProvider>{markup}</HeadlessMantineProvider>
);

// Button has no hooks: inspect its native element to exercise the actual guards
// without introducing a DOM emulator or running a browser.
function nativeButton(props: ButtonProps) {
  const component = Button as unknown as {
    render: (props: ButtonProps, ref: null) => React.ReactElement<React.ComponentProps<'button'>>;
  };
  return component.render(props, null).props;
}

test('Button defaults to a non-submitting button and preserves explicit form attributes', () => {
  assert.equal(nativeButton({}).type, 'button');
  const html = renderControl(<Button type="submit" name="intent" value="save" form="draft">保存</Button>);
  for (const attribute of ['type="submit"', 'name="intent"', 'value="save"', 'form="draft"']) {
    assert.ok(html.includes(attribute), attribute);
  }
});

test('loading remains focusable and blocks capture, click and native submit activation', () => {
  let activations = 0;
  const props = nativeButton({ loading: true, type: 'submit', onClick: () => activations++, onClickCapture: () => activations++ });
  assert.equal(props.disabled, undefined);
  assert.equal(props['aria-disabled'], true);
  assert.equal(props['aria-busy'], true);
  let prevented = 0;
  let stopped = 0;
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++ } as unknown as React.MouseEvent<HTMLButtonElement>;
  props.onClickCapture?.(event);
  props.onClick?.(event);
  assert.equal(activations, 0);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
});

test('aria-disabled prevents duplicate activation; enabled buttons forward events', () => {
  let activations = 0;
  const event = { preventDefault() {}, stopPropagation() {} } as React.MouseEvent<HTMLButtonElement>;
  nativeButton({ 'aria-disabled': 'true', onClick: () => activations++ }).onClick?.(event);
  assert.equal(activations, 0);
  nativeButton({ onClick: () => activations++, onClickCapture: () => activations++ }).onClickCapture?.(event);
  nativeButton({ onClick: () => activations++ }).onClick?.(event);
  assert.equal(activations, 2);
  assert.equal(nativeButton({ disabled: true }).disabled, true);
});

test('native text controls preserve form, validation, error and multiline attributes', () => {
  const input = renderControl(<Input name="title" form="draft" required readOnly defaultValue="草稿" autoComplete="off" error aria-describedby="title-help" />);
  for (const attribute of ['name="title"', 'form="draft"', 'required=""', 'readOnly=""', 'value="草稿"', 'autoComplete="off"', 'aria-invalid="true"', 'aria-describedby="title-help"']) {
    assert.ok(input.includes(attribute), attribute);
  }
  const textarea = renderControl(<Textarea name="body" rows={7} maxLength={500} defaultValue="正文" />);
  assert.match(textarea, /rows="7"/);
  assert.match(textarea, /maxLength="500"/);
  assert.match(textarea, />正文<\/textarea>/);
  const select = renderControl(<Select name="tags" multiple size={4} defaultValue={['a']}><option value="a">A</option></Select>);
  assert.match(select, /multiple=""/);
  assert.match(select, /size="4"/);
  assert.match(select, /selected=""/);
  assert.doesNotMatch(select, /appearance-none|data:image/);
});

test('single Select renders a decorative chevron in Mantine rightSection with end padding', () => {
  const html = renderControl(<Select name="kind" defaultValue="a"><option value="a">A</option></Select>);
  // 原生 select 仍是唯一的表单控件；箭头只是相邻的装饰节点。
  const selectTag = /<select\b[^>]*>/.exec(html)?.[0];
  assert.ok(selectTag, 'native select is rendered');
  assert.doesNotMatch(selectTag, /aria-hidden|tabindex|role=/, 'indicator never lands on the control');
  assert.match(selectTag, /padding-inline-end:32px/, 'text stops before the chevron');
  assert.match(html, /<svg[^>]*aria-hidden="true"/, 'chevron is hidden from assistive tech');
  assert.match(html, /data-position="right"/, 'chevron sits in the Mantine right section');
  assert.match(html, /data-with-right-section="true"/, 'wrapper reserves the section width');
  const section = /<div[^>]*data-position="right"[^>]*>/.exec(html)?.[0];
  assert.ok(section?.includes('aria-hidden="true"'), 'section itself is not announced');
});

test('Select hides the chevron for multiple and listbox selects and keeps caller padding', () => {
  for (const props of [{ multiple: true }, { size: 4 }] as const) {
    const html = renderControl(<Select {...props}><option value="a">A</option></Select>);
    assert.doesNotMatch(html, /ui-select-indicator/, 'no chevron on list boxes');
    assert.doesNotMatch(html, /data-with-right-section/, 'no reserved section');
  }
  // 调用方的 style 仍生效，并与箭头留白合并而不是互相覆盖。
  const styled = renderControl(<Select style={{ paddingInlineStart: 6 }}><option>A</option></Select>);
  const tag = /<select\b[^>]*>/.exec(styled)?.[0] ?? '';
  assert.match(tag, /padding-inline-start:6px/);
  assert.match(tag, /padding-inline-end:32px/);
});

test('Select keeps disabled, error and label semantics while showing the chevron', () => {
  const html = renderControl(
    <>
      <label htmlFor="kind">类型</label>
      <Select id="kind" name="kind" disabled error="必填" aria-describedby="kind-hint"><option>A</option></Select>
    </>
  );
  const tag = /<select\b[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(tag, / id="kind"/);
  assert.match(tag, / disabled=""/);
  assert.match(tag, / aria-invalid="true"/);
  assert.match(tag, / aria-describedby="kind-hint"/);
  assert.match(html, /<label for="kind">/);
  assert.match(html, /data-ui-select-indicator="true"/, 'chevron still shows on a disabled field');
});

test('checkbox and switch preserve native checked/name/value and description association', () => {
  for (const Control of [Checkbox, Switch]) {
    const html = renderControl(<Control id="notify" label="通知" description="接收更新" aria-describedby="external-help" name="notify" value="yes" defaultChecked />);
    for (const attribute of ['checked=""', 'name="notify"', 'value="yes"', 'for="notify"', 'aria-describedby="notify-description external-help"', 'id="notify-description"']) {
      assert.ok(html.includes(attribute), attribute);
    }
  }
});

test('checkbox and switch expose help and error text through one description and alert association', () => {
  for (const Control of [Checkbox, Switch]) {
    const html = renderControl(
      <Control id="notify" label="通知" help="接收更新" error="保存失败" name="notify" value="yes" defaultChecked />
    );
    for (const attribute of ['for="notify"', 'id="notify-description"', '接收更新', 'id="notify-error"', 'role="alert"', '保存失败', 'aria-describedby="notify-description notify-error"']) {
      assert.ok(html.includes(attribute), attribute);
    }
  }
});

test('IME composition protects Enter/Escape shortcuts and forwards normal keys and composition callbacks', () => {
  let keys = 0;
  let compositions = 0;
  let handlers!: ReturnType<typeof useImeSafeHandlers<HTMLInputElement>>;
  function Harness() {
    handlers = useImeSafeHandlers<HTMLInputElement>({ onKeyDown: () => keys++, onCompositionStart: () => compositions++, onCompositionEnd: () => compositions++ });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  let stopped = 0;
  const event = (key: string, isComposing = false, keyCode = 0) => ({ key, keyCode, nativeEvent: { isComposing }, stopPropagation: () => stopped++ }) as unknown as React.KeyboardEvent<HTMLInputElement>;
  handlers.onKeyDown?.(event('Enter', true));
  handlers.onKeyDown?.(event('Escape', false, 229));
  handlers.onCompositionStart?.({} as React.CompositionEvent<HTMLInputElement>);
  handlers.onKeyDown?.(event('Escape'));
  handlers.onCompositionEnd?.({} as React.CompositionEvent<HTMLInputElement>);
  assert.equal(keys, 0);
  assert.equal(stopped, 3);
  assert.equal(compositions, 2);
  handlers.onKeyDown?.(event('Enter'));
  assert.equal(keys, 1);
});
test('FormField associates label, merges describedBy, renders both error and hint, and forwards required', () => {
  const html = renderControl(
    <FormField label="名称" required hint="用于检索" error="名称已存在">
      <Input name="name" aria-describedby="external-spec" />
    </FormField>
  );
  const fieldId = /<label[^>]*\bfor="([^"]+)"/.exec(html)?.[1];
  assert.ok(fieldId, 'label has an explicit for attribute');
  const inputTag = /<input\b[^>]*>/.exec(html)?.[0];
  assert.ok(inputTag?.includes(` id="${fieldId}"`), 'label target is the actual input element');
  assert.ok(html.includes('aria-describedby="external-spec '), 'preserves child aria-describedby');
  assert.ok(html.includes('-error'), 'includes error id');
  assert.ok(html.includes('-hint'), 'includes hint id');
  assert.ok(html.includes('role="alert"'), 'error announces as alert');
  assert.ok(html.includes('名称已存在'), 'renders error text');
  assert.ok(html.includes('用于检索'), 'renders hint concurrently');
  assert.ok(html.includes('required=""'), 'transfers required to control');
  assert.ok(html.includes('text-sm'), 'label font is at least 14px');
});

test('Input and Select keep the caller ID and disabled state on the native element', () => {
  const html = renderControl(
    <>
      <label htmlFor="readonly-title">标题</label>
      <Input id="readonly-title" aria-describedby="external-hint" disabled />
      <label htmlFor="readonly-work">作品</label>
      <Select id="readonly-work" aria-describedby="external-hint" disabled><option>作品</option></Select>
    </>
  );
  for (const [tag, id] of [['input', 'readonly-title'], ['select', 'readonly-work']]) {
    const control = new RegExp(`<${tag}\\b[^>]*>`).exec(html)?.[0];
    assert.ok(control, `${tag} renders a native control`);
    assert.ok(control.includes(` id="${id}"`), `${tag} keeps the label target`);
    assert.ok(control.includes(' disabled=""'), `${tag} is natively disabled`);
    assert.ok(control.includes(' aria-describedby="external-hint"'), `${tag} keeps its external description`);
  }
});

test('RowActionsMenu uses shared IconButton trigger with accessible label', () => {
  const html = renderControl(
    <RowActionsMenu
      label="更多操作"
      items={[{ label: '删除', tone: 'danger', onSelect: () => {} }]}
    />
  );
  assert.match(html, /aria-label="更多操作"/);
  assert.match(html, /ui-mantine-button-inner/);
});

test('isCommandShortcut blocks IME composition and non-global slash inside inputs', () => {
  const baseEvent = (overrides: Record<string, unknown>) =>
    ({ defaultPrevented: false, isComposing: false, keyCode: 0, metaKey: false, ctrlKey: false, key: 'k', target: null, ...overrides }) as unknown as KeyboardEvent;
  assert.equal(isCommandShortcut(baseEvent({ ctrlKey: true, key: 'k' })), true);
  assert.equal(isCommandShortcut(baseEvent({ metaKey: true, key: 'K' })), true);
  assert.equal(isCommandShortcut(baseEvent({ ctrlKey: true, key: 'k', isComposing: true })), false);
  assert.equal(isCommandShortcut(baseEvent({ ctrlKey: true, key: 'k', keyCode: 229 })), false);
  assert.equal(isCommandShortcut(baseEvent({ key: '/', target: { tagName: 'DIV', isContentEditable: false } })), true);
  assert.equal(isCommandShortcut(baseEvent({ key: '/', target: { tagName: 'INPUT', isContentEditable: false } })), false);
});

test('OverlayFlexScrollArea omits Mantine hardcoded 100vh style prop', () => {
  const html = renderControl(
    <OverlayFlexScrollArea style={{ height: 'calc(100vh - 0px)' }}>
      <span>drawer-body</span>
    </OverlayFlexScrollArea>
  );
  assert.equal(html, '<span>drawer-body</span>');
});
