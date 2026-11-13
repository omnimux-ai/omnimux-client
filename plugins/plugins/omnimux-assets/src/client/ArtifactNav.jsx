import { activateRowKeydown } from './a11y.js'
import { FolderCheckIcon } from './icons.jsx'

const group = {
  padding: '8px 12px 4px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const groupHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: 0.2,
  color: 'var(--dsw-alias-label-secondary, var(--dsw-text-secondary, rgba(128,128,128,.9)))',
  padding: '0 8px 6px',
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 8px 0 22px', // indented under the group header — visual hierarchy
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '20px',
}

const label = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const count = { flex: 'none', fontSize: 11, opacity: 0.7 }

const BUCKETS = ['image', 'video', 'audio', 'document', 'html', 'json']

/**
 * Left-nav group 2: all artifacts plus one row per present type bucket.
 * @param {{
 *   t: (key: string) => string,
 *   artifacts: any[],
 *   activeType: string | null,
 *   onSelect: (type: string) => void,
 * }} props
 */
export function ArtifactNav({ t, artifacts, activeType, onSelect }) {
  const counts = {}
  for (const artifact of artifacts) {
    const type = typeof artifact.type === 'string' ? artifact.type : 'other'
    counts[type] = (counts[type] ?? 0) + 1
  }

  const renderRow = (key, text, value, active, rowCount) => (
    <div
      key={key}
      className="omnimux-assets-focusable"
      tabIndex={0}
      role="button"
      aria-label={String(text)}
      onKeyDown={activateRowKeydown(() => { onSelect(value) })}
      style={{
        ...row,
        background: active
          ? 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.18))'
          : 'transparent',
      }}
      onClick={() => { onSelect(value) }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = active
          ? 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.18))'
          : 'transparent'
      }}
    >
      <span style={label}>{text}</span>
      <span style={count}>{rowCount}</span>
    </div>
  )

  return (
    <div style={group}>
      <div style={groupHeader}>
        <FolderCheckIcon />
        {t('artifact.group')}
      </div>
      {renderRow('all', t('artifact.all'), '', activeType === '', artifacts.length)}
      {BUCKETS.filter((bucket) => (counts[bucket] ?? 0) > 0).map((bucket) => (
        renderRow(bucket, t(`type.${bucket}`), bucket, activeType === bucket, counts[bucket])
      ))}
    </div>
  )
}
