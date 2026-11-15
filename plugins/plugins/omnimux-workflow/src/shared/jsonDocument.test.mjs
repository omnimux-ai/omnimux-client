import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJsonDocumentText } from './jsonDocument.ts';

test('JSON document：prompt / duration 生效，其余字段明确列为忽略', () => {
  const parsed = parseJsonDocumentText(JSON.stringify({
    prompt: '  秋日清晨，阳光穿过咖啡馆。  ',
    duration: 8,
    shots: ['镜头1', '镜头2'],
    style: 'cinematic',
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.empty, false);
  assert.equal(parsed.prompt, '秋日清晨，阳光穿过咖啡馆。');
  assert.equal(parsed.duration, 8);
  assert.deepEqual(parsed.ignoredFields, ['shots', 'style']);
  assert.equal(parsed.error, undefined);
});

test('JSON document：空文件 / 语法错误 / 顶层非对象 / 字段类型错误都明确失败', () => {
  const empty = parseJsonDocumentText('   \n');
  assert.equal(empty.ok, false);
  assert.equal(empty.empty, true);
  assert.match(empty.error, /为空/);

  const broken = parseJsonDocumentText('{"prompt": "a",');
  assert.equal(broken.ok, false);
  assert.equal(broken.empty, false);
  assert.match(broken.error, /解析失败/);

  const array = parseJsonDocumentText('[1,2,3]');
  assert.equal(array.ok, false);
  assert.match(array.error, /顶层必须是对象/);

  const wrongPrompt = parseJsonDocumentText('{"prompt": 12}');
  assert.equal(wrongPrompt.ok, false);
  assert.match(wrongPrompt.error, /prompt 必须是字符串/);

  const wrongDuration = parseJsonDocumentText('{"prompt":"a","duration":"8"}');
  assert.equal(wrongDuration.ok, false);
  assert.match(wrongDuration.error, /duration 必须是大于 0 的数字/);

  const noKnownField = parseJsonDocumentText('{"shots":["镜头1"]}');
  assert.equal(noKnownField.ok, false);
  assert.match(noKnownField.error, /没有可用的 prompt 或 duration/);
  assert.deepEqual(noKnownField.ignoredFields, ['shots']);
});
