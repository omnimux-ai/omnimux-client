import {
  Button,
  DropdownSelect,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconRefreshOutline16,
} from 'dsh-ui-kit'
import {
  TIKTOK_BRANDED_CONTENT_URL,
  TIKTOK_MUSIC_USAGE_URL,
  privacyChoices,
} from '../../shared/tiktok-options.js'

/**
 * Format duration in seconds into a compact readable label (e.g. `45s`, `3m (180s)`, `10m (600s)`, `1m 35s`).
 * @param {number | null | undefined} sec
 * @returns {string}
 */
export function formatDurationSec(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return ''
  const total = Math.round(sec)
  if (total < 60) return `${total}s`
  const mins = Math.floor(total / 60)
  const rem = total % 60
  if (rem === 0) return `${mins}m (${total}s)`
  return `${mins}m ${rem}s`
}

/**
 * TikTok Direct Post compliance section (§1 creator_info, §2.b privacy without default,
 * §2.c unchecked interactions + photo裁剪, §3 commercial disclosure independent checkboxes
 * + SELF_ONLY conflict + sandbox disable, and is_aigc switch for both video & photo).
 *
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   type: string,
 *   settingsOpen: boolean,
 *   onToggleOpen: () => void,
 *   settingsSummary: string,
 *   optionsLoading: boolean,
 *   aggregatedCreator: import('../../shared/tiktok-options.js').AggregatedCreatorInfo,
 *   onRetryCreatorInfo: () => void,
 *   tiktokOptions: import('../../shared/tiktok-options.js').TikTokOptions,
 *   onPatchOptions: (patch: Partial<import('../../shared/tiktok-options.js').TikTokOptions>) => void,
 *   privacyResetReason: string,
 *   onClearPrivacyReset: () => void,
 *   onBrandedSelfOnlyConflict: () => void,
 *   isAigc: boolean,
 *   onToggleAigc: () => void,
 *   overDurationVideo: { filename: string, duration_sec: number } | null,
 *   optionsProblems: string[],
 *   isLegacyCompat?: boolean,
 * }} props
 */
