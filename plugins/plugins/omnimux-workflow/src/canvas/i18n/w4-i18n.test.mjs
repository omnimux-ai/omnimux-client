/**
 * W4 测试（计划 §5 T4.2/T4.3）：
 * 1. rejectReasonKey：reasonCode → edge.reject.* 字典 key 映射 + 未知码兜底；
 * 2. 字典 zh/en key 集合完全一致（运行时复核，编译期另有 Record<DictKey> 约束）；
 * 3. en 文案无中文残留；
 * 4. W4 入典的代表性 key 双语可取（t() 不回退到 key 本身）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rejectReasonKey } from '../editor/utils/connectionValidator.ts';
import { t, setLocale } from './index.ts';
import zh from './dict.zh.ts';
import en from './dict.en.ts';

test('rejectReasonKey：五种结构拒绝码映射到各自字典 key', () => {
  assert.equal(rejectReasonKey('self_connection'), 'edge.reject.selfConnection');
  assert.equal(rejectReasonKey('duplicate_edge'), 'edge.reject.duplicateEdge');
  assert.equal(rejectReasonKey('missing_node'), 'edge.reject.missingNode');
  assert.equal(rejectReasonKey('cycle'), 'edge.reject.cycle');
  assert.equal(rejectReasonKey('type_contract'), 'edge.reject.typeContract');
});

test('rejectReasonKey：未知码/空码兜底 edge.reject.invalid', () => {
  assert.equal(rejectReasonKey('invalid_connection'), 'edge.reject.invalid');
  assert.equal(rejectReasonKey('whatever'), 'edge.reject.invalid');
  assert.equal(rejectReasonKey(undefined), 'edge.reject.invalid');
  assert.equal(rejectReasonKey(null), 'edge.reject.invalid');
});

test('rejectReasonKey 的输出在双语字典中都可取到文案', () => {
  for (const code of ['self_connection', 'duplicate_edge', 'missing_node', 'cycle', 'type_contract', 'x']) {
    const key = rejectReasonKey(code);
    setLocale('zh');
    assert.notEqual(t(key), key, `zh 缺 ${key}`);
    setLocale('en');
    assert.notEqual(t(key), key, `en 缺 ${key}`);
  }
  setLocale('zh');
});

test('字典 zh/en key 集合完全一致', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys);
});

test('en 文案无中文字符残留', () => {
  const cjk = /[一-龥]/;
  for (const [key, value] of Object.entries(en)) {
    assert.ok(!cjk.test(value), `en[${key}] 含中文：${value}`);
  }
});

test('W4 入典代表 key：双语可取且不回退到 key 本身', () => {
  const keys = [
    'toolbar.undo',
    'toolbar.add.video',
    'exec.runAll',
    'exec.status.paused',
    'menu.copy',
    'menu.executeSelection',
    'menu.paste',
    'tool.import',
    'tool.voice-clone',
    'app.autosave.saved',
    'app.conflictBanner',
    'node.textPlaceholder',
    'node.skipped',
    'palette.node.material',
    'error.createExecutionFailed',
    'error.projectRequired',
    'picker.title',
    'picker.tab.canvas',
    'picker.tab.local',
    'picker.use',
    'picker.addRef',
    'picker.importOk',
  ];
  for (const key of keys) {
    setLocale('zh');
    assert.notEqual(t(key), key, `zh 缺 ${key}`);
    setLocale('en');
    assert.notEqual(t(key), key, `en 缺 ${key}`);
  }
  setLocale('zh');
});
