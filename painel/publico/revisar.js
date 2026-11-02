// Sua revisão: o vídeo pronto, cena a cena (rota #/v/<id>/revisar).
// Você marca cada cena como "boa" ou "mudar algo" (o tipo do problema + o que quer), deixa um comentário geral
// e aprova (→ entrega) ou envia os ajustes ao Claude. O rascunho é salvo sozinho no servidor e no navegador.

const TIPOS_ORDEM = ['imagem', 'tela', 'legenda', 'narracao', 'voz', 'audio', 'ritmo'];
const ICONE = { imagem: '🎬', tela: '🔤', legenda: '💬', narracao: '📝', voz: '🗣', audio: '🎵', ritmo: '⏱' };
const DE_CATEGORIA = { visual: 'imagem', loop: 'imagem', overlay: 'tela', legenda: 'legenda', texto: 'narracao', fato: 'narracao', audio: 'audio', ritmo: 'ritmo' };
const RESP = { feito: ['✓ feito', 'ok'], parcial: ['◐ em parte', 'parcial'], nao_feito: ['✕ não feito', 'nao'] };
const VELOCIDADES = [1, 0.75, 0.5];

let H = null; // helpers do app: api, avisar, esc, app, relativo, blocoComando
let C = null; // controlador da página aberta
let assinatura = '';
let ultimaChecagem = 0;

const tempo = (s) => {
  if (s == null || !Number.isFinite(Number(s))) return '—';
  const v = Math.max(0, Number(s)); const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
};
const assinar = (RV) => `${RV?.atual?.rodada || 0}:${RV?.atual?.decisao || ''}:${RV?.esperando_voce}:${RV?.com_claude}:${RV?.status}`;
const idDaRota = (h) => decodeURIComponent(h.slice(4, -'/revisar'.length));

// ---------- entrada e saída da página ----------
export function sairRevisao() {
  if (!C) return;
  try { C.flush?.(); } catch {}
  try { C.video?.pause(); } catch {}
  if (C.teclas) document.removeEventListener('keydown', C.teclas, true);
  if (C.rolagem) { window.removeEventListener('wheel', C.rolagem); window.removeEventListener('touchmove', C.rolagem); }
  C.vivo = false; C = null;
}

export async function paginaRevisar(id, helpers) {
  H = helpers;
  sairRevisao();
  const d = await H.api(`/api/videos/${encodeURIComponent(id)}`);
  const RV = d.revisao_usuario;
  assinatura = assinar(RV);
  const cab = cabecalho(d, RV);
  if (!RV || !RV.ativo) {
    H.app.innerHTML = `<div class="rv">${cab}<div class="situacao"><div class="agora-acao">A sua revisão está desligada.</div><div class="agora-status">Ligue em <a href="#/config" style="text-decoration:underline">Configurações → Módulos do pipeline → "Sua revisão"</a>. Os vídeos novos passam a parar para você revisar cena a cena antes da entrega.</div></div></div>`;
    return;
  }
  if (RV.esperando_voce && RV.atual && !RV.atual.decisao) return editor(d, RV, cab);
  return leitura(d, RV, cab);
}

// O painel avisa quando algo muda nos arquivos: aqui só recarrega se a rodada mudou, e nunca por cima do que você está marcando.
export async function revisaoAoVivo() {
  if (!H || !location.hash.endsWith('/revisar')) return;
  const espera = 1500 - (Date.now() - ultimaChecagem);
  if (espera > 0) { clearTimeout(revisaoAoVivo.t); revisaoAoVivo.t = setTimeout(revisaoAoVivo, espera + 50); return; }
  ultimaChecagem = Date.now();
  const id = idDaRota(location.hash);
  let d; try { d = await H.api(`/api/videos/${encodeURIComponent(id)}`); } catch { return; }
  if (assinar(d.revisao_usuario) === assinatura) return;
  if (C?.vivo && C.editor) {
    const el = document.getElementById('rv-aviso-novo');
    if (el) {
      el.hidden = false;
      el.innerHTML = `⚠ Esta rodada mudou fora daqui (decidida no chat ou chegou uma versão nova). <button class="btn" data-rv-recarregar>Recarregar</button>`;
      el.querySelector('[data-rv-recarregar]').onclick = () => paginaRevisar(id, H);
    }
    return;
  }
  const y = scrollY; await paginaRevisar(id, H); scrollTo(0, y);
}

// ---------- partes comuns ----------
function cabecalho(d, RV) {
  const n = RV?.atual?.rodada;
  return `<div class="rv-cabecalho"><div>
      <div class="kicker"><a href="#/">Vídeos</a> / <a href="#/v/${encodeURIComponent(d.id)}">${H.esc(d.titulo || d.id)}</a> / Sua revisão</div>
      <h1>Sua revisão${n ? ` <span class="selo">rodada ${n}</span>` : ''}</h1>
      <p class="sub" style="margin:0">Assista, marque cada cena como boa ou diga o que mudar. O Claude só mexe no que você marcar.</p>
    </div><div class="linha"><a class="btn" href="#/v/${encodeURIComponent(d.id)}">← Voltar ao vídeo</a></div></div>`;
}
const respHTML = (r) => `<div class="rv-resp ${RESP[r.acao]?.[1] || ''}">Claude: <b>${RESP[r.acao]?.[0] || H.esc(r.acao)}</b>${r.como ? ` · ${H.esc(r.como)}` : ''}</div>`;

function modal({ titulo, corpo, confirmar, cor = 'verde', cancelar = 'Voltar' }) {
  return new Promise((resolve) => {
    const f = document.createElement('div'); f.className = 'rv-modal-fundo';
    f.innerHTML = `<div class="rv-modal" role="dialog" aria-modal="true" aria-label="${H.esc(titulo)}"><h2>${titulo}</h2><div class="rv-modal-corpo">${corpo}</div><div class="linha" style="justify-content:flex-end"><button class="btn" data-m="nao">${cancelar}</button><button class="btn ${cor}" data-m="sim">${confirmar}</button></div></div>`;
    const fechar = (r) => { f.remove(); document.removeEventListener('keydown', tec, true); resolve(r); };
    const tec = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(false); } };
    f.addEventListener('click', (ev) => { if (ev.target === f) return fechar(false); const b = ev.target.closest('[data-m]'); if (b) fechar(b.dataset.m === 'sim'); });
    document.addEventListener('keydown', tec, true);
    document.body.appendChild(f);
    f.querySelector('[data-m="sim"]').focus();
  });
}

