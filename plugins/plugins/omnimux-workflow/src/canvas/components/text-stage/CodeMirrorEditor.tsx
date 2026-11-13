import React, { useEffect, useRef, useState, useCallback } from 'react';
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
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { dshCodeMirrorTheme, dshMarkdownHighlighting } from './cmTheme';
import { liveMarkdownPlugin } from './liveMarkdownPlugin';
import { useTextStageStore } from '../../store/textStageStore';

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  className?: string;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  onChange,
  placeholder = '输入 Markdown 文本或剧本文案...',
  autoFocus = true,
  onScroll,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onScrollRef = useRef(onScroll);

  const { isSearchOpen, setSearchOpen } = useTextStageStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matches, setMatches] = useState<{ from: number; to: number }[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onScrollRef.current = onScroll;
  }, [onScroll]);

  // 搜索匹配更新与高亮跳转
  const findMatches = useCallback((query: string, docText: string) => {
    if (!query) return [];
    const results: { from: number; to: number }[] = [];
    const lowerDoc = docText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;
    while ((pos = lowerDoc.indexOf(lowerQuery, pos)) !== -1) {
      results.push({ from: pos, to: pos + query.length });
      pos += query.length;
    }
    return results;
  }, []);

  useEffect(() => {
    if (!isSearchOpen || !searchQuery) {
      setMatches([]);
      setMatchIndex(0);
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    const docText = view.state.doc.toString();
    const found = findMatches(searchQuery, docText);
    setMatches(found);
    setMatchIndex(found.length > 0 ? 0 : -1);

    if (found.length > 0 && found[0]) {
      const first = found[0];
      view.dispatch({
        selection: { anchor: first.from, head: first.to },
        scrollIntoView: true,
      });
    }
  }, [searchQuery, isSearchOpen, findMatches]);

  const goToNextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (matchIndex + 1) % matches.length;
    setMatchIndex(nextIdx);
    const target = matches[nextIdx];
    const view = viewRef.current;
    if (view && target) {
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        scrollIntoView: true,
      });
    }
  };

  const goToPrevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (matchIndex - 1 + matches.length) % matches.length;
    setMatchIndex(prevIdx);
    const target = matches[prevIdx];
    const view = viewRef.current;
    if (view && target) {
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        scrollIntoView: true,
      });
    }
  };

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isSearchOpen]);

  // 初始化 CodeMirror 6 实例（集成 liveMarkdownPlugin，无行号，全宽铺满）
  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
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
        markdown(),
        liveMarkdownPlugin,
        EditorView.lineWrapping,
        dshCodeMirrorTheme,
        dshMarkdownHighlighting,
        cmPlaceholder(placeholder),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newDoc = update.state.doc.toString();
            onChangeRef.current(newDoc);
          }
        }),
        EditorView.domEventHandlers({
          scroll(event, view) {
            if (onScrollRef.current) {
              const scroller = view.scrollDOM;
              onScrollRef.current(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
            }
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部 value 同步（处理 Undo/Redo、版本回滚、节点切换）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div className={`wf-cm-editor-wrapper ${className}`}>
      {/* 极简内联搜索栏 */}
      {isSearchOpen && (
        <div className="wf-cm-search-panel">
          <Search size={14} className="wf-cm-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="wf-cm-search-input"
            placeholder="在文档中查找..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) goToPrevMatch();
                else goToNextMatch();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSearchOpen(false);
                viewRef.current?.focus();
              }
            }}
          />
          {searchQuery && (
            <span className="wf-cm-search-count">
              {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : '无结果'}
            </span>
          )}
          <div className="wf-cm-search-nav">
            <button
              type="button"
              className="wf-cm-search-btn"
              onClick={goToPrevMatch}
              disabled={matches.length === 0}
              title="上一个 (Shift+Enter)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              className="wf-cm-search-btn"
              onClick={goToNextMatch}
              disabled={matches.length === 0}
              title="下一个 (Enter)"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="wf-cm-search-btn wf-cm-search-btn--close"
              onClick={() => {
                setSearchOpen(false);
                viewRef.current?.focus();
              }}
              title="关闭搜索 (ESC)"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* CodeMirror DOM 容器 */}
      <div ref={containerRef} className="wf-cm-editor-container" />
    </div>
  );
};
