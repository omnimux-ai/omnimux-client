/**
 * W1 视觉验收 harness（T1.3）：构建 dev-only 画布 bundle 并起静态服务器。
 *
 * 用法：node scripts/canvas-harness.mjs [--port 4817]
 * 打开：http://localhost:<port>/
 *
 * 页面 = 画布 + mock catalog + mock execution 注入 + locale/暗色开关，
 * 是 W1 视觉验收的唯一事实源（计划 §8）。不进官方 harness，不碰生产 bundle。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realNode, nodeEnv } from './resolve-node.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 4817;

const INDEX_HTML = `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>omnimux-workflow canvas harness (W4)</title>
  <style>html, body, #root { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script src="/canvas-harness.js"></script>
</body>
</html>
`;

function build() {
  return new Promise((resolve, reject) => {
    const child = spawn(realNode(), [join('scripts', 'build-canvas.mjs'), '--harness'], {
      cwd: root,
      stdio: 'inherit',
      env: nodeEnv(),
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
  });
}

await build();

const bundlePath = join(root, 'dist-harness', 'canvas-harness.js');

const server = createServer((req, res) => {
  if (req.url === '/canvas-harness.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(bundlePath));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(INDEX_HTML);
});

server.listen(PORT, () => {
  console.log(`canvas harness: http://localhost:${PORT}/`);
});

// 源变更自动重建（手动刷新页面生效）。
let timer = null;
watch(join(root, 'src', 'canvas'), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    build().catch((error) => console.error('[harness rebuild]', error.message));
  }, 300);
});