// Problemas do agente revisor (último parecer), por cena: "onde" cita a fala (f05) ou um instante (01:02.3).
function mapaIA(d, cenas) {
  const r = (d.revisor?.rodadas || []).at(-1);
  const mapa = { _geral: [] };
  if (!r) return mapa;
  const resp = new Map((r.respostas || []).map((x) => [x.id, x]));
  for (const p of r.problemas || []) {
    const item = { ...p, resposta: resp.get(p.id) || null };
    let alvos = [...new Set(String(p.onde || '').match(/f\d{2,3}/g) || [])].filter((f) => cenas.some((c) => c.fala === f));
    if (!alvos.length) {
      const m = String(p.onde || '').match(/(\d{1,2}):(\d{2}(?:[.,]\d+)?)/);
      if (m) { const t = Number(m[1]) * 60 + Number(m[2].replace(',', '.')); const c = cenas.find((x) => t >= x.inicio && t < x.fim); if (c) alvos = [c.fala]; }
    }
    if (!alvos.length) mapa._geral.push(item);
    for (const f of alvos) (mapa[f] ||= []).push(item);
  }
  return mapa;
}
function blocoIA(itens, chave) {
  const COR = { alta: 'erro', media: 'usuario', baixa: '' };
  const aberto = itens.some((p) => p.gravidade === 'alta' && p.resposta?.acao !== 'corrigido');
  return `<details class="rv-ia"${aberto ? ' open' : ''}><summary>🤖 O agente revisor apontou ${itens.length > 1 ? `${itens.length} coisas` : '1 coisa'} aqui</summary>${itens.map((p) => `
    <div class="rv-ia-item"><div><span class="selo ${COR[p.gravidade] || ''}">${H.esc(p.gravidade || '?')}</span> ${H.esc(p.descricao || '')}</div>
      ${p.sugestao ? `<div class="fraco">Sugestão: ${H.esc(p.sugestao)}</div>` : ''}
      ${p.resposta ? `<div class="rv-resp ${p.resposta.acao === 'corrigido' ? 'ok' : 'parcial'}">Claude: ${H.esc(p.resposta.acao)}${p.resposta.como ? ` · ${H.esc(p.resposta.como)}` : ''}</div>` : ''}
      <button class="btn rv-usar" data-usar-ia="${H.esc(p.id)}" data-chave="${H.esc(chave)}" title="Traz a sugestão para o seu pedido desta cena">+ Usar no meu pedido</button></div>`).join('')}</details>`;
}

// ---------- leitura: com o Claude, aprovada, ou ainda não chegou ----------
function historicoRodada(r) {
  const porFala = Object.fromEntries((r.cenas || []).map((c) => [c.fala, c]));
  const resp = (f) => (r.respostas || []).find((x) => x.fala === f);
  const selo = r.decisao === 'aprovado' ? '<span class="selo pronto">aprovada</span>' : r.decisao === 'ajustes' ? `<span class="selo usuario">${(r.pedidos || []).length} ajuste(s)</span>` : '<span class="selo">aberta</span>';
  const itens = (r.pedidos || []).map((p) => {
    const c = porFala[p.fala]; const rs = resp(p.fala);
    return `<div class="rv-hist-item">${c?.quadros?.[1] ? `<img src="${c.quadros[1]}" alt="" loading="lazy">` : '<span></span>'}<div>
      <div class="fraco mono" style="font-size:12px">cena ${c ? c.indice + 1 : '?'} · ${tempo(c?.inicio)}${p.t != null ? ` · 📍 ${tempo(p.t)}` : ''} ${(p.tipos || []).map((t) => `<span class="chip">${ICONE[t] || ''} ${H.esc(t)}</span>`).join(' ')}</div>
      ${c ? `<div class="fraco" style="font-size:13px">“${H.esc(c.texto)}”</div>` : ''}
      <div style="margin-top:4px">${H.esc(p.nota || '(sem nota)')}</div>
      ${rs ? respHTML(rs) : `<div class="fraco" style="font-size:12px;margin-top:4px">Claude: ${r.respondido_em ? 'sem resposta para esta cena' : 'ainda trabalhando'}</div>`}</div></div>`;
  }).join('');
  const g = r.geral ? `<div class="rv-hist-item"><span></span><div><div class="fraco mono" style="font-size:12px">vídeo todo</div><div>${H.esc(r.geral)}</div>${resp('geral') ? respHTML(resp('geral')) : ''}</div></div>` : '';
  return `<div class="painel" style="margin-bottom:12px"><div class="linha entre"><h3 style="margin:0">Rodada ${r.rodada} ${selo}</h3><span class="fraco" style="font-size:12px">${r.decidido_em ? `${H.esc(r.via || '')} · ${H.relativo(r.decidido_em)}` : 'esperando você'}</span></div>
    ${itens || g ? `<div style="display:grid;gap:12px;margin-top:12px">${itens}${g}</div>` : r.decisao === 'aprovado' ? '<p class="fraco" style="margin:8px 0 0">Aprovada sem ajustes.</p>' : ''}</div>`;
}