export function DirectPostOptions({
  t,
  type,
  settingsOpen,
  onToggleOpen,
  settingsSummary,
  optionsLoading,
  aggregatedCreator,
  onRetryCreatorInfo,
  tiktokOptions,
  onPatchOptions,
  privacyResetReason,
  onClearPrivacyReset,
  onBrandedSelfOnlyConflict,
  isAigc,
  onToggleAigc,
  overDurationVideo,
  optionsProblems,
  isLegacyCompat = false,
}) {
  // Single source of truth: Direct Post accounts strictly use upstream privacy_level_options
  // (explicit [] stays [] -> fail-closed). Only the legacy compatibility path (no creator_info)
  // falls back to the 4 official levels.
  const allowedPrivacy = aggregatedCreator.ready && aggregatedCreator.privacy_level_options.length > 0
    ? aggregatedCreator.privacy_level_options
    : (isLegacyCompat && !aggregatedCreator.blocked ? privacyChoices(null) : [])
  const isBranded = tiktokOptions.commercial_content && tiktokOptions.branded_content
  const sandboxSelfOnly = aggregatedCreator.ready && !aggregatedCreator.hasNonPrivatePrivacy
  const privacyOptions = allowedPrivacy.map((level) => {
    const blockedByBranded = isBranded && level === 'SELF_ONLY'
    return {
      value: level,
      label: blockedByBranded
        ? t('form.options.privacy.selfOnlyBlocked')
        : t(`form.options.privacy.${level}`),
      disabled: blockedByBranded,
    }
  })

  const interactionItems = type === 'image'
    ? [['allow_comment', 'form.options.comment', 'comment_disabled', 'comment']]
    : [
        ['allow_comment', 'form.options.comment', 'comment_disabled', 'comment'],
        ['allow_duet', 'form.options.duet', 'duet_disabled', 'duet'],
        ['allow_stitch', 'form.options.stitch', 'stitch_disabled', 'stitch'],
      ]

  const disabledInteractionHints = interactionItems
    .filter(([, , flag]) => aggregatedCreator[flag] === true)
    .map(([, , , shortKey]) => {
      const names = aggregatedCreator.disabledBy?.[shortKey] ?? []
      return names.length > 1
        ? t(`form.options.${shortKey}.disabledBy`, { accounts: names.join('、') })
        : t(`form.options.${shortKey}.disabled`)
    })

  const commercialLabelText = tiktokOptions.commercial_content
    ? (tiktokOptions.branded_content
        ? t('form.options.commercial.label.paid')
        : (tiktokOptions.your_brand ? t('form.options.commercial.label.promotional') : ''))
    : ''

  const creatorNames = aggregatedCreator.creators.map((c) => c.creator_nickname).filter(Boolean)
  const maxDurLabel = formatDurationSec(aggregatedCreator.max_video_post_duration_sec)
  const blockedCategory = aggregatedCreator.blockedCategory || ''
  const blockedTitle = blockedCategory === 'rate_limited'
    ? t('form.options.creator.rateLimitedTitle')
    : blockedCategory === 'posting_banned'
      ? t('form.options.creator.postingBannedTitle')
      : blockedCategory === 'publish_restricted'
        ? t('form.options.creator.publishRestrictedTitle')
        : blockedCategory === 'token_invalid'
          ? t('form.options.creator.tokenInvalidTitle')
          : blockedCategory === 'scope_missing'
            ? t('form.options.creator.scopeMissingTitle')
            : aggregatedCreator.blockedReason === 'privacy-options-empty'
              ? t('form.options.creator.privacyOptionsEmpty')
              : aggregatedCreator.blockedReason === 'privacy-intersection-empty'
                ? t('form.options.creator.privacyIntersectionEmpty')
                : aggregatedCreator.blockedReason === 'creator-cannot-post'
                  ? t('form.options.creator.blockedTitle')
                  : t('form.options.creator.unavailableTitle')

  return (
    <div className="omnimux-publish-settings" data-testid="direct-post-options">
      <div
        role="button"
        tabIndex={0}
        className="omnimux-publish-settings-head"
        aria-expanded={settingsOpen}
        onClick={onToggleOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleOpen()
          }
        }}
      >
        <span className="omnimux-publish-settings-title">{t('form.options.title')}</span>
        <span className="omnimux-publish-settings-summary">{settingsSummary}</span>
        <span className="omnimux-publish-settings-chevron" aria-hidden="true">
          {settingsOpen ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
        </span>
      </div>

      {settingsOpen ? (
        <div className="omnimux-publish-settings-body">
          {optionsLoading ? (
            <div className="omnimux-publish-hint" data-testid="creator-info-loading">
              {t('form.options.loading')}
            </div>
          ) : null}

          {!optionsLoading && aggregatedCreator.blocked ? (
            <div
              role="alert"
              className="omnimux-publish-mode-banner error"
              data-testid="creator-blocked-banner"
              data-error-category={blockedCategory || undefined}
            >
              <div className="omnimux-publish-mode-banner-head">
                <span className="omnimux-publish-mode-banner-title">{blockedTitle}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  leadingIcon={<IconRefreshOutline16 size={14} />}
                  data-testid="creator-info-retry"
                  onClick={onRetryCreatorInfo}
                >
                  {t('form.options.creator.retry')}
                </Button>
              </div>
              {aggregatedCreator.blockedMessage ? (
                <div className="omnimux-publish-mode-banner-body">{aggregatedCreator.blockedMessage}</div>
              ) : null}
              {aggregatedCreator.blockedLogId && !(aggregatedCreator.blockedMessage || '').includes(aggregatedCreator.blockedLogId) ? (
                <div className="omnimux-publish-mode-banner-body" data-testid="creator-blocked-log-id">
                  {t('form.options.creator.logId', { id: aggregatedCreator.blockedLogId })}
                </div>
              ) : null}
            </div>
          ) : null}

          {!optionsLoading && !aggregatedCreator.blocked && aggregatedCreator.ready ? (
            <div className="omnimux-publish-creator-strip" data-testid="creator-info-strip">
              <span className="omnimux-publish-creator-chip" data-testid="creator-nickname">
                <strong>{t('form.options.creator.label')}:</strong> {creatorNames.join(' · ')}
              </span>
              {maxDurLabel ? (
                <span className="omnimux-publish-creator-chip" data-testid="creator-max-duration">
                  {t('form.options.creator.maxDuration', { duration: maxDurLabel })}
                </span>
              ) : null}
              {aggregatedCreator.creators.length > 1 ? (
                <span className="omnimux-publish-creator-note">{t('form.options.creator.multiHint')}</span>
              ) : null}
            </div>
          ) : null}

          {type === 'video' && overDurationVideo && aggregatedCreator.max_video_post_duration_sec ? (
            <div role="alert" className="omnimux-publish-alert error" data-testid="video-duration-exceeded-alert">
              {t('form.options.videoDurationExceeded', {
                duration: formatDurationSec(overDurationVideo.duration_sec),
                max: formatDurationSec(aggregatedCreator.max_video_post_duration_sec),
              })}
            </div>
          ) : null}

          <div className="omnimux-publish-setting-row">
            <span className="omnimux-publish-setting-label">{t('form.options.privacy')}</span>
            <div className="omnimux-publish-setting-control">
              <DropdownSelect
                aria-label={t('form.options.privacy')}
                value={tiktokOptions.privacy_level}
                placeholder={t('form.options.privacy.placeholder')}
                disabled={optionsLoading || aggregatedCreator.blocked || privacyOptions.length === 0}
                options={privacyOptions}
                onChange={(value) => {
                  onClearPrivacyReset()
                  onPatchOptions({ privacy_level: value })
                }}
              />
            </div>
          </div>

          {privacyResetReason ? (
            <div role="status" className="omnimux-publish-hint warn" data-testid="privacy-reset-notice">
              {privacyResetReason === 'branded-conflict'
                ? t('form.options.privacy.resetBranded')
                : t('form.options.privacy.resetAccount')}
            </div>
          ) : null}

          {isBranded && !privacyResetReason ? (
            <div className="omnimux-publish-hint" data-testid="branded-privacy-hint">
              {t('form.options.privacy.brandedHint')}
            </div>
          ) : null}

          <div className="omnimux-publish-setting-row" data-testid="interaction-controls">
            <span className="omnimux-publish-setting-label">{t('form.options.interaction')}</span>
            <div className="omnimux-publish-setting-chips">
              {interactionItems.map(([key, label, flag, shortKey]) => {
                const isDisabled = aggregatedCreator[flag] === true
                const checked = !isDisabled && tiktokOptions[key] === true
                const disabledTitle = isDisabled
                  ? ((aggregatedCreator.disabledBy?.[shortKey]?.length ?? 0) > 1
                      ? t(`form.options.${shortKey}.disabledBy`, { accounts: aggregatedCreator.disabledBy[shortKey].join('、') })
                      : t(`form.options.${shortKey}.disabled`))
                  : undefined
                return (
                  <span key={key} className="omnimux-publish-chip-wrap" title={disabledTitle}>
                    <Button
                      type="button"
                      size="xs"
                      variant={checked ? 'secondary' : 'ghost'}
                      leadingIcon={checked ? <IconCheckOutline16 size={14} /> : undefined}
                      disabled={isDisabled}
                      aria-pressed={checked}
                      data-interaction={key}
                      onClick={() => { onPatchOptions({ [key]: !checked }) }}
                    >
                      {t(label)}
                    </Button>
                  </span>
                )
              })}
            </div>
          </div>

          {disabledInteractionHints.map((text) => (
            <div key={text} className="omnimux-publish-hint">{text}</div>
          ))}

          <div className="omnimux-publish-setting-row" data-testid="commercial-disclosure">
            <span className="omnimux-publish-setting-label">{t('form.options.commercial.row')}</span>
            <div className="omnimux-publish-setting-chips">
              <Button
                type="button"
                size="xs"
                variant={tiktokOptions.commercial_content ? 'secondary' : 'ghost'}
                leadingIcon={tiktokOptions.commercial_content ? <IconCheckOutline16 size={14} /> : undefined}
                aria-pressed={tiktokOptions.commercial_content === true}
                data-testid="commercial-toggle"
                onClick={() => {
                  const next = !tiktokOptions.commercial_content
                  onPatchOptions(next
                    ? { commercial_content: true }
                    : { commercial_content: false, your_brand: false, branded_content: false })
                }}
              >
                {tiktokOptions.commercial_content ? t('form.options.commercial.on') : t('form.options.commercial.off')}
              </Button>
            </div>
          </div>

          {tiktokOptions.commercial_content ? (
            <div className="omnimux-publish-setting-sub-col" data-testid="commercial-sub-options">
              <div className="omnimux-publish-setting-sub">
                <Button
                  type="button"
                  size="xs"
                  variant={tiktokOptions.your_brand ? 'secondary' : 'ghost'}
                  leadingIcon={tiktokOptions.your_brand ? <IconCheckOutline16 size={14} /> : undefined}
                  aria-pressed={tiktokOptions.your_brand === true}
                  data-testid="commercial-your-brand"
                  onClick={() => { onPatchOptions({ your_brand: !tiktokOptions.your_brand }) }}
                >
                  {t('form.options.yourBrand')}
                </Button>

                <span
                  className="omnimux-publish-chip-wrap"
                  title={sandboxSelfOnly ? t('form.options.branded.sandboxDisabled') : undefined}
                >
                  <Button
                    type="button"
                    size="xs"
                    variant={tiktokOptions.branded_content ? 'secondary' : 'ghost'}
                    leadingIcon={tiktokOptions.branded_content ? <IconCheckOutline16 size={14} /> : undefined}
                    disabled={sandboxSelfOnly}
                    aria-pressed={tiktokOptions.branded_content === true}
                    data-testid="commercial-branded-content"
                    onClick={() => {
                      const nextBranded = !tiktokOptions.branded_content
                      if (nextBranded && tiktokOptions.privacy_level === 'SELF_ONLY') {
                        onBrandedSelfOnlyConflict()
                      } else {
                        onPatchOptions({ branded_content: nextBranded })
                      }
                    }}
                  >
                    {t('form.options.branded')}
                  </Button>
                </span>
              </div>

              {sandboxSelfOnly ? (
                <div className="omnimux-publish-hint" data-testid="branded-sandbox-disabled-hint">
                  {t('form.options.branded.sandboxDisabled')}
                </div>
              ) : null}

              {commercialLabelText ? (
                <div className="omnimux-publish-callout" data-testid="commercial-label-preview">
                  {commercialLabelText}
                </div>
              ) : (
                <div className="omnimux-publish-hint warn" data-testid="commercial-required-hint">
                  {t('form.options.problem.commercial-brand-required')}
                </div>
              )}
            </div>
          ) : null}

          <div className="omnimux-publish-setting-row">
            <span className="omnimux-publish-setting-label">{t('form.options.aigc.row')}</span>
            <div className="omnimux-publish-setting-chips">
              <Button
                type="button"
                size="xs"
                variant={isAigc ? 'secondary' : 'ghost'}
                leadingIcon={isAigc ? <IconCheckOutline16 size={14} /> : undefined}
                aria-pressed={isAigc}
                data-testid="direct-aigc-toggle"
                onClick={onToggleAigc}
              >
                {t('form.options.aigc.label')}
              </Button>
            </div>
          </div>

          {optionsProblems.length > 0 ? (
            <div className="omnimux-publish-hint warn" data-testid="direct-options-problems">
              {optionsProblems.map((code) => t(`form.options.problem.${code}`)).join('；')}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * TikTok Content Sharing Guidelines §4 dynamic compliance declaration rendered
 * immediately above the Publish action bar for all Direct Post submissions.
 *
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   branded: boolean,
 * }} props
 */
export function ComplianceDeclaration({ t, branded }) {
  return (
    <div className="omnimux-publish-compliance-bar" data-testid="tiktok-compliance-declaration">
      <div className="omnimux-publish-compliance-text">
        <span>{t('form.options.compliance.prefix')}</span>
        {branded ? (
          <>
            <a
              href={TIKTOK_BRANDED_CONTENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="omnimux-publish-compliance-link"
              data-testid="branded-policy-link"
            >
              {t('form.options.compliance.brandedLink')}
            </a>
            <span>{t('form.options.compliance.and')}</span>
          </>
        ) : null}
        <a
          href={TIKTOK_MUSIC_USAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="omnimux-publish-compliance-link"
          data-testid="music-usage-link"
        >
          {t('form.options.compliance.musicLink')}
        </a>
        <span>{t('form.options.compliance.suffix')}</span>
      </div>
      <div className="omnimux-publish-compliance-note" data-testid="direct-post-processing-hint">
        {t('form.options.processingHint')}
      </div>
    </div>
  )
}
