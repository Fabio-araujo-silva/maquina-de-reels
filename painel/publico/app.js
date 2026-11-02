// Painel do Estúdio de Reels — front sem build. Lê /api/*, escuta /api/eventos (SSE) e redesenha.
import { paginaRevisar, sairRevisao, revisaoAoVivo } from './revisar.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let PIPELINE = [];
let estadoUI = { aba: {}, rota: '' };

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { headers: { 'Content-Type': 'application/json' }, ...opcoes, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || j.error || `HTTP ${r.status}`);
  return j;
}
function avisar(msg, erro = false) {
  const a = $('#aviso'); a.textContent = msg; a.className = `aviso${erro ? ' erro' : ''}`; a.hidden = false;
  clearTimeout(avisar.t); avisar.t = setTimeout(() => (a.hidden = true), erro ? 7000 : 3500);
}
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const fmtUSD = (n) => (n == null ? '—' : `US$ ${Number(n).toFixed(2)}`);
const fmtDur = (s) => { if (!s && s !== 0) return '—'; const m = Math.floor(s / 60); const r = Math.round(s % 60); return m ? `${m}min ${String(r).padStart(2, '0')}s` : `${r}s`; };
function relativo(iso) {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return 'agora'; if (d < 3600) return `há ${Math.round(d / 60)} min`; if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
const NOMES_STATUS = { aguardando_usuario: 'Aguardando você', em_andamento: 'Em produção', erro: 'Erro', concluido: 'Pronto' };
function seloStatus(v) {
  if (v.situacao?.tipo === 'parado') return `<span class="selo parado">Parado · ${esc(v.situacao.nome || v.estagio)}</span>`;
  if (v.situacao?.tipo === 'claude') return `<span class="selo andamento">Claude · ${esc(v.situacao.nome || v.estagio)}</span>`;
  const cls = { aguardando_usuario: 'usuario', em_andamento: 'andamento', erro: 'erro', concluido: 'pronto' }[v.status] || '';
  const nome = PIPELINE.find((e) => e.id === v.estagio)?.nome || v.estagio;
  const txt = v.status === 'concluido' ? 'Pronto' : v.status === 'aguardando_usuario' ? `Você: ${nome}` : v.status === 'erro' ? `Erro em ${nome}` : nome;
  return `<span class="selo ${cls}">${esc(txt)}</span>`;
}
function trilho(v) {
  return `<div class="trilho" title="Estágios">${PIPELINE.filter((e) => e.ativo !== false).map((e) => {
    const st = v.estagios?.[e.id]?.status || 'pendente';
    let c = st === 'concluido' ? 'concluido' : st === 'pulado' ? 'pulado' : st === 'erro' ? 'erro' : '';
    if (e.id === v.estagio && !c) c = v.status === 'aguardando_usuario' ? 'usuario' : 'atual';
    return `<i class="${c}" title="${esc(e.nome)}: ${esc(st)}"></i>`;
  }).join('')}</div>`;
}
function barraProgresso(p) {
  if (!p) return '';
  return `<div class="linha entre fraco" style="font-size:12px"><span>${esc(p.msg || '')}</span><span class="mono">${p.pct ?? 0}%</span></div><div class="barra"><span style="width:${p.pct ?? 0}%"></span></div>`;
}
function operador(op) {
  const el = $('#operador');
  el.className = `operador${op?.ativo ? ' vivo' : ''}`;
  el.innerHTML = `<span class="ponto"></span>${op?.ativo ? 'Claude escutando' : 'Claude offline'}`;
}

// ---------------- situação ao vivo ----------------
function tempoDesde(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
const NOMES_CMD = { novo: 'criou o vídeo', menu: 'respondeu o menu', proximo: 'consultou o próximo passo', roteiro: 'validou o roteiro', aprovar: 'aprovou', ajustes: 'recebeu ajustes', rodar: 'rodou um estágio', concluir: 'concluiu um estágio', quadros: 'tirou quadros', passo: 'anunciou um passo', refazer: 'reabriu um estágio', log: 'registrou uma nota', entregue: 'entregou', 'aprovar-previa': 'aprovou a prévia', cenas: 'mexeu na sua revisão' };
function rotuloSituacao(s) {
  if (!s) return 'agora';
  return { claude: 'Claude trabalhando', parado: 'esperando o Claude', motor: `rodando ${s.pct ?? 0}%`, voce: 'sua vez', erro: 'erro', pronto: 'pronto' }[s.tipo] || 'agora';
}
function linhaSituacao(s) {
  if (!s) return '';
  if (s.tipo === 'motor') return `<div class="linha entre fraco" style="font-size:12px"><span>${esc(s.texto)}</span><span class="mono">${s.pct ?? 0}%</span></div><div class="barra"><span style="width:${s.pct ?? 0}%"></span></div>`;
  if (s.tipo === 'claude') return `<div class="fraco" style="font-size:12px">✍ ${esc(s.texto)} · <span data-desde="${esc(s.desde || '')}"></span></div><div class="barra indef"><span></span></div>`;
  if (s.tipo === 'parado') return `<div style="font-size:12px;color:var(--amarelo)">⏸ ${esc(s.texto)}</div>`;
  if (s.tipo === 'voce') return `<div style="font-size:12px;color:var(--amarelo)">👉 ${esc(s.texto)}</div>`;
  return '';
}
const CMD_OPERAR = '/estudio-de-reels opera o painel';
function blocoComando(id) {
  return `<div class="cmd"><code>${CMD_OPERAR}</code><button class="btn" data-copiar="${esc(CMD_OPERAR)}">Copiar</button></div><p class="fraco" style="font-size:13px;margin:4px 0 0">Cole numa sessão do Claude Code e deixe-a aberta. Ou peça no chat: <code>continua o vídeo ${esc(id)}</code>.</p>`;
}
function painelSituacao(d) {
  const s = d.situacao;
  if (!s) return '';
  const geral = s.geral ? `<div class="linha entre fraco" style="font-size:12px;margin-top:12px"><span>Progresso geral: ${s.geral.feitos} de ${s.geral.total} estágios</span><span class="mono">${s.geral.pct}%</span></div><div class="barra fina"><span style="width:${s.geral.pct}%"></span></div>` : '';
  const caixa = (cls, voce, agora, extra = '') => `<div class="situacao ${cls}"><div class="agora-rotulo">O que você faz agora</div><div class="agora-acao">${voce}</div>${agora ? `<div class="agora-status">${agora}</div>` : ''}${extra}${geral}</div>`;
  if (s.tipo === 'voce') {
    if (s.estagio === 'revisao') return caixa('voce', '👉 Leia o roteiro e decida: aprovar ou pedir ajustes.', 'Nada anda até você responder. Depois da aprovação, o resto é automático.',
      `<div class="linha" style="margin-top:10px"><button class="btn verde" data-acao="aprovar">✓ Aprovar roteiro</button><button class="btn" data-acao="ajustes">Pedir ajustes</button><button class="btn" data-ir-aba="roteiro">Ler o roteiro</button></div>`);
    if (s.estagio === 'render') return caixa('voce', '👉 Confira a prévia e aprove para renderizar.', 'Você pediu prévia no menu, então o render espera a sua aprovação.',
      `<div class="linha" style="margin-top:10px"><button class="btn verde" data-acao="aprovar-previa">✓ Aprovar prévia</button><button class="btn" data-ir-aba="midia">Ver os quadros</button></div>`);
    if (s.estagio === 'menu') return caixa('voce', '👉 Responda o menu de montagem no chat do Claude.', 'O Claude está esperando as suas escolhas de estilo, voz e loop.');
    if (s.estagio === 'revisao_usuario') {
      const n = d.revisao_usuario?.atual?.rodada;
      return caixa('voce', '👉 O vídeo está pronto: faça a sua revisão, cena a cena.', `Rodada ${n || 1}. Marque cada cena como boa ou diga o que mudar; depois aprove (o vídeo é entregue na hora) ou envie os ajustes ao Claude.`,
        `<div class="linha" style="margin-top:10px"><a class="btn primario" href="#/v/${encodeURIComponent(d.id)}/revisar">🎬 Fazer a minha revisão</a></div>`);
    }
    return caixa('voce', `👉 ${esc(s.texto)}`, '');
  }
  if (s.tipo === 'parado') {
    const quem = s.executor === 'claude' || s.executor === 'motor+claude' ? 'é feito pelo Claude' : 'roda quando o Claude manda o motor seguir';
    const linhaPedido = s.pedido_acao ? `⏸ ${esc(s.texto)}. Está na fila há <span data-desde="${esc(s.pedido_desde)}"></span>.` : null;
    if (s.operador) return caixa('claude', '✅ Nada. Um Claude está escutando o painel e vai pegar este vídeo em segundos.', linhaPedido || `${esc(s.nome)} ${quem}.`);
    return caixa('parado', '👉 Acorde o Claude: copie o comando abaixo e cole no Claude Code.',
      linhaPedido || `⏸ Parado: ninguém está trabalhando neste vídeo. O estágio <b>${esc(s.nome)}</b> ${quem}.${s.pedido_na_fila ? ` O pedido está na fila há <span data-desde="${esc(s.pedido_desde)}"></span>.` : ''}${s.tipica ? ` Ele costuma levar ${esc(s.tipica)}.` : ''}`,
      blocoComando(d.id));
  }
  if (s.tipo === 'claude') {
    return caixa('claude', `✅ Nada. Aguarde${s.tipica ? ` (costuma levar ${esc(s.tipica)})` : ''}: o painel avisa aqui quando for a sua vez.`,
      `✍ <b>${esc(s.texto)}</b> · ${esc(s.nome)} há <span data-desde="${esc(s.desde || '')}"></span>${s.ultima ? ` · última ação: ${esc(NOMES_CMD[s.ultima.cmd] || s.ultima.cmd)} há <span data-desde="${esc(s.ultima.ts)}"></span>` : ''}`,
      `<div class="barra indef" style="margin-top:10px"><span></span></div>`);
  }
  if (s.tipo === 'motor') {
    return caixa('motor', '✅ Nada. O motor está trabalhando sozinho.',
      `⚙ <b>${esc(s.nome)}</b>: ${esc(s.texto)} · há <span data-desde="${esc(s.desde || '')}"></span>`,
      `<div class="barra" style="margin-top:10px"><span style="width:${s.pct ?? 0}%"></span></div><div class="fraco mono" style="font-size:12px;text-align:right">${s.pct ?? 0}%</div>`);
  }
  if (s.tipo === 'erro') {
    return caixa('parado', '👉 Peça ao Claude para corrigir o erro.', `❌ Erro em ${esc(d.erro?.estagio || s.nome)}: ${esc(d.erro?.msg || '')}`,
      `<div class="linha" style="margin-top:10px"><button class="btn" data-acao="refazer">Pedir ao Claude para refazer</button><button class="btn" data-ir-aba="log">Ver o log</button></div>${s.operador ? '' : blocoComando(d.id)}`);
  }
  if (s.tipo === 'pronto') {
    if (s.revisao_pendente) {
      return caixa('voce', `👉 O agente revisor apontou ${s.revisao_pendente.problemas} problema(s): leia e decida se pede correções ou deixa como está.`, `O vídeo está pronto e pode ser baixado; as correções são opcionais.${s.revisao_pendente.texto ? ` ${s.revisao_pendente.texto} sugestão(ões) mexem no texto da narração: só você decide.` : ''}`,
        `<div class="linha" style="margin-top:10px"><button class="btn primario" data-ir-aba="revisao">Ler a revisão</button>${d.final ? `<a class="btn" href="${d.final}" download>⬇ Baixar MP4</a>` : ''}</div>`);
    }
    return caixa('pronto', '✅ Baixe o MP4 e confira o teste do loop.', 'Vídeo pronto. Quer mudar algo? Use "Recado ao Claude".',
      `<div class="linha" style="margin-top:10px">${d.final ? `<a class="btn primario" href="${d.final}" download>⬇ Baixar MP4</a>` : ''}<button class="btn" data-ir-aba="visao">Ver o teste do loop</button>${(d.revisor?.rodadas || []).length ? '<button class="btn" data-ir-aba="revisao">Ver a revisão do agente</button>' : ''}</div>`);
  }
  return '';
}

// aviso global (todas as páginas): o que fazer agora, somando todos os vídeos
function avisoGlobal(dados) {
  const el = $('#agora');
  if (!el || !dados) return;
  const vs = dados.videos || [];
  const sua = vs.filter((v) => v.situacao?.tipo === 'voce' || (v.situacao?.tipo === 'pronto' && v.situacao?.revisao_pendente) || v.situacao?.tipo === 'erro');
  const parados = vs.filter((v) => v.situacao?.tipo === 'parado');
  const trabalhando = vs.filter((v) => ['claude', 'motor'].includes(v.situacao?.tipo));
  const link = (v, t) => `<a href="#/v/${encodeURIComponent(v.id)}${v.revisar ? '/revisar' : ''}"><b>${esc(v.titulo || v.id)}</b></a>: ${esc(t)}`;
  let cls = 'ok'; let html;
  const acordar = parados.length && !dados.operador?.ativo;
  if (sua.length || acordar) {
    // tudo o que depende de você agora: decisões nos vídeos e, se houver vídeo parado sem Claude, acordá-lo
    cls = sua.length ? 'voce' : 'parado';
    const itens = sua.slice(0, 3).map((v) => `👉 ${link(v, v.situacao.tipo === 'pronto' ? 'leia a revisão do agente' : v.situacao.tipo === 'erro' ? 'pedir ao Claude para corrigir o erro' : v.situacao.texto)}`);
    if (sua.length > 3) itens.push(`e mais ${sua.length - 3}`);
    if (acordar) itens.push(`👉 ${parados.length} vídeo(s) parado(s) esperando o Claude. Copie e cole no Claude Code: <code>${CMD_OPERAR}</code> <button class="btn" data-copiar="${esc(CMD_OPERAR)}">Copiar</button>`);
    html = `<span class="agora-rotulo">O que você faz agora</span> ${itens.join(' &nbsp;·&nbsp; ')}`;
  } else if (trabalhando.length || parados.length) {
    const v = trabalhando[0] || parados[0];
    const oQue = v.situacao.tipo === 'motor' ? `${v.situacao.texto} (${v.situacao.pct ?? 0}%)` : v.situacao.tipo === 'parado' ? 'o Claude que está escutando o painel vai pegar em segundos' : v.situacao.texto;
    html = `<span class="agora-rotulo">O que você faz agora</span> ✅ Nada. ${link(v, oQue)}`;
  } else {
    html = `<span class="agora-rotulo">O que você faz agora</span> ✅ Nada pendente. Crie um vídeo em <a href="#/novo"><b>Novo vídeo</b></a> ou peça no chat.`;
  }
  el.className = `agora ${cls}`;
  el.innerHTML = html;
  document.documentElement.style.setProperty('--agora-h', `${el.offsetHeight}px`);
  document.title = sua.length || (parados.length && !dados.operador?.ativo) ? '● Sua vez · Estúdio de Reels' : 'Estúdio de Reels';
}
async function atualizarAviso() { try { avisoGlobal(await api('/api/videos')); } catch {} }

// ---------------- páginas ----------------
async function paginaVideos() {
  const { videos, operador: op, fila } = await api('/api/videos');
  operador(op);
  const pend = (fila || []).length;
  app.innerHTML = `
    <div class="linha entre" style="margin-bottom:18px">
      <div><h1>Vídeos</h1><p class="sub">${videos.length} vídeo(s)${pend ? ` · ${pend} pedido(s) na fila` : ''}. Peça no chat ("faz um reel sobre…") ou aqui.</p></div>
      <a class="btn primario" href="#/novo">+ Novo vídeo</a>
    </div>
    ${videos.length ? `<div class="grade-videos">${videos.map(cardVideo).join('')}</div>` : `<div class="vazio"><h2>Nenhum vídeo ainda</h2><p>Diga ao Claude <code>/estudio-de-reels</code> com o tema, ou crie em <a href="#/novo" style="color:var(--laranja)">Novo vídeo</a>.</p></div>`}`;
}
function cardVideo(v) {
  return `<a class="card" href="#/v/${encodeURIComponent(v.id)}">
    <div class="card-mini" style="${v.miniatura ? `background-image:url('${v.miniatura}')` : ''}">
      <div class="selo-status">${seloStatus(v)}</div>
      ${v.duracao ? `<span class="dur">${fmtDur(v.duracao)}</span>` : ''}
    </div>
    <div class="card-corpo">
      <div class="card-titulo">${esc(v.titulo || v.id)}</div>
      ${trilho(v)}
      ${linhaSituacao(v.situacao)}
      <div class="card-meta"><span>${relativo(v.atualizado_em)}</span>${v.tokens ? `<span>${fmtN(v.tokens.total)} tokens</span><span>${fmtUSD(v.tokens.custo_usd)}</span>` : ''}${v.elevenlabs ? `<span>${fmtN(v.elevenlabs)} car. ElevenLabs</span>` : ''}</div>
    </div></a>`;
}

async function paginaVideo(id) {
  const d = await api(`/api/videos/${encodeURIComponent(id)}`);
  const aba = estadoUI.aba[id] || (d.estagio === 'revisao' && d.status === 'aguardando_usuario' ? 'roteiro' : 'visao');
  const est = d.estado;
  const acoes = [];
  if (d.estagio === 'revisao' && d.status === 'aguardando_usuario') {
    acoes.push(`<button class="btn verde" data-acao="aprovar">✓ Aprovar roteiro</button>`, `<button class="btn" data-acao="ajustes">Pedir ajustes</button>`);
  }
  if (est.estagios?.render?.aguardando_usuario) acoes.push(`<button class="btn verde" data-acao="aprovar-previa">✓ Aprovar prévia e renderizar</button>`);
  const RVU = d.revisao_usuario;
  if (RVU?.esperando_voce) acoes.push(`<a class="btn primario" href="#/v/${encodeURIComponent(id)}/revisar">🎬 Fazer a minha revisão</a>`);
  else if (RVU?.com_claude) acoes.push(`<a class="btn" href="#/v/${encodeURIComponent(id)}/revisar">Ver os ajustes que pedi</a>`);
  else if (RVU?.ativo && (RVU.rodadas?.length || RVU.pode_abrir)) acoes.push(`<a class="btn" href="#/v/${encodeURIComponent(id)}/revisar">🎬 Revisão cena a cena</a>`);
  if (d.final) acoes.push(`<a class="btn primario" href="${d.final}" download>⬇ Baixar MP4</a>`, `<button class="btn" data-acao="rerender">Renderizar de novo</button>`);
  if (d.status === 'erro') acoes.push(`<button class="btn" data-acao="refazer">Pedir ao Claude para refazer</button>`);
  acoes.push(`<button class="btn" data-acao="mensagem">Recado ao Claude</button>`, `<button class="btn" data-acao="abrir-pasta">Abrir pasta</button>`);
  app.innerHTML = `
    <div class="cabecalho-video">
      <div>
        <div class="kicker"><a href="#/">Vídeos</a> / ${esc(d.id)}</div>
        <h1>${esc(d.titulo || d.id)}</h1>
        <p class="sub" style="margin-bottom:8px">${esc(d.prompt || '')}</p>
        ${d.fonte ? `<p class="fonte-yt">▶ Fonte: <a href="${esc(d.fonte.url)}" target="_blank" rel="noopener">${esc(d.fonte.titulo || d.fonte.url)}</a>${d.fonte.canal ? ` · ${esc(d.fonte.canal)}` : ''} · ${d.fonte.erro ? `<span style="color:var(--vermelho)">a leitura falhou: ${esc(d.fonte.erro)}</span>` : d.fonte.sem_legenda ? '<span style="color:var(--amarelo)">sem legenda: o Claude transcreve o áudio antes do roteiro</span>' : `${d.fonte.palavras} palavras transcritas`}</p>` : ''}
        <div class="linha">${seloStatus(d)}${d.duracao ? `<span class="selo">${fmtDur(d.duracao)}</span>` : ''}${d.config?.estilo ? `<span class="selo">${esc(d.config.estilo)}</span>` : ''}${d.config?.voz ? `<span class="selo" title="${esc(d.config.voz)}">voz: ${esc(d.voz_nome || d.config.voz)}</span>` : ''}</div>
      </div>
      <div class="linha" style="justify-content:flex-end">${acoes.join('')}</div>
    </div>
    ${d.erro ? `<div class="painel" style="border-color:var(--vermelho);margin-bottom:16px"><b style="color:var(--vermelho)">Erro em ${esc(d.erro.estagio)}:</b> ${esc(d.erro.msg)}</div>` : ''}
    ${painelSituacao(d)}
    <div class="passos">${PIPELINE.filter((e) => e.ativo !== false).map((e, i) => {
      const s = est.estagios?.[e.id] || {};
      let c = s.status === 'concluido' ? 'concluido' : s.status === 'pulado' ? 'pulado' : s.status === 'erro' ? 'erro' : '';
      if (e.id === d.estagio && !c) c = d.status === 'aguardando_usuario' ? 'usuario' : 'atual';
      const st = s.status === 'concluido' ? 'concluído' : s.status === 'pulado' ? 'pulado' : s.status === 'erro' ? 'erro' : s.aguardando_claude ? 'com o Claude' : e.id === d.estagio ? rotuloSituacao(d.situacao) : 'pendente';
      return `<div class="passo ${c}" title="${esc(s.nota || e.descricao || '')}"><div class="n">${String(i + 1).padStart(2, '0')} · ${esc(e.executor)}</div><div class="nome">${esc(e.nome)}</div><div class="st">${esc(st)}</div></div>`;
    }).join('')}</div>
    <div class="tabs">${[['visao', 'Visão geral'], ['roteiro', 'Roteiro'], ['midia', 'Mídia e áudio'], ['revisao', `Revisão do agente${(d.revisor?.rodadas || []).length ? ` (${d.revisor.rodadas.length})` : ''}`], ['config', 'Configuração'], ['custos', 'Custos'], ['log', 'Log']].map(([k, n]) => `<button data-aba="${k}" class="${aba === k ? 'ativa' : ''}">${n}</button>`).join('')}</div>
    <div id="conteudo-aba">${conteudoAba(aba, d)}</div>`;
  app.querySelectorAll('[data-aba]').forEach((b) => b.onclick = () => { estadoUI.aba[id] = b.dataset.aba; paginaVideo(id); });
  app.querySelectorAll('[data-acao]').forEach((b) => b.onclick = () => acaoVideo(id, b.dataset.acao, d));
  app.querySelectorAll('[data-ir-aba]').forEach((b) => b.onclick = () => { estadoUI.aba[id] = b.dataset.irAba; paginaVideo(id); });
  app.querySelectorAll('[data-corrigir]').forEach((b) => b.onclick = async () => {
    const n = Number(b.dataset.corrigir);
    const problemas = [...app.querySelectorAll(`.pb-${n}:checked`)].map((c) => c.value);
    if (!problemas.length) return avisar('Marque pelo menos um problema.', true);
    const notas = (document.getElementById(`nt-${n}`)?.value || '').trim();
    try { await api(`/api/videos/${encodeURIComponent(id)}/revisor`, { method: 'POST', body: { rodada: n, acao: 'corrigir', problemas, notas } }); avisar('Pedido de correção enviado ao Claude.'); rotear(); }
    catch (e) { avisar(e.message, true); }
  });
  app.querySelectorAll('[data-dispensar]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/videos/${encodeURIComponent(id)}/revisor`, { method: 'POST', body: { rodada: Number(b.dataset.dispensar), acao: 'dispensar' } }); avisar('Ok: o vídeo fica como está.'); rotear(); }
    catch (e) { avisar(e.message, true); }
  });
  const form = $('#form-config'); if (form) form.onsubmit = (ev) => salvarConfigVideo(ev, id, d);
}

function conteudoAba(aba, d) {
  if (aba === 'visao') {
    const a = d.arquivos || {};
    const qa = d.qa;
    return `<div class="duas">
      <div class="painel">${a.final ? `<video class="video-vertical" src="${a.final}" controls loop playsinline></video>` : a.rascunho || a.folha_checagem ? `<h3>Quadros do projeto</h3><img class="img-larga" src="${a.folha_checagem || a.rascunho}">` : `<div class="vazio">O vídeo aparece aqui quando o render terminar.</div>`}</div>
      <div style="display:grid;gap:18px;align-content:start">
        ${d.roteiro ? `<div class="painel"><div class="kicker">Loop</div><div class="loop" style="margin-top:8px">… <b>${esc(d.roteiro.loop?.frase_final || '')}</b><br>→ ${esc(d.roteiro.loop?.frase_inicial || '')}</div><div class="fraco" style="font-size:13px">${esc(d.roteiro.loop?.como_emenda || '')}</div></div>` : ''}
        ${a.teste_loop ? `<div class="painel"><h3>Teste da emenda (últimos 3 s → primeiros 3 s)</h3><video src="${a.teste_loop}" controls loop playsinline style="max-height:360px"></video></div>` : ''}
        ${qa ? `<div class="painel"><h3>QA</h3><table class="tabela"><tr><td>Emenda visual (SSIM)</td><td class="num">${qa.ssim_emenda ?? '—'}</td></tr><tr><td>Loudness</td><td class="num">${qa.lufs ?? '—'} LUFS</td></tr><tr><td>Duração</td><td class="num">${qa.duracao?.toFixed?.(2)} s</td></tr><tr><td>Áudio</td><td class="num">${qa.audio ? 'ok' : 'ausente'}</td></tr></table>${(qa.avisos || []).map((x) => `<div class="dica" style="margin-top:8px">⚠ ${esc(x)}</div>`).join('')}${a.emenda ? `<img class="img-larga" style="margin-top:10px" src="${a.emenda}" title="último quadro × primeiro quadro">` : ''}</div>` : a.emenda_checagem ? `<div class="painel"><h3>Emenda (último × primeiro)</h3><img class="img-larga" src="${a.emenda_checagem}"></div>` : ''}
      </div></div>`;
  }
  if (aba === 'roteiro') {
    const r = d.roteiro;
    if (!r) return `<div class="vazio">O roteiro ainda não foi escrito. ${d.estagio === 'roteiro' ? 'O Claude está nesse estágio.' : ''}</div>`;
    const caps = Object.fromEntries((r.capitulos || []).map((c) => [c.id, c]));
    const tempos = Object.fromEntries((d.linha?.falas || []).map((f) => [f.id, f]));
    let capAtual = null;
    const linhas = (r.falas || []).map((f) => {
      let h = '';
      if (f.capitulo !== capAtual) { capAtual = f.capitulo; h += `<div class="capitulo">${esc(caps[capAtual]?.rotulo || capAtual)} <span class="fraco" style="letter-spacing:0;font-weight:500">${esc(caps[capAtual]?.resumo || '')}</span></div>`; }
      const t = tempos[f.id];
      const chips = [];
      if (f.funcao) chips.push(`<span class="chip">${esc(f.funcao)}</span>`);
      if (f.plano && f.plano !== '3d') chips.push(`<span class="chip c">${esc(f.plano)}</span>`);
      if (f.overlay) chips.push(`<span class="chip o">${esc(f.overlay.tipo)}: ${esc(f.overlay.valor || (f.overlay.itens || []).join(', '))}</span>`);
      for (const rt of f.rotulos || []) chips.push(`<span class="chip">🏷 ${esc(rt.texto)}</span>`);
      return h + `<div class="fala"><div class="id">${esc(f.id)}${t ? `<small>${t.inicio.toFixed(1)}s</small>` : ''}</div><div><div class="txt">${esc(f.texto)}</div>${f.fala && f.fala !== f.texto ? `<div class="vis">🗣 ${esc(f.fala)}</div>` : ''}<div class="vis">🎬 ${esc(f.visual)}</div><div class="chips">${chips.join('')}</div></div></div>`;
    }).join('');
    const rev = d.revisao ? `<div class="dica" style="margin-bottom:12px">Última decisão: <b>${esc(d.revisao.decisao)}</b>${d.revisao.notas ? ` — ${esc(d.revisao.notas)}` : ''} (${esc(d.revisao.via)}, ${relativo(d.revisao.ts)})</div>` : '';
    return `<div class="duas"><div class="painel">${rev}<div class="loop">… <b>${esc(r.loop?.frase_final || '')}</b><br>→ ${esc(r.loop?.frase_inicial || '')}</div>${linhas}</div>
      <div style="display:grid;gap:18px;align-content:start"><div class="painel"><h3>Promessa</h3><p>${esc(r.promessa)}</p><div class="kicker">Selo</div><p>${esc((d.config?.marca_nome ? d.config.marca_nome.toUpperCase() + ' · ' : '') + (r.tema || ''))}</p></div>
      <div class="painel"><h3>Fontes</h3>${(r.fontes || []).map((f) => `<div style="margin-bottom:8px;font-size:13px"><b>${esc(f.afirmacao)}</b><br><span class="fraco">${esc(f.fonte)}</span>${f.url ? `<br><a href="${esc(f.url)}" target="_blank" rel="noopener" style="color:var(--azul)">${esc(f.url)}</a>` : ''}</div>`).join('') || '<span class="fraco">—</span>'}</div></div></div>`;
  }
  if (aba === 'midia') {
    const a = d.arquivos || {};
    const bloco = (titulo, el) => `<div class="painel"><h3>${titulo}</h3>${el}</div>`;
    return `<div class="duas"><div style="display:grid;gap:18px;align-content:start">
      ${a.final ? bloco('Vídeo final', `<video class="video-vertical" src="${a.final}" controls playsinline></video>`) : ''}
      ${a.folha_final ? bloco('Folha do vídeo final', `<img class="img-larga" src="${a.folha_final}">`) : ''}
      ${a.folha_checagem ? bloco('Quadros da checagem (um por fala)', `<img class="img-larga" src="${a.folha_checagem}">`) : ''}
    </div><div style="display:grid;gap:18px;align-content:start">
      ${a.previa_audio ? bloco('Mix final (voz + música + efeitos)', `<audio src="${a.previa_audio}" controls></audio><div class="fraco" style="font-size:12px;margin-top:6px">${d.mix ? `${d.mix.lufs} LUFS · pico ${d.mix.true_peak} dBTP · ${d.mix.efeitos} efeitos` : ''}</div>`) : ''}
      ${a.narracao ? bloco('Narração', `<audio src="${a.narracao}" controls></audio><div class="fraco" style="font-size:12px;margin-top:6px">${d.voz ? `${esc(d.voz.provedor)} · ${esc(d.voz.voz?.nome)} · ${d.voz.duracao?.toFixed?.(1)} s${d.voz.verificacao ? ` · pronúncia ${(d.voz.verificacao.acerto * 100).toFixed(0)}%` : ''}` : ''}</div>`) : ''}
      ${a.musica ? bloco('Trilha (loop)', `<audio src="${a.musica}" controls loop></audio><div class="fraco" style="font-size:12px;margin-top:6px">${d.trilha?.musica ? `${esc(d.trilha.musica.provedor)}${d.trilha.musica.bpm ? ` · ${d.trilha.musica.bpm} BPM · ${d.trilha.musica.compassos} compassos` : ''}` : ''}</div>`) : ''}
      ${!Object.keys(a).length ? '<div class="vazio">Nada gerado ainda.</div>' : ''}
    </div></div>`;
  }
  if (aba === 'revisao') {
    const R = d.revisor || {};
    const rods = (R.rodadas || []).slice().reverse();
    const modo = { corrigir: 'revisar e corrigir sozinho', relatorio: 'só relatório (você decide)', nao: 'desligado' }[R.modo] || R.modo;
    if (!rods.length) return `<div class="painel"><h3>Agente revisor: ${esc(modo)}</h3><p class="fraco">${R.modo === 'nao' ? 'Este vídeo não usa revisor (escolha do menu). Mude em Configuração se quiser.' : d.estagio === 'revisao_final' ? 'O agente revisor está assistindo ao vídeo pronto agora. O parecer aparece aqui quando ele terminar.' : 'A revisão acontece depois do render: um agente independente assiste ao vídeo pronto e aponta o que corrigir.'}</p></div>`;
    const COR = { alta: 'erro', media: 'usuario', baixa: '' };
    return `<div class="dica" style="margin-bottom:14px">Modo: <b>${esc(modo)}</b> · até ${R.max} rodada(s). Marque os problemas que quer corrigir e peça ao Claude; texto da narração só muda com o seu ok.</div>` + rods.map((r) => `
      <div class="painel" style="margin-bottom:16px">
        <div class="linha entre"><h3 style="margin:0">Rodada ${r.n} · <span class="selo ${r.veredito === 'aprovado' ? 'pronto' : 'usuario'}">${esc(r.veredito || '?')}</span> ${r.nota != null ? `<span class="selo">nota ${esc(r.nota)}</span>` : ''}</h3>${r.folha ? `<a class="btn" href="${r.folha}" target="_blank">Folha de quadros</a>` : ''}</div>
        <p>${esc(r.resumo || '')}</p>
        ${(r.problemas || []).map((p) => { const resp = (r.respostas || []).find((x) => x.id === p.id); return `
          <label class="problema">
            <input type="checkbox" class="pb-${r.n}" value="${esc(p.id)}" ${resp?.acao === 'corrigido' ? 'disabled' : ''}>
            <span><span class="selo ${COR[p.gravidade] || ''}">${esc(p.gravidade)}</span> <span class="mono fraco">${esc(p.onde || '')}</span> <span class="chip">${esc(p.categoria || '')}</span> ${p.sugestao_usuario ? '<span class="chip o">texto: decide você</span>' : ''}
              <div style="margin-top:4px">${esc(p.descricao)}</div>
              <div class="fraco" style="font-size:13px">Sugestão: ${esc(p.sugestao || '')} <span class="mono">(${esc(p.estagio || '')})</span></div>
              ${resp ? `<div style="font-size:13px;color:${resp.acao === 'corrigido' ? 'var(--verde)' : 'var(--amarelo)'}">Produtor: ${esc(resp.acao)}${resp.como ? `: ${esc(resp.como)}` : ''}</div>` : ''}</span>
          </label>`; }).join('') || '<p class="fraco">Nenhum problema apontado.</p>'}
        ${(r.pontos_fortes || []).length ? `<div class="fraco" style="font-size:13px;margin-top:8px">Pontos fortes: ${r.pontos_fortes.map(esc).join(' · ')}</div>` : ''}
        ${r.usuario ? `<div class="dica" style="margin-top:12px">Sua decisão: <b>${r.usuario.acao === 'corrigir' ? `pediu correção de ${esc((r.usuario.problemas || []).join(', '))}` : 'manter como está'}</b>${r.usuario.notas ? ` · "${esc(r.usuario.notas)}"` : ''} · <span data-desde="${esc(r.usuario.ts)}"></span> atrás</div>`
          : (r.n === R.rodadas.at(-1).n && (r.problemas || []).length ? `<div class="linha" style="margin-top:12px"><input type="text" id="nt-${r.n}" placeholder="Observação para o Claude (opcional)" style="flex:1;min-width:220px"><button class="btn primario" data-corrigir="${r.n}">Pedir ao Claude corrigir os marcados</button><button class="btn" data-dispensar="${r.n}">Está bom assim</button></div>` : '')}
      </div>`).join('');
  }
  if (aba === 'config') return formConfigVideo(d);
  if (aba === 'custos') {
    const tk = d.tokens; const el = d.estado?.custos?.elevenlabs || {};
    const est = tk ? Object.entries(tk.por_estagio || {}).sort((x, y) => y[1].total - x[1].total) : [];
    const max = Math.max(1, ...est.map(([, v]) => v.total));
    return `<div class="numeros">
      <div class="numero"><div class="r">Tokens (Claude)</div><div class="v">${fmtN(tk?.total?.total)}</div></div>
      <div class="numero"><div class="r">Custo equivalente</div><div class="v">${fmtUSD(tk?.total?.custo_usd)}</div></div>
      <div class="numero"><div class="r">Saída / entrada</div><div class="v">${fmtN(tk?.total?.output)} / ${fmtN(tk?.total?.input)}</div></div>
      <div class="numero"><div class="r">Cache lido / escrito</div><div class="v">${fmtN(tk?.total?.cache_read)} / ${fmtN(tk?.total?.cache_write)}</div></div>
      <div class="numero"><div class="r">ElevenLabs</div><div class="v">${el.creditos != null ? `${fmtN(el.creditos)} créditos` : `${fmtN(el.caracteres)} car.`}</div></div>
    </div>
    <div class="duas"><div class="painel"><div class="linha entre"><h3>Tokens por estágio</h3><button class="btn" data-acao="tokens">Recalcular</button></div>
      ${est.length ? `<div class="barras-h">${est.map(([k, v]) => `<div class="barra-h"><span>${esc(k)}</span><div class="trilha-b"><span style="width:${(v.total / max) * 100}%"></span></div><span class="v">${fmtN(v.total)} · ${fmtUSD(v.custo_usd)}</span></div>`).join('')}</div>` : '<p class="fraco">Ainda sem tokens atribuídos (o motor calcula na entrega, ou clique em Recalcular).</p>'}
      ${tk ? `<p class="fraco" style="font-size:12px;margin-top:12px">${esc(tk.obs || '')} Sessões: ${(tk.sessoes || []).map((s) => s.slice(0, 8)).join(', ')}</p>` : ''}</div>
      <div class="painel"><h3>Por modelo</h3>${tk ? `<table class="tabela"><tr><th>Modelo</th><th>Tokens</th><th>US$</th></tr>${Object.entries(tk.por_modelo || {}).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${fmtN(v.total)}</td><td class="num">${v.custo_usd.toFixed(2)}</td></tr>`).join('')}</table>` : '<p class="fraco">—</p>'}
      <h3 style="margin-top:18px">Chamadas à ElevenLabs</h3>${(el.chamadas || []).length ? `<table class="tabela"><tr><th>Tipo</th><th>Detalhe</th><th>Car.</th><th>Créditos</th></tr>${el.chamadas.slice(-20).map((c) => `<tr><td>${esc(c.tipo)}</td><td class="fraco">${esc(c.modelo || c.efeito || (c.segundos ? c.segundos + ' s' : ''))}</td><td class="num">${fmtN(c.caracteres)}</td><td class="num">${fmtN(c.creditos)}</td></tr>`).join('')}</table>` : '<p class="fraco">Nenhuma (vídeo feito com provedores offline).</p>'}</div></div>`;
  }
  if (aba === 'log') {
    return `<div class="painel log">${(d.log || []).slice().reverse().map((l) => `<div class="${esc(l.tipo)}"><span class="t">${new Date(l.ts).toLocaleTimeString('pt-BR')}</span>[${esc(l.tipo)}] ${esc(l.msg)}</div>`).join('') || '<span class="fraco">Sem eventos.</span>'}</div>
      ${(d.pedidos || []).length ? `<div class="painel" style="margin-top:16px"><h3>Pedidos deste vídeo</h3>${d.pedidos.map((p) => `<div class="fraco" style="font-size:13px">${esc(p.acao)} · ${esc(p.status)} · ${relativo(p.criado_em)} ${p.resultado ? `— ${esc(p.resultado)}` : ''}</div>`).join('')}</div>` : ''}`;
  }
  return '';
}

let MENU = null;
async function carregarMenu() { if (!MENU) MENU = await api('/api/menu'); return MENU; }

function formConfigVideo(d) {
  if (!MENU || !window.__VOZES) { Promise.all([carregarMenu(), api('/api/vozes').then((v) => (window.__VOZES = v))]).then(() => paginaVideo(d.id)); return '<div class="carregando">Carregando menu…</div>'; }
  const cfg = d.config || {};
  const travado = ['voz', 'trilha', 'mixagem', 'montagem', 'render'].some((e) => d.estado?.estagios?.[e]?.status === 'concluido');
  const campos = MENU.menu.perguntas.map((q) => campoMenu(q, cfg[q.id], `cfg-${q.id}`)).join('');
  return `<form id="form-config" class="painel form">
    <div class="dica">${travado ? 'Este vídeo já passou da voz. Mudar a configuração cria um pedido para o Claude refazer a partir do estágio afetado.' : 'Mudanças valem para os próximos estágios deste vídeo.'}</div>
    <div class="grade-campos">${campos}</div>
    <div class="linha"><button class="btn primario" type="submit">Salvar configuração</button><span class="fraco" style="font-size:13px">Padrões globais ficam em Configurações.</span></div>
  </form>`;
}
function campoMenu(q, valor, nome) {
  const pad = MENU.padroes.respostas?.[q.id] ?? q.padrao;
  const v = valor ?? pad;
  let opcoes = q.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo, descricao: o.descricao }));
  if (q.id === 'estilo' && window.__ESTILOS) opcoes = window.__ESTILOS.map((e) => ({ valor: e.id, rotulo: `${e.nome}${e.grupo === 'Casa' ? '' : ' (lemo)'}`, descricao: e.descricao }));
  if (q.id === 'marca') opcoes = [{ valor: '__salvo__', rotulo: `Nome salvo (${MENU.padroes.marca_nome || '—'})` }, { valor: '__sem__', rotulo: 'Sem selo' }];
  if (q.id === 'voz' && window.__VOZES?.catalogo) {
    const cat = window.__VOZES.catalogo;
    opcoes = [
      ...(cat.todas || []).map((x) => ({ valor: `elevenlabs:${x.voice_id}`, rotulo: `${x.nome}${x.personalizada ? ' (pt-BR)' : ''}`, descricao: x.descricao })),
      ...(cat.kokoro || []).map((x) => ({ valor: `kokoro:${x.voice_id}`, rotulo: x.nome, descricao: 'offline' })),
    ];
    if (/^elevenlabs:auto-/.test(String(v))) {
      const a = cat.auto?.[String(v).endsWith('feminina') ? 'feminina' : 'masculina'];
      if (a) { const alvo = `elevenlabs:${a.voice_id}`; return campoMenu(q, alvo, nome); }
    }
  }
  if (v && !opcoes.some((o) => o.valor === v)) opcoes.unshift({ valor: v, rotulo: v });
  return `<div class="campo"><label for="${nome}">${esc(q.cabecalho)}</label><select id="${nome}" name="${q.id}">${opcoes.map((o) => `<option value="${esc(o.valor)}" ${o.valor === v ? 'selected' : ''} title="${esc(o.descricao || '')}">${esc(o.rotulo)}${o.valor === pad ? ' (padrão)' : ''}</option>`).join('')}</select><small>${esc(q.pergunta)}</small></div>`;
}
async function salvarConfigVideo(ev, id, d) {
  ev.preventDefault();
  const dados = Object.fromEntries(new FormData(ev.target).entries());
  const atual = { ...(d.config || {}), revisor: d.config?.revisor ?? d.revisor?.modo };
  const mudou = Object.fromEntries(Object.entries(dados).filter(([k, v]) => atual[k] !== v));
  if (!Object.keys(mudou).length) return avisar('Nada mudou.');
  const afeta = (k) => (k === 'revisor' ? (mudou.revisor === 'nao' ? null : 'revisao_final') : { voz: 'voz', modelo_voz: 'voz', musica: 'trilha', sfx: 'trilha', estilo: 'storyboard', paleta: 'montagem', legenda: 'montagem', marca: 'montagem', broll: 'storyboard', qualidade: 'render', duracao: 'roteiro', arquetipo: 'roteiro', tom: 'roteiro', loop: 'roteiro', cta: 'roteiro' }[k]);
  const ordem = PIPELINE.map((e) => e.id);
  const passou = (e) => ['concluido', 'pulado'].includes(d.estado?.estagios?.[e]?.status);
  const desde = Object.keys(mudou).map(afeta).filter((e) => e && passou(e)).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0] || null;
  if (mudou.marca && !['__salvo__', '__sem__'].includes(mudou.marca)) mudou.marca_nome = mudou.marca;
  if (mudou.marca === '__sem__') mudou.marca_nome = '';
  try { await api(`/api/videos/${encodeURIComponent(id)}/config`, { method: 'POST', body: { config: mudou, refazer_desde: desde } }); avisar(desde ? `Salvo. Pedido enviado ao Claude: refazer a partir de "${desde}".` : 'Configuração salva.'); }
  catch (e) { avisar(e.message, true); }
}

async function acaoVideo(id, acao, d) {
  try {
    if (acao === 'aprovar') { await api(`/api/videos/${encodeURIComponent(id)}/aprovar`, { method: 'POST', body: {} }); avisar('Roteiro aprovado. O Claude segue sozinho daqui (se estiver escutando).'); }
    else if (acao === 'ajustes') {
      const notas = prompt('O que mudar no roteiro?'); if (!notas) return;
      await api(`/api/videos/${encodeURIComponent(id)}/ajustes`, { method: 'POST', body: { notas } }); avisar('Ajustes enviados ao Claude.');
    } else if (acao === 'aprovar-previa') { await api(`/api/videos/${encodeURIComponent(id)}/aprovar-previa`, { method: 'POST', body: {} }); await api(`/api/videos/${encodeURIComponent(id)}/pedido`, { method: 'POST', body: { acao: 'rerender' } }); avisar('Prévia aprovada.'); }
    else if (acao === 'rerender') { await api(`/api/videos/${encodeURIComponent(id)}/pedido`, { method: 'POST', body: { acao: 'rerender' } }); avisar('Pedido de render enviado.'); }
    else if (acao === 'refazer') { await api(`/api/videos/${encodeURIComponent(id)}/pedido`, { method: 'POST', body: { acao: 'refazer-estagio', payload: { estagio: d.erro?.estagio || d.estagio } } }); avisar('Pedido enviado.'); }
    else if (acao === 'mensagem') { const texto = prompt('Recado para o Claude sobre este vídeo:'); if (!texto) return; await api(`/api/videos/${encodeURIComponent(id)}/pedido`, { method: 'POST', body: { acao: 'mensagem', payload: { texto } } }); avisar('Recado enviado.'); }
    else if (acao === 'abrir-pasta') await api(`/api/videos/${encodeURIComponent(id)}/abrir-pasta`, { method: 'POST', body: {} });
    else if (acao === 'tokens') { avisar('Recalculando…'); await api(`/api/videos/${encodeURIComponent(id)}/tokens`, { method: 'POST', body: {} }); avisar('Tokens atualizados.'); }
    rotear();
  } catch (e) { avisar(e.message, true); }
}

async function paginaNovo() {
  await carregarMenu();
  if (!window.__ESTILOS) window.__ESTILOS = (await api('/api/estilos')).estilos;
  window.__VOZES = await api('/api/vozes');
  const lotes = MENU.menu.lotes;
  app.innerHTML = `<h1>Novo vídeo</h1><p class="sub">O Claude da máquina pega o pedido na fila (se estiver escutando), escreve o roteiro e para na revisão para você aprovar.</p>
    <form id="form-novo" class="form">
      <div class="painel form">
        <div class="campo"><label>Sobre o que é o vídeo?</label><textarea name="prompt" placeholder="Ex.: Por que o avião não cai quando o motor desliga? Explicar sustentação e planeio, estilo KnowLab."></textarea><small>Com um link do YouTube abaixo, isto vira opcional: escreva só o ângulo que você quer (ou deixe em branco).</small></div>
        <div class="campo"><label>Link do YouTube (opcional)</label><input type="url" name="youtube" placeholder="https://www.youtube.com/watch?v=…"><small>O reel é feito sobre o assunto desse vídeo: o Claude lê a legenda (ou transcreve o áudio), confere os fatos em outras fontes e escreve um roteiro próprio. Nada do vídeo original entra no reel.</small></div>
        <div class="campo"><label>Título (opcional)</label><input type="text" name="titulo" placeholder="curto, vira o nome da pasta"></div>
      </div>
      <div class="painel form">
        <h2>Menu de montagem</h2>
        ${lotes.map((l) => `<div class="grupo-titulo">${esc(l.titulo)}</div><div class="grade-campos">${MENU.menu.perguntas.filter((q) => q.lote === l.id).map((q) => campoMenu(q, null, `novo-${q.id}`)).join('')}</div>`).join('')}
      </div>
      <div class="linha"><button class="btn primario" type="submit">Criar e mandar para o Claude</button><span class="fraco" style="font-size:13px">Sem um Claude escutando, o pedido espera na fila.</span></div>
    </form>`;
  $('#form-novo').onsubmit = async (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    const { prompt: p, titulo, youtube, ...config } = dados;
    const link = String(youtube || '').trim();
    if (!String(p || '').trim() && !link) return avisar('Escreva o assunto do vídeo ou cole um link do YouTube.', true);
    if (link && !/(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i.test(link)) return avisar('Esse link não parece ser de um vídeo do YouTube.', true);
    const botao = ev.target.querySelector('button[type="submit"]');
    const textoBotao = botao.textContent;
    botao.disabled = true; botao.textContent = link ? 'Lendo o vídeo do YouTube…' : 'Criando…';
    try {
      const r = await api('/api/novo', { method: 'POST', body: { prompt: p, titulo, youtube: link, config } });
      location.hash = `#/v/${encodeURIComponent(r.id)}`;
      avisar(r.fonte?.erro ? `Vídeo criado, mas a leitura do YouTube falhou: ${r.fonte.erro}` : link ? `Vídeo criado sobre "${r.fonte?.titulo || 'o vídeo do YouTube'}" e pedido enviado.` : 'Vídeo criado e pedido enviado.', Boolean(r.fonte?.erro));
    } catch (e) { avisar(e.message, true); botao.disabled = false; botao.textContent = textoBotao; }
  };
}

