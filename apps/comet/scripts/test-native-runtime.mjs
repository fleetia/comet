import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, lstat, readlink, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sidecarRelease, sidecarTargets, nlpTargets, verifyArchive, isSidecarLibrary, isNlpLibrary, copyRuntimeFiles } from './native-runtime.mjs';

test('Linux preparation selects pinned x86_64 CPU releases without changing existing hosts', () => {
  assert.equal(sidecarRelease, 'b10970');
  assert.deepEqual(sidecarTargets['linux-x64'], {
    triple: 'x86_64-unknown-linux-gnu', asset: 'ubuntu-x64.tar.gz', size: 16845010,
    sha: '923d35d37e8975bac09f5fd39c73b16a69c5d5ba122ef122fb4926ff4605ea54',
  });
  assert.equal(nlpTargets['linux-x64'].triple, sidecarTargets['linux-x64'].triple);
  assert.deepEqual(nlpTargets['linux-x64'].kiwi, ['kiwi_lnx_x86_64_v0.24.0.tgz', 75078544, '577768800258154da5fe6665081c73dafd6a0c39c8e091325d2b2bef8b5fb5d8']);
  assert.deepEqual(nlpTargets['linux-x64'].ort, ['onnxruntime-linux-x64-1.22.0.tgz', 7798730, '8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3']);
  assert.equal(sidecarTargets['darwin-arm64'].asset, 'macos-arm64.tar.gz');
  assert.equal(sidecarTargets['win32-x64'].asset, 'win-cpu-x64.zip');
  assert.equal(sidecarTargets['win32-x64-vulkan'].asset, 'win-vulkan-x64.zip');
  assert.equal(sidecarTargets['linux-x64-vulkan'], undefined);
  assert.equal(sidecarTargets['linux-arm64'], undefined);
  assert.equal(nlpTargets['linux-arm64'], undefined);
});

test('every release descriptor pins both byte count and SHA-256', () => {
  for (const { size, sha } of Object.values(sidecarTargets)) {
    assert.ok(Number.isSafeInteger(size) && size > 0);
    assert.match(sha, /^[a-f0-9]{64}$/);
  }
  for (const { kiwi, ort } of Object.values(nlpTargets)) {
    for (const [name, size, sha] of [kiwi, ort]) {
      assert.ok(name && Number.isSafeInteger(size) && size > 0);
      assert.match(sha, /^[a-f0-9]{64}$/);
    }
  }
});

test('archive verification rejects wrong sizes and hashes, including cached bytes', () => {
  const bytes = Buffer.from('verified release bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.doesNotThrow(() => verifyArchive(bytes, 'release.tgz', bytes.length, sha));
  assert.throws(() => verifyArchive(bytes, 'release.tgz', bytes.length + 1, sha), /integrity mismatch: release.tgz/);
  assert.throws(() => verifyArchive(bytes, 'release.tgz', bytes.length, '0'.repeat(64)), /integrity mismatch/);
});

test('llama Linux libraries include SONAME aliases and CPU backends, excluding non-runtime files', () => {
  for (const name of ['libllama-server-impl.so', 'libllama.so', 'libllama.so.0', 'libllama.so.0.4.1', 'libggml-cpu-x64.so']) {
    assert.equal(isSidecarLibrary(name, 'linux'), true, name);
  }
  for (const name of ['llama-server', 'libllama.a', 'libllama.so.debug', 'libllama.dylib', 'LICENSE']) {
    assert.equal(isSidecarLibrary(name, 'linux'), false, name);
  }
});

test('NLP Linux libraries retain load names, SONAMEs and the ORT provider library only', () => {
  for (const name of ['libkiwi.so', 'libkiwi.so.0', 'libkiwi.so.0.24.0', 'libonnxruntime.so', 'libonnxruntime.so.1.22.0', 'libonnxruntime_providers_shared.so']) {
    assert.equal(isNlpLibrary(name, 'linux'), true, name);
  }
  for (const name of ['libkiwi_static.a', 'kiwi-cli-0.24.0', 'libunrelated.so', 'libonnxruntime.so.debug', 'libkiwi.dylib']) {
    assert.equal(isNlpLibrary(name, 'linux'), false, name);
  }
});

test('macOS and Windows keep their original runtime selection', () => {
  assert.equal(isSidecarLibrary('libllama.0.dylib', 'darwin'), true);
  assert.equal(isSidecarLibrary('libllama.0.4.1.dylib', 'darwin'), false);
  assert.equal(isSidecarLibrary('libllama-server-impl.dylib', 'darwin'), true);
  assert.equal(isSidecarLibrary('ggml-metal.metal', 'darwin'), true);
  assert.equal(isSidecarLibrary('ggml-cpu.DLL', 'win32'), true);
  assert.equal(isSidecarLibrary('libggml.so', 'win32'), false);
  assert.equal(isNlpLibrary('libkiwi.dylib', 'darwin'), true);
  assert.equal(isNlpLibrary('libonnxruntime.1.22.0.dylib', 'darwin'), false);
  assert.equal(isNlpLibrary('kiwi.DLL', 'win32'), true);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'comet-native-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); const destination = join(root, 'destination');
  await mkdir(source); await mkdir(destination);
  return { source, destination };
}

test('Linux staging preserves the complete relative SONAME chain without duplicating payloads', async t => {
  const { source, destination } = await fixture(t);
  await writeFile(join(source, 'libkiwi.so.0.24.0'), 'native library');
  await symlink('libkiwi.so.0.24.0', join(source, 'libkiwi.so.0'));
  await symlink('libkiwi.so.0', join(source, 'libkiwi.so'));
  await copyRuntimeFiles(['libkiwi.so', 'libkiwi.so.0', 'libkiwi.so.0.24.0'].map(name => join(source, name)), destination, 'linux');
  assert.equal((await lstat(join(destination, 'libkiwi.so'))).isSymbolicLink(), true);
  assert.equal(await readlink(join(destination, 'libkiwi.so.0')), 'libkiwi.so.0.24.0');
  assert.equal(await readFile(join(destination, 'libkiwi.so'), 'utf8'), 'native library');
});

test('macOS staging continues dereferencing library aliases', async t => {
  const { source, destination } = await fixture(t);
  await writeFile(join(source, 'libkiwi.0.dylib'), 'native library');
  await symlink('libkiwi.0.dylib', join(source, 'libkiwi.dylib'));
  await copyRuntimeFiles([join(source, 'libkiwi.dylib')], destination, 'darwin');
  assert.equal((await lstat(join(destination, 'libkiwi.dylib'))).isSymbolicLink(), false);
  assert.equal(await readFile(join(destination, 'libkiwi.dylib'), 'utf8'), 'native library');
});

test('Linux staging refuses absolute, outside and missing alias targets', async t => {
  const { source, destination } = await fixture(t);
  for (const [name, target] of [['absolute.so', '/tmp/elsewhere'], ['outside.so', '../libkiwi.so'], ['missing.so', 'not-staged.so']]) {
    await symlink(target, join(source, name));
    await assert.rejects(copyRuntimeFiles([join(source, name)], destination, 'linux'), /alias escapes staged files/);
  }
});

test('flattening refuses duplicate filenames rather than overwriting a library', async t => {
  const { source, destination } = await fixture(t);
  await assert.rejects(copyRuntimeFiles([join(source, 'libkiwi.so'), join(source, 'nested', 'libkiwi.so')], destination, 'linux'), /Duplicate native runtime basename/);
});
