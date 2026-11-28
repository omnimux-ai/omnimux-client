import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfirmModal, IconButton, IconEllipsisOutline16, IconPlusOutline16, SearchField } from 'dsh-ui-kit'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  disconnectHubAccount,
  errorText,
  getHubSeats,
  listHubAccounts,
  renewHubAccountSeat,
} from './api.js'
import {
  ACCOUNT_PLATFORM,
  accountCapabilityBadge,
  accountDisplayName,
  accountHandle,
  accountSeatDisplay,
  accountStatusTone,
  createSeatRenewController,
  extractAccounts,
  filterAccounts,
  isNeedsLogin,
  isSeatBillingActive,
  isSeatCapReached,
  seatErrorMessage,
} from './account-sidebar-view.js'
import { AuthorizeModal, authorizeBaseline } from './AuthorizeModal.jsx'
import { createDisconnectController } from './disconnect-controller.js'
import {
  IconUserOutline16,
} from './icons/accounts.js'

/**
 * 账号行状态文案：优先已知状态映射，未知值原样透传，空值回退「已连接」。
 * @param {(key: string) => string} t
 * @param {Record<string, unknown>} row
 */
function statusLabel(t, row) {
  const status = String(row?.status ?? '').trim().toLowerCase()
  if (status === 'connected' || status === 'active' || status === 'ok') return t('acct.status.connected')
  if (status === 'expired') return t('acct.status.expired')
  if (status === 'error' || status === 'failed' || status === 'revoked') return t('acct.status.error')
  if (status !== '') return status
  return t('acct.status.connected')
}

/**
 * 单个账号行：头像（hub 同源重写 avatar_url，缺失/加载失败退 SVG 占位）
 * + 显示名 + @username + 状态 pill（agent_usable=false 另置灰标注），
 * 并在 `billing_mode === 'seat'` 时渲染席位有效期/冻结续费行与菜单续费项。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   row: Record<string, unknown>,
 *   seatBillingOn: boolean,
 *   maxValidityDays: number,
 *   onRenew: (row: Record<string, unknown>) => void,
 *   onDisconnect: (row: Record<string, unknown>) => void,
 * }} props
 */
