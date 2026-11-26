import React, { useMemo } from 'react';
import { renderSafeMarkdownHtml } from './safeMarkdown';

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
  const html = useMemo(() => renderSafeMarkdownHtml(content), [content]);

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
