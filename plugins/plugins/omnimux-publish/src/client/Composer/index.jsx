import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronUpOutline14,
  IconPaperclipOutline16,
  IconPlayOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
} from 'dsh-ui-kit'
import { Button, DropdownSelect, InputField, Toolbar } from 'dsh-ui-kit'
import { createDraft, creatorInfo, errorText, getCapabilities, mediaContentUrl, recordDetail, submitRecord, updateDraft, uploadMedia } from '../api.js'
import { formCapabilities, parseTopics } from '../capabilities.js'
import { isSupportedImageFormat, unsupportedImageRows } from '../image-format.js'
import {
  DEFAULT_TIKTOK_OPTIONS,
  normalizeTikTokOptions,
  privacyChoices,
  storeTikTokOptions,
  tiktokOptionProblems,
} from '../../shared/tiktok-options.js'
import { accountPublishMode, resolveSelectionPublishMode } from '../../shared/tiktok-capabilities.js'
import { AccountPanel } from '../AccountPanel.jsx'

/**
 * M2–M4 发布页：类型选择（视频/图文，选定不可中途切换）→ 表单 + 左侧账号面板。
 * 草稿保存/完整恢复（素材、内容、已选账号、类型都来自 Host 账本）；封面区按
 * 所选账号平台能力置灰并说明（capabilities.js 与工具校验同一份矩阵）。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   draftId?: string,
 *   onBack: () => void,
 *   onManageAccounts?: () => void,
 *   onSubmitted: (recordId: string) => void,
 *   onSaved: () => void,
 * }} props
 */
