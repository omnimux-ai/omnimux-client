import React, { useEffect, useRef } from 'react';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import { X, GitCompare, RotateCcw } from 'lucide-react';
import { useTextStageStore } from '../../store/textStageStore';
import { dshCodeMirrorTheme, dshMarkdownHighlighting } from './cmTheme';
import { useT } from '../../i18n';

export const VersionDiffModal: React.FC = () => {
  const t = useT();
  const { diffModal, closeDiffModal, content, revertToSnapshot } = useTextStageStore();
  const mergeContainerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  const snapshot = diffModal.snapshot;

  useEffect(() => {
    if (!diffModal.isOpen || !snapshot || !mergeContainerRef.current) {
      return;
    }

    // 清理旧实例
    if (mergeViewRef.current) {
      mergeViewRef.current.destroy();
      mergeViewRef.current = null;
    }

    const commonExtensions = [
      lineNumbers(),
      markdown(),
      EditorView.lineWrapping,
      dshCodeMirrorTheme,
      dshMarkdownHighlighting,
    ];

    try {
      const mv = new MergeView({
        a: {
          doc: snapshot.content,
          extensions: [
            ...commonExtensions,
            EditorState.readOnly.of(true),
          ],
        },
        b: {
          doc: content,
          extensions: [
            ...commonExtensions,
            EditorState.readOnly.of(true),
          ],
        },
        parent: mergeContainerRef.current,
        orientation: 'a-b', // 左侧为快照历史版本，右侧为当前内容
        revertControls: 'a-to-b',
      });

      mergeViewRef.current = mv;
    } catch (e) {
      console.error('Failed to initialize MergeView:', e);
    }

    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy();
        mergeViewRef.current = null;
      }
    };
  }, [diffModal.isOpen, snapshot, content]);

  if (!diffModal.isOpen || !snapshot) return null;

  const handleRevert = () => {
    revertToSnapshot(snapshot.id);
    closeDiffModal();
  };

  return (
    <div className="wf-diff-modal-backdrop" onClick={closeDiffModal}>
      <div className="wf-diff-modal" onClick={(e) => e.stopPropagation()}>
        {/* 对话框头部 */}
        <div className="wf-diff-modal__header">
          <div className="wf-diff-modal__title">
            <GitCompare size={18} className="wf-diff-modal__icon" />
            <div>
              <div className="wf-diff-modal__heading">
                {t('textStage.diffModalTitle') || '版本差异对比'}
              </div>
              <div className="wf-diff-modal__subheading">
                <span>{snapshot.name}</span>
                <span className="wf-diff-modal__time">
                  ({new Date(snapshot.timestamp).toLocaleString()})
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="wf-text-stage-btn wf-text-stage-btn--icon"
            onClick={closeDiffModal}
            title={t('textStage.close') || '关闭'}
          >
            <X size={16} />
          </button>
        </div>

        {/* 对比列标头 */}
        <div className="wf-diff-modal__column-headers">
          <div className="wf-diff-modal__column-label wf-diff-modal__column-label--old">
            {t('textStage.diffOldLabel') || '快照历史版本（只读）'}
          </div>
          <div className="wf-diff-modal__column-label wf-diff-modal__column-label--new">
            {t('textStage.diffNewLabel') || '当前正在编辑内容'}
          </div>
        </div>

        {/* CodeMirror Merge 对比容器 */}
        <div className="wf-diff-modal__body" ref={mergeContainerRef} />

        {/* 底部操作条 */}
        <div className="wf-diff-modal__footer">
          <div className="wf-diff-modal__footer-tip">
            {t('textStage.diffRevertTip') || '点击应用将把当前文本内容整体恢复至该快照版本。'}
          </div>
          <div className="wf-diff-modal__footer-actions">
            <button
              type="button"
              className="wf-text-stage-btn"
              onClick={closeDiffModal}
            >
              {t('textStage.cancel') || '取消'}
            </button>
            <button
              type="button"
              className="wf-text-stage-btn wf-text-stage-btn--primary"
              onClick={handleRevert}
            >
              <RotateCcw size={14} />
              <span>{t('textStage.applyVersion') || '恢复为此版本'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