// ---------------- Configurações ----------------
const GEN = { male: 'masculina', female: 'feminina', masculina: 'masculina', feminina: 'feminina' };
const MODELOS_VOZ = [['eleven_multilingual_v2', 'Multilingual v2 (estável, tempos precisos)'], ['eleven_v3', 'Eleven v3 (mais expressivo)'], ['eleven_flash_v2_5', 'Flash v2.5 (rápido e barato)']];
const AJUSTES_VOZ = [
  ['stability', 'Estabilidade', 0, 1, 0.05, 'Menor = mais emoção e variação entre frases; maior = leitura mais uniforme.'],
  ['similarity_boost', 'Similaridade', 0, 1, 0.05, 'Quanto a fala se prende ao timbre original da voz.'],
  ['style', 'Estilo', 0, 1, 0.05, 'Exagera a interpretação. Acima de 0,3 pode soar teatral.'],
  ['speed', 'Velocidade', 0.7, 1.2, 0.01, '1,0 = normal. A referência (KnowLab) fica perto de 1,05.'],
];

function opcoesVoz(VZ, selecionado) {
  const cat = VZ.catalogo || {};
  const grupos = [
    ['Suas vozes pt-BR', (cat.todas || []).filter((v) => v.personalizada)],
    ['Vozes padrão da ElevenLabs', (cat.todas || []).filter((v) => !v.personalizada)],
  ];
  let html = grupos.filter(([, vs]) => vs.length).map(([t, vs]) => `<optgroup label="${esc(t)}">${vs.map((v) => `<option value="elevenlabs:${esc(v.voice_id)}" ${selecionado === `elevenlabs:${v.voice_id}` ? 'selected' : ''}>${esc(v.nome)} · ${esc(GEN[v.genero] || v.genero || '')}</option>`).join('')}</optgroup>`).join('');
  html += `<optgroup label="Offline (Kokoro)">${(cat.kokoro || []).map((v) => `<option value="kokoro:${esc(v.voice_id)}" ${selecionado === `kokoro:${v.voice_id}` ? 'selected' : ''}>${esc(v.nome)}</option>`).join('')}</optgroup>`;
  if (selecionado && !html.includes(`value="${esc(selecionado)}"`)) html = `<option value="${esc(selecionado)}" selected>${esc(selecionado)}</option>` + html;
  return html;
}

