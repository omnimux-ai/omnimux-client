import React, { useEffect, useState } from 'react';
import { useTextStageStore } from '../../store/textStageStore';
import { TextStageTopbar } from './TextStageTopbar';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { VersionDrawer } from './VersionDrawer';
import { VersionDiffModal } from './VersionDiffModal';

export const TextStage: React.FC = () => {
  const {
    isStageOpen,
    content,
    setContent,
    closeStage,
    save,
    isDrawerOpen,
    setDrawerOpen,
    diffModal,
    closeDiffModal,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTextStageStore();

  const [everOpened, setEverOpened] = useState(false);
  if (isStageOpen && !everOpened) {
    setEverOpened(true);
  }

  // 快捷键全局监听 (Escape, Cmd+S, Cmd+Z, Cmd+Shift+Z)
  useEffect(() => {
    if (!isStageOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        if (diffModal.isOpen) {
          closeDiffModal();
          return;
        }
        if (isDrawerOpen) {
          setDrawerOpen(false);
          return;
        }
        closeStage();
        return;
      }

      // 保存 Cmd+S / Ctrl+S
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }

      // 全局撤销/重做（在非编辑器焦点时或按键捕获）
      if (mod && e.key.toLowerCase() === 'z') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'textarea' && !document.activeElement?.classList.contains('cm-content')) {
          if (e.shiftKey) {
            if (canRedo()) {
              e.preventDefault();
              redo();
            }
          } else {
            if (canUndo()) {
              e.preventDefault();
              undo();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isStageOpen, diffModal.isOpen, isDrawerOpen, closeDiffModal, setDrawerOpen, closeStage, save, undo, redo, canUndo, canRedo]);

  if (!everOpened) return null;

  return (
    <div
      className="wf-text-stage-overlay wf-canvas-root"
      hidden={!isStageOpen}
      data-visible={isStageOpen ? 'true' : 'false'}
      aria-hidden={isStageOpen ? undefined : 'true'}
      style={{
        display: isStageOpen ? 'flex' : 'none',
      }}
    >
      {/* 顶部工具栏 */}
      <TextStageTopbar />

      {/* 核心所见即所得编辑区 */}
      <main className="wf-text-stage-workspace">
        <div className="wf-text-stage-body wf-text-stage-body--live">
          <section className="wf-text-stage-pane wf-text-stage-pane--live">
            <CodeMirrorEditor
              value={content}
              onChange={setContent}
              className="wf-text-stage-cm"
            />
          </section>
        </div>

        {/* 历史版本右侧抽屉 */}
        <VersionDrawer />
      </main>

      {/* 差异对比弹窗 */}
      <VersionDiffModal />
    </div>
  );
};
