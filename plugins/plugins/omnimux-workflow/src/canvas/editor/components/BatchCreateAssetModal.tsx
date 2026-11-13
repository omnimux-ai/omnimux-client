import React, { memo, useEffect, useMemo, useState } from 'react';
import { PackagePlus, Folder } from 'lucide-react';
import { CustomModal, toast } from '../../ui';
import { useT } from '../../i18n';
import { extractLibraryFilesFromNodes } from '../utils/extractLibraryFiles';

export interface MediaAssetItem {
  id: string;
  nodeId: string;
  nodeTitle: string;
  type: 'image' | 'video' | 'audio' | 'text';
  previewUrl?: string;
  content?: string;
  realPath?: string;
}

export interface BatchCreateAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MediaAssetItem[];
}

const SCOPE_KEYS = [
  { value: 'character', key: 'asset.scope.character' },
  { value: 'scene', key: 'asset.scope.scene' },
  { value: 'prop', key: 'asset.scope.prop' },
  { value: 'style', key: 'asset.scope.style' },
  { value: 'knowledge', key: 'asset.scope.knowledge' },
  { value: 'custom', key: 'asset.scope.custom' },
] as const;

export const BatchCreateAssetModal: React.FC<BatchCreateAssetModalProps> = memo(({
  isOpen,
  onClose,
  items,
}) => {
  const t = useT();
  const [selectedScope, setSelectedScope] = useState('character');
  const [assetName, setAssetName] = useState('');
  const [tags, setTags] = useState(t('asset.modal.defaultTags'));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const files = useMemo(
    () => extractLibraryFilesFromNodes(items.map((item) => ({
      id: item.nodeId || item.id,
      data: {
        title: item.nodeTitle,
        label: item.nodeTitle,
        realPath: item.realPath,
        previewUrl: item.previewUrl,
        content: item.content,
        materialType: item.type,
      },
    }))),
    [items],
  );

  useEffect(() => {
    if (!isOpen) return;
    const nextName = (items[0]?.nodeTitle || t('asset.modal.defaultName')).slice(0, 40);
    setAssetName(nextName);
    setSelectedScope('character');
    setTags(t('asset.modal.defaultTags'));
    setIsSubmitting(false);
  }, [isOpen, items, t]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      toast.error(t('asset.modal.noFiles'));
      return;
    }
    const name = assetName.trim().slice(0, 40);
    if (!name) {
      toast.warning(t('asset.modal.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const tagList = tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
      const response = await fetch('/omnimux/assets/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type: selectedScope,
          tags: tagList,
          files: files.map((file) => ({
            real_path: file.real_path,
            original_name: file.original_name,
          })),
          source: 'workflow-canvas',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || body.error || `HTTP ${response.status}`);
      }
      const asset = body.asset || {};
      const label = asset.name || name;
      toast.success(t('asset.modal.saved').replace('{name}', label));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('asset.modal.failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CustomModal
      open={isOpen}
      onCancel={onClose}
      title={t('asset.modal.title')}
      width={480}
    >
      <form onSubmit={handleSubmit} className="wf-group-modal">
        <div>
          <label className="wf-group-modal__label">{t('asset.modal.name')}</label>
          <input
            type="text"
            className="nodrag nopan wf-group-modal__input"
            value={assetName}
            onChange={(e) => setAssetName(e.target.value)}
            placeholder={items[0]?.nodeTitle || t('asset.modal.defaultName')}
            maxLength={40}
          />
        </div>

        <div>
          <label className="wf-group-modal__label">{t('asset.modal.category')}</label>
          <div className="wf-group-modal__scopes">
            {SCOPE_KEYS.map((scope) => (
              <button
                key={scope.value}
                type="button"
                className={`wf-group-modal__scope ${selectedScope === scope.value ? 'is-active' : ''}`}
                onClick={() => setSelectedScope(scope.value)}
              >
                <Folder size={14} />
                <span>{t(scope.key)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="wf-group-modal__label">{t('asset.modal.files').replace('{count}', String(files.length))}</label>
          <div className="wf-group-modal__list">
            {files.length === 0 ? (
              <div className="wf-group-modal__empty">{t('asset.modal.empty')}</div>
            ) : (
              files.map((file) => (
                <div key={file.real_path} className="wf-group-modal__row">
                  <span>{file.original_name || file.nodeId}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="wf-group-modal__label">{t('asset.modal.tags')}</label>
          <input
            type="text"
            className="nodrag nopan wf-group-modal__input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t('asset.modal.tagsPlaceholder')}
          />
        </div>

        <div className="wf-group-modal__actions">
          <button type="button" className="wf-group-modal__btn" onClick={onClose}>{t('asset.modal.cancel')}</button>
          <button type="submit" className="wf-group-modal__btn wf-group-modal__btn--primary" disabled={isSubmitting || files.length === 0}>
            <PackagePlus size={14} />
            <span>{isSubmitting ? t('asset.modal.saving') : t('asset.modal.submit')}</span>
          </button>
        </div>
      </form>
    </CustomModal>
  );
});

BatchCreateAssetModal.displayName = 'BatchCreateAssetModal';
