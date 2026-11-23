import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  CopyButton,
  Drawer,
  DropdownSelect,
  EmptyState,
  InputField,
  ModalDialog,
} from 'dsh-ui-kit'
import { api } from './api.js'

const STATUS_BADGE = {
  queued: { label: '排队', variant: 'neutral' },
  g1_running: { label: 'G1中', variant: 'info' },
  g2_running: { label: 'G2中', variant: 'info' },
  g3_running: { label: 'G3中', variant: 'info' },
  completed: { label: '已完成', variant: 'success' },
  stopped: { label: '已停止', variant: 'warning' },
  failed: { label: '失败', variant: 'danger' },
}

const CONCLUSION_BADGE = {
  pass: { label: '通过', variant: 'success' },
  fail: { label: '淘汰', variant: 'danger' },
  incomplete: { label: '未完成', variant: 'warning' },
}

export function ThreeGatePanel({ overview, t, onNotify, onLibraryChanged }) {
  const [source, setSource] = useState('rank')
  const [region, setRegion] = useState('US')
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [snapshotId, setSnapshotId] = useState('')
  const [sortField, setSortField] = useState('sales7d')
  const [totalSalesMax, setTotalSalesMax] = useState('50000')
  const [sales7dMin, setSales7dMin] = useState('50')
  const [creatorsMax, setCreatorsMax] = useState('1000')
  const [commissionMin, setCommissionMin] = useState('10')
  const [accelMin, setAccelMin] = useState('1.1')
  const [maxPages, setMaxPages] = useState('3')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [ratingMin, setRatingMin] = useState('4')
  const [listedDaysMax, setListedDaysMax] = useState('180')
  const [accelBase28dMin, setAccelBase28dMin] = useState('28')
  const [g2MinCardRatio, setG2MinCardRatio] = useState('20')
  const [g2MaxVideoRatio, setG2MaxVideoRatio] = useState('0')
  const [maxIngest, setMaxIngest] = useState('50')
  const [concurrency, setConcurrency] = useState('4')
  const [useAiAudit, setUseAiAudit] = useState(true)

  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState(null)
  const [creating, setCreating] = useState(false)

  const [tasks, setTasks] = useState([])
  const [activeTask, setActiveTask] = useState(null)
  const [activeGate, setActiveGate] = useState('g3')
  const [conclusionFilter, setConclusionFilter] = useState('all')
  const [evidenceItem, setEvidenceItem] = useState(null)

  const regionOptions = useMemo(
    () => (overview?.regions || [{ code: 'US', labelZh: '美国' }]).map((r) => ({ value: r.code, label: `${r.labelZh} (${r.code})` })),
    [overview]
  )
  const categoryOptions = useMemo(
    () => [{ value: '', label: '全部类目' }, ...(overview?.categories || []).map((c) => ({ value: c, label: c }))],
    [overview]
  )
  const snapshotOptions = useMemo(
    () => [
      { value: '', label: '未指定快照' },
      ...(overview?.snapshots || []).map((s) => ({ value: s.id, label: `${s.name} (${s.itemCount})` })),
    ],
    [overview]
  )

  async function refreshTasks(keepActiveId = activeTask?.id) {
    try {
      const res = await api.listTasks()
      setTasks(res.tasks || [])
      if (keepActiveId) {
        const detail = await api.getTask(keepActiveId)
        setActiveTask(detail.task)
      }
    } catch (err) {
      onNotify(err?.message || '读取选品任务失败', true)
    }
  }

  useEffect(() => {
    refreshTasks(null)
  }, [])

  function buildCriteria() {
    return {
      source,
      region,
      category,
      keyword,
      snapshotId: source === 'snapshot' ? snapshotId || overview?.snapshots?.[0]?.id || '' : snapshotId,
      sortField,
      totalSalesMax: totalSalesMax === '' ? null : Number(totalSalesMax),
      sales7dMin: sales7dMin === '' ? null : Number(sales7dMin),
      creatorsMax: creatorsMax === '' ? null : Number(creatorsMax),
      commissionMin: commissionMin === '' ? null : Number(commissionMin),
      accelMin: accelMin === '' ? null : Number(accelMin),
      maxPages: Number(maxPages) || 3,
      ratingMin: ratingMin === '' ? null : Number(ratingMin),
      listedDaysMax: listedDaysMax === '' ? null : Number(listedDaysMax),
      accelBase28dMin: Number(accelBase28dMin) || 28,
      g2MinCardRatio: Number(g2MinCardRatio) || 0,
      g2MaxVideoRatio: Number(g2MaxVideoRatio) || 0,
      maxIngest: Number(maxIngest) || 50,
      concurrency: Number(concurrency) || 4,
      useAiAudit,
    }
  }

  async function handleDryRun() {
    setDryRunLoading(true)
    try {
      const res = await api.gateDryRun(buildCriteria())
      setDryRunResult(res)
    } catch (err) {
      onNotify(err?.message || '试拉预估失败', true)
    } finally {
      setDryRunLoading(false)
    }
  }

  async function handleConfirmCreate() {
    setCreating(true)
    try {
      const task = await api.createTask({
        criteria: { ...buildCriteria(), concurrency: Number(concurrency) || 4 },
        estimate: dryRunResult || undefined,
        awaitCompletion: true,
      })
      setDryRunResult(null)
      setActiveTask(task)
      setActiveGate('g3')
      await refreshTasks(task.id)
      onLibraryChanged?.()
      onNotify(`三闸任务 ${task.id} 已完成，入库 ${task.metrics?.ingestedCount ?? 0} 个商品`)
    } catch (err) {
      onNotify(err?.message || '创建三闸任务失败', true)
    } finally {
      setCreating(false)
    }
  }

  async function handleOpenTask(id) {
    try {
      const res = await api.getTask(id)
      setActiveTask(res.task)
      setActiveGate(res.task.gateItems?.g3?.length ? 'g3' : res.task.gateItems?.g2?.length ? 'g2' : 'g1')
    } catch (err) {
      onNotify(err?.message || '读取任务详情失败', true)
    }
  }

  async function handleTaskControl(taskId, action, extra = {}) {
    try {
      const res = await api.controlTask(taskId, { action, ...extra })
      if (res.task) setActiveTask(res.task)
      await refreshTasks(res.task?.id || taskId)
      onLibraryChanged?.()
      onNotify(`已执行操作：${action}`)
    } catch (err) {
      onNotify(err?.message || '操作失败', true)
    }
  }

  const gateRows = useMemo(() => {
    const raw = activeTask?.gateItems?.[activeGate] || []
    if (conclusionFilter === 'all') return raw
    return raw.filter((item) => item.conclusion === conclusionFilter)
  }, [activeTask, activeGate, conclusionFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="omnimux-ttsel-card">
        <div className="omnimux-ttsel-grid">
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">数据源</span>
            <DropdownSelect
              aria-label="三闸数据源"
              value={source}
              options={[
                { value: 'rank', label: '热销榜' },
                { value: 'search', label: '关键词搜索' },
                { value: 'snapshot', label: '导入快照' },
              ]}
              onChange={setSource}
            />
          </div>
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">站点</span>
            <DropdownSelect aria-label="三闸站点" value={region} options={regionOptions} onChange={setRegion} />
          </div>
          {source === 'search' && (
            <InputField label="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="商品关键词" />
          )}
          {source === 'snapshot' && (
            <div className="omnimux-ttsel-field">
              <span className="omnimux-ttsel-label">选择快照</span>
              <DropdownSelect aria-label="选择快照" value={snapshotId} options={snapshotOptions} onChange={setSnapshotId} />
            </div>
          )}
          <div className="omnimux-ttsel-field">
            <span className="omnimux-ttsel-label">类目</span>
            <DropdownSelect aria-label="三闸类目" value={category} options={categoryOptions} onChange={setCategory} />
          </div>
          <InputField label="总销量上限" value={totalSalesMax} onChange={(e) => setTotalSalesMax(e.target.value)} suffix="件" />
          <InputField label="近7天销量下限" value={sales7dMin} onChange={(e) => setSales7dMin(e.target.value)} suffix="件" />
          <InputField label="带货达人数上限" value={creatorsMax} onChange={(e) => setCreatorsMax(e.target.value)} suffix="人" />
          <InputField label="佣金率下限" value={commissionMin} onChange={(e) => setCommissionMin(e.target.value)} suffix="%" />
          <InputField label="加速倍数下限" value={accelMin} onChange={(e) => setAccelMin(e.target.value)} suffix="倍" />
          <InputField label="最多拉取页数" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} suffix="页" />
        </div>

        {showAdvanced && (
          <div className="omnimux-ttsel-grid">
            <InputField label="评分下限" value={ratingMin} onChange={(e) => setRatingMin(e.target.value)} />
            <InputField label="上架天数上限" value={listedDaysMax} onChange={(e) => setListedDaysMax(e.target.value)} suffix="天" />
            <InputField label="28天加速基数" value={accelBase28dMin} onChange={(e) => setAccelBase28dMin(e.target.value)} suffix="件" />
            <InputField label="G2 商品卡占比下限" value={g2MinCardRatio} onChange={(e) => setG2MinCardRatio(e.target.value)} suffix="%" />
            <InputField label="G2 视频占比上限" value={g2MaxVideoRatio} onChange={(e) => setG2MaxVideoRatio(e.target.value)} suffix="%" />
            <InputField label="入库上限" value={maxIngest} onChange={(e) => setMaxIngest(e.target.value)} suffix="个" />
            <label className="omnimux-ttsel-check-row" style={{ alignSelf: 'end', height: '32px' }}>
              <input type="checkbox" checked={useAiAudit} onChange={(e) => setUseAiAudit(e.target.checked)} />
              <span>启用 G3 AI 合规审查</span>
            </label>
          </div>
        )}

        <div className="omnimux-ttsel-row">
          <Button variant="primary" loading={dryRunLoading} onClick={handleDryRun}>
            {t('dryRunEstimate')}
          </Button>
          <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '收起高级闸口' : '更多条件 (6)'}
          </Button>
        </div>
      </div>

      {activeTask && (
        <div className="omnimux-ttsel-card">
          <div className="omnimux-ttsel-row">
            <strong>{activeTask.id}</strong>
            <Badge variant={STATUS_BADGE[activeTask.status]?.variant || 'neutral'}>
              {STATUS_BADGE[activeTask.status]?.label || activeTask.status}
            </Badge>
            <Badge>{activeTask.criteria?.region}</Badge>
            <Badge variant="info">已入库 {activeTask.metrics?.ingestedCount ?? 0}</Badge>
            <div className="omnimux-ttsel-row-end">
              <Button size="sm" variant="secondary" onClick={() => refreshTasks(activeTask.id)}>
                {t('refresh')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleTaskControl(activeTask.id, 'retry_incomplete')}>
                {t('retryIncomplete')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleTaskControl(activeTask.id, 'clone_run')}>
                {t('cloneAndRun')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setActiveTask(null)}>
                返回列表
              </Button>
            </div>
          </div>

          <div className="omnimux-ttsel-stepper" role="tablist" aria-label="三闸漏斗阶段">
            <div className="omnimux-ttsel-step">
              <strong>启动条件</strong>
              <div className="omnimux-ttsel-step-metrics">
                <span>{activeTask.criteria?.source}</span>
                <span>{activeTask.criteria?.region}</span>
                <span>{activeTask.metrics?.fetchedPages ?? 0} 页</span>
              </div>
            </div>
            {[
              { id: 'g1', title: 'G1 量化初筛', m: activeTask.metrics?.g1 },
              { id: 'g2', title: 'G2 渠道核验', m: activeTask.metrics?.g2 },
              { id: 'g3', title: 'G3 风控入库', m: activeTask.metrics?.g3 },
            ].map((stage) => (
              <button
                key={stage.id}
                type="button"
                className="omnimux-ttsel-step"
                data-active={activeGate === stage.id ? 'true' : 'false'}
                onClick={() => setActiveGate(stage.id)}
              >
                <strong>{stage.title}</strong>
                <div className="omnimux-ttsel-step-metrics">
                  <span>输入 {stage.m?.input ?? 0}</span>
                  <Badge variant="success">通过 {stage.m?.pass ?? 0}</Badge>
                  <Badge variant="danger">淘汰 {stage.m?.fail ?? 0}</Badge>
                  {(stage.m?.incomplete ?? 0) > 0 && <Badge variant="warning">未完成 {stage.m.incomplete}</Badge>}
                </div>
              </button>
            ))}
            <div className="omnimux-ttsel-step">
              <strong>选品库沉淀</strong>
              <div className="omnimux-ttsel-step-metrics">
                <Badge variant="info">入库 {activeTask.metrics?.ingestedCount ?? 0}</Badge>
              </div>
            </div>
          </div>

          <div className="omnimux-ttsel-row">
            <strong>执行日志</strong>
            <div className="omnimux-ttsel-row-end">
              <CopyButton text={(activeTask.logs || []).join('\n')} />
            </div>
          </div>
          <div className="omnimux-ttsel-log">{(activeTask.logs || []).join('\n') || '暂无日志'}</div>

          <div className="omnimux-ttsel-row">
            <strong>{activeGate.toUpperCase()} 判定明细</strong>
            <DropdownSelect
              aria-label="结论筛选"
              value={conclusionFilter}
              options={[
                { value: 'all', label: '全部结论' },
                { value: 'pass', label: '仅通过' },
                { value: 'fail', label: '仅淘汰' },
                { value: 'incomplete', label: '仅未完成' },
              ]}
              onChange={setConclusionFilter}
            />
          </div>

          <div className="omnimux-ttsel-table-wrap">
            <table className="omnimux-ttsel-table">
              <thead>
                <tr>
                  <th>结论</th>
                  <th>商品</th>
                  <th>原因码</th>
                  <th>原因摘要</th>
                  <th>关键指标</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {gateRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Badge variant={CONCLUSION_BADGE[row.conclusion]?.variant || 'neutral'}>
                        {CONCLUSION_BADGE[row.conclusion]?.label || row.conclusion}
                      </Badge>
                    </td>
                    <td>
                      <div className="omnimux-ttsel-prod-cell">
                        <div className="omnimux-ttsel-title-clamp">{row.title}</div>
                      </div>
                    </td>
                    <td className="omnimux-ttsel-num">{row.reasonCode}</td>
                    <td>{row.shortReason}</td>
                    <td className="omnimux-ttsel-num">
                      {activeGate === 'g1'
                        ? `7日 ${row.metrics?.sales7d ?? '—'} 加速 ${row.metrics?.accelRatio ?? '—'}x`
                        : activeGate === 'g2'
                          ? `商品卡 ${row.metrics?.productCardRatio ?? '—'}% 视频 ${row.metrics?.videoRatio ?? '—'}%`
                          : `风险 ${row.metrics?.riskLevel || '—'} 品牌 ${row.metrics?.brandRisk || '—'}`}
                    </td>
                    <td>
                      <div className="omnimux-ttsel-row">
                        <Button size="sm" variant="secondary" onClick={() => setEvidenceItem(row)}>
                          {t('viewEvidence')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            handleTaskControl(activeTask.id, 'override_row', {
                              itemId: row.id,
                              rowAction: row.conclusion === 'pass' ? 'ignore' : 'force_pass',
                            })
                          }
                        >
                          {row.conclusion === 'pass' ? '忽略' : '放行'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="omnimux-ttsel-card">
        <div className="omnimux-ttsel-row">
          <strong>选品任务列表 ({tasks.length})</strong>
          <div className="omnimux-ttsel-row-end">
            <Button size="sm" variant="secondary" onClick={() => refreshTasks(activeTask?.id)}>
              {t('refresh')}
            </Button>
          </div>
        </div>
        {tasks.length === 0 ? (
          <EmptyState title="暂无选品任务" />
        ) : (
          <div className="omnimux-ttsel-table-wrap">
            <table className="omnimux-ttsel-table">
              <thead>
                <tr>
                  <th>任务ID</th>
                  <th>状态</th>
                  <th>G1</th>
                  <th>G2</th>
                  <th>G3</th>
                  <th>入库数</th>
                  <th>数据源</th>
                  <th>站点</th>
                  <th>开始时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="omnimux-ttsel-num">
                      <Button size="sm" variant="ghost" onClick={() => handleOpenTask(task.id)}>
                        {task.id}
                      </Button>
                    </td>
                    <td>
                      <Badge variant={STATUS_BADGE[task.status]?.variant || 'neutral'}>
                        {STATUS_BADGE[task.status]?.label || task.status}
                      </Badge>
                    </td>
                    <td className="omnimux-ttsel-num">
                      {task.metrics?.g1?.pass ?? 0}/{task.metrics?.g1?.input ?? 0}
                    </td>
                    <td className="omnimux-ttsel-num">
                      {task.metrics?.g2?.pass ?? 0}/{task.metrics?.g2?.input ?? 0}
                    </td>
                    <td className="omnimux-ttsel-num">
                      {task.metrics?.g3?.pass ?? 0}/{task.metrics?.g3?.input ?? 0}
                    </td>
                    <td className="omnimux-ttsel-num">{task.metrics?.ingestedCount ?? 0}</td>
                    <td>{task.criteria?.source}</td>
                    <td>{task.criteria?.region}</td>
                    <td className="omnimux-ttsel-num">{new Date(task.startedAt).toLocaleString('zh-CN')}</td>
                    <td>
                      <div className="omnimux-ttsel-row">
                        <Button size="sm" variant="secondary" onClick={() => handleOpenTask(task.id)}>
                          查看
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleTaskControl(task.id, 'clone_run')}>
                          再跑
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModalDialog
        open={Boolean(dryRunResult)}
        onClose={() => setDryRunResult(null)}
        title="确认创建三闸选品任务"
        size="lg"
        footer={
          <div className="omnimux-ttsel-row">
            <Button variant="secondary" onClick={() => setDryRunResult(null)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={creating} onClick={handleConfirmCreate}>
              {t('confirmCreateTask')}
            </Button>
          </div>
        }
      >
        {dryRunResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="omnimux-ttsel-kv-grid">
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">匹配总数</span><span className="omnimux-ttsel-kv-v">{dryRunResult.matchedTotal}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">本次处理上限</span><span className="omnimux-ttsel-kv-v">{dryRunResult.maxProcessCount} 个</span></div>
            </div>
            <div className="omnimux-ttsel-table-wrap">
              <table className="omnimux-ttsel-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr><th>阶段</th><th>预计最大调用</th><th>说明</th></tr>
                </thead>
                <tbody>
                  {(dryRunResult.stages || []).map((st) => (
                    <tr key={st.stage}>
                      <td>{st.stage}</td>
                      <td className="omnimux-ttsel-num">{st.maxCalls}</td>
                      <td>{st.unitCostNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <InputField label="并发数 (1-8)" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
            <div className="omnimux-ttsel-label">{dryRunResult.summary}</div>
          </div>
        )}
      </ModalDialog>

      <Drawer
        open={Boolean(evidenceItem)}
        onClose={() => setEvidenceItem(null)}
        title={evidenceItem ? `${evidenceItem.gate.toUpperCase()} 证据 ${evidenceItem.productId}` : '判定证据'}
        width={560}
      >
        {evidenceItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="omnimux-ttsel-kv-grid">
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">结论</span><span className="omnimux-ttsel-kv-v">{CONCLUSION_BADGE[evidenceItem.conclusion]?.label}</span></div>
              <div className="omnimux-ttsel-kv"><span className="omnimux-ttsel-kv-k">原因码</span><span className="omnimux-ttsel-kv-v">{evidenceItem.reasonCode}</span></div>
            </div>
            <div className="omnimux-ttsel-card">{evidenceItem.detailReason}</div>
            <div className="omnimux-ttsel-evidence-pre">{JSON.stringify(evidenceItem.evidence || {}, null, 2)}</div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
