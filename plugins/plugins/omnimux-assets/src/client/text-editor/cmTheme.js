import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * CodeMirror 6 theme bound exclusively to allowlisted host `--dsw-*` semantic tokens.
 * Adapts automatically between light and dark themes with zero bare colors.
 */
export const dshCodeMirrorTheme = EditorView.theme({
  '&': {
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'transparent',
    height: '100%',
    fontSize: '14px',
    fontFamily: 'var(--dsw-font-family)',
    lineHeight: '1.7',
  },
  '.cm-scroller': {
    overflow: 'auto',
    height: '100%',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '28px 44px',
    boxSizing: 'border-box',
    width: '100%',
    caretColor: 'var(--dsw-alias-label-primary)',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary)',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--dsw-alias-bg-document-selection) !important',
    borderRadius: '2px',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--dsw-alias-label-tertiary)',
    fontStyle: 'normal',
  },
})

/**
 * Markdown Lezer syntax highlight styles mapped to allowlisted `--dsw-alias-*` tokens.
 */
export const dshHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '24px', fontWeight: '700', color: 'var(--dsw-alias-label-primary)' },
  { tag: t.heading2, fontSize: '18px', fontWeight: '700', color: 'var(--dsw-alias-label-primary)' },
  { tag: t.heading3, fontSize: '16px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--dsw-alias-label-primary)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--dsw-alias-label-secondary)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--dsw-alias-label-tertiary)' },
  { tag: t.keyword, color: 'var(--dsw-alias-json-tree-keyword)', fontWeight: '500' },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator], color: 'var(--dsw-alias-link)' },
  { tag: [t.literal, t.inserted], color: 'var(--dsw-alias-state-success-primary)' },
  { tag: [t.string, t.deleted], color: 'var(--dsw-alias-json-tree-string)' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: 'var(--dsw-alias-state-warn-label)' },
  { tag: t.link, color: 'var(--dsw-alias-link)', textDecoration: 'underline' },
  {
    tag: t.monospace,
    color: 'var(--dsw-alias-json-tree-property)',
    backgroundColor: 'var(--dsw-alias-markdown-inline-code)',
  },
  { tag: t.comment, color: 'var(--dsw-alias-label-tertiary)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--dsw-alias-json-tree-number)' },
  { tag: t.quote, color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--dsw-alias-label-secondary)' },
])

export const dshMarkdownHighlighting = syntaxHighlighting(dshHighlightStyle)
