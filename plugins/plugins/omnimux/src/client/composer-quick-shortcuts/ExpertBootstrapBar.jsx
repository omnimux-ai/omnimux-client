import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useOwnedPrompt } from './useOwnedPrompt.ts'
import { writeDraft } from './dom.js'
import { QuickWriteNotice, useQuickWriteNotice } from './notice.jsx'
import { resolveComposerSessionId } from './session.js'
import { acquireQuickShortcutStyles } from './styles.js'
import { QuickShortcutArrow } from './icons.jsx'
import { getGlobalAttachmentStore } from '../attachments/store.ts'
import { isBlankConversation } from '../session-guide/state.js'
import { isTikTokAgentPreset, subscribeActivePreset } from './isTikTokAgentPreset.js'
import { resolveActivePresetId, resolveExpertBootstrapStarters } from './expertBootstrapCatalog.js'

function detectLang(props) {
  const candidates = [
    props?.locale,
    typeof window !== 'undefined' ? window.__omnimuxLocale?.snapshot?.active : null,
    typeof document !== 'undefined' ? document.documentElement?.lang : null,
  ]
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim()) {
      return cand.trim().toLowerCase().startsWith('en') ? 'en' : 'zh'
    }
  }
  if (typeof props?.t === 'function') {
    const sample = props.t('quickShortcuts.group')
    if (typeof sample === 'string' && sample.toLowerCase() === 'shortcuts') return 'en'
  }
  return 'zh'
}

export function useActivePresetId(session, props) {
  const subscribe = useCallback((onStoreChange) => subscribeActivePreset(onStoreChange), [])
  const getSnapshot = useCallback(() => resolveActivePresetId(session, props), [session, props])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Blank-session starter bar for hired cross-border SOP experts (`ecom-*`).
 *
 * Mounted on `conversation.input.dock` (order 106) right next to `ComposerQuickShortcuts`,
 * and strictly mutually exclusive with it:
 * - `omni-agent` (and TikTok legacy aliases): returns `null` (handled by `ComposerQuickShortcuts`)
 * - `cordis` (Create Agent) / `standard` / non-`ecom-*`: returns `null` (0 DOM)
 * - non-blank conversations: returns `null` (0 DOM)
 * - hired `ecom-*` blank conversations: renders 3 concise starter chips reusing
 *   `.omx-quick-shortcuts` tokens/layout; click fills the composer draft without auto-sending.
 */
export function ExpertBootstrapBar(props) {
  const {
    t,
    sessionId: sessionIdProp,
    session: sessionProp,
    useSession,
    useConversation,
  } = props || {}

  const input = props?.useInput?.((value) => value)
  const session = useSession ? useSession((value) => value) : null
  const currentSession = sessionProp || session
  const hasTargets = useConversation
    ? useConversation((value) => Boolean(value && value.activeTargets && value.activeTargets.size > 0))
    : false

  const sessionId = resolveComposerSessionId(
    currentSession,
    sessionIdProp,
    getGlobalAttachmentStore().getActiveSessionId(),
  )

  const presetId = useActivePresetId(currentSession, props)
  const isTikTok = isTikTokAgentPreset(currentSession, props)
  const lang = detectLang(props)

  const [activeId, setActiveId] = useState(null)
  useEffect(() => {
    setActiveId(null)
  }, [presetId, sessionId])

  const ownedPrompt = useOwnedPrompt(input, sessionId, props?.mutatePrompt)
  const writePrompt = useCallback((text) => {
    if (input && typeof props?.mutatePrompt === 'function') {
      return ownedPrompt(text)
    }
    return writeDraft(text)
  }, [input, props?.mutatePrompt, ownedPrompt])

  useEffect(() => acquireQuickShortcutStyles(), [])

  const { visible: noticeVisible, notify: notifyWriteFailed, dismiss: dismissNotice } = useQuickWriteNotice()

  const starters = useMemo(
    () => (isTikTok ? [] : resolveExpertBootstrapStarters(presetId, { lang })),
    [isTikTok, presetId, lang],
  )

  const handlePick = useCallback((entry) => {
    if (activeId === entry.id) {
      if (!writePrompt('')) {
        notifyWriteFailed()
        return
      }
      dismissNotice()
      setActiveId(null)
      return
    }
    if (!writePrompt(entry.prompt)) {
      notifyWriteFailed()
      return
    }
    dismissNotice()
    setActiveId(entry.id)
  }, [activeId, writePrompt, notifyWriteFailed, dismissNotice])

  if (useSession && !isBlankConversation(session, hasTargets)) return null
  if (isTikTok) return null
  if (starters.length === 0) return null

  return (
    <div
      className="omx-quick-shortcuts omx-expert-bootstrap"
      data-omnimux-expert-bootstrap="true"
      data-omnimux-expert-id={presetId}
      role="group"
      aria-label={lang === 'en' ? 'Expert starters' : '专家起手式'}
    >
      {starters.map((entry) => {
        const active = activeId === entry.id
        return (
          <button /* exempt-ui01: 专家空白会话起手式入口（复用无边框「文字 + 箭头」形态） */
            key={entry.id}
            type="button"
            className={`omx-quick-shortcut-btn${active ? ' is-active' : ''}`}
            data-omx-expert-starter={entry.id}
            aria-pressed={active}
            onClick={() => handlePick(entry)}
          >
            <span className="omx-quick-shortcut-label">{entry.label}</span>
            <QuickShortcutArrow />
          </button>
        )
      })}

      <QuickWriteNotice
        visible={noticeVisible}
        t={t}
        messageKey="quickShortcuts.notice.promptUnconfirmed"
        fallback="无法确认草稿状态，原内容已保留。请编辑正文后重试。"
      />
    </div>
  )
}
