// Geradores das peças do projeto HyperFrames a partir da linha do tempo (linha.json).
// Overlays e legendas são 100% automáticos; o mundo (compositions/mundo.html) é escrito pelo Claude
// a partir de um modelo por estilo; colagens saem do storyboard.
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../../motor/lib/util.mjs';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n3 = (x) => { const v = Number(x); if (!Number.isFinite(v)) throw new Error(`tempo inválido na montagem: ${x}`); return v.toFixed(3); };
const dur = (a, b) => n3(Math.max(0.04, b - a));

export function paletaDe(cfg) {
  const todas = JSON.parse(fs.readFileSync(path.join(P.kit, 'paletas.json'), 'utf8'));
  let p = todas[cfg.paleta] || todas['clara-neutra'];
  if (cfg.paleta === 'marca' && cfg.marca_cores) {
    p = JSON.parse(JSON.stringify(todas['clara-neutra']));
    const c = cfg.marca_cores;
    p.nome = 'Cores da marca';
    p.acento = { ...p.acento, laranja: c.primaria || p.acento.laranja, verde: c.secundaria || p.acento.verde };
    p.ui = { ...p.ui, caixa: c.fundo || p.ui.caixa, texto: c.texto || p.ui.texto };
  }
  return p;
}

// ---------------- index.html ----------------
export function gerarIndex({ linha, largura = 1080, altura = 1920, colagens = [], temAudio = true, legendas = true, mundos = [{ id: 'mundo' }] }) {
  const T = n3(linha.total);
  const hosts = [];
  (mundos.length ? mundos : [{ id: 'mundo' }]).forEach((m, k) => hosts.push(`  <div id="${m.id}" data-composition-id="${m.id}" data-composition-src="compositions/${m.id}.html" data-start="0" data-duration="${T}" data-track-index="${k === 0 ? 0 : 40 + k}" data-track-kind="graphics" data-width="${largura}" data-height="${altura}" style="z-index:1"></div>`));
  colagens.forEach((c, i) => {
    hosts.push(`  <div id="${c.id}" data-composition-id="${c.id}" data-composition-src="compositions/${c.id}.html" data-start="${n3(c.inicio)}" data-duration="${dur(c.inicio, c.fim)}" data-track-index="${1 + i}" data-track-kind="graphics" data-width="${largura}" data-height="${altura}" style="z-index:2"></div>`);
  });
  hosts.push(`  <div id="overlays" data-composition-id="overlays" data-composition-src="compositions/overlays.html" data-start="0" data-duration="${T}" data-track-index="20" data-track-kind="graphics" data-width="${largura}" data-height="${altura}" style="z-index:3"></div>`);
  if (legendas) hosts.push(`  <div id="legendas" data-composition-id="legendas" data-composition-src="compositions/legendas.html" data-start="0" data-duration="${T}" data-track-index="21" data-track-kind="captions" data-width="${largura}" data-height="${altura}" style="z-index:4"></div>`);
  if (temAudio) hosts.push(`  <audio id="mix" class="clip" src="assets/mix.wav" data-start="0" data-duration="${T}" data-track-index="30" data-volume="1"></audio>`);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${largura}, height=${altura}" />
<title>${esc(linha.titulo || 'Reel')}</title>
<script type="importmap">{"imports":{"three":"./assets/lib/three/three.module.js","three/addons/":"./assets/lib/three/addons/","kit/":"./assets/kit/","lemo/":"./assets/lemo/"}}</script>
<script src="assets/lib/gsap.min.js"></script>
<script src="assets/dados.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${largura}px; height: ${altura}px; overflow: hidden; background: #000; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-fps="${linha.fps}" data-width="${largura}" data-height="${altura}">
${hosts.join('\n')}
</div>
<script>
  window.__timelines["main"] = gsap.timeline({ paused: true });
</script>
</body>
</html>
`;
}

// ---------------- overlays ----------------
function corAcento(paleta, nome) { return paleta.acento?.[nome] || nome || paleta.acento?.laranja || '#ff8a1f'; }

export function gerarOverlays(linha, paleta, cfg) {
  const ui = paleta.ui || {};
  const els = []; const tw = [];
  const T = linha.total;
  const marca = (cfg.marca_nome || '').trim();
  // selo (kicker)
  if (marca || linha.tema) {
    const txt = [marca, linha.tema].filter(Boolean).join(' · ').toUpperCase();
    els.push(`<div id="ov-kicker" class="clip" data-start="0" data-duration="${n3(T)}" data-track-index="1"><div id="ov-kicker-in" class="kicker" data-layout-ignore>${esc(txt)}</div></div>`);
  }
  // pílula de capítulo (uma por capítulo; o texto entra deslizando)
  linha.capitulos.forEach((c, i) => {
    const id = `ov-cap${i}`;
    els.push(`<div id="${id}" class="clip" data-start="${n3(c.inicio)}" data-duration="${dur(c.inicio, c.fim)}" data-track-index="2"><div id="${id}-in" class="cap"><span class="cap-tog"><span class="cap-bola"></span></span><span class="cap-ponto"></span><span id="${id}-txt" class="cap-txt">${esc(String(c.rotulo).toUpperCase())}</span></div></div>`);
    tw.push(`tl.fromTo("#${id}-txt", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.28, ease: "power3.out" }, ${n3(c.inicio + 0.02)});`);
    if (i < linha.capitulos.length - 1) tw.push(`tl.set("#${id}-in", { visibility: "hidden" }, ${n3(c.fim)});`);
    else tw.push(`tl.to("#${id}-txt", { y: -18, opacity: 0, duration: 0.22, ease: "power2.in" }, ${n3(Math.max(c.inicio + 0.5, T - 0.26))});`);
    // a caixa da pílula NÃO anima no começo: no loop ela já está na tela (só o texto troca, como numa troca de capítulo)
  });
  // cartões
  let k = 0;
  for (const o of linha.overlays) {
    const id = `ov-o${k++}`;
    const cor = corAcento(paleta, o.cor || (o.tipo === 'cta' ? 'verde' : 'laranja'));
    const ini = Math.max(0, o.inicio); const fim = Math.min(T, o.fim);
    if (o.tipo === 'numero' || o.tipo === 'manchete' || o.tipo === 'cta') {
      const grande = o.tipo === 'manchete' ? 'card-manchete' : o.tipo === 'cta' ? 'card-cta' : '';
      els.push(`<div id="${id}" class="clip" data-start="${n3(ini)}" data-duration="${dur(ini, fim)}" data-track-index="3"><div class="centro ${o.tipo === 'cta' ? 'centro-cta' : ''}"><div id="${id}-in" class="card ${grande}" style="--cor:${cor}">${o.rotulo ? `<div class="card-rot">${esc(String(o.rotulo).toUpperCase())}</div>` : ''}<div class="card-val">${esc(String(o.valor || '').toUpperCase())}</div></div></div></div>`);
      tw.push(`tl.fromTo("#${id}-in", { scale: 0.55, opacity: 0, y: -10 }, { scale: 1, opacity: 1, y: 0, duration: 0.42, ease: "back.out(2.2)" }, ${n3(ini)});`);
      tw.push(`tl.to("#${id}-in", { opacity: 0, scale: 0.94, duration: 0.18, ease: "power2.in" }, ${n3(Math.max(ini + 0.5, fim - 0.2))});`);
      tw.push(`tl.set("#${id}-in", { opacity: 0, visibility: "hidden" }, ${n3(fim)});`);
    } else if (o.tipo === 'negacao' || o.tipo === 'lista') {
      const itens = (o.itens || []).map((it, j) => {
        const ti = o.itens_tempos?.[j] ?? ini + j * 0.4;
        const icone = o.tipo === 'negacao' ? `<span class="chip-x">✕</span>` : `<span class="chip-ponto" style="background:${corAcento(paleta, ['laranja', 'azul', 'roxo', 'verde', 'amarelo'][j % 5])}"></span>`;
        tw.push(`tl.fromTo("#${id}-i${j}", { x: -24, opacity: 0, scale: 0.8 }, { x: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.4)" }, ${n3(ti)});`);
        return `<div id="${id}-i${j}" class="chip ${o.tipo === 'negacao' ? 'chip-nega' : ''}" style="--cor:${cor}">${icone}<span class="chip-txt">${esc(it)}</span></div>`;
      }).join('');
      els.push(`<div id="${id}" class="clip" data-start="${n3(ini)}" data-duration="${dur(ini, fim)}" data-track-index="4"><div id="${id}-in" class="lista ${o.tipo === 'negacao' ? 'lista-dir' : ''}">${o.rotulo ? `<div class="lista-rot">${esc(String(o.rotulo).toUpperCase())}</div>` : ''}<div class="lista-itens">${itens}</div></div></div>`);
      tw.push(`tl.fromTo("#${id}-in", { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${n3(ini)});`);
      tw.push(`tl.to("#${id}-in", { opacity: 0, duration: 0.18 }, ${n3(Math.max(ini + 0.5, fim - 0.2))});`);
      tw.push(`tl.set("#${id}-in", { opacity: 0, visibility: "hidden" }, ${n3(fim)});`);
    }
  }
  const css = `
#root{position:absolute;inset:0;font-family:Inter,Arial,sans-serif;pointer-events:none}
.kicker{position:absolute;left:46px;top:258px;font:600 24px "JetBrains Mono","IBM Plex Mono",monospace;letter-spacing:.3em;color:${ui.kicker || 'rgba(255,255,255,.88)'};text-shadow:0 1px 3px rgba(0,0,0,.7),0 0 14px rgba(0,0,0,.5)}
.cap{position:absolute;left:40px;top:302px;display:flex;align-items:center;gap:12px;height:58px;padding:0 24px 0 9px;border-radius:999px;background:${ui.caixa};box-shadow:${ui.sombra};overflow:hidden}
.cap-tog{width:58px;height:40px;border-radius:999px;background:rgba(255,255,255,.14);display:flex;align-items:center;padding-left:5px}
.cap-bola{width:30px;height:30px;border-radius:50%;background:#fff}
.cap-ponto{width:9px;height:9px;border-radius:50%;background:${corAcento(paleta, 'verde')}}
.cap-txt{font:800 28px "JetBrains Mono","IBM Plex Mono",monospace;letter-spacing:.12em;color:${ui.texto}}
.centro{position:absolute;left:0;right:0;top:372px;display:flex;justify-content:center}
.centro-cta{top:392px}
.card{position:relative;min-width:420px;padding:18px 40px 20px;border-radius:24px;background:${ui.caixa};border:4px solid var(--cor);box-shadow:${ui.sombra};text-align:center}
.card-rot{font:600 28px "JetBrains Mono","IBM Plex Mono",monospace;letter-spacing:.24em;color:${ui.inativo};margin-bottom:6px;white-space:nowrap}
.card-val{font:900 92px Inter,Arial,sans-serif;letter-spacing:-.03em;line-height:1;color:var(--cor);white-space:nowrap}
.card-manchete .card-val{font-size:84px}
.card-cta{max-width:980px}
.card-cta .card-val{font-size:66px;white-space:normal}
.lista{position:absolute;left:40px;top:386px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.lista-dir{left:auto;right:40px;align-items:flex-end}
.lista-rot{font:700 28px "JetBrains Mono","IBM Plex Mono",monospace;letter-spacing:.22em;color:${ui.texto};background:${ui.caixa};padding:8px 16px;border-radius:999px}
.lista-itens{display:flex;flex-wrap:wrap;gap:12px;max-width:980px}
.lista-dir .lista-itens{justify-content:flex-end}
.chip{display:flex;align-items:center;gap:14px;padding:14px 26px 14px 16px;border-radius:999px;background:${ui.caixa};color:${ui.texto};font:800 36px Inter,Arial,sans-serif;box-shadow:${ui.sombra}}
.chip-ponto{width:16px;height:16px;border-radius:50%}
.chip-nega{border:3px solid var(--cor)}
.chip-nega .chip-txt{text-decoration:line-through;text-decoration-thickness:3px;text-transform:uppercase;letter-spacing:.04em}
.chip-x{width:28px;height:28px;border-radius:50%;background:var(--cor);color:#1d2026;font:900 18px Inter;display:flex;align-items:center;justify-content:center}`;
  return composicao('overlays', css, els.join('\n  '), tw.join('\n    '));
}

