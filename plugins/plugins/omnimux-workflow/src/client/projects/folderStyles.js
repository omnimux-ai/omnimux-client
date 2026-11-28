export const FOLDER_STYLES = `
.omnimux-folder { position: relative; aspect-ratio: 516 / 378; min-width: 0; isolation: isolate; container-type: inline-size; content-visibility: auto; contain-intrinsic-size: 236px 173px; }
.omnimux-folder[data-menu-open="true"] { z-index: 10; content-visibility: visible; }
.omnimux-folder[data-cover-kind=empty] .omnimux-folder-back { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 92%, var(--dsw-alias-brand-primary)); }
.omnimux-folder[data-cover-kind=empty] .omnimux-folder-pocket { background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 97%, var(--dsw-alias-brand-primary)); }
.omnimux-folder .omnimux-folder-open { position: absolute; inset: 0; width: 100%; height: 100%; display: block; padding: 0; border: 0; background: transparent; text-align: left; white-space: normal; border-radius: 9% / 12.3%; overflow: hidden; color: var(--dsw-alias-label-primary); transition: transform var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.omnimux-folder .omnimux-folder-open:active { transform: scale(var(--omx-press-scale-subtle, 0.985)); }
.omnimux-folder-back { position: absolute; inset: 0; border-radius: inherit; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, var(--dsw-alias-bg-module-platform)); border: 1px solid var(--dsw-alias-border-l2); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); transition: border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.omnimux-folder-sheet { position: absolute; display: block; overflow: hidden; border-radius: 9%; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, var(--dsw-alias-bg-module-platform)); border: 1px solid var(--dsw-alias-border-l2); transition: transform var(--omx-dur-base, 200ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.omnimux-folder-sheet--rear { width: 76%; height: 68%; left: 12%; top: 7%; transform: rotate(-2.5deg); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 50%, var(--dsw-alias-bg-module-platform)); }
.omnimux-folder-sheet--front { width: 84%; height: 70%; left: 8%; top: 12%; transform: rotate(1.5deg); box-sizing: border-box; border: 3px solid var(--dsw-alias-bg-base); box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-bg-mask-1) 40%, transparent); }
.omnimux-folder:hover .omnimux-folder-sheet--rear { transform: translateY(-2px) rotate(-3.5deg); }
.omnimux-folder:hover .omnimux-folder-sheet--front { transform: translateY(-4px) rotate(0.8deg); }
.omnimux-folder-glass-defs { position: absolute; pointer-events: none; }
.omnimux-folder-pocket, .omnimux-folder-pocket-rim { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.omnimux-folder-pocket { -webkit-mask-image: var(--stage-pocket-mask); mask-image: var(--stage-pocket-mask); -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; mask-mode: alpha; background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1) 96%, var(--dsw-alias-label-primary) 4%) 38%, color-mix(in srgb, var(--dsw-alias-bg-base) 92%, var(--dsw-alias-bg-module-platform)) 100%); }
.omnimux-folder-pocket::after { content: ''; position: absolute; inset: 0; border-radius: 9% / 12.3%; background: linear-gradient(160deg, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent) 36%, transparent 62%); box-shadow: inset 0 -1px 1px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent), inset 0 -10px 18px color-mix(in srgb, var(--dsw-alias-bg-mask-1) 10%, transparent); }
.omnimux-folder-glass-shade { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 20%, transparent) 38%, color-mix(in srgb, var(--dsw-alias-bg-base) 56%, transparent) 100%); }
.omnimux-folder-caption { position: absolute; bottom: 8%; left: 7.5%; right: 17%; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.omnimux-folder-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.omnimux-folder-meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.omnimux-folder-date { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.omnimux-folder-pages { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.omnimux-folder-workspace { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.omnimux-folder .omnimux-folder-more { position: absolute; right: 5%; bottom: 6%; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); opacity: 0; transition: opacity var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.omnimux-folder:hover .omnimux-folder-more, .omnimux-folder:focus-within .omnimux-folder-more, .omnimux-folder[data-menu-open="true"] .omnimux-folder-more { opacity: 1; }
.omnimux-folder .omnimux-folder-more:hover { border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); }
@media (hover: none) { .omnimux-folder .omnimux-folder-more { opacity: 1; } }
@media (pointer: coarse) { .omnimux-folder .omnimux-folder-more, .omnimux-folder-menu [role=menuitem], .omnimux-page-card-actions button { min-width: 44px; min-height: 44px; } }
.omnimux-page-card .omnimux-page-open { display: block; width: 100%; height: 100%; padding: 0; border: 0; border-radius: inherit; overflow: hidden; }
.omnimux-page-open:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.omnimux-folder-open:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.omnimux-folder-more:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.omnimux-folder:hover .omnimux-folder-back { border-color: var(--dsw-alias-border-l3); }
.omnimux-page-card { position: relative; }
.omnimux-page-card .omnimux-page-more { position: absolute; right: 8px; bottom: 8px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); opacity: 0; transition: opacity var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); z-index: 2; }
.omnimux-page-card:hover .omnimux-page-more, .omnimux-page-card:focus-within .omnimux-page-more { opacity: 1; }
@media (hover: none) { .omnimux-page-card .omnimux-page-more { opacity: 1; } }
@media (pointer: coarse) { .omnimux-folder .omnimux-folder-more, .omnimux-folder-menu [role=menuitem], .omnimux-page-card .omnimux-page-more, .omnimux-page-card-actions button { min-width: 44px; min-height: 44px; } }
.omnimux-page-card .omnimux-page-more:hover { border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); }
.omnimux-page-card .omnimux-page-card-menu { bottom: 44px; right: 8px; }
.omnimux-folder-menu { /* exempt-popover-blur 历史Issue1932获批画布文件夹卡片 */ --dsw-alias-bg-elevated: var(--dsw-specific-menu, var(--dsw-alias-bg-base)); position: absolute; z-index: 4; bottom: 20%; right: 5%; display: flex; flex-direction: column; gap: 2px; min-width: 148px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-overlay)); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 10px 28px var(--dsw-alias-bg-mask-1), 0 2px 8px var(--dsw-alias-bg-mask-1); animation: omnimux-menu-pop 120ms cubic-bezier(0.16, 1, 0.3, 1); transform-origin: bottom right; }
@keyframes omnimux-menu-pop { from { opacity: 0; transform: translateY(4px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
.omnimux-folder-menu [role=menuitem] { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; box-sizing: border-box; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 18px; justify-content: flex-start; cursor: pointer; transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.omnimux-folder-menu [role=menuitem]:hover, .omnimux-folder-menu [role=menuitem]:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.omnimux-folder-menu [role=menuitem]:active { background: var(--dsw-alias-interactive-bg-active); transform: scale(var(--omx-press-scale-subtle, 0.985)); }
.omnimux-folder-menu [role=menuitem].omnimux-folder-menu-item--danger, .omnimux-folder-menu [role=menuitem][data-danger=true] { color: var(--dsw-alias-state-error-primary); }
.omnimux-folder-menu [role=menuitem].omnimux-folder-menu-item--danger .slot, .omnimux-folder-menu [role=menuitem][data-danger=true] .slot { color: var(--dsw-alias-state-error-primary); }
.omnimux-folder-menu [role=menuitem].omnimux-folder-menu-item--danger:hover, .omnimux-folder-menu [role=menuitem][data-danger=true]:hover, .omnimux-folder-menu [role=menuitem].omnimux-folder-menu-item--danger:focus-visible, .omnimux-folder-menu [role=menuitem][data-danger=true]:focus-visible { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); }
.omnimux-cover-content { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, var(--dsw-alias-bg-module-platform)); color: var(--dsw-alias-label-tertiary); outline: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); outline-offset: -1px; }
.omnimux-cover-content > svg:not(.omnimux-cover-audio) { width: 15%; height: 24%; align-self: flex-start; margin-top: 15%; opacity: 0.75; }
.omnimux-page-card-cover .omnimux-cover-content > svg:not(.omnimux-cover-audio) { width: 32px; height: 32px; align-self: center; margin-top: 0; }
.omnimux-cover-content > img { width: 100%; height: 100%; object-fit: cover; display: block; }
.omnimux-cover-content--has-media::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-mask-1) 22%, transparent) 0%, color-mix(in srgb, var(--dsw-alias-bg-mask-1) 10%, transparent) 55%, color-mix(in srgb, var(--dsw-alias-bg-mask-1) 28%, transparent) 100%); }
.omnimux-cover-content--loading { background: linear-gradient(90deg, var(--dsw-alias-bg-layer-1) 0%, var(--dsw-alias-bg-skeleton) 50%, var(--dsw-alias-bg-layer-1) 100%); background-size: 200% 100%; animation: omnimux-cover-shimmer 1.4s ease-in-out infinite; }
@keyframes omnimux-cover-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.omnimux-cover-content--audio { background: var(--dsw-specific-media-bg, #080808); } /* exempt-ui03 fixed darkroom media surface */
.omnimux-cover-audio { width: 100%; height: 100%; color: var(--dsw-specific-ai-accent, #9460ef); } /* exempt-ui03 reference waveform is media artwork, not interactive brand color */
.omnimux-cover-content--empty { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 92%, var(--dsw-alias-brand-primary)); }
@media (prefers-reduced-motion: reduce) {
  .omnimux-folder .omnimux-folder-open, .omnimux-folder-sheet, .omnimux-folder-back, .omnimux-folder-more, .omnimux-page-card .omnimux-page-more, .omnimux-folder-menu, .omnimux-folder-menu [role=menuitem] { transition: none !important; animation: none !important; }
  .omnimux-folder:hover .omnimux-folder-sheet--rear { transform: rotate(-2.5deg); }
  .omnimux-folder:hover .omnimux-folder-sheet--front { transform: rotate(1.5deg); }
  .omnimux-folder .omnimux-folder-open:active, .omnimux-folder-menu [role=menuitem]:active { transform: none; }
  .omnimux-cover-content--loading { animation: none; background: var(--dsw-alias-bg-skeleton); }
}
`
export function injectFolderStyles() {
  if (typeof document === 'undefined') return
  let style = document.getElementById('omnimux-folder-styles')
  if (!style) {
    style = document.createElement('style')
    style.id = 'omnimux-folder-styles'
    document.head.appendChild(style)
  }
  if (style.textContent !== FOLDER_STYLES) {
    style.textContent = FOLDER_STYLES
  }
}
