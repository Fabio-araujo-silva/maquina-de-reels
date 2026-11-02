// kit/colagem.js — colagem de papel em meio-tom (estética do gbro-collage-broll), desenhada em canvas 2D.
// Campo de cor chapado + grão de papel; recortes de ícones (Phosphor fill) em meio-tom P&B ou cartolina
// colorida, com contorno creme e sombra suave; montagem "assemble-from-empty" em stop-motion (12 qps).
//
// spec = { fundo:'#hex', elementos:[{ icone | forma, estilo:'halftone'|'cartao', cor, x, y, escala, rot, entra, ordem,
//          gatilho | em, vai }], acao:{ tipo:'gira'|'pulsa'|'treme'|'balanca', elemento:indice }, inicio, fim, falas }
// Ícones: window.REEL.icones[nome] = { viewBox:[w,h], paths:[d...] } (o motor embute só os usados).
// Tempo: `gatilho` = palavra da narração em que o elemento entra (ou `em` = segundos desde o início da colagem);
//   sem os dois, os elementos entram em sequência na primeira metade do trecho.
// `vai`: { x, y, gatilho | em, dur, passos } — o elemento anda até (x, y) nesse momento, com passinhos.
// Formas desenhadas (sem ícone): `forma: 'farol'` (torre listrada; `cor`), `forma: 'facho'` (luz saindo da
//   lanterna do farol: `origem` = índice do farol, `rot` em graus, `comprimento` e `abertura`; entra 'acende'),
//   `forma: 'polaroid'` (foto de papel com `texto` embaixo e `retrato: { pele, cabelo, corCabelo, barba, corBarba,
//   terno, camisa, gravata, fundo }` desenhado dentro).
import { mulberry32, ease, seg, clamp, passo } from './nucleo.js';