function previaMarca(pad, aj) {
  const c = pad.marca_cores || {};
  const y = Number(aj.legenda_y ?? 1400) * 0.25;
  return `<div class="mock" id="mock" style="--prim:${esc(c.primaria || '#ff8a1f')};--sec:${esc(c.secundaria || '#22c55e')};--fundo:${esc(c.fundo || '#1d2127')};--txt:${esc(c.texto || '#fff')}">
    <div class="mock-kicker">${esc((pad.marca_nome || 'MARCA').toUpperCase())} · TEMA</div>
    <div class="mock-cap"><span class="mock-tog"></span><span class="mock-dot"></span>CAPÍTULO</div>
    <div class="mock-card"><small>NÚMEROS</small><b>+500 MIL</b></div>
    <div class="mock-leg" id="mock-leg" style="top:${y}px"><span class="on">A legenda</span> acende</div>
  </div>`;
}

async function paginaConfig() {
  await carregarMenu();
  const [chaves, pl, est, VZ, EX] = await Promise.all([api('/api/chaves'), api('/api/pipeline'), api('/api/estilos'), api('/api/vozes'), api('/api/executor')]);
  window.__ESTILOS = est.estilos; window.__VOZES = VZ;
  const pad = MENU.padroes; const aj = { ...(pad.ajustes || {}) };
  const cat = VZ.catalogo || {};
  // "auto-masculina/feminina" vira a voz automática do catálogo
  let padraoValor = VZ.padrao_voz;
  if (/^elevenlabs:auto-/.test(String(padraoValor))) {
    const a = cat.auto?.[String(padraoValor).endsWith('feminina') ? 'feminina' : 'masculina'];
    if (a) padraoValor = `elevenlabs:${a.voice_id}`;
  }
  const padraoVoz = (cat.todas || []).find((v) => `elevenlabs:${v.voice_id}` === padraoValor) || (cat.kokoro || []).find((v) => `kokoro:${v.voice_id}` === padraoValor);
  const vozAjustes = VZ.voz_ajustes || {};
  const rodadas = VZ.rodadas || [];
  const favIds = new Set((cat.favoritas || []).map((v) => v.voice_id));
  app.innerHTML = `<h1>Configurações</h1><p class="sub">Tudo aqui vira o padrão dos próximos vídeos. O Claude continua perguntando o menu a cada vídeo; estes são os valores que aparecem primeiro.</p>
  <nav class="ancoras">${[['voz', 'Voz'], ['menu', 'Menu'], ['marca', 'Marca'], ['audio', 'Áudio e mixagem'], ['legenda', 'Legenda e render'], ['modelo', 'Modelo'], ['chaves', 'Chaves'], ['modulos', 'Módulos'], ['estilos', 'Estilos'], ['diag', 'Diagnóstico']].map(([k, n]) => `<a href="javascript:void(0)" data-ir="cfg-${k}">${n}</a>`).join('')}</nav>

  <section id="cfg-voz" class="painel secao">
    <div class="linha entre"><h2>Voz</h2><span class="fraco">Padrão atual: <b style="color:var(--texto)">${esc(padraoVoz?.nome || VZ.padrao_voz || '—')}</b></span></div>
    ${!VZ.chave ? '<div class="dica">Configure a chave da ElevenLabs (seção Chaves) para usar vozes da ElevenLabs.</div>' : ''}
    <div class="duas">
      <div class="form">
        <h3>Criar voz brasileira (Voice Design)</h3>
        <p class="fraco" style="font-size:13px;margin:0">Sua chave não pode listar a biblioteca de vozes, então a voz pt-BR nativa é criada a partir de uma descrição. Cada rodada gera 3 prévias e gasta créditos; a voz escolhida entra na sua conta da ElevenLabs e vira o seu padrão.</p>
        <div class="grade-campos">
          <div class="campo"><label>Gênero</label><select id="ds-genero"><option value="masculina">Masculina</option><option value="feminina">Feminina</option></select></div>
          <div class="campo"><label>Modelo de design</label><select id="ds-modelo"><option value="eleven_multilingual_ttv_v2">Multilingual TTV v2</option><option value="eleven_ttv_v3">TTV v3</option></select></div>
        </div>
        <div class="campo"><label>Descrição da voz</label><textarea id="ds-descricao" style="min-height:120px">${esc(VZ.presets?.masculina || '')}</textarea><small>Em inglês funciona melhor. Mantenha "native Brazilian Portuguese speaker".</small></div>
        <div class="campo"><label>Texto das prévias</label><textarea id="ds-texto" style="min-height:70px">${esc(VZ.texto_design || '')}</textarea><small>100 a 1000 caracteres.</small></div>
        <div class="linha"><button class="btn primario" id="ds-gerar" ${VZ.chave ? '' : 'disabled'}>Gerar 3 prévias</button><span class="fraco" id="ds-status" style="font-size:13px"></span></div>
        ${rodadas.length ? rodadas.slice(0, 4).map((r) => `<div class="rodada"><div class="fraco" style="font-size:12px">${esc(GEN[r.genero] || r.genero)} · ${relativo(r.ts)}${r.creditos != null ? ` · ${fmtN(r.creditos)} créditos` : ''}</div>
          ${r.previas.map((pv) => `<div class="previa"><span class="mono fraco">#${pv.ordem}</span><audio src="${pv.url}" controls preload="none"></audio><button class="btn verde" data-usar="${esc(pv.generated_voice_id)}" data-genero="${esc(r.genero)}">Usar esta voz</button></div>`).join('')}</div>`).join('') : '<div class="dica">Nenhuma prévia ainda. Gere uma rodada para ouvir.</div>'}
      </div>
      <div class="form">
        <h3>Ajustes da narração</h3>
        <div class="grade-campos">
          <div class="campo"><label>Voz padrão</label><select id="vz-padrao">${opcoesVoz(VZ, padraoValor)}</select></div>
          <div class="campo"><label>Modelo de fala</label><select id="vz-modelo">${MODELOS_VOZ.map(([v, n]) => `<option value="${v}" ${VZ.modelo_voz === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        ${AJUSTES_VOZ.map(([k, n, a, b, s, d]) => `<div class="campo"><label>${n}: <span class="mono" id="vz-v-${k}">${vozAjustes[k] ?? ''}</span></label><input type="range" id="vz-${k}" min="${a}" max="${b}" step="${s}" value="${vozAjustes[k] ?? (k === 'speed' ? 1 : 0.5)}"><small>${esc(d)}</small></div>`).join('')}
        <label class="toggle"><input type="checkbox" id="vz-boost" ${vozAjustes.use_speaker_boost !== false ? 'checked' : ''}><span>Reforço de timbre (speaker boost)</span></label>
        <label class="toggle"><input type="checkbox" id="vz-verificar" ${aj.voz_verificar !== false ? 'checked' : ''}><span>Conferir a pronúncia com Whisper depois de gerar</span></label>
        <div class="campo"><label>Texto para ouvir as vozes</label><input type="text" id="vz-texto" value="${esc(VZ.texto_amostra || '')}"><small>Amostras ficam guardadas: ouvir de novo com os mesmos ajustes não gasta crédito.</small></div>
        <div class="linha"><button class="btn primario" id="vz-salvar">Salvar ajustes da voz</button></div>
        <h3 style="margin-top:10px">Catálogo</h3>
        <table class="tabela"><tr><th title="Favoritas aparecem como opções no menu do chat (até 4)">★</th><th>Voz</th><th>Origem</th><th title="Voz automática masculina">♂</th><th title="Voz automática feminina">♀</th><th></th></tr>
          ${(cat.todas || []).map((v) => `<tr>
            <td><input type="checkbox" class="vz-fav" value="${esc(v.voice_id)}" ${favIds.has(v.voice_id) ? 'checked' : ''}></td>
            <td><b>${esc(v.nome)}</b> <span class="fraco" style="font-size:12px">${esc(GEN[v.genero] || '')}</span><br><span class="mono fraco" style="font-size:11px">${esc(v.voice_id)}</span><div class="fraco" style="font-size:12px">${esc(v.descricao || '')}</div><audio class="vz-audio" id="au-${esc(v.voice_id)}" controls preload="none" hidden></audio></td>
            <td class="fraco" style="font-size:12px">${esc(v.origem || '')}</td>
            <td><input type="radio" name="vz-auto-m" value="${esc(v.voice_id)}" ${cat.auto?.masculina?.voice_id === v.voice_id ? 'checked' : ''}></td>
            <td><input type="radio" name="vz-auto-f" value="${esc(v.voice_id)}" ${cat.auto?.feminina?.voice_id === v.voice_id ? 'checked' : ''}></td>
            <td style="white-space:nowrap"><button class="btn" data-ouvir="${esc(v.voice_id)}" ${VZ.chave ? '' : 'disabled'}>▶ Ouvir</button>${v.personalizada ? ` <button class="btn perigo" data-remover="${esc(v.voice_id)}">✕</button>` : ''}</td></tr>`).join('')}
        </table>
        <div class="linha"><button class="btn" id="vz-pref">Salvar favoritas e vozes automáticas</button></div>
        <h3 style="margin-top:10px">Adicionar por voice_id</h3>
        <p class="fraco" style="font-size:13px;margin:0">Achou uma voz brasileira na Voice Library do site? Clique em "Add to My Voices", copie o ID e cole aqui.</p>
        <div class="grade-campos">
          <div class="campo"><label>voice_id</label><input type="text" id="ad-id" placeholder="ex.: 21m00Tcm4TlvDq8ikWAM"></div>
          <div class="campo"><label>Nome</label><input type="text" id="ad-nome" placeholder="como vai aparecer no menu"></div>
          <div class="campo"><label>Gênero</label><select id="ad-genero"><option value="male">Masculina</option><option value="female">Feminina</option></select></div>
        </div>
        <div class="linha"><button class="btn" id="ad-adicionar" ${VZ.chave ? '' : 'disabled'}>Adicionar e testar</button></div>
      </div>
    </div>
  </section>

  <form id="cfg-menu" class="painel form secao"><h2>Menu de montagem (padrões)</h2>
    ${MENU.menu.lotes.map((l) => `<div class="grupo-titulo">${esc(l.titulo)}</div><div class="grade-campos">${MENU.menu.perguntas.filter((q) => q.lote === l.id).map((q) => campoMenu(q, pad.respostas?.[q.id], `pad-${q.id}`)).join('')}</div>`).join('')}
    <div class="linha"><button class="btn primario" type="submit">Salvar padrões do menu</button></div>
  </form>

  <section id="cfg-marca" class="painel secao"><h2>Marca</h2>
    <div class="duas"><div class="form">
      <div class="campo"><label>Nome no selo do topo</label><input type="text" id="mc-nome" value="${esc(pad.marca_nome || '')}"></div>
      <div class="grade-campos">
        ${[['primaria', 'Destaque (números, cartões)'], ['secundaria', 'Secundária (CTA, ponto do capítulo)'], ['fundo', 'Fundo das caixas'], ['texto', 'Texto']].map(([k, n]) => `<div class="campo"><label>${n}</label><div class="linha"><input type="color" id="mc-${k}" value="${esc(pad.marca_cores?.[k] || '#ffffff')}"><span class="mono fraco" id="mc-v-${k}">${esc(pad.marca_cores?.[k] || '')}</span></div></div>`).join('')}
      </div>
      <p class="fraco" style="font-size:13px">As cores da marca entram nos vídeos que usam a paleta "Cores da marca" (escolha no menu ou em Menu de montagem).</p>
      <div class="linha"><button class="btn primario" id="mc-salvar">Salvar marca</button></div>
    </div><div>${previaMarca(pad, aj)}</div></div>
  </section>

  <section id="cfg-audio" class="painel secao form"><h2>Áudio e mixagem</h2>
    <div class="grade-campos">
      ${[['musica_rel', 'Música em relação à voz (dB)', -14, 0, 0.5, -4.5, 'Volume da música quando ninguém fala. Mais perto de 0 = mais presente.'], ['musica_abaixa', 'Quanto a música abaixa na fala (dB)', 0, 10, 0.5, 3.5, 'Abaixa com suavidade e segura entre frases, sem bombear. Na fala ela fica no valor de cima menos este.'], ['musica_bolsao', 'Espaço para a voz (dB)', 0, 6, 0.5, 3, 'Corte suave na faixa da voz dentro da música: a narração fica clara mesmo com a música mais alta.'], ['lufs', 'Loudness final (LUFS)', -18, -10, 0.5, -14, 'Reels/TikTok ficam em -14.']].map(([k, n, a, b, s, d, h]) => `<div class="campo"><label>${n}: <span class="mono" id="au-v-${k}">${aj[k] ?? d}</span></label><input type="range" id="au-${k}" min="${a}" max="${b}" step="${s}" value="${aj[k] ?? d}"><small>${h}</small></div>`).join('')}
      ${[['lead_in_s', 'Silêncio antes da 1ª fala (s)', 0, 1, 0.05, pad.lead_in_s ?? 0.25], ['cauda_s', 'Silêncio depois da última fala (s)', 0, 1.5, 0.05, pad.cauda_s ?? 0.45], ['palavras_por_segundo', 'Palavras por segundo (estimativa do roteiro)', 2, 3.5, 0.05, pad.palavras_por_segundo ?? 2.75]].map(([k, n, a, b, s, v]) => `<div class="campo"><label>${n}: <span class="mono" id="au-v-${k}">${v}</span></label><input type="range" id="au-${k}" min="${a}" max="${b}" step="${s}" value="${v}"></div>`).join('')}
      <div class="campo"><label>Modelo de música (ElevenLabs)</label><select id="au-musica_modelo">${['music_v1', 'music_v2', 'music_v2_5'].map((m) => `<option ${aj.musica_modelo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="campo"><label>Prompt fixo da música (opcional)</label><textarea id="au-musica_prompt" placeholder="Vazio = o motor monta a partir do estilo e do tom de cada vídeo.">${esc(aj.musica_prompt || '')}</textarea></div>
    <div class="linha"><button class="btn primario" id="au-salvar">Salvar áudio</button></div>
  </section>

  <section id="cfg-legenda" class="painel secao"><h2>Legenda e render</h2>
    <div class="duas"><div class="form">
      <div class="campo"><label>Altura da legenda: <span class="mono" id="lg-v-y">${aj.legenda_y ?? 1400}</span> px de 1920</label><input type="range" id="lg-y" min="1100" max="1650" step="10" value="${aj.legenda_y ?? 1400}"><small>A referência fica em ~1400 px. Abaixo de ~1550 px a interface do Instagram pode cobrir.</small></div>
      <div class="campo"><label>Qualidade do render</label><select id="lg-qualidade">${[['draft', 'Rascunho (rápido)'], ['looks', 'Boa (padrão)'], ['delivery', 'Entrega (máxima)']].map(([v, n]) => `<option value="${v}" ${aj.qualidade_render === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="campo"><label>Processos de render (workers)</label><select id="lg-workers">${['auto', '1', '2', '3', '4', '6'].map((w) => `<option ${String(aj.workers ?? 'auto') === w ? 'selected' : ''}>${w}</option>`).join('')}</select><small>Mais workers = mais rápido, mais memória (cada um abre um Chrome).</small></div>
      <div class="campo"><label>Rodadas automáticas do agente revisor</label><select id="lg-rodadas">${['1', '2', '3', '4'].map((n) => `<option ${String(aj.revisor_rodadas ?? 2) === n ? 'selected' : ''}>${n}</option>`).join('')}</select><small>No modo "Revisar e corrigir", quantas vezes o revisor e o Claude podem ir e voltar antes de entregar. Se o revisor fica ligado ou não é a pergunta "Revisor" do menu.</small></div>
      <div class="linha"><button class="btn primario" id="lg-salvar">Salvar legenda e render</button></div>
    </div><div class="fraco" style="font-size:13px">A prévia ao lado (em Marca) mostra a altura da legenda.</div></div>
  </section>

  <form id="cfg-modelo" class="painel form secao"><h2>Modelo (quem faz roteiro, storyboard e mundo 3D)</h2>
    <div class="dica">No modo <b>Claude Code</b> (padrão) você conversa com o Claude Code na pasta do projeto e ele usa a skill. Nos modos por <b>API</b>, o próprio painel opera tudo: você cria o vídeo em "Novo vídeo", aprova o roteiro e revisa as cenas aqui, e o modelo escolhido faz o resto. ${EX.operador_api ? '<span class="selo pronto">operador por API rodando</span>' : ''}</div>
    <div class="campo"><label>Modo</label><select name="modo">
      ${[['claude-code', 'Claude Code (assinatura; conversa no terminal)'], ['anthropic', 'API da Anthropic (Claude por chave de API)'], ['openai', 'API compatível com OpenAI (OpenAI, OpenRouter, Groq, Ollama, LM Studio…)']].map(([v, n]) => `<option value="${v}" ${EX.modo === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="campo"><label>Anthropic: modelo</label><input name="a_modelo" value="${esc(EX.anthropic.modelo)}" placeholder="claude-opus-5-5"><span class="fraco" style="font-size:12px">ex.: claude-opus-5-5 (melhor), claude-sonnet-5-5 (mais barato), claude-haiku-5-5 (o mais barato)</span></div>
    <div class="campo"><label>Anthropic: esforço</label><select name="a_esforco">${['low', 'medium', 'high', 'xhigh', 'max'].map((v) => `<option ${EX.anthropic.esforco === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <label class="toggle"><input type="checkbox" name="a_busca" ${EX.anthropic.busca_web ? 'checked' : ''}><span>Busca na web do próprio Claude (para checar fatos do roteiro)</span></label>
    <div class="campo"><label>OpenAI-compatível: endereço base</label><input name="o_base" value="${esc(EX.openai.base_url)}" placeholder="https://api.openai.com/v1"><span class="fraco" style="font-size:12px">OpenRouter: https://openrouter.ai/api/v1 · Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</span></div>
    <div class="campo"><label>OpenAI-compatível: modelo</label><input name="o_modelo" value="${esc(EX.openai.modelo)}" placeholder="gpt-5"></div>
    <label class="toggle"><input type="checkbox" name="o_visao" ${EX.openai.visao ? 'checked' : ''}><span>O modelo enxerga imagens (para conferir os quadros do vídeo)</span></label>
    <div class="campo"><label>Limite de passos por etapa</label><input type="number" name="max_passos" min="10" max="400" value="${EX.max_passos}"><span class="fraco" style="font-size:12px">Trava de custo: chamadas de ferramenta permitidas em cada etapa.</span></div>
    <div class="linha"><button class="btn primario" type="submit">Salvar modelo</button></div>
  </form>

  <form id="cfg-chaves" class="painel form secao"><h2>Chaves de API</h2>
    <div class="dica">As chaves ficam só no arquivo <code>.env</code> da skill, nesta máquina. O painel nunca mostra o valor de volta.</div>
    <div class="campo"><label>ElevenLabs ${chaves.ELEVENLABS_API_KEY ? '<span class="selo pronto">configurada</span>' : '<span class="selo">ausente</span>'}</label><input type="password" name="ELEVENLABS_API_KEY" placeholder="${chaves.ELEVENLABS_API_KEY ? 'deixe vazio para manter' : 'cole a chave aqui'}" autocomplete="off"></div>
    <div class="campo"><label>Anthropic (modo API) ${chaves.ANTHROPIC_API_KEY ? '<span class="selo pronto">configurada</span>' : '<span class="selo">ausente</span>'}</label><input type="password" name="ANTHROPIC_API_KEY" placeholder="${chaves.ANTHROPIC_API_KEY ? 'deixe vazio para manter' : 'sk-ant-…'}" autocomplete="off"></div>
    <div class="campo"><label>OpenAI-compatível (modo API) ${chaves.OPENAI_API_KEY ? '<span class="selo pronto">configurada</span>' : '<span class="selo">ausente</span>'}</label><input type="password" name="OPENAI_API_KEY" placeholder="${chaves.OPENAI_API_KEY ? 'deixe vazio para manter' : 'chave do provedor (Ollama local não precisa)'}" autocomplete="off"></div>
    <div class="campo"><label>Gemini (opcional, colagem gbro original) ${chaves.GEMINI_API_KEY ? '<span class="selo pronto">configurada</span>' : '<span class="selo">ausente</span>'}</label><input type="password" name="GEMINI_API_KEY" placeholder="opcional" autocomplete="off"></div>
    <div class="linha"><button class="btn primario" type="submit">Salvar chaves</button></div>
  </form>

  <form id="cfg-modulos" class="painel secao"><h2>Módulos do pipeline</h2><p class="fraco" style="font-size:13px">Estágios opcionais podem ser desligados. Para trocar um módulo, edite <code>config/pipeline.json</code>.</p>
    ${pl.estagios.map((e) => `<label class="toggle"><input type="checkbox" name="${esc(e.id)}" ${e.ativo !== false ? 'checked' : ''} ${e.opcional ? '' : 'disabled'}><span><b>${esc(e.nome)}</b> <span class="fraco mono" style="font-size:11px">${esc(e.modulo || e.executor)}</span><br><span class="fraco" style="font-size:12px">${esc(e.descricao || '')}</span></span></label>`).join('')}
    <div class="linha" style="margin-top:8px"><button class="btn" type="submit">Salvar módulos</button></div>
  </form>

  <section id="cfg-estilos" class="painel secao"><h2>Estilos disponíveis (${est.estilos.length})</h2><p class="fraco" style="font-size:13px">Os da casa e os 66 do lemo-opuscar. No menu, escolha pelo nome ou digite <code>lemo:&lt;pasta&gt;</code>.</p>
    <div class="estilos">${est.estilos.map((e) => `<div class="estilo" title="${esc(e.descricao)}"><div class="p" style="${e.poster ? `background-image:url('${e.poster}')` : 'background:linear-gradient(135deg,#ff8a1f33,#3b82f633)'}"></div><div class="n">${esc(e.nome)}<small>${esc(e.id)}</small></div></div>`).join('')}</div></section>

  <section id="cfg-diag" class="painel secao"><div class="linha entre"><h2>Diagnóstico</h2><button class="btn" id="btn-doctor">Rodar</button></div><div id="doctor" class="fraco" style="font-size:13px">Clique em Rodar para conferir dependências.</div></section>`;

  // navegação interna
  app.querySelectorAll('[data-ir]').forEach((a) => a.onclick = () => document.getElementById(a.dataset.ir)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  // sliders mostram o valor
  app.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    const alvo = document.getElementById(r.id.replace(/^(vz|au)-/, '$1-v-')); if (alvo) alvo.textContent = r.value;
  }));
  const ajustesAtuais = () => ({
    stability: Number($('#vz-stability').value), similarity_boost: Number($('#vz-similarity_boost').value),
    style: Number($('#vz-style').value), speed: Number($('#vz-speed').value), use_speaker_boost: $('#vz-boost').checked,
  });
  // Voice Design
  $('#ds-genero').onchange = () => { $('#ds-descricao').value = VZ.presets?.[$('#ds-genero').value] || ''; };
  $('#ds-gerar').onclick = async () => {
    const b = $('#ds-gerar'); b.disabled = true; $('#ds-status').textContent = 'Gerando na ElevenLabs (pode levar ~30 s)…';
    try {
      const r = await api('/api/vozes/design', { method: 'POST', body: { genero: $('#ds-genero').value, descricao: $('#ds-descricao').value, texto: $('#ds-texto').value, modelo: $('#ds-modelo').value } });
      avisar(`${r.previas.length} prévias prontas${r.creditos != null ? ` (${fmtN(r.creditos)} créditos)` : ''}. Ouça e clique em "Usar esta voz".`);
      paginaConfig();
    } catch (e) { avisar(e.message, true); b.disabled = false; $('#ds-status').textContent = ''; }
  };
  app.querySelectorAll('[data-usar]').forEach((b) => b.onclick = async () => {
    const genero = b.dataset.genero || 'masculina';
    const nome = prompt('Nome da voz (aparece no menu):', genero === 'feminina' ? 'Narradora BR' : 'Narrador BR');
    if (!nome) return;
    b.disabled = true; avisar('Salvando a voz na sua conta da ElevenLabs…');
    try { await api('/api/vozes/design/salvar', { method: 'POST', body: { generated_voice_id: b.dataset.usar, nome, genero, padrao: true } }); MENU = null; avisar(`"${nome}" salva e definida como voz padrão.`); paginaConfig(); }
    catch (e) { avisar(e.message, true); b.disabled = false; }
  });
  // ouvir amostras
  app.querySelectorAll('[data-ouvir]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.ouvir; const au = document.getElementById(`au-${id}`);
    b.disabled = true; b.textContent = '…';
    try {
      const r = await api('/api/vozes/amostra', { method: 'POST', body: { voice_id: id, texto: $('#vz-texto').value, modelo: $('#vz-modelo').value, ajustes: ajustesAtuais() } });
      au.hidden = false; au.src = r.url; au.play().catch(() => {});
      if (!r.cache) avisar(`Amostra gerada${r.creditos != null ? ` (${fmtN(r.creditos)} créditos)` : ''}.`);
    } catch (e) { avisar(e.message, true); }
    b.disabled = false; b.textContent = '▶ Ouvir';
  });
  app.querySelectorAll('[data-remover]').forEach((b) => b.onclick = async () => {
    if (!confirm('Tirar esta voz do catálogo do Estúdio? (ela continua na sua conta da ElevenLabs)')) return;
    await api('/api/vozes/remover', { method: 'POST', body: { voice_id: b.dataset.remover } }); paginaConfig();
  });
  $('#vz-salvar').onclick = async () => {
    try {
      await api('/api/padroes', { method: 'POST', body: { respostas: { voz: $('#vz-padrao').value, modelo_voz: $('#vz-modelo').value }, voz_ajustes: ajustesAtuais(), ajustes: { voz_verificar: $('#vz-verificar').checked } } });
      MENU = null; avisar('Ajustes da voz salvos.'); paginaConfig();
    } catch (e) { avisar(e.message, true); }
  };
  $('#vz-pref').onclick = async () => {
    const favoritas = [...app.querySelectorAll('.vz-fav:checked')].map((c) => c.value);
    if (favoritas.length > 4) return avisar('Escolha no máximo 4 favoritas (o menu do chat mostra 4 opções).', true);
    const auto = { masculina: app.querySelector('input[name=vz-auto-m]:checked')?.value, feminina: app.querySelector('input[name=vz-auto-f]:checked')?.value };
    try { await api('/api/vozes/preferencias', { method: 'POST', body: { favoritas, auto } }); MENU = null; avisar('Favoritas e vozes automáticas salvas.'); paginaConfig(); }
    catch (e) { avisar(e.message, true); }
  };
  $('#ad-adicionar').onclick = async () => {
    const b = $('#ad-adicionar'); b.disabled = true;
    try { await api('/api/vozes/adicionar', { method: 'POST', body: { voice_id: $('#ad-id').value.trim(), nome: $('#ad-nome').value.trim(), genero: $('#ad-genero').value, testar: true } }); avisar('Voz adicionada e testada.'); paginaConfig(); }
    catch (e) { avisar(e.message, true); b.disabled = false; }
  };
  // menu
  $('#cfg-menu').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    const respostas = {}; for (const q of MENU.menu.perguntas) if (f[q.id] !== undefined) respostas[q.id] = f[q.id];
    try { await api('/api/padroes', { method: 'POST', body: { respostas } }); MENU = null; avisar('Padrões do menu salvos.'); } catch (e) { avisar(e.message, true); }
  };
  // marca com prévia ao vivo
  const mock = $('#mock');
  for (const k of ['primaria', 'secundaria', 'fundo', 'texto']) {
    $(`#mc-${k}`).addEventListener('input', (ev) => { $(`#mc-v-${k}`).textContent = ev.target.value; mock.style.setProperty({ primaria: '--prim', secundaria: '--sec', fundo: '--fundo', texto: '--txt' }[k], ev.target.value); });
  }
  $('#mc-nome').addEventListener('input', (ev) => { mock.querySelector('.mock-kicker').textContent = `${(ev.target.value || 'MARCA').toUpperCase()} · TEMA`; });
  $('#mc-salvar').onclick = async () => {
    const cores = {}; for (const k of ['primaria', 'secundaria', 'fundo', 'texto']) cores[k] = $(`#mc-${k}`).value;
    try { await api('/api/padroes', { method: 'POST', body: { marca_nome: $('#mc-nome').value, marca_cores: cores } }); MENU = null; avisar('Marca salva.'); } catch (e) { avisar(e.message, true); }
  };
  // áudio
  $('#au-salvar').onclick = async () => {
    const n = (id) => Number($(`#au-${id}`).value);
    try {
      await api('/api/padroes', { method: 'POST', body: { ajustes: { musica_rel: n('musica_rel'), musica_abaixa: n('musica_abaixa'), musica_bolsao: n('musica_bolsao'), lufs: n('lufs'), musica_modelo: $('#au-musica_modelo').value, musica_prompt: $('#au-musica_prompt').value.trim() }, lead_in_s: n('lead_in_s'), cauda_s: n('cauda_s'), palavras_por_segundo: n('palavras_por_segundo') } });
      MENU = null; avisar('Áudio salvo.');
    } catch (e) { avisar(e.message, true); }
  };
  // legenda e render (a prévia da marca mostra a altura)
  $('#lg-y').addEventListener('input', (ev) => { $('#lg-v-y').textContent = ev.target.value; $('#mock-leg').style.top = `${Number(ev.target.value) * 0.25}px`; });
  $('#lg-salvar').onclick = async () => {
    try { await api('/api/padroes', { method: 'POST', body: { ajustes: { legenda_y: Number($('#lg-y').value), qualidade_render: $('#lg-qualidade').value, workers: $('#lg-workers').value, revisor_rodadas: Number($('#lg-rodadas').value) } } }); MENU = null; avisar('Legenda e render salvos.'); }
    catch (e) { avisar(e.message, true); }
  };
  // chaves, módulos, diagnóstico
  $('#cfg-chaves').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    try { await api('/api/chaves', { method: 'POST', body: f }); avisar('Chaves salvas no .env.'); paginaConfig(); } catch (e) { avisar(e.message, true); }
  };
  $('#cfg-modelo').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const corpo = { modo: f.modo.value, max_passos: Number(f.max_passos.value),
      anthropic: { modelo: f.a_modelo.value.trim(), esforco: f.a_esforco.value, busca_web: f.a_busca.checked },
      openai: { base_url: f.o_base.value.trim(), modelo: f.o_modelo.value.trim(), visao: f.o_visao.checked } };
    try { const r = await api('/api/executor', { method: 'POST', body: corpo }); avisar(r.modo === 'claude-code' ? 'Modelo salvo: Claude Code.' : `Modelo salvo. Operador por API ${r.operador_api ? 'rodando' : 'parado'}.`); paginaConfig(); } catch (e) { avisar(e.message, true); }
  };
  $('#cfg-modulos').onsubmit = async (ev) => {
    ev.preventDefault();
    const ativos = {}; ev.target.querySelectorAll('input[type=checkbox]').forEach((c) => (ativos[c.name] = c.checked));
    try { await api('/api/pipeline', { method: 'POST', body: { ativos } }); PIPELINE = (await api('/api/pipeline')).estagios; avisar('Módulos salvos.'); } catch (e) { avisar(e.message, true); }
  };
  $('#btn-doctor').onclick = async () => {
    $('#doctor').textContent = 'Verificando…';
    const { itens } = await api('/api/doctor');
    $('#doctor').innerHTML = itens.map((i) => `<div>${i.ok ? '✅' : i.opcional || /opcional/.test(i.nome) ? '⚪' : '❌'} ${esc(i.nome)} <span class="fraco">${esc(i.detalhe || '')}</span>${!i.ok && i.dica ? `<br><span class="fraco">→ ${esc(i.dica)}</span>` : ''}</div>`).join('');
  };
}

async function paginaUso() {
  const u = await api('/api/uso');
  const vs = u.videos.filter((v) => v.tokens);
  const max = Math.max(1, ...vs.map((v) => v.tokens.total));
  const el = u.elevenlabs;
  app.innerHTML = `<div class="linha entre"><div><h1>Uso e custos</h1><p class="sub">Tokens do Claude atribuídos a cada vídeo (dos transcripts do Claude Code) e consumo da ElevenLabs.</p></div><button class="btn" id="btn-recalc">Recalcular tokens</button></div>
    <div class="numeros">
      <div class="numero"><div class="r">Tokens totais</div><div class="v">${fmtN(u.total.total)}</div></div>
      <div class="numero"><div class="r">Custo equivalente</div><div class="v">${fmtUSD(u.total.custo_usd)}</div></div>
      <div class="numero"><div class="r">Vídeos</div><div class="v">${u.videos.length}</div></div>
      <div class="numero"><div class="r">Média por vídeo</div><div class="v">${vs.length ? fmtUSD(u.total.custo_usd / vs.length) : '—'}</div></div>
    </div>
    <div class="duas"><div class="painel"><h2>Por vídeo</h2>${vs.length ? `<div class="barras-h">${vs.map((v) => `<div class="barra-h"><a href="#/v/${encodeURIComponent(v.id)}" title="${esc(v.titulo)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.titulo || v.id)}</a><div class="trilha-b"><span style="width:${(v.tokens.total / max) * 100}%"></span></div><span class="v">${fmtN(v.tokens.total)} · ${fmtUSD(v.tokens.custo_usd)}</span></div>`).join('')}</div>` : '<p class="fraco">Sem dados ainda.</p>'}</div>
    <div class="painel"><h2>ElevenLabs</h2>${el && !el.erro ? `<p>Plano <b>${esc(el.plano)}</b>: ${fmtN(el.caracteres_usados)} de ${fmtN(el.limite)} caracteres${el.renova_em ? ` · renova ${new Date(el.renova_em).toLocaleDateString('pt-BR')}` : ''}</p><div class="barra"><span style="width:${Math.min(100, (el.caracteres_usados / Math.max(1, el.limite)) * 100)}%"></span></div>` : el?.erro ? (/user_read/.test(el.erro) ? `<p class="fraco">A chave não tem a permissão <code>user_read</code>, então o saldo do plano não aparece aqui. Os créditos gastos em cada vídeo continuam registrados (aba Custos do vídeo).</p>` : `<p class="fraco">${esc(el.erro)}</p>`) : '<p class="fraco">Configure a chave em Configurações para ver o saldo.</p>'}
      <h3 style="margin-top:16px">Caracteres por vídeo</h3>${u.videos.filter((v) => v.elevenlabs).map((v) => `<div class="linha entre" style="font-size:13px"><span>${esc(v.titulo || v.id)}</span><span class="mono">${fmtN(v.elevenlabs)}</span></div>`).join('') || '<p class="fraco">—</p>'}
      <p class="fraco" style="font-size:12px;margin-top:14px">${esc(u.precos?.obs || '')}</p></div></div>`;
  $('#btn-recalc').onclick = async () => { avisar('Recalculando (lê os transcripts)…'); await api('/api/tokens', { method: 'POST', body: {} }); paginaUso(); };
}

async function paginaFila() {
  const { pedidos, operador: op } = await api('/api/fila');
  operador(op);
  app.innerHTML = `<h1>Fila do Claude</h1><p class="sub">O que você pede aqui vira um pedido para o Claude da máquina.</p>
    <div class="painel" style="margin-bottom:18px">${op.ativo ? `<b style="color:var(--verde)">Um Claude está escutando</b> (sessão ${esc(String(op.sessao || '').slice(0, 8))}, ${esc(op.esperando || '')}).` : `<b>Nenhum Claude escutando agora.</b> Para o Claude operar o painel, abra o Claude Code na pasta da skill e diga: <code>/estudio-de-reels opera o painel</code>. Ele fica ouvindo a fila em segundo plano.`}</div>
    <div class="painel"><table class="tabela"><tr><th>Quando</th><th>Ação</th><th>Vídeo</th><th>Status</th><th>Detalhe</th></tr>
    ${pedidos.map((p) => `<tr><td>${relativo(p.criado_em)}</td><td class="mono">${esc(p.acao)}</td><td>${p.video ? `<a href="#/v/${encodeURIComponent(p.video)}" style="color:var(--azul)">${esc(p.video)}</a>` : '—'}</td><td><span class="selo ${p.status === 'concluido' ? 'pronto' : p.status === 'erro' ? 'erro' : p.status === 'pendente' ? 'usuario' : 'andamento'}">${esc(p.status)}</span></td><td class="fraco" style="font-size:13px">${esc(p.payload?.notas || p.payload?.texto || p.payload?.prompt || p.resultado || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="fraco">Nenhum pedido.</td></tr>'}</table></div>`;
}

// ---------------- roteamento e atualização ao vivo ----------------
async function rotear() {
  const h = location.hash || '#/';
  estadoUI.rota = h;
  document.querySelectorAll('.abas a').forEach((a) => a.classList.toggle('ativa', (h === '#/' && a.dataset.rota === 'videos') || (h.startsWith('#/v/') && a.dataset.rota === 'videos') || h === `#/${a.dataset.rota}`));
  const revisar = h.startsWith('#/v/') && h.endsWith('/revisar');
  if (!revisar) sairRevisao();
  try {
    if (!PIPELINE.length) PIPELINE = (await api('/api/pipeline')).estagios;
    if (revisar) return await paginaRevisar(decodeURIComponent(h.slice(4, -'/revisar'.length)), { api, avisar, esc, app, relativo, blocoComando });
    if (h.startsWith('#/v/')) return await paginaVideo(decodeURIComponent(h.slice(4)));
    if (h === '#/novo') return await paginaNovo();
    if (h === '#/config') return await paginaConfig();
    if (h === '#/uso') return await paginaUso();
    if (h === '#/fila') return await paginaFila();
    return await paginaVideos();
  } catch (e) { app.innerHTML = `<div class="vazio">Erro: ${esc(e.message)}</div>`; }
  finally { atualizarAviso(); }
}
window.addEventListener('hashchange', rotear);

let pendenteAtualizar = null;
function aoVivo() {
  const es = new EventSource('/api/eventos');
  es.onmessage = () => {
    clearTimeout(window.__avisoT); window.__avisoT = setTimeout(atualizarAviso, 400);
    // não redesenha formulários enquanto você digita, nem players tocando
    const ativo = document.activeElement;
    const tocando = [...document.querySelectorAll('video, audio')].some((m) => !m.paused);
    if (['#/novo', '#/config'].includes(estadoUI.rota)) return;
    // a sua revisão se atualiza sozinha, sem redesenhar por cima do que você está marcando
    if (estadoUI.rota.endsWith('/revisar')) { revisaoAoVivo(); return; }
    if ((ativo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ativo.tagName)) || tocando) return;
    clearTimeout(pendenteAtualizar);
    pendenteAtualizar = setTimeout(() => { const y = scrollY; rotear().then(() => scrollTo(0, y)); }, 300);
  };
}
setInterval(async () => { try { const { operador: op } = await api('/api/fila'); operador(op); } catch {} }, 15000);
rotear(); aoVivo();
setInterval(() => document.querySelectorAll('[data-desde]').forEach((el) => { el.textContent = tempoDesde(el.dataset.desde); }), 1000);
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-copiar]');
  if (b) navigator.clipboard.writeText(b.dataset.copiar).then(() => avisar('Copiado. Cole no Claude Code.')).catch(() => avisar(b.dataset.copiar));
});
// a situação depende do relógio (ex.: "Claude parou há 10 min"): redesenha de tempos em tempos
setInterval(() => {
  const ativo = document.activeElement;
  const tocando = [...document.querySelectorAll('video, audio')].some((m) => !m.paused);
  if (['#/novo', '#/config'].includes(estadoUI.rota) || estadoUI.rota.endsWith('/revisar') || tocando || (ativo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ativo.tagName))) return;
  const y = scrollY; rotear().then(() => scrollTo(0, y));
}, 30000);
api('/api/fila').then(({ operador: op }) => operador(op)).catch(() => {});
