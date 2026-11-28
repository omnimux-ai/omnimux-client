/**
 * Stylesheet for omnimux-tiktok-selection Stage.
 * Consumes official --dsw-alias-* / --dsw-specific-* tokens only.
 */

export const STYLES_ID = 'omnimux-tiktok-selection-styles'

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
.omnimux-ttsel-stage {
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
.omnimux-ttsel-stage[data-visible="false"] {
  display: none !important;
  pointer-events: none;
}
.omnimux-ttsel-stage *,
.omnimux-ttsel-stage *::before,
.omnimux-ttsel-stage *::after {
  box-sizing: border-box;
}
.omnimux-ttsel-stage-body {
  display: flex;
  flex-direction: column;
}
.omnimux-ttsel-tabs-wrap {
  padding: 8px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
}
.omnimux-ttsel-content {
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.omnimux-ttsel-card {
  background: var(--dsw-alias-bg-layer, var(--dsw-alias-bg-base));
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.omnimux-ttsel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.omnimux-ttsel-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.omnimux-ttsel-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-range {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
}
.omnimux-ttsel-range-sep {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.omnimux-ttsel-textarea {
  width: 100%;
  min-height: 92px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-default));
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.omnimux-ttsel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.omnimux-ttsel-row-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.omnimux-ttsel-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer, var(--dsw-alias-bg-base));
}
.omnimux-ttsel-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
  font-size: 13px;
}
.omnimux-ttsel-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-subtle));
  border-bottom: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
}
.omnimux-ttsel-table td {
  padding: 10px 12px;
  vertical-align: middle;
  border-bottom: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omnimux-ttsel-table tr:last-child td {
  border-bottom: none;
}
.omnimux-ttsel-table tbody tr:hover td {
  background: var(--dsw-alias-interactive-bg-hover);
}
.omnimux-ttsel-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.omnimux-ttsel-prod-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 340px;
}
.omnimux-ttsel-thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-muted));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-title-clamp {
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.omnimux-ttsel-stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(140px, 1fr));
  gap: 10px;
  overflow-x: auto;
}
.omnimux-ttsel-step {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-subtle));
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font: inherit;
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              border-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--omnimux-motion-dur-press, 90ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omnimux-ttsel-step:hover {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}
.omnimux-ttsel-step:active {
  transform: scale(var(--omnimux-motion-press-scale-subtle, 0.985));
}
.omnimux-ttsel-step[data-active="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer, var(--dsw-alias-bg-base));
}
.omnimux-ttsel-step-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.omnimux-ttsel-log {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-subtle));
  color: var(--dsw-alias-label-secondary);
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.omnimux-ttsel-popover-anchor {
  position: relative;
  display: inline-flex;
}
.omnimux-ttsel-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 210px;
  z-index: 60;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-default));
  background: var(--dsw-alias-bg-layer, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-specific-shadow-popover, var(--dsw-shadow-popover));
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: omnimux-ttsel-popover-enter var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omnimux-ttsel-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omnimux-ttsel-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-hover));
}
.omnimux-ttsel-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}
.omnimux-ttsel-kv {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  font-size: 13px;
}
.omnimux-ttsel-kv-k {
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-kv-v {
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.omnimux-ttsel-evidence-pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-subtle));
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  border-radius: 8px;
  padding: 12px 14px;
  max-height: 55vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.omnimux-ttsel-video-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.omnimux-ttsel-video-item {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-subtle));
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-subtle));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.omnimux-ttsel-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.omnimux-ttsel-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 120;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-default));
  background: var(--dsw-alias-bg-layer, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-specific-shadow-popover, var(--dsw-shadow-popover));
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  animation: omnimux-ttsel-toast-enter var(--omnimux-motion-dur-base, 200ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omnimux-ttsel-error-banner {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-state-danger, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-secondary, var(--dsw-alias-bg-subtle));
  color: var(--dsw-alias-state-danger, var(--dsw-alias-label-primary));
  font-size: 13px;
  animation: omnimux-ttsel-toast-enter var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
@keyframes omnimux-ttsel-popover-enter {
  from { opacity: 0.94; transform: translateY(-4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes omnimux-ttsel-toast-enter {
  from { opacity: 0.94; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 820px) {
  .omnimux-ttsel-tabs-wrap,
  .omnimux-ttsel-content {
    padding-left: 12px;
    padding-right: 12px;
  }
  .omnimux-ttsel-stepper {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .omnimux-ttsel-kv-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .omnimux-ttsel-menu,
  .omnimux-ttsel-toast,
  .omnimux-ttsel-error-banner {
    animation: none;
  }
  .omnimux-ttsel-table td,
  .omnimux-ttsel-step,
  .omnimux-ttsel-menu-item {
    transition: none;
  }
  .omnimux-ttsel-step:active {
    transform: none;
  }
}
`

export function injectTiktokSelectionStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}
