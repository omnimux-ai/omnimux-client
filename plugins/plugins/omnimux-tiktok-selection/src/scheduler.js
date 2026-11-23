import { SelectionError } from './errors.js'

/**
 * Create the auto-selection scheduler & execution runner.
 */
export function createSelectionScheduler({ store, dataSource, threeGate, assetsPipeline, logger }) {
  let timer = null

  async function runScheduleNow(scheduleId, trigger = 'manual') {
    const schedule = store.getSchedule(scheduleId)
    if (!schedule) throw new SelectionError('not-found', `Schedule ${scheduleId} not found`)
    const startedAt = new Date().toISOString()
    const sourceSummary = `${schedule.region} ${schedule.source === 'rank' ? schedule.granularity : schedule.source} ${schedule.category || schedule.keyword || '全部类目'}`

    try {
      let pulledCount = 0
      let addedCount = 0
      let duplicatedCount = 0
      let blockedCount = 0
      let taskId = ''
      let newlyAddedIds = []

      if (schedule.useThreeGate) {
        const task = await threeGate.createAndRunTask(
          {
            source: schedule.source,
            region: schedule.region,
            category: schedule.category,
            keyword: schedule.keyword,
            snapshotId: schedule.snapshotId,
            sortField: schedule.sortField,
            maxPages: schedule.maxPages,
            maxIngest: schedule.maxIngest,
            trigger,
          },
          { awaitCompletion: true }
        )
        taskId = task.id
        pulledCount = task.metrics?.g1?.input || 0
        addedCount = task.metrics?.ingestedCount || 0
        blockedCount = (task.metrics?.g1?.fail || 0) + (task.metrics?.g2?.fail || 0) + (task.metrics?.g3?.fail || 0)
        const lib = store.listLibrary({ sourceTaskId: taskId })
        newlyAddedIds = lib.map((x) => x.id)
      } else {
        const res =
          schedule.source === 'search'
            ? await dataSource.searchProducts({
                region: schedule.region,
                keyword: schedule.keyword,
                category: schedule.category,
                sortField: schedule.sortField,
                snapshotId: schedule.snapshotId,
                page: 1,
                pageSize: schedule.maxPages * 10,
              })
            : await dataSource.queryRank({
                region: schedule.region,
                granularity: schedule.granularity,
                category: schedule.category,
                sortField: schedule.sortField,
                snapshotId: schedule.snapshotId,
                page: 1,
                pageSize: schedule.maxPages * 10,
              })
        const items = (res.items || []).slice(0, schedule.maxIngest)
        pulledCount = items.length
        if (items.length > 0) {
          const ingest = store.ingestProducts(items, {
            region: schedule.region,
            source: 'schedule',
            sourceDetail: schedule.name,
            checkRiskWords: true,
          })
          addedCount = ingest.addedCount
          duplicatedCount = ingest.duplicatedCount
          blockedCount = ingest.blockedCount
          newlyAddedIds = ingest.added.map((x) => x.id)
        }
      }

      if (schedule.autoGenerateAssets && newlyAddedIds.length > 0 && assetsPipeline) {
        try {
          await assetsPipeline.generateImages({ productIds: newlyAddedIds, countPerProduct: 2, skipExisting: true })
        } catch (err) {
          logger?.warn?.('omnimux-tiktok-selection: schedule auto-generate assets skipped', {
            scheduleId,
            error: err?.message,
          })
        }
      }

      const finishedAt = new Date().toISOString()
      const run = store.recordRun({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        status: 'completed',
        trigger,
        sourceSummary,
        pulledCount,
        addedCount,
        duplicatedCount,
        blockedCount,
        snapshotSaved: schedule.source === 'rank',
        taskId,
        startedAt,
        finishedAt,
      })

      store.updateSchedule(schedule.id, {
        lastRunAt: finishedAt,
        lastRunStatus: 'completed',
        totalRuns: (schedule.totalRuns || 0) + 1,
        totalIngested: (schedule.totalIngested || 0) + addedCount,
      })
      return run
    } catch (err) {
      const finishedAt = new Date().toISOString()
      const run = store.recordRun({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        status: 'failed',
        trigger,
        sourceSummary,
        error: err?.message || '定时任务执行失败',
        startedAt,
        finishedAt,
      })
      store.updateSchedule(schedule.id, {
        lastRunAt: finishedAt,
        lastRunStatus: 'failed',
        totalRuns: (schedule.totalRuns || 0) + 1,
      })
      logger?.warn?.('omnimux-tiktok-selection: schedule run failed', { scheduleId, error: err?.message })
      return run
    }
  }

  function isScheduleDue(schedule, now = new Date()) {
    if (!schedule.enabled) return false
    const lastTs = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0
    if (schedule.frequency === 'hourly') {
      return now.getTime() - lastTs >= 55 * 60 * 1000
    }
    const [hh, mm] = String(schedule.timeOfDay || '09:00').split(':').map((v) => Number.parseInt(v, 10) || 0)
    const nowHour = now.getHours()
    const nowMin = now.getMinutes()
    if (nowHour !== hh || nowMin < mm) return false
    if (schedule.frequency === 'weekly' && now.getDay() !== schedule.weekday) return false
    // Ensure not already run today
    if (lastTs > 0 && new Date(lastTs).toDateString() === now.toDateString()) return false
    return true
  }

  async function tick(now = new Date()) {
    const due = store.listSchedules().filter((s) => isScheduleDue(s, now))
    const runs = []
    for (const s of due) {
      const run = await runScheduleNow(s.id, 'scheduled')
      runs.push(run)
    }
    return runs
  }

  function start(intervalMs = 60_000) {
    if (timer) return
    timer = setInterval(() => {
      tick().catch((err) => {
        logger?.warn?.('omnimux-tiktok-selection: scheduler tick error', { error: err?.message })
      })
    }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function dispose() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    runScheduleNow,
    isScheduleDue,
    tick,
    start,
    dispose,
  }
}