function leitura(d, RV, cab) {
  const id = d.id;
  const ult = RV.rodadas.at(-1);
  const ajustes = RV.rodadas.filter((r) => r.decisao === 'ajustes').at(-1);
  let topo;
  if (RV.com_claude && ajustes) {
    const ped = (d.pedidos || []).filter((p) => p.acao === 'cenas').at(-1);
    topo = `<div class="situacao claude"><div class="agora-rotulo">O que você faz agora</div>
      <div class="agora-acao">✅ Nada. O Claude está aplicando ${ajustes.pedidos.length ? `os seus ${ajustes.pedidos.length} ajuste(s)` : 'o seu comentário'} da rodada ${ajustes.rodada}.</div>
      <div class="agora-status">Quando ele terminar e o vídeo for renderizado de novo, a rodada ${ajustes.rodada + 1} abre aqui sozinha para você conferir.${ped ? ` Pedido ${ped.status === 'pendente' ? 'na fila' : ped.status === 'em_andamento' ? 'em andamento' : ped.status} há <span data-desde="${H.esc(ped.atualizado_em || ped.criado_em)}"></span>.` : ''}</div>
      ${ped?.status === 'pendente' && !d.situacao?.operador ? H.blocoComando(id) : ''}</div>`;
  } else if (ult?.decisao === 'aprovado') {
    topo = `<div class="situacao pronto"><div class="agora-rotulo">Situação</div><div class="agora-acao">✅ Você aprovou este vídeo na rodada ${ult.rodada}.</div>
      <div class="agora-status">${d.final ? 'O arquivo final está pronto.' : 'A entrega roda junto com a aprovação.'} Quer mudar mais alguma coisa? Abra uma rodada nova.</div>
      <div class="linha" style="margin-top:10px">${d.final ? `<a class="btn primario" href="${d.final}" download>⬇ Baixar MP4</a>` : ''}${RV.pode_abrir ? '<button class="btn" data-rv-abrir>✎ Abrir uma nova revisão</button>' : ''}</div></div>`;
  } else if (RV.pode_abrir) {
    topo = `<div class="situacao voce"><div class="agora-rotulo">Sua revisão</div><div class="agora-acao">👉 Este vídeo ainda não passou pela sua revisão cena a cena.</div>
      <div class="agora-status">O motor separa as cenas do vídeo final (alguns segundos) e você marca o que está bom e o que mudar.</div>
      <div class="linha" style="margin-top:10px"><button class="btn primario" data-rv-abrir>🎬 Revisar cena a cena</button></div></div>`;
  } else {
    topo = `<div class="situacao"><div class="agora-rotulo">Situação</div><div class="agora-acao">⏳ A sua revisão abre quando o vídeo terminar o render e a revisão do agente.</div>
      <div class="agora-status">Agora: ${H.esc(d.situacao?.texto || d.estagio)}. O aviso no topo do painel diz quando for a sua vez.</div></div>`;
  }
  const hist = RV.rodadas.slice().reverse().map(historicoRodada).join('');
  H.app.innerHTML = `<div class="rv">${cab}${topo}${hist ? `<h2 style="margin-top:22px">Rodadas</h2>${hist}` : ''}</div>`;
  H.app.querySelectorAll('[data-rv-abrir]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Separando as cenas do vídeo…';
    try { await H.api(`/api/videos/${encodeURIComponent(id)}/cenas`, { method: 'POST', body: { acao: 'abrir' } }); await paginaRevisar(id, H); }
    catch (e) { H.avisar(e.message, true); b.disabled = false; b.textContent = 'Tentar de novo'; }
  }));
}

