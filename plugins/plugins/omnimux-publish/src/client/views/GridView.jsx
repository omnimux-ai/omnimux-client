import React from 'react'
import { AssetCard } from './AssetCard.jsx'

/**
 * 网格卡片视图 (GridView)
 * 严格遵循 spec-ui-client-v2.4.md: 卡片流网格间距 gap: 12px。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   records: Array<Record<string, unknown>>,
 *   selectedIds: Set<string>,
 *   isBatchMode: boolean,
 *   onToggleSelect: (id: string) => void,
 *   onOpen: (record: Record<string, unknown>) => void,
 *   onEdit: (record: Record<string, unknown>) => void,
 *   onDelete: (record: Record<string, unknown>) => void,
 *   onRetry: (record: Record<string, unknown>) => void,
 * }} props
 */
export function GridView({
  t,
  records,
  selectedIds,
  isBatchMode,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onRetry,
}) {
  if (!records || records.length === 0) {
    return (
      <div className="omnimux-publish-empty-card">
        <div className="omnimux-publish-empty-title">{t('records.empty.all')}</div>
        <div className="omnimux-publish-empty-hint">{t('records.empty.all.hint')}</div>
      </div>
    )
  }

  return (
    <div className="omnimux-publish-grid-container">
      {records.map((record) => (
        <AssetCard
          key={String(record.id)}
          t={t}
          record={record}
          isSelected={selectedIds.has(String(record.id))}
          isBatchMode={isBatchMode}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onEdit={onEdit}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}
