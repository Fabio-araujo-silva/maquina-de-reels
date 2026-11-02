// kit/nucleo.js — matemática determinística e acesso à linha do tempo (window.REEL).
// Regra de ouro do HyperFrames: tudo que aparece é função do tempo t. Nada de Date.now(),
// Math.random() sem semente, requestAnimationFrame ou estado carregado do quadro anterior.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
export const suave = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

export const ease = {
  linear: (x) => clamp(x),
  i: (x) => { x = clamp(x); return x * x * x; },
  o: (x) => { x = clamp(x); return 1 - (1 - x) ** 3; },
  io: (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; },
  io2: (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; },
  expo: (x) => { x = clamp(x); return x === 1 ? 1 : 1 - 2 ** (-10 * x); },
  back: (x, s = 1.70158) => { x = clamp(x); const c = s + 1; return 1 + c * (x - 1) ** 3 + s * (x - 1) ** 2; },
  elastico: (x) => { x = clamp(x); if (x === 0 || x === 1) return x; return 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
  mola: (x, k = 7, z = 0.45) => { x = clamp(x); return 1 - Math.exp(-z * k * x) * Math.cos(k * Math.sqrt(1 - z * z) * x); },
};
export const easeDe = (nome) => (typeof nome === 'function' ? nome : ease[nome] || ease.io);

// PRNG com semente
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function ruido1(t, semente = 0) {
  const i = Math.floor(t); const f = t - i; const u = f * f * (3 - 2 * f);
  return lerp(hash(i + semente * 101.3), hash(i + 1 + semente * 101.3), u) * 2 - 1;
}

// Trilha de keyframes: [{t, v, e}] onde v é número ou array. e = ease para chegar NESTE keyframe.
export function trilha(chaves) {
  const ks = [...chaves].sort((a, b) => a.t - b.t);
  return (t) => {
    if (t <= ks[0].t) return ks[0].v;
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i].t) {
        const a = ks[i - 1]; const b = ks[i];
        const p = easeDe(b.e || 'io')(seg(t, a.t, b.t));
        return Array.isArray(a.v) ? a.v.map((x, k) => lerp(x, b.v[k], p)) : lerp(a.v, b.v, p);
      }
    }
    return ks[ks.length - 1].v;
  };
}

// Entrada/saída de um elemento num intervalo: 0 antes, sobe em `ent`, 1 no meio, desce em `sai`.
export function janelaVisivel(t, inicio, fim, ent = 0.25, sai = 0.2) {
  if (t < inicio || t >= fim) return 0;
  return Math.min(seg(t, inicio, inicio + ent), 1 - seg(t, fim - sai, fim));
}

// Passo stop-motion (anima "em dois" a 12 qps): use para colagem/recortes.
export const passo = (t, qps = 12) => Math.floor(t * qps) / qps;

// ---------- linha do tempo (window.REEL, gerada pelo motor) ----------
export const REEL = () => window.REEL;
export const PALETA = () => window.REEL?.paleta || {};
export function fala(id) { return REEL().falas.find((f) => f.id === id); }
export function janela(id) { const f = fala(id); return f ? { ini: f.janela_inicio ?? f.inicio, fim: f.janela_fim, falaIni: f.inicio, falaFim: f.fim } : null; }
export function falaEm(t) { const fs = REEL().falas; let atual = fs[0]; for (const f of fs) if (t >= (f.janela_inicio ?? f.inicio)) atual = f; return atual; }
export function capituloEm(t) { return REEL().capitulos.find((c) => t >= c.inicio && t < c.fim) || REEL().capitulos.at(-1); }
export function palavraEm(t) { for (const f of REEL().falas) for (const w of f.palavras) if (t >= w.inicio && t < w.fim) return w; return null; }
// Tempo em que uma palavra (parcial, sem acento) é dita dentro de uma fala.
export function quando(falaId, trecho) {
  const n = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const f = fala(falaId); if (!f) return null;
  const w = f.palavras.find((p) => n(p.texto).includes(n(trecho)));
  return w ? w.inicio : f.inicio;
}
export const TOTAL = () => REEL().total;

// ---------- vídeo híbrido: vários mundos (estilos) no mesmo vídeo ----------
// REEL.mundos = [{ id, estilo, base, janelas: [[ini, fim], ...] }]. O mundo base fica por baixo o vídeo todo;
// os outros aparecem só nas suas janelas, com uma transição curta (REEL.transicao_mundos, padrão 0,15 s; 0 = corte seco).
export function presencaMundo(id, t) {
  const R = REEL();
  const m = R?.mundos?.find((x) => x.id === id);
  if (!m || m.base) return 1;
  const fade = R.transicao_mundos ?? 0.15;
  const fim = R.total;
  let p = 0;
  for (const [a, b] of m.janelas || []) {
    if (t < a || t > b) continue;
    const entra = a <= 0.001 || fade <= 0 ? 1 : clamp((t - a) / fade);
    const sai = b >= fim - 0.001 || fade <= 0 ? 1 : clamp((b - t) / fade);
    p = Math.max(p, Math.min(entra, sai));
  }
  return p;
}
// O mundo está totalmente coberto em t? (por uma colagem de tela cheia ou, no caso do mundo base, por outro mundo)
export function coberto(id, t) {
  const R = REEL();
  if (!R) return false;
  for (const c of Object.values(R.colagens || {})) if (t > c.inicio + 0.05 && t < c.fim - 0.05) return true;
  const eu = R.mundos?.find((x) => x.id === id);
  if (eu && !eu.base) return false;
  return (R.mundos || []).some((x) => x.id !== id && !x.base && presencaMundo(x.id, t) >= 0.999);
}
// Liga o mundo ao relógio do HyperFrames: mostra o canvas só quando o mundo aparece e só desenha quando ele é visto.
export function ligarMundo(id, tela, render) {
  const aplicar = (t) => {
    const p = presencaMundo(id, t);
    tela.style.opacity = String(p);
    tela.style.visibility = p > 0 ? 'visible' : 'hidden';
    if (p > 0 && !coberto(id, t)) render(t);
  };
  window.addEventListener('hf-seek', (e) => aplicar(e.detail.time));
  aplicar(0);
}
