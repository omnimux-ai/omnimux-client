import React, { useState } from 'react';
import {
  X,
  Plus,
  GitCompare,
  RotateCcw,
  Trash2,
  Clock,
  History,
  Tag,
} from 'lucide-react';
import { useTextStageStore } from '../../store/textStageStore';
import { useT } from '../../i18n';
import type { TextVersionSnapshot } from '../../../shared/graph/materialNode';

export const VersionDrawer: React.FC = () => {
  const t = useT();
  const {
    isDrawerOpen,
    setDrawerOpen,
    versions,
    createSnapshot,
    revertToSnapshot,
    deleteSnapshot,
    openDiffModal,
  } = useTextStageStore();

  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  if (!isDrawerOpen) return null;

  const handleCreate = () => {
    createSnapshot(newSnapshotName, 'manual');
    setNewSnapshotName('');
    setIsCreating(false);
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const getSourceLabel = (source?: TextVersionSnapshot['source']) => {
    switch (source) {
      case 'auto':
        return t('textStage.sourceAuto') || '自动保存';
      case 'revert':
        return t('textStage.sourceRevert') || '回滚';
      case 'import':
        return t('textStage.sourceImport') || '导入';
      case 'manual':
      default:
        return t('textStage.sourceManual') || '手动快照';
    }
  };

  return (
    <aside className="wf-text-stage-drawer">
      {/* 抽屉头部 */}
      <div className="wf-text-stage-drawer__header">
        <div className="wf-text-stage-drawer__title">
          <History size={16} />
          <span>{t('textStage.versionHistory') || '版本历史'}</span>
          <span className="wf-text-stage-drawer__count">{versions.length}</span>
        </div>
        <button
          type="button"
          className="wf-text-stage-btn wf-text-stage-btn--icon"
          onClick={() => setDrawerOpen(false)}
          title={t('textStage.closeDrawer') || '关闭抽屉'}
        >
          <X size={15} />
        </button>
      </div>

      {/* 快速新建快照 */}
      <div className="wf-text-stage-drawer__create">
        {isCreating ? (
          <div className="wf-text-stage-drawer__create-form">
            <input
              type="text"
              className="wf-text-stage-input"
              placeholder={t('textStage.snapshotNamePlaceholder') || '输入快照名称（如：第一幕初稿）...'}
              value={newSnapshotName}
              onChange={(e) => setNewSnapshotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              autoFocus
            />
            <div className="wf-text-stage-drawer__create-actions">
              <button
                type="button"
                className="wf-text-stage-btn wf-text-stage-btn--sm"
                onClick={() => setIsCreating(false)}
              >
                {t('textStage.cancel') || '取消'}
              </button>
              <button
                type="button"
                className="wf-text-stage-btn wf-text-stage-btn--primary wf-text-stage-btn--sm"
                onClick={handleCreate}
              >
                {t('textStage.confirmCreate') || '保存快照'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="wf-text-stage-btn wf-text-stage-btn--full wf-text-stage-btn--dashed"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={14} />
            <span>{t('textStage.newSnapshot') || '新建版本快照'}</span>
          </button>
        )}
      </div>

      {/* 版本列表 */}
      <div className="wf-text-stage-drawer__list">
        {versions.length === 0 ? (
          <div className="wf-text-stage-drawer__empty">
            <Clock size={32} className="wf-text-stage-drawer__empty-icon" />
            <p>{t('textStage.noVersions') || '暂无历史快照'}</p>
            <span className="wf-text-stage-drawer__empty-desc">
              {t('textStage.noVersionsDesc') || '创建快照可随时对比与回滚文本版本'}
            </span>
          </div>
        ) : (
          versions.map((ver) => (
            <div key={ver.id} className="wf-version-card">
              <div className="wf-version-card__header">
                <span className="wf-version-card__name" title={ver.name}>
                  {ver.name}
                </span>
                <span className={`wf-version-card__tag wf-version-card__tag--${ver.source || 'manual'}`}>
                  <Tag size={10} />
                  <span>{getSourceLabel(ver.source)}</span>
                </span>
              </div>

              <div className="wf-version-card__meta">
                <span className="wf-version-card__time">{formatTime(ver.timestamp)}</span>
                {ver.wordCount !== undefined && (
                  <span className="wf-version-card__stats">
                    {ver.wordCount} {t('textStage.words') || '词'} / {ver.charCount} {t('textStage.chars') || '字'}
                  </span>
                )}
              </div>

              <div className="wf-version-card__actions">
                <button
                  type="button"
                  className="wf-text-stage-btn wf-text-stage-btn--sm"
                  onClick={() => openDiffModal(ver)}
                  title={t('textStage.diffHint') || '与当前编辑内容对比差异'}
                >
                  <GitCompare size={13} />
                  <span>{t('textStage.diff') || '差异对比'}</span>
                </button>
                <button
                  type="button"
                  className="wf-text-stage-btn wf-text-stage-btn--sm"
                  onClick={() => {
                    if (window.confirm(t('textStage.revertConfirm') || `确认回滚到「${ver.name}」吗？当前未保存内容可随时通过撤销找回。`)) {
                      revertToSnapshot(ver.id);
                    }
                  }}
                  title={t('textStage.revertHint') || '将内容回滚至此版本'}
                >
                  <RotateCcw size={13} />
                  <span>{t('textStage.revert') || '回滚'}</span>
                </button>
                <button
                  type="button"
                  className="wf-text-stage-btn wf-text-stage-btn--sm wf-text-stage-btn--danger-text"
                  onClick={() => {
                    if (window.confirm(t('textStage.deleteConfirm') || `确认删除快照「${ver.name}」吗？`)) {
                      deleteSnapshot(ver.id);
                    }
                  }}
                  title={t('textStage.delete') || '删除快照'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
