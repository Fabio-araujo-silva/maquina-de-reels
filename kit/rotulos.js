// kit/rotulos.js — etiquetas (pílulas) presas a pontos 3D, com linha guia em cotovelo.
// Ficam DENTRO da composição do mundo (precisam da câmera). Os tempos vêm de window.REEL.rotulos
// (campo "rotulos" de cada fala do roteiro) e as âncoras são registradas pela cena: R.ancorar('chip', objeto).
import * as THREE from 'three';
import { seg, ease, clamp } from './nucleo.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function criarRotulos(raiz, palco, { zonaSegura = [56, 230, 1024, 1300] } = {}) {
  const P = palco.paleta; const ui = P.ui || {};
  const camada = document.createElement('div');
  camada.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  raiz.appendChild(camada);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', palco.largura); svg.setAttribute('height', palco.altura);
  svg.style.cssText = 'position:absolute;inset:0';
  camada.appendChild(svg);
  const estilo = document.createElement('style');
  estilo.textContent = `
    .rk-pilula{position:absolute;left:0;top:0;display:flex;align-items:center;gap:12px;padding:12px 22px 12px 16px;border-radius:999px;
      background:${ui.caixa || 'rgba(29,32,38,.92)'};color:${ui.texto || '#fff'};font:700 30px Inter,Arial,sans-serif;letter-spacing:-.01em;
      box-shadow:${ui.sombra || '0 10px 30px rgba(0,0,0,.28)'};white-space:nowrap;transform-origin:50% 50%;will-change:transform,opacity}
    .rk-ponto{width:14px;height:14px;border-radius:50%;flex:none}
    .rk-nega .rk-txt{text-decoration:line-through;text-decoration-thickness:3px}
    .rk-nega{border:3px solid var(--cor)}
    .rk-x{width:26px;height:26px;border-radius:50%;background:var(--cor);color:#1d2026;font:900 18px Inter;display:flex;align-items:center;justify-content:center}`;
  camada.appendChild(estilo);

  const ancoras = new Map();
  const itens = [];
  const corDe = (c) => P.acento?.[c] || c || P.acento?.laranja || '#ff8a1f';

  function ancorar(nome, alvo, offset = [0, 0, 0]) { ancoras.set(nome, { alvo, offset: new THREE.Vector3(...offset) }); }
  function pontoDe(nome, t) {
    const a = ancoras.get(nome);
    if (!a) return null;
    let v;
    if (typeof a.alvo === 'function') v = a.alvo(t);
    else if (a.alvo?.isObject3D) { v = new THREE.Vector3(); a.alvo.getWorldPosition(v); }
    else v = a.alvo?.isVector3 ? a.alvo.clone() : new THREE.Vector3(...a.alvo);
    return v.add(a.offset);
  }

  function adicionar({ texto, ancora, cor = 'laranja', inicio, fim, lado = null, dist = 170, estilo = 'pilula' }) {
    const el = document.createElement('div');
    el.className = `rk-pilula${estilo === 'nega' ? ' rk-nega' : ''}`;
    const c = corDe(cor);
    el.style.setProperty('--cor', c);
    el.innerHTML = estilo === 'nega' ? `<span class="rk-x">✕</span><span class="rk-txt"></span>` : `<span class="rk-ponto" style="background:${c}"></span><span class="rk-txt"></span>`;
    el.querySelector('.rk-txt').textContent = texto;
    el.style.opacity = '0';
    camada.appendChild(el);
    const linha = document.createElementNS(SVGNS, 'polyline');
    linha.setAttribute('fill', 'none'); linha.setAttribute('stroke', c); linha.setAttribute('stroke-width', '3'); linha.setAttribute('stroke-linejoin', 'round');
    linha.style.opacity = '0';
    const bola = document.createElementNS(SVGNS, 'circle'); bola.setAttribute('r', '7'); bola.setAttribute('fill', c); bola.setAttribute('stroke', '#fff'); bola.setAttribute('stroke-width', '3'); bola.style.opacity = '0';
    svg.appendChild(linha); svg.appendChild(bola);
    const item = { texto, ancora, inicio, fim, lado, dist, el, linha, bola, w: 0, h: 0 };
    itens.push(item);
    return item;
  }

  function doRoteiro(lista = window.REEL?.rotulos || []) { for (const r of lista) adicionar(r); }

  function atualizar(t) {
    const cam = palco.camera; cam.updateMatrixWorld();
    for (const it of itens) {
      const vis = t >= it.inicio && t < it.fim;
      if (!vis) { it.el.style.opacity = '0'; it.linha.style.opacity = '0'; it.bola.style.opacity = '0'; continue; }
      const p = pontoDe(it.ancora, t);
      if (!p) { it.el.style.opacity = '0'; continue; }
      const ndc = p.clone().project(cam);
      if (ndc.z > 1) { it.el.style.opacity = '0'; it.linha.style.opacity = '0'; it.bola.style.opacity = '0'; continue; }
      const ax = (ndc.x * 0.5 + 0.5) * palco.largura; const ay = (1 - (ndc.y * 0.5 + 0.5)) * palco.altura;
      if (!it.w) { const r = it.el.getBoundingClientRect(); it.w = r.width || it.texto.length * 17 + 60; it.h = r.height || 54; }
      const lado = it.lado || (ax > palco.largura / 2 ? 'esquerda' : 'direita');
      const sx = lado === 'esquerda' ? -1 : 1;
      let lx = ax + sx * it.dist - (sx < 0 ? it.w : 0);
      let ly = ay - it.dist * 0.75 - it.h / 2;
      lx = clamp(lx, zonaSegura[0], zonaSegura[2] - it.w);
      ly = clamp(ly, zonaSegura[1], zonaSegura[3] - it.h);
      const ent = ease.back(seg(t, it.inicio, it.inicio + 0.28), 2.2);
      const sai = 1 - seg(t, it.fim - 0.18, it.fim);
      const op = Math.min(seg(t, it.inicio, it.inicio + 0.12), sai);
      it.el.style.opacity = String(op);
      it.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) scale(${(0.82 + 0.18 * ent).toFixed(3)})`;
      // linha: sai da borda da pílula, desce na vertical e vai até a âncora
      const px = sx > 0 ? lx : lx + it.w; const py = ly + it.h / 2;
      const cx = ax;
      const prog = ease.o(seg(t, it.inicio + 0.05, it.inicio + 0.35));
      const pontos = [[px, py], [cx, py], [cx, ay]];
      const total = Math.abs(cx - px) + Math.abs(ay - py);
      it.linha.setAttribute('points', pontos.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' '));
      it.linha.setAttribute('stroke-dasharray', `${total}`);
      it.linha.setAttribute('stroke-dashoffset', `${(total * (1 - prog)).toFixed(1)}`);
      it.linha.style.opacity = String(op);
      it.bola.setAttribute('cx', ax.toFixed(1)); it.bola.setAttribute('cy', ay.toFixed(1));
      it.bola.style.opacity = String(op * (prog > 0.95 ? 1 : 0));
    }
  }

  return { ancorar, adicionar, doRoteiro, atualizar, pontoDe, itens };
}
