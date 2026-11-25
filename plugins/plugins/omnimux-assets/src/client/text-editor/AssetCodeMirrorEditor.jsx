import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { IconButton } from 'dsh-ui-kit'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from '../icons.jsx'
import { dshCodeMirrorTheme, dshMarkdownHighlighting } from './cmTheme.js'
import { liveMarkdownPlugin } from './liveMarkdownPlugin.js'

/**
 * CodeMirror 6 text editor with optional cursor-aware live Markdown rendering
 * and a floating inline search panel. History (undo/redo) is driven natively by
 * CodeMirror's transaction stack.
 */
export const AssetCodeMirrorEditor = forwardRef(function AssetCodeMirrorEditor(props, ref) {
  const {
    value,
    onChange,
    isMarkdown = true,
    readOnly = false,
    placeholder = '',
    autoFocus = true,
    isSearchOpen = false,
    onSearchOpenChange,
    onHistoryChange,
    t,
    className = '',
  } = props

  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const searchInputRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onHistoryChangeRef = useRef(onHistoryChange)
  const initialValueRef = useRef(value)
  const lastHistoryRef = useRef({ canUndo: false, canRedo: false })

  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onHistoryChangeRef.current = onHistoryChange }, [onHistoryChange])

  const emitHistory = useCallback((state) => {
    if (!state) return
    const canUndo = undoDepth(state) > 0
    const canRedo = redoDepth(state) > 0
    if (lastHistoryRef.current.canUndo === canUndo && lastHistoryRef.current.canRedo === canRedo) {
      return
    }
    lastHistoryRef.current = { canUndo, canRedo }
    onHistoryChangeRef.current?.({ canUndo, canRedo })
  }, [])

  const matches = useMemo(() => {
    if (!isSearchOpen || !searchQuery) return []
    const results = []
    const lowerDoc = String(value ?? '').toLowerCase()
    const lowerQuery = searchQuery.toLowerCase()
    let pos = 0
    while ((pos = lowerDoc.indexOf(lowerQuery, pos)) !== -1) {
      results.push({ from: pos, to: pos + searchQuery.length })
      pos += searchQuery.length
    }
    return results
  }, [isSearchOpen, searchQuery, value])

  useImperativeHandle(ref, () => ({
    undo() {
      const view = viewRef.current
      if (!view || readOnly) return false
      const did = undo(view)
      emitHistory(view.state)
      view.focus()
      return did
    },
    redo() {
      const view = viewRef.current
      if (!view || readOnly) return false
      const did = redo(view)
      emitHistory(view.state)
      view.focus()
      return did
    },
    replaceDoc(nextText) {
      const view = viewRef.current
      if (!view) return
      const current = view.state.doc.toString()
      if (current === nextText) return
      view.dispatch({
        changes: { from: 0, to: current.length, insert: nextText },
      })
      emitHistory(view.state)
    },
    focus() {
      viewRef.current?.focus()
    },
    focusSearch() {
      if (searchInputRef.current) {
        searchInputRef.current.focus()
        searchInputRef.current.select()
      }
    },
  }), [emitHistory, readOnly])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return undefined

    const extensions = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      dshCodeMirrorTheme,
      cmPlaceholder(placeholder),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString())
        }
        if (update.docChanged || update.transactions.length > 0) {
          emitHistory(update.state)
        }
      }),
    ]

    if (isMarkdown) {
      extensions.push(markdown(), liveMarkdownPlugin, dshMarkdownHighlighting)
    }
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
    }

    const startState = EditorState.create({
      doc: initialValueRef.current,
      extensions,
    })

    const view = new EditorView({ state: startState, parent })
    viewRef.current = view
    emitHistory(view.state)

    if (autoFocus && !readOnly) {
      view.focus()
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [isMarkdown, readOnly, placeholder, autoFocus, emitHistory])

  // Sync external document updates (e.g. reload from disk or revert).
  useEffect(() => {
    initialValueRef.current = value
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      })
      emitHistory(view.state)
    }
  }, [value, emitHistory])

  // Jump to first match when search query or search panel visibility changes.
  useEffect(() => {
    if (!isSearchOpen || !searchQuery) {
      setMatchIndex(0)
      return
    }
    const view = viewRef.current
    if (!view) return
    const nextIndex = matches.length > 0 ? 0 : -1
    setMatchIndex(nextIndex)
    if (matches.length > 0) {
      view.dispatch({
        selection: { anchor: matches[0].from, head: matches[0].to },
        scrollIntoView: true,
      })
    }
    // Intentionally scoped to query/panel toggle so typing in the document does not steal cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, isSearchOpen])

  // Clamp active match index if document edits shrink the match list.
  useEffect(() => {
    if (!isSearchOpen || !searchQuery) return
    setMatchIndex((prev) => {
      if (matches.length === 0) return -1
      if (prev < 0 || prev >= matches.length) return 0
      return prev
    })
  }, [matches.length, isSearchOpen, searchQuery])

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
      searchInputRef.current.select()
    }
  }, [isSearchOpen])

  const jumpToMatch = useCallback((idx, list) => {
    const target = list[idx]
    const view = viewRef.current
    if (!view || !target) return
    view.dispatch({
      selection: { anchor: target.from, head: target.to },
      scrollIntoView: true,
    })
  }, [])

  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return
    const nextIdx = (matchIndex + 1) % matches.length
    setMatchIndex(nextIdx)
    jumpToMatch(nextIdx, matches)
  }, [matches, matchIndex, jumpToMatch])

  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return
    const prevIdx = (matchIndex - 1 + matches.length) % matches.length
    setMatchIndex(prevIdx)
    jumpToMatch(prevIdx, matches)
  }, [matches, matchIndex, jumpToMatch])

  const closeSearch = useCallback(() => {
    onSearchOpenChange?.(false)
    viewRef.current?.focus()
  }, [onSearchOpenChange])

  return (
    <div className={`omnimux-ate-cm-wrapper ${className}`.trim()}>
      {isSearchOpen ? (
        <div className="omnimux-ate-search-panel" role="search">
          <span className="omnimux-ate-search-icon" aria-hidden="true">
            <SearchIcon size={14} />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            className="omnimux-ate-search-input"
            aria-label={t('textEditor.searchPlaceholder')}
            placeholder={t('textEditor.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) goToPrevMatch()
                else goToNextMatch()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                closeSearch()
              }
            }}
          />
          {searchQuery ? (
            <span className="omnimux-ate-search-count" data-testid="ate-search-count">
              {matches.length > 0
                ? `${Math.min(Math.max(matchIndex, 0), matches.length - 1) + 1}/${matches.length}`
                : t('textEditor.searchNoResults')}
            </span>
          ) : null}
          <div className="omnimux-ate-search-nav">
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t('textEditor.searchPrev')}
              title={t('textEditor.searchPrev')}
              disabled={matches.length === 0}
              onClick={goToPrevMatch}
            >
              <ChevronUpIcon size={13} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t('textEditor.searchNext')}
              title={t('textEditor.searchNext')}
              disabled={matches.length === 0}
              onClick={goToNextMatch}
            >
              <ChevronDownIcon size={13} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="xs"
              className="omnimux-ate-close-btn"
              aria-label={t('textEditor.searchClose')}
              title={t('textEditor.searchClose')}
              onClick={closeSearch}
            >
              <CloseIcon size={13} />
            </IconButton>
          </div>
        </div>
      ) : null}

      <div ref={containerRef} className="omnimux-ate-cm-container" />
    </div>
  )
})
