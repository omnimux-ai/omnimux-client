/**
 * @file plugins/omnimux-market/src/expert-ledger.ts
 * Persistent ledger for user-installed and user-disabled built-in market experts.
 *
 * Stored at `$DSH_HOME/omnimux-market/installed-experts.json`.
 * This ledger records user intent across restarts; live runtime availability is
 * always audited against official `ctx.agentPresets.list()`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function expertLedgerPath(home) {
    return join(home, 'omnimux-market', 'installed-experts.json');
}
function errorCode(err) {
    if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
        return err.code;
    }
    return err instanceof Error ? err.message : String(err);
}
function normalizeIdList(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const out = [];
    for (const raw of value) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
function emptyLedger() {
    return {
        version: 1,
        installed: [],
        disabled: [],
        updatedAt: '',
    };
}
/**
 * Read persisted install/disable ledger.
 * Missing file returns an empty ledger; corrupted JSON warns and degrades to empty
 * without blocking Host boot or expert market rendering.
 */
export function readExpertLedger(home) {
    const path = expertLedgerPath(home);
    if (!existsSync(path))
        return emptyLedger();
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            console.warn('[omnimux-market] invalid expert ledger payload (expected object); degrading to empty state');
            return emptyLedger();
        }
        const installed = normalizeIdList(parsed.installed);
        const installedSet = new Set(installed);
        const disabled = normalizeIdList(parsed.disabled).filter((id) => !installedSet.has(id));
        return {
            version: 1,
            installed,
            disabled,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        };
    }
    catch (err) {
        console.warn(`[omnimux-market] failed to read expert ledger (${errorCode(err)}); degrading to empty state`);
        return emptyLedger();
    }
}
/**
 * Atomically persist the expert install/disable ledger.
 */
export function writeExpertLedger(home, next) {
    const path = expertLedgerPath(home);
    const installed = normalizeIdList(next.installed);
    const installedSet = new Set(installed);
    const disabled = normalizeIdList(next.disabled).filter((id) => !installedSet.has(id));
    const record = {
        version: 1,
        installed,
        disabled,
        updatedAt: new Date().toISOString(),
    };
    const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        renameSync(tmpPath, path);
        return record;
    }
    catch (err) {
        throw new Error(`expert ledger not writable (${errorCode(err)})`);
    }
    finally {
        if (existsSync(tmpPath)) {
            try {
                rmSync(tmpPath, { force: true });
            }
            catch (cleanupErr) {
                console.warn(`[omnimux-market] failed to clean expert ledger temp file (${errorCode(cleanupErr)})`);
            }
        }
    }
}
export function markExpertInstalled(home, id) {
    const current = readExpertLedger(home);
    const installed = [...current.installed.filter((it) => it !== id), id];
    const disabled = current.disabled.filter((it) => it !== id);
    return writeExpertLedger(home, { installed, disabled });
}
export function markExpertDisabled(home, id) {
    const current = readExpertLedger(home);
    const installed = current.installed.filter((it) => it !== id);
    const disabled = [...current.disabled.filter((it) => it !== id), id];
    return writeExpertLedger(home, { installed, disabled });
}
