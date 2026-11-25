import { Decoration, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

const markHidden = Decoration.mark({ class: 'cm-md-mark-hidden' })
const strongMark = Decoration.mark({ class: 'cm-md-strong' })
const emMark = Decoration.mark({ class: 'cm-md-em' })
const inlineCodeMark = Decoration.mark({ class: 'cm-md-inline-code' })
const heading1Line = Decoration.line({ class: 'cm-md-line-h1' })
const heading2Line = Decoration.line({ class: 'cm-md-line-h2' })
const heading3Line = Decoration.line({ class: 'cm-md-line-h3' })
const heading4Line = Decoration.line({ class: 'cm-md-line-h4' })
const blockquoteLine = Decoration.line({ class: 'cm-md-line-quote' })
const hrLine = Decoration.line({ class: 'cm-md-line-hr' })

/**
 * Build cursor-aware live Markdown WYSIWYG decorations for visible ranges.
 * Uses `Decoration.set(ranges, true)` so nested syntax (e.g. bold inside quote)
 * is always sorted cleanly without RangeSetBuilder order exceptions.
 * @param {import('@codemirror/view').EditorView} view
 */
function buildLiveMarkdownDecorations(view) {
  const ranges = []
  const state = view.state
  const tree = syntaxTree(state)
  const cursor = state.selection.main.head
  const decoratedLines = new Set()

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const nodeFrom = node.from
        const nodeTo = node.to
        const line = state.doc.lineAt(nodeFrom)
        const isCursorInLine = cursor >= line.from && cursor <= line.to
        const isCursorInNode = cursor >= nodeFrom && cursor <= nodeTo

        if (node.name.startsWith('ATXHeading')) {
          const level = node.name.replace('ATXHeading', '')
          if (!decoratedLines.has(line.from)) {
            decoratedLines.add(line.from)
            if (level === '1') ranges.push(heading1Line.range(line.from))
            else if (level === '2') ranges.push(heading2Line.range(line.from))
            else if (level === '3') ranges.push(heading3Line.range(line.from))
            else ranges.push(heading4Line.range(line.from))
          }
        }

        if (node.name === 'HeaderMark' && !isCursorInLine) {
          const nextChar = state.doc.sliceString(nodeTo, nodeTo + 1)
          const markEnd = nextChar === ' ' ? nodeTo + 1 : nodeTo
          if (markEnd > nodeFrom) ranges.push(markHidden.range(nodeFrom, markEnd))
        }

        if (node.name === 'StrongEmphasis' && !isCursorInNode && nodeTo > nodeFrom) {
          ranges.push(strongMark.range(nodeFrom, nodeTo))
        }

        if (node.name === 'EmphasisMark') {
          const parent = node.node.parent
          if (parent && (parent.name === 'StrongEmphasis' || parent.name === 'Emphasis')) {
            const isCursorInParent = cursor >= parent.from && cursor <= parent.to
            if (!isCursorInParent && nodeTo > nodeFrom) {
              ranges.push(markHidden.range(nodeFrom, nodeTo))
            }
          }
        }

        if (node.name === 'Emphasis' && !isCursorInNode && nodeTo > nodeFrom) {
          ranges.push(emMark.range(nodeFrom, nodeTo))
        }

        if (node.name === 'InlineCode' && !isCursorInNode && nodeTo > nodeFrom) {
          ranges.push(inlineCodeMark.range(nodeFrom, nodeTo))
        }

        if (node.name === 'CodeMark') {
          const parent = node.node.parent
          if (parent && parent.name === 'InlineCode') {
            const isCursorInParent = cursor >= parent.from && cursor <= parent.to
            if (!isCursorInParent && nodeTo > nodeFrom) {
              ranges.push(markHidden.range(nodeFrom, nodeTo))
            }
          }
        }

        if (node.name === 'Blockquote' && !decoratedLines.has(line.from)) {
          decoratedLines.add(line.from)
          ranges.push(blockquoteLine.range(line.from))
        }

        if (node.name === 'QuoteMark' && !isCursorInLine) {
          const nextChar = state.doc.sliceString(nodeTo, nodeTo + 1)
          const markEnd = nextChar === ' ' ? nodeTo + 1 : nodeTo
          if (markEnd > nodeFrom) ranges.push(markHidden.range(nodeFrom, markEnd))
        }

        if (node.name === 'HorizontalRule' && !decoratedLines.has(line.from)) {
          decoratedLines.add(line.from)
          ranges.push(hrLine.range(line.from))
        }
      },
    })
  }

  return Decoration.set(ranges, true)
}

/**
 * CodeMirror 6 ViewPlugin: cursor-aware inline Markdown WYSIWYG rendering.
 */
export const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildLiveMarkdownDecorations(view)
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildLiveMarkdownDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)
