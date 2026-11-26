import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('./profile-lock-archive.py', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const globalJsonCache = new Map();

function fail(message, code = 5) {
  throw Object.assign(new Error(message), { code });
}

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export const digest = value => hash(stable(value));

export const inside = (root, entry) => entry === root
  || (!path.relative(root, entry).startsWith('..') && !path.isAbsolute(path.relative(root, entry)));

/** Reject symlinks in every existing component, including the leaf. */
export function assertPath(entry, missing = false) {
  if (!path.isAbsolute(entry) || path.normalize(entry) !== entry) throw new Error('non-canonical path');
  let cursor = path.parse(entry).root;
  for (const part of entry.slice(cursor.length).split('/').filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat && !missing) throw new Error('missing path');
    if (stat?.isSymbolicLink()) throw new Error('symlink ancestor');
  }
  return entry;
}

/** Run anchored file operations via profile-lock-archive.py's DirectoryAnchor. */
export function prepareFiles(request) {
  const result = spawnSync('python3', ['-B', archive, 'prepareFiles'], {
    input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 1 << 20,
  });
  if (result.status !== 0) fail('anchored preparation rejected', 5);
  return JSON.parse(result.stdout);
}

/** Decode strict JSON without executing package code. */
export function readJson(file, cache = null) {
  const store = cache || globalJsonCache;
  const stat = fs.statSync(file);
  const cached = store.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached.data;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const result = spawnSync('python3', [archive, 'json'], {
      input: JSON.stringify({ path: file }), encoding: 'utf8', maxBuffer: 16 << 20,
    });
    if (result.status !== 0) throw new Error('invalid or ambiguous JSON');
    data = JSON.parse(result.stdout);
  }
  store.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

/** Hash a no-follow regular file with constant-size reads. */
export function hashFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const state = createHash('sha256');
  const buffer = Buffer.alloc(65536);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('not a regular payload file');
    let count = 0;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) state.update(buffer.subarray(0, count));
    const after = fs.fstatSync(fd, { bigint: true });
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error('payload changed while hashing');
    }
    return state.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/** Deterministic payload inventory with optional excludes and symlink preservation. */
export function payloadManifest(root, { exclude = [], links = false } = {}) {
  const entries = [];
  function walk(directory, relative = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      if (exclude.some(item => rel === item || rel.startsWith(`${item}/`))) continue;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      const record = { path: rel, type: '', size: 0, mode: stat.mode & 0o777, sha256: null };
      if (stat.isDirectory()) {
        record.type = 'directory';
        entries.push(record);
        walk(file, rel);
      } else if (stat.isFile()) {
        record.type = 'file';
        record.size = stat.size;
        record.sha256 = hashFile(file);
        entries.push(record);
      } else if (links && stat.isSymbolicLink()) {
        entries.push({ ...record, type: 'symlink', linkText: fs.readlinkSync(file) });
      } else {
        throw new Error('unsupported payload entry');
      }
    }
  }
  assertPath(root);
  walk(root);
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { entries, digest: digest(entries) };
}

/** Build a pnpm environment from an allowlist; no inherited Node/config/proxy hooks. */
export function privatePnpmEnvironment(privateRoot) {
  assertPath(privateRoot);
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(privateRoot, 'home'),
    CI: 'true',
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_DEFAULT_TO_LATEST: '0',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_ignore_scripts: 'true',
    npm_config_ignore_pnpmfile: 'true',
    npm_config_verify_deps_before_run: 'false',
    npm_config_update_notifier: 'false',
    npm_config_registry: registry,
    npm_config_side_effects_cache: 'false',
    npm_config_optimistic_repeat_install: 'false',
  };
  for (const [key, relative] of Object.entries({
    TMPDIR: 'tmp', TMP: 'tmp', TEMP: 'tmp',
    XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state',
    XDG_DATA_HOME: 'data', COREPACK_HOME: 'corepack', PNPM_HOME: 'pnpm-home',
    npm_config_cache: 'cache/npm', npm_config_store_dir: 'store', npm_config_global_dir: 'global',
    npm_config_state_dir: 'state', npm_config_cache_dir: 'cache/pnpm',
  })) env[key] = path.join(privateRoot, relative);
  const operations = [];
  for (const value of new Set([
    env.HOME,
    ...Object.entries(env)
      .filter(([key]) => /^(XDG_|COREPACK_HOME|PNPM_HOME|TMP|TEMP)|npm_config_(cache|store_dir|global_dir|state_dir|cache_dir)$/.test(key))
      .map(([, value]) => value),
  ])) {
    operations.push({ operation: 'mkdir', path: value });
  }
  for (const [key, name] of [['npm_config_userconfig', 'user.npmrc'], ['npm_config_globalconfig', 'global.npmrc']]) {
    env[key] = path.join(privateRoot, name);
    operations.push({ operation: 'write', path: env[key], text: '', emptyOnly: true });
  }
  prepareFiles({ operation: 'batch', root: privateRoot, operations });
  return env;
}

/** Private test/setup environment; inherits COREPACK_HOME when pre-populated. */
export function pnpmEnvironment(home) {
  if (fs.existsSync(home)) assertPath(home);
  else {
    assertPath(home, true);
    prepareFiles({ operation: 'mkdir', path: home });
  }
  return { ...privatePnpmEnvironment(home), COREPACK_HOME: process.env.COREPACK_HOME || path.join(home, 'corepack') };
}

