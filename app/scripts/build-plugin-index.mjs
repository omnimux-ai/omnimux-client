#!/usr/bin/env node
/**
 * Generate the OmniMux plugin market index.
 *
 * The official DSH market index is a community-maintained JSON file served over
 * jsDelivr. This script builds our own, so plugin discovery does not depend on a
 * third-party repository staying online or accepting our entries.
 *
 * Output shape mirrors the official `format: 1` schema so the same client code
 * reads both.
 *
 * Usage:
 *   node scripts/build-plugin-index.mjs                 # write dist/dsh-index.json
 *   node scripts/build-plugin-index.mjs --check         # verify only, exit 1 on drift
 *   node scripts/build-plugin-index.mjs --out <path>    # custom output path
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marketablePlugins, withheldPlugins } from './plugin-tiers.mjs'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Publication timestamp recorded on every version entry.
 *
 * Format 1 requires an integer Unix-seconds value. It is derived from the plugin
 * manifest's mtime rather than "now" so that regenerating an unchanged index is a
 * no-op and `--check` stays meaningful.
 */
function publishTimestamp(pluginsRoot, dir) {
  try {
    return Math.floor(statSync(join(pluginsRoot, dir, 'package.json')).mtimeMs / 1000)
  } catch {
    return Math.floor(Date.now() / 1000)
  }
}

/**
 * Normalize a manifest repository URL to the plain http(s) form format 1 accepts.
 *
 * npm manifests commonly carry a `git+https://…` prefix and a trailing `.git`;
 * the index validator rejects both.
 */
function repositoryHref(value) {
  const raw = typeof value === "string" ? value : value?.url
  if (typeof raw !== "string" || raw.length === 0) return undefined
  const href = raw.replace(/^git\+/u, "").replace(/\.git$/u, "")
  return /^https?:\/\//u.test(href) ? href : undefined
}

/**
 * Plugins we know how to describe. Whether one actually ships is decided by
 * `config/plugin-tiers.json`: only the `preview` tier is published. Keeping the
 * copy here (titles, categories) separate from the shipping decision is what
 * lets a plugin move to `beta` without deleting its metadata.
 */
export const DESCRIBED_PLUGINS = [
  {
    dir: 'omnimux',
    category: 'core',
    title: { en: 'OmniMux Core', zh: 'OmniMux 核心' },
    description: {
      en: 'Provide sign-in, model routing, media generation, and web reading.',
      zh: '提供登录认证、模型路由、媒体生成和网页读取等基础能力。',
    },
  },
  {
    dir: 'omnimux-market',
    category: 'market',
    title: { en: 'Marketplace', zh: '扩展市场' },
    description: {
      en: 'Browse and install skills, expert presets, plugins, and connectors.',
      zh: '浏览和安装技能、专家预设、插件与外部连接器。',
    },
  },
  {
    dir: 'omnimux-accounts',
    category: 'core',
    title: { en: 'Social Accounts', zh: '社交账号' },
    description: {
      en: 'Connect and manage social accounts across platforms and groups.',
      zh: '连接和管理多平台社交账号，查看授权状态与分组。',
    },
  },
  {
    dir: 'omnimux-analytics',
    category: 'feature',
    title: { en: 'Analytics', zh: '数据分析' },
    description: {
      en: 'Track usage metrics and view social publishing performance dashboards.',
      zh: '统计使用数据，提供社媒发布效果与互动趋势看板。',
    },
  },
  {
    dir: 'omnimux-assets',
    category: 'feature',
    title: { en: 'Asset Library', zh: '素材资产库' },
    description: {
      en: 'Manage reusable characters, scenes, styles, and generated media.',
      zh: '管理角色、场景、风格等可复用素材与生成结果。',
    },
  },
  {
    dir: 'omnimux-clip',
    category: 'feature',
    title: { en: 'Video Editor', zh: '视频剪辑' },
    description: {
      en: 'Edit multi-track timelines, subtitles, and export videos.',
      zh: '提供多轨道时间轴剪辑、字幕编辑与视频导出。',
    },
  },
  {
    dir: 'omnimux-forms',
    category: 'feature',
    title: { en: 'Task Forms', zh: '任务表单' },
    description: {
      en: 'Use structured forms to organize reference video breakdown and remake tasks.',
      zh: '提供结构化表单模板，整理参考视频拆解与复刻需求。',
    },
  },
  {
    dir: 'omnimux-inspiration',
    category: 'feature',
    title: { en: 'Inspiration Library', zh: '灵感库' },
    description: {
      en: 'Collect, organize, and analyze trending references for content ideas.',
      zh: '收集、整理并分析热门内容与参考素材，辅助选题创作。',
    },
  },
  {
    dir: 'omnimux-products',
    category: 'feature',
    title: { en: 'Product Library', zh: '商品库' },
    description: {
      en: 'Manage physical and digital product specs, selling points, and media.',
      zh: '管理实物与数字商品的规格、卖点和素材，供创作调用。',
    },
  },
  {
    dir: 'omnimux-publish',
    category: 'feature',
    title: { en: 'Publishing', zh: '内容发布' },
    description: {
      en: 'Manage drafts, publish to multiple social accounts, and track status.',
      zh: '管理发布草稿，向多个社交账号分发内容并追踪状态。',
    },
  },
  {
    dir: 'omnimux-video',
    category: 'feature',
    title: { en: 'Local Video Processing', zh: '本地视频处理' },
    description: {
      en: 'Process videos, extract depth maps, and analyze content locally with FFmpeg.',
      zh: '使用本机 FFmpeg 处理视频、提取深度图并理解视频内容。',
    },
  },
  {
    dir: 'omnimux-workflow',
    category: 'feature',
    title: { en: 'Creative Canvas', zh: '创作画布' },
    description: {
      en: 'Build and run multi-step creative workflows on a canvas.',
      zh: '在画布上编排和运行多步骤创作流程，管理本地项目。',
    },
  },
]

