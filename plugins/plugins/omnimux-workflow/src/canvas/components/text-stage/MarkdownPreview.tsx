import React, { useMemo } from 'react';
import { marked } from 'marked';

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  emptyHint?: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  className = '',
  emptyHint = '暂无预览内容，请在左侧编辑器中输入 Markdown 文本',
}) => {
  const html = useMemo(() => {
    if (!content || !content.trim()) {
      return '';
    }
    try {
      return marked.parse(content, {
        gfm: true,
        breaks: true,
      }) as string;
    } catch (e) {
      console.error('Failed to parse markdown:', e);
      return `<p class="wf-md-error">${content}</p>`;
    }
  }, [content]);

  if (!content || !content.trim()) {
    return (
      <div className={`wf-markdown-preview-container wf-markdown-preview-empty ${className}`}>
        <div className="wf-markdown-empty-hint">{emptyHint}</div>
      </div>
    );
  }

  return (
    <div className={`wf-markdown-preview-container ${className}`}>
      <div
        className="wf-markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
