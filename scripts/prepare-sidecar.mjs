import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const release = 'b10970';
const targets = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', asset: 'macos-arm64.tar.gz', sha: '7fa278a70b90afae3c3e5dd33553d4d11ebfde62725a03ff2fe6f0d3d1e29b59' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', asset: 'win-cpu-x64.zip', sha: '2c6d6516c04e95caa080d8eb917743e71858c73985acbb6739ad61b14e68b298' },
  'win32-x64-vulkan': { triple: 'x86_64-pc-windows-msvc', asset: 'win-vulkan-x64.zip', sha: 'f17091a433feb686d9e17378a8a2fc53a1437d64c1bf302ab6fb3072b4afcf0d' },
};
const selected = `${process.platform}-${process.arch}${process.argv.includes('--vulkan') ? '-vulkan' : ''}`;
const target = targets[selected];
if (!target) throw new Error('Supported hosts: macOS arm64 or Windows x64 (--vulkan optional on Windows).');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, 'src-tauri', 'binaries');
const temporary = await mkdtemp(join(tmpdir(), 'nanika-sidecar-'));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
try {
  const name = `llama-${release}-bin-${target.asset}`;
  const response = await fetch(`https://github.com/ggml-org/llama.cpp/releases/download/${release}/${name}`, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Sidecar download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== target.sha) throw new Error('Sidecar release SHA-256 mismatch.');
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
  for (const file of entries) {
    const base = file.split(/[/\\]/).at(-1);
    const needed = process.platform === 'darwin' ? /(?:\.0\.dylib|libllama-server-impl\.dylib|\.metal|\.metallib)$/.test(base) && !/\.\d+\.\d+\.\d+\.dylib$/.test(base) : /\.(dll|metal|metallib)$/i.test(base);
    if (needed) await copyFile(file, join(destination, 'runtime', base));
  }
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
  await writeFile(join(destination, 'runtime', 'release.json'), JSON.stringify({ release, asset: name, sha256: target.sha }, null, 2));
  console.info(`Prepared ${release} for ${target.triple}; runtime libraries are bundled separately.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