function readManifest(pluginsRoot, dir) {
  const path = join(pluginsRoot, dir, 'package.json')
  if (!existsSync(path)) throw new Error(`missing plugin manifest: ${path}`)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${path} must declare string name and version`)
  }
  if (manifest.private === true) throw new Error(`${path} is private and cannot be published`)
  return manifest
}

/**
 * Confirm the exact version an entry names is actually installable.
 *
 * The index is only useful if `name@version` resolves: the market client builds that
 * spec verbatim, so publishing an entry for an unpublished version sends every user
 * who clicks install into a 404.
 */
async function assertPublished(name, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/u, '@')}`
  let payload
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (response.status === 404) throw new Error(`${name} is not published on npm`)
    if (!response.ok) throw new Error(`npm registry answered ${String(response.status)} for ${name}`)
    payload = await response.json()
  } catch (error) {
    throw new Error(`cannot verify ${name}@${version}: ${error.message}`)
  }
  const versions = Object.keys(payload?.versions ?? {})
  if (!versions.includes(version)) {
    throw new Error(`${name}@${version} is not published on npm (available: ${versions.join(', ') || 'none'})`)
  }
}

function readLocaleMeta(pluginsRoot, dir) {
  const title = {}
  const description = {}
  for (const lang of ['en', 'zh']) {
    const file = join(pluginsRoot, dir, 'locale', `${lang}.json`)
    if (!existsSync(file)) continue
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed?.meta?.title === 'string' && parsed.meta.title.trim() !== '') {
      title[lang] = parsed.meta.title
    }
    if (typeof parsed?.meta?.description === 'string' && parsed.meta.description.trim() !== '') {
      description[lang] = parsed.meta.description
    }
  }
  return { title, description }
}

function entryFor(pluginsRoot, spec) {
  const manifest = readManifest(pluginsRoot, spec.dir)
  const localeMeta = readLocaleMeta(pluginsRoot, spec.dir)
  const repositoryUrl = repositoryHref(manifest.repository)
  const entry = {
    name: manifest.name,
    title: { ...spec.title, ...localeMeta.title },
    description: { ...spec.description, ...localeMeta.description },
    author: 'OmniMux',
    metadata: {
      category: spec.category,
      keywords: ['dsh', 'deepseek-harness', 'bundle', 'cordis', 'omnimux'],
    },
    versions: [
      {
        version: manifest.version,
        // Format 1 requires a publication timestamp; a git source additionally needs
        // a 40-hex commit, which we do not track here, so npm is the only honest shape.
        publishTimestamp: publishTimestamp(pluginsRoot, spec.dir),
        source: { type: 'npm' },
      },
    ],
  }
  if (typeof manifest.homepage === 'string') entry.homepage = manifest.homepage
  if (repositoryUrl) entry.repository = { url: repositoryUrl }
  return entry
}

