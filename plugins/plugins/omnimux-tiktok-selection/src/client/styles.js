/**
 * Stylesheet for omnimux-tiktok-selection Stage.
 * Consumes official allowlisted --dsw-alias-* / --dsw-elevation-* / --dsw-shadow-* tokens only.
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
  padding: 6px 20px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.omnimux-ttsel-content {
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.omnimux-ttsel-card {
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.omnimux-ttsel-panel-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.omnimux-ttsel-drawer-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.omnimux-ttsel-stack-12 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.omnimux-ttsel-minw0 {
  min-width: 0;
}
.omnimux-ttsel-col-check {
  width: 36px;
}
.omnimux-ttsel-col-actions {
  width: 96px;
}
.omnimux-ttsel-push-end {
  margin-left: auto;
}
.omnimux-ttsel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}
.omnimux-ttsel-toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.omnimux-ttsel-bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-state-business-tertiary);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
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
  color: var(--dsw-alias-label-primary);
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
  color: var(--dsw-alias-label-tertiary);
}
.omnimux-ttsel-textarea {
  width: 100%;
  min-height: 92px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
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
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}
.omnimux-ttsel-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;
  font-size: 13px;
}
.omnimux-ttsel-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.omnimux-ttsel-table td {
  padding: 10px 12px;
  vertical-align: middle;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omnimux-ttsel-table tr:last-child td {
  border-bottom: none;
}
.omnimux-ttsel-table tbody tr:hover td {
  background: var(--dsw-alias-interactive-bg-hover);
}
.omnimux-ttsel-row-clickable {
  cursor: pointer;
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
  max-width: 380px;
}
.omnimux-ttsel-thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-table .omnimux-ttsel-title-btn {
  display: block;
  width: 100%;
  height: auto;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  white-space: normal;
  justify-content: flex-start;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.omnimux-ttsel-table .omnimux-ttsel-title-btn:hover {
  background: transparent;
  text-decoration: underline;
}
.omnimux-ttsel-table .omnimux-ttsel-title-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.omnimux-ttsel-title-clamp {
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.omnimux-ttsel-prod-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
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
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
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
  border-color: var(--dsw-alias-border-l3);
}
.omnimux-ttsel-step:active {
  transform: scale(var(--omnimux-motion-press-scale-subtle, 0.985));
}
.omnimux-ttsel-step[data-active="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-1);
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
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
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
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-panel, var(--dsw-shadow-lv2));
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
  background: var(--dsw-alias-interactive-bg-hover);
}
.omnimux-ttsel-drawer-hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-drawer-thumb {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-drawer-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-drawer-meta {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.omnimux-ttsel-kpi-tile {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}
.omnimux-ttsel-kpi-v {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-kv-list {
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}
.omnimux-ttsel-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.omnimux-ttsel-kv:last-child {
  border-bottom: none;
}
.omnimux-ttsel-kv-k {
  color: var(--dsw-alias-label-secondary);
  flex-shrink: 0;
}
.omnimux-ttsel-kv-v {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.omnimux-ttsel-subtle-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.omnimux-ttsel-skeleton {
  height: 76px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  animation: omnimux-ttsel-pulse 1.4s ease-in-out infinite;
}
.omnimux-ttsel-drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-ext-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-state-business-primary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
}
.omnimux-ttsel-ext-link:hover {
  text-decoration: underline;
}
.omnimux-ttsel-evidence-pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
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
  color: var(--dsw-alias-label-primary);
}
.omnimux-ttsel-video-item {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.omnimux-ttsel-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.omnimux-ttsel-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 120;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-panel, var(--dsw-shadow-lv2));
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  animation: omnimux-ttsel-toast-enter var(--omnimux-motion-dur-base, 200ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omnimux-ttsel-error-banner {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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
@keyframes omnimux-ttsel-pulse {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 0.35; }
}
@media (max-width: 900px) {
  .omnimux-ttsel-panel-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.omnimux-ttsel-drawer-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.omnimux-ttsel-stack-12 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.omnimux-ttsel-minw0 {
  min-width: 0;
}
.omnimux-ttsel-col-check {
  width: 36px;
}
.omnimux-ttsel-col-actions {
  width: 96px;
}
.omnimux-ttsel-push-end {
  margin-left: auto;
}
.omnimux-ttsel-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
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
  .omnimux-ttsel-error-banner,
  .omnimux-ttsel-skeleton {
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
