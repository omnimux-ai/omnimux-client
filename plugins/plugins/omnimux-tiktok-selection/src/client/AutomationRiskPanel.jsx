import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
  Tabs,
} from 'dsh-ui-kit'
import { api } from './api.js'

export function AutomationRiskPanel({ section = 'automation', overview, t, onNotify, onOverviewChanged }) {
  const [subTab, setSubTab] = useState(section === 'automation' ? 'schedules' : 'brand')
  const [schedules, setSchedules] = useState([])
  const [runs, setRuns] = useState([])
  const [words, setWords] = useState([])
  const [settings, setSettings] = useState(overview?.settings || {})

  const [schModalOpen, setSchModalOpen] = useState(false)
  const [schName, setSchName] = useState('')
  const [schRegion, setSchRegion] = useState('US')
  const [schSource, setSchSource] = useState('rank')
  const [schFreq, setSchFreq] = useState('daily')
  const [schTime, setSchTime] = useState('09:00')
  const [schPages, setSchPages] = useState('3')
  const [schIngest, setSchIngest] = useState('30')
  const [schAutoAssets, setSchAutoAssets] = useState(false)

  const [wordModalOpen, setWordModalOpen] = useState(false)
  const [wordTerm, setWordTerm] = useState('')
  const [wordZh, setWordZh] = useState('')
  const [wordSource, setWordSource] = useState('手动添加')

  const [concurrency, setConcurrency] = useState(String(overview?.settings?.concurrency ?? 3))
  const [dailyAssetCap, setDailyAssetCap] = useState(String(overview?.settings?.dailyAssetCap ?? 2000))
  const [excludedText, setExcludedText] = useState((overview?.settings?.excludedCategories || []).join('、'))
  const [defaultImagePrompt, setDefaultImagePrompt] = useState(overview?.settings?.defaultImagePrompt || '')
  const [defaultVideoPrompt, setDefaultVideoPrompt] = useState(overview?.settings?.defaultVideoPrompt || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSubTab(section === 'automation' ? 'schedules' : 'brand')
  }, [section])

  async function refresh() {
    try {
      if (section === 'automation') {
        const [sRes, rRes] = await Promise.all([api.listSchedules(), api.listRuns()])
        setSchedules(sRes.schedules || [])
        setRuns(rRes.runs || [])
      } else {
        const [wRes, stRes] = await Promise.all([
          api.listRiskWords({ type: subTab === 'sensitive' ? 'sensitive' : 'brand' }),
          api.getSettings(),
        ])
        setWords(wRes.words || [])
        setSettings(stRes.settings || {})
        setConcurrency(String(stRes.settings?.concurrency ?? 3))
        setDailyAssetCap(String(stRes.settings?.dailyAssetCap ?? 2000))
        setExcludedText((stRes.settings?.excludedCategories || []).join('、'))
        setDefaultImagePrompt(stRes.settings?.defaultImagePrompt || '')
        setDefaultVideoPrompt(stRes.settings?.defaultVideoPrompt || '')
      }
    } catch (err) {
      onNotify(err?.message || '读取配置数据失败', true)
    }
  }

  useEffect(() => {
    refresh()
  }, [section, subTab])

  async function handleCreateSchedule() {
    if (!schName.trim()) return
    setBusy(true)
    try {
      await api.manageSchedule({
        action: 'create',
        name: schName.trim(),
        region: schRegion,
        source: schSource,
        frequency: schFreq,
        timeOfDay: schTime,
        maxPages: Number(schPages) || 3,
        maxIngest: Number(schIngest) || 30,
        autoGenerateAssets: schAutoAssets,
        enabled: true,
      })
      setSchModalOpen(false)
      setSchName('')
      await refresh()
      onOverviewChanged?.()
      onNotify('定时选品任务已创建')
    } catch (err) {
      onNotify(err?.message || '创建定时任务失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleRunScheduleNow(id) {
    setBusy(true)
    try {
      const res = await api.manageSchedule({ action: 'run_now', id })
      await refresh()
      onOverviewChanged?.()
      onNotify(`执行完成：新增 ${res.run?.addedCount ?? 0} 个，拦截 ${res.run?.blockedCount ?? 0} 个`)
    } catch (err) {
      onNotify(err?.message || '立即执行失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleSchedule(s) {
    try {
      await api.manageSchedule({ action: 'update', id: s.id, patch: { enabled: !s.enabled } })
      await refresh()
      onOverviewChanged?.()
    } catch (err) {
      onNotify(err?.message || '切换任务状态失败', true)
    }
  }

  async function handleAddWord() {
    if (!wordTerm.trim()) return
    setBusy(true)
    try {
      await api.manageRiskWords({
        action: 'add',
        type: subTab === 'sensitive' ? 'sensitive' : 'brand',
        term: wordTerm.trim(),
        zhName: wordZh.trim(),
        source: wordSource.trim() || '手动添加',
        enabled: true,
      })
      setWordModalOpen(false)
      setWordTerm('')
      setWordZh('')
      await refresh()
      onOverviewChanged?.()
      onNotify('风险词已添加')
    } catch (err) {
      onNotify(err?.message || '新增风险词失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteWord(id) {
    try {
      await api.manageRiskWords({ action: 'delete', id, confirm: true })
      await refresh()
      onOverviewChanged?.()
      onNotify('词条已删除')
    } catch (err) {
      onNotify(err?.message || '删除失败', true)
    }
  }

  async function handleSaveSettings(reset = false) {
    setBusy(true)
    try {
      await api.manageSettings(
        reset
          ? { action: 'reset' }
          : {
              action: 'update',
              concurrency: Number(concurrency) || 3,
              dailyAssetCap: Number(dailyAssetCap) || 2000,
              excludedCategories: excludedText.split(/[、,，\n]+/).map((s) => s.trim()).filter(Boolean),
              defaultImagePrompt,
              defaultVideoPrompt,
            }
      )
      await refresh()
      onOverviewChanged?.()
      onNotify(reset ? '已恢复默认配置' : '系统配置已保存')
    } catch (err) {
      onNotify(err?.message || '保存配置失败', true)
    } finally {
      setBusy(false)
    }
  }

  if (section === 'automation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="omnimux-ttsel-row">
          <Tabs
            items={[
              { id: 'schedules', label: `定时任务 (${schedules.length})` },
              { id: 'runs', label: `执行记录 (${runs.length})` },
            ]}
            activeId={subTab}
            onChange={setSubTab}
            size="sm"
          />
          <div className="omnimux-ttsel-row-end">
            {subTab === 'schedules' && (
              <Button size="sm" variant="primary" onClick={() => setSchModalOpen(true)}>
                {t('newSchedule')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={refresh}>
              {t('refresh')}
            </Button>
          </div>
        </div>

        {subTab === 'schedules' ? (
          schedules.length === 0 ? (
            <div className="omnimux-ttsel-card">
              <EmptyState
                title="暂无定时选品任务"
                action={
                  <Button variant="primary" onClick={() => setSchModalOpen(true)}>
                    {t('newSchedule')}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="omnimux-ttsel-table-wrap">
              <table className="omnimux-ttsel-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>执行周期</th>
                    <th>数据源</th>
                    <th>规模</th>
                    <th>累计入库</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong></td>
                      <td><Badge variant={s.enabled ? 'success' : 'neutral'}>{s.enabled ? '启用' : '停用'}</Badge></td>
                      <td className="omnimux-ttsel-num">{s.frequency} {s.timeOfDay} ({s.timezone})</td>
                      <td>{s.region} {s.source}</td>
                      <td className="omnimux-ttsel-num">{s.maxPages} 页 / 上限 {s.maxIngest}</td>
                      <td className="omnimux-ttsel-num">{s.totalIngested} ({s.totalRuns}次)</td>
                      <td>
                        <div className="omnimux-ttsel-row">
                          <Button size="sm" variant="primary" loading={busy} onClick={() => handleRunScheduleNow(s.id)}>
                            {t('runNow')}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => handleToggleSchedule(s)}>
                            {s.enabled ? '停用' : '启用'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : runs.length === 0 ? (
          <div className="omnimux-ttsel-card">
            <EmptyState title="暂无执行记录" />
          </div>
        ) : (
          <div className="omnimux-ttsel-table-wrap">
            <table className="omnimux-ttsel-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>触发</th>
                  <th>数据源</th>
                  <th>拉取</th>
                  <th>新增</th>
                  <th>重复</th>
                  <th>拦截</th>
                  <th>开始时间</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.scheduleName}</td>
                    <td><Badge variant={r.status === 'completed' ? 'success' : 'danger'}>{r.status}</Badge></td>
                    <td>{r.trigger === 'manual' ? '手动' : '定时'}</td>
                    <td>{r.sourceSummary}</td>
                    <td className="omnimux-ttsel-num">{r.pulledCount}</td>
                    <td className="omnimux-ttsel-num">{r.addedCount}</td>
                    <td className="omnimux-ttsel-num">{r.duplicatedCount}</td>
                    <td className="omnimux-ttsel-num">{r.blockedCount}</td>
                    <td className="omnimux-ttsel-num">{new Date(r.startedAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ModalDialog
          open={schModalOpen}
          onClose={() => setSchModalOpen(false)}
          title="新建自动选品定时任务"
          footer={
            <div className="omnimux-ttsel-row">
              <Button variant="secondary" onClick={() => setSchModalOpen(false)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" loading={busy} onClick={handleCreateSchedule}>
                创建任务
              </Button>
            </div>
          }
        >
          <div className="omnimux-ttsel-grid">
            <InputField label="任务名称" value={schName} onChange={(e) => setSchName(e.target.value)} placeholder="美国日榜美妆跟爆" />
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">数据源</span>
              <DropdownSelect
                aria-label="定时任务数据源"
                value={schSource}
                options={[
                  { value: 'rank', label: '热销榜' },
                  { value: 'search', label: '关键词搜索' },
                  { value: 'snapshot', label: '最新快照' },
                ]}
                onChange={setSchSource}
              />
            </div>
            <InputField label="站点" value={schRegion} onChange={(e) => setSchRegion(e.target.value)} />
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">执行频率</span>
              <DropdownSelect
                aria-label="执行频率"
                value={schFreq}
                options={[
                  { value: 'daily', label: '每天' },
                  { value: 'weekly', label: '每周' },
                  { value: 'hourly', label: '每小时' },
                ]}
                onChange={setSchFreq}
              />
            </div>
            <InputField label="执行时间" value={schTime} onChange={(e) => setSchTime(e.target.value)} placeholder="09:00" />
            <InputField label="拉取页数 (1-10)" value={schPages} onChange={(e) => setSchPages(e.target.value)} />
            <InputField label="单次入库上限 (1-200)" value={schIngest} onChange={(e) => setSchIngest(e.target.value)} />
            <label className="omnimux-ttsel-check-row" style={{ alignSelf: 'end', height: '32px' }}>
              <input type="checkbox" checked={schAutoAssets} onChange={(e) => setSchAutoAssets(e.target.checked)} />
              <span>入库后自动生成图片</span>
            </label>
          </div>
        </ModalDialog>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="omnimux-ttsel-row">
        <Tabs
          items={[
            { id: 'brand', label: t('brandWords') },
            { id: 'sensitive', label: t('sensitiveWords') },
            { id: 'settings', label: t('systemSettings') },
          ]}
          activeId={subTab}
          onChange={setSubTab}
          size="sm"
        />
        {subTab !== 'settings' && (
          <div className="omnimux-ttsel-row-end">
            <Button size="sm" variant="primary" onClick={() => setWordModalOpen(true)}>
              {t('addWord')}
            </Button>
          </div>
        )}
      </div>

      {subTab === 'settings' ? (
        <div className="omnimux-ttsel-card">
          <div className="omnimux-ttsel-grid">
            <InputField label="并发数 (1-8)" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
            <InputField label="每日素材生成上限" value={dailyAssetCap} onChange={(e) => setDailyAssetCap(e.target.value)} />
            <InputField label="G3 排除品类（顿号分隔）" value={excludedText} onChange={(e) => setExcludedText(e.target.value)} />
          </div>
          <div className="omnimux-ttsel-field">
            <label className="omnimux-ttsel-label" htmlFor="ttsel-img-prompt">默认生图提示词</label>
            <textarea
              id="ttsel-img-prompt"
              className="omnimux-ttsel-textarea"
              value={defaultImagePrompt}
              onChange={(e) => setDefaultImagePrompt(e.target.value)}
            />
          </div>
          <div className="omnimux-ttsel-field">
            <label className="omnimux-ttsel-label" htmlFor="ttsel-vid-prompt">默认生视频提示词</label>
            <textarea
              id="ttsel-vid-prompt"
              className="omnimux-ttsel-textarea"
              value={defaultVideoPrompt}
              onChange={(e) => setDefaultVideoPrompt(e.target.value)}
            />
          </div>
          <div className="omnimux-ttsel-row">
            <Button variant="primary" loading={busy} onClick={() => handleSaveSettings(false)}>
              {t('saveSettings')}
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => handleSaveSettings(true)}>
              {t('resetDefaults')}
            </Button>
          </div>
        </div>
      ) : words.length === 0 ? (
        <div className="omnimux-ttsel-card">
          <EmptyState
            title={subTab === 'brand' ? '暂无品牌词' : '暂无敏感词'}
            action={
              <Button variant="primary" onClick={() => setWordModalOpen(true)}>
                {t('addWord')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="omnimux-ttsel-table-wrap">
          <table className="omnimux-ttsel-table">
            <thead>
              <tr>
                <th>词条</th>
                <th>中文名</th>
                <th>状态</th>
                <th>来源</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {words.map((w) => (
                <tr key={w.id}>
                  <td><strong>{w.term}</strong></td>
                  <td>{w.zhName || '—'}</td>
                  <td><Badge variant={w.enabled ? 'success' : 'neutral'}>{w.enabled ? '启用' : '停用'}</Badge></td>
                  <td>{w.source}</td>
                  <td className="omnimux-ttsel-num">{new Date(w.createdAt).toLocaleString('zh-CN')}</td>
                  <td>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteWord(w.id)}>
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalDialog
        open={wordModalOpen}
        onClose={() => setWordModalOpen(false)}
        title={subTab === 'brand' ? '新增品牌词' : '新增敏感词'}
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setWordModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={handleAddWord}>
              保存
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <InputField label="词条" value={wordTerm} onChange={(e) => setWordTerm(e.target.value)} placeholder="如 Nike 或 Cure" />
          <InputField label="中文名" value={wordZh} onChange={(e) => setWordZh(e.target.value)} placeholder="可选" />
          <InputField label="来源" value={wordSource} onChange={(e) => setWordSource(e.target.value)} />
        </div>
      </ModalDialog>
    </div>
  )
}
