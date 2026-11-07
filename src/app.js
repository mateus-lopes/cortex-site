// Tema claro/escuro e data de hoje (calculada no navegador, para o site não precisar ser gerado todo dia)
const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

function setupThemeToggle(button) {
  const paint = () => {
    const dark = currentTheme() === 'dark';
    button.innerHTML = dark ? ICONS.sun : ICONS.moon;
    button.setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema escuro');
  };
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tema', next); } catch {}
    paint();
  });
  systemDark.addEventListener('change', paint);
  paint();
}

// ---------- Início ----------
// Os dados vêm prontos do build (#dados-inicio); aqui só se decide o que é hoje, amanhã, esta semana e o que já passou.

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoOf(d); };
const weekday = (iso) => new Date(`${iso}T12:00:00`).getDay();
const ddmm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const money = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const AREA_CLASSE = { 'finanças': 'fin', igreja: 'igr', casa: 'cas', pessoal: 'pes', projetos: 'pro' };

// Contas com dia preferido já passado vão para o dia limite, com aviso; se o limite também passou, saem da semana
function placeEvents(D, hoje, fim) {
  const out = [];
  for (const e of D.eventos) {
    let data = e.data;
    let atraso = '';
    if (e.limite && data < hoje) {
      if (e.limite < hoje) continue;
      atraso = `dia ${e.data.slice(8)} passou`;
      data = e.limite;
    }
    if (data >= hoje && data <= fim) out.push({ ...e, data, atraso });
  }
  for (let d = hoje; d <= fim; d = addDays(d, 1)) {
    if (weekday(d) === 2) out.push({ data: d, area: 'igreja', titulo: 'Palavra', obs: 'preparar para quarta', curto: 'preparar a Palavra' });
    if (weekday(d) === 3) {
      const enc = D.gp.encontros.find((x) => x.data === d);
      const obs = [enc?.horario || D.gp.horario, enc?.local].filter(Boolean).join(' · ');
      out.push({ data: d, area: 'igreja', titulo: 'GP de jovens', obs, curto: 'GP' });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

function renderInicio(D) {
  const agora = new Date();
  const hoje = isoOf(agora);
  const mes = hoje.slice(0, 7);
  const h = agora.getHours();
  document.querySelector('[data-saudacao]').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${D.nome}`;

  const eventos = placeEvents(D, hoje, addDays(hoje, 120));
  const contasHoje = eventos.filter((e) => e.conta && e.data === hoje);
  const diaLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(agora);
  document.querySelector('[data-hoje-linha]').innerHTML = `${esc(diaLongo)}, ${ddmm(hoje)} · ${contasHoje.length
    ? `<strong class="alerta">${contasHoje.length === 1 ? '1 conta vence' : `${contasHoje.length} contas vencem`} hoje: ${esc(contasHoje.map((e) => e.titulo).join(', '))}</strong>`
    : 'nenhuma conta vence hoje'}`;

  renderRotina(D, hoje);

  // Semana: 7 dias a partir de amanhã
  const ini = addDays(hoje, 1);
  const fim = addDays(hoje, 7);
  document.querySelector('[data-semana-titulo]').textContent = `Esta semana · ${ini.slice(8)} a ${ddmm(fim)}`;
  const dias = [];
  for (let d = ini; d <= fim; d = addDays(d, 1)) {
    const itens = eventos.filter((e) => e.data === d).map((e) => `<div class="e ${AREA_CLASSE[e.area] ?? 'pes'}"><b>${esc(e.titulo)}</b>${esc(e.obs)}${e.atraso ? `<span class="atraso">${esc(e.atraso)}</span>` : ''}</div>`).join('');
    dias.push(`<div class="day${d === ini ? ' amanha' : ''}"><p class="dh"><span>${DIAS[weekday(d)]}${d === ini ? ' · amanhã' : ''}</span><b>${d.slice(8)}</b></p>${itens || '<p class="free">livre</p>'}</div>`);
  }
  document.querySelector('[data-semana]').innerHTML = dias.join('');

  // Depois: as próximas três datas depois da semana
  const depois = new Map();
  for (const e of eventos) {
    if (e.data <= fim) continue;
    if (!depois.has(e.data)) { if (depois.size === 3) break; depois.set(e.data, []); }
    depois.get(e.data).push(e.curto ?? e.titulo);
  }
  document.querySelector('[data-depois]').innerHTML = depois.size
    ? `Depois: ${[...depois].map(([d, t]) => `<b>${ddmm(d)}</b> ${esc(t.join(' e '))}`).join(' · ')}` : '';

  // Finanças
  const r = D.resumo[mes];
  const fin = document.querySelector('[data-tile="finanças"]');
  if (r) {
    const restante = r.teto - r.usado;
    const pct = r.teto ? Math.min(100, Math.max(0, (r.usado / r.teto) * 100)) : 0;
    fin.innerHTML = `<div class="fin-grid">
      <div><p class="s">Dívida total</p><p class="v big">${money(D.dividaTotal)}</p></div>
      <div><p class="s">Teto do dia a dia</p><p class="v big${restante < 0 ? ' alerta' : ''}">${money(restante)}${restante < 0 ? ' <small>estourou</small>' : ''}</p>
        <div class="barra" role="img" aria-label="${money(r.usado)} de ${money(r.teto)} usados"><div style="width:${pct}%"></div></div></div>
    </div>
    <p class="s rodape">${r.aPagar ? `${r.aPagar} ${r.aPagar === 1 ? 'conta' : 'contas'} a pagar este mês` : 'todas as contas do mês pagas'}</p>`;
  } else {
    fin.innerHTML = `<p class="s">Dívida total</p><p class="v big">${money(D.dividaTotal)}</p><p class="s rodape">sem nota de ${MESES[Number(mes.slice(5)) - 1]} ainda</p>`;
  }

  // Igreja: próximo GP (quarta) e última Palavra
  let gp = hoje;
  while (weekday(gp) !== 3) gp = addDays(gp, 1);
  const quando = gp === hoje ? 'hoje' : gp === addDays(hoje, 1) ? 'amanhã' : 'quarta';
  const enc = D.gp.encontros.find((x) => x.data === gp);
  const ultima = D.palavras.find((p) => p.data <= hoje);
  document.querySelector('[data-tile="igreja"]').innerHTML = `<p class="v">GP ${quando}, ${esc(enc?.horario || D.gp.horario)}</p>
    <p class="s">${esc([ddmm(gp), enc?.local].filter(Boolean).join(' · '))}</p>
    ${ultima ? `<p class="s">Última Palavra: “${esc(ultima.titulo)}”${ultima.texto ? ` (${esc(ultima.texto)})` : ''}</p>` : ''}`;

  // Projetos: contagem por status
  const P = D.projetos;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const resto = [
    P.porStatus['concluído'] && plural(P.porStatus['concluído'], 'concluído', 'concluídos'),
    P.porStatus.pausado && plural(P.porStatus.pausado, 'pausado', 'pausados'),
    P.porStatus.ideia && plural(P.porStatus.ideia, 'ideia', 'ideias'),
  ].filter(Boolean);
  document.querySelector('[data-tile="projetos"]').innerHTML = `<p class="v">${P.andamento.length} em andamento</p>
    <p class="s">${esc([P.andamento.join(', '), ...resto].filter(Boolean).join(' · '))}</p>`;

  // Pessoal: próxima viagem e tokens do último mês fechado
  const viagem = D.viagens.filter((v) => v.ida >= hoje).sort((a, b) => a.ida.localeCompare(b.ida))[0];
  const tk = D.tokens.meses.filter((m) => m.mes < mes).sort((a, b) => b.mes.localeCompare(a.mes))[0];
  const faltam = viagem && daysBetween(hoje, viagem.ida);
  document.querySelector('[data-tile="pessoal"]').innerHTML = (viagem
    ? `<p class="v">${esc(viagem.destino)} · ${ddmm(viagem.ida)}</p><p class="s">${faltam === 0 ? 'hoje' : faltam === 1 ? 'amanhã' : `em ${faltam} dias`}</p>`
    : '<p class="v">Nenhuma viagem marcada</p>')
    + (tk ? `<p class="s rodape mini">tokens pessoais em ${MESES[Number(tk.mes.slice(5)) - 1]}: ${tk.pct.toLocaleString('pt-BR')}% (limite ${D.tokens.limite}%)${tk.pct > D.tokens.limite ? ' · acima do limite' : ''}</p>` : '');
}

// Rotina marcável: a marcação fica só neste navegador e zera todo dia
function renderRotina(D, hoje) {
  const box = document.querySelector('[data-rotina]');
  const conta = document.querySelector('[data-rotina-conta]');
  const key = `rotina:${hoje}`;
  let feitos = [];
  try {
    feitos = JSON.parse(localStorage.getItem(key) ?? '[]');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('rotina:') && k !== key) localStorage.removeItem(k);
    }
  } catch {}
  const paint = () => {
    conta.textContent = `${D.rotina.filter((r) => feitos.includes(r)).length}/${D.rotina.length}`;
    box.innerHTML = D.rotina.map((r, i) => {
      const ok = feitos.includes(r);
      return `<button type="button" class="r${ok ? ' ok' : ''}" data-i="${i}" aria-pressed="${ok}"><span class="caixa" aria-hidden="true">${ok ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg>' : ''}</span>${esc(r)}</button>`;
    }).join('');
  };
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    const item = D.rotina[Number(b.dataset.i)];
    feitos = feitos.includes(item) ? feitos.filter((x) => x !== item) : [...feitos, item];
    try { localStorage.setItem(key, JSON.stringify(feitos)); } catch {}
    paint();
  });
  paint();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach(setupThemeToggle);
  const dados = document.getElementById('dados-inicio');
  if (dados) renderInicio(JSON.parse(dados.textContent));
  document.querySelectorAll('[data-hoje]').forEach((el) => {
    el.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  });
});
