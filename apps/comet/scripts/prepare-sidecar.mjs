import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sidecarRelease as release, sidecarTargets as targets, verifyArchive, isSidecarLibrary, copyRuntimeFiles } from './native-runtime.mjs';

const selected = `${process.platform}-${process.arch}${process.argv.includes('--vulkan') ? '-vulkan' : ''}`;
const target = targets[selected];
if (!target) throw new Error('Supported hosts: macOS arm64, Windows x64, or Linux x64 CPU (--vulkan optional on Windows only).');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, 'src-tauri', 'binaries');
const temporary = await mkdtemp(join(tmpdir(), 'comet-sidecar-'));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
try {
  const name = `llama-${release}-bin-${target.asset}`;
  let bytes;
  if (process.env.COMET_SIDECAR_CACHE) {
    try { bytes = await readFile(join(process.env.COMET_SIDECAR_CACHE, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!bytes) {
    const response = await fetch(`https://github.com/ggml-org/llama.cpp/releases/download/${release}/${name}`, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Sidecar download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyArchive(bytes, name, target.size, target.sha);
  const archive = join(temporary, name);
  await writeFile(archive, bytes);
  const extracted = join(temporary, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' });
  const entries = await files(extracted);
  const executable = entries.find(path => path.endsWith(process.platform === 'win32' ? '/llama-server.exe' : '/llama-server') || path.endsWith('\\llama-server.exe'));
  if (!executable) throw new Error('Release archive did not contain llama-server.');
  await rm(join(destination, 'runtime'), { recursive: true, force: true });
  await mkdir(join(destination, 'runtime'), { recursive: true });
  const output = join(destination, `llama-server-${target.triple}${process.platform === 'win32' ? '.exe' : ''}`);
  await copyFile(executable, output);
  await chmod(output, 0o755);
  const libraries = entries.filter(file => isSidecarLibrary(file.split(/[/\\]/).at(-1), process.platform));
  await copyRuntimeFiles(libraries, join(destination, 'runtime'), process.platform);
  if (process.platform === 'darwin') {
    // Hardened executables ignore DYLD_LIBRARY_PATH; encode both bundle and dev layouts.
    execFileSync('install_name_tool', ['-add_rpath', '@executable_path/../Resources/runtime', '-add_rpath', '@executable_path/runtime', output]);
    const libraries = (await readdir(join(destination, 'runtime'))).filter(name => name.endsWith('.dylib'));
    for (const library of libraries) {
      execFileSync('codesign', ['--force', '--sign', '-', join(destination, 'runtime', library)]);
    }
    execFileSync('codesign', ['--force', '--sign', '-', output]);
  }
  const licenseResponse = await fetch(`https://raw.githubusercontent.com/ggml-org/llama.cpp/${release}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
  if (!licenseResponse.ok) throw new Error('Could not obtain the pinned llama.cpp distribution license.');
  await writeFile(join(destination, 'runtime', 'llama.cpp-LICENSE.txt'), await licenseResponse.text());
  await writeFile(join(destination, 'runtime', 'release.json'), JSON.stringify({ release, asset: name, size: target.size, sha256: target.sha }, null, 2));
  console.info(`Prepared ${release} for ${target.triple}; runtime libraries are bundled separately.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
