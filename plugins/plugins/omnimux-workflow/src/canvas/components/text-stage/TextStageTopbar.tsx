import React from 'react';
import {
  Undo2,
  Redo2,
  History,
  Save,
  Search,
  X,
} from 'lucide-react';
import { useTextStageStore } from '../../store/textStageStore';
import { useT } from '../../i18n';

export const TextStageTopbar: React.FC = () => {
  const t = useT();
  const {
    versions,
    isDrawerOpen,
    isSearchOpen,
    toggleDrawer,
    toggleSearch,
    save,
    closeStage,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTextStageStore();

  return (
    <header className="wf-text-stage-topbar">
      {/* 纯图标按钮组 (撤销/重做、快照历史、保存、搜索、关闭) */}
      <div className="wf-text-stage-topbar__right">
        {/* 撤销 / 重做 */}
        <button
          type="button"
          className="wf-text-stage-btn wf-text-stage-btn--icon"
          onClick={undo}
          disabled={!canUndo()}
          title={t('textStage.undo') || '撤销 (Cmd+Z)'}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="wf-text-stage-btn wf-text-stage-btn--icon"
          onClick={redo}
          disabled={!canRedo()}
          title={t('textStage.redo') || '重做 (Cmd+Shift+Z)'}
        >
          <Redo2 size={16} />
        </button>

        <div className="wf-text-stage-divider" />

        {/* 历史版本 / 快照 */}
        <button
          type="button"
          className={`wf-text-stage-btn wf-text-stage-btn--icon ${isDrawerOpen ? 'is-active' : ''}`}
          onClick={toggleDrawer}
          title={t('textStage.versionHistory') || '历史版本与快照'}
        >
          <History size={16} />
          {versions.length > 0 && (
            <span className="wf-text-stage-badge wf-text-stage-badge--dot" />
          )}
        </button>

        {/* 保存 */}
        <button
          type="button"
          className="wf-text-stage-btn wf-text-stage-btn--icon"
          onClick={save}
          title={t('textStage.save') || '保存 (Cmd+S)'}
        >
          <Save size={16} />
        </button>

        {/* 搜索 */}
        <button
          type="button"
          className={`wf-text-stage-btn wf-text-stage-btn--icon ${isSearchOpen ? 'is-active' : ''}`}
          onClick={toggleSearch}
          title={t('textStage.search') || '查找 (Cmd+F)'}
        >
          <Search size={16} />
        </button>

        {/* 关闭 */}
        <button
          type="button"
          className="wf-text-stage-btn wf-text-stage-btn--icon wf-text-stage-btn--close"
          onClick={closeStage}
          title={t('textStage.close') || '关闭 (ESC)'}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
};
