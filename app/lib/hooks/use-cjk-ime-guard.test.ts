import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isImeComposingEvent } from './use-cjk-ime-guard';

describe('isImeComposingEvent', () => {
  it('correctly detects nativeEvent.isComposing', () => {
    const event = {
      nativeEvent: { isComposing: true },
      keyCode: 13,
    };
    assert.equal(isImeComposingEvent(event), true);
  });

  it('correctly intercepts keyCode 229 virtual IME input', () => {
    const event = {
      keyCode: 229,
      key: 'Enter',
    };
    assert.equal(isImeComposingEvent(event), true);
  });

  it('correctly intercepts which 229 virtual IME input', () => {
    const event = {
      which: 229,
      key: 'Enter',
    };
    assert.equal(isImeComposingEvent(event), true);
  });

  it('allows non-composing Enter keys', () => {
    const event = {
      keyCode: 13,
      key: 'Enter',
      nativeEvent: { isComposing: false },
    };
    assert.equal(isImeComposingEvent(event), false);
  });

  it('respects external composing state flag', () => {
    const event = {
      keyCode: 13,
      key: 'Enter',
    };
    assert.equal(isImeComposingEvent(event, false), false);
    assert.equal(isImeComposingEvent(event, true), true);
  });
});
