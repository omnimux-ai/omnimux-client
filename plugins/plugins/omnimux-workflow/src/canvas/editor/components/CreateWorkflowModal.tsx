import React, { memo, useEffect, useState } from 'react';
import { FileCode } from 'lucide-react';
import { CustomModal, toast } from '../../ui';
import { useT } from '../../i18n';

export interface CreateWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId?: string;
  defaultTitle?: string;
  nodeCount?: number;
  onConfirm: (payload: { name: string; description: string; tags: string[] }) => Promise<void>;
}

export const CreateWorkflowModal: React.FC<CreateWorkflowModalProps> = memo(({
  isOpen,
  onClose,
  defaultTitle,
  nodeCount = 0,
  onConfirm,
}) => {
  const t = useT();
  const fallbackName = t('template.modal.defaultName');
  const [name, setName] = useState(defaultTitle || fallbackName);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState(t('template.modal.defaultTags'));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName((defaultTitle || fallbackName).trim() || fallbackName);
    setDescription('');
    setTags(t('template.modal.defaultTags'));
    setIsSubmitting(false);
  }, [isOpen, defaultTitle, fallbackName, t]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.warning(t('template.modal.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const tagList = tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
      await onConfirm({
        name: name.trim(),
        description: description.trim(),
        tags: tagList,
      });
      toast.success(t('template.modal.saved').replace('{name}', name.trim()));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('template.modal.failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CustomModal
      open={isOpen}
      onCancel={onClose}
      title={t('template.modal.title')}
      width={460}
    >
      <form onSubmit={handleSubmit} className="wf-group-modal">
        <div>
          <label className="wf-group-modal__label">{t('template.modal.name')}</label>
          <input
            type="text"
            className="nodrag nopan wf-group-modal__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('template.modal.namePlaceholder')}
            autoFocus
          />
        </div>

        <div>
          <label className="wf-group-modal__label">{t('template.modal.description')}</label>
          <textarea
            className="nodrag nopan wf-group-modal__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('template.modal.descriptionPlaceholder')}
            rows={3}
          />
        </div>

        <div>
          <label className="wf-group-modal__label">{t('template.modal.tags')}</label>
          <input
            type="text"
            className="nodrag nopan wf-group-modal__input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t('template.modal.tagsPlaceholder')}
          />
        </div>

        <div className="wf-group-modal__hint">
          {t('template.modal.hint').replace('{count}', String(nodeCount))}
        </div>

        <div className="wf-group-modal__actions">
          <button type="button" className="wf-group-modal__btn" onClick={onClose}>{t('template.modal.cancel')}</button>
          <button type="submit" className="wf-group-modal__btn wf-group-modal__btn--primary" disabled={isSubmitting || !name.trim()}>
            <FileCode size={14} />
            <span>{isSubmitting ? t('template.modal.saving') : t('template.modal.submit')}</span>
          </button>
        </div>
      </form>
    </CustomModal>
  );
});

CreateWorkflowModal.displayName = 'CreateWorkflowModal';
