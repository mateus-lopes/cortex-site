// Gera o site estático em dist/ a partir do vault cortex (só leitura).
// Cada pasta do menu vira uma seção; a nota com o nome da pasta é a página da seção.
// Blocos dataview viram tabelas geradas aqui; o que não der para interpretar some.
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { Marked } from 'marked';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');
const VAULT = path.resolve(ROOT, process.env.CONTENT_DIR ?? '../../cortex');

const SECTIONS = ['Finanças', 'Igreja', 'Projetos', 'Pessoal'];
// Sistema fica fora do menu; só estas partes viram página
const SISTEMA = ['Sistema', 'Sistema/Painéis'];
const ANEXOS = 'Sistema/Anexos';

const marked = new Marked({ gfm: true });
const WIKILINK = /(!?)\[\[([^\]|#]+?)\\?(?:#[^\]|]*)?(?:\\?\|([^\]]+))?\]\]/g;

// ---------- utilidades ----------

const nfc = (s) => s.normalize('NFC');
const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkTarget = (v) => (typeof v === 'string' ? v.match(/\[\[([^\]|#]+)/)?.[1]?.trim() : null);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function shortDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
const number = (n) => n.toLocaleString('pt-BR', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- leitura do vault ----------

function splitFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  return { data: parseYaml(m[1]) ?? {}, body: src.slice(m[0].length) };
}

async function readNote(file, rel) {
  const raw = (await readFile(file, 'utf8')).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const { data, body } = splitFrontmatter(raw);
  const name = nfc(path.basename(file, '.md'));
  const title = body.match(/^# (.+)$/m)?.[1]?.trim() ?? name;
  return { name, data, body, title, folder: nfc(path.dirname(rel).split(path.sep).join('/')) };
}

async function walk(dir, rel = '', recursive = true) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && recursive) out.push(...await walk(path.join(dir, e.name), r));
    else if (e.isFile()) out.push(nfc(r));
  }
  return out;
}

async function loadNotes() {
  const files = [];
  for (const s of SECTIONS) if (existsSync(path.join(VAULT, s))) files.push(...await walk(path.join(VAULT, s), s));
  for (const s of SISTEMA) files.push(...(await walk(path.join(VAULT, s), s, false)));
  const notes = [];
  for (const rel of files.filter((f) => f.endsWith('.md'))) {
    const n = await readNote(path.join(VAULT, rel), rel);
    const section = rel.split('/')[0];
    const isIndex = n.name === section && n.folder === section;
    const parts = [section, ...n.folder.split('/').slice(1), ...(isIndex ? [] : [n.name])];
    n.url = `/${parts.map(slugify).join('/')}/`;
    n.section = section;
    n.isIndex = isIndex;
    notes.push(n);
  }
  return notes;
}

// ---------- dataview (só o subconjunto usado no vault) ----------

const field = (note, key) => {
  if (key === 'file.link') return `[[${note.name}]]`;
  if (key === 'file.name') return note.name;
  return note.data[key];
};

function parseWhere(expr, self) {
  return expr.split(/\s+AND\s+/i).map((c) => {
    c = c.trim();
    let m;
    if ((m = c.match(/^!\s*([\wÀ-ſ.-]+)$/))) return (n) => !field(n, m[1]);
    if ((m = c.match(/^([\wÀ-ſ.-]+)\s*=\s*"([^"]*)"$/))) return (n) => String(field(n, m[1]) ?? '') === m[2];
    if ((m = c.match(/^contains\(list\(([^)]*)\),\s*([\wÀ-ſ.-]+)\)$/))) {
      const values = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      return (n) => values.includes(String(field(n, m[2]) ?? ''));
    }
    if ((m = c.match(/^contains\(([\wÀ-ſ.-]+),\s*this\.file\.link\)$/))) {
      return (n) => [field(n, m[1]) ?? []].flat().some((v) => nfc(linkTarget(v) ?? '') === self.name);
    }
    throw new Error(`WHERE não suportado: ${c}`);
  });
}

function compare(a, b) {
  const empty = (v) => v === undefined || v === null || v === '';
  if (empty(a) || empty(b)) return empty(a) - empty(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR');
}

function runDataview(query, self, notes) {
  const q = query.replace(/\s+/g, ' ').trim();
  const m = q.match(/^TABLE WITHOUT ID (.+?) FROM "([^"]+)"(?: WHERE (.+?))?(?: GROUP BY ([\wÀ-ſ.-]+))?(?: SORT (.+))?$/i);
  if (!m) throw new Error('consulta não suportada');
  const [, colsSrc, from, where, groupBy, sort] = m;
  const cols = colsSrc.split(/,(?![^(]*\))/).map((c) => {
    const [, expr, label] = c.trim().match(/^(.+?)(?: AS "([^"]+)")?$/);
    return { expr: expr.trim(), label: label ?? expr.trim() };
  });
  const filters = where ? parseWhere(where, self) : [];
  let rows = notes.filter((n) => (n.folder === from || n.folder.startsWith(`${from}/`)) && filters.every((f) => f(n)));
  const sorts = sort ? sort.split(',').map((s) => { const [k, dir] = s.trim().split(/\s+/); return { k, desc: /desc/i.test(dir ?? '') }; }) : [];

  let get = (row, expr) => field(row, expr);
  if (groupBy) {
    const groups = new Map();
    for (const n of rows) {
      const key = field(n, groupBy) ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    rows = [...groups].map(([key, items]) => ({ key, items }));
    get = (row, expr) => (expr === groupBy ? row.key : expr.startsWith('rows.') ? row.items.map((n) => field(n, expr.slice(5))) : undefined);
  }
  rows.sort((a, b) => {
    for (const { k, desc } of sorts) {
      const c = compare(get(a, k), get(b, k));
      if (c) return desc ? -c : c;
    }
    return 0;
  });
  if (!rows.length) return '<p class="empty">Nada por aqui.</p>';
  const cell = (v) => (Array.isArray(v) ? v.map(inlineValue).join(', ') : inlineValue(v));
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(get(r, c.expr))}</td>`).join('')}</tr>`).join('\n')}</tbody></table></div>`;
}

// Valor de frontmatter em HTML: wikilink vira link, número no formato brasileiro, data curta
let LINKS = new Map();
function inlineValue(v) {
  if (v === undefined || v === null || v === '') return '<span class="muted">—</span>';
  if (typeof v === 'number') return number(v);
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.map(inlineValue).join(', ');
  if (typeof v === 'object') return escapeHtml(JSON.stringify(v));
  const s = String(v);
  if (isDate(s)) return escapeHtml(shortDate(s));
  if (/^https?:\/\/\S+$/.test(s)) return `<a href="${escapeHtml(s)}" rel="noopener">${escapeHtml(s.replace(/^https?:\/\//, ''))}</a>`;
  return marked.parseInline(resolveWikilinks(escapeHtml(s)));
}

// ---------- markdown do Obsidian -> HTML ----------

const attachments = new Map(); // nome do arquivo -> caminho relativo dentro de Anexos
const usedAttachments = new Set();

function resolveWikilinks(md) {
  // Link só para um título da própria nota ([[#Seção]]) vira texto
  md = md.replace(/\[\[#([^\]|]+)(?:\\?\|([^\]]+))?\]\]/g, (_, h, label) => label ?? h);
  return md.replace(WIKILINK, (_, bang, target, label) => {
    target = target.trim();
    if (bang && attachments.has(nfc(target))) {
      usedAttachments.add(nfc(target));
      const width = /^\d+$/.test(label ?? '') ? ` width="${label}"` : '';
      return `<img src="/anexos/${attachments.get(nfc(target)).split('/').map(encodeURIComponent).join('/')}" alt=""${width} loading="lazy">`;
    }
    const text = (label?.trim() && !/^\d+$/.test(label)) ? label.trim() : target;
    const hit = LINKS.get(nfc(target));
    return hit ? `[${text.replace(/[[\]]/g, '\\$&')}](${hit.url})` : text;
  });
}

function extractBlocks(md, blocks, note, notes) {
  // dataview -> tabela gerada (ou some)
  md = md.replace(/```dataview\n([\s\S]*?)```\n?/g, (_, q) => {
    try {
      blocks.push(runDataview(q, note, notes));
      return `\n@@BLOCK${blocks.length - 1}@@\n`;
    } catch (e) {
      console.warn(`  dataview ignorado em ${note.name}: ${e.message}`);
      return '';
    }
  });
  // callouts (> [!tipo] Título)
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^>\s*\[!([\w-]+)\]([+-]?)\s*(.*)$/);
    if (!m) { out.push(lines[i]); continue; }
    const inner = [];
    while (i + 1 < lines.length && lines[i + 1].startsWith('>')) inner.push(lines[++i].replace(/^>\s?/, ''));
    const body = marked.parse(inner.join('\n'));
    const type = m[1].toLowerCase();
    const title = m[3] ? marked.parseInline(m[3]) : type.charAt(0).toUpperCase() + type.slice(1);
    blocks.push(m[2]
      ? `<details class="callout callout-${type}"${m[2] === '+' ? ' open' : ''}><summary class="callout-title">${title}</summary>${body}</details>`
      : `<aside class="callout callout-${type}"><p class="callout-title">${title}</p>${body}</aside>`);
    out.push('', `@@BLOCK${blocks.length - 1}@@`, '');
  }
  return out.join('\n');
}

function renderMarkdown(note, notes) {
  let md = note.body
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/^\s*# .*\n/, '')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  md = resolveWikilinks(md);
  const blocks = [];
  md = extractBlocks(md, blocks, note, notes);
  return marked.parse(md)
    .replace(/<p>@@BLOCK(\d+)@@<\/p>/g, (_, i) => blocks[Number(i)])
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')
    .replace(/<div class="table-wrap"><div class="table-wrap">/g, '<div class="table-wrap">')
    .replace(/<\/table><\/div><\/div>/g, '</table></div>');
}

// Propriedades da nota (frontmatter), recolhidas no topo do artigo
const HIDDEN_PROPS = new Set(['tipo', 'tags']);
function propsBlock(data) {
  const rows = Object.entries(data).filter(([k, v]) => !HIDDEN_PROPS.has(k) && v !== null && v !== '');
  if (!rows.length) return '';
  const value = (v) => {
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = [...new Set(v.flatMap(Object.keys))];
      return `<div class="table-wrap"><table class="mini"><thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
<tbody>${v.map((r) => `<tr>${keys.map((k) => `<td>${inlineValue(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return `<dl class="props-inner">${Object.entries(v).map(([k, x]) => `<dt>${escapeHtml(k)}</dt><dd>${inlineValue(x)}</dd>`).join('')}</dl>`;
    }
    return Array.isArray(v) && !v.length ? '<span class="muted">—</span>' : inlineValue(v);
  };
  return `<details class="props"><summary>Propriedades</summary>
<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${value(v)}</dd>`).join('\n')}</dl>
</details>`;
}

// ---------- templates ----------

function layout({ title, content, assets, current }) {
  const nav = [['Início', '/'], ...SECTIONS.map((s) => [s, `/${slugify(s)}/`])]
    .map(([label, href]) => `<a href="${href}"${label === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title ? `${title} · cortex` : 'cortex')}</title>
<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121314" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<script>try { const t = localStorage.getItem('tema'); if (t) document.documentElement.dataset.theme = t; } catch {}</script>
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/"><img src="/icon.svg" alt="" width="28" height="28"><strong>cortex</strong></a>
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="Trocar tema"></button>
  </div>
  <nav class="menu wrap" aria-label="Seções">${nav}</nav>
</header>
<main class="wrap">
${content}
</main>
</body>
</html>
`;
}

function notePage(n, sectionIndex) {
  const date = ['data', 'ida', 'criado', 'início'].map((k) => n.data[k]).find(isDate);
  const meta = [n.data.tipo, n.data.status, date && shortDate(date)].filter(Boolean).map(escapeHtml).join(' · ');
  const back = n.isIndex ? '' : `<a class="back" href="${sectionIndex?.url ?? `/${slugify(n.section)}/`}">← ${escapeHtml(n.section)}</a>`;
  return `
<article>
  ${back}
  <header class="note-header">
    ${meta ? `<p class="meta">${meta}</p>` : ''}
    <h1>${escapeHtml(n.title)}</h1>
  </header>
  ${n.isIndex ? '' : propsBlock(n.data)}
  <div class="prose">
${n.html}
  </div>
  ${n.extra ?? ''}
</article>`;
}

// Seção sem nota principal (ex.: Pessoal): lista das notas, das mais recentes para as mais antigas
function sectionList(section, notes) {
  const items = notes.filter((n) => n.section === section && !n.isIndex);
  const when = (n) => ['data', 'ida', 'criado', 'início', 'mês'].map((k) => n.data[k]).find((v) => v) ?? '';
  items.sort((a, b) => compare(when(b), when(a)) || a.title.localeCompare(b.title, 'pt-BR'));
  return `<ul class="note-list">${items.map((n) => {
    const d = when(n);
    const meta = [n.data.tipo, n.data.status, isDate(String(d)) && shortDate(String(d))].filter(Boolean).map(escapeHtml).join(' · ');
    return `<li><a class="card" href="${n.url}"><span class="meta">${meta}</span><strong>${escapeHtml(n.title)}</strong></a></li>`;
  }).join('\n')}</ul>`;
}

function homePage(notes) {
  const cards = SECTIONS.map((s) => {
    const count = notes.filter((n) => n.section === s && !n.isIndex).length;
    return `<a class="card section-card" href="/${slugify(s)}/"><strong>${s}</strong><span class="meta">${count} ${count === 1 ? 'nota' : 'notas'}</span></a>`;
  }).join('\n');
  return `
<header class="note-header"><p class="meta" data-hoje></p><h1>Início</h1></header>
<div class="section-grid">${cards}</div>`;
}

const notFound = () => `<header class="note-header"><h1>Página não encontrada</h1></header><p><a href="/">← Início</a></p>`;

// ---------- build ----------

async function writePage(url, html) {
  const file = url.endsWith('/') ? path.join(OUT, url, 'index.html') : path.join(OUT, url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
}

async function build() {
  if (!existsSync(VAULT)) throw new Error(`Vault não encontrado: ${VAULT}`);

  if (existsSync(path.join(VAULT, ANEXOS))) {
    for (const rel of await walk(path.join(VAULT, ANEXOS))) attachments.set(nfc(path.basename(rel)), rel);
  }
  const notes = await loadNotes();
  LINKS = new Map();
  for (const n of notes) if (!LINKS.has(n.name)) LINKS.set(n.name, n);
  for (const n of notes) n.html = renderMarkdown(n, notes);

  const indexes = new Map(notes.filter((n) => n.isIndex).map((n) => [n.section, n]));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'assets'), { recursive: true });
  const css = await readFile(path.join(SRC, 'styles.css'), 'utf8');
  const js = await readFile(path.join(SRC, 'app.js'), 'utf8');
  const assets = { css: `/assets/styles.css?v=${hash(css)}`, js: `/assets/app.js?v=${hash(js)}` };
  await writeFile(path.join(OUT, 'assets', 'styles.css'), css);
  await writeFile(path.join(OUT, 'assets', 'app.js'), js);
  await copyFile(path.join(SRC, 'icon.svg'), path.join(OUT, 'icon.svg'));
  for (const name of usedAttachments) {
    const rel = attachments.get(name);
    const dest = path.join(OUT, 'anexos', rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(VAULT, ANEXOS, rel), dest);
  }

  const pages = new Map();
  pages.set('/', layout({ title: '', current: 'Início', assets, content: homePage(notes) }));
  for (const s of SECTIONS) {
    if (indexes.has(s)) continue;
    const url = `/${slugify(s)}/`;
    pages.set(url, layout({ title: s, current: s, assets, content: `<header class="note-header"><h1>${s}</h1></header>${sectionList(s, notes)}` }));
  }
  for (const n of notes) {
    if (pages.has(n.url)) console.warn(`  URL repetida: ${n.url} (${n.name})`);
    const current = SECTIONS.includes(n.section) ? n.section : '';
    pages.set(n.url, layout({ title: n.title, current, assets, content: notePage(n, indexes.get(n.section)) }));
  }
  pages.set('/404.html', layout({ title: 'Página não encontrada', assets, content: notFound() }));
  for (const [url, html] of pages) await writePage(url, html);

  console.log(`✓ ${notes.length} notas, ${pages.size} páginas, ${usedAttachments.size} anexos`);
}

await build();
