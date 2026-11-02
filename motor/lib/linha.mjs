// Linha do tempo do vídeo (fonte única de verdade para efeitos sonoros, overlays, legendas e mundo 3D).
// Entradas: roteiro.json + voz/falas.json + voz/palavras.json + config.
// Tempo do vídeo = tempo da narração + lead_in. Tudo em segundos.
import path from 'node:path';
import { lerJSON, gravarJSON, ffprobeDuracao } from './util.mjs';

const FPS_PADRAO = 30;
const normal = (w) => String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const r3 = (x) => Math.round(x * 1000) / 1000;

export function fpsDe(config) { return config?.qualidade === '1080p60' ? 60 : FPS_PADRAO; }

export function construirLinha(ctx) {
  const pasta = ctx.pasta;
  const r = ctx.roteiro();
  const cfg = ctx.config || {};
  const falasT = lerJSON(path.join(pasta, 'voz', 'falas.json'));
  const palavras = lerJSON(path.join(pasta, 'voz', 'palavras.json'));
  const durNarr = ffprobeDuracao(path.join(pasta, 'voz', 'narracao.wav')) || (falasT.at(-1)?.fim ?? 0) + 0.3;
  const fps = fpsDe(cfg);
  const lead = Number(cfg.lead_in_s ?? 0.25);
  const cauda = Number(cfg.cauda_s ?? 0.45);
  const fimFala = falasT.at(-1)?.fim ?? durNarr;
  const total = Math.ceil((lead + Math.max(fimFala, durNarr - 0.05) + cauda) * fps) / fps;
  const T = (t) => r3(t + lead);

  const caps = Object.fromEntries(r.capitulos.map((c) => [c.id, c]));
  const porFala = new Map();
  for (const w of palavras) { if (!porFala.has(w.fala)) porFala.set(w.fala, []); porFala.get(w.fala).push(w); }

  const falas = r.falas.map((f, i) => {
    const t = falasT.find((x) => x.id === f.id) || { inicio: 0, fim: 0 };
    const ws = (porFala.get(f.id) || []).map((w) => ({ texto: w.texto, inicio: T(w.inicio), fim: T(w.fim) }));
    const prox = r.falas[i + 1] ? falasT.find((x) => x.id === r.falas[i + 1].id) : null;
    return {
      id: f.id, indice: i, capitulo: f.capitulo, funcao: f.funcao || null, plano: f.plano || '3d',
      texto: f.texto, visual: f.visual, destaques: f.destaques || [],
      inicio: T(t.inicio), fim: T(t.fim),
      // "janela" vai até o começo da próxima fala (útil para planos de câmera sem buracos)
      janela_fim: prox ? T(prox.inicio) : total,
      palavras: ws, overlay: f.overlay || null, rotulos: f.rotulos || [], sfx: f.sfx || null, colagem: f.colagem || null,
    };
  });
  // a primeira janela começa em 0 e a última termina no total (loop sem buracos)
  if (falas.length) falas[0].janela_inicio = 0;
  for (let i = 1; i < falas.length; i++) falas[i].janela_inicio = falas[i].inicio;

  // capítulos
  const capitulos = [];
  for (const f of falas) {
    const ult = capitulos.at(-1);
    if (!ult || ult.id !== f.capitulo) capitulos.push({ id: f.capitulo, rotulo: caps[f.capitulo]?.rotulo || f.capitulo, inicio: capitulos.length ? f.janela_inicio : 0, fim: f.janela_fim });
    else ult.fim = f.janela_fim;
  }
  if (capitulos.length) capitulos.at(-1).fim = total;

  // overlays (cartões) com tempos
  const overlays = [];
  falas.forEach((f, i) => {
    if (!f.overlay) return;
    const o = f.overlay;
    const gat = o.gatilho ? f.palavras.find((w) => normal(w.texto).includes(normal(o.gatilho))) : null;
    const inicio = r3(gat ? gat.inicio - 0.04 : f.inicio + 0.08);
    // segura até o fim da janela da fala; se a próxima fala é do mesmo capítulo e não tem overlay, segura nela também
    let fim = f.janela_fim;
    const prox = falas[i + 1];
    if (o.segurar !== false && prox && prox.capitulo === f.capitulo && !prox.overlay && o.tipo !== 'cta') fim = prox.janela_fim;
    fim = Math.max(fim, inicio + 1.6);
    const item = { fala: f.id, ...o, inicio, fim: r3(Math.min(fim, total)) };
    if (['negacao', 'lista'].includes(o.tipo)) {
      const n = (o.itens || []).length || 1;
      const ini = Math.max(inicio, f.inicio);
      const dur = Math.max(0.6, f.fim - ini);
      // cada item aparece quando sua palavra é dita (se achar), senão espaçado ao longo da fala
      item.itens_tempos = (o.itens || []).map((txt, k) => {
        const chave = normal(String(txt).split(/\s+/)[0]);
        const w = f.palavras.find((p) => normal(p.texto).startsWith(chave.slice(0, Math.max(3, chave.length - 1))));
        return r3(w ? w.inicio - 0.03 : ini + (dur * (k + 0.35)) / n);
      });
    }
    overlays.push(item);
  });

  // um cartão sai quando o próximo entra (sem dois cartões empilhados)
  overlays.sort((x, y) => x.inicio - y.inicio);
  for (let i = 0; i + 1 < overlays.length; i++) {
    if (overlays[i].fim > overlays[i + 1].inicio) overlays[i].fim = r3(Math.max(overlays[i].inicio + 0.6, overlays[i + 1].inicio - 0.02));
  }

  // rótulos (etiquetas com linha guia) com tempos
  const rotulos = [];
  for (const f of falas) {
    for (const [k, rot] of (f.rotulos || []).entries()) {
      const gat = rot.gatilho ? f.palavras.find((w) => normal(w.texto).includes(normal(rot.gatilho))) : null;
      const inicio = r3(gat ? gat.inicio - 0.04 : f.inicio + 0.15 + k * 0.35);
      rotulos.push({ fala: f.id, ...rot, inicio, fim: r3(Math.min(total, rot.ate_capitulo ? (capitulos.find((c) => c.id === f.capitulo)?.fim ?? f.janela_fim) : Math.max(f.janela_fim, inicio + 1.5))) });
    }
  }

  // legendas: blocos equilibrados de até ~6 palavras / ~32 caracteres, quebrando em pontos naturais
  const legendas = [];
  for (const f of falas) {
    const ws = f.palavras.map((w) => ({ texto: w.texto, inicio: w.inicio, fim: w.fim, destaque: false }));
    // destaque de uma ou mais palavras: casa a sequência inteira ("campeão brasileiro" acende as duas)
    const nw = ws.map((w) => normal(w.texto));
    for (const d of f.destaques || []) {
      const partes = String(d).split(/\s+/).map(normal).filter(Boolean);
      if (!partes.length || (partes.length === 1 && partes[0].length <= 2)) continue;
      for (let i = 0; i + partes.length <= nw.length; i++) {
        const casa = partes.every((pp, k) => nw[i + k] === pp || (pp.length > 2 && nw[i + k].includes(pp)));
        if (casa) for (let k = 0; k < partes.length; k++) ws[i + k].destaque = true;
      }
    }
    for (const bloco of quebrarLegenda(ws)) legendas.push({ fala: f.id, palavras: bloco });
  }
  // primeiro todos os inícios, depois os fins (o fim depende do início do próximo grupo)
  for (const g of legendas) g.inicio = r3(Math.max(0, g.palavras[0].inicio - 0.08));
  legendas.forEach((g, i) => {
    const prox = legendas[i + 1];
    const alvo = g.palavras.at(-1).fim + 0.35;
    g.fim = r3(Math.min(prox ? prox.inicio : total, Math.max(alvo, g.inicio + 0.6)));
    if (prox && g.fim > prox.inicio) g.fim = prox.inicio;
    if (!(g.fim > g.inicio)) g.fim = r3(g.inicio + 0.3);
  });

  // efeitos sonoros
  const sfx = [];
  capitulos.forEach((c, i) => { if (i > 0) sfx.push({ t: r3(Math.max(0, c.inicio - 0.12)), tipo: 'whoosh', motivo: `capítulo ${c.rotulo}` }); });
  for (const o of overlays) {
    if (o.tipo === 'numero' || o.tipo === 'manchete') sfx.push({ t: o.inicio, tipo: 'pop', motivo: `${o.tipo} ${o.valor || ''}` });
    if (o.tipo === 'negacao') (o.itens_tempos || []).forEach((t, k) => sfx.push({ t, tipo: 'nega', motivo: o.itens[k] }));
    if (o.tipo === 'lista') (o.itens_tempos || []).forEach((t, k) => sfx.push({ t, tipo: 'tick', motivo: o.itens[k] }));
    if (o.tipo === 'cta') sfx.push({ t: o.inicio, tipo: 'impacto', motivo: 'CTA' });
  }
  for (const f of falas) {
    // sfx: "impacto" (no começo da fala) ou { "tipo": "impacto", "gatilho": "explodiu" } (na palavra)
    if (f.sfx) {
      const tipoS = typeof f.sfx === 'string' ? f.sfx : f.sfx.tipo;
      const gat = typeof f.sfx === 'object' && f.sfx.gatilho ? normal(f.sfx.gatilho) : null;
      const w = gat ? (f.palavras || []).find((p) => normal(p.texto).includes(gat)) : null;
      if (tipoS) sfx.push({ t: r3(w ? w.inicio : f.inicio), tipo: tipoS, motivo: `fala ${f.id}${w ? ` em "${w.texto}"` : ''}` });
    }
    if (f.plano === 'colagem') sfx.push({ t: r3(f.janela_inicio), tipo: 'papel', motivo: `colagem ${f.id}` });
  }
  sfx.sort((a, b) => a.t - b.t);
  // evita sons empilhados (mínimo 0,18 s entre dois)
  const sfxLimpo = [];
  for (const s of sfx) { const u = sfxLimpo.at(-1); if (u && s.t - u.t < 0.18 && s.tipo === u.tipo) continue; sfxLimpo.push(s); }

  const linha = {
    fps, total: r3(total), lead_in: lead, cauda, duracao_narracao: r3(durNarr),
    titulo: r.titulo, tema: r.tema, marca: cfg.marca_nome || '',
    loop: r.loop || null, estilo: cfg.estilo, paleta: cfg.paleta, legenda: cfg.legenda,
    falas, capitulos, overlays, rotulos, legendas, sfx: sfxLimpo,
  };
  gravarJSON(path.join(pasta, 'linha.json'), linha);
  return linha;
}

