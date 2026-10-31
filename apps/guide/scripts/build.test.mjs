import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from './build.mjs';
import { convertLink, getHeadings, readFrontmatter, renderMarkdown, renderToc } from './markdown.mjs';

const pages = new Map([['first', [{ id: '첫-제목', text: '첫 제목' }]], ['other', [{ id: '다른-제목', text: '다른 제목' }]]]);

test('frontmatter에서 id와 title을 읽고 필수 항목을 검사한다', () => {
  assert.deepEqual(readFrontmatter('---\nid: first\ntitle: 첫 만남\n---\n본문', 'first.md'), { id: 'first', title: '첫 만남', body: '본문' });
  assert.throws(() => readFrontmatter('---\nid: first\ntitle: \n---\n본문', 'first.md'), /first\.md.*title/);
  assert.throws(() => readFrontmatter('본문', 'first.md'), /first\.md.*frontmatter/);
});

test('문서 링크와 현재 페이지 제목 링크를 변환하고 존재 여부를 검사한다', () => {
  assert.equal(convertLink('other.md', 'first', pages, 'first.md'), 'other.html');
  assert.equal(convertLink('other.md#다른-제목', 'first', pages, 'first.md'), 'other.html#다른-제목');
  assert.equal(convertLink('#첫-제목', 'first', pages, 'first.md'), '#첫-제목');
  assert.throws(() => convertLink('missing.md', 'first', pages, 'first.md'), /first\.md.*없는 페이지/);
  assert.throws(() => convertLink('other.md#없음', 'first', pages, 'first.md'), /first\.md.*없는 제목/);
});

test('한글 제목 ID와 목차를 만들고 같은 ID를 거부한다', () => {
  const headings = getHeadings('## 첫 제목\n\n## **다른 제목**\n', 'first.md');
  assert.deepEqual(headings, [{ id: '첫-제목', text: '첫 제목' }, { id: '다른-제목', text: '다른 제목' }]);
  assert.match(renderToc(headings), /href="#첫-제목">첫 제목/);
  assert.throws(() => getHeadings('## 같은 제목\n\n## 같은 제목!\n', 'first.md'), /first\.md.*중복/);
});

test('Markdown 안의 HTML을 이스케이프하고 링크를 바꾼다', () => {
  const html = renderMarkdown('## 첫 제목\n\n<script>alert(1)</script>\n\n[다음](other.md#다른-제목)', 'first', pages, 'first.md');
  assert.match(html, /<h2 id="첫-제목">첫 제목<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="other.html#%EB%8B%A4%EB%A5%B8-%EC%A0%9C%EB%AA%A9"/);
  assert.doesNotMatch(html, /<script>/);
  assert.throws(() => renderMarkdown('[없음](missing.md)', 'first', pages, 'first.md'), /first\.md.*없는 페이지/);
});

test('전체 빌드는 실제 페이지와 상대 경로 자산을 만든다', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'comet-guide-'));
  try {
    await build({ outputDir: tempDir });
    const files = (await readdir(tempDir)).sort();
    assert.deepEqual(files, ['ai.html', 'diary-memory.html', 'first-meeting.html', 'fonts', 'friends.html', 'glossary.html', 'guide.css', 'guide.js', 'index.html', 'packs.html', 'privacy.html', 'rhythm.html', 'talking.html', 'troubleshooting.html', 'widgets.html']);
    assert.deepEqual((await readdir(path.join(tempDir, 'fonts'))).sort(), ['IBMPlexSansKR-Regular.ttf', 'IBMPlexSansKR-SemiBold.ttf']);
    for (const filename of files.filter((file) => file.endsWith('.html'))) {
      const html = await readFile(path.join(tempDir, filename), 'utf8');
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const url = match[1];
        if (/^(?:https?:|mailto:)/.test(url)) continue; // External links are navigation, never assets.
        assert.doesNotMatch(url, /^\//, `${filename}: ${url}`);
        if (!url.startsWith('#')) assert.ok(files.includes(url.split('#')[0]), `${filename}: ${url}`);
      }
      assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\/[^\"]+\.(?:css|js|ttf)/);
    }
    const css = await readFile(path.join(tempDir, 'guide.css'), 'utf8');
    assert.doesNotMatch(css, /url\(["']?(?:\/|https?:)/);
    const index = await readFile(path.join(tempDir, 'index.html'), 'utf8');
    assert.match(index, /http-equiv="refresh" content="0; url=first-meeting\.html"/);
    assert.doesNotMatch(index, /<script/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('파일과 페이지 목록이 다르거나 파일 이름과 id가 다르면 빌드가 실패한다', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'comet-guide-invalid-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    const sourceDir = path.join(tempDir, 'guide');
    await mkdir(path.join(sourceDir, 'docs'), { recursive: true });
    await writeFile(path.join(sourceDir, 'docs/first.md'), '---\nid: wrong\ntitle: 첫 페이지\n---\n## 제목\n');
    await assert.rejects(build({ sourceDir, ids: ['first', 'missing'], outputDir: path.join(tempDir, 'out') }), /missing\.md/);
    await assert.rejects(build({ sourceDir, ids: ['first'], outputDir: path.join(tempDir, 'out') }), /first\.md.*id/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
