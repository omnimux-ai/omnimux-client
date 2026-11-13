/**
 * pnpm `--reporter=ndjson` progress parser.
 *
 * One JSON object per line on stdout. Human fallback lines are ignored here
 * and handled by the spawn layer.
 */
export function emptyProgress() {
    return {
        phase: null,
        done: 0,
        total: null,
        currentPackage: null,
        downloaded: null,
        size: null,
        seen: false,
        error: null,
    };
}
export function createProgressTracker() {
    const snap = emptyProgress();
    const seenPackages = new Set();
    function dedupe(packageId) {
        if (typeof packageId !== 'string' || packageId === '')
            return;
        if (!seenPackages.has(packageId)) {
            seenPackages.add(packageId);
            snap.done += 1;
        }
    }
    function feed(line) {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            return;
        }
        if (typeof event !== 'object' || event === null)
            return;
        const msg = event;
        const name = msg.name;
        if (typeof name !== 'string')
            return;
        if (name === 'pnpm:stage') {
            const stage = msg.stage;
            if (stage === 'resolution_started')
                snap.phase = 'resolving';
            else if (stage === 'resolution_done')
                snap.phase = 'downloading';
            else if (stage === 'importing_started' || stage === 'importing_done')
                snap.phase = 'linking';
            snap.seen = true;
            return;
        }
        if (name === 'pnpm:progress') {
            snap.seen = true;
            const status = msg.status;
            if (status === 'resolved') {
                if (snap.phase === null)
                    snap.phase = 'resolving';
                dedupe(msg.packageId);
            }
            else if (status === 'fetched' || status === 'found_in_store') {
                snap.phase = 'downloading';
                snap.currentPackage = typeof msg.packageId === 'string' ? msg.packageId : snap.currentPackage;
                dedupe(msg.packageId);
            }
            return;
        }
        if (name === 'pnpm:fetching-progress') {
            snap.seen = true;
            snap.phase = 'downloading';
            if (typeof msg.packageId === 'string')
                snap.currentPackage = msg.packageId;
            if (typeof msg.size === 'number')
                snap.size = msg.size;
            if (typeof msg.downloaded === 'number')
                snap.downloaded = msg.downloaded;
            dedupe(msg.packageId);
            return;
        }
        if (name === 'pnpm:lifecycle') {
            snap.seen = true;
            snap.phase = 'building';
            const wd = typeof msg.wd === 'string' ? msg.wd : '';
            const dep = typeof msg.depPath === 'string' ? msg.depPath : '';
            const base = wd.split(/[\\/]/).filter(Boolean).pop();
            snap.currentPackage = base ?? (dep !== '' ? dep : snap.currentPackage);
            return;
        }
        if (name === 'pnpm:stats') {
            if (msg.added !== undefined || msg.removed !== undefined)
                snap.phase = 'linking';
            snap.seen = true;
            return;
        }
        if (name === 'pnpm' && msg.level === 'error') {
            const err = (msg.err ?? {});
            const message = typeof err.message === 'string' ? err.message : '';
            if (message !== '')
                snap.error = message.slice(0, 400);
        }
    }
    function reset() {
        seenPackages.clear();
        Object.assign(snap, emptyProgress());
    }
    return {
        get snapshot() {
            return { ...snap };
        },
        feed,
        reset,
    };
}
