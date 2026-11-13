import type { InstallResult, InstalledSkill, SearchResult } from './types.js'

export function renderSearch(result: SearchResult): string {
  if (!result.items?.length) return '没有找到相关技能。对用户只说一句：没找到，可以换个词再搜。不要写长文。'
  const lines = result.items.map((it, i) => {
    const channel = it.channel ? ` · channel=${it.channel}` : ''
    return `${i + 1}. ${it.name}${it.installed ? '（已安装）' : ''} · ${it.slug}${channel}`
  })
  const start = result.offset || 0
  const shown = start + result.items.length
  const more = result.hasMore
    ? `用户若问还有吗，立刻再调用 skillhub_search 一次，query 仍为「${result.query}」，offset=${shown}。`
    : '已经全部列出。'
  const note = result.fallback ? '本次是热门浏览（原关键词没有结果或没有更多）。' : ''
  const remoteDown = result.channelErrors?.skillhub ? '远程 SkillHub 暂不可用，已仅展示本地结果。' : ''
  return [
    `卡片已展示 ${result.items.length} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    `${note}${remoteDown}对用户最多回一句短话。禁止清单和长文。不要再调用 skillhub_search。${more}`,
  ].join('\n')
}

export function renderInstall(result: InstallResult): string {
  return `${result.name} 已安装到 ${result.path}。新对话即可被 skill 工具发现。不要打印安装命令。`
}

export function renderList(result: { items: InstalledSkill[]; skillsDir: string }): string {
  if (!result.items?.length) return `还没有安装技能。目录：${result.skillsDir}`
  const lines = result.items.map((it, i) => `${i + 1}. ${it.name} (${it.slug})${it.version ? ` v${it.version}` : ''}`)
  return `已安装 ${result.items.length} 个技能（${result.skillsDir}）：\n${lines.join('\n')}`
}

export function renderPluginSearch(value: {
  items?: Array<{ owner?: string; name?: string; fullName?: string; installed?: boolean }>
}): string {
  if (!value.items?.length) return '没有找到相关 DSH 插件。对用户只说一句：没找到，可以换个词再搜。不要写长文。不要打印安装命令。'
  const lines = value.items.map((it, i) => {
    const ref = it.owner && it.name ? `${it.owner}/${it.name}` : String(it.fullName || '')
    return `${i + 1}. ${ref}${it.installed ? '（已安装）' : ''}`
  })
  return [
    `卡片已展示 ${value.items.length} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多回一句短话。禁止清单和长文。不要打印安装命令。安装时必须用上面的 owner/name，禁止编造。',
  ].join('\n')
}

export function renderPluginInstall(value: { fullName?: string }): string {
  return `${value.fullName || '插件'} 已安装。需要用户自行重启 Host 后生效。不要声称已重启。不要打印安装命令。`
}

export function renderPluginUninstall(value: { name?: string }): string {
  return `${value.name || '插件'} 已卸载。需要用户自行重启 Host。不要声称已重启。不要打印卸载命令，不要建议用 bash。`
}

export function renderPluginList(value: { items?: Array<{ name?: string; protected?: boolean }> }): string {
  if (!value.items?.length) return '当前 profile 没有已装插件。不要教用户卸载核心包。不要打印安装命令。'
  const lines = value.items.map((it, i) => `${i + 1}. ${it.name}${it.protected ? '（不可卸）' : ''}`)
  return [
    `已装插件 ${value.items.length} 个（内部列表，禁止复述给用户，禁止教用户卸核心包）：`,
    lines.join('\n'),
    '对用户最多一句。不要打印安装命令。',
  ].join('\n')
}

export function renderConnectorSearch(value: {
  items?: Array<{ id?: string; name?: string; title?: string; installable?: boolean; sourceKind?: string }>
}): string {
  if (!value.items?.length) return '没有找到相关连接器。对用户只说一句：没找到。不要写长文。不要当专家推。不要打印安装命令。'
  const lines = value.items.map((it, i) => {
    const label = it.title || it.name || it.id || ''
    const extra = it.installable === false || it.sourceKind === 'marketplace' ? '（展示不可装）' : ''
    return `${i + 1}. ${it.id} · ${label}${extra}`
  })
  return [
    `卡片已展示 ${value.items.length} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多一句。禁止清单和长文。市场条目展示不可装。不要 plaza_summon 连接器。不要打印安装命令。',
  ].join('\n')
}

export function renderConnectorInstall(value: { id?: string }): string {
  return `连接器 ${value.id || ''} 已安装。需要用户自行重启 Host。不要声称已重启。不要打印安装命令。`
}

export function renderConnectorUninstall(value: { id?: string }): string {
  return `连接器 ${value.id || ''} 已卸载。需要用户自行重启 Host。不要声称已重启。不要打印卸载命令。`
}

export function renderConnectorList(value: {
  items?: Array<{ id?: string }>
  marketplaceDisplayOnly?: number
}): string {
  const n = value.items?.length || 0
  const market = value.marketplaceDisplayOnly
    ? `市场源 ${value.marketplaceDisplayOnly} 条均不可装。`
    : ''
  if (!n) return `还没有已装连接器。${market}对用户最多一句。不要写长文。`
  const lines = value.items!.map((it, i) => `${i + 1}. ${it.id}`)
  return [
    `已装连接器 ${n} 个（禁止复述给用户）：`,
    lines.join('\n'),
    `${market}对用户最多一句。不要打印安装命令。`,
  ].join('\n')
}

export function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}
