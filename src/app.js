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

  renderHoje(D, hoje);

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

// ---------- Finanças ----------
// Especificação: Sistema/Painéis/Painel de Finanças.md. O build manda a projeção pronta; aqui entra só o "hoje".

const GASTO_ROTULO = { 'comer-fora': 'Comer fora', 'mercado-pix': 'Mercado no Pix', comida: 'Comida', transporte: 'Transporte (Uber, 99)', extras: 'Extras', 'gás': 'Gás', 'saúde': 'Saúde (farmácia)', 'não-identificado': 'Não identificado' };
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const kilo = (v) => (v <= 0.5 ? '0' : `${(v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`);

function renderFinancas(D) {
  const agora = new Date();
  const hoje = isoOf(agora);
  const mes = hoje.slice(0, 7);
  const r = D.resumo[mes];
  const F = D.fin;
  const q = (s) => document.querySelector(s);

  // Contas a pagar do mês: o que não está em `pagamentos`; prazo pelo vencimento, alerta se o dia preferido passou
  const aPagar = D.eventos.filter((e) => e.data.startsWith(mes)).map((e) => {
    let prazo = e.semData ? 'até o fim do mês' : `até ${ddmm(e.limite ?? e.data)}`;
    let alerta = false;
    if (!e.semData && e.data < hoje) { prazo = `dia ${e.data.slice(8)} passou`; alerta = true; }
    return { ...e, prazo, alerta };
  }).sort((a, b) => b.alerta - a.alerta || b.valor - a.valor);
  const totalAPagar = aPagar.reduce((s, e) => s + e.valor, 0);

  q('[data-fin-titulo]').textContent = `Finanças · ${MESES_LONGOS[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
  const diaLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(agora);
  q('[data-fin-hoje]').textContent = `hoje: ${diaLongo}, ${ddmm(hoje)} · ${aPagar.length ? `${aPagar.length} ${aPagar.length === 1 ? 'conta' : 'contas'} a pagar` : 'nada a pagar'}`;

  // Teto do dia a dia + gastos por categoria
  if (r) {
    const restante = r.teto - r.usado;
    const pct = r.teto ? Math.min(100, Math.max(0, (r.usado / r.teto) * 100)) : 0;
    const gastos = Object.entries(r.gastos).filter(([, v]) => Number(v) > 0).sort((a, b) => b[1] - a[1]);
    q('[data-fin-teto]').innerHTML = `<div class="teto-valor">
        <p class="lbl">Teto do dia a dia</p>
        <p class="v big${restante < 0 ? ' alerta' : ''}">${money(restante)} <span class="sub">${restante < 0 ? 'estourou' : 'restantes'}</span></p>
        <div class="barra-teto" role="img" aria-label="${pct.toFixed(0)}% do teto usado"><div style="width:${pct}%"></div></div>
        <p class="sub">${money(r.usado)} de ${money(r.teto)} usados</p>
      </div>
      <div class="pills">${gastos.map(([k, v]) => `<span class="pill">${esc(GASTO_ROTULO[k] ?? k)}<b class="num">${money(v)}</b></span>`).join('') || '<span class="sub">nenhum gasto anotado ainda</span>'}</div>`;
  } else {
    q('[data-fin-teto]').innerHTML = `<p class="sub">Ainda não há nota de ${MESES_LONGOS[Number(mes.slice(5)) - 1].toLowerCase()} no vault.</p>`;
  }

  // Mercado: o mês (comida + casa contra o previsto) e o histórico por mês
  const GRUPOS = [
    ['Comida', ['mercearia', 'açougue', 'congelados', 'laticínios', 'hortifrúti', 'padaria', 'bebidas'], 'var(--cas-ac)'],
    ['Casa (higiene + limpeza)', ['higiene', 'limpeza'], 'var(--igr-ac)'],
    ['Outros', ['outros'], 'var(--muted)'],
  ];
  const ROTULO_CAT = { mercearia: 'Mercearia', 'açougue': 'Açougue', congelados: 'Congelados', 'laticínios': 'Laticínios', 'hortifrúti': 'Hortifrúti', padaria: 'Padaria', bebidas: 'Bebidas', higiene: 'Higiene', limpeza: 'Limpeza', outros: 'Outros' };
  const somaGrupo = (cat, chaves) => chaves.reduce((s, k) => s + (cat[k] ?? 0), 0);
  const mm = F.mercado.find((x) => x.mes === mes);
  const box = q('[data-fin-mercado]');
  if (!F.mercado.length) box.remove();
  else {
    const previsto = mm?.previsto || [...F.mercado].reverse().find((x) => x.previsto)?.previsto || 0;
    let tabela = '<p class="s">Nenhuma compra de mercado anotada este mês.</p>';
    if (mm) {
      const linhas = GRUPOS.map(([nome, chaves]) => {
        const itens = chaves.filter((k) => mm.categorias[k] > 0).sort((a, b) => mm.categorias[b] - mm.categorias[a]);
        if (!itens.length) return '';
        return itens.map((k) => `<tr><td>${ROTULO_CAT[k] ?? esc(k)}</td><td class="num">${money(mm.categorias[k])}</td></tr>`).join('')
          + `<tr class="sub-total"><td>${nome}</td><td class="num">${money(somaGrupo(mm.categorias, chaves))}</td></tr>`;
      }).join('');
      tabela = `<table class="cat-tabela"><tbody>${linhas}</tbody></table>`;
    }
    const pct = mm && previsto ? Math.min(100, (mm.total / previsto) * 100) : 0;
    const passou = mm && previsto && mm.total > previsto;
    const max = Math.max(...F.mercado.map((x) => x.total), previsto, 1);
    const ALT = 170; // px da barra mais alta
    const hist = F.mercado.map((x) => `<div class="mcol${x.mes === mes ? ' atual' : ''}" title="${esc(`${x.mes}: ${money(x.total)}`)}">
        <span class="rot">${money(x.total).replace('R$ ', '')}</span>
        <div class="pilha" style="height:${Math.round((x.total / max) * ALT)}px">${GRUPOS.map(([, chaves, cor]) => {
          const v = somaGrupo(x.categorias, chaves);
          return v > 0 ? `<div class="seg" style="flex:${v};background:${cor}"></div>` : '';
        }).join('')}</div>
        <span class="mnome">${MESES[Number(x.mes.slice(5)) - 1]}</span></div>`).join('');
    box.innerHTML = `<div class="card-w">
        <div class="bloco-head"><p class="lbl">Mercado do mês · comida + casa</p><p class="num">${mm ? `${money(mm.total)} de ${money(previsto)}` : `previsto ${money(previsto)}`}</p></div>
        ${mm ? `<div class="barra-merc${passou ? ' passou' : ''}" role="img" aria-label="${pct.toFixed(0)}% do previsto"><div style="width:${pct}%"></div></div>
        <p class="s">${passou ? `<span class="alerta">passou ${money(mm.total - previsto)} do previsto</span>` : `faltam ${money(previsto - mm.total)} do previsto`} · ${mm.compras} ${mm.compras === 1 ? 'compra' : 'compras'}</p>
        <p class="s">${Object.entries(mm.porPagamento).map(([k, v]) => `${esc(k)}: ${money(v)}${/cart/.test(k) ? ' (fatura do mês seguinte)' : /pix/i.test(k) ? ' (sai do dia a dia)' : ''}`).join(' · ')}</p>` : ''}
        ${tabela}
      </div>
      <div class="card-w">
        <div class="bloco-head"><p class="lbl">Mercado mês a mês</p>
          <div class="legenda">${GRUPOS.map(([nome, , cor]) => `<span class="leg"><span class="sw" style="background:${cor}"></span>${nome.split(' ')[0]}</span>`).join('')}<span class="leg"><span class="sw linha"></span>previsto</span></div></div>
        <div class="mgraf">${previsto ? `<div class="linha-prev" style="bottom:${20 + Math.round((previsto / max) * ALT)}px"><span>${money(previsto).replace(',00', '')}</span></div>` : ''}${hist}</div>
      </div>`;
  }

  // Dívida total + um card por dívida (ordem de taxa)
  const total = F.dividas.reduce((s, d) => s + d.saldo, 0);
  q('[data-fin-cards]').style.setProperty('--n', F.dividas.length);
  q('[data-fin-cards]').innerHTML = `<div class="card-w">
      <p class="lbl">Dívida total</p>
      <p class="v huge">${money(total)}</p>
      <p class="s">o que falta pagar · ${F.dividas.map((d) => `${esc(d.curto)} ${money(d.saldo)}`).join(' + ')}</p>
    </div>`
    + F.dividas.map((d) => `<a class="divida" href="${d.url}" style="--c:${d.cor}">
      <p class="lbl">${esc(d.nome)} · ${d.taxa.toLocaleString('pt-BR')}% a.m.</p>
      <p class="v">${esc(d.etiqueta.charAt(0).toUpperCase() + d.etiqueta.slice(1))}</p>
      <div class="barra-div" role="img" aria-label="${Math.round(d.progresso * 100)}% abatido"><div style="width:${Math.max(d.progresso * 100, 0)}%"></div></div>
      <p class="s">${d.parcelasPagas} de ${d.parcelas} parcelas · ${money(d.valorParcela)}/mês · ${esc(d.estrategia)} · quitação prevista: ${esc(d.quitacao)}</p>
    </a>`).join('');

  // Gráfico: barras empilhadas, real cheio, projeção clara e tracejada, mês atual em destaque
  q('[data-graf-total]').innerHTML = `${money(total)} <span class="sub">hoje</span>`;
  q('[data-graf-legenda]').innerHTML = F.series.filter((s, i) => F.grafico.some((g) => g.valores[i] > 0))
    .map((s) => `<span class="leg"><span class="sw" style="background:${s.cor}"></span>${esc(s.nome)} · ${s.taxa.toLocaleString('pt-BR')}% a.m.</span>`).join('')
    + '<span class="leg"><span class="sw proj"></span>projeção (cor apagada)</span>';
  const max = Math.max(...F.grafico.map((g) => g.valores.reduce((a, b) => a + b, 0)), 1);
  const passo = max > 10000 ? 5000 : 2000;
  const linhas = [];
  for (let v = passo; v < max; v += passo) linhas.push(`<div class="grade" style="bottom:${(v / max) * 100}%"><span>${v / 1000}k</span></div>`);
  let ano = '';
  q('[data-graf]').innerHTML = `<div class="graf-area">${linhas.join('')}${F.grafico.map((g) => {
    const soma = g.valores.reduce((a, b) => a + b, 0);
    const atual = g.mes === mes;
    const proj = g.tipo === 'projeção' && g.mes > mes;
    const h = (soma / max) * 100;
    const segs = g.valores.map((v, i) => (v > 0 ? `<div class="seg" style="flex:${v};background:${F.series[i].cor}"></div>` : '')).join('');
    return `<div class="col${atual ? ' atual' : ''}${proj ? ' proj' : ''}" title="${esc(`${g.mes}: ${money(soma)}${proj ? ' (projeção)' : ''}`)}">
      <span class="rot" style="bottom:calc(${h}% + 6px)">${kilo(soma)}</span><div class="pilha${soma ? '' : ' zero'}" style="height:${soma ? h : 0}%">${segs}</div></div>`;
  }).join('')}</div>
  <div class="graf-meses">${F.grafico.map((g) => {
    const y = g.mes.slice(0, 4);
    const virada = ano && y !== ano;
    ano = y;
    return `<span class="${g.mes === mes ? 'atual' : ''}">${MESES[Number(g.mes.slice(5)) - 1]}${virada ? `<small>${y}</small>` : ''}</span>`;
  }).join('')}</div>`;
  const P = F.premissas;
  q('[data-graf-premissa]').textContent = `Projeção: renda ${money(P.renda)} − contas ${money(P.contas)} − parcelas ${money(P.parcelas)} − teto ${money(P.teto)} = ${money(P.extra)}/mês para antecipar.`;

  // Contas a pagar e pagas
  q('[data-fin-apagar]').innerHTML = `<div class="bloco-head"><p class="lbl">Contas a pagar</p><p class="num">${money(totalAPagar)}</p></div>`
    + (aPagar.map((e) => `<div class="item${e.alerta ? ' alerta-bg' : ''}"><div><b>${esc(e.titulo)}</b><span>${esc([e.detalhe, e.prazo].filter(Boolean).join(' · '))}</span></div><span class="num">${money(e.valor)}</span></div>`).join('')
      || '<p class="s">Tudo pago este mês.</p>');
  const pagas = r?.pagas ?? [];
  q('[data-fin-pagas]').innerHTML = `<div class="bloco-head"><p class="lbl">Contas pagas · ${pagas.length}</p><p class="num">${money(pagas.reduce((s, p) => s + p.valor, 0))}</p></div>
    <div class="pagas-grid">${pagas.map((p) => `<div class="row"><span>${esc(p.nome)}${p.obs ? ` <small>(${esc(p.obs)})</small>` : ''}</span><b class="num">${p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b></div>`).join('')}</div>`;
}

// Tarefas de hoje: compromissos do dia, contas atrasadas ou que vencem hoje, GP e Palavra.
// Marcáveis; a marcação fica só neste navegador e zera todo dia.
function tarefasDeHoje(D, hoje) {
  const itens = [];
  for (const e of D.eventos) {
    if (e.data === hoje) itens.push({ titulo: e.titulo, obs: e.obs, area: e.area });
    else if (e.conta && e.limite && e.data < hoje && e.limite >= hoje) {
      itens.push({ titulo: e.titulo, obs: `${e.obs} · dia ${e.data.slice(8)} passou, ${e.limite === hoje ? 'vence hoje' : `vence ${ddmm(e.limite)}`}`, area: e.area, alerta: true });
    }
  }
  if (weekday(hoje) === 2) itens.push({ titulo: 'Palavra', obs: 'preparar para quarta', area: 'igreja' });
  if (weekday(hoje) === 3) {
    const enc = D.gp.encontros.find((x) => x.data === hoje);
    itens.push({ titulo: 'GP de jovens', obs: [enc?.horario || D.gp.horario, enc?.local].filter(Boolean).join(' · '), area: 'igreja' });
  }
  return itens.sort((a, b) => (b.alerta ?? false) - (a.alerta ?? false));
}

function renderHoje(D, hoje) {
  const box = document.querySelector('[data-hoje-tarefas]');
  const conta = document.querySelector('[data-hoje-conta]');
  const itens = tarefasDeHoje(D, hoje);
  const id = (t) => `${t.titulo}|${t.obs}`;
  const key = `hoje:${hoje}`;
  let feitos = [];
  try {
    feitos = JSON.parse(localStorage.getItem(key) ?? '[]');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if ((k?.startsWith('hoje:') && k !== key) || k?.startsWith('rotina:')) localStorage.removeItem(k);
    }
  } catch {}
  const paint = () => {
    conta.textContent = itens.length ? `${itens.filter((t) => feitos.includes(id(t))).length}/${itens.length}` : '';
    box.innerHTML = itens.map((t, i) => {
      const ok = feitos.includes(id(t));
      return `<button type="button" class="r ${AREA_CLASSE[t.area] ?? 'pes'}${ok ? ' ok' : ''}${t.alerta ? ' atrasada' : ''}" data-i="${i}" aria-pressed="${ok}"><span class="caixa" aria-hidden="true">${ok ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg>' : ''}</span><span class="r-txt"><b>${esc(t.titulo)}</b>${t.obs ? `<small>${esc(t.obs)}</small>` : ''}</span></button>`;
    }).join('') || '<p class="r-vazio">Nada marcado para hoje.</p>';
  };
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    const k = id(itens[Number(b.dataset.i)]);
    feitos = feitos.includes(k) ? feitos.filter((x) => x !== k) : [...feitos, k];
    try { localStorage.setItem(key, JSON.stringify(feitos)); } catch {}
    paint();
  });
  paint();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach(setupThemeToggle);
  const dados = document.getElementById('dados-inicio');
  if (dados) renderInicio(JSON.parse(dados.textContent));
  const fin = document.getElementById('dados-financas');
  if (fin) renderFinancas(JSON.parse(fin.textContent));
  document.querySelectorAll('[data-hoje]').forEach((el) => {
    el.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  });
});
