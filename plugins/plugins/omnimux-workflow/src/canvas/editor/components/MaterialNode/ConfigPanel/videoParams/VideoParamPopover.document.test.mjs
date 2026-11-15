import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [new URL('./VideoParamPopover.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [{
    name: 'popover-document-controls',
    setup(builder) {
      builder.onResolve({ filter: /^react$|^react\/jsx-runtime$|^lucide-react$/ }, (args) => ({ path: args.path, namespace: 'test-react' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-react' }, (args) => {
        if (args.path === 'react') return { contents: 'export const useMemo = fn => fn();' };
        if (args.path === 'lucide-react') return { contents: 'export const FileText = "FileText"; export const X = "X";' };
        return { contents: 'export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;' };
      });
      builder.onResolve({
        filter: /ui\/index\.ts$|CfgPopoverShell\.tsx$|CfgSegment\.tsx$|AspectCardGrid\.tsx$|DurationGrid\.tsx$|SegmentControls\.tsx$/,
      }, (args) => ({ path: args.path, namespace: 'test-controls' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-controls' }, () => ({
        contents: ['CustomSelect', 'CustomSlider', 'CfgPopoverShell', 'CfgSegment', 'AspectCardGrid', 'DurationGrid', 'BooleanSwitchSegment', 'OperationSegment', 'ResolutionSegment', 'SoundSwitchSegment']
          .map((name) => `export const ${name} = '${name}';`).join('\n'),
      }));
    },
  }],
});

const { VideoParamPopover } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const ALL_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'text/plain',
  'application/vnd.apple.keynote',
  'application/vnd.apple.pages',
  'application/vnd.apple.numbers',
  'text/markdown',
];

const documentOperation = {
  id: 'document_to_video',
  label: '文档参考',
  slots: [{
    slot: 'file_url',
    type: 'document',
    role: 'document',
    source: 'node_field',
    min: 1,
    max: 1,
    allowedMimes: ALL_MIMES,
  }],
  bindings: [],
  effective: true,
  ready: true,
};

const baseParams = {
  model: 'wan-3.0',
  operation: 'document_to_video',
  operationLabel: '文档参考',
  showModeUi: false,
  effectiveOperations: [documentOperation],
  schema: {},
  aspectRatio: 'adaptive',
  resolution: '1080P',
  duration: 5,
  sound: true,
  hasSoundSupport: true,
};

function render(params = {}) {
  const changes = [];
  const tree = VideoParamPopover({
    triggerRef: { current: null },
    isOpen: true,
    onClose() {},
    params: { ...baseParams, ...params },
    schema: {},
    onParamChange: (...args) => changes.push(args),
  });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  const byTestId = (id) => nodes.find((node) => node.props?.['data-testid'] === id);
  const byAriaLabel = (label) => nodes.find((node) => node.props?.['aria-label'] === label);
  return { nodes, changes, byTestId, byAriaLabel };
}

function textOf(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object') return textOf(node.props?.children);
  return '';
}

test('valid file_url renders a document item with name, type, MIME and source host', () => {
  const view = render({ fileUrl: 'https://cdn.example.com/campaign/glass-deck.pptx?token=x' });
  const card = view.byTestId('wf-file-url-document');
  assert.ok(card, '应渲染文档项');
  assert.match(textOf(card), /glass-deck\.pptx/);
  assert.match(textOf(card), /PPTX/);
  assert.match(textOf(card), /cdn\.example\.com/);
  assert.match(textOf(card), /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/);
  const remove = view.byAriaLabel('移除文档');
  assert.ok(remove, '文档项应有移除按钮');
  remove.props.onClick();
  assert.deepEqual(view.changes, [['fileUrl', '']]);
});

test('empty file_url renders an inline error and no document item', () => {
  const view = render();
  assert.equal(view.byTestId('wf-file-url-document'), undefined);
  assert.equal(textOf(view.byTestId('wf-file-url-error')), '请输入文档地址');
});

test('unknown document extension renders the supported-format error', () => {
  const view = render({ fileUrl: 'https://cdn.example.com/archive.zip' });
  assert.equal(view.byTestId('wf-file-url-document'), undefined);
  assert.equal(
    textOf(view.byTestId('wf-file-url-error')),
    '不支持该文档格式：支持 docx、doc、xlsx、xls、pptx、ppt、pdf、txt、key、pages、numbers、md',
  );
});

test('known MIME outside allowedMimes renders the model-specific error and no document item', () => {
  const view = render({
    fileUrl: 'https://cdn.example.com/notes.md',
    effectiveOperations: [{
      ...documentOperation,
      slots: [{ ...documentOperation.slots[0], allowedMimes: ['application/pdf'] }],
    }],
  });
  assert.equal(view.byTestId('wf-file-url-document'), undefined);
  assert.equal(textOf(view.byTestId('wf-file-url-error')), '当前模型不支持该文档格式');
});

test('webpage_to_video keeps its plain link input and never renders the document item', () => {
  const params = {
    ...baseParams,
    operation: 'webpage_to_video',
    operationLabel: '网页参考',
    effectiveOperations: [{
      ...documentOperation,
      id: 'webpage_to_video',
      label: '网页参考',
      slots: [{ slot: 'link_url', type: 'document', role: 'webpage', source: 'node_field', min: 1, max: 1 }],
    }],
    linkUrl: 'https://example.com/article',
  };
  const view = render(params);
  assert.equal(view.byTestId('wf-video-file-url-section'), undefined);
  assert.equal(view.byTestId('wf-file-url-document'), undefined);
  const urlInput = view.nodes.find((node) => node.type === 'input' && node.props?.type === 'url');
  assert.equal(urlInput?.props?.value, 'https://example.com/article');
});
