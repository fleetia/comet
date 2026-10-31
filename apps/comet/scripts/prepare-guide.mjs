import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');
const guideBuild = join(workspaceRoot, 'apps/guide/build');
const destination = join(appRoot, 'src-tauri/guide');

const result = spawnSync('pnpm', ['--filter', '@comet/guide', 'build'], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

mkdirSync(destination, { recursive: true });
for (const entry of readdirSync(destination)) {
  if (entry !== '.gitkeep') rmSync(join(destination, entry), { recursive: true, force: true });
}
cpSync(guideBuild, destination, { recursive: true });
