import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NODE_OPTIONS_WITH_VALUE = new Set([
  '--import',
  '-r',
  '--require',
  '--loader',
  '--experimental-loader',
  '-C',
  '--conditions',
  '--env-file',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
]);

const NODE_INLINE_EVAL_OPTIONS = new Set(['-e', '--eval', '-p', '--print']);

const PNPM_BUILTINS = new Set([
  'install', 'i', 'exec', 'dlx', 'list', 'ls', 'audit', 'why', 'add',
  'remove', 'rm', 'update', 'up', 'help', 'config', 'prune', 'dedupe',
  'run', 'run-script', 'store', 'import', 'fetch', 'pack', 'publish',
  'link', 'unlink', 'patch', 'patch-commit', 'env', 'root',
]);

function stripShellQuotes(token) {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function isLocalRelativePath(token) {
  return (
    Boolean(token) &&
    !token.startsWith('-') &&
    !token.startsWith('/') &&
    !token.startsWith('$') &&
    !token.startsWith('~')
  );
}

function listWorkspacePackageNames(pluginsRoot) {
  const names = new Set();
  for (const group of ['plugins', 'packages']) {
    const dir = join(pluginsRoot, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(dir, entry.name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.name === 'string' && pkg.name) names.add(pkg.name);
      names.add(entry.name);
    }
  }
  return names;
}

function inspectPluginsPackageCommand(command) {
  const fileTargets = [];
  const filterTargets = [];
  const scriptRefs = [];
  let segmentCwd = '.';

  for (const rawSegment of command.split(/&&|\|\||;/u)) {
    const tokens = rawSegment
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(stripShellQuotes);

    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens.at(0) ?? '')) {
      tokens.shift();
    }
    const [executable, ...args] = tokens;
    if (!executable) continue;

    if (executable === 'cd') {
      const [nextDir] = args;
      if (nextDir && isLocalRelativePath(nextDir)) {
        segmentCwd = join(segmentCwd, nextDir);
      }
      continue;
    }

    if (executable === 'node') {
      let isNodeTest = false;
      let skipNext = false;
      for (const token of args) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        if (NODE_INLINE_EVAL_OPTIONS.has(token)) break;
        if (token === '--test') {
          isNodeTest = true;
          continue;
        }
        if (NODE_OPTIONS_WITH_VALUE.has(token)) {
          skipNext = true;
          continue;
        }
        if (token.startsWith('-')) continue;
        if (isLocalRelativePath(token)) {
          fileTargets.push(join(segmentCwd, token));
        }
        if (!isNodeTest) break;
      }
      continue;
    }

    if (executable === 'bash' || executable === 'sh') {
      let skipNext = false;
      for (const token of args) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        if (token === '-c') break;
        if (token === '-o') {
          skipNext = true;
          continue;
        }
        if (token.startsWith('-')) continue;
        if (isLocalRelativePath(token)) {
          fileTargets.push(join(segmentCwd, token));
        }
        break;
      }
      continue;
    }

    const [firstArg, ...afterFirstArg] = args;
    const isCorepackPnpm = executable === 'corepack' && firstArg === 'pnpm';
    if (executable === 'pnpm' || isCorepackPnpm) {
      const pnpmArgs = isCorepackPnpm ? afterFirstArg : args;
      let hasRecursiveOrFilter = false;
      let expectFilterValue = false;
      let expectRunScript = false;
      let subcmd = null;
      for (const token of pnpmArgs) {
        if (expectFilterValue) {
          expectFilterValue = false;
          if (!token.startsWith('-')) filterTargets.push(token);
          continue;
        }
        if (expectRunScript) {
          expectRunScript = false;
          subcmd = token;
          break;
        }
        if (token === '--filter' || token === '-F') {
          hasRecursiveOrFilter = true;
          expectFilterValue = true;
          continue;
        }
        if (token === '-r' || token === '--recursive') {
          hasRecursiveOrFilter = true;
          continue;
        }
        if (token.startsWith('-')) continue;
        if (token === 'run') {
          expectRunScript = true;
          continue;
        }
        subcmd = token;
        break;
      }
      if (!hasRecursiveOrFilter && subcmd && !PNPM_BUILTINS.has(subcmd)) {
        scriptRefs.push(subcmd);
      }
    }
  }

  return { fileTargets, filterTargets, scriptRefs };
}

test('omnimux.mjs path 输出 monorepo 的 plugins 产品树与 app 目录', () => {
  const repoRoot = resolve(root, '..');
  const result = spawnSync(process.execPath, [join(root, 'scripts/omnimux.mjs'), 'path'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`product: ${root}\n`), result.stdout);
  assert.ok(result.stdout.includes(`plugins: ${join(root, 'plugins')}\n`), result.stdout);
  assert.ok(result.stdout.includes(`fork: ${join(repoRoot, 'app')}\n`), result.stdout);
});

test('plugins/package.json scripts exclude retired craft/missing filters and resolve existing targets', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};
  const workspacePackages = listWorkspacePackageNames(root);

  assert.equal('test:craft' in scripts, false, 'retired test:craft script must not remain in plugins/package.json');
  assert.equal('verify:craft' in scripts, false, 'retired verify:craft script must not remain in plugins/package.json');
  assert.equal(existsSync(join(root, 'scripts', 'verify-craft.mjs')), false, 'verify-craft.mjs must be removed');

  const missingFiles = [];
  const missingFilters = [];
  const missingScriptRefs = [];

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(typeof command, 'string', `plugins/package.json script "${name}" must be a string`);
    assert.doesNotMatch(command, /verify-craft\.mjs/u, `script "${name}" must not reference retired verify-craft.mjs`);

    const { fileTargets, filterTargets, scriptRefs } = inspectPluginsPackageCommand(command);
    for (const target of fileTargets) {
      if (target.includes('*')) {
        const dirPath = resolve(root, dirname(target));
        if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
          missingFiles.push(`${name} -> ${target}`);
        }
      } else {
        const fullPath = resolve(root, target);
        if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
          missingFiles.push(`${name} -> ${target}`);
        }
      }
    }
    for (const pkgName of filterTargets) {
      if (!workspacePackages.has(pkgName)) {
        missingFilters.push(`${name} -> --filter ${pkgName}`);
      }
    }
    for (const ref of scriptRefs) {
      if (!(ref in scripts)) {
        missingScriptRefs.push(`${name} -> pnpm ${ref}`);
      }
    }
  }

  assert.deepEqual(missingFiles, [], `plugins/package.json scripts reference missing local files:\n${missingFiles.join('\n')}`);
  assert.deepEqual(missingFilters, [], `plugins/package.json scripts filter non-existent workspace packages:\n${missingFilters.join('\n')}`);
  assert.deepEqual(missingScriptRefs, [], `plugins/package.json scripts invoke undefined pnpm scripts:\n${missingScriptRefs.join('\n')}`);
});