/**
 * Worker supervisor is the process-group leader and never signals a recycled PID.
 * Its stdin is a lifetime pipe: coordinator death triggers TERM then group KILL.
 * A kernel lease stays held until the supervisor and inherited worker FDs close.
 */
const workerScript = String.raw`import os,sys,json,subprocess,signal,fcntl,selectors,time,contextlib,importlib.util
r=json.loads(sys.argv[1])
spec=importlib.util.spec_from_file_location('guard',r['archive']);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
stack=contextlib.ExitStack();anchors={p:stack.enter_context(m.DirectoryAnchor(p)) for p,_ in r['identities']}
def verify():
 for p,expected in r['identities']:
  anchors[p].verify()
  if m.identity(os.fstat(anchors[p].fd))[:2]!=expected:raise ValueError('worker directory identity drift')
verify()
leaseParent=anchors[os.path.dirname(r['lease'])]
lease=os.open(os.path.basename(r['lease']),os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=leaseParent.fd);fcntl.flock(lease,fcntl.LOCK_EX)
signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
def defaults():
 os.fchdir(anchors[r['cwd']].fd)
 signal.signal(signal.SIGTERM,signal.SIG_DFL);signal.signal(signal.SIGINT,signal.SIG_DFL)
verify()
p=subprocess.Popen(r['command'],env=r['env'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(lease,anchors[r['cwd']].fd),preexec_fn=defaults)
s=selectors.DefaultSelector();s.register(sys.stdin,selectors.EVENT_READ);s.register(p.stdout,selectors.EVENT_READ,'stdout');s.register(p.stderr,selectors.EVENT_READ,'stderr')
chunks={'stdout':[],'stderr':[]};size=0;deadline=time.monotonic()+r['timeout']/1000;stopping=None;reason=None;eof=0
while True:
 for key,_ in s.select(.05):
  if key.fileobj is sys.stdin:
   os.read(sys.stdin.fileno(),4096);s.unregister(sys.stdin);reason='aborted'
  else:
   b=os.read(key.fileobj.fileno(),65536)
   if not b:s.unregister(key.fileobj);eof+=1
   else:
    kept=b[:max(0,r['limit']-size)]
    if kept:chunks[key.data].append(kept);size+=len(kept)
    if len(kept)<len(b):reason='output-limit'
 if time.monotonic()>deadline:reason='timeout'
 if reason and stopping is None:
  stopping=time.monotonic();os.killpg(os.getpgrp(),signal.SIGTERM)
 if eof==2 and p.poll() is not None or stopping is not None and time.monotonic()-stopping>.5:break
code=p.poll()
try:verify()
except (ValueError,OSError):reason='directory-drift'
stack.close()
result={'code':code if code is not None and not reason else 5,'signal':reason,**{name:b''.join(parts).decode('utf-8','replace') for name,parts in chunks.items()}}
try:sys.stdout.write(json.dumps(result));sys.stdout.flush()
finally:
 os.killpg(os.getpgrp(),signal.SIGKILL)
`;

/** Run pnpm/node toolchain with bounded output, a timeout, directory anchoring, and an owned lifetime pipe. */
export async function runPnpm(argv, { cwd, env, signal, lease, executable: requestedExecutable, directoryIdentities = [], timeoutMs = 120000, maxOutput = 8 << 20 } = {}) {
  if (signal?.aborted) return { code: 5, signal: 'aborted', stdout: '', stderr: '' };
  const privateHome = env.HOME;
  if (fs.existsSync(privateHome)) assertPath(privateHome);
  else {
    assertPath(privateHome, true);
    prepareFiles({ operation: 'mkdir', path: privateHome });
  }
  const leasePath = lease || path.join(privateHome, 'pnpm-worker.lock');
  const environmentDirectories = Object.entries(env)
    .filter(([key]) => /^(HOME|XDG_.*|COREPACK_HOME|PNPM_HOME|TMPDIR|TMP|TEMP|npm_config_(cache|store_dir|global_dir|state_dir|cache_dir))$/.test(key))
    .map(([, value]) => value);
  const paths = [...new Set([cwd, path.dirname(leasePath), ...environmentDirectories, ...directoryIdentities.map(([entry]) => entry)])];
  const identities = prepareFiles({ operation: 'identities', paths }).identities;
  for (const [entry, expected] of directoryIdentities) {
    if (stable(identities.find(([name]) => name === entry)?.[1]) !== stable(expected)) fail('pnpm directory identity drift', 5);
  }
  if (requestedExecutable !== undefined && (!path.isAbsolute(requestedExecutable) || !fs.statSync(requestedExecutable).isFile())) {
    fail('explicit pnpm executable must be a local file', 5);
  }
  const executable = requestedExecutable ?? (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'pnpm')).find(file => fs.existsSync(file));
  if (!executable) fail('pnpm 11.7.0 executable unavailable', 5);
  return await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', '-c', workerScript, JSON.stringify({
      command: [executable, ...argv], cwd, env, lease: leasePath, archive, identities, timeout: timeoutMs, limit: maxOutput,
    })], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const abort = () => child.stdin.end();
    child.stdin.on('error', () => {});
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.length > maxOutput * 7 + 4096) abort();
    });
    child.on('error', error => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', () => {
      signal?.removeEventListener('abort', abort);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ code: 5, signal: 'worker-failed', stdout: '', stderr: '' });
      }
    });
  });
}
