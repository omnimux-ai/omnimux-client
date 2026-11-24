/**
 * @file plugins/omnimux-market/src/expert-runtime.ts
 * Dynamic runtime manager that registers/unregisters built-in market experts
 * directly through official DSH `ctx.agentPresets.register()`.
 *
 * Guarantees:
 * - Full Agent-plane plugin stack aligned with `presets/omni-agent/agent.cordis.yml`
 *   (including `skill-filesystem`, `tool-skill`, `planning`, `compaction`, `delegation`,
 *   shell/fs/web tools) so hired experts have real capabilities, not empty shells.
 * - Optional package resolvability filter mirrors `dsh-plugin-desktop/src/agent-preset-rows.ts`
 *   so missing optional packages never break an otherwise healthy preset mount.
 * - Post-register health check via `registry.list()`: if `broken` is reported,
 *   immediately calls `unregister()`, rolls back state, and returns a concrete error.
 * - Restores ONLY user-installed experts recorded in `installed-experts.json` on startup.
 */
import { markExpertDisabled, markExpertInstalled, readExpertLedger } from './expert-ledger.js';
import { DEFAULT_MARKET_EXPERTS, findMarketExpertById, resolveExpertPersonaText, } from './expert-market.js';
const PLAN_MODE_SECTION = [
    'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it.',
    'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual workspace. Do not edit or write files or execute destructive mutations while in plan mode.',
    'Make the plan decision-complete and submit it via exit_plan_mode as the final tool call.',
].join('\n\n');
function pruneUnresolvableRows(rows, isPackageResolvable) {
    const out = [];
    for (const row of rows) {
        if (row.group === true && Array.isArray(row.config)) {
            const nested = pruneUnresolvableRows(row.config, isPackageResolvable);
            if (nested.length > 0) {
                out.push({ ...row, config: nested });
            }
            continue;
        }
        if (row.name.startsWith('cordis:') || row.id === 'persona' || isPackageResolvable(row.name)) {
            out.push({ ...row });
        }
    }
    return out;
}
/**
 * Build a complete Agent-plane plugin stack for a hired market expert,
 * mirroring `presets/omni-agent/agent.cordis.yml`.
 */