function AccountItem({ t, row, seatBillingOn, maxValidityDays, onRenew, onDisconnect }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef(null)
  const avatarUrl = typeof row.avatar_url === 'string' ? row.avatar_url : ''
  const seat = seatBillingOn ? accountSeatDisplay(row) : null
  const isSeatFrozenRow = seat?.status === 'frozen'
  const isSeatUnactivatedRow = seat?.status === 'unactivated'
  const tone = isSeatFrozenRow
    ? 'error'
    : isSeatUnactivatedRow
      ? 'warn'
      : (row.agent_usable === false ? 'muted' : accountStatusTone(row))
  const pillText = isSeatFrozenRow
    ? t('acct.seat.status.frozen')
    : isSeatUnactivatedRow
      ? t('acct.seat.status.unactivated')
      : (row.agent_usable === false ? t('acct.agentOff') : statusLabel(t, row))
  const name = accountDisplayName(row)
  const handle = accountHandle(row)
  const cap = accountCapabilityBadge(t, row)
  const accountId = String(row.id ?? '')

  const handleMenuToggle = (event) => {
    event.stopPropagation()
    setMenuOpen((open) => !open)
  }

  const handleMenuClose = (event) => {
    event?.stopPropagation?.()
    setMenuOpen(false)
  }

  const handleDisconnect = () => {
    setMenuOpen(false)
    onDisconnect(row)
  }

  const handleRenew = () => {
    setMenuOpen(false)
    onRenew(row)
  }

  const menuItems = []
  if (seat !== null) {
    if (seat.isRenewLimit) {
      menuItems.push({
        id: `renew-${accountId}`,
        label: t('acct.seat.renewLimitMenu', { days: maxValidityDays }),
        disabled: true,
        title: t('acct.seat.renewLimitMenu', { days: maxValidityDays }),
      })
    } else if (seat.canRenew) {
      menuItems.push({
        id: `renew-${accountId}`,
        label: t(isSeatUnactivatedRow ? 'acct.seat.activateMenu' : 'acct.seat.renewMenu', { credits: seat.priceCredits }),
      })
    }
  }
  menuItems.push({
    id: `disconnect-${accountId}`,
    label: t('acct.disconnect'),
    danger: true,
  })

  const seatSubrow = seat === null
    ? null
    : isSeatFrozenRow
      ? (
        <div className="omnimux-publish-accounts-seat-subrow">
          <span className="omnimux-publish-accounts-seat-text error">
            {seat.graceDays !== null && seat.graceDays > 0
              ? t('acct.seat.frozenGrace', { days: seat.graceDays })
              : t('acct.seat.frozenGraceEnding')}
          </span>
          {seat.canRenew ? (
            <Button type="button" variant="outline" size="xs" onClick={handleRenew}>
              {t('acct.seat.renewInline', { credits: seat.priceCredits })}
            </Button>
          ) : null}
        </div>
      )
      : isSeatUnactivatedRow
        ? (
          <div className="omnimux-publish-accounts-seat-subrow">
            <span className="omnimux-publish-accounts-seat-text warn">
              {seat.graceDays !== null && seat.graceDays > 0
                ? t('acct.seat.unactivatedGrace', { days: seat.graceDays })
                : t('acct.seat.unactivatedGraceEnding')}
            </span>
            {seat.canRenew ? (
              <Button type="button" variant="outline" size="xs" onClick={handleRenew}>
                {t('acct.seat.activateInline', { credits: seat.priceCredits })}
              </Button>
            ) : null}
          </div>
        )
        : seat.expiresDate !== ''
          ? (
            <div className="omnimux-publish-accounts-seat-subrow">
              <span className={`omnimux-publish-accounts-seat-text${seat.isExpiringSoon ? ' warn' : ''}`}>
                {t(seat.isExpiringSoon ? 'acct.seat.expiringSoon' : 'acct.seat.expiresAt', { date: seat.expiresDate })}
              </span>
            </div>
          )
          : null

  return (
    <div className="omnimux-publish-accounts-item">
      <div className="omnimux-publish-accounts-item-top">
        <span className="omnimux-publish-accounts-avatar">
          {avatarUrl !== '' && !avatarFailed ? (
            <img
              className="omnimux-publish-accounts-avatar-img"
              src={avatarUrl}
              alt=""
              loading="lazy"
              onError={() => { setAvatarFailed(true) }}
            />
          ) : (
            <IconUserOutline16 size={18} />
          )}
        </span>
        <span className="omnimux-publish-accounts-item-main">
          <span className="omnimux-publish-accounts-item-name">{name}</span>
          {handle !== '' || cap !== null ? (
            <span className="omnimux-publish-accounts-item-meta">
              {handle !== '' ? (
                <span className="omnimux-publish-accounts-item-handle">{handle}</span>
              ) : null}
              {cap !== null ? (
                <span className={`omnimux-publish-cap-badge ${cap.tone}`}>{cap.label}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className={`omnimux-publish-accounts-item-status ${tone}`}>
          {pillText}
        </span>
        <div className="omnimux-publish-accounts-item-menu" onClick={(event) => event.stopPropagation()}>
          <IconButton
            ref={anchorRef}
            variant="ghost"
            size="sm"
            aria-label={t('acct.more', { name })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={handleMenuToggle}
          >
            <IconEllipsisOutline16 />
          </IconButton>
          {menuOpen ? (
            <Menu
              open={menuOpen}
              portal
              anchor={null}
              anchorRef={anchorRef}
              align="end"
              dense
              items={menuItems}
              onSelect={(itemId) => {
                if (typeof itemId === 'string' && itemId.startsWith('renew-')) handleRenew()
                else handleDisconnect()
              }}
              onClose={handleMenuClose}
            />
          ) : null}
        </div>
      </div>
      {seatSubrow}
    </div>
  )
}

/**
 * 空态：暂无授权账号 + 新增账号主按钮。
 * @param {{
 *   t: (key: string) => string,
 *   onAdd: () => void,
 * }} props
 */
function EmptyState({ t, onAdd }) {
  return (
    <div className="omnimux-publish-accounts-empty">
      <div className="omnimux-publish-accounts-empty-title">{t('acct.empty')}</div>
      <Button
        variant="primary"
        size="default"
        leadingIcon={<IconPlusOutline16 />}
        onClick={onAdd}
      >
        {t('acct.add')}
      </Button>
    </div>
  )
}

/**
 * 发布 Stage 内「账号」侧栏视图：左侧 336px 账号列表面板（头部 + 新增 +
 * 搜索 + 账号行 / 空态 / 登录引导态），右侧说明留白区。
 * 数据源：GET /omnimux/accounts?platform=tiktok（hub 权威 ViewRow 合并，
 * 本插件不自建账号路由）。「新增账号」弹 AuthorizeModal 走官方授权。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 * }} props
 */
export function AccountsSidebar({ t }) {
  const [phase, setPhase] = useState('loading') // loading | ready | need-login
  const [rows, setRows] = useState([])
  const [seats, setSeats] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDisconnect, setPendingDisconnect] = useState(null)
  const [disconnectingId, setDisconnectingId] = useState('')
  const [disconnectError, setDisconnectError] = useState('')
  const [pendingRenew, setPendingRenew] = useState(null)
  const [renewingId, setRenewingId] = useState('')
  const [renewError, setRenewError] = useState('')
  const mountedRef = useRef(true)
  const tRef = useRef(t)
  tRef.current = t
  const seatsRef = useRef(seats)
  seatsRef.current = seats
  const disconnectControllerRef = useRef(null)
  const renewControllerRef = useRef(null)

  const loadAccounts = useCallback(() => {
    const accountsReq = listHubAccounts({ platform: ACCOUNT_PLATFORM })
    const seatsReq = getHubSeats().catch((caught) => ({
      ok: false,
      status: 0,
      body: { error: caught instanceof Error ? caught.message : String(caught) },
    }))
    return Promise.all([accountsReq, seatsReq]).then(([result, seatsResult]) => {
      if (!mountedRef.current) return true
      if (isNeedsLogin(result)) {
        setPhase('need-login')
        setRows([])
        setSeats(null)
        return true
      }
      if (seatsResult && seatsResult.ok && seatsResult.body) {
        setSeats(seatsResult.body)
      } else {
        setSeats(null)
      }
      if (!result.ok) {
        setPhase('ready')
        setError(errorText(result.body, result.status))
        return true
      }
      setPhase('ready')
      setError('')
      setRows(extractAccounts(result.body))
      return true
    }).catch((caught) => {
      if (mountedRef.current) {
        setPhase('ready')
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      return true
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadAccounts()
    return () => { mountedRef.current = false }
  }, [loadAccounts])

  const filtered = filterAccounts(rows, query)
  const seatBillingOn = isSeatBillingActive(seats)
  const seatCapReached = isSeatCapReached(seats)
  const maxValidityDays = typeof seats?.max_validity_days === 'number' && seats.max_validity_days > 0
    ? seats.max_validity_days
    : 90
  const seatPriceCredits = typeof seats?.seat_price_credits === 'number' && seats.seat_price_credits > 0
    ? seats.seat_price_credits
    : 20

  /** 授权完成（检测到新账号或用户点「我已完成」）：关弹窗并刷新列表。 */
  const handleConnected = useCallback(() => {
    setModalOpen(false)
    void loadAccounts()
  }, [loadAccounts])

  /** 授权流程遇 401：关弹窗，整体进入登录引导态。 */
  const handleNeedLogin = useCallback(() => {
    setModalOpen(false)
    setPhase('need-login')
  }, [])

  /** 仅打开确认框；取消/关闭不会发送 DELETE。 */
  const handleDisconnectRequest = useCallback((row) => {
    setDisconnectError('')
    setPendingDisconnect(row)
  }, [])

  const handleDisconnectClose = useCallback(() => {
    if (disconnectingId !== '') return
    setPendingDisconnect(null)
    setDisconnectError('')
  }, [disconnectingId])

  const handleRenewRequest = useCallback((row) => {
    setRenewError('')
    setPendingRenew(row)
  }, [])

  const handleRenewClose = useCallback(() => {
    if (renewingId !== '') return
    setPendingRenew(null)
    setRenewError('')
  }, [renewingId])

  /**
   * Host 以 id 精确定位账号。控制器在 React state 生效前同步加锁；失败时不改
   * rows，让用户看到可重试的同一确认框，卸载后的迟到结果不再更新组件状态。
   */
  const handleDisconnectConfirm = useCallback(() => {
    const accountId = pendingDisconnect?.id
    if (disconnectControllerRef.current === null) {
      disconnectControllerRef.current = createDisconnectController({
        disconnect: disconnectHubAccount,
        reload: loadAccounts,
        isMounted: () => mountedRef.current,
        isNeedsLogin,
        errorText,
        onStart: (id) => {
          setDisconnectingId(id)
          setDisconnectError('')
        },
        onFailure: setDisconnectError,
        onNeedLogin: () => {
          setPendingDisconnect(null)
          setPhase('need-login')
        },
        onSuccess: () => { setPendingDisconnect(null) },
        onFinally: () => { setDisconnectingId('') },
      })
    }
    void disconnectControllerRef.current.confirm(accountId)
  }, [loadAccounts, pendingDisconnect])

  const handleRenewConfirm = useCallback(() => {
    const accountId = pendingRenew?.id
    if (renewControllerRef.current === null) {
      renewControllerRef.current = createSeatRenewController({
        renew: renewHubAccountSeat,
        reload: loadAccounts,
        isMounted: () => mountedRef.current,
        isNeedsLogin,
        formatError: (body, status) => seatErrorMessage(tRef.current, body, status, errorText, seatsRef.current),
        onStart: (id) => {
          setRenewingId(id)
          setRenewError('')
        },
        onFailure: setRenewError,
        onNeedLogin: () => {
          setPendingRenew(null)
          setPhase('need-login')
        },
        onSuccess: () => { setPendingRenew(null) },
        onFinally: () => { setRenewingId('') },
      })
    }
    void renewControllerRef.current.confirm(accountId)
  }, [loadAccounts, pendingRenew])

  const pendingDisconnectName = accountDisplayName(pendingDisconnect ?? {})
  const pendingDisconnectId = String(pendingDisconnect?.id ?? '')
  const disconnecting = pendingDisconnectId !== '' && disconnectingId === pendingDisconnectId
  const pendingDisconnectSeat = seatBillingOn ? accountSeatDisplay(pendingDisconnect) : null

  const pendingRenewName = accountDisplayName(pendingRenew ?? {})
  const pendingRenewHandle = accountHandle(pendingRenew ?? {})
  const pendingRenewId = String(pendingRenew?.id ?? '')
  const renewing = pendingRenewId !== '' && renewingId === pendingRenewId
  const pendingRenewSeat = pendingRenew ? accountSeatDisplay(pendingRenew) : null
  const pendingRenewIsActivate = pendingRenewSeat?.status === 'unactivated'
  const pendingRenewCredits = pendingRenewSeat?.priceCredits ?? seatPriceCredits

  return (
    <div className="omnimux-publish-accounts-view">
      <aside className="omnimux-publish-accounts-sidebar">
        <div className="omnimux-publish-accounts-head">
          <span className="omnimux-publish-accounts-head-title">{t('acct.title')}</span>
        </div>

        {phase === 'need-login' ? (
          <>
            <div className="omnimux-publish-accounts-note">{t('acct.needLogin')}</div>
            <div className="omnimux-publish-accounts-note">{t('acct.needLogin.hint')}</div>
          </>
        ) : (
          <>
            {seatBillingOn ? (
              <div className="omnimux-publish-seat-summary" data-testid="seat-summary">
                <span className="omnimux-publish-seat-summary-count">
                  {t('acct.seat.summary', {
                    purchased: seats.seats_purchased ?? 0,
                    cap: seats.seats_cap ?? 20,
                  })}
                </span>
                {(seats.seats_vacant ?? 0) > 0 ? (
                  <span className="omnimux-publish-seat-summary-pill vacant">
                    {t('acct.seat.vacant', { count: seats.seats_vacant })}
                  </span>
                ) : seatCapReached ? (
                  <span className="omnimux-publish-seat-summary-pill cap">
                    {t('acct.seat.capFull')}
                  </span>
                ) : (
                  <span className="omnimux-publish-seat-summary-rate">
                    {t('acct.seat.rate', { credits: seatPriceCredits })}
                  </span>
                )}
              </div>
            ) : null}

            <Button
              variant="primary"
              size="default"
              className="omnimux-publish-accounts-add"
              leadingIcon={<IconPlusOutline16 />}
              onClick={() => { setModalOpen(true) }}
            >
              {t('acct.add')}
            </Button>

            <div className="omnimux-publish-accounts-search">
              <SearchField
                stretch
                placeholder={t('acct.searchPlaceholder')}
                aria-label={t('acct.searchPlaceholder')}
                clearLabel={t('search.clear')}
                value={query}
                onValueChange={setQuery}
              />
            </div>

            {phase === 'loading' ? (
              <div className="omnimux-publish-accounts-note">{t('acct.loading')}</div>
            ) : null}

            {error !== '' ? (
              <div role="alert" className="omnimux-publish-accounts-error">
                {t('acct.loadFailed', { reason: error })}
              </div>
            ) : null}

            {phase === 'ready' && error === '' ? (
              rows.length === 0 ? (
                <EmptyState t={t} onAdd={() => { setModalOpen(true) }} />
              ) : filtered.length === 0 ? (
                <div className="omnimux-publish-accounts-note">{t('acct.noMatches')}</div>
              ) : (
                <div className="omnimux-publish-accounts-items">
                  {filtered.map((row) => (
                    <AccountItem
                      key={String(row.id)}
                      t={t}
                      row={row}
                      seatBillingOn={seatBillingOn}
                      maxValidityDays={maxValidityDays}
                      onRenew={handleRenewRequest}
                      onDisconnect={handleDisconnectRequest}
                    />
                  ))}
                </div>
              )
            ) : null}
          </>
        )}
      </aside>

      <section className="omnimux-publish-accounts-panel">
        <div className="omnimux-publish-accounts-panel-title">{t('acct.panel.title')}</div>
        <div className="omnimux-publish-accounts-panel-body">{t('acct.panel.body')}</div>
      </section>

      {modalOpen ? (
        <AuthorizeModal
          t={t}
          seats={seats}
          baselineIds={authorizeBaseline(rows)}
          onClose={() => { setModalOpen(false) }}
          onNeedLogin={handleNeedLogin}
          onConnected={handleConnected}
        />
      ) : null}
      <ConfirmModal
        open={pendingDisconnect !== null}
        title={t('acct.disconnectTitle')}
        confirmLabel={disconnectError === '' ? t('acct.disconnect') : t('acct.retry')}
        cancelLabel={t('auth.cancel')}
        closeLabel={t('close')}
        confirmVariant="danger"
        confirmLoading={disconnecting}
        onConfirm={() => { void handleDisconnectConfirm() }}
        onClose={handleDisconnectClose}
      >
        <p>{t('acct.disconnectConfirm', { name: pendingDisconnectName })}</p>
        {pendingDisconnectSeat && pendingDisconnectSeat.status === 'active' && pendingDisconnectSeat.expiresDate !== '' ? (
          <div className="omnimux-publish-seat-callout info">
            {t('acct.seat.disconnectNote', {
              date: pendingDisconnectSeat.expiresDate,
              swaps: pendingDisconnectSeat.swapsRemaining,
            })}
          </div>
        ) : null}
        {disconnectError !== '' ? (
          <p className="omnimux-publish-accounts-modal-error" role="alert">
            {t('acct.disconnectFailed', { reason: disconnectError })}
          </p>
        ) : null}
      </ConfirmModal>
      <ConfirmModal
        open={pendingRenew !== null}
        title={t(pendingRenewIsActivate ? 'acct.seat.activateTitle' : 'acct.seat.renewTitle')}
        confirmLabel={renewError !== ''
          ? t('acct.retry')
          : t(pendingRenewIsActivate ? 'acct.seat.activateConfirm' : 'acct.seat.renewConfirm', { credits: pendingRenewCredits })}
        cancelLabel={t('auth.cancel')}
        closeLabel={t('close')}
        confirmVariant="primary"
        confirmLoading={renewing}
        onConfirm={() => { void handleRenewConfirm() }}
        onClose={handleRenewClose}
      >
        {pendingRenewSeat ? (
          <div className="omnimux-publish-seat-renew-card">
            <span className="omnimux-publish-seat-renew-key">{t('acct.seat.renewField.account')}</span>
            <span className="omnimux-publish-seat-renew-val">
              {pendingRenewHandle !== '' ? `${pendingRenewName} (${pendingRenewHandle})` : pendingRenewName}
            </span>
            <span className="omnimux-publish-seat-renew-key">{t('acct.seat.renewField.cost')}</span>
            <span className="omnimux-publish-seat-renew-val">
              {t('acct.seat.renewField.costValue', { credits: pendingRenewCredits })}
            </span>
            <span className="omnimux-publish-seat-renew-key">{t('acct.seat.renewField.validity')}</span>
            <span className="omnimux-publish-seat-renew-val">
              {`${pendingRenewSeat.preview.fromDate} → ${pendingRenewSeat.preview.toDate}`}
            </span>
          </div>
        ) : null}
        {renewError !== '' ? (
          <p className="omnimux-publish-accounts-modal-error" role="alert">
            {renewError}
          </p>
        ) : null}
      </ConfirmModal>
    </div>
  )
}