const CREME = '#fff3dc';
const rgba = (hex, a) => { const n = parseInt(String(hex).replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const normal = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function gerarGrao(w, h, semente = 3) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const img = g.createImageData(w, h); const rnd = mulberry32(semente);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // fibras
  g.globalAlpha = 0.07; g.strokeStyle = '#000';
  for (let i = 0; i < 900; i++) { const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke(); }
  return c;
}

function caminhoDe(icone) {
  const p = new Path2D();
  for (const d of icone.paths) p.addPath(new Path2D(d));
  return p;
}

// Pré-desenha um recorte (sombra + contorno + preenchimento) num canvas próprio.
function desenharRecorte(icone, { tamanho, estilo, cor, semente }) {
  const [vw, vh] = icone.viewBox || [256, 256];
  const s = tamanho / Math.max(vw, vh);
  const pad = Math.ceil(tamanho * 0.14);
  const W = Math.ceil(vw * s) + pad * 2; const H = Math.ceil(vh * s) + pad * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const caminho = caminhoDe(icone);
  const rnd = mulberry32(semente);
  g.translate(pad, pad); g.scale(s, s);
  // sombra
  g.save(); g.shadowColor = 'rgba(0,0,0,0.32)'; g.shadowBlur = 22 / s * 1; g.shadowOffsetX = 9; g.shadowOffsetY = 12;
  g.fillStyle = CREME; g.fill(caminho); g.restore();
  // contorno creme (borda do recorte)
  g.save(); g.lineJoin = 'round'; g.lineWidth = Math.max(10, 16 / s * 0.6) ; g.strokeStyle = CREME; g.stroke(caminho); g.fillStyle = CREME; g.fill(caminho); g.restore();
  // preenchimento
  g.save(); g.clip(caminho);
  if (estilo === 'cartao') {
    g.fillStyle = cor || '#ff6b3d'; g.fillRect(0, 0, vw, vh);
    g.globalAlpha = 0.12; for (let i = 0; i < 400; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * vw, rnd() * vh, 1.2, 1.2); }
  } else {
    // meio-tom: pontos pretos com raio variando por uma luz "fotográfica" (canto superior esquerdo)
    g.fillStyle = '#f2ede2'; g.fillRect(0, 0, vw, vh);
    const passoP = Math.max(vw, vh) / 34;
    g.fillStyle = '#1b1b1b';
    const ang = 0.26;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (let u = -vw; u < vw * 2; u += passoP) for (let v = -vh; v < vh * 2; v += passoP) {
      const x = u * cs - v * sn; const y = u * sn + v * cs;
      if (x < -passoP || y < -passoP || x > vw + passoP || y > vh + passoP) continue;
      const luz = clamp(0.25 + 0.75 * ((x / vw) * 0.55 + (y / vh) * 0.65)) * (0.85 + rnd() * 0.3);
      const r = passoP * 0.5 * Math.sqrt(clamp(luz * 0.95));
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
  return { canvas: c, W, H, ox: pad + (vw * s) / 2, oy: pad + (vh * s) / 2 };
}

// Recorte de papel a partir de um contorno (Path2D em 0..W × 0..H): sombra + borda creme + pintura recortada.
function recorteDeContorno(W, H, contorno, pintar) {
  const pad = Math.ceil(Math.max(W, H) * 0.1);
  const c = document.createElement('canvas'); c.width = Math.ceil(W + pad * 2); c.height = Math.ceil(H + pad * 2);
  const g = c.getContext('2d'); g.translate(pad, pad);
  g.save(); g.shadowColor = 'rgba(0,0,0,0.32)'; g.shadowBlur = 22; g.shadowOffsetX = 9; g.shadowOffsetY = 12; g.fillStyle = CREME; g.fill(contorno); g.restore();
  g.save(); g.lineJoin = 'round'; g.lineWidth = Math.max(8, W * 0.035); g.strokeStyle = CREME; g.stroke(contorno); g.fillStyle = CREME; g.fill(contorno); g.restore();
  g.save(); g.clip(contorno); pintar(g); g.restore();
  return { canvas: c, W: c.width, H: c.height, ox: pad + W / 2, oy: pad + H / 2 };
}

// Farol de papel: torre listrada, galeria, lanterna acesa e cúpula. Guarda a posição da lanterna para o facho.
function desenharFarol({ tamanho, cor = '#d62828', semente = 1 }) {
  const W = tamanho * 0.62; const H = tamanho * 1.6; const cx = W / 2;
  const p = new Path2D();
  p.rect(cx - W * 0.025, 0, W * 0.05, H * 0.06);
  p.moveTo(cx - W * 0.25, H * 0.125); p.ellipse(cx, H * 0.125, W * 0.25, H * 0.075, 0, Math.PI, Math.PI * 2); p.closePath();
  p.rect(cx - W * 0.18, H * 0.12, W * 0.36, H * 0.125);
  p.rect(cx - W * 0.31, H * 0.24, W * 0.62, H * 0.04);
  p.moveTo(cx - W * 0.2, H * 0.275); p.lineTo(cx + W * 0.2, H * 0.275); p.lineTo(cx + W * 0.37, H * 0.9); p.lineTo(cx - W * 0.37, H * 0.9); p.closePath();
  p.rect(0, H * 0.895, W, H * 0.105);
  const rnd = mulberry32(semente);
  const r = recorteDeContorno(W, H, p, (g) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
    const faixa = (H * 0.625) / 6;
    for (let i = 0; i < 6; i += 2) { g.fillStyle = cor; g.fillRect(0, H * 0.275 + i * faixa, W, faixa); }
    g.fillStyle = cor; g.fillRect(0, 0, W, H * 0.125);
    const luz = g.createRadialGradient(cx, H * 0.18, 2, cx, H * 0.18, W * 0.22);
    luz.addColorStop(0, '#fffbe0'); luz.addColorStop(1, '#ffc93c');
    g.fillStyle = luz; g.fillRect(cx - W * 0.18, H * 0.125, W * 0.36, H * 0.115);
    g.fillStyle = '#1b1b1b';
    for (const dx of [-0.07, 0.07]) g.fillRect(cx + W * dx - W * 0.012, H * 0.125, W * 0.024, H * 0.115);
    g.fillRect(0, H * 0.24, W, H * 0.04);
    for (const yy of [0.47, 0.66]) g.fillRect(cx - W * 0.03, H * yy, W * 0.06, H * 0.045);
    g.beginPath(); g.moveTo(cx - W * 0.075, H * 0.9); g.lineTo(cx - W * 0.075, H * 0.83); g.arc(cx, H * 0.83, W * 0.075, Math.PI, 0); g.lineTo(cx + W * 0.075, H * 0.9); g.closePath(); g.fill();
    g.fillStyle = '#4a4744'; g.fillRect(0, H * 0.895, W, H * 0.105);
    g.globalAlpha = 0.12; for (let i = 0; i < 500; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * W, rnd() * H, 1.4, 1.4); }
  });
  r.lanterna = { dx: 0, dy: H * 0.18 - H / 2 };
  return r;
}

