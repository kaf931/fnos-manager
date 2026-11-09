import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSelectActionOption } from '../.web-test/select-action-option.js';
test('select option action does not select the option and disabled actions do nothing', () => {
  let selected = 0,
    removed = 0,
    stopped = 0;
  const option = { value: 'provider-b', label: 'Provider B', onClick: () => selected++ };
  const node = renderSelectActionOption({
    option,
    actionLabel: '删除 Provider B',
    onAction: () => removed++,
  });
  const button = node.props.children[1];
  assert.equal(button.props['aria-label'], '删除 Provider B');
  button.props.onClick({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.equal(removed, 1);
  assert.equal(selected, 0);
  const disabled = renderSelectActionOption({
    option,
    actionLabel: '删除',
    disabled: true,
    onAction: () => removed++,
  });
  disabled.props.children[1].props.onClick({ stopPropagation: () => stopped++ });
  assert.equal(removed, 1);
});
