import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zh from '../../i18n/dict.zh.ts';
import en from '../../i18n/dict.en.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '../../../..');

test('TextStage 文件完整性与契约检查', () => {
  const expectedFiles = [
    'src/canvas/store/textStageStore.ts',
    'src/canvas/components/text-stage/TextStage.tsx',
    'src/canvas/components/text-stage/TextStageTopbar.tsx',
    'src/canvas/components/text-stage/CodeMirrorEditor.tsx',
    'src/canvas/components/text-stage/liveMarkdownPlugin.ts',
    'src/canvas/components/text-stage/cmTheme.ts',
    'src/canvas/components/text-stage/MarkdownPreview.tsx',
    'src/canvas/components/text-stage/VersionDrawer.tsx',
    'src/canvas/components/text-stage/VersionDiffModal.tsx',
    'src/canvas/components/text-stage/text-stage.css',
  ];

  for (const rel of expectedFiles) {
    const full = join(root, rel);
    assert.ok(existsSync(full), `缺少预期文件: ${rel}`);
  }
});

test('TextStage CSS 设计系统契约: 100% 消费 --dsw-* Token, 0 裸色硬编码, 32px 控件高基准', () => {
  const cssPath = join(__dirname, 'text-stage.css');
  const css = readFileSync(cssPath, 'utf8');

  // 必须包含关键的 DSW Token
  assert.ok(css.includes('--dsw-alias-bg-base'), '应使用 --dsw-alias-bg-base');
  assert.ok(css.includes('--dsw-alias-label-primary'), '应使用 --dsw-alias-label-primary');
  assert.ok(css.includes('--dsw-alias-border-l1'), '应使用 --dsw-alias-border-l1');
  assert.ok(css.includes('--dsw-alias-primary'), '应使用 --dsw-alias-primary');

  // 严禁私有非法的 --omx-* 岛屿命名
  assert.equal(css.includes('--omx-'), false, '不得包含 --omx-* 废弃变量');

  // 严禁除 var(--dsw-*, <fallback>) 以外的裸色违规
  const lines = css.split('\n');
  for (const line of lines) {
    if (line.includes('/*') || line.includes('*') || line.trim().startsWith('//')) continue;
    // 如果包含 hex 色值，必须在 var(--dsw-..., #hex) 的 fallback 中
    if (/#([0-9a-fA-F]{3,8})/i.test(line)) {
      assert.ok(
        line.includes('var(--dsw-'),
        `发现未受 var(--dsw-*) 保护的裸色行: ${line}`,
      );
    }
  }

  // 验证 32px 控件高度基准与 8px 圆角体系
  assert.ok(css.includes('height: 32px;'), '标准按钮/输入框应保持 32px 控件高度基准');
  assert.ok(css.includes('border-radius: 8px;'), '标准控件应保持 8px 圆角体系');
  assert.ok(css.includes('border-radius: 16px;'), '模态弹窗应保持 16px 圆角');
});

test('TextStage i18n 字典对称性与覆盖率', () => {
  const textStageKeys = [
    'node.doubleClickToExpand',
    'textStage.close',
    'textStage.renameHint',
    'textStage.unsaved',
    'textStage.saved',
    'textStage.viewSplit',
    'textStage.split',
    'textStage.viewEdit',
    'textStage.editOnly',
    'textStage.viewPreview',
    'textStage.previewOnly',
    'textStage.words',
    'textStage.chars',
    'textStage.lines',
    'textStage.undo',
    'textStage.redo',
    'textStage.createSnapshot',
    'textStage.snapshot',
    'textStage.versionHistory',
    'textStage.versions',
    'textStage.saveAndClose',
    'textStage.done',
    'textStage.closeDrawer',
    'textStage.snapshotNamePlaceholder',
    'textStage.cancel',
    'textStage.confirmCreate',
    'textStage.newSnapshot',
    'textStage.noVersions',
    'textStage.noVersionsDesc',
    'textStage.sourceAuto',
    'textStage.sourceRevert',
    'textStage.sourceImport',
    'textStage.sourceManual',
    'textStage.diffHint',
    'textStage.diff',
    'textStage.revertHint',
    'textStage.revert',
    'textStage.delete',
    'textStage.revertConfirm',
    'textStage.deleteConfirm',
    'textStage.diffModalTitle',
    'textStage.diffOldLabel',
    'textStage.diffNewLabel',
    'textStage.diffRevertTip',
    'textStage.applyVersion',
  ];

  for (const key of textStageKeys) {
    assert.ok(key in zh, `zh 字典缺失键: ${key}`);
    assert.ok(key in en, `en 字典缺失键: ${key}`);
    assert.ok(zh[key].length > 0, `zh 字典键值不能为空: ${key}`);
    assert.ok(en[key].length > 0, `en 字典键值不能为空: ${key}`);
  }
});

test('TextStage 画布集成契约: injectCanvasStyles 与 CanvasEditor 挂载', () => {
  const injectStylesSrc = readFileSync(join(root, 'src/canvas/injectStyles.ts'), 'utf8');
  assert.ok(
    injectStylesSrc.includes('omnimux-workflow-text-stage'),
    'injectCanvasStyles 必须包含 omnimux-workflow-text-stage 样式单',
  );

  const canvasEditorSrc = readFileSync(join(root, 'src/canvas/editor/CanvasEditor.tsx'), 'utf8');
  assert.ok(canvasEditorSrc.includes('<TextStage'), 'CanvasEditor 必须挂载 <TextStage />');
  assert.ok(
    canvasEditorSrc.includes('registerCommitHandler'),
    'CanvasEditor 必须挂载 useTextStageStore registerCommitHandler 同步器',
  );

  const materialNodeSrc = readFileSync(
    join(root, 'src/canvas/editor/components/MaterialNode/index.tsx'),
    'utf8',
  );
  assert.ok(
    materialNodeSrc.includes('openStage'),
    'MaterialNode 必须通过 useTextStageStore.openStage 呼出全屏舞台',
  );
  assert.ok(
    materialNodeSrc.includes('handleOpenTextStage'),
    'MaterialNode 必须具备 handleOpenTextStage 统一唤起处理',
  );
});
