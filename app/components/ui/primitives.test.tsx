import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, type ButtonProps } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Select } from './select';
import { Checkbox } from './checkbox';
import { Switch } from './switch';
import { FormField } from './form-field';
import { useImeSafeHandlers } from './use-ime-safe-handlers';

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
  const html = renderToStaticMarkup(<Button type="submit" name="intent" value="save" form="draft">保存</Button>);
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
  const input = renderToStaticMarkup(<Input name="title" form="draft" required readOnly defaultValue="草稿" autoComplete="off" error aria-describedby="title-help" />);
  for (const attribute of ['name="title"', 'form="draft"', 'required=""', 'readOnly=""', 'value="草稿"', 'autoComplete="off"', 'aria-invalid="true"', 'aria-describedby="title-help"']) {
    assert.ok(input.includes(attribute), attribute);
  }
  const textarea = renderToStaticMarkup(<Textarea name="body" rows={7} maxLength={500} defaultValue="正文" />);
  assert.match(textarea, /rows="7"/);
  assert.match(textarea, /maxLength="500"/);
  assert.match(textarea, />正文<\/textarea>/);
  const select = renderToStaticMarkup(<Select name="tags" multiple size={4} defaultValue={['a']}><option value="a">A</option></Select>);
  assert.match(select, /multiple=""/);
  assert.match(select, /size="4"/);
  assert.match(select, /selected=""/);
  assert.doesNotMatch(select, /appearance-none|data:image/);
});

test('checkbox and switch preserve native checked/name/value and description association', () => {
  for (const Control of [Checkbox, Switch]) {
    const html = renderToStaticMarkup(<Control id="notify" label="通知" description="接收更新" aria-describedby="external-help" name="notify" value="yes" defaultChecked />);
    for (const attribute of ['checked=""', 'name="notify"', 'value="yes"', 'for="notify"', 'aria-describedby="external-help notify-description"', 'id="notify-description"']) {
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
  const html = renderToStaticMarkup(
    <FormField label="名称" required hint="用于检索" error="名称已存在">
      <Input name="name" aria-describedby="external-spec" />
    </FormField>
  );
  assert.ok(html.includes('for="'), 'links label to input id');
  assert.ok(html.includes('aria-describedby="external-spec '), 'preserves child aria-describedby');
  assert.ok(html.includes('-error'), 'includes error id');
  assert.ok(html.includes('-hint'), 'includes hint id');
  assert.ok(html.includes('role="alert"'), 'error announces as alert');
  assert.ok(html.includes('名称已存在'), 'renders error text');
  assert.ok(html.includes('用于检索'), 'renders hint concurrently');
  assert.ok(html.includes('required=""'), 'transfers required to control');
  assert.ok(html.includes('text-sm'), 'label font is at least 14px');
});
