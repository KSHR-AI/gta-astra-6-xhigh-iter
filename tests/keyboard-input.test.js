import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardCode } from '../src/input-prompts.js';

test('movement uses physical keys when supplied and logical keys otherwise', () => {
  assert.equal(keyboardCode({ key:'z', code:'KeyW' }), 'KeyW');
  for (const code of ['', 'Unidentified']) {
    for (const [key, expected] of [['w','KeyW'],['D','KeyD'],['1','Digit1'],[' ','Space'],['ArrowUp','ArrowUp'],['Shift','ShiftLeft'],['Escape','Escape']])
      assert.equal(keyboardCode({ key, code }), expected);
  }
  assert.equal(keyboardCode({ key:'Shift', location:2 }), 'ShiftRight');
  assert.equal(keyboardCode({ key:'Unidentified' }), '');
});
