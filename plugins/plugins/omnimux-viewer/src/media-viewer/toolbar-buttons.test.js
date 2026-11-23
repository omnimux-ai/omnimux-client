import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tabSource = readFileSync(new URL('./MediaViewerTab.jsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(
  new URL('../../../omnimux/src/client/media-viewer/styles.js', import.meta.url),
  'utf8',
);

test('图像生成顶栏：打开与下载统一为图标按钮，分栏切换已移除', () => {
  assert.match(
    tabSource,
    /className="omx-mv-btn omx-mv-btn--icon"[\s\S]{0,120}title="在默认看图软件中打开"/,
    '打开按钮必须是 omx-mv-btn--icon，并保留可访问名称',
  );
  assert.match(
    tabSource,
    /className="omx-mv-btn omx-mv-btn--icon"[\s\S]{0,120}title="下载原图"/,
    '下载按钮必须与打开按钮使用同一套图标按钮样式',
  );
  assert.doesNotMatch(tabSource, />\s*打开\s*</, '打开按钮不得再渲染文字');
  assert.doesNotMatch(tabSource, /切换两栏\/三栏/, '分栏切换按钮必须移除');
  assert.doesNotMatch(tabSource, /handleToggleSplit/, '分栏切换 handler 必须移除');
  assert.match(stylesSource, /\.omx-mv-btn--icon\s*\{[^}]*width:\s*28px/, '图标按钮必须是 28px 方形');
});
