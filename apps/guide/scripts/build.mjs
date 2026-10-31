import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pageIds from '../pages.mjs';
import { escapeHtml, getHeadings, readFrontmatter, renderMarkdown, renderToc } from './markdown.mjs';

const guideDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(guideDir, '../..');
const themeScript = `try{const t=localStorage.getItem('guide-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}`;

function pageNavigation(pages, current) {
  return `<nav class="page-nav" aria-label="안내서 목록"><ul>${pages.map((page) => `<li><a href="${page.id}.html"${page.id === current ? ' aria-current="page"' : ''}>${escapeHtml(page.title)}</a></li>`).join('')}</ul></nav>`;
}

function renderPage(page, pages, headings) {
  const navigation = pageNavigation(pages, page.id);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} - comet 안내서</title>
<script>${themeScript}</script>
<link rel="stylesheet" href="guide.css">
<script defer src="guide.js"></script>
</head>
<body>
<a class="skip-link" href="#main">본문으로 건너뛰기</a>
<header class="site-header"><div><a class="brand" href="first-meeting.html">comet</a><span>안내서</span></div><button class="theme-toggle" type="button" aria-label="낮과 밤 전환"><span class="theme-light">낮</span><span class="theme-dark">밤</span></button></header>
<div class="layout">
<aside class="sidebar">${navigation}</aside>
<details class="mobile-nav"><summary>안내서 목록</summary>${navigation}</details>
<main class="content" id="main"><article><h1>${escapeHtml(page.title)}</h1>${renderMarkdown(page.body, page.id, headings, `${page.id}.md`)}</article></main>
${renderToc(headings.get(page.id))}
</div>
</body>
</html>\n`;
}

export async function build({ sourceDir = guideDir, outputDir = path.join(guideDir, 'build'), ids = pageIds, tokenFile = path.join(rootDir, 'ds/token/styles.css'), fontDir = path.join(rootDir, 'apps/comet/public/fonts/ibmplexsanskr') } = {}) {
  await rm(outputDir, { recursive: true, force: true });
  const docsDir = path.join(sourceDir, 'docs');
  const filenames = (await readdir(docsDir)).filter((name) => name.endsWith('.md')).sort();
  const expected = ids.map((id) => `${id}.md`).sort();
  const unexpected = filenames.filter((filename) => !expected.includes(filename));
  const missing = expected.filter((filename) => !filenames.includes(filename));
  if (unexpected.length || missing.length || new Set(ids).size !== ids.length) throw new Error(`페이지 목록이 docs와 달라요: ${[...missing, ...unexpected].join(', ') || ids.join(', ')}`);
  const pages = await Promise.all(ids.map(async (id) => {
    const filename = `${id}.md`;
    const page = readFrontmatter(await readFile(path.join(docsDir, filename), 'utf8'), filename);
    if (page.id !== id) throw new Error(`${filename}: frontmatter id가 파일 이름과 달라요`);
    return page;
  }));
  const headings = new Map(pages.map((page) => [page.id, getHeadings(page.body, `${page.id}.md`)]));
  const renderedPages = pages.map((page) => ({ id: page.id, html: renderPage(page, pages, headings) }));
  const tokens = await readFile(tokenFile, 'utf8');
  const light = tokens.match(/\[data-comet-theme="light"\]\s*\{([^}]*)\}/)?.[1];
  const dark = tokens.match(/\[data-comet-theme="dark"\]\s*\{([^}]*)\}/)?.[1];
  if (!light || !dark) throw new Error(`${tokenFile}: 낮/밤 토큰이 없어요`);
  const css = `${tokens}\n:root {${light}}\n:root[data-theme="dark"] {${dark}}\n@media (prefers-color-scheme: dark) { :root:not([data-theme]) {${dark}} }\n${await readFile(path.join(sourceDir, 'src/guide.css'), 'utf8')}`;
  const js = await readFile(path.join(sourceDir, 'src/guide.js'), 'utf8');
  await mkdir(path.join(outputDir, 'fonts'), { recursive: true });
  await Promise.all([
    ...renderedPages.map(({ id, html }) => writeFile(path.join(outputDir, `${id}.html`), html)),
    writeFile(path.join(outputDir, 'index.html'), '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=first-meeting.html"><title>comet 안내서</title></head><body><a href="first-meeting.html">안내서 처음으로</a></body></html>\n'),
    writeFile(path.join(outputDir, 'guide.css'), css),
    writeFile(path.join(outputDir, 'guide.js'), js),
    ...['IBMPlexSansKR-Regular.ttf', 'IBMPlexSansKR-SemiBold.ttf'].map((font) => cp(path.join(fontDir, font), path.join(outputDir, 'fonts', font))),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
