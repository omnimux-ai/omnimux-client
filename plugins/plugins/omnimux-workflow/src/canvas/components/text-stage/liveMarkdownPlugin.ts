import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// 样式装饰器定义
const markHidden = Decoration.mark({ class: 'cm-md-mark-hidden' });
const strongMark = Decoration.mark({ class: 'cm-md-strong' });
const emMark = Decoration.mark({ class: 'cm-md-em' });
const inlineCodeMark = Decoration.mark({ class: 'cm-md-inline-code' });
const heading1Line = Decoration.line({ class: 'cm-md-line-h1' });
const heading2Line = Decoration.line({ class: 'cm-md-line-h2' });
const heading3Line = Decoration.line({ class: 'cm-md-line-h3' });
const heading4Line = Decoration.line({ class: 'cm-md-line-h4' });
const blockquoteLine = Decoration.line({ class: 'cm-md-line-quote' });
const hrLine = Decoration.line({ class: 'cm-md-line-hr' });

function buildLiveMarkdownDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const state = view.state;
  const tree = syntaxTree(state);
  const selection = state.selection.main;
  const cursor = selection.head;

  // 记录已经添加过的行装饰，避免 CodeMirror 同一行重复 line decoration 报错
  const decoratedLines = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const nodeFrom = node.from;
        const nodeTo = node.to;
        const line = state.doc.lineAt(nodeFrom);
        const isCursorInLine = cursor >= line.from && cursor <= line.to;
        const isCursorInNode = cursor >= nodeFrom && cursor <= nodeTo;

        // 1. 标题 (ATXHeading1 ~ ATXHeading6)
        if (node.name.startsWith('ATXHeading')) {
          const level = node.name.replace('ATXHeading', '');
          if (!decoratedLines.has(line.from)) {
            decoratedLines.add(line.from);
            if (level === '1') builder.add(line.from, line.from, heading1Line);
            else if (level === '2') builder.add(line.from, line.from, heading2Line);
            else if (level === '3') builder.add(line.from, line.from, heading3Line);
            else builder.add(line.from, line.from, heading4Line);
          }
        }

        // 标题标记符 (#, ##, ###)
        if (node.name === 'HeaderMark') {
          if (!isCursorInLine) {
            // 光标不在当前标题行时，隐藏 # 符号及紧随的一个空格
            const nextChar = state.doc.sliceString(nodeTo, nodeTo + 1);
            const markEnd = nextChar === ' ' ? nodeTo + 1 : nodeTo;
            builder.add(nodeFrom, markEnd, markHidden);
          }
        }

        // 2. 加粗 (StrongEmphasis: **text** 或 __text__)
        if (node.name === 'StrongEmphasis') {
          if (!isCursorInNode) {
            builder.add(nodeFrom, nodeTo, strongMark);
          }
        }
        if (node.name === 'EmphasisMark') {
          // 检查父节点是否为 StrongEmphasis 或 Emphasis
          const parentName = node.node.parent?.name;
          if (parentName === 'StrongEmphasis' || parentName === 'Emphasis') {
            const parentFrom = node.node.parent?.from ?? nodeFrom;
            const parentTo = node.node.parent?.to ?? nodeTo;
            const isCursorInParent = cursor >= parentFrom && cursor <= parentTo;
            if (!isCursorInParent) {
              builder.add(nodeFrom, nodeTo, markHidden);
            }
          }
        }

        // 3. 斜体 (Emphasis: *text* 或 _text_)
        if (node.name === 'Emphasis') {
          if (!isCursorInNode) {
            builder.add(nodeFrom, nodeTo, emMark);
          }
        }

        // 4. 行内代码 (InlineCode: `code`)
        if (node.name === 'InlineCode') {
          if (!isCursorInNode) {
            builder.add(nodeFrom, nodeTo, inlineCodeMark);
          }
        }
        if (node.name === 'CodeMark') {
          const parentFrom = node.node.parent?.from ?? nodeFrom;
          const parentTo = node.node.parent?.to ?? nodeTo;
          const isCursorInParent = cursor >= parentFrom && cursor <= parentTo;
          if (!isCursorInParent) {
            builder.add(nodeFrom, nodeTo, markHidden);
          }
        }

        // 5. 引用块 (Blockquote)
        if (node.name === 'Blockquote') {
          if (!decoratedLines.has(line.from)) {
            decoratedLines.add(line.from);
            builder.add(line.from, line.from, blockquoteLine);
          }
        }
        if (node.name === 'QuoteMark') {
          if (!isCursorInLine) {
            const nextChar = state.doc.sliceString(nodeTo, nodeTo + 1);
            const markEnd = nextChar === ' ' ? nodeTo + 1 : nodeTo;
            builder.add(nodeFrom, markEnd, markHidden);
          }
        }

        // 6. 分割线 (HorizontalRule)
        if (node.name === 'HorizontalRule') {
          if (!decoratedLines.has(line.from)) {
            decoratedLines.add(line.from);
            builder.add(line.from, line.from, hrLine);
          }
        }
      },
    });
  }

  return builder.finish();
}

/**
 * CodeMirror 6 ViewPlugin: Markdown 智能行内实时渲染与所见即所得
 */
export const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLiveMarkdownDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildLiveMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
