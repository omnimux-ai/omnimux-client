import { createAssetsPipeline } from './assets-pipeline.js'
import { createDataSourceAdapter } from './datasource.js'
import { createSelectionDispatcher } from './dispatcher.js'
import { registerSelectionRoutes } from './http-routes.js'
import { createSelectionScheduler } from './scheduler.js'
import { createSelectionStore } from './store.js'
import { createThreeGateEngine } from './three-gate.js'
import { registerSelectionSkills } from './selection-skills.js'

export const name = 'omnimux-tiktok-selection'
export const inject = ['tools', 'systemPrompt']

export const TIKTOK_SELECTION_TOOL_NAMES = Object.freeze([
  'tiktok_selection_query_rank',
  'tiktok_selection_search_products',
  'tiktok_selection_import_snapshot',
  'tiktok_selection_get_product_detail',
  'tiktok_selection_gate_dry_run',
  'tiktok_selection_create_task',
  'tiktok_selection_list_tasks',
  'tiktok_selection_get_task',
  'tiktok_selection_control_task',
  'tiktok_selection_list_library',
  'tiktok_selection_ingest_products',
  'tiktok_selection_update_status',
  'tiktok_selection_remove_products',
  'tiktok_selection_generate_assets',
  'tiktok_selection_manage_schedule',
  'tiktok_selection_list_runs',
  'tiktok_selection_manage_risk_words',
  'tiktok_selection_manage_settings',
])

const SELECTION_SYSTEM_PROMPT = `This workspace includes the OmniMux TikTok Winning-Product Selection workbench (omnimux-tiktok-selection).
Use tiktok_selection_* tools for TikTok Shop hot-ranking discovery, keyword product search, external CSV/JSON snapshot import, 3-gate batch screening (G1 quantitative acceleration filter, G2 channel product-card share check, G3 local risk words + Hub headlessSkill brand/TRO/excluded-category compliance audit), library management, creative script/image/video generation, syncing winners into omnimux-products, scheduled auto-selection, and risk-word governance.
Always run tiktok_selection_gate_dry_run before creating large 3-gate tasks when scale is uncertain. Destructive removals require confirm: true. Never fabricate missing channel or 28d metrics.`

