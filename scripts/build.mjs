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

// Emojis no começo dos títulos ficam só no vault; no site, poluem a tela
const LEADING_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]|[0-9#*]\u{FE0F}?\u{20E3})+\s*/u;
const stripEmoji = (s) => s.replace(LEADING_EMOJI, '');

function splitFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  return { data: parseYaml(m[1]) ?? {}, body: src.slice(m[0].length) };
}

async function readNote(file, rel) {
  const raw = (await readFile(file, 'utf8')).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const { data, body } = splitFrontmatter(raw);
  const name = nfc(path.basename(file, '.md'));
  const title = stripEmoji(body.match(/^# (.+)$/m)?.[1]?.trim() ?? name);
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
    .replace(/^(#{1,6} )(.*)$/gm, (_, h, t) => h + stripEmoji(t))
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
    <nav class="menu" aria-label="Seções">${nav}</nav>
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="Trocar tema"></button>
  </div>
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

// ---------- Início (F2) ----------
// O build junta os dados; as datas relativas ("amanhã", "dia 06 passou", a semana) são calculadas no navegador
// (src/app.js), para o site não precisar ser gerado de novo todo dia. Especificação: Sistema/Painéis/Plano do site.md.

const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const dayOf = (ym, d) => `${ym}-${pad(Math.min(Number(d), lastDay(ym)))}`;
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + m - 1 + k; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
const AREA_DA_CATEGORIA = { casa: 'casa', igreja: 'igreja' }; // o resto das contas é finanças

function homeData(notes) {
  const inFolder = (f) => notes.filter((n) => n.folder === f);
  const meses = new Map(inFolder('Finanças/Meses').filter((n) => n.data.tipo === 'mes').map((n) => [String(n.data['mês']), n]));
  const contas = inFolder('Finanças/Contas').filter((n) => n.data.tipo === 'conta' && n.data.status === 'ativa');
  const dividas = inFolder('Finanças/Dívidas').filter((n) => n.data.tipo === 'divida' && ['ativa', 'a contratar'].includes(n.data.status));

  // Meses com nota + o mês do build e os dois seguintes (contas recorrentes ainda sem nota)
  const now = new Date().toISOString().slice(0, 7);
  const months = [...new Set([...meses.keys(), now, addMonths(now, 1), addMonths(now, 2)])].sort();

  const eventos = [];
  const resumo = {};
  for (const ym of months) {
    const nota = meses.get(ym);
    const pagos = [nota?.data.pagamentos ?? []].flat();
    const pagou = (campo, nome) => pagos.some((p) => nfc(linkTarget(p?.[campo]) ?? '') === nome);
    let aPagar = 0;
    for (const c of contas) {
      if (pagou('conta', c.name)) continue;
      aPagar++;
      const area = AREA_DA_CATEGORIA[c.data.categoria] ?? 'finanças';
      const pref = c.data['pagar-em'] || c.data.vencimento;
      if (!pref) {
        eventos.push({ data: `${ym}-${pad(lastDay(ym))}`, area, titulo: c.name, obs: `${brl(c.data.valor)} · até o fim do mês`, conta: true, valor: Number(c.data.valor), semData: true });
      } else {
        eventos.push({ data: dayOf(ym, pref), limite: dayOf(ym, c.data.vencimento || pref), area, titulo: c.name, obs: brl(c.data.valor), conta: true, valor: Number(c.data.valor) });
      }
    }
    for (const d of dividas) {
      const inicio = String(d.data.inicio ?? '');
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio.slice(8) : 10;
      const pagouDivida = pagou('divida', d.name) || [d.data.pagamentos ?? []].flat().some((p) => String(p?.data ?? '').startsWith(ym));
      if (pagouDivida) continue;
      if (d.data.status === 'a contratar' && inicio.slice(0, 7) === ym) {
        aPagar++;
        eventos.push({ data: dayOf(ym, 10), area: 'finanças', titulo: d.name, obs: `contratar · entrada ${brl(d.data.entrada ?? 0)}`, conta: true, valor: Number(d.data.entrada ?? 0), detalhe: 'entrada do parcelamento' });
      } else if (d.data.status === 'ativa' && d.data['primeira-parcela']) {
        const k = monthDiff(String(d.data['primeira-parcela']), ym) + 1;
        if (k < 1 || k > Number(d.data.parcelas)) continue;
        aPagar++;
        eventos.push({ data: dayOf(ym, dia), area: 'finanças', titulo: d.name, obs: `parcela ${k} de ${d.data.parcelas} · ${brl(d.data['valor-parcela'])}`, conta: true, valor: Number(d.data['valor-parcela']), detalhe: `parcela ${k} de ${d.data.parcelas}` });
      }
    }
    eventos.push({ data: dayOf(ym, 15), area: 'finanças', titulo: 'Extrato', obs: 'conferir no meio do mês', curto: 'conferir o extrato' });
    eventos.push({ data: dayOf(ym, 30), area: 'finanças', titulo: 'Fechar o mês', obs: 'conferir o extrato', curto: 'fechar o mês' });
    for (const c of [nota?.data.compromissos ?? []].flat()) {
      if (c?.data) eventos.push({ data: String(c.data), area: c['área'] ?? 'pessoal', titulo: c['título'] ?? '', obs: c.obs ?? '' });
    }
    if (nota) {
      const teto = Number(nota.data['teto-dia-a-dia'] ?? 0);
      const usado = Object.values(nota.data.gastos ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
      const pagas = pagos.map((x) => ({ nome: linkTarget(x?.conta ?? x?.divida) ?? '', valor: Number(x?.valor ?? 0), obs: x?.obs ?? '' }))
        .sort((a, b) => b.valor - a.valor);
      resumo[ym] = { teto, usado, aPagar, gastos: nota.data.gastos ?? {}, pagas, nota: nota.url };
    }
  }
  eventos.sort((a, b) => a.data.localeCompare(b.data));

  const ultimoSaldo = (d) => Number([d.data.saldos ?? []].flat().at(-1)?.valor ?? d.data.valor ?? 0);
  const dividaTotal = dividas.reduce((s, d) => s + ultimoSaldo(d), 0);

  // Igreja: GP às quartas (horário e locais da nota Próximo GP), Palavra às terças
  const gp = notes.find((n) => n.name === 'Próximo GP')?.data ?? {};
  const encontros = [gp.encontros ?? []].flat().filter((e) => e?.data).map((e) => ({ data: String(e.data), local: e.local ?? '', horario: e['horário'] ? String(e['horário']) : '' }));
  const palavras = inFolder('Igreja/Palavras').filter((n) => isDate(String(n.data.data ?? '')))
    .map((n) => ({ data: String(n.data.data), titulo: n.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, ''), texto: n.data['texto-base'] ?? '', url: n.url }))
    .sort((a, b) => b.data.localeCompare(a.data));

  // Projetos: contagem por status (sem os que fazem parte de outro)
  const projetos = notes.filter((n) => n.section === 'Projetos' && n.data.tipo === 'projeto' && !n.data['parte-de']);
  const porStatus = {};
  for (const p of projetos) porStatus[p.data.status ?? 'sem status'] = (porStatus[p.data.status ?? 'sem status'] ?? 0) + 1;
  const andamento = projetos.filter((p) => ['ativo', 'em uso'].includes(p.data.status)).map((p) => p.name);

  // Pessoal: viagens e tokens
  const viagens = notes.filter((n) => n.data.tipo === 'viagem' && isDate(String(n.data.ida ?? '')))
    .map((n) => ({ ida: String(n.data.ida), destino: n.data.destino ?? n.title, url: n.url }));
  const tokensNota = notes.find((n) => n.name === 'Uso de tokens')?.data ?? {};
  const tokens = {
    limite: Number(tokensNota['limite-pessoal'] ?? 30),
    meses: [tokensNota['medições'] ?? []].flat().filter((m) => m?.origem === 'script' && m['mês'] && !m.parcial)
      .map((m) => ({ mes: String(m['mês']), pct: Number(m['pct-pessoal']) })),
  };

  const rotinaNota = notes.find((n) => n.name === 'Rotina diária');
  const rotina = [...(rotinaNota?.body ?? '').matchAll(/^[-*] (?!\[)(.+)$/gm)].map((m) => toPlainInline(m[1]));

  return {
    nome: 'Mateus', rotina, rotinaUrl: rotinaNota?.url ?? '/pessoal/',
    eventos, resumo, dividaTotal, gp: { horario: gp['horário'] ? String(gp['horário']) : '', encontros }, palavras: palavras.slice(0, 5),
    projetos: { porStatus, andamento }, viagens, tokens,
  };
}

// ---------- Finanças (F2) ----------
// Especificação: Sistema/Painéis/Painel de Finanças.md. Projeção = cenário E (seção 4).

const RENDA_BASE = 5100;        // seção 4, item 1
const DENTISTA_ATRASADO = 512;  // seção 4, item 6: pago no mês seguinte à quitação da dívida de maior taxa
const CORES_DIVIDA = ['#ff9f0a', '#0a84ff', '#bf5af2', '#30b0c7']; // pela ordem de taxa: Bradesco laranja, BB azul

function financeData(notes) {
  const inFolder = (f) => notes.filter((n) => n.folder === f);
  const contas = inFolder('Finanças/Contas').filter((n) => n.data.tipo === 'conta' && n.data.status === 'ativa');
  const todas = inFolder('Finanças/Dívidas').filter((n) => n.data.tipo === 'divida');
  const painel = todas.filter((d) => ['ativa', 'a contratar'].includes(d.data.status))
    .sort((a, b) => Number(b.data['taxa-mensal'] ?? 0) - Number(a.data['taxa-mensal'] ?? 0));
  const ultimoMes = inFolder('Finanças/Meses').filter((n) => n.data.tipo === 'mes').sort((a, b) => String(b.data['mês']).localeCompare(String(a.data['mês'])))[0];
  const teto = Number(ultimoMes?.data['teto-dia-a-dia'] ?? 0);

  const saldos = (d) => [d.data.saldos ?? []].flat().filter((x) => x?.['mês']).map((x) => ({ mes: String(x['mês']), valor: Number(x.valor) }));
  const ultimoSaldo = (d) => saldos(d).at(-1)?.valor ?? Number(d.data.valor ?? 0);
  const curto = (d) => d.name.split(' ')[0];
  const mesCurto = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]}/${ym.slice(0, 4)}`;

  // Histórico real: do primeiro ao último mês com saldo (todas as dívidas, inclusive quitadas)
  const ordem = [...painel, ...todas.filter((d) => !painel.includes(d))];
  const mesesReais = [...new Set(todas.flatMap((d) => saldos(d).map((x) => x.mes)))].sort();
  const grafico = mesesReais.map((mes) => ({ mes, tipo: 'real', valores: ordem.map((d) => saldos(d).find((x) => x.mes === mes)?.valor ?? 0) }));

  // Projeção: juros pela taxa de cada uma, a parcela de cada uma, e o extra inteiro na de maior taxa
  const contasTotal = contas.reduce((s, c) => s + Number(c.data.valor ?? 0), 0);
  const parcelas = painel.reduce((s, d) => s + Number(d.data['valor-parcela'] ?? 0), 0);
  const sobra = RENDA_BASE - contasTotal - parcelas;
  const extra = sobra - teto;
  const estado = ordem.map((d) => ({
    d, saldo: painel.includes(d) ? ultimoSaldo(d) : 0, taxa: Number(d.data['taxa-mensal'] ?? 0) / 100, parcela: Number(d.data['valor-parcela'] ?? 0),
    inicioParcelas: String(d.data['primeira-parcela'] ?? addMonths(String(d.data.inicio ?? '').slice(0, 7) || mesesReais.at(-1), 1)),
    quitacao: null,
  }));
  let dentista = DENTISTA_ATRASADO;
  let mes = mesesReais.at(-1) ?? new Date().toISOString().slice(0, 7);
  for (let i = 0; i < 120 && estado.some((x) => x.saldo > 0.005); i++) {
    mes = addMonths(mes, 1);
    let livre = Math.max(0, extra);
    const prioridade = estado.find((x) => painel.includes(x.d));
    if (dentista && prioridade?.quitacao && monthDiff(prioridade.quitacao, mes) === 1) { livre = Math.max(0, livre - dentista); dentista = 0; }
    for (const x of estado) {
      if (x.saldo <= 0) continue;
      x.saldo *= 1 + x.taxa;
      if (mes >= x.inicioParcelas) x.saldo -= x.parcela;
      if (x.saldo < 0) { livre += -x.saldo; x.saldo = 0; }
    }
    for (const x of estado) {
      if (x.saldo <= 0 || livre <= 0) continue;
      const a = Math.min(livre, x.saldo);
      x.saldo -= a;
      livre -= a;
    }
    for (const x of estado) if (x.saldo <= 0.005 && !x.quitacao && painel.includes(x.d)) { x.saldo = 0; x.quitacao = mes; }
    grafico.push({ mes, tipo: 'projeção', valores: estado.map((x) => Math.max(0, x.saldo)) });
  }

  const dividas = painel.map((d, i) => {
    const e = estado.find((x) => x.d === d);
    const valor = Number(d.data.valor ?? 0);
    const etiquetas = [];
    if (i === 0) etiquetas.push('prioridade 1');
    if (d.data.status === 'a contratar') {
      const ini = String(d.data.inicio ?? '').slice(0, 7);
      if (ini) etiquetas.push(`contratar até 10/${ini.slice(5)}`);
    } else if (Number(d.data['parcelas-pagas'] ?? 0) === 0 && d.data['primeira-parcela']) {
      const entrada = [d.data.pagamentos ?? []].flat().some((p) => p?.tipo === 'entrada');
      etiquetas.push(`${entrada ? 'entrada paga · ' : ''}1ª parcela em ${MONTHS[Number(String(d.data['primeira-parcela']).slice(5, 7)) - 1]}`);
    }
    return {
      nome: `${curto(d)} · ${d.name.split(' ').slice(1).join(' ')} ${d.data.parcelas}x`.replace(/\s+/g, ' '),
      curto: curto(d), url: d.url, cor: CORES_DIVIDA[i % CORES_DIVIDA.length], taxa: Number(d.data['taxa-mensal'] ?? 0),
      etiqueta: etiquetas.join(' · '), saldo: ultimoSaldo(d),
      progresso: valor ? Math.max(0, Math.min(1, (valor - ultimoSaldo(d)) / valor)) : 0,
      parcelasPagas: Number(d.data['parcelas-pagas'] ?? 0), parcelas: Number(d.data.parcelas ?? 0), valorParcela: Number(d.data['valor-parcela'] ?? 0),
      estrategia: i === 0 ? 'antecipar com a sobra' : `antecipar depois do ${curto(painel[i - 1])}`,
      quitacao: e?.quitacao ? mesCurto(e.quitacao) : '—',
    };
  });
  const series = ordem.map((d, i) => ({ nome: curto(d), taxa: Number(d.data['taxa-mensal'] ?? 0), cor: CORES_DIVIDA[i % CORES_DIVIDA.length] }));
  return { dividas, series, grafico, premissas: { renda: RENDA_BASE, contas: contasTotal, parcelas, teto, extra } };
}

function financePage(notes, home, indexNote) {
  const fin = financeData(notes);
  const dados = JSON.stringify({ fin, resumo: home.resumo, eventos: home.eventos.filter((e) => e.conta) }).replace(/</g, '\\u003c');
  return `
<div class="financas">
  <header class="inicio-head">
    <h1 data-fin-titulo>Finanças</h1>
    <p data-fin-hoje></p>
  </header>
  <section class="teto" data-fin-teto></section>
  <section class="fin-cards" data-fin-cards></section>
  <section class="grafico card-w" aria-labelledby="graf-titulo">
    <div class="graf-head">
      <div><p class="lbl" id="graf-titulo">Dívida mês a mês</p><p class="v big" data-graf-total></p></div>
      <div class="legenda" data-graf-legenda></div>
    </div>
    <div class="graf-scroll"><div class="graf" data-graf></div></div>
    <p class="premissa" data-graf-premissa></p>
  </section>
  <section class="contas-mes">
    <div class="card-w" data-fin-apagar></div>
    <div class="pagas" data-fin-pagas></div>
  </section>
  <noscript><p>Ative o JavaScript para ver o painel.</p></noscript>
</div>
<script type="application/json" id="dados-financas">${dados}</script>
${indexNote ? `<section class="fin-notas"><h2>Notas de finanças</h2><div class="prose">${indexNote.html}</div></section>` : ''}`;
}

const toPlainInline = (s) => s.replace(WIKILINK, (_, _b, t, l) => l || t).replace(/[*_`]/g, '').trim();

const ICONE = {
  'finanças': '<path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 7l12-3v3"></path><circle cx="16" cy="13" r="1.2"></circle>',
  igreja: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"></path><path d="M12 8v6M9 11h6"></path>',
  projetos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  pessoal: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>',
};
const icone = (area) => `<span class="ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONE[area]}</svg></span>`;

function homePage(notes) {
  const dados = JSON.stringify(homeData(notes)).replace(/</g, '\\u003c');
  const card = (area, titulo, href, extra = '') => `<a class="tile tile-${area}" href="${href}">
    <div class="tile-top"><span class="tile-name">${icone(area)}${titulo}</span>${extra}</div>
    <div data-tile="${area}"></div>
  </a>`;
  return `
<div class="inicio">
  <header class="inicio-head">
    <h1 data-saudacao>Olá</h1>
    <p data-hoje-linha></p>
  </header>
  <section class="rotina" aria-labelledby="rotina-titulo">
    <div class="rotina-head"><p class="lbl" id="rotina-titulo">Todo dia</p><p class="rotina-conta" data-rotina-conta></p></div>
    <div class="rotina-itens" data-rotina></div>
  </section>
  <section class="semana" aria-labelledby="semana-titulo">
    <div class="semana-head"><p class="lbl" id="semana-titulo" data-semana-titulo>Esta semana</p><p class="depois" data-depois></p></div>
    <div class="semana-dias" data-semana></div>
  </section>
  <section class="tiles" aria-label="Áreas">
    ${card('finanças', 'Finanças', '/financas/', '<span class="tile-link">ver painel →</span>')}
    ${card('igreja', 'Igreja', '/igreja/')}
    ${card('projetos', 'Projetos', '/projetos/')}
    ${card('pessoal', 'Pessoal', '/pessoal/')}
  </section>
  <noscript><p>Ative o JavaScript para ver o Início.</p></noscript>
</div>
<script type="application/json" id="dados-inicio">${dados}</script>`;
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
    // A página de Finanças é o painel (F2), com as tabelas da nota principal embaixo
    const content = n.isIndex && n.section === 'Finanças' ? financePage(notes, homeData(notes), n) : notePage(n, indexes.get(n.section));
    pages.set(n.url, layout({ title: n.title, current, assets, content }));
  }
  pages.set('/404.html', layout({ title: 'Página não encontrada', assets, content: notFound() }));
  for (const [url, html] of pages) await writePage(url, html);

  console.log(`✓ ${notes.length} notas, ${pages.size} páginas, ${usedAttachments.size} anexos`);
}

await build();
