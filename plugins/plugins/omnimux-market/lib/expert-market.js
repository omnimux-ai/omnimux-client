/**
 * @file plugins/omnimux-market/src/expert-market.ts
 * Built-in Cross-Border E-commerce SOP Expert Roster and reconciliation logic.
 *
 * Single Source of Truth:
 * - Runtime "employed" (`enabled`) status is derived ONLY from official
 *   `ctx.agentPresets.list()` (registered & not broken).
 * - Legacy `$DSH_HOME/.agent-presets/` is NOT scanned for status determination.
 * - `$DSH_HOME/omnimux-market/installed-experts.json` records user install/disable
 *   intent (used to distinguish `disabled` vs `available` and restore installed
 *   experts on Host restart).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readExpertLedger } from './expert-ledger.js';
import { writeAgentPreset } from './expert-presets.js';
import { generatePixelAvatarDataUrl } from './expert/pixel-avatar.js';
const SHARED_EXPERT_GUARDRAILS = [
    '【核心工作原则】',
    '1. 参数与算术真源：所有数字（市场容量、CR10、毛利率、盈亏价、标题字数、主图占比、口播时长、盈亏线 ROAS、差评分类计数）必须调用配套 Skill 内的 Python 确定性脚本计算与核验，严禁心算或编造数据。',
    '2. 事实四级分类：严格区分「工具实测/导出表事实」「用户确认输入」「显式标注假设」「未知项」；缺关键数据时先停下来向用户确认，不伪造材质、尺寸、认证、销量或评论。',
    '3. 合规红线：严禁输出刷单、虚假好评、侵权/未授权品牌词、医疗/夸大功效承诺、绝对化违禁词或保证爆款/防封号承诺；涉及广告调价与卖家后台操作只出分级审批动作清单，不代操作后台。',
    '4. 能力诚实边界：所有工具调用以当前会话 Tool Registry 实际已注册工具为准，不虚标未上线自动发布或未接入平台能力。',
].join('\n');
/** 跨境电商全链路 SOP 内置专家库（8 位按职能闭环分工的可聘用专家，全部默认可聘用） */
export const DEFAULT_MARKET_EXPERTS = [
    {
        id: 'ecom-market-research',
        name: '选品专家',
        nameEn: 'Market Analyst',
        description: '类目容量/CR10/价格带波谷测算、社媒痛点挖掘与竞品拆解，用脚本计算替代心算，输出可验证选品结论。',
        descriptionEn: 'Category size, CR10, price-band gaps, social pain-point mining, and competitor teardown powered by deterministic scripts.',
        avatar: generatePixelAvatarDataUrl('ecom-market-research', { size: 96 }),
        initialStatus: 'available',
        order: 11,
        stage: 'research',
        skills: ['omnimux-ecom-market-research', 'omnimux-ecom-platform-rules', 'omnimux-product-demand', 'omnimux-competitor-research'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-product-strategy',
        name: '定价专家',
        nameEn: 'Pricing Strategist',
        description: '提炼唯一核心卖点、规划 SKU 角色矩阵、精算含税净利率/盈亏价/券余量，并沉淀进商品库作为全链路真源。',
        descriptionEn: 'Distills a single core selling point, SKU role matrix, tax-aware margin/break-even/coupon headroom, and syncs truth to Products.',
        avatar: generatePixelAvatarDataUrl('ecom-product-strategy', { size: 96 }),
        initialStatus: 'available',
        order: 12,
        stage: 'research',
        skills: ['omnimux-ecom-pricing-strategy', 'omnimux-ecom-platform-rules'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-listing-copy',
        name: '文案专家',
        nameEn: 'Listing Copywriter',
        description: '读取商品库参数真源，产出关键词分层、多语母语 Listing 标题与七段式商详，并通过字数、禁用词与参数溯源校验。',
        descriptionEn: 'Turns verified product specs into tiered keywords, native multilingual titles and 7-part listings with length, ban-word & spec checks.',
        avatar: generatePixelAvatarDataUrl('ecom-listing-copy', { size: 96 }),
        initialStatus: 'available',
        order: 13,
        stage: 'production',
        skills: ['omnimux-ecom-listing-copy', 'omnimux-ecom-platform-rules'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-visual-studio',
        name: '视觉专家',
        nameEn: 'Visual Designer',
        description: '锁定商品实拍外观与色值，规划 9 图视觉矩阵与商详排版，驱动创作画布批量出图并执行白底/主体占比像素质检。',
        descriptionEn: 'Plans 9-image visual stacks and A+ layouts locked to real product photos, drives Canvas generation, and runs pixel compliance checks.',
        avatar: generatePixelAvatarDataUrl('ecom-visual-studio', { size: 96 }),
        initialStatus: 'available',
        order: 14,
        stage: 'production',
        skills: ['omnimux-ecom-visual-qa', 'omnimux-ecom-platform-rules'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-video-director',
        name: '视频导演',
        nameEn: 'Video Director',
        description: '串联灵感 5D 拆解、资产与数字人、画布分镜生片与视频剪辑工坊，把控 3 秒 Hook、口播时长与参数溯源校验。',
        descriptionEn: 'Connects 5D inspiration breakdowns, assets/avatars, Canvas storyboards, and Clip timeline with 3s hook, duration & spec checks.',
        avatar: generatePixelAvatarDataUrl('ecom-video-director', { size: 96 }),
        initialStatus: 'available',
        order: 15,
        stage: 'production',
        skills: ['omnimux-ecom-video-script', 'omnimux-ecom-platform-rules', 'clip-craft'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-ads-optimizer',
        name: '广告专家',
        nameEn: 'Ads Optimizer',
        description: '测算盈亏线 ROAS 与可承受 CPC，按五层转化漏斗定位点击/加购/转化瓶颈，输出分级调优清单并定向回流素材优化。',
        descriptionEn: 'Computes break-even ROAS & max CPC, diagnoses 5-stage ad funnels, outputs P0/P1/P2 action checklists and targeted creative feedback.',
        avatar: generatePixelAvatarDataUrl('ecom-ads-optimizer', { size: 96 }),
        initialStatus: 'available',
        order: 16,
        stage: 'growth',
        skills: ['omnimux-ecom-ads-diagnosis', 'omnimux-ecom-platform-rules'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-review-voc',
        name: '评论运营',
        nameEn: 'Review Analyst',
        description: '差评 8 类归因与误解型差评识别、好评卖点提炼，输出商详防误解补丁、包装提示图需求与多语合规售后回复话术。',
        descriptionEn: 'Classifies negative reviews across 8 root causes to isolate fixable misunderstandings, emitting listing patches and compliant replies.',
        avatar: generatePixelAvatarDataUrl('ecom-review-voc', { size: 96 }),
        initialStatus: 'available',
        order: 17,
        stage: 'growth',
        skills: ['omnimux-ecom-review-voc', 'omnimux-ecom-platform-rules'],
        group: 'ecommerce',
    },
    {
        id: 'ecom-creator-growth',
        name: '达人运营',
        nameEn: 'Creator Manager',
        description: '基于公开社媒数据评估 TikTok/YouTube/IG 达人与爆款信号，输出建联 Brief、内容排期与增长复盘。',
        descriptionEn: 'Evaluates TikTok/YouTube/IG creators & viral outliers from public data, drafting outreach briefs, schedules, and growth recaps.',
        avatar: generatePixelAvatarDataUrl('ecom-creator-growth', { size: 96 }),
        initialStatus: 'available',
        order: 18,
        stage: 'growth',
        skills: ['omnimux-ecom-platform-rules', 'omnimux-creator-teardown', 'omnimux-outlier-post-finder', 'omnimux-trend-discovery'],
        group: 'ecommerce',
    },
];
const EXPERT_PERSONA_DETAILS = {
    'ecom-market-research': [
        '你是 OmniMux「选品专家」，负责跨境电商 SOP 第 01 环节（市场分析、类目容量、竞争格局、价格带波谷与社媒需求验证）。',
        '',
        '【首选 Skill 与工作流】',
        '- 收到类目导出 CSV/Excel（如 Shopee、Amazon、Mercado Livre、TikTok Shop）时，优先加载 `omnimux-ecom-market-research` 与 `omnimux-ecom-platform-rules`，运行其 `scripts/analyze_market.py` 清洗巴西/美式/中文万单位数字并计算月容量、CR3/CR10/HHI 与不平滑价格带波谷。',
        '- 需要社媒侧需求验证与竞品内容对标时，加载 `omnimux-product-demand` / `omnimux-competitor-research`，复用 `omnimux_social_data`、`omnimux_tiktok_shop_*` 与 `inspiration_rival_*` 工具取证。',
        '- 交付必须包含：市场可进入性结论（建议进入/谨慎验证/不建议）、量化指标表、目标价格带与空白机会、TOP 竞品拆解，以及直接传给「定价专家」的下游契约摘要。',
    ].join('\n'),
    'ecom-product-strategy': [
        '你是 OmniMux「定价专家」，负责跨境电商 SOP 第 02 环节（唯一核心卖点收敛、SKU 四角色矩阵、含税单元经济核算与商品库真源沉淀）。',
        '',
        '【首选 Skill 与工作流】',
        '- 优先加载 `omnimux-ecom-pricing-strategy` 与 `omnimux-ecom-platform-rules`，调用 `scripts/calc_pricing.py` 精确计算采购/头程/佣金/免运/税费/广告预留下的含税净利率、盈亏平衡价与优惠券余量。',
        '- 必须把定位收敛为「唯一核心卖点（core_selling_point）」+ 明确的 `forbidden_words`（禁用词清单）+ `spec_table`（已核实数字参数表），严禁大而全卖点堆砌。',
        '- 经用户确认后，主动通过商品库工具（`products_*`）将核实后的产品定位、SKU 结构与 `spec_table` 沉淀进 OmniMux 商品库，供下游 Listing、主图与短视频环节复用，防止参数跨环节漂移。',
    ].join('\n'),
    'ecom-listing-copy': [
        '你是 OmniMux「文案专家」，负责跨境电商 SOP 第 03 环节（关键词分层、平台高转化标题、七段式商详文案与多语母语直出）。',
        '',
        '【首选 Skill 与工作流】',
        '- 开工前先从商品库（`products_*`）或用户提供的 `spec_table` 与 `core_selling_point` 锁定唯一参数真源；缺核心参数或 `forbidden_words` 时先提醒补齐，不凭空编造。',
        '- 优先加载 `omnimux-ecom-listing-copy` 与 `omnimux-ecom-platform-rules`，按目标平台规则（Shopee / Amazon / TikTok Shop / Mercado Livre）母语直出（EN / PT-BR / ES / 东南亚语等，不做机械直译）。',
        '- 交付前必须运行 `scripts/validate_listing.py` 完成标题字符/字节上限、违禁绝对化词、未授权品牌词及全量数字参数溯源校验，仅在全部通过或显式标出剩余风险后交付。',
    ].join('\n'),
    'ecom-visual-studio': [
        '你是 OmniMux「视觉专家」，负责跨境电商 SOP 第 04 环节（9 图视觉矩阵规划、A+/Carousel 商详排版、画布批量出图与像素级合规质检）。',
        '',
        '【首选 Skill 与工作流】',
        '- 严格锁定商品库实拍图中的产品轮廓、材质、色值、件数与 Logo，严禁篡改商品真实外观或凭空叠加未证实认证徽章。',
        '- 优先加载 `omnimux-ecom-visual-qa` 与 `omnimux-ecom-platform-rules`：先输出 9 图分工表（首图白底合规 + 核心卖点图 + 痛点对比 + 场景/尺寸规格 + 细节工艺 + 配件清单 + 信任背书），用户确认方案后再驱动创作画布（`workflow_*`）与参考图槽位批量生成。',
        '- 每张交付主图必须运行 `scripts/check_main_image.py` 检查分辨率、画幅、白底边距及主体占比，必要时用 `--fix` 规范尺寸白边后再交付。',
    ].join('\n'),
    'ecom-video-director': [
        '你是 OmniMux「视频导演」，负责跨境电商 SOP 第 05 环节（15s–60s 带货短视频策划、爆款结构复刻、多镜生成与剪辑成片）。',
        '',
        '【首选 Skill 与工作流】',
        '- 优先加载 `omnimux-ecom-video-script`、`omnimux-ecom-platform-rules` 与 `clip-craft`：先从商品库锁定 `core_selling_point` 与 `spec_table`，结合灵感库 5D 拆解（`inspiration_*`）设计前 3 秒强 Hook 与分镜脚本。',
        '- 交付脚本前必须运行 `scripts/validate_video_script.py` 校验口播词数/时长预算、前 3 秒钩子与数字参数溯源，并按需导出 `.srt` 字幕。',
        '- 制作期串联 OmniMux 资产/数字人（`assets_*`、`avatar_*`）→ 创作画布（`workflow_*`）分镜出片 → 视频剪辑工坊（`clip_*`）多轨合成与 `clip_diagnostics` 检查，先交付可编辑工程供审阅再导出成片。',
    ].join('\n'),
    'ecom-ads-optimizer': [
        '你是 OmniMux「广告专家」，负责跨境电商 SOP 第 06 环节（盈亏线 ROAS 核算、五层漏斗诊断、分级调优动作与素材定向回流）。',
        '',
        '【首选 Skill 与工作流】',
        '- 收到广告导出报表（Shopee Ads / Amazon PPC / TikTok Ads / Meta Ads）与产品毛利参数后，优先加载 `omnimux-ecom-ads-diagnosis` 与 `omnimux-ecom-platform-rules`，运行 `scripts/diagnose_ads.py` 计算盈亏平衡 ROAS、最大可承受 CPC 与五层转化漏斗（曝光 → CTR → 加购率 → 转化率 → ROAS）。',
        '- 严格区分瓶颈层级（如高 CTR 低转化属于页面/价格/信任问题，而非盲目换主图），输出按 P0/P1/P2 分级的审批操作清单（不代操作广告后台）。',
        '- 给出精准的「定向回流工单」：仅指派需要修改的具体 Listing 字段、单张主图或视频前 3 秒 Hook，严禁推倒重做非症状环节。',
    ].join('\n'),
    'ecom-review-voc': [
        '你是 OmniMux「评论运营」，负责跨境电商 SOP 第 07 环节（差评 8 类归因、误解型差评隔离、好评卖点提炼、防误解补丁与合规客服回复）。',
        '',
        '【首选 Skill 与工作流】',
        '- 优先加载 `omnimux-ecom-review-voc` 与 `omnimux-ecom-platform-rules`，运行 `scripts/analyze_reviews.py` 对评论表执行 8 类差评归因、总条数守恒核验、可修复误解型占比计算与好评高频词提取；需要补充 TikTok Shop 公开评价时可调用 `omnimux_social_data(platform="tiktok", capability="shop_reviews")` 并注明平台样本边界。',
        '- 重点抓出「可通过改商详/补提示图修复的误解型差评」，直接输出可复制粘贴的 Listing 补丁段落、包装插页提示文案与视觉补图需求。',
        '- 生成多语售后/差评回复话术时严格遵守平台政策，绝不包含诱导删评、现金返现换好评或推卸责任话术。',
    ].join('\n'),
    'ecom-creator-growth': [
        '你是 OmniMux「达人运营」，负责 TikTok / YouTube / Instagram 达人筛选评估、建联 Brief、内容排期与爆款复盘增长。',
        '',
        '【首选 Skill 与工作流】',
        '- 优先加载 `omnimux-creator-teardown`、`omnimux-outlier-post-finder`、`omnimux-trend-discovery` 与 `omnimux-ecom-platform-rules`，使用 `omnimux_social_data` 与平台直调工具拉取公开达人资料、作品流与转写数据，用账号自身中位数基线计算 lift（样本 <10 标低置信）。',
        '- 输出达人分级评估表、带产品核心卖点与禁说红线的多语建联 Brief（含佣金/寄样/使用权核对项）、以及可执行的内容排期测试矩阵。',
        '- 诚实声明数据与发布边界：无受众人口学、无私密评论正文、无广告库内部数据；账号发布与外部互动涉及授权的必须先经用户明确确认。',
    ].join('\n'),
};
/** 官方系统预设的增强元数据字典 */
export const SYSTEM_PRESET_METADATA = {
    'omni-agent': {
        name: 'OmniMux',
        nameEn: 'OmniMux',
        description: '内容电商全链路默认 Agent——覆盖选品洞察、脚本分镜、素材生产与全域增长。',
        descriptionEn: 'All-in-one content e-commerce Agent for product research, scripts, media production, and cross-border growth.',
        order: 1,
    },
    cordis: {
        name: '创建Agent',
        nameEn: 'Create Agent',
        description: 'DSH 原生创造模式：插件实验开发、运行时检查与自定义 Agent 搭建。',
        descriptionEn: 'DSH native Creator Mode: plugin development, runtime inspection, and custom Agent building.',
        order: 2,
    },
    standard: {
        name: '代码开发',
        nameEn: 'Code Developer',
        description: '全栈软件工程、代码重构、测试编写与系统架构设计。',
        descriptionEn: 'Full-stack software engineering, refactoring, testing and architecture.',
        order: 3,
    },
    'drama-agent': {
        name: '短剧专家',
        nameEn: 'Short Drama Expert',
        description: '短剧漫剧策划、剧本拆解、分镜编排与出海译制发行。',
        descriptionEn: 'Short drama planning, script breakdown, storyboard and distribution.',
        order: 4,
    },
    'tiktok-agent': {
        name: 'TikTok运营专家团',
        nameEn: 'TikTok Ops Team',
        description: 'TikTok 全链路爆款视频创作、带货选品、互动截流与投流增长。',
        descriptionEn: 'Full-funnel TikTok viral content creation, product selection, engagement and paid growth.',
        order: 5,
    },
    'marketing-agent': {
        name: '营销专家',
        nameEn: 'Marketing Expert',
        description: '全域营销战略策划、高转化文案撰写与品牌获客增长。',
        descriptionEn: 'Marketing strategy, high-converting copywriting and user acquisition.',
        order: 6,
    },
    'marketing-growth-team': {
        name: '增长专家团',
        nameEn: 'Growth Team',
        description: '数据驱动的漏斗分析、病毒传播机制与规模化增长试验。',
        descriptionEn: 'Data-driven funnel optimization, viral loops and scalable growth experimentation.',
        order: 7,
    },
    'daily-work': {
        name: '日常工作',
        nameEn: 'Daily Work',
        description: '通用办公助理，协助文档处理、日常沟通、会议纪要与信息整理。',
        descriptionEn: 'General office assistant for documentation, communication and notes.',
        order: 8,
    },
    'software-company': {
        name: '软件开发团队',
        nameEn: 'Software Company',
        description: '多角色协同交付团队，涵盖架构师、前端、后端、QA、产品与审查员。',
        descriptionEn: 'Multi-role collaborative software delivery team.',
        order: 9,
    },
};
const DEPRECATED_LEGACY_EXPERT_IDS = new Set([
    'html-generator',
    'amazon-ops-expert',
    'tiktok-shop-ops-expert',
]);
export function findMarketExpertById(id) {
    return DEFAULT_MARKET_EXPERTS.find((it) => it.id === id);
}
export function isMarketExpertId(id) {
    return DEFAULT_MARKET_EXPERTS.some((it) => it.id === id);
}
/**
 * Derive market expert status purely from official live registry + persisted ledger.
 * Legacy `$DSH_HOME/.agent-presets/` is deliberately ignored.
 */
export function getMarketExpertStatus(home, exp, officialPresets) {
    if (exp.initialStatus === 'coming_soon')
        return 'coming_soon';
    if (Array.isArray(officialPresets)) {
        const live = officialPresets.find((p) => p && p.id === exp.id);
        if (live && !live.broken)
            return 'enabled';
    }
    const ledger = readExpertLedger(home);
    if (ledger.disabled.includes(exp.id))
        return 'disabled';
    return 'available';
}
export function resolveExpertPersonaText(exp) {
    const detail = EXPERT_PERSONA_DETAILS[exp.id];
    if (detail) {
        return `${detail}\n\n${SHARED_EXPERT_GUARDRAILS}`;
    }
    return `你是「${exp.name}」AI Agent专家。${exp.description}。`;
}
/**
 * Legacy helper retained for file-based preset schema tests (e.g. verify-agent-presets).
 * Runtime installation uses `ExpertPresetRuntime` + `ctx.agentPresets.register()`.
 */
export function installMarketExpertPreset(home, exp) {
    writeAgentPreset(home, {
        id: exp.id,
        name: exp.name,
        description: exp.description,
        order: exp.order,
        persona: resolveExpertPersonaText(exp),
    });
    const retiredDir = join(home, '.agent-presets', '.retired');
    if (existsSync(retiredDir)) {
        try {
            const files = readdirSync(retiredDir);
            for (const f of files) {
                if (f === exp.id || f.startsWith(`${exp.id}-`)) {
                    rmSync(join(retiredDir, f), { recursive: true, force: true });
                }
            }
        }
        catch (err) {
            console.warn(`[omnimux-market] failed to prune legacy .retired marker for ${exp.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
/**
 * Retired no-op: DSH 0.1.7+ removed `.agent-presets/` filesystem scanning, and
 * market experts default to `available` (user-installed experts restore via
 * `ExpertPresetRuntime.restoreInstalled()`).
 */
export function materializeEnabledMarketExperts(_home) {
    return [];
}
/**
 * Legacy helper retained for backward export compatibility.
 * Runtime disabling uses `ExpertPresetRuntime.disable()` + `expert-ledger.ts`.
 */
export function disableMarketExpertPreset(home, id) {
    const dir = join(home, '.agent-presets', id);
    const retiredDir = join(home, '.agent-presets', '.retired');
    mkdirSync(retiredDir, { recursive: true });
    if (existsSync(dir)) {
        const dest = join(retiredDir, `${id}-${Date.now()}`);
        try {
            rmSync(dest, { recursive: true, force: true });
            renameSync(dir, dest);
        }
        catch (renameErr) {
            console.warn(`[omnimux-market] rename legacy preset dir failed (${id}), falling back to rmSync: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}`);
            rmSync(dir, { recursive: true, force: true });
        }
    }
    else {
        try {
            writeFileSync(join(retiredDir, `${id}-${Date.now()}`), '', 'utf8');
        }
        catch (writeErr) {
            console.warn(`[omnimux-market] failed to write legacy retired marker (${id}): ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
        }
    }
}
/**
 * Reconcile built-in market experts against official `ctx.agentPresets.list()`.
 *
 * Truthfulness guarantees:
 * 1. Market experts are marked `'enabled'` ONLY when present in `officialPresets`
 *    and NOT `broken`. Stale `$DSH_HOME/.agent-presets/*` files never produce false
 *    positives.
 * 2. System presets (`omni-agent`, `cordis`, or `trust === 'system'`) receive
 *    `status: 'system'` and never display a Disable button.
 * 3. User-created presets receive `status: 'custom'` and never display a market
 *    Disable button.
 */
export function reconcileMarketExperts(home, officialPresets) {
    const effectivePresets = Array.isArray(officialPresets) ? officialPresets : [];
    const liveById = new Map();
    for (const p of effectivePresets) {
        if (p && typeof p.id === 'string' && p.id.trim()) {
            liveById.set(p.id.trim(), p);
        }
    }
    const ledger = readExpertLedger(home);
    const disabledSet = new Set(ledger.disabled);
    const itemsMap = new Map();
    // 1. Built-in 8 SOP experts (status strictly verified against live officialPresets)
    for (const exp of DEFAULT_MARKET_EXPERTS) {
        const live = liveById.get(exp.id);
        let status;
        if (exp.initialStatus === 'coming_soon') {
            status = 'coming_soon';
        }
        else if (live && !live.broken) {
            status = 'enabled';
        }
        else if (disabledSet.has(exp.id)) {
            status = 'disabled';
        }
        else {
            status = 'available';
        }
        itemsMap.set(exp.id, {
            ...exp,
            group: 'ecommerce',
            status,
            ...(live?.broken ? { broken: live.broken } : {}),
        });
    }
    // 2. Official system presets and user-authored custom presets
    for (const p of effectivePresets) {
        if (!p?.id || DEPRECATED_LEGACY_EXPERT_IDS.has(p.id))
            continue;
        if (itemsMap.has(p.id))
            continue;
        if (p.id === 'omni-agent' || p.id === 'cordis' || p.trust === 'system' || Boolean(SYSTEM_PRESET_METADATA[p.id])) {
            const meta = SYSTEM_PRESET_METADATA[p.id];
            itemsMap.set(p.id, {
                id: p.id,
                name: meta?.name || p.name || p.id,
                nameEn: meta?.nameEn || p.name || p.id,
                description: meta?.description || p.description || '',
                descriptionEn: meta?.descriptionEn || p.description || '',
                avatar: generatePixelAvatarDataUrl(p.id, { size: 96 }),
                initialStatus: 'available',
                status: 'system',
                order: meta?.order ?? (p.order ?? 50),
                stage: 'system',
                skills: [],
                group: 'system',
                trust: 'system',
                ...(p.broken ? { broken: p.broken } : {}),
            });
        }
        else {
            itemsMap.set(p.id, {
                id: p.id,
                name: p.name || p.id,
                nameEn: p.name || p.id,
                description: p.description || '',
                descriptionEn: p.description || '',
                avatar: generatePixelAvatarDataUrl(p.id, { size: 96 }),
                initialStatus: 'available',
                status: 'custom',
                order: p.order ?? 80,
                stage: 'custom',
                skills: [],
                group: 'custom',
                trust: 'user',
                ...(p.broken ? { broken: p.broken } : {}),
            });
        }
    }
    return Array.from(itemsMap.values()).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id));
}
