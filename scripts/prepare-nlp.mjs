import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const targets = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', kiwi: ['kiwi_mac_arm64_v0.24.0.tgz', 41310974, '87eda17f319c371824d5a2cc2e497eda6327ba3ddbf08a018db967f61ddbe48d'],
    ort: ['onnxruntime-osx-arm64-1.22.0.tgz', 25943843, 'cab6dcbd77e7ec775390e7b73a8939d45fec3379b017c7cb74f5b204c1a1cc07'] },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', kiwi: ['kiwi_win_x64_v0.24.0.zip', 38138308, 'd876d04cfff71dd4042f6964e1b950378fcb306234ac0258c4020cd23d9c4204'],
    ort: ['onnxruntime-win-x64-1.22.0.zip', 72368545, '174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da'] },
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error('NLP release targets are macOS arm64 and Windows x64.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binaries = join(root, 'src-tauri', 'binaries');
const runtime = join(binaries, 'nlp-runtime');
const temporary = await mkdtemp(join(tmpdir(), 'comet-nlp-'));
const cache = process.env.COMET_NLP_CACHE;
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
async function archive(repo, release, descriptor) {
  const [name, size, sha] = descriptor;
  let bytes;
  if (cache) {
    try { bytes = await readFile(join(cache, name)); } catch { /* Fetch missing cache entries. */ }
  }
  if (!bytes) {
    const response = await fetch(`https://github.com/${repo}/releases/download/${release}/${name}`, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`NLP runtime download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error(`NLP runtime integrity mismatch: ${name}`);
  const path = join(temporary, name); await writeFile(path, bytes);
  const extracted = join(temporary, `${repo.split('/')[1]}-extracted`); await mkdir(extracted);
  execFileSync('tar', ['-xf', path, '-C', extracted], { stdio: 'inherit' });
  return files(extracted);
}
async function windowsCrtFiles() {
  let redist = process.env.VCToolsRedistDir;
  if (!redist) {
    const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const installation = execFileSync(vswhere, ['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'], { encoding:'utf8' }).trim();
    if (!installation) throw new Error('Visual Studio C++ redistributables are required to package ONNX Runtime.');
    const root = join(installation,'VC','Redist','MSVC');
    const versions = (await readdir(root)).filter(name => /^\d+\.\d+\./.test(name)).sort((a,b) => b.localeCompare(a,undefined,{numeric:true}));
    if (!versions.length) throw new Error('Visual Studio C++ redistributables were not found.');
    redist = join(root,versions[0]);
  }
  const available = await files(join(redist,'x64'));
  const required = ['msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll'];
  return required.map(name => {
    const file = available.find(path => basename(path).toLowerCase()===name && /Microsoft\.VC\d+\.CRT/i.test(path));
    if (!file) throw new Error(`Required ONNX Runtime dependency ${name} was not found in Visual Studio redistributables.`);
    return file;
  });
}

try {
  const kiwiFiles = await archive('bab2min/Kiwi', 'v0.24.0', target.kiwi);
  const ortFiles = await archive('microsoft/onnxruntime', 'v1.22.0', target.ort);
  const stage = join(temporary, 'runtime'); await mkdir(stage);
  const isLibrary = path => process.platform === 'win32' ? /\.dll$/i.test(path) : ['libkiwi.dylib','libonnxruntime.dylib'].includes(basename(path));
  for (const file of [...kiwiFiles, ...ortFiles].filter(isLibrary)) await copyFile(file, join(stage, basename(file)));
  if (process.platform === 'win32') {
    const candidate = (await readdir(stage)).find(name => /^kiwi.*\.dll$/i.test(name));
    if (!candidate) throw new Error('Kiwi runtime DLL missing.');
    if (candidate !== 'kiwi.dll') await copyFile(join(stage,candidate),join(stage,'kiwi.dll'));
  }
  const crt = [];
  if (process.platform === 'win32') {
    for (const file of await windowsCrtFiles()) {
      await copyFile(file,join(stage,basename(file)));
      crt.push({name:basename(file),size:(await stat(file)).size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
    }
  }
  const licenseFiles = ortFiles.filter(path => /(?:LICENSE|ThirdPartyNotices)\.?(?:txt)?$/i.test(basename(path)));
  for (const path of licenseFiles) await copyFile(path,join(stage,`onnxruntime-${basename(path)}`));
  for (const [name,url] of [
    ['Kiwi-LICENSE', 'https://raw.githubusercontent.com/bab2min/Kiwi/v0.24.0/LICENSE'],
    ['Kiwi-NOTICE', 'https://raw.githubusercontent.com/bab2min/Kiwi/v0.24.0/NOTICE'],
  ]) {
    const response = await fetch(url,{signal:AbortSignal.timeout(30_000)});
    if (response.ok) await writeFile(join(stage,name),await response.text());
    else throw new Error(`Pinned ${name} unavailable.`);
  }
  await writeFile(join(stage,'release.json'),JSON.stringify({schema:1,kiwi:{version:'0.24.0',archive:target.kiwi},ort:{version:'1.22.0',archive:target.ort},visualCppRedistributables:crt},null,2)+'\n');
  execFileSync(process.env.CARGO || 'cargo', ['build','--release','--locked','--manifest-path',join(root,'crates','comet-nlp','Cargo.toml')],{stdio:'inherit'});
  await mkdir(binaries,{recursive:true});
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const executable = join(binaries,`comet-nlp-${target.triple}${suffix}`);
  await copyFile(join(root,'crates','comet-nlp','target','release',`comet-nlp${suffix}`),executable);
  await chmod(executable,0o755);
  // NLP has its own directory: prepare-sidecar's llama runtime cleanup cannot erase it.
  await rm(runtime,{recursive:true,force:true}); await mkdir(runtime,{recursive:true});
  for (const file of await files(stage)) await copyFile(file,join(runtime,basename(file)));
  if (process.platform === 'darwin') {
    for (const file of (await files(runtime)).filter(isLibrary)) execFileSync('codesign',['--force','--sign','-',file]);
    execFileSync('codesign',['--force','--sign','-',executable]);
  }
  console.info(`Prepared comet-nlp and pinned CPU libraries for ${target.triple}. Models are independent downloads.`);
} finally { await rm(temporary,{recursive:true,force:true}); }
