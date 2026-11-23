import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const unitFiles = readdirSync('src/media-viewer')
  .filter((file) => file.endsWith('.test.js') && !file.endsWith('.e2e.test.js'))
  .map((file) => `src/media-viewer/${file}`);
const hostTests = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`);

const result = spawnSync(process.execPath, ['--test', ...unitFiles, ...hostTests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