/**
 * The entries this index publishes: described plugins whose tier is `preview`.
 *
 * A preview plugin with no description is NOT an error: `dsh-better-sidebar` is a
 * third-party community plugin we preinstall but do not market, and the market
 * only lists what we author. A preview plugin that is also withheld IS an error,
 * because the tier file would then contradict itself.
 */
function publishedSpecs() {
  const preview = new Set(marketablePlugins())
  const withheld = new Set(withheldPlugins())
  const contradictory = [...preview].filter(name => withheld.has(name))
  if (contradictory.length > 0) {
    throw new Error(`plugin-tiers.json puts these plugins in preview and a withheld tier: ${contradictory.join(', ')}`)
  }
  return DESCRIBED_PLUGINS.filter(spec => preview.has(spec.dir))
}

function buildIndex(pluginsRoot) {
  return {
    format: 1,
    title: { en: 'OmniMux Plugin Market', zh: 'OmniMux 插件市场' },
    description: {
      en: 'Plugins reviewed and published by the OmniMux team.',
      zh: '由 OmniMux 团队审核并发布的插件。',
    },
    // Every category a plugin names must be declared here first: the format-1
    // validator rejects a `metadata.category` that references an unknown id.
    metadata: {
      categories: {
        core: { title: { en: 'Core', zh: '核心' } },
        market: { title: { en: 'Market', zh: '市场' } },
        feature: { title: { en: 'Features', zh: '功能' } },
      },
    },
    plugins: publishedSpecs().map(spec => entryFor(pluginsRoot, spec)),
  }
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const outIndex = args.indexOf('--out')
  const outPath = outIndex === -1 ? join(ROOT_DIR, 'dist', 'dsh-index.json') : resolve(args[outIndex + 1])

  // Plugin sources live in this repository's `plugins/` workspace. The staged
  // preset (`dsh-plugin-desktop/preset/plugins`) is the next preference, and the
  // installed dependency copy (`dsh-desktop-next/node_modules`) is only the last
  // resort: it can lag behind the source workspace. The repository workspace is
  // always preferred so a machine that still has the retired sibling tree cannot
  // silently publish plugins from it.
  const candidates = [
    process.env.OMNIMUX_PLUGINS_DIR,
    join(ROOT_DIR, '..', 'plugins', 'plugins'),
    join(ROOT_DIR, 'dsh-plugin-desktop', 'preset', 'plugins'),
    join(ROOT_DIR, 'dsh-desktop-next', 'node_modules'),
  ].filter(Boolean)
  const pluginsRoot = candidates.find(dir => existsSync(dir) && marketablePlugins().every(name => existsSync(join(dir, name, 'package.json'))))
    ?? candidates.find(dir => existsSync(dir))
  if (!pluginsRoot) throw new Error(`cannot locate the plugin sources (expected <repo>/plugins/plugins first); tried:\n  ${candidates.join('\n  ')}`)

  const index = buildIndex(pluginsRoot)
  // An entry naming an unpublished version sends every user who clicks install into a
  // 404, so confirm each one resolves before it ships. `--offline` skips the check for
  // air-gapped runs; it must never be used for a real publish.
  if (!args.includes('--offline')) {
    for (const plugin of index.plugins) {
      await assertPublished(plugin.name, plugin.versions[0].version)
    }
  } else {
    console.warn('skipping the npm publish check (--offline)')
  }
  // Validate with the reader's own parser before anything is written. A generator
  // that only round-trips its own output cannot notice a format violation, and the
  // market client would be the first to find out.
  const { parseMarketIndex } = await import(
    join(ROOT_DIR, 'dsh-desktop-next', 'node_modules', '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js')
  )
  try {
    parseMarketIndex(index, 'https://dl.omnimux.ai/plugins/dsh-index.json')
  } catch (error) {
    throw new Error(`generated index violates format 1: ${error.message}${error.path ? ` (at ${error.path})` : ''}`)
  }
  const serialized = `${JSON.stringify(index, null, 2)}\n`

  if (check) {
    if (!existsSync(outPath)) throw new Error(`index not found at ${outPath}; run without --check first`)
    const current = readFileSync(outPath, 'utf8')
    if (current !== serialized) throw new Error(`${outPath} is stale; regenerate it`)
    console.log(`plugin index is current: ${String(index.plugins.length)} plugins`)
    return
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, serialized)
  console.log(`wrote ${outPath} (${String(index.plugins.length)} plugins from ${pluginsRoot})`)
  for (const plugin of index.plugins) console.log(`  - ${plugin.name}@${plugin.versions[0].version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