export function buildMarketExpertPluginRows(persona, opts = {}) {
    const platform = opts.platform ?? process.platform;
    const isWin = platform === 'win32';
    const rawRows = [
        {
            id: 'persona',
            name: '@deepseek-ai/dsh-persona',
            config: { prefix: persona },
        },
        {
            id: 'agent-instructions',
            name: '@deepseek-ai/dsh-agent-instructions',
            config: { maxBytes: 65536 },
        },
        {
            id: 'tool-bash',
            name: '@deepseek-ai/dsh-tool-bash',
            disabled: isWin,
        },
        {
            id: 'tool-pwsh',
            name: '@deepseek-ai/dsh-tool-pwsh',
            disabled: !isWin,
        },
        {
            id: 'tool-fs',
            name: '@deepseek-ai/dsh-tool-fs',
        },
        {
            id: 'tool-fs-search',
            name: '@deepseek-ai/dsh-tool-fs-search',
            config: { sampleOverCapGlobResults: false },
        },
        {
            id: 'tool-jobs',
            name: '@deepseek-ai/dsh-tool-jobs',
        },
        {
            id: 'skill-filesystem',
            name: '@deepseek-ai/dsh-skill-filesystem',
        },
        {
            id: 'tool-skill',
            name: '@deepseek-ai/dsh-tool-skill',
        },
        {
            id: 'tool-goal',
            name: '@deepseek-ai/dsh-tool-goal',
        },
        {
            id: 'planning',
            name: 'cordis:group',
            group: true,
            isolate: { planMode: true },
            config: [
                {
                    id: 'plan-mode',
                    name: '@deepseek-ai/dsh-plan-mode',
                    config: { section: PLAN_MODE_SECTION },
                },
            ],
        },
        {
            id: 'compaction',
            name: 'cordis:group',
            group: true,
            isolate: { compaction: true, toolResultPruner: true },
            config: [
                { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
                { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
                {
                    id: 'tool-result-pruner',
                    name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
                    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
                },
            ],
        },
        {
            id: 'delegation',
            name: 'cordis:group',
            group: true,
            isolate: { workflowEngine: true },
            config: [
                { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
                { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
                {
                    id: 'tool-subagent',
                    name: '@deepseek-ai/dsh-tool-subagent',
                    config: { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' },
                },
                {
                    id: 'tool-subagent-fork',
                    name: '@deepseek-ai/dsh-tool-subagent',
                    config: { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'continuable' },
                },
                {
                    id: 'workflow-ptc',
                    name: '@deepseek-ai/dsh-workflow-ptc',
                    config: { provider: 'spawn' },
                },
                { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
                {
                    id: 'tool-ralph',
                    name: '@deepseek-ai/dsh-tool-ralph',
                    config: { subagentProvider: 'spawn', maxRounds: 64 },
                },
            ],
        },
        {
            id: 'tool-ask-user',
            name: '@deepseek-ai/dsh-tool-ask-user',
        },
        {
            id: 'tool-todo',
            name: '@deepseek-ai/dsh-tool-todo',
            config: { allowParallelInProgress: true },
        },
        {
            id: 'tool-web',
            name: '@deepseek-ai/dsh-tool-web',
            config: { fetch: true, searchTimeoutMs: 60000 },
        },
    ];
    return typeof opts.isPackageResolvable === 'function'
        ? pruneUnresolvableRows(rawRows, opts.isPackageResolvable)
        : rawRows;
}
export function buildMarketExpertPresetDefinition(exp, opts = {}) {
    return {
        id: exp.id,
        name: exp.name,
        description: exp.description,
        order: exp.order,
        plugins: buildMarketExpertPluginRows(resolveExpertPersonaText(exp), opts),
    };
}
export class ExpertPresetRuntime {
    home;
    registry;
    isPackageResolvable;
    onChanged;
    disposers = new Map();
    queues = new Map();
    constructor(options) {
        this.home = options.home;
        this.registry = options.registry;
        this.isPackageResolvable = options.isPackageResolvable;
        this.onChanged = options.onChanged;
    }
    serialize(id, task) {
        const prev = this.queues.get(id) ?? Promise.resolve();
        const run = prev.then(task, task);
        const settled = run.then(() => undefined, () => undefined);
        this.queues.set(id, settled);
        return run.finally(() => {
            if (this.queues.get(id) === settled)
                this.queues.delete(id);
        });
    }
    async listOfficial() {
        const rows = await this.registry.list();
        return Array.isArray(rows) ? rows : [];
    }
    hasActiveRegistration(id) {
        return this.disposers.has(id);
    }
    async install(exp, opts = {}) {
        const notify = opts.notify !== false;
        const persist = opts.persist !== false;
        return this.serialize(exp.id, async () => {
            const existingList = await this.listOfficial();
            const existing = existingList.find((row) => row.id === exp.id);
            if (existing && !existing.broken) {
                if (persist)
                    markExpertInstalled(this.home(), exp.id);
                if (notify)
                    this.onChanged?.();
                return { ok: true, id: exp.id, status: 'enabled', already: true };
            }
            // Clean up stale broken registration owned by us before retrying
            const staleDisposer = this.disposers.get(exp.id);
            if (staleDisposer) {
                this.disposers.delete(exp.id);
                await staleDisposer();
            }
            if (typeof this.registry.register !== 'function') {
                throw new Error('当前运行环境不支持动态注册 Agent 预设（agentPresets.register 不可用）');
            }
            const definition = buildMarketExpertPresetDefinition(exp, {
                isPackageResolvable: this.isPackageResolvable,
            });
            const unregister = await this.registry.register(definition);
            this.disposers.set(exp.id, unregister);
            const auditedList = await this.listOfficial();
            const mounted = auditedList.find((row) => row.id === exp.id);
            if (!mounted || mounted.broken) {
                this.disposers.delete(exp.id);
                try {
                    await unregister();
                }
                catch (rollbackErr) {
                    console.warn(`[omnimux-market] rollback unregister failed for ${exp.id}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
                }
                const detail = mounted?.broken || 'registered preset not visible in registry.list()';
                throw new Error(`专家「${exp.name}」挂载失败，已回滚：${detail}`);
            }
            if (persist)
                markExpertInstalled(this.home(), exp.id);
            if (notify)
                this.onChanged?.();
            return { ok: true, id: exp.id, status: 'enabled' };
        });
    }
    async disable(id, opts = {}) {
        const notify = opts.notify !== false;
        const exp = findMarketExpertById(id);
        if (!exp) {
            throw new Error(`预设「${id}」不是可卸载的市场专家（系统预置或用户自建预设不可在此禁用）`);
        }
        return this.serialize(id, async () => {
            const dispose = this.disposers.get(id);
            if (dispose) {
                this.disposers.delete(id);
                await dispose();
            }
            markExpertDisabled(this.home(), id);
            if (notify)
                this.onChanged?.();
            return { ok: true, id, status: 'disabled' };
        });
    }
    async restoreInstalled(experts = DEFAULT_MARKET_EXPERTS) {
        const ledger = readExpertLedger(this.home());
        const restored = [];
        const failed = [];
        const expertById = new Map(experts.map((exp) => [exp.id, exp]));
        for (const id of ledger.installed) {
            const exp = expertById.get(id);
            if (!exp)
                continue;
            try {
                await this.install(exp, { notify: false, persist: false });
                restored.push(id);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[omnimux-market] failed to restore installed expert ${id}: ${message}`);
                failed.push({ id, error: message });
            }
        }
        if (restored.length > 0) {
            this.onChanged?.();
        }
        return { restored, failed };
    }
    async disposeAll() {
        const entries = [...this.disposers.entries()];
        this.disposers.clear();
        for (const [id, dispose] of entries) {
            try {
                await dispose();
            }
            catch (err) {
                console.warn(`[omnimux-market] failed to dispose dynamic expert ${id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
}
