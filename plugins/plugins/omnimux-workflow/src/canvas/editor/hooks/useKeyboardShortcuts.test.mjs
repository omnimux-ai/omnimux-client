import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStrictSingleMod,
  resolveKeyboardShortcutAction,
} from './useKeyboardShortcuts.ts';

test('isStrictSingleMod: macOS 下仅允许单一 Command (metaKey)，排除 Control/Alt', () => {
  // Mac 平台
  const isMac = true;

  // 正确的 Cmd+A
  const cmdOnly = { metaKey: true, ctrlKey: false, altKey: false };
  assert.equal(isStrictSingleMod(cmdOnly, isMac), true);

  // 微信/QQ 截屏三键热键: Control + Command + A
  const ctrlCmd = { metaKey: true, ctrlKey: true, altKey: false };
  assert.equal(isStrictSingleMod(ctrlCmd, isMac), false, 'Control+Command 必须被排除');

  // Option + Command + A
  const optCmd = { metaKey: true, ctrlKey: false, altKey: true };
  assert.equal(isStrictSingleMod(optCmd, isMac), false, 'Option+Command 必须被排除');

  // 单独 Control 键在 Mac 下不是主修饰键
  const ctrlOnly = { metaKey: false, ctrlKey: true, altKey: false };
  assert.equal(isStrictSingleMod(ctrlOnly, isMac), false, 'Mac 下单独 Ctrl 不作为主修饰键');
});

test('isStrictSingleMod: Win/Linux 下仅允许单一 Ctrl (ctrlKey)，排除 Meta/Alt', () => {
  // Win/Linux 平台
  const isMac = false;

  // 正确的 Ctrl+A
  const ctrlOnly = { metaKey: false, ctrlKey: true, altKey: false };
  assert.equal(isStrictSingleMod(ctrlOnly, isMac), true);

  // Win 键 + Ctrl + A
  const winCtrl = { metaKey: true, ctrlKey: true, altKey: false };
  assert.equal(isStrictSingleMod(winCtrl, isMac), false, 'Win+Ctrl 必须被排除');

  // Alt + Ctrl + A
  const altCtrl = { metaKey: false, ctrlKey: true, altKey: true };
  assert.equal(isStrictSingleMod(altCtrl, isMac), false, 'Alt+Ctrl 必须被排除');
});

test('resolveKeyboardShortcutAction: Control+Command+A 忽略，不触发 selectAll', () => {
  const isMac = true;
  const event = {
    metaKey: true,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    key: 'a',
    target: { tagName: 'DIV', isContentEditable: false },
  };

  const action = resolveKeyboardShortcutAction(event, { hasSelection: true, isAssetsOpen: false }, isMac);
  assert.equal(action, null, 'Control+Command+A 必须返回 null，不触发任何动作');
});

test('resolveKeyboardShortcutAction: 单一 Command+A 正常触发 selectAll', () => {
  const isMac = true;
  const event = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'a',
    target: { tagName: 'DIV', isContentEditable: false },
  };

  const action = resolveKeyboardShortcutAction(event, { hasSelection: true, isAssetsOpen: false }, isMac);
  assert.equal(action, 'selectAll', 'Command+A 必须识别为 selectAll');
});

test('resolveKeyboardShortcutAction: 撤销 Cmd+Z 与重做 Cmd+Shift+Z 严格互斥', () => {
  const isMac = true;
  const undoEvent = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'z',
    target: { tagName: 'DIV', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(undoEvent, {}, isMac), 'undo');

  const redoEvent = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    key: 'z',
    target: { tagName: 'DIV', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(redoEvent, {}, isMac), 'redo');
});

test('resolveKeyboardShortcutAction: 打组 Cmd+G 与解组 Cmd+Shift+G 严格互斥', () => {
  const isMac = true;
  const groupEvent = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'g',
    target: { tagName: 'DIV', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(groupEvent, {}, isMac), 'group');

  const ungroupEvent = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    key: 'g',
    target: { tagName: 'DIV', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(ungroupEvent, {}, isMac), 'ungroup');
});

test('resolveKeyboardShortcutAction: 在输入框内打字不触发任何画布快捷键', () => {
  const isMac = true;
  const inputEvent = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'a',
    target: { tagName: 'INPUT', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(inputEvent, {}, isMac), null);

  const textareaEvent = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 'Delete',
    target: { tagName: 'TEXTAREA', isContentEditable: false },
  };
  assert.equal(resolveKeyboardShortcutAction(textareaEvent, { hasSelection: true }, isMac), null);
});
