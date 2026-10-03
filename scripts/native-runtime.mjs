import { createHash } from 'node:crypto';
import { copyFile, lstat, readlink, symlink } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

export const sidecarRelease = 'b10970';
// Sizes/digests come from the pinned upstream GitHub release assets.
export const sidecarTargets = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', asset: 'macos-arm64.tar.gz', size: 11149707, sha: '7fa278a70b90afae3c3e5dd33553d4d11ebfde62725a03ff2fe6f0d3d1e29b59' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', asset: 'win-cpu-x64.zip', size: 18428751, sha: '2c6d6516c04e95caa080d8eb917743e71858c73985acbb6739ad61b14e68b298' },
  'win32-x64-vulkan': { triple: 'x86_64-pc-windows-msvc', asset: 'win-vulkan-x64.zip', size: 31675940, sha: 'f17091a433feb686d9e17378a8a2fc53a1437d64c1bf302ab6fb3072b4afcf0d' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', asset: 'ubuntu-x64.tar.gz', size: 16845010, sha: '923d35d37e8975bac09f5fd39c73b16a69c5d5ba122ef122fb4926ff4605ea54' },
};
export const nlpTargets = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', kiwi: ['kiwi_mac_arm64_v0.24.0.tgz', 41310974, '87eda17f319c371824d5a2cc2e497eda6327ba3ddbf08a018db967f61ddbe48d'],
    ort: ['onnxruntime-osx-arm64-1.22.0.tgz', 25943843, 'cab6dcbd77e7ec775390e7b73a8939d45fec3379b017c7cb74f5b204c1a1cc07'] },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', kiwi: ['kiwi_win_x64_v0.24.0.zip', 38138308, 'd876d04cfff71dd4042f6964e1b950378fcb306234ac0258c4020cd23d9c4204'],
    ort: ['onnxruntime-win-x64-1.22.0.zip', 72368545, '174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da'] },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', kiwi: ['kiwi_lnx_x86_64_v0.24.0.tgz', 75078544, '577768800258154da5fe6665081c73dafd6a0c39c8e091325d2b2bef8b5fb5d8'],
    // ORT v1.22.0 predates release-API digests; this SHA-256 is measured from its official HTTPS asset.
    ort: ['onnxruntime-linux-x64-1.22.0.tgz', 7798730, '8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3'] },
};

export function verifyArchive(bytes, name, size, sha) {
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha) {
    throw new Error(`Native runtime integrity mismatch: ${name}`);
  }
}

export function isSidecarLibrary(name, platform) {
  if (platform === 'darwin') return /(?:\.0\.dylib|libllama-server-impl\.dylib|\.metal|\.metallib)$/.test(name) && !/\.\d+\.\d+\.\d+\.dylib$/.test(name);
  if (platform === 'linux') return /\.so(?:\.\d+)*$/.test(name);
  return /\.(dll|metal|metallib)$/i.test(name);
}

export function isNlpLibrary(name, platform) {
  if (platform === 'win32') return /\.dll$/i.test(name);
  if (platform === 'linux') return /^lib(?:kiwi|onnxruntime(?:_providers_shared)?)\.so(?:\.\d+)*$/.test(name);
  return ['libkiwi.dylib', 'libonnxruntime.dylib'].includes(name);
}

// Linux ELF SONAME aliases must survive flattening; copying every alias would
// duplicate tens of MB. Accept only sibling aliases whose target is also staged.
// Keep the existing dereferenced-copy behavior on macOS and Windows.
export async function copyRuntimeFiles(entries, destination, platform) {
  const names = new Set(entries.map(file => basename(file)));
  if (names.size !== entries.length) throw new Error('Duplicate native runtime basename.');
  const copies = [];
  for (const file of entries) {
    let link;
    if (platform === 'linux' && (await lstat(file)).isSymbolicLink()) {
      link = await readlink(file);
      if (isAbsolute(link) || basename(link) !== link || !names.has(link)) {
        throw new Error(`Native runtime alias escapes staged files: ${basename(file)}`);
      }
    }
    copies.push({ file, link });
  }
  for (const { file, link } of copies) {
    const output = join(destination, basename(file));
    if (link !== undefined) await symlink(link, output);
    else await copyFile(file, output);
  }
}