// ---------------- legendas ----------------
export function gerarLegendas(linha, paleta, cfg) {
  const ui = paleta.ui || {};
  const estilo = cfg.legenda || 'karaoke-caixa';
  const y = cfg.legenda_y ?? 1400;
  const destaque = corAcento(paleta, 'laranja');
  const els = []; const tw = [];
  linha.legendas.forEach((g, i) => {
    const id = `lg${i}`;
    let palavras = g.palavras;
    if (estilo === 'grande-central') palavras = palavras.map((w) => ({ ...w, texto: String(w.texto).toUpperCase() }));
    const spans = palavras.map((w, j) => `<span id="${id}-w${j}" class="w${w.destaque ? ' d' : ''}">${esc(w.texto)}</span>`).join(' ');
    els.push(`<div id="${id}" class="clip" data-start="${n3(g.inicio)}" data-duration="${dur(g.inicio, g.fim)}" data-track-index="1"><div class="leg-faixa"><div id="${id}-c" class="leg">${spans}</div></div></div>`);
    tw.push(`tl.fromTo("#${id}-c", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, ${n3(g.inicio)});`);
    tw.push(`tl.to("#${id}-c", { opacity: 0, duration: 0.08, ease: "power2.in" }, ${n3(Math.max(g.inicio + 0.12, g.fim - 0.08))});`);
    tw.push(`tl.set("#${id}-c", { opacity: 0, visibility: "hidden" }, ${n3(g.fim)});`);
    palavras.forEach((w, j) => {
      const t = n3(Math.max(g.inicio, w.inicio));
      if (estilo === 'karaoke-caixa') tw.push(`tl.fromTo("#${id}-w${j}", { color: "${ui.inativo}" }, { color: "${w.destaque ? destaque : ui.texto}", duration: 0.08 }, ${t});`);
      else if (estilo === 'palavra-pilula') {
        tw.push(`tl.fromTo("#${id}-w${j}", { backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "${w.destaque ? destaque : corAcento(paleta, 'azul')}", duration: 0.06 }, ${t});`);
        tw.push(`tl.to("#${id}-w${j}", { backgroundColor: "rgba(0,0,0,0)", duration: 0.06 }, ${n3(Math.max(w.inicio + 0.06, w.fim))});`);
      } else if (estilo === 'grande-central') tw.push(`tl.fromTo("#${id}-w${j}", { color: "#ffffff", scale: 1 }, { color: "${w.destaque ? destaque : '#ffe14d'}", scale: 1.08, duration: 0.08 }, ${t});`);
    });
  });
  const base = `#root{position:absolute;inset:0;pointer-events:none}
.leg-faixa{position:absolute;left:0;right:0;top:${estilo === 'grande-central' ? 880 : y}px;display:flex;justify-content:center}`;
  const css = {
    'karaoke-caixa': `${base}
.leg{position:relative;max-width:920px;width:max-content;padding:14px 28px 16px;border-radius:18px;background:${ui.caixa};box-shadow:${ui.sombra};text-align:center;font:800 54px/1.16 Inter,Arial,sans-serif;letter-spacing:-.015em;color:${ui.inativo}}
.w{display:inline-block}`,
    'palavra-pilula': `${base}
.leg{position:relative;max-width:940px;width:max-content;text-align:center;font:900 58px/1.25 Inter,Arial,sans-serif;color:#fff;text-shadow:0 3px 12px rgba(0,0,0,.55)}
.w{display:inline-block;padding:0 10px;border-radius:12px}`,
    'grande-central': `${base}
.leg{position:relative;max-width:960px;width:max-content;text-align:center;font:900 104px/1.02 Inter,Arial,sans-serif;letter-spacing:-.03em;color:#fff;text-shadow:0 6px 24px rgba(0,0,0,.6)}
.w{display:inline-block}`,
  }[estilo] || '';
  return composicao('legendas', css, els.join('\n  '), tw.join('\n    '));
}

