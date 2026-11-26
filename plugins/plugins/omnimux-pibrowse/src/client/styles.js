/**
 * Stylesheet for omnimux-pibrowse Stage.
 * Consumes official allowlisted --dsw-alias-* / --dsw-specific-* tokens only.
 */

export const STYLES_ID = 'omnimux-pibrowse-styles'

export const STYLES = `
.omx-stage-sticky {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--dsw-alias-bg-base, var(--dsw-bg, #111215));
}
.omx-stage-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.omnimux-pibrowse-stage {
  --dsw-bg: var(--dsw-alias-bg-base);
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  pointer-events: auto;
}
.omnimux-pibrowse-stage[data-visible="false"] {
  display: none !important;
  pointer-events: none;
}
.omnimux-pibrowse-stage *,
.omnimux-pibrowse-stage *::before,
.omnimux-pibrowse-stage *::after {
  box-sizing: border-box;
}
.omnimux-pibrowse-stage-body {
  display: flex;
  flex-direction: column;
}
.omnimux-pibrowse-tabs-wrap {
  padding: 6px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.omnimux-pibrowse-content {
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.omnimux-pibrowse-card {
  background: var(--dsw-alias-card-fill);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.omnimux-pibrowse-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.omnimux-pibrowse-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.omnimux-pibrowse-two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.omnimux-pibrowse-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.omnimux-pibrowse-row-nowrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}
.omnimux-pibrowse-row-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.omnimux-pibrowse-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  flex-wrap: wrap;
}
.omnimux-pibrowse-notice[data-tone="error"] {
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-state-error-secondary);
}
.omnimux-pibrowse-notice-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 240px;
  min-width: 0;
}
.omnimux-pibrowse-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-card-fill);
}
.omnimux-pibrowse-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
  font-size: 13px;
}
.omnimux-pibrowse-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.omnimux-pibrowse-table td {
  padding: 10px 12px;
  vertical-align: middle;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.omnimux-pibrowse-table tr:last-child td {
  border-bottom: none;
}
.omnimux-pibrowse-table tr:hover td {
  background: var(--dsw-alias-card-fill-hover);
}
.omnimux-pibrowse-kv-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.omnimux-pibrowse-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 13px;
}
.omnimux-pibrowse-kv:last-child {
  border-bottom: none;
}
.omnimux-pibrowse-kv-k {
  color: var(--dsw-alias-label-secondary);
  flex-shrink: 0;
}
.omnimux-pibrowse-kv-v {
  font-weight: 500;
  text-align: right;
  word-break: break-word;
  color: var(--dsw-alias-label-primary);
}
.omnimux-pibrowse-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.omnimux-pibrowse-muted {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-pibrowse-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.omnimux-pibrowse-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-pibrowse-textarea {
  width: 100%;
  min-height: 112px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}
.omnimux-pibrowse-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}
.omnimux-pibrowse-progress-fill {
  height: 100%;
  width: var(--pb-progress, 0%);
  background: var(--dsw-alias-brand-primary);
  border-radius: 999px;
  transition: width 150ms ease;
}
.omnimux-pibrowse-verify-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.omnimux-pibrowse-log {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.omnimux-pibrowse-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.omnimux-pibrowse-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 120;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-md);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-menu);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
  font-size: 13px;
}
.omnimux-pibrowse-toast[data-error="true"] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
@media (max-width: 820px) {
  .omnimux-pibrowse-tabs-wrap,
  .omnimux-pibrowse-content {
    padding-left: 12px;
    padding-right: 12px;
  }
  .omnimux-pibrowse-two-col {
    grid-template-columns: 1fr;
  }
}
`

export function injectPibrowseStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}