export function Composer({ t, draftId, onBack, onManageAccounts, onSubmitted, onSaved }) {
  const [editingId, setEditingId] = useState(draftId || '')
  const [type, setType] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [topicsRaw, setTopicsRaw] = useState('')
  /** @type {[Array<{ id: string, kind: string, filename: string, content_type?: string }>, Function]} */
  const [mediaList, setMediaList] = useState([])
  const [coverMediaId, setCoverMediaId] = useState('')
  const [photoCoverIndex, setPhotoCoverIndex] = useState(0)
  const [isAigc, setIsAigc] = useState(false)
  const [accountIds, setAccountIds] = useState([])
  /** @type {[Array<Record<string, unknown>>, Function]} */
  const [allAccountRows, setAllAccountRows] = useState([])
  const [platforms, setPlatforms] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tiktokOptions, setTiktokOptions] = useState(() => normalizeTikTokOptions(DEFAULT_TIKTOK_OPTIONS))
  /** @type {[Record<string, unknown> | null, Function]} */
  const [accountCreator, setAccountCreator] = useState(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [legacyOptionsOpen, setLegacyOptionsOpen] = useState(false)
  const fileInputRef = useRef(null)

  // 能力矩阵（表单裁剪数据源，与工具校验同源）
  useEffect(() => {
    let disposed = false
    getCapabilities().then((result) => {
      if (!disposed && result.ok && result.body && result.body.platforms) setPlatforms(result.body.platforms)
    }).catch(() => {})
    return () => { disposed = true }
  }, [])

  // 编辑现有草稿：完整恢复（素材、内容、账号、类型；素材 kind 来自 Host media 行）
  useEffect(() => {
    if (!draftId) return
    let disposed = false
    recordDetail(draftId).then((result) => {
      if (disposed) return
      const record = result.ok && result.body ? result.body.record : null
      if (!record) {
        setError(errorText(result.body, result.status))
        return
      }
      setType(String(record.type || ''))
      setTitle(String(record.title || ''))
      setDescription(String(record.description || ''))
      setTopicsRaw(Array.isArray(record.topics) ? record.topics.join(' ') : '')
      const mediaRows = Array.isArray(result.body.media) ? result.body.media : []
      setMediaList(mediaRows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind || 'image'),
        filename: String(row.filename || ''),
        content_type: String(row.content_type || ''),
      })))
      setCoverMediaId(record.cover_media_id ? String(record.cover_media_id) : '')
      if (typeof record.settings?.photo_cover_index === 'number' && Number.isInteger(record.settings.photo_cover_index) && record.settings.photo_cover_index >= 0) {
        setPhotoCoverIndex(record.settings.photo_cover_index)
      }
      setIsAigc(record.settings?.is_aigc === true)
      if (record.settings?.tiktok_options) {
        setTiktokOptions(normalizeTikTokOptions(record.settings.tiktok_options))
      }
      setAccountIds((Array.isArray(record.account_ids) ? record.account_ids : []).map(String))
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { disposed = true }
  }, [draftId])

  const selectedSet = new Set(accountIds.map(String))
  const accountRows = allAccountRows.filter((row) => selectedSet.has(String(row.id)))
  const publishMode = accountIds.length > 0 && accountRows.length > 0
    ? resolveSelectionPublishMode(accountRows)
    : 'legacy_unknown'
  const showDirectOptions = publishMode === 'direct' || (publishMode === 'legacy_unknown' && legacyOptionsOpen)
  const needsCreatorInfo = accountIds.length > 0
    && accountRows.length > 0
    && (publishMode === 'direct' || (publishMode === 'legacy_unknown' && legacyOptionsOpen))
  // creator-info 只对真正走直发的账号发起：混选 draft_only + direct 时必须命中 direct 账号，
  // 不能因为 draft_only 排在 accountIds[0] 就对草稿账号发请求；兼容态展开时按需回退首个账号。
  const creatorInfoAccountId = !needsCreatorInfo
    ? ''
    : String((
      accountRows.find((row) => accountPublishMode(row) === 'direct')
      ?? (publishMode === 'legacy_unknown' ? accountRows[0] : null)
    )?.id ?? '')

  const images = mediaList.filter((m) => m.kind === 'image')
  const videos = mediaList.filter((m) => m.kind === 'video')
  const unsupportedImages = type === 'image' ? unsupportedImageRows(images) : []
  const imageFormatBlocked = unsupportedImages.length > 0
  const scopeMissingBlocked = publishMode === 'no_publish_scope'
  // 账号发布能力（隐私级别/禁用的互动项）——仅直发账号或兼容态手动展开时拉取；draft_only 零请求。
  useEffect(() => {
    if (!needsCreatorInfo) return
    const accountId = creatorInfoAccountId
    if (accountId === '') return
    if (accountCreator && String(accountCreator.account_id || '') === accountId) return
    let disposed = false
    setOptionsLoading(true)
    creatorInfo(accountId).then((result) => {
      if (disposed) return
      const payload = result.ok && result.body ? result.body : null
      const data = payload && typeof payload === 'object' ? (payload.data ?? payload) : null
      setAccountCreator(data && typeof data === 'object' ? { ...data, account_id: accountId } : { account_id: accountId, degraded: true })
      setOptionsLoading(false)
    }).catch(() => {
      if (disposed) return
      setAccountCreator({ account_id: accountId, degraded: true })
      setOptionsLoading(false)
    })
    return () => { disposed = true }
  }, [accountIds, accountCreator, creatorInfoAccountId, needsCreatorInfo])

  useEffect(() => {
    const allowed = privacyChoices(accountCreator)
    setTiktokOptions((prev) => (allowed.includes(prev.privacy_level) ? prev : { ...prev, privacy_level: allowed[0] }))
  }, [accountCreator])

  useEffect(() => {
    if (images.length > 0 && photoCoverIndex >= images.length) setPhotoCoverIndex(0)
  }, [images.length, photoCoverIndex])

  const optionsProblems = showDirectOptions ? tiktokOptionProblems(tiktokOptions) : []
  const optionsBlocked = optionsProblems.length > 0
  const toggleDisabled = (flag) => accountCreator?.[flag] === true
  const patchOptions = useCallback((patch) => {
    setTiktokOptions((prev) => normalizeTikTokOptions({ ...prev, ...patch }))
  }, [])
  const caps = formCapabilities({
    platforms,
    selectedAccounts: accountRows,
    type: type || 'image',
    imageCount: images.length,
  })

  /** 媒体拾取 → POST /dsh-publish/media（sha256 入库）→ 草稿引用 media_id。 */
  const handleFiles = useCallback(async (files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return
    setUploading(true)
    setError('')
    const rejected = []
    const accepted = []
    for (const file of list) {
      const mime = String(file.type || '')
      const looksLikeImage = mime !== '' ? mime.startsWith('image/') : /\.(png|gif|bmp|tiff?|avif|heic)$/i.test(String(file.name || ''))
      if (type === 'image' && looksLikeImage && !isSupportedImageFormat(mime, file.name)) {
        rejected.push(String(file.name || 'image'))
        continue
      }
      accepted.push(file)
    }
    if (rejected.length > 0) setError(t('form.imageFormatRejected', { names: rejected.join('、') }))
    for (const file of accepted) {
      try {
        const result = await uploadMedia(file)
        if (result.ok && result.body && result.body.media) {
          const media = result.body.media
          setMediaList((prev) => [...prev, {
            id: String(media.id),
            kind: String(media.kind),
            filename: String(media.filename),
            content_type: String(media.content_type || file.type || ''),
          }])
        } else {
          setError(t('form.uploadFailed', { reason: errorText(result.body, result.status) }))
        }
      } catch (caught) {
        setError(t('form.uploadFailed', { reason: caught instanceof Error ? caught.message : String(caught) }))
      }
    }
    setUploading(false)
  }, [t, type])

  /**
   * 组装提交给 Host 的 payload（与 publish_create_draft 同构）。
   */
  const buildPayload = useCallback(() => {
    /** @type {Record<string, unknown>} */
    const settings = {}
    if (publishMode === 'draft_only') {
      settings.publish_mode = 'draft'
      if (type === 'image') {
        settings.photo_cover_index = photoCoverIndex
        settings.is_aigc = isAigc
      }
    } else if (publishMode === 'direct') {
      settings.publish_mode = 'direct'
      settings.tiktok_options = storeTikTokOptions(tiktokOptions)
      if (type === 'image') {
        settings.photo_cover_index = photoCoverIndex
        settings.is_aigc = isAigc
      }
    } else if (legacyOptionsOpen) {
      settings.tiktok_options = storeTikTokOptions(tiktokOptions)
    }
    /** @type {Record<string, unknown>} */
    const payload = {
      title,
      description,
      topics: parseTopics(topicsRaw),
      media: mediaList.map((m) => ({ media_id: m.id })),
      settings,
    }
    if (type === 'image' && coverMediaId && caps.cover.enabled) payload.cover = { media_id: coverMediaId }
    return payload
  }, [title, description, topicsRaw, mediaList, coverMediaId, type, tiktokOptions, publishMode, photoCoverIndex, isAigc, legacyOptionsOpen, caps.cover.enabled])

  /**
   * 保存草稿（新建或更新，含账号挂载——Host 走与 assign 工具同一条校验）。
   * @param {{ withAccounts?: boolean }} [opts]
   * @returns {Promise<string | null>} record id
   */
  const persistDraft = useCallback(async (opts = {}) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let id = editingId
      const payload = opts.withAccounts !== false
        ? { ...buildPayload(), account_ids: accountIds }
        : buildPayload()
      if (!id) {
        const result = await createDraft(type, payload)
        if (!result.ok || !result.body || !result.body.record) {
          throw new PublishUiError(errorText(result.body, result.status), result.body)
        }
        id = String(result.body.record.id)
        setEditingId(id)
      } else {
        const result = await updateDraft(id, payload)
        if (!result.ok) throw new PublishUiError(errorText(result.body, result.status), result.body)
      }
      setNotice(t('form.saved'))
      onSaved()
      return id
    } catch (caught) {
      setError(describeError(caught, t))
      return null
    } finally {
      setBusy(false)
    }
  }, [editingId, buildPayload, type, accountIds, t, onSaved])

  /** 一键发布：保存 → POST submit（立即返回）→ 轮询跟进由舞台层接管。 */
  const handleSubmit = useCallback(async () => {
    if (scopeMissingBlocked) {
      setError(t('form.scopeMissing.body'))
      return
    }
    if (optionsBlocked) {
      setError(optionsProblems.map((code) => t(`form.options.problem.${code}`)).join(' '))
      return
    }
    if (imageFormatBlocked) {
      setError(t('form.imageFormatBlocked', { count: unsupportedImages.length }))
      return
    }
    if (accountIds.length === 0) {
      setError(t('form.submitNoAccounts'))
      return
    }
    const id = await persistDraft({ withAccounts: true })
    if (!id) return
    setBusy(true)
    try {
      const result = await submitRecord(id)
      if (!result.ok) throw new PublishUiError(errorText(result.body, result.status), result.body)
      onSubmitted(id)
    } catch (caught) {
      setError(describeError(caught, t))
    } finally {
      setBusy(false)
    }
  }, [accountIds.length, imageFormatBlocked, unsupportedImages.length, optionsBlocked, optionsProblems, scopeMissingBlocked, persistDraft, onSubmitted, t])

  // ---- M2 类型选择（新草稿入口）----
  if (!type) {
    return (
      <div className="omnimux-publish-type-page">
        <div className="omnimux-publish-type-toolbar">
          <Button variant="ghost" size="sm" leadingIcon={<IconChevronLeftOutline14 size={14} />} onClick={onBack}>
            {t('form.back')}
          </Button>
        </div>
        <div className="omnimux-publish-type-pick">
          <div className="omnimux-publish-type-title">{t('type.title')}</div>
          <div className="omnimux-publish-type-row">
            <TypeCard t={t} value="video" onPick={setType} />
            <TypeCard t={t} value="image" onPick={setType} />
          </div>
        </div>
      </div>
    )
  }

  const coverBlocked = type === 'image' && !caps.cover.enabled
  const selectedAccount = accountRows.find((row) => String(row.id) === String(accountIds[0])) || null
  const isDraftMode = publishMode === 'draft_only'
  const isLegacyCompat = accountIds.length > 0 && accountRows.length > 0 && publishMode === 'legacy_unknown'
  const settingsSummary = [
    t(`form.options.privacy.${tiktokOptions.privacy_level}`),
    tiktokOptions.allow_comment ? t('form.options.comment.short') : null,
    tiktokOptions.allow_duet ? t('form.options.duet.short') : null,
    tiktokOptions.allow_stitch ? t('form.options.stitch.short') : null,
  ].filter(Boolean).join(' · ')
  const actionModeTitle = isDraftMode
    ? t('form.draftUploadMode')
    : isLegacyCompat && !legacyOptionsOpen
      ? t('form.legacyMode')
      : t('form.publishNow')
  const actionModeHint = isDraftMode
    ? t('form.draftUploadHint')
    : isLegacyCompat && !legacyOptionsOpen
      ? t('form.legacyHint')
      : t('form.publishNowHint')
  const submitButtonLabel = isDraftMode
    ? (busy ? t('form.draftSubmitting') : t('form.draftSubmit'))
    : (busy ? t('form.submitting') : t('form.submit'))
  const previewPillLabel = isDraftMode
    ? t('form.preview.inboxDraft')
    : isLegacyCompat && !legacyOptionsOpen
      ? t('form.preview.legacy')
      : t(`form.options.privacy.${tiktokOptions.privacy_level}`)
  const previewCommentLabel = showDirectOptions && tiktokOptions.allow_comment
    ? t('form.options.comment.short')
    : ''

  return (
    <div className="omnimux-publish-composer">
      <AccountPanel
        t={t}
        selectedIds={accountIds}
        onManageAccounts={onManageAccounts}
        onRowsLoaded={(rows) => { setAllAccountRows(rows) }}
        onChange={(ids, rows) => {
          setAccountIds(ids)
          setAllAccountRows((prev) => (prev.length > 0 ? prev : rows))
        }}
      />

      <div className="omnimux-publish-workspace">
        <div className="omnimux-publish-main">
          <div className="omnimux-publish-editor-pane">
            <div className="omnimux-publish-editor-head">
              <Button variant="ghost" size="sm" leadingIcon={<IconChevronLeftOutline14 size={14} />} onClick={onBack}>
                {t('form.back')}
              </Button>
              <span className="omnimux-publish-editor-title">{t(`type.${type}`)}</span>
              {editingId ? <span className="omnimux-publish-lock">{t('type.locked')}</span> : null}
            </div>

            {error ? <div role="alert" className="omnimux-publish-alert error">{error}</div> : null}
            {notice ? <div role="status" className="omnimux-publish-alert ok">{notice}</div> : null}

            {scopeMissingBlocked ? (
              <div role="alert" className="omnimux-publish-mode-banner error" data-testid="scope-missing-banner">
                <div className="omnimux-publish-mode-banner-head">
                  <span className="omnimux-publish-mode-banner-title">{t('form.scopeMissing.title')}</span>
                  {typeof onManageAccounts === 'function' ? (
                    <Button type="button" size="xs" variant="outline" onClick={onManageAccounts}>
                      {t('form.scopeMissing.action')}
                    </Button>
                  ) : null}
                </div>
                <div className="omnimux-publish-mode-banner-body">{t('form.scopeMissing.body')}</div>
              </div>
            ) : null}

            {isDraftMode ? (
              <div className="omnimux-publish-mode-banner inbox" data-testid="draft-mode-banner">
                <div className="omnimux-publish-mode-banner-head">
                  <span className="omnimux-publish-mode-banner-title">{t('form.draftBanner.title')}</span>
                </div>
                <div className="omnimux-publish-mode-banner-body">
                  {type === 'video' ? t('form.draftBanner.videoBody') : t('form.draftBanner.imageBody')}
                </div>
                <div className="omnimux-publish-rule-chips">
                  <span className="omnimux-publish-rule-chip">
                    {type === 'video'
                      ? t('form.draftBanner.videoRule')
                      : (caps.imageLimitSource === 'server' && typeof caps.imageLimit === 'number'
                        ? t('form.draftBanner.imageRuleServer', { count: caps.imageLimit })
                        : t('form.draftBanner.imageRule'))}
                  </span>
                  <span className="omnimux-publish-rule-chip">{t('form.draftBanner.noSchedule')}</span>
                </div>
                {type === 'image' ? (
                  <div className="omnimux-publish-setting-chips">
                    <Button
                      type="button"
                      size="xs"
                      variant={isAigc ? 'secondary' : 'ghost'}
                      leadingIcon={isAigc ? <IconCheckOutline16 size={14} /> : undefined}
                      aria-pressed={isAigc}
                      onClick={() => { setIsAigc((prev) => !prev) }}
                    >
                      {t('form.draftBanner.photoAigc')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isLegacyCompat ? (
              <div className="omnimux-publish-mode-banner warn" data-testid="legacy-fallback-banner">
                <div className="omnimux-publish-mode-banner-head">
                  <span className="omnimux-publish-mode-banner-title">{t('form.legacyBanner.title')}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => { setLegacyOptionsOpen((open) => !open) }}
                  >
                    {legacyOptionsOpen ? t('form.legacyBanner.collapse') : t('form.legacyBanner.expand')}
                  </Button>
                </div>
                <div className="omnimux-publish-mode-banner-body">{t('form.legacyBanner.body')}</div>
              </div>
            ) : null}

            {showDirectOptions ? (
              <div className="omnimux-publish-settings" data-testid="direct-post-options">
                <div
                  role="button"
                  tabIndex={0}
                  className="omnimux-publish-settings-head"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSettingsOpen((open) => !open)
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
                    {optionsLoading ? <Hint text={t('form.options.loading')} /> : null}
                    <div className="omnimux-publish-setting-row">
                      <span className="omnimux-publish-setting-label">{t('form.options.privacy')}</span>
                      <DropdownSelect
                        aria-label={t('form.options.privacy')}
                        value={tiktokOptions.privacy_level}
                        options={privacyChoices(accountCreator).map((level) => ({ value: level, label: t(`form.options.privacy.${level}`) }))}
                        onChange={(value) => { patchOptions({ privacy_level: value }) }}
                      />
                    </div>
                    <div className="omnimux-publish-setting-row">
                      <span className="omnimux-publish-setting-label">{t('form.options.interaction')}</span>
                      <div className="omnimux-publish-setting-chips">
                        {[['allow_comment', 'form.options.comment', 'comment_disabled'], ['allow_duet', 'form.options.duet', 'duet_disabled'], ['allow_stitch', 'form.options.stitch', 'stitch_disabled']].map(([key, label, flag]) => (
                          <Button
                            key={key}
                            type="button"
                            size="xs"
                            variant={tiktokOptions[key] === true ? 'secondary' : 'ghost'}
                            leadingIcon={tiktokOptions[key] === true ? <IconCheckOutline16 size={14} /> : undefined}
                            disabled={toggleDisabled(flag)}
                            aria-pressed={tiktokOptions[key] === true}
                            onClick={() => { patchOptions({ [key]: tiktokOptions[key] !== true }) }}
                          >
                            {t(label)}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="omnimux-publish-setting-row">
                      <span className="omnimux-publish-setting-label">{t('form.options.commercial.row')}</span>
                      <div className="omnimux-publish-setting-chips">
                        <Button
                          type="button"
                          size="xs"
                          variant={tiktokOptions.commercial_content ? 'secondary' : 'ghost'}
                          leadingIcon={tiktokOptions.commercial_content ? <IconCheckOutline16 size={14} /> : undefined}
                          aria-pressed={tiktokOptions.commercial_content === true}
                          onClick={() => { patchOptions({ commercial_content: tiktokOptions.commercial_content !== true }) }}
                        >
                          {tiktokOptions.commercial_content ? t('form.options.commercial.on') : t('form.options.commercial.off')}
                        </Button>
                      </div>
                    </div>
                    {tiktokOptions.commercial_content ? (
                      <div className="omnimux-publish-setting-sub">
                        <Button
                          type="button"
                          size="xs"
                          variant={tiktokOptions.your_brand ? 'secondary' : 'ghost'}
                          aria-pressed={tiktokOptions.your_brand === true}
                          onClick={() => { patchOptions({ your_brand: true, branded_content: false }) }}
                        >
                          {t('form.options.yourBrand')}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant={tiktokOptions.branded_content ? 'secondary' : 'ghost'}
                          aria-pressed={tiktokOptions.branded_content === true}
                          onClick={() => { patchOptions({ your_brand: false, branded_content: true }) }}
                        >
                          {t('form.options.branded')}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant={tiktokOptions.music_usage_confirmed ? 'secondary' : 'ghost'}
                          leadingIcon={tiktokOptions.music_usage_confirmed ? <IconCheckOutline16 size={14} /> : undefined}
                          aria-pressed={tiktokOptions.music_usage_confirmed === true}
                          onClick={() => { patchOptions({ music_usage_confirmed: tiktokOptions.music_usage_confirmed !== true }) }}
                        >
                          {t('form.options.music.chip')}
                        </Button>
                      </div>
                    ) : null}
                    {optionsProblems.length > 0 ? (
                      <Hint tone="warn" text={optionsProblems.map((code) => t(`form.options.problem.${code}`)).join('；')} />
                    ) : null}
                    {[['comment_disabled', 'form.options.comment.disabled'], ['duet_disabled', 'form.options.duet.disabled'], ['stitch_disabled', 'form.options.stitch.disabled']]
                      .filter(([flag]) => toggleDisabled(flag))
                      .map(([, label]) => <Hint key={label} text={t(label)} />)}
                  </div>
                ) : null}
              </div>
            ) : null}

            <InputField
              label={t('form.title')}
              value={title}
              placeholder={t('form.titlePlaceholder')}
              onChange={(event) => { setTitle(event.currentTarget.value) }}
            />

            <label className="omnimux-publish-field">
              <span className="omnimux-publish-label">{t('form.description')}</span>
              <textarea
                value={description}
                placeholder={t('form.descriptionPlaceholder')}
                rows={4}
                className="omnimux-publish-textarea"
                onChange={(event) => { setDescription(event.currentTarget.value) }}
              />
            </label>

            <InputField
              label={t('form.topics')}
              value={topicsRaw}
              placeholder={t('form.topicsPlaceholder')}
              onChange={(event) => { setTopicsRaw(event.currentTarget.value) }}
            />

            <div className="omnimux-publish-field">
              <span className="omnimux-publish-label">{t('form.media')}</span>
              <div className="omnimux-publish-media">
                {mediaList.map((media) => (
                  <div key={media.id} className="omnimux-publish-media-item">
                    {media.kind === 'image' ? (
                      <img src={mediaContentUrl(media.id)} alt={media.filename} className="omnimux-publish-thumb" />
                    ) : (
                      <div className="omnimux-publish-thumb"><IconPlayOutline16 size={20} /></div>
                    )}
                    {type === 'image' && media.kind === 'image' && !isSupportedImageFormat(media.content_type, media.filename) ? (
                      <span className="omnimux-publish-media-badge">{t('form.imageFormatUnsupported')}</span>
                    ) : null}
                    <div className="omnimux-publish-media-actions">
                      {type === 'image' && media.kind === 'image' ? (() => {
                        const imageIndex = images.findIndex((img) => img.id === media.id)
                        const isCarouselCover = isDraftMode
                          ? imageIndex === photoCoverIndex
                          : coverMediaId === media.id
                        return (
                          <Button
                            type="button"
                            size="xs"
                            variant={isCarouselCover ? 'secondary' : 'ghost'}
                            disabled={!isDraftMode && coverBlocked}
                            leadingIcon={isCarouselCover ? <IconCheckOutline16 size={14} /> : undefined}
                            onClick={() => {
                              if (isDraftMode && imageIndex >= 0) setPhotoCoverIndex(imageIndex)
                              else setCoverMediaId(media.id)
                            }}
                          >
                            {isCarouselCover ? t('form.cover') : t('form.setCover')}
                          </Button>
                        )
                      })() : null}
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        leadingIcon={<IconTrashOutline16 size={14} />}
                        onClick={() => {
                          setMediaList((prev) => prev.filter((m) => m.id !== media.id))
                          if (coverMediaId === media.id) setCoverMediaId('')
                        }}
                      >
                        {t('form.remove')}
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="omnimux-publish-add-media"
                  disabled={uploading}
                  loading={uploading}
                  leadingIcon={<IconPlusOutline16 />}
                  onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }}
                >
                  {type === 'video' ? t('form.addMedia.video') : t('form.addMedia.image')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple={type === 'image'}
                  accept={type === 'video' ? 'video/*' : 'image/*'}
                  hidden
                  onChange={(event) => {
                    void handleFiles(event.currentTarget.files)
                    event.currentTarget.value = ''
                  }}
                />
              </div>
              {type === 'video' && videos.length === 0 ? <Hint text={t('form.needVideo')} /> : null}
              {type === 'image' && images.length === 0 ? <Hint text={t('form.needImage')} /> : null}
              {type === 'image' && imageFormatBlocked ? (
                <Hint text={t('form.imageFormatBlocked', { count: unsupportedImages.length })} tone="warn" />
              ) : null}
              {type === 'image' && typeof caps.imageLimit === 'number' ? (
                <Hint
                  text={caps.imageOverLimit
                    ? t('form.imageOverLimit', { count: images.length, max: caps.imageLimit })
                    : caps.imageLimitSource === 'server'
                      ? t('form.imageLimitServer', { count: caps.imageLimit })
                      : t('form.imageLimitProtocol', { count: caps.imageLimit })}
                  tone={caps.imageOverLimit ? 'warn' : 'muted'}
                />
              ) : null}
              {caps.typeConflicts.length > 0 ? (
                <Hint text={`${caps.typeConflicts.join(', ')} × ${t(`type.${type}`)}`} tone="warn" />
              ) : null}
            </div>

            {type === 'image' ? (
              isDraftMode ? (
                <div className="omnimux-publish-field">
                  <span className="omnimux-publish-label">{t('form.cover')}</span>
                  <div className="omnimux-publish-cover-row">
                    {images[photoCoverIndex] ? (
                      <img src={mediaContentUrl(images[photoCoverIndex].id)} alt="" className="omnimux-publish-thumb sm" />
                    ) : (
                      <div className="omnimux-publish-thumb sm"><IconPaperclipOutline16 size={18} /></div>
                    )}
                    <span className="omnimux-publish-cover-note">
                      {images.length > 0 ? t('form.draftBanner.photoCoverNote', { index: photoCoverIndex + 1 }) : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className={coverBlocked ? 'omnimux-publish-field dim' : 'omnimux-publish-field'}>
                  <span className="omnimux-publish-label">{t('form.cover')}</span>
                  <div className="omnimux-publish-cover-row">
                    {coverMediaId ? (
                      <img src={mediaContentUrl(coverMediaId)} alt="" className="omnimux-publish-thumb sm" />
                    ) : (
                      <div className="omnimux-publish-thumb sm"><IconPaperclipOutline16 size={18} /></div>
                    )}
                    {coverBlocked ? (
                      <span className="omnimux-publish-cover-note">
                        {t('form.coverDisabled', { platforms: caps.cover.blockedPlatforms.join(', ') })}
                      </span>
                    ) : (
                      <span className="omnimux-publish-cover-note">{coverMediaId ? <IconCheckOutline16 size={14} /> : '—'}</span>
                    )}
                  </div>
                </div>
              )
            ) : null}
          </div>

          <ComposerPreview
            t={t}
            type={type}
            title={title}
            description={description}
            topics={parseTopics(topicsRaw)}
            images={images}
            account={selectedAccount}
            privacyLabel={previewPillLabel}
            commentLabel={previewCommentLabel}
          />
        </div>

        <div className="omnimux-publish-actionbar">
          <div className="omnimux-publish-actionbar-meta">
            <span className="omnimux-publish-actionbar-mode">{actionModeTitle}</span>
            <span className="omnimux-publish-actionbar-hint">{actionModeHint}</span>
          </div>
          <div className="omnimux-publish-actionbar-actions">
            <Button variant="secondary" size="sm" disabled={uploading} loading={busy} onClick={() => { void persistDraft() }}>
              {t('form.saveDraft')}
            </Button>
            <Button variant="primary" size="sm" disabled={uploading || imageFormatBlocked || optionsBlocked || scopeMissingBlocked} loading={busy} onClick={() => { void handleSubmit() }}>
              {submitButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 右侧只读预览：模拟 TikTok 帖子卡片，随左侧输入实时更新。
 * @param {{
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   type: string,
 *   title: string,
 *   description: string,
 *   topics: string[],
 *   images: Array<{ id: string, filename: string }>,
 *   account: Record<string, unknown> | null,
 *   privacyLabel: string,
 *   commentLabel: string,
 * }} props
 */
function ComposerPreview({ t, type, title, description, topics, images, account, privacyLabel, commentLabel }) {
  const name = String(account?.display_name || account?.username || t('form.preview.noAccount'))
  const handle = String(account?.username || 'tiktok')
  const initial = name.trim().slice(0, 1).toUpperCase() || 'T'
  return (
    <aside className="omnimux-publish-preview">
      <div className="omnimux-publish-preview-head">{t('form.preview')}</div>
      <div className="omnimux-publish-preview-card">
        <div className="omnimux-publish-preview-user">
          <div className="omnimux-publish-preview-avatar">{initial}</div>
          <div className="omnimux-publish-preview-id">
            <span className="omnimux-publish-preview-name">{name}</span>
            <span className="omnimux-publish-preview-handle">@{handle}</span>
          </div>
        </div>
        {images.length > 0 ? (
          <div className={images.length > 1 ? 'omnimux-publish-preview-media grid' : 'omnimux-publish-preview-media'}>
            {images.slice(0, 4).map((media) => (
              <img key={media.id} src={mediaContentUrl(media.id)} alt={media.filename} />
            ))}
          </div>
        ) : (
          <div className="omnimux-publish-preview-empty">{t('form.preview.emptyMedia')}</div>
        )}
        <div className="omnimux-publish-preview-caption">
          {title ? <strong>{title}</strong> : null}
          {description ? <p>{description}</p> : null}
          {topics.length > 0 ? <p className="omnimux-publish-preview-topics">{topics.map((topic) => `#${topic}`).join(' ')}</p> : null}
          {!title && !description && topics.length === 0 ? <span className="omnimux-publish-preview-placeholder">{t('form.preview.emptyText')}</span> : null}
        </div>
        <div className="omnimux-publish-preview-foot">
          <span className="omnimux-publish-preview-pill">{privacyLabel}</span>
          {commentLabel ? <span>{commentLabel}</span> : null}
          <span className="omnimux-publish-preview-type">{t(`type.${type}`)}</span>
        </div>
      </div>
      <div className="omnimux-publish-preview-note">{t('form.preview.note')}</div>
    </aside>
  )
}

/** UI 层错误（携带 Host 校验 details 时展开成行内错误）。 */
class PublishUiError extends Error {
  /**
   * @param {string} message
   * @param {unknown} body
   */
  constructor(message, body) {
    super(message)
    this.body = body
  }
}

/**
 * @param {unknown} caught
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 */
function describeError(caught, t) {
  const body = caught instanceof PublishUiError ? caught.body : null
  const details = body && typeof body === 'object' && Array.isArray(/** @type {any} */ (body).details?.errors)
    ? /** @type {any} */ (body).details.errors
    : null
  if (details && details.length > 0) {
    return `${t('form.submitBlocked', { reason: '' })}${details.map((e) => String(e.message || e.code || '')).join('\n')}`
  }
  return caught instanceof Error ? caught.message : String(caught)
}

/**
 * @param {{ t: (key: string, vars?: Record<string, unknown>) => string, value: 'video' | 'image', onPick: (value: 'video' | 'image') => void }} props
 */
function TypeCard({ t, value, onPick }) {
  const Icon = value === 'video' ? IconPlayOutline16 : IconPaperclipOutline16
  return (
    <Button type="button" variant="ghost" onClick={() => onPick(value)} className="omnimux-publish-type-card">
      <span className="omnimux-publish-type-icon"><Icon size={20} /></span>
      <span className="omnimux-publish-type-name">{t('type.' + value)}</span>
      <span className="omnimux-publish-type-hint">{t('type.' + value + '.hint')}</span>
    </Button>
  )
}

/**
 * @param {{ text: string, tone?: 'muted' | 'warn' }} props
 */
function Hint({ text, tone = 'muted' }) {
  return <div className={tone === 'warn' ? 'omnimux-publish-hint warn' : 'omnimux-publish-hint'}>{text}</div>
}