function composicao(id, css, corpo, tweens) {
  return `<template>
<style>${css}
</style>
<div id="root" data-composition-id="${id}" data-width="1080" data-height="1920">
  ${corpo}
</div>
<script>
  (function () {
    const tl = gsap.timeline({ paused: true });
    ${tweens}
    window.__timelines["${id}"] = tl;
  })();
</script>
</template>
`;
}

// ---------------- colagem (motor em código do gbro) ----------------
export function gerarColagem(c) {
  return `<template>
<style>#root{position:absolute;inset:0;overflow:hidden} #${c.id}-tela{position:absolute;inset:0;width:100%;height:100%}</style>
<div id="root" data-composition-id="${c.id}" data-width="1080" data-height="1920">
  <canvas id="${c.id}-tela" width="1080" height="1920"></canvas>
</div>
<script type="module">
  import { criarColagem } from 'kit/colagem.js';
  const spec = window.REEL.colagens["${c.id}"];
  const col = criarColagem(document.getElementById("${c.id}-tela"), spec, { semente: ${c.semente || 7} });
  window.addEventListener("hf-seek", (e) => col.desenhar(e.detail.time));
  col.desenhar(spec.inicio);
  window.__timelines["${c.id}"] = gsap.timeline({ paused: true });
</script>
</template>
`;
}

// ---------------- ícones (Phosphor fill) ----------------
export function carregarIcone(nome) {
  const limpo = String(nome).replace(/-fill$/, '');
  const arq = path.join(P.nodeModules, '@phosphor-icons', 'core', 'assets', 'fill', `${limpo}-fill.svg`);
  if (!fs.existsSync(arq)) return null;
  const svg = fs.readFileSync(arq, 'utf8');
  const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 256 256').split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  return { viewBox: [vb[2], vb[3]], paths };
}
export function iconeExiste(nome) { return Boolean(carregarIcone(nome)); }
export function sugerirIcones(termo, max = 12) {
  const dir = path.join(P.nodeModules, '@phosphor-icons', 'core', 'assets', 'fill');
  const t = String(termo).toLowerCase();
  return fs.readdirSync(dir).filter((f) => f.includes(t)).slice(0, max).map((f) => f.replace(/-fill\.svg$/, ''));
}
