/**
 * FloatingSelectionToolbar: 多选浮动胶囊工具栏与打组防线契约测试
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zh from '../../i18n/dict.zh.ts';
import en from '../../i18n/dict.en.ts';
import { t, setLocale } from '../../i18n/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const toolbarSrc = readFileSync(join(here, 'FloatingSelectionToolbar.tsx'), 'utf8');
const editorSrc = readFileSync(join(here, '../CanvasEditor.tsx'), 'utf8');

test('FloatingSelectionToolbar 根容器携带 nodrag nopan 与 pointer guard', () => {
  assert.match(toolbarSrc, /className="wf-floating-selection-bar nodrag nopan"/);
  assert.match(toolbarSrc, /onPointerDown=\{stopToolbarNativeEvent\}/);
  assert.match(toolbarSrc, /onMouseDown=\{stopToolbarNativeEvent\}/);
});

test('FloatingSelectionToolbar 门禁条件：未激活或选中节点 < 2 时安全返回 null', () => {
  assert.match(toolbarSrc, /if \(!visible \|\| selectedCount < 2\) return null;/);
});

test('FloatingSelectionToolbar 三大操作按钮均为中性胶囊，打组按钮不含 --accent 高亮类名', () => {
  // 校验所有顶级操作按钮均使用 wf-floating-selection-bar__btn
  const buttonMatches = [...toolbarSrc.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(buttonMatches.length >= 3, `Expected at least 3 buttons, got ${buttonMatches.length}`);

  // 所有 button 显式声明 type="button"
  for (const attrs of buttonMatches) {
    assert.match(attrs, /\btype="button"/);
  }

  // 严格断言：源码中不得含有 wf-floating-selection-bar__btn--accent 类名（T1 修复）
  assert.equal(
    toolbarSrc.includes('wf-floating-selection-bar__btn--accent'),
    false,
    'FloatingSelectionToolbar 不得包含 wf-floating-selection-bar__btn--accent，所有按钮默认态保持中性胶囊',
  );

  // 校验三个顶级按钮的类名均为标准 wf-floating-selection-bar__btn
  assert.match(toolbarSrc, /className="wf-floating-selection-bar__btn"\s+onClick=\{onCreateAsset\}/);
  assert.match(toolbarSrc, /className="wf-floating-selection-bar__btn"\s+onClick=\{onGroup\}/);
  assert.match(toolbarSrc, /className="wf-floating-selection-bar__btn"\s+onClick=\{\(\) => setIsLayoutMenuOpen/);
});

test('FloatingSelectionToolbar 国际化键消费完整且双语均有定义', () => {
  const consumedKeys = [
    'group.float.createAsset',
    'group.float.createAssetTitle',
    'group.float.group',
    'group.float.groupTitle',
    'group.layout',
    'group.float.layoutTitle',
    'group.layoutHorizontal',
    'group.layoutVertical',
    'group.layoutGridCompact',
  ];

  for (const key of consumedKeys) {
    assert.ok(key in zh, `zh 字典缺少 key: ${key}`);
    assert.ok(key in en, `en 字典缺少 key: ${key}`);
    setLocale('zh');
    assert.notEqual(t(key), key, `zh 字典 t('${key}') 回退到 key 本身`);
    setLocale('en');
    assert.notEqual(t(key), key, `en 字典 t('${key}') 回退到 key 本身`);
  }
  setLocale('zh');
});

test('CanvasEditor handleGroupSelected 打组防御闭环与选区过滤契约', () => {
  // 1. 提取有效顶层常规节点 (topLevelNodes = selectedRegularNodes.filter((n) => !n.parentId))
  assert.match(editorSrc, /const topLevelNodes = selectedRegularNodes\.filter\(\(n\) => !n\.parentId\);/);

  // 2. topLevelNodes.length < 2 时区分已有组内节点与数量不足
  assert.match(editorSrc, /if \(topLevelNodes\.length < 2\) \{/);
  assert.match(editorSrc, /selectedRegularNodes\.some\(\(n\) => Boolean\(n\.parentId\)\)/);
  assert.match(editorSrc, /toast\.warning\(t\('group\.toast\.alreadyInGroup'\)\);/);
  assert.match(editorSrc, /toast\.warning\(t\('group\.toast\.cannotGroup'\)\);/);

  // 3. topLevelNodes.length >= 2 时调用 groupNodes 并在失败时 toast.error 闭环
  assert.match(editorSrc, /const groupId = groupNodes\(topLevelNodes\.map\(\(n\) => n\.id\), t\('group\.defaultTitle'\)\);/);
  assert.match(editorSrc, /if \(groupId\) \{/);
  assert.match(editorSrc, /toast\.success\(t\('group\.toast\.grouped'\)\);/);
  assert.match(editorSrc, /\} else \{/);
  assert.match(editorSrc, /toast\.error\(t\('group\.toast\.failed'\)\);/);
});

test('打组相关双语 Toast 字典完整性断言', () => {
  const toastKeys = [
    'group.toast.cannotGroup',
    'group.toast.alreadyInGroup',
    'group.toast.grouped',
    'group.toast.failed',
  ];

  for (const key of toastKeys) {
    assert.ok(key in zh, `zh 缺少 ${key}`);
    assert.ok(key in en, `en 缺少 ${key}`);
    setLocale('zh');
    assert.notEqual(t(key), key);
    setLocale('en');
    assert.notEqual(t(key), key);
  }
  setLocale('zh');
});
