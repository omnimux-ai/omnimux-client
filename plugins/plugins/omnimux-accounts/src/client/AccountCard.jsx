import { AccountMenu, AgentSwitch } from './account-controls.jsx'
import { Avatar, GroupChip, PlatformChip, StatusDot } from './chips.jsx'
import { fmt, localeText, relativeTime } from './view.js'

/**
 * One account card (grid view). The card body is display-only — no card-click
 * semantics are defined yet, so the ⋯ menu and the Agent toggle carry all
 * interactions. Structure follows the PRD §7.2 mockup.
 * @param {{
 *   t: (key: string) => string,
 *   account: Record<string, unknown>,
 *   busy: string,
 *   onAgentToggle: (id: string, next: boolean) => void,
 *   onDisconnect: (id: string) => void,
 * }} props
 */
export function AccountCard({ t, account, busy = '', onAgentToggle, onDisconnect }) {
  const id = String(account.id)
  const name = [account.display_name, account.username, account.name]
    .find((value) => typeof value === 'string' && value !== '') || id
  const username = typeof account.username === 'string' && account.username !== ''
    ? `@${account.username}`
    : ''
  const status = typeof account.status === 'string' ? account.status : ''
  const statusLabel = localeText(t, `status.${status}`, status)
  const agentUsable = account.agent_usable !== false
  const lastUsed = typeof account.last_used_at === 'string' ? relativeTime(account.last_used_at) : ''
  const expiresSoon = status === 'expiring' && typeof account.expires_at === 'string'
  const disabled = busy !== ''

  return (
    <article className="omnimux-accounts-card" data-busy={busy === id}>
      <div className="omnimux-accounts-card-head">
        <Avatar account={account} t={t} />
        <div className="omnimux-accounts-id">
          <h3 className="omnimux-accounts-name">{name}</h3>
          {username !== '' ? <p className="omnimux-accounts-username">{username}</p> : null}
        </div>
      </div>
      {typeof account.platform === 'string' || typeof account.group === 'string' ? (
        <div className="omnimux-accounts-chips">
          {typeof account.platform === 'string' && account.platform !== '' ? (
            <PlatformChip platform={account.platform} t={t} />
          ) : null}
          {typeof account.group === 'string' && account.group !== '' ? (
            <GroupChip group={account.group} />
          ) : null}
        </div>
      ) : null}
      {status !== '' ? (
        <div className={`omnimux-accounts-status omnimux-accounts-status--${status}`}>
          <StatusDot status={status} label={statusLabel} />
          <span>{statusLabel}</span>
          {expiresSoon ? (
            <span> · {fmt(t('card.expiresIn'), { time: relativeTime(account.expires_at) })}</span>
          ) : null}
        </div>
      ) : null}
      {lastUsed !== '' ? (
        <p className="omnimux-accounts-meta">{fmt(t('card.lastUsed'), { time: lastUsed })}</p>
      ) : null}
      <div className="omnimux-accounts-switchrow">
        <AgentSwitch
          t={t}
          checked={agentUsable}
          disabled={disabled}
          onToggle={(next) => { onAgentToggle(id, next) }}
        />
        <span className="omnimux-accounts-switch-label">{t('card.agentUsable')}</span>
      </div>
      <AccountMenu t={t} name={name} disabled={disabled} onDisconnect={() => { onDisconnect(id) }} />
    </article>
  )
}