export function lerLinha(pasta) { return lerJSON(path.join(pasta, 'linha.json')); }

// ----- quebra de legenda -----
const LIGA = new Set(['e', 'mas', 'ou', 'que', 'porque', 'pra', 'para', 'por', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'com', 'sem', 'se', 'quando', 'como', 'ate', 'sobre', 'entre', 'ao', 'aos', 'a', 'o', 'as', 'os', 'um', 'uma']);
const NAO_TERMINA = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'em', 'pra', 'para', 'por', 'com', 'e', 'que', 'se', 'ao', 'mais', 'muito', 'sua', 'seu', 'meu', 'minha']);
export function quebrarLegenda(ws, maxPal = 6, maxChars = 32) {
  const n = ws.length;
  if (!n) return [];
  const chars = ws.map((w) => w.texto).join(' ').length;
  const k = Math.max(Math.ceil(n / maxPal), Math.ceil(chars / maxChars));
  if (k <= 1) return [ws];
  const cortes = [];
  let ini = 0;
  for (let b = 1; b < k; b++) {
    const ideal = Math.round((n * b) / k);
    let melhor = ideal; let melhorNota = -Infinity;
    for (let c = Math.max(ini + 2, ideal - 2); c <= Math.min(n - 2, ideal + 2); c++) {
      const ant = normal(ws[c - 1].texto); const prox = normal(ws[c].texto);
      let nota = -Math.abs(c - ideal) * 0.8;
      if (/[,.;:!?…]$/.test(ws[c - 1].texto)) nota += 3;
      if (LIGA.has(prox)) nota += 2;
      if (NAO_TERMINA.has(ant)) nota -= 3;
      if (nota > melhorNota) { melhorNota = nota; melhor = c; }
    }
    cortes.push(melhor); ini = melhor;
  }
  const blocos = []; let a = 0;
  for (const c of [...cortes, n]) { if (c > a) blocos.push(ws.slice(a, c)); a = c; }
  return blocos;
}
