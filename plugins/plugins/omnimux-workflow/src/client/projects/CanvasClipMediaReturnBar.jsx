import { useId, useState, useSyncExternalStore } from 'react'
import { Button } from 'dsh-ui-kit'
import { sameClipMediaOutput, selectedStudioReturnRows } from '../../canvas/bridge/clipMediaOutputs.ts'

const emptyOutputs = Object.freeze([])
const getEmptyOutputs = () => emptyOutputs
const subscribeNothing = () => () => {}

export function CanvasClipMediaReturnBar({ manager, state, t }) {
  const { record, adapter, isCurrent, mediaReturn } = state
  const { transfer, busy, error } = record
  const studio = transfer.mode === 'standalone'
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState(() => new Map())
  const listId = useId()
  const outputs = useSyncExternalStore(
    studio && adapter ? adapter.subscribeOutputs : subscribeNothing,
    studio && adapter ? adapter.getOutputs : getEmptyOutputs,
  )
  const text = (key, value) => {
    const translated = t(`clipMediaReturn.${key}`)
    return value === undefined ? translated : translated.replace(/\{\w+\}/, () => value)
  }
  const title = text(studio ? 'studioTitle' : 'canvasTitle', transfer.title)

  const finish = cancel => manager.run(transfer, async () => {
    if (!isCurrent()) return 'retry'
    if (!studio) return adapter?.reopen(transfer, mediaReturn, isCurrent)
    if (cancel) return transfer.returnToStudio([])
    if (!adapter?.isReady() || selected.size === 0) return 'retry'
    const live = adapter.getOutputs()
    const rows = selectedStudioReturnRows(live, [...selected.values()])
    if (!rows) {
      setSelected(new Map(live.filter(row => sameClipMediaOutput(selected.get(row.id), row)).map(row => [row.id, row])))
      setExpanded(true)
      return 'changed'
    }
    if (!isCurrent()) return 'retry'
    return transfer.returnToStudio(rows)
  })

  function toggle(row) {
    setSelected(current => {
      const next = new Map(current)
      if (sameClipMediaOutput(next.get(row.id), row)) next.delete(row.id)
      else next.set(row.id, row)
      return next
    })
  }

  const confirmLabel = !studio ? text(error === 'retry' ? 'retry' : 'continue')
    : text(error === 'retry' && selected.size > 0 ? 'retry' : 'import', selected.size)

  return (
    <section className="omnimux-workflow-clip-return" aria-label={title}>
      <div className="omnimux-workflow-clip-return-row">
        <div className="omnimux-workflow-clip-return-title" title={title}>{title}</div>
        <div className="omnimux-workflow-clip-return-actions">
          {studio && <Button size="sm" variant="outline" aria-expanded={expanded} aria-controls={listId}
            onClick={() => setExpanded(value => !value)} disabled={busy}>{text('choose')}</Button>}
          <Button size="sm" variant="primary" loading={busy && (!studio || selected.size > 0)}
            disabled={busy || !adapter || (studio && selected.size === 0)} onClick={() => void finish(false)}>{confirmLabel}</Button>
          {studio && <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => void finish(true)}>{text('cancel')}</Button>}
        </div>
      </div>
      {studio && <div className="omnimux-workflow-clip-return-outputs" id={listId} hidden={!expanded}>
        {outputs.map(row => (
          <Button key={row.id} variant={sameClipMediaOutput(selected.get(row.id), row) ? 'secondary' : 'outline'}
            size="sm" className="omnimux-workflow-clip-return-output" title={row.name}
            aria-pressed={sameClipMediaOutput(selected.get(row.id), row)} disabled={busy} onClick={() => toggle(row)}>
            <span className="omnimux-workflow-clip-return-name">{row.name}</span>
            <span className="omnimux-workflow-clip-return-type">{text(row.type)}</span>
          </Button>
        ))}
        {!outputs.length && <span className="omnimux-workflow-clip-return-type">{text('empty')}</span>}
      </div>}
      {error && <div className="omnimux-workflow-clip-return-error" role="alert">{text(error === 'changed' ? 'changed' : 'failed')}</div>}
    </section>
  )
}