// ---------- editor: a sua revisão aberta ----------
function cardHTML(S, c, i) {
  const m = S.marcas[c.fala];
  const ia = S.ia[c.fala] || [];
  const antes = S.anterior?.pedidos?.find((p) => p.fala === c.fala);
  const resp = S.anterior?.respostas?.find((r) => r.fala === c.fala);
  const ov = c.overlay ? `<span class="rv-ov">🔤 ${H.esc(c.overlay.rotulo ? `${c.overlay.rotulo}: ` : '')}${H.esc(c.overlay.valor || (c.overlay.itens || []).join(', '))}</span>` : '';
  const voz = m.tipos.some((t) => t === 'narracao' || t === 'voz');
  return `<article class="rv-card${m.estado ? ` ${m.estado}` : ''}" data-i="${i}" id="rv-c-${H.esc(c.fala)}">
    <header class="rv-card-topo">
      <button class="rv-num" data-ir title="Levar o vídeo para esta cena">${String(i + 1).padStart(2, '0')}</button>
      <div class="rv-meta"><b>${H.esc(c.capitulo_rotulo || '')}</b><span class="mono">${tempo(c.inicio)} – ${tempo(c.fim)}</span>${c.funcao ? `<span class="chip">${H.esc(c.funcao)}</span>` : ''}${c.plano && c.plano !== '3d' ? `<span class="chip c">${H.esc(c.plano)}</span>` : ''}${antes ? '<span class="chip o">↺ você pediu</span>' : ''}${ia.length ? '<span class="chip rv-chip-ia">🤖 agente</span>' : ''}</div>
      <button class="btn rv-tocar" data-tocar title="Tocar só esta cena">▶ Cena</button>
    </header>
    <div class="rv-card-corpo">
      <div class="rv-quadros">${(c.quadros || []).map((q, k) => `<button class="rv-q" data-seek="${c.tempos?.[k] ?? c.inicio}" title="Ver ${tempo(c.tempos?.[k])}"><img src="${q}" loading="lazy" alt="quadro ${k + 1} da cena ${i + 1}"><span>${tempo(c.tempos?.[k])}</span></button>`).join('')}</div>
      <div class="rv-card-texto">
        <p class="rv-texto">“${H.esc(c.texto)}”</p>
        <p class="rv-visual">🎬 ${H.esc(c.visual || '')}${ov ? ` · ${ov}` : ''}${(c.rotulos || []).length ? ` · 🏷 ${c.rotulos.map((x) => H.esc(x)).join(', ')}` : ''}</p>
        ${antes ? `<div class="rv-antes"><div><b>↺ Na rodada ${S.anterior.rodada} você pediu:</b> ${H.esc(antes.nota || (antes.tipos || []).join(', '))}${antes.t != null ? ` <span class="mono fraco">📍 ${tempo(antes.t)}</span>` : ''}</div>${resp ? respHTML(resp) : '<div class="fraco" style="font-size:12px">O Claude não registrou o que fez aqui.</div>'}<div class="fraco" style="font-size:12px">Ficou como você queria? Marque abaixo.</div></div>` : ''}
        ${ia.length ? blocoIA(ia, c.fala) : ''}
        <div class="rv-decisao" role="group" aria-label="Decisão da cena ${i + 1}">
          <button class="rv-bt-ok" data-dec="ok" aria-pressed="${m.estado === 'ok'}">✓ Está boa</button>
          <button class="rv-bt-mudar" data-dec="mudar" aria-pressed="${m.estado === 'mudar'}">✎ Mudar algo</button>
        </div>
        <div class="rv-mudanca"${m.estado === 'mudar' ? '' : ' hidden'}>
          <div class="rv-tipos" role="group" aria-label="O que está errado">${TIPOS_ORDEM.map((t) => `<button class="rv-tipo" data-tipo="${t}" aria-pressed="${m.tipos.includes(t)}">${ICONE[t]} ${H.esc(S.tipos[t] || t)}</button>`).join('')}</div>
          <textarea class="rv-nota" rows="3" placeholder="O que mudar nesta cena? Diga o que está errado e como você quer. Ex.: o troféu está flutuando; quero o piloto segurando o troféu.">${H.esc(m.nota)}</textarea>
          <div class="rv-linha-nota">
            <button class="btn rv-marcar" data-marcar title="Prende o seu pedido ao instante em que o vídeo está agora">📍 Marcar o instante <span class="mono">${m.t != null ? tempo(m.t) : ''}</span></button>
            <button class="btn rv-limpar" data-limpar-t title="Tirar o instante"${m.t != null ? '' : ' hidden'}>✕</button>
            <span class="rv-alerta-voz"${voz ? '' : ' hidden'}>⚠ Mexe na narração: a voz é gerada de novo (gasta créditos da ElevenLabs) e o vídeo é refeito a partir dela.</span>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function geralHTML(S) {
  const iaG = S.ia._geral || [];
  const a = S.anterior;
  const antes = a?.geral ? `<div class="rv-antes"><div><b>↺ Na rodada ${a.rodada} você disse:</b> ${H.esc(a.geral)}</div>${(a.respostas || []).find((r) => r.fala === 'geral') ? respHTML(a.respostas.find((r) => r.fala === 'geral')) : ''}</div>` : '';
  return `<article class="rv-card rv-geral" id="rv-geral">
    <header class="rv-card-topo"><span class="rv-num">∗</span><div class="rv-meta"><b>Vídeo todo</b><span class="fraco">música, ritmo, tom: o que vale para várias cenas</span></div></header>
    ${antes}${iaG.length ? blocoIA(iaG, '_geral') : ''}
    <textarea id="rv-geral-txt" rows="3" placeholder="Comentário geral (opcional). Ex.: a música está alta; quero cortes mais rápidos no capítulo 2.">${H.esc(S.geral)}</textarea>
  </article>`;
}

function editor(d, RV, cab) {
  const id = d.id;
  const R = RV.atual;
  const cenas = R.cenas || [];
  const total = R.duracao || d.duracao || cenas.at(-1)?.fim || 0;
  const anterior = RV.rodadas.filter((r) => r.rodada < R.rodada && r.decisao === 'ajustes').at(-1) || null;
  const chaveLocal = `rv:${id}:${R.rodada}`;
  let local = null; try { local = JSON.parse(localStorage.getItem(chaveLocal) || 'null'); } catch {}
  const base = [RV.rascunho, local].filter((x) => x && Number(x.rodada) === R.rodada).sort((a, b) => Date.parse(b.salvo_em || 0) - Date.parse(a.salvo_em || 0))[0] || null;
  const S = C = {
    vivo: true, editor: true, id, n: R.rodada, cenas, total, anterior, ia: mapaIA(d, cenas), tipos: RV.tipos || {},
    marcas: Object.fromEntries(cenas.map((c) => {
      const b = base?.cenas?.[c.fala] || {};
      return [c.fala, { estado: ['ok', 'mudar'].includes(b.estado) ? b.estado : null, tipos: Array.isArray(b.tipos) ? b.tipos.filter((t) => TIPOS_ORDEM.includes(t)) : [], nota: String(b.nota || ''), t: Number.isFinite(b.t) ? b.t : null }];
    })),
    geral: String(base?.geral || ''), ativa: -1, filtro: 'todas', modo: null, repetir: false, vel: 0, chaveLocal, sujo: false, ultimoScrollManual: 0, seekProprio: false,
  };

  const caps = [];
  for (const c of cenas) { const u = caps.at(-1); const dur = Math.max(0.3, c.fim - c.inicio); if (u && u.cap === c.capitulo) u.dur += dur; else caps.push({ cap: c.capitulo, rotulo: c.capitulo_rotulo || c.capitulo, dur }); }
  const aviso = anterior ? `<div class="rv-banner-antes">↺ <b>Rodada ${R.rodada}:</b> o Claude aplicou os ${anterior.pedidos.length ? `${anterior.pedidos.length} ajuste(s)` : 'comentários'} que você pediu na rodada ${anterior.rodada}. Use o filtro <b>“Pedidos da rodada ${anterior.rodada}”</b> para conferir só essas cenas.</div>` : '';

  H.app.innerHTML = `<div class="rv">${cab}${aviso}
    <div id="rv-aviso-novo" class="rv-aviso-novo" hidden></div>
    <div class="rv-grade">
      <aside class="rv-player">
        <div class="rv-video-caixa">${R.video_url ? `<video id="rv-video" src="${R.video_url}" controls playsinline preload="auto"></video>` : '<div class="vazio">O arquivo do vídeo não foi encontrado (out/render.mp4).</div>'}<div class="rv-tag" id="rv-tag"></div></div>
        <div class="rv-caps">${caps.map((k) => `<span style="flex:${k.dur.toFixed(2)}" title="${H.esc(k.rotulo)}">${H.esc(k.rotulo)}</span>`).join('')}</div>
        <div class="rv-linha-tempo" id="rv-lt">${cenas.map((c, i) => `<button class="rv-seg${S.marcas[c.fala].estado ? ` ${S.marcas[c.fala].estado}` : ''}${(S.ia[c.fala] || []).length ? ' ia' : ''}" data-seg="${i}" style="flex:${Math.max(0.3, c.fim - c.inicio).toFixed(2)}" title="Cena ${i + 1} · ${tempo(c.inicio)} · ${H.esc(String(c.texto).slice(0, 70))}"></button>`).join('')}<div class="rv-cabeca" id="rv-cabeca"></div></div>
        <div class="rv-controles">
          <button class="btn" data-rv="ant" title="Cena anterior (←)">⏮</button>
          <button class="btn" data-rv="play" id="rv-play" title="Tocar / pausar (Espaço)">▶</button>
          <button class="btn" data-rv="prox" title="Próxima cena (→)">⏭</button>
          <button class="btn" data-rv="cena" title="Tocar só a cena atual (Enter)">▶ Cena</button>
          <button class="btn" data-rv="repetir" aria-pressed="false" title="Repetir a cena (R)">🔁</button>
          <button class="btn" data-rv="vel" title="Velocidade (V)">1×</button>
          <button class="btn" data-rv="emenda" title="Testar a emenda: últimos 3 s → primeiros 3 s (E)">∞ Emenda</button>
          <span class="mono rv-relogio" id="rv-relogio">0:00.0 / ${tempo(total)}</span>
        </div>
        <div class="rv-atalhos"><kbd>Espaço</kbd> tocar · <kbd>←</kbd> <kbd>→</kbd> cena · <kbd>Enter</kbd> tocar a cena · <kbd>A</kbd> boa e próxima · <kbd>M</kbd> mudar · <kbd>E</kbd> emenda</div>
      </aside>
      <section class="rv-lista" id="rv-lista">
        <div class="rv-filtros" id="rv-filtros"></div>
        ${cenas.map((c, i) => cardHTML(S, c, i)).join('')}
        ${geralHTML(S)}
      </section>
    </div>
    <div class="rv-rodape"><div class="rv-rodape-in">
      <div class="rv-resumo"><div id="rv-resumo-txt"></div><div class="rv-barra"><span class="ok" id="rv-b-ok"></span><span class="mudar" id="rv-b-mudar"></span></div><div class="rv-salvo" id="rv-salvo">${base ? `Rascunho recuperado (${H.relativo(base.salvo_em)}).` : 'As suas marcações são salvas sozinhas: pode fechar e continuar depois.'}</div></div>
      <button class="btn" id="rv-enviar">Enviar ajustes ao Claude</button>
      <button class="btn verde" id="rv-aprovar">✓ Aprovar e entregar</button>
    </div></div>
  </div>`;

  const $ = (s) => document.getElementById(s);
  const v = S.video = $('rv-video');
  const lista = $('rv-lista'); const segs = [...document.querySelectorAll('.rv-seg')];
  const card = (i) => lista.querySelector(`.rv-card[data-i="${i}"]`);
  const btnEnviar = $('rv-enviar'); const btnAprovar = $('rv-aprovar'); const salvoEl = $('rv-salvo');
  const cenaEm = (t) => { let k = 0; for (let i = 0; i < cenas.length; i++) if (t >= cenas[i].inicio - 0.001) k = i; return k; };
  const ir = (t) => { if (!v) return; S.seekProprio = true; v.currentTime = Math.max(0, Math.min(total - 0.02, t)); };

  // ----- cena ativa e player -----
  function ativar(i, rolar) {
    if (i === S.ativa) return;
    card(S.ativa)?.classList.remove('ativa'); segs[S.ativa]?.classList.remove('ativa');
    S.ativa = i;
    card(i)?.classList.add('ativa'); segs[i]?.classList.add('ativa');
    const c = cenas[i];
    $('rv-tag').textContent = `${String(i + 1).padStart(2, '0')} · ${c.capitulo_rotulo || ''}`;
    if (rolar && !card(i)?.hidden) card(i)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function irPara(i, { tocar = false, rolar = true } = {}) {
    i = Math.max(0, Math.min(cenas.length - 1, i));
    S.modo = tocar ? { tipo: 'cena', i } : null;
    ir(cenas[i].inicio + (i === 0 ? 0 : 0.02));
    ativar(i, rolar);
    if (tocar && v) v.play().catch(() => {});
  }
  function tick() {
    if (!S.vivo || !v) return;
    const t = v.currentTime || 0;
    $('rv-cabeca').style.left = `${Math.min(100, (t / total) * 100)}%`;
    $('rv-relogio').textContent = `${tempo(t)} / ${tempo(total)}`;
    const i = cenaEm(t);
    if (i !== S.ativa) {
      const digitando = document.activeElement?.matches?.('textarea, input');
      ativar(i, !v.paused && !digitando && Date.now() - S.ultimoScrollManual > 4000);
    }
    const m = S.modo;
    if (m?.tipo === 'cena' && !v.paused && t >= cenas[m.i].fim - 0.04) {
      if (S.repetir) ir(cenas[m.i].inicio + 0.02);
      else { v.pause(); S.modo = null; }
    }
    if (m?.tipo === 'emenda') {
      if (m.fase === 1 && t >= total - 0.08) { m.fase = 2; ir(0); v.play().catch(() => {}); }
      else if (m.fase === 2 && t >= 3 && t < total - 1) { v.pause(); S.modo = null; }
    }
    if (!v.paused) requestAnimationFrame(tick);
  }
  if (v) {
    v.addEventListener('play', () => { $('rv-play').textContent = '⏸'; requestAnimationFrame(tick); });
    v.addEventListener('pause', () => { $('rv-play').textContent = '▶'; tick(); });
    v.addEventListener('seeking', () => { if (S.seekProprio) S.seekProprio = false; else if (S.modo?.tipo !== 'emenda') S.modo = null; });
    v.addEventListener('seeked', tick);
    v.addEventListener('timeupdate', () => { if (v.paused) tick(); });
    v.addEventListener('ended', () => { if (S.modo?.tipo === 'emenda' && S.modo.fase === 1) { S.modo.fase = 2; ir(0); v.play().catch(() => {}); } });
    v.addEventListener('error', () => H.avisar('Não consegui carregar o vídeo desta rodada.', true));
  }
  const acoesPlayer = {
    play: () => { if (!v) return; if (v.paused) { if (S.modo?.tipo === 'cena') S.modo = null; v.play().catch(() => {}); } else v.pause(); },
    ant: () => { const i = S.ativa < 0 ? 0 : S.ativa; const dentro = v && v.currentTime - cenas[i].inicio > 1; irPara(dentro ? i : i - 1, { tocar: v && !v.paused }); },
    prox: () => irPara((S.ativa < 0 ? 0 : S.ativa) + 1, { tocar: v && !v.paused }),
    cena: () => irPara(S.ativa < 0 ? 0 : S.ativa, { tocar: true, rolar: false }),
    repetir: (b) => { S.repetir = !S.repetir; b.setAttribute('aria-pressed', String(S.repetir)); },
    vel: (b) => { S.vel = (S.vel + 1) % VELOCIDADES.length; if (v) v.playbackRate = VELOCIDADES[S.vel]; b.textContent = `${VELOCIDADES[S.vel]}×`.replace('.', ','); },
    emenda: () => { if (!v) return; S.modo = { tipo: 'emenda', fase: 1 }; ir(Math.max(0, total - 3)); v.play().catch(() => {}); },
  };
  document.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => acoesPlayer[b.dataset.rv]?.(b)));
  segs.forEach((s, i) => s.addEventListener('click', () => irPara(i, { tocar: v && !v.paused })));

  // ----- marcações -----
  const contagem = () => { let ok = 0, mudar = 0; for (const c of cenas) { const e = S.marcas[c.fala].estado; if (e === 'ok') ok++; else if (e === 'mudar') mudar++; } return { ok, mudar, pend: cenas.length - ok - mudar }; };
  const FILTROS = [
    ['todas', 'Todas', () => true],
    ['pendentes', 'Sem marcar', (c) => !S.marcas[c.fala].estado],
    ['mudar', 'Para mudar', (c) => S.marcas[c.fala].estado === 'mudar'],
    ['ia', '🤖 Apontadas pelo agente', (c) => (S.ia[c.fala] || []).length > 0],
    ...(anterior ? [['antes', `↺ Pedidos da rodada ${anterior.rodada}`, (c) => anterior.pedidos.some((p) => p.fala === c.fala)]] : []),
  ];
  function desenharFiltros() {
    $('rv-filtros').innerHTML = FILTROS.map(([k, r, fn]) => {
      const n = cenas.filter(fn).length;
      if (['ia', 'antes'].includes(k) && !n) return '';
      return `<button data-filtro="${k}" aria-pressed="${S.filtro === k}">${r} <span class="mono">${n}</span></button>`;
    }).join('');
  }
  function aplicarFiltro() {
    const fn = FILTROS.find((f) => f[0] === S.filtro)?.[2] || (() => true);
    cenas.forEach((c, i) => { card(i).hidden = !fn(c); });
    $('rv-geral').hidden = !['todas', 'mudar'].includes(S.filtro);
  }
  $('rv-filtros').addEventListener('click', (ev) => { const b = ev.target.closest('[data-filtro]'); if (!b) return; S.filtro = b.dataset.filtro; desenharFiltros(); aplicarFiltro(); });

  function atualizarResumo() {
    const k = contagem(); const n = cenas.length;
    $('rv-resumo-txt').innerHTML = `<b>${k.ok + k.mudar} de ${n}</b> cenas revisadas · <span style="color:var(--verde)">${k.ok} boa${k.ok === 1 ? '' : 's'}</span> · <span style="color:var(--laranja)">${k.mudar} para mudar</span>${k.pend ? ` · <span class="fraco">${k.pend} sem marcar</span>` : ''}${S.geral.trim() ? ' · comentário geral' : ''}`;
    $('rv-b-ok').style.width = `${(k.ok / n) * 100}%`; $('rv-b-mudar').style.width = `${(k.mudar / n) * 100}%`;
    const temAjuste = k.mudar > 0 || Boolean(S.geral.trim());
    btnEnviar.disabled = !temAjuste;
    btnEnviar.classList.toggle('primario', temAjuste);
    btnEnviar.textContent = k.mudar ? `Enviar ${k.mudar} ajuste${k.mudar > 1 ? 's' : ''} ao Claude` : S.geral.trim() ? 'Enviar o comentário ao Claude' : 'Enviar ajustes ao Claude';
    btnAprovar.disabled = k.mudar > 0;
    btnAprovar.title = k.mudar ? 'Há cenas marcadas para mudar: envie os ajustes ou desmarque-as.' : 'Aprova o vídeo e gera o arquivo final';
    // contagens dos filtros sem perder o filtro escolhido
    document.querySelectorAll('#rv-filtros [data-filtro]').forEach((b) => { const fn = FILTROS.find((f) => f[0] === b.dataset.filtro)?.[2]; if (fn) b.querySelector('.mono').textContent = cenas.filter(fn).length; });
  }
  function atualizarCard(i) {
    const el = card(i); const m = S.marcas[cenas[i].fala];
    el.classList.toggle('ok', m.estado === 'ok'); el.classList.toggle('mudar', m.estado === 'mudar');
    el.querySelector('[data-dec="ok"]').setAttribute('aria-pressed', String(m.estado === 'ok'));
    el.querySelector('[data-dec="mudar"]').setAttribute('aria-pressed', String(m.estado === 'mudar'));
    el.querySelector('.rv-mudanca').hidden = m.estado !== 'mudar';
    el.querySelectorAll('[data-tipo]').forEach((b) => b.setAttribute('aria-pressed', String(m.tipos.includes(b.dataset.tipo))));
    el.querySelector('.rv-alerta-voz').hidden = !m.tipos.some((t) => t === 'narracao' || t === 'voz');
    el.querySelector('[data-marcar] .mono').textContent = m.t != null ? tempo(m.t) : '';
    el.querySelector('[data-limpar-t]').hidden = m.t == null;
    const ta = el.querySelector('.rv-nota'); if (ta.value !== m.nota) ta.value = m.nota;
    segs[i].classList.toggle('ok', m.estado === 'ok'); segs[i].classList.toggle('mudar', m.estado === 'mudar');
  }
  function mudou(i) { if (i != null) atualizarCard(i); atualizarResumo(); agendarSalvar(); }
  function marcar(i, estado, { focar = true } = {}) {
    const m = S.marcas[cenas[i].fala];
    m.estado = estado;
    mudou(i);
    if (estado === 'mudar' && focar) { if (v && !v.paused) v.pause(); setTimeout(() => card(i).querySelector('.rv-nota')?.focus(), 30); }
  }
  function usarIA(idProblema, chave) {
    const p = (S.ia[chave] || []).find((x) => String(x.id) === String(idProblema));
    if (!p) return;
    const txt = `Do agente revisor: ${p.sugestao || p.descricao}`;
    if (chave === '_geral') {
      S.geral = S.geral.trim() ? `${S.geral.trim()}\n${txt}` : txt;
      $('rv-geral-txt').value = S.geral; mudou(null); return;
    }
    const i = cenas.findIndex((c) => c.fala === chave); const m = S.marcas[chave];
    if (!m.nota.includes(txt)) m.nota = m.nota.trim() ? `${m.nota.trim()}\n${txt}` : txt;
    const t = DE_CATEGORIA[p.categoria]; if (t && !m.tipos.includes(t)) m.tipos.push(t);
    marcar(i, 'mudar', { focar: false });
  }

  lista.addEventListener('click', (ev) => {
    const el = ev.target.closest('button');
    const cardEl = ev.target.closest('.rv-card[data-i]');
    if (el?.dataset.usarIa) return usarIA(el.dataset.usarIa, el.dataset.chave);
    if (!cardEl) return;
    const i = Number(cardEl.dataset.i); const m = S.marcas[cenas[i].fala];
    if (!el) { if (!ev.target.closest('textarea, summary, details, a, input')) irPara(i, { rolar: false }); return; }
    if (el.dataset.seek !== undefined) { S.modo = null; ir(Number(el.dataset.seek)); ativar(i, false); return; }
    if (el.dataset.ir !== undefined) return irPara(i, { rolar: false });
    if (el.dataset.tocar !== undefined) return irPara(i, { tocar: true, rolar: false });
    if (el.dataset.dec) return marcar(i, el.dataset.dec === m.estado ? null : el.dataset.dec);
    if (el.dataset.tipo) { const t = el.dataset.tipo; m.tipos = m.tipos.includes(t) ? m.tipos.filter((x) => x !== t) : [...m.tipos, t]; return mudou(i); }
    if (el.dataset.marcar !== undefined) {
      m.t = Math.round(((v?.currentTime) || cenas[i].inicio) * 10) / 10;
      const k = cenaEm(m.t);
      if (k !== i) H.avisar(`Marquei ${tempo(m.t)}, que fica na cena ${k + 1}. Para outro momento, leve o vídeo até lá e marque de novo.`);
      return mudou(i);
    }
    if (el.dataset.limparT !== undefined) { m.t = null; return mudou(i); }
  });
  lista.addEventListener('input', (ev) => {
    if (ev.target.id === 'rv-geral-txt') { S.geral = ev.target.value; atualizarResumo(); return agendarSalvar(); }
    const ta = ev.target.closest('.rv-nota'); if (!ta) return;
    S.marcas[cenas[Number(ta.closest('.rv-card').dataset.i)].fala].nota = ta.value;
    agendarSalvar();
  });

  // ----- rascunho: salvo sozinho (servidor + este navegador) -----
  let tSalvar = null;
  function agendarSalvar() { S.sujo = true; salvoEl.textContent = 'Salvando…'; clearTimeout(tSalvar); tSalvar = setTimeout(salvarAgora, 700); }
  async function salvarAgora() {
    tSalvar = null;
    const corpo = { rodada: S.n, cenas: S.marcas, geral: S.geral, salvo_em: new Date().toISOString() };
    try { localStorage.setItem(S.chaveLocal, JSON.stringify(corpo)); } catch {}
    try {
      await H.api(`/api/videos/${encodeURIComponent(id)}/cenas`, { method: 'POST', body: { acao: 'rascunho', ...corpo } });
      S.sujo = false;
      if (S.vivo) salvoEl.textContent = `Rascunho salvo ✓ ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) { if (S.vivo) salvoEl.textContent = /rodada/i.test(e.message) ? e.message : 'Sem conexão com o painel: salvo só neste navegador.'; }
  }
  S.flush = () => { if (tSalvar) { clearTimeout(tSalvar); salvarAgora(); } };

  // ----- enviar / aprovar -----
  const okList = () => cenas.filter((c) => S.marcas[c.fala].estado === 'ok').map((c) => c.fala);
  btnEnviar.addEventListener('click', async () => {
    const mud = cenas.map((c, i) => ({ c, i, m: S.marcas[c.fala] })).filter((x) => x.m.estado === 'mudar');
    const vazia = mud.find((x) => !x.m.nota.trim() && !x.m.tipos.length);
    if (vazia) {
      if (S.filtro !== 'todas') { S.filtro = 'todas'; desenharFiltros(); aplicarFiltro(); }
      irPara(vazia.i); setTimeout(() => card(vazia.i).querySelector('.rv-nota')?.focus(), 250);
      return H.avisar(`Diga o que mudar na cena ${vazia.i + 1} (ou desmarque "Mudar algo").`, true);
    }
    if (!mud.length && !S.geral.trim()) return H.avisar('Marque ao menos uma cena com "Mudar algo" ou escreva um comentário geral.', true);
    const k = contagem();
    const voz = mud.some((x) => x.m.tipos.some((t) => t === 'narracao' || t === 'voz'));
    const corpo = `<p class="fraco" style="margin:0">O Claude aplica só isto, renderiza de novo e a rodada ${S.n + 1} volta para você conferir. O agente revisor não roda outra vez.</p>
      <ul>${mud.map((x) => `<li><b>Cena ${x.i + 1}</b> <span class="mono fraco">${tempo(x.c.inicio)}</span>${x.m.tipos.length ? ` · ${x.m.tipos.map((t) => `${ICONE[t]} ${H.esc(S.tipos[t] || t)}`).join(', ')}` : ''}${x.m.t != null ? ` · 📍 ${tempo(x.m.t)}` : ''}<br>${H.esc(x.m.nota.trim() || '(sem detalhe)')}</li>`).join('')}${S.geral.trim() ? `<li><b>Vídeo todo:</b> ${H.esc(S.geral.trim())}</li>` : ''}</ul>
      ${voz ? '<div class="dica" style="color:var(--amarelo)">⚠ Há pedido de narração ou voz: a voz é gerada de novo (gasta créditos da ElevenLabs) e o vídeo é refeito a partir dela.</div>' : ''}
      ${k.pend ? `<div class="dica">${k.pend} cena(s) ficaram sem marcar: o Claude não mexe nelas.</div>` : ''}`;
    if (!(await modal({ titulo: mud.length ? `Enviar ${mud.length} ajuste${mud.length > 1 ? 's' : ''} ao Claude?` : 'Enviar o comentário ao Claude?', corpo, confirmar: 'Enviar ao Claude', cor: 'primario' }))) return;
    btnEnviar.disabled = true; btnEnviar.textContent = 'Enviando…';
    try {
      clearTimeout(tSalvar); tSalvar = null;
      await H.api(`/api/videos/${encodeURIComponent(id)}/cenas`, { method: 'POST', body: { acao: 'ajustes', rodada: S.n, pedidos: mud.map((x) => ({ fala: x.c.fala, tipos: x.m.tipos, nota: x.m.nota, t: x.m.t })), ok: okList(), geral: S.geral } });
      try { localStorage.removeItem(S.chaveLocal); } catch {}
      H.avisar('Ajustes enviados. O Claude aplica e a próxima rodada aparece aqui.');
      S.vivo = false; S.flush = null; await paginaRevisar(id, H); scrollTo(0, 0);
    } catch (e) { H.avisar(e.message, true); atualizarResumo(); }
  });
  btnAprovar.addEventListener('click', async () => {
    const k = contagem();
    if (k.mudar) return H.avisar('Há cenas marcadas para mudar: envie os ajustes ou desmarque-as antes de aprovar.', true);
    const corpo = `${k.pend ? `<p style="margin:0">Você não marcou ${k.pend} de ${cenas.length} cenas. Tudo bem aprovar assim?</p>` : `<p style="margin:0">As ${cenas.length} cenas estão boas.</p>`}
      <p class="fraco" style="margin:0">O motor gera o arquivo final agora (alguns segundos) e o vídeo fica pronto para baixar.</p>
      ${S.geral.trim() ? '<div class="dica">O seu comentário geral fica registrado, mas aprovar não muda o vídeo. Para o Claude agir nele, use “Enviar ao Claude”.</div>' : ''}`;
    if (!(await modal({ titulo: 'Aprovar e entregar o vídeo?', corpo, confirmar: '✓ Aprovar e entregar' }))) return;
    btnAprovar.disabled = true; btnAprovar.textContent = 'Entregando…';
    try {
      clearTimeout(tSalvar); tSalvar = null;
      const r = await H.api(`/api/videos/${encodeURIComponent(id)}/cenas`, { method: 'POST', body: { acao: 'aprovar', rodada: S.n, ok: okList(), geral: S.geral } });
      try { localStorage.removeItem(S.chaveLocal); } catch {}
      H.avisar(r.entrega?.ok === false ? `Aprovado, mas a entrega falhou: ${r.entrega.erro}` : 'Vídeo aprovado e entregue. 🎉', r.entrega?.ok === false);
      S.vivo = false; S.flush = null; location.hash = `#/v/${encodeURIComponent(id)}`;
    } catch (e) { H.avisar(e.message, true); btnAprovar.disabled = false; btnAprovar.textContent = '✓ Aprovar e entregar'; }
  });

  // ----- teclado -----
  S.teclas = (ev) => {
    if (!S.vivo || document.querySelector('.rv-modal-fundo')) return;
    const alvo = ev.target;
    if (alvo?.matches?.('textarea, input, select')) { if (ev.key === 'Escape') alvo.blur(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const i = S.ativa < 0 ? 0 : S.ativa;
    const feito = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (k === ' ') { feito(); acoesPlayer.play(); }
    else if (k === 'ArrowRight') { feito(); acoesPlayer.prox(); }
    else if (k === 'ArrowLeft') { feito(); acoesPlayer.ant(); }
    else if (k === 'Enter' && alvo?.tagName !== 'BUTTON' && alvo?.tagName !== 'SUMMARY') { feito(); acoesPlayer.cena(); }
    else if (k === 'a') { feito(); marcar(i, 'ok'); if (i < cenas.length - 1) irPara(i + 1, { tocar: true }); }
    else if (k === 'm') { feito(); marcar(i, 'mudar'); card(i).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else if (k === 'e') { feito(); acoesPlayer.emenda(); }
    else if (k === 'r') { feito(); acoesPlayer.repetir(document.querySelector('[data-rv="repetir"]')); }
    else if (k === 'v') { feito(); acoesPlayer.vel(document.querySelector('[data-rv="vel"]')); }
  };
  document.addEventListener('keydown', S.teclas, true);
  S.rolagem = () => { S.ultimoScrollManual = Date.now(); };
  window.addEventListener('wheel', S.rolagem, { passive: true });
  window.addEventListener('touchmove', S.rolagem, { passive: true });

  desenharFiltros(); atualizarResumo(); ativar(0, false); tick();
}
