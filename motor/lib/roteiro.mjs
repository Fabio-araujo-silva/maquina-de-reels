// Validação do roteiro (roteiro.json) e versão legível (roteiro.md) para a revisão.
// As regras vêm da análise do vídeo de referência (modulos/roteiro/estrutura-referencia.md).

export const FUNCOES = ['gancho', 'pergunta', 'mecanismo', 'escada', 'soco', 'comparacao', 'objecao', 'prova', 'callback', 'cta', 'ponte', 'contexto'];
export const OVERLAYS = ['numero', 'manchete', 'negacao', 'lista', 'cta'];
export const PLANOS = ['3d', 'colagem', 'texto'];
const FAIXAS = { '30-45': [30, 45], '45-60': [45, 60], '60-90': [60, 90], '90-120': [90, 120] };

export function contarPalavras(txt) {
  return String(txt || '').replace(/[—–-]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function validarRoteiro(r, config = {}) {
  const erros = []; const avisos = [];
  const E = (m) => erros.push(m); const A = (m) => avisos.push(m);
  if (!r || typeof r !== 'object') return { ok: false, erros: ['roteiro.json vazio ou inválido'], avisos, metricas: {} };

  for (const campo of ['titulo', 'tema', 'promessa', 'loop', 'capitulos', 'falas']) if (!r[campo]) E(`Falta o campo "${campo}".`);
  const falas = Array.isArray(r.falas) ? r.falas : [];
  const caps = Array.isArray(r.capitulos) ? r.capitulos : [];
  if (falas.length < 6) E(`Só ${falas.length} falas; o mínimo é 6.`);
  if (caps.length < 3) E(`Só ${caps.length} capítulos; use de 3 a 10.`);
  if (caps.length > 10) A(`${caps.length} capítulos: mais de 10 confunde a pílula de capítulo.`);
  if (r.tema && String(r.tema).length > 26) A(`"tema" tem ${String(r.tema).length} caracteres; o selo do topo fica melhor com até 26.`);

  const idsCap = new Set();
  for (const c of caps) {
    if (!c.id || !c.rotulo) E('Todo capítulo precisa de "id" e "rotulo".');
    if (idsCap.has(c.id)) E(`Capítulo repetido: ${c.id}`);
    idsCap.add(c.id);
    if (c.rotulo && c.rotulo.length > 16) A(`Rótulo do capítulo "${c.rotulo}" passa de 16 caracteres.`);
  }

  const idsFala = new Set();
  let palavras = 0;
  const usoCap = {};
  falas.forEach((f, i) => {
    const onde = `fala ${f.id || i + 1}`;
    if (!f.id) E(`${onde}: falta "id".`);
    if (idsFala.has(f.id)) E(`${onde}: id repetido.`);
    idsFala.add(f.id);
    if (!f.texto || !String(f.texto).trim()) E(`${onde}: "texto" vazio.`);
    if (!f.capitulo || !idsCap.has(f.capitulo)) E(`${onde}: capítulo "${f.capitulo}" não existe.`);
    usoCap[f.capitulo] = (usoCap[f.capitulo] || 0) + 1;
    if (f.funcao && !FUNCOES.includes(f.funcao)) A(`${onde}: função "${f.funcao}" fora da lista (${FUNCOES.join(', ')}).`);
    if (!f.visual) E(`${onde}: falta "visual" (o que aparece na tela).`);
    if (f.plano && !PLANOS.includes(f.plano)) E(`${onde}: plano "${f.plano}" inválido (${PLANOS.join(', ')}).`);
    const n = contarPalavras(f.texto);
    palavras += contarPalavras(f.fala || f.texto);
    if (n > 24) E(`${onde}: ${n} palavras; quebre em falas de até 18.`);
    else if (n > 18) A(`${onde}: ${n} palavras; ideal até 16 por fala.`);
    if (f.overlay) {
      const o = f.overlay;
      if (!OVERLAYS.includes(o.tipo)) E(`${onde}: overlay "${o.tipo}" inválido (${OVERLAYS.join(', ')}).`);
      if (o.tipo === 'numero' && (!o.valor || String(o.valor).length > 14)) E(`${onde}: overlay número precisa de "valor" com até 14 caracteres.`);
      if (o.rotulo && String(o.rotulo).length > 30) A(`${onde}: rótulo do overlay passa de 30 caracteres.`);
      if (['negacao', 'lista'].includes(o.tipo) && (!Array.isArray(o.itens) || !o.itens.length)) E(`${onde}: overlay ${o.tipo} precisa de "itens".`);
      if (o.tipo === 'manchete' && (!o.valor || String(o.valor).length > 22)) E(`${onde}: manchete precisa de "valor" com até 22 caracteres.`);
    }
    for (const rot of f.rotulos || []) {
      if (!rot.texto) E(`${onde}: rótulo sem texto.`);
      if (rot.texto && rot.texto.length > 26) A(`${onde}: rótulo "${rot.texto}" é longo para uma etiqueta.`);
    }
  });
  for (const c of caps) if (!usoCap[c.id]) A(`Capítulo ${c.id} (${c.rotulo}) não tem nenhuma fala.`);

  // Gancho
  if (falas[0]) {
    const n0 = contarPalavras(falas[0].texto);
    if (n0 > 16) A(`Gancho com ${n0} palavras: os primeiros 2 s precisam de no máximo ~12 palavras.`);
    if (falas[0].funcao && falas[0].funcao !== 'gancho') A('A primeira fala deveria ter funcao "gancho".');
  }
  if (!falas.slice(0, 5).some((f) => f.funcao === 'pergunta' || /\?\s*$/.test(f.texto || ''))) {
    A('Nenhuma pergunta que abre curiosidade nas 5 primeiras falas (ex.: "Sabe por quê?").');
  }

  // Duração
  const pps = (config.palavras_por_segundo || 2.75) * (config.voz_ajustes?.speed || 1);
  const pausas = falas.length * 0.22;
  const estimada = palavras / pps + pausas + (config.lead_in_s ?? 0.25) + (config.cauda_s ?? 0.45);
  const faixa = FAIXAS[config.duracao] || null;
  if (faixa) {
    if (estimada < faixa[0] * 0.8 || estimada > faixa[1] * 1.2) E(`Duração estimada ${estimada.toFixed(0)} s fora da faixa ${faixa[0]}–${faixa[1]} s (ajuste o número de palavras: ~${Math.round((faixa[0] + faixa[1]) / 2 * pps)}).`);
    else if (estimada < faixa[0] || estimada > faixa[1]) A(`Duração estimada ${estimada.toFixed(0)} s um pouco fora de ${faixa[0]}–${faixa[1]} s.`);
  }

  // Loop
  const L = r.loop || {};
  const tipo = L.tipo || config.loop || 'ponte-total';
  if (!L.como_emenda) E('loop.como_emenda: explique em uma frase como o fim leva ao começo.');
  const ultima = falas[falas.length - 1];
  const primeira = falas[0];
  if (['ponte-total', 'frase-ponte'].includes(tipo)) {
    const tFim = String(ultima?.texto || '').trim();
    const aberta = /(\.\.\.|…|[:,;—–-])$/u.test(tFim) || !/[.!?]$/u.test(tFim);
    if (ultima && !aberta) {
      E(`Loop "${tipo}": a última fala termina fechada ("${String(ultima.texto).trim().slice(-25)}"). Ela precisa terminar aberta (":", ",", "…" ou sem ponto) para emendar na primeira.`);
    }
    if (ultima && ultima.funcao && ultima.funcao !== 'ponte') A('A última fala deveria ter funcao "ponte".');
    if (!L.frase_final || !L.frase_inicial) E('loop.frase_final e loop.frase_inicial são obrigatórios neste tipo de loop.');
  }
  if (['ponte-total', 'eco-visual'].includes(tipo) && !L.ancora_visual) E('loop.ancora_visual: descreva o plano que abre E fecha o vídeo.');
  if (tipo === 'pergunta-eco') {
    if (!ultima || !/\?\s*$/.test(String(ultima.texto))) E('Loop "pergunta-eco": a última fala precisa ser a pergunta do gancho.');
  }
  if (L.frase_final && ultima && normal(L.frase_final) !== normal(ultima.texto)) A('loop.frase_final difere do texto da última fala.');
  if (L.frase_inicial && primeira && !normal(L.frase_inicial).startsWith(normal(primeira.texto).slice(0, 20))) A('loop.frase_inicial não começa como a primeira fala.');

  // CTA
  const ctaCfg = config.cta || 'compartilhar';
  const idxCta = falas.findIndex((f) => f.funcao === 'cta');
  if (ctaCfg !== 'sem') {
    if (idxCta < 0) E('Falta a fala de CTA (funcao "cta").');
    else if (['ponte-total', 'frase-ponte'].includes(tipo) && idxCta === falas.length - 1) E('O CTA não pode ser a última fala: a última é a ponte do loop. Coloque o CTA logo antes.');
  }

  // Colagens
  const colagens = falas.filter((f) => f.plano === 'colagem').length;
  if (config.broll === 'nunca' && colagens) E(`O menu diz "colagem nunca", mas ${colagens} falas usam plano "colagem".`);
  if (config.broll === 'abstratas' && colagens > 4) A(`${colagens} colagens: "nas frases abstratas" pede de 1 a 3.`);
  if (config.estilo === 'colagem-halftone' && falas.some((f) => f.plano === '3d')) A('Estilo principal é colagem: planos "3d" serão desenhados como colagem.');

  // Fontes
  const temNumero = falas.some((f) => f.overlay?.tipo === 'numero') || /\d/.test(falas.map((f) => f.texto).join(' '));
  if (temNumero && (!Array.isArray(r.fontes) || !r.fontes.length)) E('O roteiro tem números mas nenhuma fonte em "fontes". Cada número precisa de fonte verificável.');

  const metricas = {
    falas: falas.length, capitulos: caps.length, palavras,
    duracao_estimada_s: Math.round(estimada * 10) / 10,
    palavras_por_segundo: Math.round(pps * 100) / 100,
    colagens, overlays: falas.filter((f) => f.overlay).length,
  };
  return { ok: erros.length === 0, erros, avisos, metricas };
}

function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

function descreverOverlay(o) {
  if (!o) return '';
  switch (o.tipo) {
    case 'numero': return `🔢 ${o.rotulo ? o.rotulo + ': ' : ''}**${o.valor}**`;
    case 'manchete': return `📰 ${o.rotulo ? o.rotulo + ': ' : ''}**${o.valor}**`;
    case 'negacao': return `✗ ${o.rotulo ? o.rotulo + ': ' : ''}${(o.itens || []).join(', ')}`;
    case 'lista': return `• ${o.rotulo ? o.rotulo + ': ' : ''}${(o.itens || []).join(', ')}`;
    case 'cta': return `📣 ${o.rotulo || ''} **${o.valor || ''}**`;
    default: return o.tipo;
  }
}

export function roteiroParaMarkdown(r, validacao, config = {}) {
  const linhas = [];
  linhas.push(`# ${r.titulo}`);
  linhas.push('');
  linhas.push(`**Promessa:** ${r.promessa}  `);
  linhas.push(`**Selo:** ${(config.marca_nome ? config.marca_nome.toUpperCase() + ' · ' : '')}${r.tema}  `);
  if (validacao?.metricas) {
    const m = validacao.metricas;
    linhas.push(`**Duração estimada:** ~${Math.round(m.duracao_estimada_s)} s · ${m.palavras} palavras · ${m.falas} falas · ${m.capitulos} capítulos`);
  }
  linhas.push('');
  linhas.push('## Loop');
  linhas.push('');
  linhas.push(`- **Última fala:** "${r.loop?.frase_final || ''}"`);
  linhas.push(`- **Emenda em:** "${r.loop?.frase_inicial || ''}"`);
  linhas.push(`- **Como emenda:** ${r.loop?.como_emenda || ''}`);
  if (r.loop?.ancora_visual) linhas.push(`- **Plano que abre e fecha:** ${r.loop.ancora_visual}`);
  linhas.push('');
  linhas.push('## Falas');
  linhas.push('');
  const caps = Object.fromEntries((r.capitulos || []).map((c) => [c.id, c]));
  let capAtual = null;
  for (const f of r.falas || []) {
    if (f.capitulo !== capAtual) {
      capAtual = f.capitulo;
      linhas.push(`### ${caps[capAtual]?.rotulo || capAtual}${caps[capAtual]?.resumo ? ` · ${caps[capAtual].resumo}` : ''}`);
      linhas.push('');
    }
    linhas.push(`**${f.id}** · _${f.funcao || ''}_ · ${f.plano || '3d'}  `);
    linhas.push(`> ${f.texto}`);
    if (f.fala && f.fala !== f.texto) linhas.push(`> 🗣 pronúncia: ${f.fala}`);
    linhas.push('');
    linhas.push(`🎬 ${f.visual}`);
    if (f.overlay) linhas.push(`  \n${descreverOverlay(f.overlay)}`);
    if (f.rotulos?.length) linhas.push(`  \n🏷 ${f.rotulos.map((x) => x.texto).join(' · ')}`);
    linhas.push('');
  }
  if (r.fontes?.length) {
    linhas.push('## Fontes');
    linhas.push('');
    for (const f of r.fontes) linhas.push(`- ${f.afirmacao}: ${f.fonte}${f.url ? ` (${f.url})` : ''}`);
    linhas.push('');
  }
  if (validacao?.avisos?.length) {
    linhas.push('## Avisos do validador');
    linhas.push('');
    for (const a of validacao.avisos) linhas.push(`- ${a}`);
    linhas.push('');
  }
  return linhas.join('\n');
}

// Texto corrido que vai para a TTS, com o mapa de posições de cada fala.
export function textoParaVoz(r) {
  let texto = '';
  const mapa = [];
  for (const f of r.falas) {
    const t = String(f.fala || f.texto).trim();
    if (texto) texto += ' ';
    const ini = texto.length;
    texto += t;
    mapa.push({ id: f.id, ini, fim: texto.length, texto: t });
  }
  return { texto, mapa };
}
