import { Marked } from 'marked';

export function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function readFrontmatter(source, filename) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${filename}: frontmatter가 없어요`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(id|title):\s*(.*?)\s*$/);
    if (field) {
      if (fields[field[1]] !== undefined) throw new Error(`${filename}: ${field[1]}가 중복돼요`);
      fields[field[1]] = field[2].replace(/^(["'])(.*)\1$/, '$2').trim();
    }
  }
  if (!fields.id) throw new Error(`${filename}: id가 없어요`);
  if (!fields.title) throw new Error(`${filename}: title이 없어요`);
  return { ...fields, body: source.slice(match[0].length) };
}

export function headingId(text) {
  return text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
}

export function getHeadings(body, filename) {
  const marked = new Marked();
  const headings = [];
  const parser = new marked.Parser();
  marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type !== 'heading' || token.depth !== 2) return;
    const text = parser.parseInline(token.tokens, parser.textRenderer);
    const id = headingId(text);
    if (!id || headings.some((heading) => heading.id === id)) throw new Error(`${filename}: h2 id가 비었거나 중복돼요: ${id}`);
    headings.push({ id, text });
  });
  return headings;
}

export function convertLink(href, currentId, pages, filename) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
  const match = href.match(/^(?:(?:\.\/)?([\w-]+)\.md)?(?:#(.*))?$/);
  if (!match || (!match[1] && !href.startsWith('#'))) throw new Error(`${filename}: 알 수 없는 내부 링크 ${href}`);
  const target = match[1] || currentId;
  if (!pages.has(target)) throw new Error(`${filename}: 없는 페이지 링크 ${href}`);
  if (match[2] !== undefined) {
    let fragment;
    try { fragment = decodeURIComponent(match[2]); } catch { throw new Error(`${filename}: 잘못된 제목 링크 ${href}`); }
    if (!pages.get(target).some((heading) => heading.id === fragment)) throw new Error(`${filename}: 없는 제목 링크 ${href}`);
  }
  return `${match[1] ? `${target}.html` : ''}${match[2] !== undefined ? `#${match[2]}` : ''}`;
}

export function renderMarkdown(body, currentId, pages, filename) {
  const marked = new Marked({
    walkTokens(token) {
      if (token.type === 'link') token.href = convertLink(token.href, currentId, pages, filename);
    },
    renderer: {
      html(token) { return escapeHtml(token.text); },
      heading(token) {
        if (token.depth !== 2) return false;
        const text = this.parser.parseInline(token.tokens, this.parser.textRenderer);
        return `<h2 id="${escapeHtml(headingId(text))}">${this.parser.parseInline(token.tokens)}</h2>\n`;
      },
    },
  });
  return marked.parse(body).replace(/<table>[\s\S]*?<\/table>/g, (table) => `<div class="table-scroll">${table}</div>`);
}

export function renderToc(headings) {
  return `<nav class="toc" aria-label="이 페이지 목차"><p>이 페이지 목차</p><ul>${headings.map(({ id, text }) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(text)}</a></li>`).join('')}</ul></nav>`;
}
