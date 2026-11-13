import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'CanvasErrorBoundary.tsx'), 'utf8');
const appSrc = readFileSync(join(here, '../App.tsx'), 'utf8');

test('CanvasErrorBoundary 源码契约：标准 React Error Boundary 实现', () => {
  assert.match(src, /class CanvasErrorBoundary extends Component/);
  assert.match(src, /static getDerivedStateFromError/);
  assert.match(src, /componentDidCatch/);
  assert.match(src, /handleClearSelectionAndRetry/);
  assert.match(src, /handleReload/);
});

test('CanvasErrorBoundary 源码契约：包含清空选择重试、重新加载、SVG 图标与 DSW/WB tokens', () => {
  const cssSrc = readFileSync(join(here, '../theme/components.css'), 'utf8');
  assert.match(src, /清空选择并重试/);
  assert.match(src, /重新加载/);
  assert.match(src, /AlertTriangle/);
  assert.match(src, /RotateCcw/);
  assert.match(src, /MousePointerClick/);
  assert.match(src, /wf-canvas-error-boundary/);
  assert.match(cssSrc, /\.wf-canvas-error-boundary/);
  assert.match(cssSrc, /--wb-bg-canvas/);
  assert.match(cssSrc, /--wb-danger-soft/);
  assert.match(cssSrc, /--wb-accent/);
});

test('App.tsx 契约：CanvasErrorBoundary 顶层包裹 CanvasEditor', () => {
  assert.match(appSrc, /import\s*\{\s*CanvasErrorBoundary\s*\}\s*from\s*['"]\.\/ui\/CanvasErrorBoundary['"]/);
  assert.match(appSrc, /<CanvasErrorBoundary>/);
  assert.match(appSrc, /<CanvasEditor/);
  assert.match(appSrc, /<\/CanvasErrorBoundary>/);
});