// Facho de luz (celofane amarelo): ápice na origem, abre para a direita; gire com `rot`.
function desenharFacho({ comprimento, abertura = 26, cor = '#ffe27a' }) {
  const L = comprimento; const meia = L * Math.tan((abertura * Math.PI) / 360); const pad = 16;
  const c = document.createElement('canvas'); c.width = Math.ceil(L + pad * 2); c.height = Math.ceil(meia * 2 + pad * 2);
  const g = c.getContext('2d'); g.translate(pad, pad + meia);
  const grad = g.createLinearGradient(0, 0, L, 0);
  grad.addColorStop(0, rgba(cor, 0.92)); grad.addColorStop(0.55, rgba(cor, 0.5)); grad.addColorStop(1, rgba(cor, 0));
  g.fillStyle = grad; g.beginPath(); g.moveTo(0, -meia * 0.1); g.lineTo(L, -meia); g.lineTo(L, meia); g.lineTo(0, meia * 0.1); g.closePath(); g.fill();
  return { canvas: c, W: c.width, H: c.height, ox: pad, oy: pad + meia };
}

// Retrato simples (para polaroids): fundo, terno/camisa/gravata, cabeça, cabelo, barba em U com bigode.
function desenharRetrato(g, x, y, w, h, r = {}) {
  const { fundo = '#c9d3e0', pele = '#e3b893', cabelo = 'curto', corCabelo = '#2b2b2b', barba = null, corBarba = null, terno = '#1d2638', camisa = '#f4f4f2', gravata = null } = r;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = fundo; g.fillRect(x, y, w, h);
  const cx = x + w / 2;
  g.fillStyle = terno; g.beginPath(); g.moveTo(x + w * 0.04, y + h); g.quadraticCurveTo(x + w * 0.08, y + h * 0.74, cx, y + h * 0.71); g.quadraticCurveTo(x + w * 0.92, y + h * 0.74, x + w * 0.96, y + h); g.closePath(); g.fill();
  g.fillStyle = camisa; g.beginPath(); g.moveTo(cx - w * 0.11, y + h * 0.715); g.lineTo(cx + w * 0.11, y + h * 0.715); g.lineTo(cx, y + h * 0.95); g.closePath(); g.fill();
  if (gravata) { g.fillStyle = gravata; g.beginPath(); g.moveTo(cx - w * 0.03, y + h * 0.72); g.lineTo(cx + w * 0.03, y + h * 0.72); g.lineTo(cx + w * 0.05, y + h * 0.92); g.lineTo(cx, y + h * 0.98); g.lineTo(cx - w * 0.05, y + h * 0.92); g.closePath(); g.fill(); }
  const hy = y + h * 0.42; const rx = w * 0.2; const ry = h * 0.23;
  g.fillStyle = pele; g.fillRect(cx - w * 0.075, hy + ry * 0.6, w * 0.15, h * 0.16);
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * rx * 0.98, hy + ry * 0.05, rx * 0.16, ry * 0.2, 0, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.ellipse(cx, hy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  if (cabelo !== 'careca') {
    g.fillStyle = corCabelo;
    g.beginPath(); g.ellipse(cx, hy - ry * 0.42, rx * 1.03, ry * 0.66, 0, Math.PI, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * rx * 0.9, hy - ry * 0.2, rx * 0.17, ry * 0.36, 0, 0, Math.PI * 2); g.fill(); }
  }
  const corB = corBarba || corCabelo;
  if (barba && barba !== 'bigode') {
    g.save(); g.beginPath(); g.ellipse(cx, hy, rx * 1.04, ry * 1.06, 0, 0, Math.PI * 2); g.ellipse(cx, hy + ry * 0.9, rx * 0.8, ry * 0.42, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = corB; g.fillRect(x, hy + ry * 0.12, w, h); g.restore();
  }
  g.fillStyle = '#1b1b1b'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * rx * 0.38, hy - ry * 0.05, w * 0.018, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = corB; g.lineWidth = w * 0.022; g.lineCap = 'round';
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * rx * 0.2, hy - ry * 0.24); g.lineTo(cx + s * rx * 0.56, hy - ry * 0.27); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = w * 0.012; g.beginPath(); g.moveTo(cx, hy + ry * 0.02); g.lineTo(cx + rx * 0.09, hy + ry * 0.3); g.lineTo(cx - rx * 0.04, hy + ry * 0.33); g.stroke();
  if (barba) { g.fillStyle = corB; g.beginPath(); g.ellipse(cx, hy + ry * 0.45, rx * 0.44, ry * 0.11, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(40,20,20,.6)'; g.fillRect(cx - rx * 0.2, hy + ry * 0.58, rx * 0.4, ry * 0.055);
  g.restore();
}

function desenharPolaroid({ tamanho, texto = '', retrato = null, semente = 1 }) {
  const W = tamanho; const H = tamanho * 1.2; const pad = Math.ceil(tamanho * 0.14);
  const c = document.createElement('canvas'); c.width = Math.ceil(W + pad * 2); c.height = Math.ceil(H + pad * 2);
  const g = c.getContext('2d'); g.translate(pad, pad);
  g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 24; g.shadowOffsetX = 9; g.shadowOffsetY = 13; g.fillStyle = '#fbfaf4'; g.fillRect(0, 0, W, H); g.restore();
  const m = W * 0.07; const L = W - 2 * m;
  if (retrato) desenharRetrato(g, m, m, L, L, retrato); else { g.fillStyle = '#2a2a2a'; g.fillRect(m, m, L, L); }
  g.save(); g.beginPath(); g.rect(m, m, L, L); g.clip(); g.globalAlpha = 0.12; g.fillStyle = '#000';
  const passoR = L / 46;
  for (let yy = m, lin = 0; yy < m + L; yy += passoR, lin++) for (let xx = m + (lin % 2) * (passoR / 2); xx < m + L; xx += passoR) { g.beginPath(); g.arc(xx, yy, passoR * 0.3, 0, Math.PI * 2); g.fill(); }
  g.restore();
  if (texto) { g.fillStyle = '#1b1b1b'; g.font = `900 ${Math.round(W * 0.13)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(texto), W / 2, m + L + (H - m - L) / 2); }
  const rnd = mulberry32(semente);
  g.save(); g.translate(W / 2, 0); g.rotate(-0.08 + (rnd() - 0.5) * 0.06); g.fillStyle = 'rgba(236,224,190,0.85)'; g.fillRect(-W * 0.2, -W * 0.05, W * 0.4, W * 0.1); g.restore();
  return { canvas: c, W: c.width, H: c.height, ox: pad + W / 2, oy: pad + H / 2 };
}

export function criarColagem(canvas, spec, { largura = 1080, altura = 1920, semente = 7 } = {}) {
  const g = canvas.getContext('2d');
  const grao = gerarGrao(540, 960, semente);
  const icones = window.REEL?.icones || {};
  const ini = spec.inicio ?? 0; const fim = spec.fim ?? ini + 5;
  const dur = Math.max(1, fim - ini);
  const elems = (spec.elementos || []).map((e, i) => ({ ...e, i, ordem: e.ordem ?? i + 1 }))
    .sort((a, b) => a.ordem - b.ordem);
  const n = elems.length || 1;
  // tempo de uma palavra (ou `em`) em segundos desde o início da colagem; null se não houver
  const falasSpec = (spec.falas || []).map((id) => (window.REEL?.falas || []).find((f) => f.id === id)).filter(Boolean);
  function tempoDe(o) {
    if (!o) return null;
    if (typeof o.em === 'number') return o.em;
    if (o.gatilho) {
      const alvo = normal(o.gatilho);
      for (const f of falasSpec) { const w = (f.palavras || []).find((p) => normal(p.texto).includes(alvo)); if (w) return w.inicio - ini; }
    }
    return null;
  }
  const prontos = elems.map((e) => {
    const tam = (e.escala ?? 0.4) * largura;
    let rec = null;
    if (e.forma === 'farol') rec = desenharFarol({ tamanho: tam, cor: e.cor, semente: semente + e.i });
    else if (e.forma === 'facho') rec = desenharFacho({ comprimento: (e.comprimento ?? 0.5) * largura, abertura: e.abertura, cor: e.cor });
    else if (e.forma === 'polaroid') rec = desenharPolaroid({ tamanho: tam, texto: e.texto, retrato: e.retrato, semente: semente + e.i });
    else { const ic = icones[e.icone]; if (!ic) return null; rec = desenharRecorte(ic, { tamanho: tam, estilo: e.estilo || 'halftone', cor: e.cor, semente: semente + e.i }); }
    return { ...e, rec, tEntra: tempoDe(e), tVai: e.vai ? tempoDe(e.vai) : null };
  });
  const atual = {}; // posição desenhada de cada elemento (índice original), para o facho seguir o farol

  function posicaoEntrada(e, p) {
    const fx = (e.x ?? 0.5) * largura; const fy = (e.y ?? 0.5) * altura;
    const fora = { esquerda: [-0.7 * largura, 0], direita: [0.7 * largura, 0], cima: [0, -0.6 * altura], baixo: [0, 0.6 * altura] }[e.entra || 'baixo'] || [0, 0.6 * altura];
    if (e.entra === 'cresce') return { x: fx, y: fy, s: ease.back(p, 2.4) };
    if (e.entra === 'acende') return { x: fx, y: fy, s: 1, a: ease.o(p) };
    const q = ease.back(p, 1.4);
    return { x: fx + fora[0] * (1 - q), y: fy + fora[1] * (1 - q), s: 1 };
  }

  return {
    desenhar(tGlobal) {
      const t = passo(tGlobal - ini, 12);
      g.fillStyle = spec.fundo || '#e8a33d'; g.fillRect(0, 0, largura, altura);
      g.save(); g.globalAlpha = 0.16; g.globalCompositeOperation = 'multiply'; g.drawImage(grao, 0, 0, largura, altura); g.restore();
      const montagem = dur * 0.58;
      prontos.forEach((e, k) => {
        if (!e) return;
        const t0 = e.tEntra != null ? e.tEntra : (montagem * k) / n;
        const t1 = t0 + (e.tEntra != null ? (e.dur ?? 0.45) : Math.min(0.55, montagem / n + 0.15));
        if (t < t0) return;
        let p = seg(t, t0, t1);
        // "sair": no fim do trecho os recortes saem em ordem inversa e o campo fica vazio de novo (fecha o loop)
        if (spec.sair) {
          const s0 = dur - 0.75 + ((n - 1 - k) * 0.5) / n; const s1 = s0 + 0.3;
          if (t >= s1) return;
          if (t >= s0) p = 1 - seg(t, s0, s1);
        }
        let { x, y, s, a: alfa = 1 } = posicaoEntrada(e, p);
        // anda até `vai` (bonequinhos indo para um ponto), com passinhos
        if (e.vai && e.tVai != null) {
          const dv = e.vai.dur ?? 0.9; const k2 = seg(t, e.tVai, e.tVai + dv); const pv = ease.io(k2);
          x += ((e.vai.x ?? e.x ?? 0.5) - (e.x ?? 0.5)) * largura * pv;
          y += ((e.vai.y ?? e.y ?? 0.5) - (e.y ?? 0.5)) * altura * pv;
          if (k2 > 0 && k2 < 1 && e.vai.pula !== false) y -= Math.abs(Math.sin(k2 * Math.PI * (e.vai.passos ?? 4))) * altura * 0.008;
        }
        // facho preso à lanterna do farol de origem
        if (e.forma === 'facho' && e.origem != null && atual[e.origem]) {
          const o = atual[e.origem]; x = o.x + (o.lanterna?.dx ?? 0); y = o.y + (o.lanterna?.dy ?? 0);
        }
        if (e.forma === 'facho') alfa *= 0.86 + 0.14 * Math.sin(t * 9 + k);
        atual[e.i] = { x, y, lanterna: e.rec.lanterna };
        let rot = ((e.rot ?? 0) * Math.PI) / 180;
        // "ferver" do stop-motion: micro-variação a cada 1/6 s
        const tick = Math.floor(t * 6);
        const r2 = mulberry32(tick * 31 + k * 7 + semente);
        rot += (r2() - 0.5) * 0.02; x += (r2() - 0.5) * 2; y += (r2() - 0.5) * 2;
        if (p >= 1 && spec.acao && spec.acao.elemento === e.i) {
          const ta = t - t1;
          if (spec.acao.tipo === 'gira') rot += ta * 0.6;
          if (spec.acao.tipo === 'pulsa') s *= 1 + 0.05 * Math.sin(ta * 6);
          if (spec.acao.tipo === 'treme') x += Math.sin(ta * 40) * 5;
          if (spec.acao.tipo === 'balanca') rot += Math.sin(ta * 3) * 0.12;
        }
        g.save(); g.globalAlpha = clamp(alfa); g.translate(x, y); g.rotate(rot); g.scale(s, s);
        g.drawImage(e.rec.canvas, -e.rec.ox, -e.rec.oy);
        g.restore();
      });
    },
  };
}