function objectParams(fields) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields)) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx, config = {}) {
  const store = createSelectionStore({ home: config.home, rootDir: config.rootDir })
  const getService = (serviceName) => ctx.get?.(serviceName)
  const getTool = (toolName) => ctx.tools?.get?.(toolName)

  const dataSource = createDataSourceAdapter({ store, getService, logger: ctx.logger })
  const threeGate = createThreeGateEngine({ store, dataSource, getService, logger: ctx.logger })
  const assetsPipeline = createAssetsPipeline({ store, dataSource, getService, getTool, logger: ctx.logger })
  const scheduler = createSelectionScheduler({ store, dataSource, threeGate, assetsPipeline, logger: ctx.logger })
  const dispatcher = createSelectionDispatcher({ store, dataSource, threeGate, assetsPipeline, scheduler })

  if (config.enableScheduler !== false) {
    scheduler.start(config.schedulerIntervalMs || 60_000)
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        scheduler.dispose()
        threeGate.dispose()
      },
      'omnimux-tiktok-selection: lifecycle'
    )
  }

  const mountHttp = (httpCtx) => {
    const webServer = httpCtx.webServer ?? httpCtx.get?.('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    const mount = () => registerSelectionRoutes(webServer, dispatcher, ctx.logger, {
      getConnection: () => httpCtx.get?.('connection') ?? ctx.get?.('connection'),
    })
    if (typeof httpCtx.effect === 'function') httpCtx.effect(mount, 'omnimux-tiktok-selection: http routes')
    else mount()
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountHttp)
  else mountHttp(ctx)

  registerSelectionSkills(ctx)

  const promptService = ctx.systemPrompt ?? ctx.get?.('systemPrompt')
  if (promptService && typeof promptService.section === 'function') {
    const regPrompt = () =>
      promptService.section({
        name: 'tiktok-selection:ops',
        order: 72,
        text: SELECTION_SYSTEM_PROMPT,
      })
    if (typeof ctx.effect === 'function') ctx.effect(regPrompt, 'tiktok-selection.ops')
    else regPrompt()
  }

  // ---- 18 Dual-Surface Agent Tools (1:1 parity with Dispatcher/HTTP) ----
  ctx.tools.register({
    name: 'tiktok_selection_query_rank',
    description: 'Query TikTok Shop hot-selling product rankings by region, granularity, period, category, sortField, or imported snapshotId.',
    parameters: objectParams({
      region: { type: 'string', description: '2-letter region code (e.g. US, GB, SG, MY)' },
      granularity: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Ranking granularity' },
      period: { type: 'string', description: 'Ranking date or period string (e.g. 2026-11-20)' },
      category: { type: 'string', description: 'English TikTok Shop category filter' },
      sortField: { type: 'string', description: 'periodSales | periodGmv | sales7d | totalSales | commissionRate | accelRatio' },
      sortDir: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
      page: { type: 'number', description: 'Page number (1-based)' },
      pageSize: { type: 'number', description: 'Items per page (default 10)' },
      snapshotId: { type: 'string', description: 'Optional imported CSV/JSON snapshot ID' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.queryRank(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_search_products',
    description: 'Search TikTok Shop products by keyword, category, sales/commission/creator thresholds, product tags, and shop type.',
    parameters: objectParams({
      keyword: { type: 'string', description: 'Product title keyword' },
      region: { type: 'string', description: '2-letter region code (default US)' },
      category: { type: 'string', description: 'English category filter' },
      sortField: { type: 'string', description: 'Sort field (default sales7d)' },
      salesMin: { type: 'number', description: 'Minimum 7d/period sales' },
      salesMax: { type: 'number', description: 'Maximum 7d/period sales' },
      commissionMin: { type: 'number', description: 'Minimum commission rate (%)' },
      commissionMax: { type: 'number', description: 'Maximum commission rate (%)' },
      creatorsMin: { type: 'number', description: 'Minimum affiliate creators count' },
      creatorsMax: { type: 'number', description: 'Maximum affiliate creators count' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Product tags filter' },
      shopType: { type: 'string', enum: ['all', 'cross_border', 'local'], description: 'Shop type filter' },
      page: { type: 'number', description: 'Page number (1-based)' },
      snapshotId: { type: 'string', description: 'Optional imported snapshot ID' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.searchProducts(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_import_snapshot',
    description: 'Import an external CSV or JSON TikTok product snapshot (including sales7d, sales28d, commissionRate, creatorsCount, productCardRatio) into local snapshots.',
    parameters: objectParams({
      content: { type: 'string', required: true, description: 'CSV text or JSON string of product rows' },
      format: { type: 'string', enum: ['csv', 'json'], description: 'Optional format hint' },
      name: { type: 'string', description: 'Human-readable snapshot name' },
      region: { type: 'string', description: 'Default region code (e.g. US)' },
      sourceLabel: { type: 'string', description: 'Optional source label' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.importSnapshot(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_get_product_detail',
    description: 'Fetch detailed TikTok product metrics, acceleration info, optional Top-10 reference affiliate videos, and optional VOC reviews.',
    parameters: objectParams({
      productId: { type: 'string', required: true, description: 'TikTok Shop product ID or library ID' },
      region: { type: 'string', description: 'Region code (default US)' },
      loadVideos: { type: 'boolean', description: 'Load Top-10 reference TikTok commerce videos' },
      loadReviews: { type: 'boolean', description: 'Load TikTok Shop customer reviews' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.getProductDetail(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_gate_dry_run',
    description: 'Run a 1-page dry-run estimate for 3-Gate batch selection (G1→G2→G3), returning matched counts, cap warnings, and per-stage call estimates.',
    parameters: objectParams({
      source: { type: 'string', enum: ['rank', 'search', 'snapshot'], description: 'Candidate data source' },
      region: { type: 'string', description: 'Region code (default US)' },
      category: { type: 'string', description: 'Optional English category' },
      keyword: { type: 'string', description: 'Optional keyword when source=search' },
      snapshotId: { type: 'string', description: 'Optional snapshot ID when source=snapshot' },
      totalSalesMax: { type: 'number', description: 'G1 max total sales ceiling (default 50000)' },
      sales7dMin: { type: 'number', description: 'G1 min 7-day sales floor (default 50)' },
      creatorsMax: { type: 'number', description: 'G1 max creators ceiling (default 1000)' },
      commissionMin: { type: 'number', description: 'G1 min commission % (default 10)' },
      accelMin: { type: 'number', description: 'G1 min 7d/28d acceleration multiplier (default 1.1)' },
      ratingMin: { type: 'number', description: 'G1 min rating (default 4.0)' },
      listedDaysMax: { type: 'number', description: 'G1 max listed days window (default 180)' },
      g2MinCardRatio: { type: 'number', description: 'G2 min product-card GMV share % (default 20)' },
      g2MaxVideoRatio: { type: 'number', description: 'G2 max video GMV share % (0 = unlimited)' },
      maxPages: { type: 'number', description: 'Max pages to fetch (default 3)' },
      maxIngest: { type: 'number', description: 'Max products to ingest into library (default 50)' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.gateDryRun(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_create_task',
    description: 'Create and execute a 3-Gate batch product selection task (G1 quantitative → G2 channel share → G3 risk words + AI compliance audit → auto-ingest).',
    parameters: objectParams({
      source: { type: 'string', enum: ['rank', 'search', 'snapshot'], description: 'Candidate data source' },
      region: { type: 'string', description: 'Region code' },
      category: { type: 'string', description: 'Category filter' },
      keyword: { type: 'string', description: 'Keyword when source=search' },
      snapshotId: { type: 'string', description: 'Snapshot ID when source=snapshot' },
      totalSalesMax: { type: 'number', description: 'G1 total sales max' },
      sales7dMin: { type: 'number', description: 'G1 7-day sales min' },
      creatorsMax: { type: 'number', description: 'G1 creators max' },
      commissionMin: { type: 'number', description: 'G1 commission % min' },
      accelMin: { type: 'number', description: 'G1 acceleration ratio min' },
      accelBase28dMin: { type: 'number', description: 'G1 28-day sales base min' },
      ratingMin: { type: 'number', description: 'G1 rating min' },
      listedDaysMax: { type: 'number', description: 'G1 listed days max' },
      g2MinCardRatio: { type: 'number', description: 'G2 min product card share %' },
      g2MaxVideoRatio: { type: 'number', description: 'G2 max video share %' },
      maxPages: { type: 'number', description: 'Max pages' },
      maxIngest: { type: 'number', description: 'Max ingested products' },
      concurrency: { type: 'number', description: 'Worker concurrency 1-8' },
      missingMetricPolicy: { type: 'string', enum: ['skip_missing_metric', 'fail_on_missing'], description: 'How to handle metrics absent from source' },
      useAiAudit: { type: 'boolean', description: 'Enable Hub headlessSkill G3 AI compliance audit (default true)' },
      awaitCompletion: { type: 'boolean', description: 'Wait for task completion before returning (default true)' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.createTask(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_list_tasks',
    description: 'List 3-Gate selection tasks with optional status, source, region, or taskId filters.',
    parameters: objectParams({
      taskId: { type: 'string', description: 'Filter by task ID substring' },
      status: { type: 'string', description: 'Filter by task status' },
      source: { type: 'string', description: 'Filter by data source' },
      region: { type: 'string', description: 'Filter by region' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.listTasks(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_get_task',
    description: 'Get full 3-Gate task details including G1/G2/G3 funnel counters, execution logs, and per-item evaluation evidence.',
    parameters: objectParams({
      taskId: { type: 'string', required: true, description: 'Task ID (e.g. OMSEL-20261123-001)' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.getTask(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_control_task',
    description: 'Control an existing 3-Gate task: stop, retry_incomplete, clone_run, or override_row (ignore/force_pass/delete; delete requires confirm: true).',
    parameters: objectParams({
      taskId: { type: 'string', required: true, description: 'Target task ID' },
      action: { type: 'string', required: true, enum: ['stop', 'retry_incomplete', 'clone_run', 'override_row'], description: 'Control operation' },
      itemId: { type: 'string', description: 'Gate item ID when action=override_row' },
      rowAction: { type: 'string', enum: ['ignore', 'force_pass', 'delete'], description: 'Row decision override' },
      confirm: { type: 'boolean', description: 'Required confirm=true when rowAction=delete' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.controlTask(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_list_library',
    description: 'List products in the TikTok selection library (or asset center with assetsOnly=true) with multi-dimensional filtering.',
    parameters: objectParams({
      query: { type: 'string', description: 'Title, productId, or shopName substring' },
      region: { type: 'string', description: 'Region filter' },
      category: { type: 'string', description: 'Category substring filter' },
      selectionStatus: { type: 'string', enum: ['all', 'pending_review', 'approved', 'recheck', 'rejected'], description: 'Review status filter' },
      assetStatus: { type: 'string', enum: ['all', 'none', 'script_ready', 'generating', 'partial', 'ready', 'failed'], description: 'Asset status filter' },
      assetsOnly: { type: 'boolean', description: 'Only return products with generated scripts/images/videos' },
      commissionMin: { type: 'number', description: 'Minimum commission %' },
      sales7dMin: { type: 'number', description: 'Minimum 7d sales' },
      sourceTaskId: { type: 'string', description: 'Filter by originating 3-gate task ID' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.listLibrary(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_ingest_products',
    description: 'Ingest candidate TikTok products into the local selection library with automatic deduplication and active risk-word filtering.',
    parameters: objectParams({
      products: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'Array of product objects to ingest' },
      region: { type: 'string', description: 'Default region code' },
      source: { type: 'string', description: 'Source label (rank | search | snapshot | manual)' },
      sourceDetail: { type: 'string', description: 'Human-readable provenance note' },
      checkRiskWords: { type: 'boolean', description: 'Apply enabled brand/sensitive risk words before ingestion (default true)' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.ingestProducts(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_update_status',
    description: 'Batch update product selection review status & notes, or enrich 30-day channel ratios (action=enrich_channel).',
    parameters: objectParams({
      action: { type: 'string', enum: ['status', 'enrich_channel'], description: 'Operation mode (default status)' },
      ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Library record IDs or product IDs' },
      selectionStatus: { type: 'string', enum: ['pending_review', 'approved', 'recheck', 'rejected'], description: 'Target status when action=status' },
      reviewNotes: { type: 'string', description: 'Optional evaluation note' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.updateStatus(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_remove_products',
    description: 'Destructively remove selected products from the local TikTok selection library. Requires confirm: true.',
    parameters: objectParams({
      ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Library IDs or product IDs to remove' },
      confirm: { type: 'boolean', required: true, description: 'Must be true to execute deletion' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.removeProducts(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_generate_assets',
    description: 'Generate viral video scripts (via Hub headlessSkill), 3:4 e-commerce images, 9:16 short videos, or sync winning products into omnimux-products.',
    parameters: objectParams({
      kind: { type: 'string', required: true, enum: ['script', 'image', 'video', 'sync_omnimux_products'], description: 'Generation or handoff action' },
      productIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Target library IDs or product IDs' },
      countPerProduct: { type: 'number', description: 'Count per product (images max 10, videos max 5)' },
      skipExisting: { type: 'boolean', description: 'Skip products that already have ready assets of this kind' },
      useExistingScript: { type: 'boolean', description: 'Prefer generated videoScript prompt when generating videos' },
      extraSellingPoints: { type: 'string', description: 'Optional selling point highlights for script rewriting' },
      prompt: { type: 'string', description: 'Optional custom prompt override' },
      model: { type: 'string', description: 'Optional Hub catalog model ID override' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.generateAssets(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_manage_schedule',
    description: 'List, create, update, run_now, or delete auto-selection scheduled tasks. Deleting requires confirm: true.',
    parameters: objectParams({
      action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'run_now', 'delete'], description: 'Schedule action' },
      id: { type: 'string', description: 'Schedule ID for update/run_now/delete' },
      name: { type: 'string', description: 'Schedule name' },
      enabled: { type: 'boolean', description: 'Enable/disable schedule' },
      frequency: { type: 'string', enum: ['daily', 'weekly', 'hourly'], description: 'Run cadence' },
      timeOfDay: { type: 'string', description: 'HH:MM execution time' },
      timezone: { type: 'string', description: 'IANA timezone' },
      source: { type: 'string', enum: ['rank', 'search', 'snapshot'], description: 'Data source' },
      region: { type: 'string', description: 'Region code' },
      category: { type: 'string', description: 'Category filter' },
      keyword: { type: 'string', description: 'Keyword filter' },
      snapshotId: { type: 'string', description: 'Snapshot ID when source=snapshot' },
      maxPages: { type: 'number', description: 'Pages to fetch (1-10)' },
      maxIngest: { type: 'number', description: 'Max ingest cap (1-200)' },
      autoGenerateAssets: { type: 'boolean', description: 'Auto-generate images after ingest' },
      useThreeGate: { type: 'boolean', description: 'Run full 3-Gate funnel per schedule execution' },
      confirm: { type: 'boolean', description: 'Required confirm=true when action=delete' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.manageSchedule(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_list_runs',
    description: 'List auto-selection schedule execution audit records (pulled, added, duplicated, blocked counts and status).',
    parameters: objectParams({
      scheduleId: { type: 'string', description: 'Filter by schedule ID' },
      scheduleName: { type: 'string', description: 'Filter by schedule name substring' },
      status: { type: 'string', enum: ['all', 'completed', 'failed'], description: 'Filter by run status' },
      trigger: { type: 'string', enum: ['all', 'scheduled', 'manual'], description: 'Filter by trigger source' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.listRuns(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_manage_risk_words',
    description: 'Manage brand/IP risk words and prohibited/sensitive words used to filter products before library ingestion. Deleting requires confirm: true.',
    parameters: objectParams({
      action: { type: 'string', required: true, enum: ['list', 'add', 'batch_add', 'update', 'delete'], description: 'Risk word operation' },
      type: { type: 'string', enum: ['brand', 'sensitive'], description: 'Risk word table (brand | sensitive)' },
      id: { type: 'string', description: 'Word ID for update/delete' },
      term: { type: 'string', description: 'Keyword or brand term' },
      terms: { type: 'array', items: { type: 'string' }, description: 'Batch terms list for action=batch_add' },
      zhName: { type: 'string', description: 'Optional Chinese display name' },
      enabled: { type: 'boolean', description: 'Whether active during filtering' },
      source: { type: 'string', description: 'Origin label' },
      confirm: { type: 'boolean', description: 'Required confirm=true when action=delete' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.manageRiskWords(args),
  })

  ctx.tools.register({
    name: 'tiktok_selection_manage_settings',
    description: 'Get, update, or reset TikTok selection runtime settings (concurrency 1-8, dailyAssetCap, excludedCategories, missingMetricPolicy, default prompts).',
    parameters: objectParams({
      action: { type: 'string', enum: ['get', 'update', 'reset'], description: 'Settings operation (default get)' },
      concurrency: { type: 'number', description: 'Worker concurrency 1-8' },
      dailyAssetCap: { type: 'number', description: 'Daily asset generation safety cap' },
      excludedCategories: { type: 'array', items: { type: 'string' }, description: 'G3 hard-blocked category terms' },
      defaultMissingMetricPolicy: { type: 'string', enum: ['skip_missing_metric', 'fail_on_missing'], description: 'Default policy when source omits metrics' },
      defaultImagePrompt: { type: 'string', description: 'Default image generation prompt' },
      defaultVideoPrompt: { type: 'string', description: 'Default fallback video prompt' },
    }),
    output: jsonOut,
    execute: (args) => dispatcher.manageSettings(args),
  })

  return { store, dispatcher, threeGate, assetsPipeline, scheduler }
}
