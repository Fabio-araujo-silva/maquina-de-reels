// kit/cenarios.js — cenários e objetos do MUNDO REAL, para o vídeo não ficar genérico.
// Um plano bom mostra ONDE (cenário), O QUÊ (objeto-herói que só existe neste tema) e um TEXTO REAL dentro da cena
// (nome, número, manchete, placa). Tudo aqui devolve THREE.Group em metros, chão em y=0, frente para +Z.
// Textos e telas são canvas: passe os nomes e números REAIS do roteiro (nunca "Lorem", "Nome", "123").
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { caixa, cilindro, esfera, mat, sombrear, telaCanvas, mesa, cadeira, tubo, bandeira } from './formas.js';
import { criarPersonagem, criarCapacete, placaNumero } from './personagem.js';
import { mulberry32, clamp } from './nucleo.js';

const pal = () => window.REEL?.paleta || {};
// meia-abertura HORIZONTAL do vídeo vertical para um fov vertical (graus): é a largura que costuma cortar as coisas
const meiaH = (fov) => Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (9 / 16));
const distPara = (largura, fov = 34, folga = 1.15) => ((largura * folga) / 2) / Math.tan(meiaH(fov));

// Enquadramento pronto de uma peça, em coordenadas do MUNDO (considera posição, rotação e escala da peça):
//   cam = planos([{ ini, fim, de: enquadrar(urna, 'geral'), para: enquadrar(urna, 'tela') }])
// Cada peça lista os nomes em userData.enquadramentos (todas têm 'geral').
export function enquadrar(obj, nome = 'geral') {
  const e = obj.userData.enquadramentos?.[nome] || obj.userData.enquadramentos?.geral;
  if (!e) throw new Error(`"${obj.name}" não tem enquadramento "${nome}"`);
  obj.updateMatrixWorld(true);
  const pos = obj.localToWorld(new THREE.Vector3(...e.pos));
  const alvo = obj.localToWorld(new THREE.Vector3(...e.alvo));
  return { pos: pos.toArray(), alvo: alvo.toArray(), fov: e.fov };
}
const FONTE = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
const SERIFA = 'Georgia, "Times New Roman", serif';
const novo = (nome) => { const g = new THREE.Group(); g.name = nome; return g; };
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : String(n ?? ''));
const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// ---------------- desenho em canvas ----------------
export function escrever(g, texto, x, y, { tam = 40, peso = 700, cor = '#111', fonte = FONTE, alinhar = 'left', base = 'alphabetic', larguraMax = null, minimo = 10 } = {}) {
  g.fillStyle = cor; g.textAlign = alinhar; g.textBaseline = base;
  let px = tam; g.font = `${peso} ${px}px ${fonte}`;
  if (larguraMax) while (px > minimo && g.measureText(String(texto)).width > larguraMax) { px -= 1; g.font = `${peso} ${px}px ${fonte}`; }
  g.fillText(String(texto), x, y);
  return px;
}
export function paragrafo(g, texto, x, y, larguraMax, { tam = 34, peso = 600, cor = '#111', fonte = FONTE, entrelinha = 1.2, maxLinhas = 3, alinhar = 'left' } = {}) {
  g.font = `${peso} ${tam}px ${fonte}`; g.fillStyle = cor; g.textAlign = alinhar; g.textBaseline = 'alphabetic';
  const linhas = []; let atual = '';
  for (const p of String(texto || '').split(/\s+/).filter(Boolean)) {
    const t = atual ? `${atual} ${p}` : p;
    if (g.measureText(t).width > larguraMax && atual) { linhas.push(atual); atual = p; } else atual = t;
  }
  if (atual) linhas.push(atual);
  const usadas = linhas.slice(0, maxLinhas);
  if (linhas.length > maxLinhas) usadas[maxLinhas - 1] = `${usadas[maxLinhas - 1].replace(/\s+\S*$/, '')}…`;
  usadas.forEach((l, i) => g.fillText(l, x, y + i * tam * entrelinha));
  return y + usadas.length * tam * entrelinha;
}
function ret(g, x, y, w, h, r, cor) { g.fillStyle = cor; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function gradiente(g, x, y, w, h, cores) {
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  cores.forEach((c, i) => gr.addColorStop(i / Math.max(1, cores.length - 1), c));
  return gr;
}

// ---------------- prédios ----------------
const cacheFachada = new Map();
function texturaFachada({ cor = '#ece6da', vidro = '#8fa7bd', acesas = 0.12, colunas = 4, andares = 8, terreo = null, semente = 1, faixas = false }) {
  const chave = JSON.stringify({ cor, vidro, acesas, colunas, andares, terreo, semente, faixas });
  if (cacheFachada.has(chave)) return cacheFachada.get(chave);
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d'); const rnd = mulberry32(semente);
  g.fillStyle = cor; g.fillRect(0, 0, 256, 512);
  if (faixas) {
    // torre de vidro: faixas horizontais escuras (andares) e montantes finos
    for (let j = 0; j < andares; j++) { g.fillStyle = vidro; g.fillRect(0, (j * 512) / andares + 6, 256, 512 / andares - 14); }
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 1; i < colunas; i++) g.fillRect((i * 256) / colunas - 1, 0, 2, 512);
  } else {
    const mx = 256 / colunas; const my = 512 / andares;
    for (let i = 0; i < colunas; i++) for (let j = 0; j < andares; j++) {
      if (terreo && j === andares - 1) continue;
      g.fillStyle = rnd() < acesas ? '#ffe3a1' : vidro;
      g.fillRect(i * mx + mx * 0.2, j * my + my * 0.2, mx * 0.6, my * 0.52);
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(i * mx + mx * 0.16, j * my + my * 0.72, mx * 0.68, my * 0.06);
    }
    if (terreo) {
      const y0 = 512 - 512 / andares;
      g.fillStyle = terreo; g.fillRect(0, y0, 256, 26);
      g.fillStyle = '#a9c4d8'; g.fillRect(14, y0 + 34, 228, 512 / andares - 44);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(14, y0 + 34, 228, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cacheFachada.set(chave, tex);
  return tex;
}
function blocoComFachada(l, a, p, opts = {}) {
  const tex = texturaFachada(opts).clone(); tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, Math.round(l / 2.4)), Math.max(1, Math.round(a / 3.2)));
  const lado = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  const topo = mat.fosco(opts.teto || '#cfc8bb');
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, a, p), [lado, lado, topo, topo, lado, lado]);
  m.position.y = a / 2;
  return sombrear(m);
}

// Prédios reconhecíveis. tipo: 'congresso' (Brasília) | 'classico' (tribunal, banco, museu, universidade) | 'casa' | 'torre' |
// 'fabrica' | 'hospital' | 'escola' | 'igreja' | 'residencial'. opts.nome escreve a placa (ex.: "SUPREMO TRIBUNAL FEDERAL").
export function predio(tipo = 'residencial', { nome = null, cor = null, altura = null, semente = 1 } = {}) {
  const P = pal(); const g = novo(`predio-${tipo}`); const branco = '#f3f1ec';
  if (tipo === 'congresso') {
    const concreto = mat.fosco(cor || branco);
    const plat = caixa(10, 0.55, 3.6, { raio: 0.04, material: concreto }); plat.position.y = 0.275; g.add(plat);
    const vidro = texturaFachada({ cor: '#e9e6df', vidro: '#7f97ad', andares: 28, colunas: 1, faixas: true });
    for (const sx of [-1, 1]) {
      const tx = vidro.clone(); tx.needsUpdate = true;
      const mt = new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 });
      const torre = new THREE.Mesh(new THREE.BoxGeometry(0.85, altura || 7.2, 2.5), [mt, mt, concreto, concreto, mt, mt]);
      torre.position.set(sx * 0.52, (altura || 7.2) / 2, -1.9); g.add(sombrear(torre));
    }
    const ponte = caixa(0.32, 0.55, 2.3, { raio: 0.02, material: mat.plastico('#6f8599') }); ponte.position.set(0, (altura || 7.2) * 0.52, -1.9); g.add(ponte);
    // Senado: cúpula convexa | Câmara: cuia aberta para cima
    const cupula = new THREE.Mesh(new THREE.SphereGeometry(1.0, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), concreto);
    cupula.scale.set(1, 0.62, 1); cupula.position.set(-2.7, 0.55, 0.2); g.add(sombrear(cupula));
    const cuia = new THREE.Mesh(new THREE.SphereGeometry(1.6, 56, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI * 0.36), new THREE.MeshStandardMaterial({ color: cor || branco, roughness: 0.85, side: THREE.DoubleSide }));
    cuia.scale.set(1, 0.55, 1); cuia.position.set(2.7, 0.55 + 1.6 * 0.55 * Math.cos(Math.PI * 0.14), 0.2); g.add(sombrear(cuia));
    const pe = cilindro(0.35, 0.3, { material: concreto }); pe.position.set(2.7, 0.7, 0.2); g.add(pe);
    const rampa = caixa(1.1, 0.06, 2.4, { raio: 0.01, material: concreto }); rampa.position.set(0, 0.3, 2.6); rampa.rotation.x = 0.22; g.add(rampa);
    const espelho = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), new THREE.MeshStandardMaterial({ color: '#4f8fb5', roughness: 0.15, metalness: 0.2 }));
    espelho.rotation.x = -Math.PI / 2; espelho.position.set(0, 0.01, 5); espelho.receiveShadow = true; g.add(espelho);
    g.userData.ancoras = { senado: [-2.7, 1.3, 0.2], camara: [2.7, 1.5, 0.2], torres: [0, (altura || 7.2) + 0.2, -1.9] };
    g.userData.enquadramentos = { geral: { pos: [0, 2.4, 27], alvo: [0, 2.8, 0], fov: 36 }, torres: { pos: [0.6, 1.5, 11], alvo: [0, 4.8, -1.9], fov: 42 }, cupulas: { pos: [0, 3.8, 10], alvo: [0, 1.0, 0.2], fov: 40 } };
  } else if (tipo === 'classico') {
    const pedra = mat.fosco(cor || '#ece4d4');
    for (let i = 0; i < 3; i++) { const d = caixa(6 - i * 0.3, 0.15, 3.4 - i * 0.3, { raio: 0.01, material: pedra }); d.position.y = 0.075 + i * 0.15; g.add(d); }
    const corpo = caixa(5, 2.6, 2.2, { raio: 0.02, material: pedra }); corpo.position.set(0, 0.45 + 1.3, -0.4); g.add(corpo);
    for (let i = 0; i < 6; i++) { const c = cilindro(0.15, 2.4, { material: mat.fosco('#f5f0e6') }); c.position.set(-2.1 + i * 0.84, 0.45 + 1.2, 1.05); g.add(c); }
    const arquitrave = caixa(5.3, 0.38, 2.9, { raio: 0.02, material: pedra }); arquitrave.position.set(0, 0.45 + 2.6, -0.05); g.add(arquitrave);
    const tri = new THREE.Shape(); tri.moveTo(-2.7, 0); tri.lineTo(2.7, 0); tri.lineTo(0, 0.95); tri.closePath();
    const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 2.9, bevelEnabled: false }), pedra);
    fr.position.set(0, 0.45 + 2.79, -1.5); g.add(sombrear(fr));
    if (nome) { const p = telaCanvas(4.6, 0.26, (c, w, h) => escrever(c, nome.toUpperCase(), w / 2, h * 0.72, { tam: h * 0.62, peso: 700, cor: '#5a4a32', fonte: SERIFA, alinhar: 'center', larguraMax: w * 0.96 }), { fundo: '#ece4d4', emissivo: 0.12, pxPorUnidade: 400 }); p.position.set(0, 0.45 + 2.6, 1.41); g.add(p); }
  } else if (tipo === 'casa') {
    const parede = caixa(2.4, 1.8, 2.2, { raio: 0.02, cor: cor || '#f1d7b0' }); parede.position.y = 0.9; g.add(parede);
    const tri = new THREE.Shape(); tri.moveTo(-1.4, 0); tri.lineTo(1.4, 0); tri.lineTo(0, 1.1); tri.closePath();
    const telhado = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 2.5, bevelEnabled: false }), mat.fosco(P.telhado || '#c0573a'));
    telhado.position.set(0, 1.8, -1.25); g.add(sombrear(telhado));
    const porta = caixa(0.5, 0.95, 0.05, { raio: 0.01, material: mat.madeira(P.madeira) }); porta.position.set(-0.45, 0.48, 1.11); g.add(porta);
    for (const x of [0.45]) { const j = caixa(0.6, 0.5, 0.04, { raio: 0.01, cor: '#9fbcd1' }); j.position.set(x, 1.05, 1.11); g.add(j); }
    const chamine = caixa(0.3, 0.8, 0.3, { raio: 0.01, cor: '#b9a48a' }); chamine.position.set(0.7, 2.4, -0.4); g.add(chamine);
  } else if (tipo === 'torre') {
    const a = altura || 12;
    g.add(blocoComFachada(2.6, a, 2.6, { cor: '#dfe6ec', vidro: '#6b8eae', andares: 10, colunas: 3, faixas: true, teto: '#9aa7b3' }));
    const antena = cilindro(0.04, 1.6, { material: mat.metal('#c7cdd3') }); antena.position.y = a + 0.8; g.add(antena);
  } else if (tipo === 'fabrica') {
    const corpo = caixa(5, 2.2, 3, { raio: 0.02, cor: cor || '#d9cfc2' }); corpo.position.y = 1.1; g.add(corpo);
    for (let i = 0; i < 4; i++) {
      const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(1.25, 0); tri.lineTo(1.25, 0.7); tri.closePath();
      const dente = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 3, bevelEnabled: false }), mat.fosco('#a9b4bd'));
      dente.position.set(-2.5 + i * 1.25, 2.2, -1.5); g.add(sombrear(dente));
    }
    const chamine = cilindro(0.28, 4.2, { rTopo: 0.22, cor: '#b65a3e' }); chamine.position.set(1.9, 2.1, -0.8); g.add(chamine);
    for (let i = 0; i < 3; i++) { const f = esfera(0.35 + i * 0.12, { material: mat.fosco('#e8e8e6', { transparent: true, opacity: 0.85 }) }); f.position.set(1.9 + i * 0.35, 4.6 + i * 0.5, -0.8); f.castShadow = false; g.add(f); }
  } else if (tipo === 'hospital') {
    g.add(blocoComFachada(5, 3.6, 2.6, { cor: '#f4f6f7', vidro: '#9cc3d6', andares: 4, colunas: 6, teto: '#d5dbe0' }));
    const cruz = novo('cruz');
    const v = caixa(0.32, 1.0, 0.08, { raio: 0.02, material: mat.emissivo('#e23b3b', 0.6) }); cruz.add(v);
    const h = caixa(1.0, 0.32, 0.08, { raio: 0.02, material: mat.emissivo('#e23b3b', 0.6) }); cruz.add(h);
    cruz.position.set(0, 4.3, 0.6); g.add(cruz);
    const placa = telaCanvas(2.6, 0.42, (c, w, hh) => escrever(c, (nome || 'HOSPITAL').toUpperCase(), w / 2, hh * 0.72, { tam: hh * 0.6, peso: 800, cor: '#d32f2f', alinhar: 'center', larguraMax: w * 0.94 }), { fundo: '#ffffff', emissivo: 0.3, pxPorUnidade: 380 });
    placa.position.set(0, 3.25, 1.31); g.add(placa);
  } else if (tipo === 'escola') {
    g.add(blocoComFachada(6, 2.6, 2.4, { cor: cor || '#f2e2c4', vidro: '#9db8cc', andares: 2, colunas: 8, teto: '#c9b79a' }));
    const placa = telaCanvas(3.2, 0.36, (c, w, hh) => escrever(c, (nome || 'ESCOLA').toUpperCase(), w / 2, hh * 0.72, { tam: hh * 0.6, peso: 800, cor: '#2f4a6b', alinhar: 'center', larguraMax: w * 0.94 }), { fundo: '#fbf6ec', emissivo: 0.2, pxPorUnidade: 380 });
    placa.position.set(0, 2.85, 1.21); g.add(placa);
  } else if (tipo === 'igreja') {
    const nave = caixa(3, 2.6, 4.5, { raio: 0.02, cor: cor || '#f4efe4' }); nave.position.set(0, 1.3, -0.6); g.add(nave);
    const torre = caixa(1.2, 5, 1.2, { raio: 0.02, cor: cor || '#f4efe4' }); torre.position.set(0, 2.5, 1.9); g.add(torre);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), mat.fosco('#6d8aa6')); cone.rotation.y = Math.PI / 4; cone.position.set(0, 5.8, 1.9); g.add(sombrear(cone));
    const cv = caixa(0.06, 0.5, 0.06, { cor: '#d9b54a' }); cv.position.set(0, 6.85, 1.9); g.add(cv);
    const chz = caixa(0.3, 0.06, 0.06, { cor: '#d9b54a' }); chz.position.set(0, 6.92, 1.9); g.add(chz);
  } else {
    const a = altura || 6 + mulberry32(semente)() * 6;
    g.add(blocoComFachada(3, a, 3, { cor: cor || '#ece6da', semente, acesas: 0.14, andares: 8, colunas: 4, terreo: '#c8553d' }));
  }
  if (!g.userData.enquadramentos) {
    const caixaB = new THREE.Box3().setFromObject(g); const tam = caixaB.getSize(new THREE.Vector3()); const centro = caixaB.getCenter(new THREE.Vector3());
    const d = Math.max(distPara(tam.x, 36), tam.y * 1.6 + 2);
    g.userData.enquadramentos = { geral: { pos: [centro.x, Math.max(1.6, tam.y * 0.35), d], alvo: [centro.x, tam.y * 0.45, 0], fov: 36 } };
  }
  return g;
}

// Bairro em quadras: ruas com faixa, calçadas, prédios variados (com janelas), árvores e postes.
// userData.predios = lista de prédios (para animar "crescer" ou acender janelas).
export function cidade({ quadrasX = 3, quadrasZ = 3, quadra = 8, rua = 3, alturas = [3, 12], semente = 4, arvores = true } = {}) {
  const g = novo('cidade'); const rnd = mulberry32(semente);
  const passo = quadra + rua; const larg = quadrasX * passo + rua; const prof = quadrasZ * passo + rua;
  const asfalto = new THREE.Mesh(new THREE.PlaneGeometry(larg, prof), mat.fosco('#4a4f57'));
  asfalto.rotation.x = -Math.PI / 2; asfalto.receiveShadow = true; g.add(asfalto);
  const faixa = mat.fosco('#e9e4cf');
  for (let i = 0; i <= quadrasX; i++) for (let k = 0; k < prof / 1.6; k++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.8), faixa); f.rotation.x = -Math.PI / 2;
    f.position.set(-larg / 2 + i * passo + rua / 2, 0.006, -prof / 2 + k * 1.6 + 0.8); g.add(f);
  }
  const cores = ['#ece6da', '#f1d9c2', '#dfe5ea', '#e8dcc8', '#f4ecd8', '#d9e2d6'];
  const terreos = ['#c8553d', '#3a6ea5', '#2f8f6b', '#d39b2a', '#7c4dc4'];
  g.userData.predios = [];
  for (let i = 0; i < quadrasX; i++) for (let k = 0; k < quadrasZ; k++) {
    const cx = -larg / 2 + rua + i * passo + quadra / 2; const cz = -prof / 2 + rua + k * passo + quadra / 2;
    const calcada = caixa(quadra, 0.14, quadra, { raio: 0.03, cor: '#cfcac0' }); calcada.position.set(cx, 0.07, cz); g.add(calcada);
    const n = 2; const lado = (quadra - 1.4) / n;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const h = alturas[0] + rnd() * (alturas[1] - alturas[0]);
      const p = blocoComFachada(lado - 0.5, h, lado - 0.5, { cor: cores[Math.floor(rnd() * cores.length)], semente: Math.floor(rnd() * 999), acesas: 0.1 + rnd() * 0.15, andares: Math.max(2, Math.round(h / 1.4)), colunas: 3 + Math.floor(rnd() * 3), terreo: rnd() < 0.5 ? terreos[Math.floor(rnd() * terreos.length)] : null, teto: '#bdb6a8' });
      p.position.set(cx - quadra / 2 + 0.7 + lado * (a + 0.5), h / 2 + 0.14, cz - quadra / 2 + 0.7 + lado * (b + 0.5));
      p.userData.altura = h; g.add(p); g.userData.predios.push(p);
    }
    if (arvores) for (let s = 0; s < 4; s++) {
      const arv = novo('arvore');
      const tronco = cilindro(0.08, 0.9, { cor: '#7a5537' }); tronco.position.y = 0.45; arv.add(tronco);
      const copa = esfera(0.55 + rnd() * 0.2, { material: mat.fosco(rnd() < 0.5 ? '#5f9e5a' : '#4f8a4f') }); copa.position.y = 1.25; arv.add(copa);
      const ang = (s / 4) * Math.PI * 2 + 0.6;
      arv.position.set(cx + Math.cos(ang) * (quadra / 2 - 0.35), 0.14, cz + Math.sin(ang) * (quadra / 2 - 0.35)); g.add(arv);
    }
  }
  const altMax = alturas[1];
  g.userData.enquadramentos = {
    geral: { pos: [0, altMax * 2.4 + 6, prof * 0.75 + 6], alvo: [0, 0, 0], fov: 40 },
    rua: { pos: [-larg / 2 + rua / 2 + passo, 1.6, prof / 2 - 1], alvo: [-larg / 2 + rua / 2 + passo, 2.5, -prof / 2], fov: 44 },
  };
  return g;
}

// ---------------- política ----------------
// Urna eletrônica brasileira (tela de votação + teclado com BRANCO / CORRIGE / CONFIRMA). Escala real (~42 cm).
// userData.estado({ digitos, fim }) mostra o número sendo digitado (digitos = quantos dígitos já apareceram) ou a tela "FIM".
export function urnaEletronica({ cargo = 'Deputado Federal', numero = '50', nome = '', partido = '', escala = 1 } = {}) {
  const g = novo('urna');
  const corpo = caixa(0.42, 0.1, 0.3, { raio: 0.018, cor: '#d8d2c6' }); corpo.position.y = 0.05; g.add(corpo);
  const face = novo('face'); face.position.set(0, 0.104, 0); face.rotation.x = -Math.PI / 2 + 0.3; g.add(face);
  const moldura = caixa(0.4, 0.27, 0.012, { raio: 0.01, cor: '#c9c2b4' }); face.add(moldura);
  let st = { digitos: String(numero).length, fim: false };
  const tela = telaCanvas(0.205, 0.152, (c, w, h) => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, w, h);
    if (st.fim) { escrever(c, 'FIM', w / 2, h * 0.62, { tam: h * 0.34, peso: 900, cor: '#111', alinhar: 'center' }); return; }
    escrever(c, 'SEU VOTO PARA', w * 0.05, h * 0.12, { tam: h * 0.07, peso: 800, cor: '#000' });
    escrever(c, cargo, w * 0.5, h * 0.25, { tam: h * 0.1, peso: 900, cor: '#000', alinhar: 'center', larguraMax: w * 0.9 });
    escrever(c, 'Número:', w * 0.05, h * 0.42, { tam: h * 0.075, peso: 700, cor: '#000' });
    const dig = String(numero).split('');
    dig.forEach((d, i) => {
      const x = w * 0.3 + i * w * 0.085;
      c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(x, h * 0.33, w * 0.07, h * 0.12);
      if (i < st.digitos) escrever(c, d, x + w * 0.035, h * 0.43, { tam: h * 0.1, peso: 800, cor: '#111', alinhar: 'center' });
    });
    if (st.digitos >= dig.length) {
      escrever(c, `Nome: ${nome}`, w * 0.05, h * 0.57, { tam: h * 0.075, peso: 800, cor: '#000', larguraMax: w * 0.62 });
      escrever(c, `Partido: ${partido}`, w * 0.05, h * 0.68, { tam: h * 0.075, peso: 800, cor: '#000', larguraMax: w * 0.62 });
      ret(c, w * 0.72, h * 0.3, w * 0.22, h * 0.4, 6, '#d9dde2');
      c.fillStyle = '#9aa3ad'; c.beginPath(); c.arc(w * 0.83, h * 0.43, h * 0.06, 0, Math.PI * 2); c.fill(); ret(c, w * 0.765, h * 0.51, w * 0.13, h * 0.17, 12, '#9aa3ad');
    }
    c.fillStyle = '#333'; c.fillRect(w * 0.03, h * 0.8, w * 0.94, 2);
    escrever(c, 'Aperte a tecla: VERDE para CONFIRMAR este voto', w * 0.05, h * 0.88, { tam: h * 0.05, peso: 600, cor: '#222', larguraMax: w * 0.9 });
    escrever(c, 'LARANJA para REINICIAR este voto', w * 0.05, h * 0.95, { tam: h * 0.05, peso: 600, cor: '#222', larguraMax: w * 0.9 });
  }, { fundo: '#fbfbf8', emissivo: 0.22, pxPorUnidade: 4000 });
  tela.position.set(-0.075, 0.012, 0.0075); face.add(tela);
  const teclado = telaCanvas(0.135, 0.2, (c, w, h) => {
    c.fillStyle = '#c9c2b4'; c.fillRect(0, 0, w, h);
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''];
    teclas.forEach((t, i) => {
      if (!t) return;
      const x = (i % 3) * w * 0.31 + w * 0.06; const y = Math.floor(i / 3) * h * 0.15 + h * 0.04;
      ret(c, x, y, w * 0.26, h * 0.12, 8, '#1d1f24');
      escrever(c, t, x + w * 0.13, y + h * 0.09, { tam: h * 0.08, peso: 700, cor: '#fff', alinhar: 'center' });
    });
    [['BRANCO', '#f7f7f5', '#111'], ['CORRIGE', '#f08a24', '#111'], ['CONFIRMA', '#2fae4e', '#111']].forEach(([t, cor, ct], i) => {
      const x = w * 0.03 + i * w * 0.32; const y = h * 0.66;
      ret(c, x, y, w * 0.3, h * 0.14, 8, cor);
      escrever(c, t, x + w * 0.15, y + h * 0.09, { tam: h * 0.045, peso: 800, cor: ct, alinhar: 'center', larguraMax: w * 0.27 });
    });
    escrever(c, 'JUSTIÇA ELEITORAL', w / 2, h * 0.97, { tam: h * 0.04, peso: 800, cor: '#4a4a4a', alinhar: 'center' });
  }, { fundo: '#c9c2b4', emissivo: 0.12, pxPorUnidade: 3000 });
  teclado.position.set(0.12, 0.0, 0.0075); face.add(teclado);
  g.userData.tela = tela;
  g.userData.enquadramentos = { geral: { pos: [0.03, 0.46, 0.62], alvo: [0, 0.13, 0], fov: 34 }, tela: { pos: [-0.09, 0.45, 0.46], alvo: [-0.09, 0.13, 0.02], fov: 30 }, teclado: { pos: [0.13, 0.38, 0.3], alvo: [0.12, 0.12, 0.0], fov: 30 } };
  g.userData.estado = ({ digitos = null, fim = false } = {}) => {
    st = { digitos: digitos ?? String(numero).length, fim };
    tela.userData.atualizar(0, JSON.stringify(st));
  };
  g.scale.setScalar(escala);
  return g;
}

// Placar de resultados (eleição, ranking, pesquisa): linhas { nome, valor, cor }. userData.revelar(x 0..1) cresce as barras.
export function placar({ titulo = '', linhas = [], largura = 1.8, altura = 2.2, pernas = true, sufixo = '', porcentagem = false } = {}) {
  const g = novo('placar');
  const moldura = caixa(largura + 0.12, altura + 0.12, 0.08, { raio: 0.03, cor: '#1a1d23' }); moldura.position.y = altura / 2 + (pernas ? 0.9 : 0); g.add(moldura);
  if (pernas) for (const sx of [-1, 1]) { const p = cilindro(0.04, 0.95, { material: mat.metal('#4a4f57') }); p.position.set(sx * largura * 0.35, 0.47, -0.02); g.add(p); }
  const max = Math.max(1, ...linhas.map((l) => Number(l.valor) || 0));
  let x = 1;
  const tela = telaCanvas(largura, altura, (c, w, h) => {
    c.fillStyle = '#0d1016'; c.fillRect(0, 0, w, h);
    escrever(c, titulo, w * 0.05, h * 0.14, { tam: h * 0.085, peso: 800, cor: '#ffffff', larguraMax: w * 0.9 });
    const n = Math.max(1, linhas.length); const lh = (h * 0.78) / n;
    linhas.forEach((l, i) => {
      const y = h * 0.2 + i * lh;
      escrever(c, l.nome, w * 0.05, y + lh * 0.38, { tam: Math.min(lh * 0.3, h * 0.06), peso: 700, cor: '#e8ecf2', larguraMax: w * 0.9 });
      const bw = (w * 0.5) * ((Number(l.valor) || 0) / max) * clamp(x);
      ret(c, w * 0.05, y + lh * 0.52, Math.max(4, bw), lh * 0.26, 6, l.cor || '#4f8cff');
      const valor = porcentagem ? `${(Number(l.valor) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : `${fmt(Math.round((Number(l.valor) || 0) * clamp(x)))}${sufixo}`;
      escrever(c, valor, w * 0.95, y + lh * 0.72, { tam: Math.min(lh * 0.4, h * 0.08), peso: 800, cor: '#ffffff', alinhar: 'right' });
    });
  }, { fundo: '#0d1016', emissivo: 0.95, pxPorUnidade: 420 });
  tela.position.set(0, altura / 2 + (pernas ? 0.9 : 0), 0.045); g.add(tela);
  g.userData.tela = tela;
  g.userData.revelar = (v) => { x = clamp(v); tela.userData.atualizar(0, Math.round(x * 200)); };
  const cy = altura / 2 + (pernas ? 0.9 : 0);
  g.userData.enquadramentos = { geral: { pos: [0, cy, distPara(largura + 0.2, 34)], alvo: [0, cy, 0], fov: 34 }, detalhe: { pos: [-largura * 0.15, cy, distPara(largura * 0.6, 34)], alvo: [-largura * 0.15, cy, 0], fov: 34 } };
  return g;
}

// Gráfico de barras 3D com rótulos e valores (números REAIS). userData.crescer(x 0..1).
export function grafico3d({ valores = [], rotulos = [], cores = null, alturaMax = 2.2, largura = 0.5, espaco = 0.3, formatar = fmt } = {}) {
  const g = novo('grafico3d'); const P = pal();
  const paleta = cores || [P.primaria || '#ff7a1a', P.secundaria || '#22c55e', '#4f8cff', '#e5484d', '#a855f7', '#f5c518'];
  const n = valores.length; const total = n * largura + (n - 1) * espaco;
  const base = caixa(total + 0.5, 0.06, largura + 0.7, { raio: 0.02, cor: '#ece8e1' }); base.position.y = 0.03; g.add(base);
  const max = Math.max(1e-9, ...valores.map(Number));
  const barras = valores.map((v, i) => {
    const geo = new RoundedBoxGeometry(largura, 1, largura, 3, 0.04); geo.translate(0, 0.5, 0);
    const b = sombrear(new THREE.Mesh(geo, mat.plastico(paleta[i % paleta.length])));
    b.position.set(-total / 2 + largura / 2 + i * (largura + espaco), 0.06, 0); g.add(b);
    const alvo = Math.max(0.02, (Number(v) / max) * alturaMax);
    const etiqueta = telaCanvas(largura * 1.6, 0.22, (c, w, h) => escrever(c, formatar(v), w / 2, h * 0.75, { tam: h * 0.7, peso: 800, cor: '#1d2026', alinhar: 'center', larguraMax: w * 0.96 }), { fundo: '#ffffff', emissivo: 0.3, pxPorUnidade: 600 });
    etiqueta.material.transparent = true; g.add(etiqueta);
    if (rotulos[i]) {
      const r = telaCanvas(largura * 1.7, 0.2, (c, w, h) => escrever(c, rotulos[i], w / 2, h * 0.74, { tam: h * 0.62, peso: 700, cor: '#3a3f48', alinhar: 'center', larguraMax: w * 0.96 }), { fundo: '#ece8e1', emissivo: 0.15, pxPorUnidade: 600 });
      r.position.set(b.position.x, 0.17, largura / 2 + 0.36); g.add(r);
    }
    return { b, alvo, etiqueta };
  });
  g.userData.crescer = (x) => {
    const p = clamp(x);
    for (const { b, alvo, etiqueta } of barras) {
      b.scale.y = Math.max(0.001, alvo * p);
      etiqueta.position.set(b.position.x, 0.06 + alvo * p + 0.18, 0);
      etiqueta.visible = p > 0.02;
    }
  };
  g.userData.crescer(1);
  g.userData.enquadramentos = { geral: { pos: [0, alturaMax * 0.55, Math.max(distPara(total + 0.8, 34), alturaMax * 1.9)], alvo: [0, alturaMax * 0.5, 0], fov: 34 } };
  return g;
}

// ---------------- mídia ----------------
// Celular com a tela REAL de um app (não um botão de play genérico).
// app: 'youtube' | 'instagram' | 'whatsapp' | 'tiktok' | 'noticia' | 'banco'.
// dados: { nome, usuario, inscritos|seguidores, videos, titulos[], posts, bio, mensagens:[{de:'eu'|'outro', texto, hora}], legenda, curtidas, site, manchete, subtitulo, saldo, transacoes:[{texto, valor}] , cor }
export function celular({ app = 'youtube', dados = {}, escala = 1, corCorpo = '#16181d', brilho = 0.5 } = {}) {
  const g = novo(`celular-${app}`);
  const corpo = caixa(0.078, 0.162, 0.009, { raio: 0.011, cor: corCorpo }); corpo.position.y = 0.081; g.add(corpo);
  const d = dados; const destaque = d.cor || '#ff0033';
  const tela = telaCanvas(0.0715, 0.155, (c, w, h) => {
    const s = w / 720; // escala de desenho (layout pensado para 720 px de largura)
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    const barraStatus = (cor = '#111') => { escrever(c, '9:41', 40 * s, 48 * s, { tam: 30 * s, peso: 700, cor }); ret(c, w - 110 * s, 26 * s, 64 * s, 26 * s, 6 * s, cor); };
    if (app === 'youtube') {
      barraStatus();
      ret(c, 36 * s, 86 * s, 70 * s, 50 * s, 14 * s, '#ff0033');
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(62 * s, 98 * s); c.lineTo(62 * s, 124 * s); c.lineTo(86 * s, 111 * s); c.closePath(); c.fill();
      escrever(c, 'YouTube', 118 * s, 126 * s, { tam: 40 * s, peso: 800, cor: '#111' });
      c.fillStyle = gradiente(c, 0, 160 * s, w, 220 * s, [d.cor || '#3a3f8f', '#c2410c']); c.fillRect(0, 160 * s, w, 220 * s);
      if (d.nome) escrever(c, d.nome.toUpperCase(), w / 2, 290 * s, { tam: 54 * s, peso: 900, cor: 'rgba(255,255,255,0.9)', alinhar: 'center', larguraMax: w * 0.85 });
      c.fillStyle = d.corAvatar || '#c0392b'; c.beginPath(); c.arc(100 * s, 470 * s, 64 * s, 0, Math.PI * 2); c.fill();
      escrever(c, iniciais(d.nome), 100 * s, 492 * s, { tam: 56 * s, peso: 800, cor: '#fff', alinhar: 'center' });
      escrever(c, d.nome || 'Canal', 190 * s, 460 * s, { tam: 44 * s, peso: 800, cor: '#0f0f0f', larguraMax: w - 220 * s });
      escrever(c, `@${d.usuario || 'canal'} · ${fmt(d.inscritos ?? '')} inscritos`, 190 * s, 510 * s, { tam: 27 * s, peso: 500, cor: '#606060', larguraMax: w - 220 * s });
      escrever(c, `${fmt(d.videos ?? '')} vídeos`, 190 * s, 548 * s, { tam: 27 * s, peso: 500, cor: '#606060' });
      ret(c, 36 * s, 590 * s, w - 72 * s, 74 * s, 37 * s, '#0f0f0f');
      escrever(c, d.inscrito ? 'Inscrito' : 'Inscrever-se', w / 2, 638 * s, { tam: 32 * s, peso: 700, cor: '#fff', alinhar: 'center' });
      ['Início', 'Vídeos', 'Shorts', 'Ao vivo'].forEach((t, i) => escrever(c, t, (60 + i * 165) * s, 730 * s, { tam: 28 * s, peso: i === 1 ? 800 : 600, cor: i === 1 ? '#0f0f0f' : '#606060' }));
      c.fillStyle = '#0f0f0f'; c.fillRect(205 * s, 745 * s, 110 * s, 5 * s);
      (d.titulos || ['', '', '']).slice(0, 3).forEach((t, i) => {
        const y = (780 + i * 250) * s;
        c.fillStyle = gradiente(c, 36 * s, y, 300 * s, 200 * s, [['#2d3748', '#7c2d12'], ['#1e3a8a', '#0f766e'], ['#581c87', '#b91c1c']][i % 3]); ret(c, 36 * s, y, 300 * s, 200 * s, 16 * s, c.fillStyle);
        ret(c, 262 * s, y + 158 * s, 66 * s, 32 * s, 6 * s, 'rgba(0,0,0,0.8)'); escrever(c, ['12:47', '8:03', '21:15'][i], 295 * s, y + 182 * s, { tam: 22 * s, peso: 700, cor: '#fff', alinhar: 'center' });
        paragrafo(c, t || ' ', 360 * s, y + 40 * s, w - 400 * s, { tam: 30 * s, peso: 700, cor: '#0f0f0f', maxLinhas: 3 });
        escrever(c, d.vistas?.[i] || `${['312 mil', '1,2 mi', '98 mil'][i]} visualizações`, 360 * s, y + 175 * s, { tam: 24 * s, peso: 500, cor: '#606060', larguraMax: w - 400 * s });
      });
    } else if (app === 'instagram') {
      barraStatus();
      escrever(c, d.usuario || 'perfil', 40 * s, 140 * s, { tam: 40 * s, peso: 800, cor: '#111' });
      c.fillStyle = gradiente(c, 40 * s, 190 * s, 170 * s, 170 * s, ['#f58529', '#dd2a7b', '#8134af']); c.beginPath(); c.arc(125 * s, 275 * s, 85 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(125 * s, 275 * s, 76 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = d.corAvatar || '#8b5a3c'; c.beginPath(); c.arc(125 * s, 275 * s, 70 * s, 0, Math.PI * 2); c.fill();
      escrever(c, iniciais(d.nome), 125 * s, 297 * s, { tam: 58 * s, peso: 800, cor: '#fff', alinhar: 'center' });
      [[d.posts ?? '', 'posts'], [d.seguidores ?? '', 'seguidores'], [d.seguindo ?? '', 'seguindo']].forEach(([v, r], i) => {
        escrever(c, fmt(v), (330 + i * 140) * s, 268 * s, { tam: 36 * s, peso: 800, cor: '#111', alinhar: 'center', larguraMax: 130 * s });
        escrever(c, r, (330 + i * 140) * s, 306 * s, { tam: 24 * s, peso: 500, cor: '#333', alinhar: 'center' });
      });
      escrever(c, d.nome || '', 40 * s, 420 * s, { tam: 30 * s, peso: 800, cor: '#111', larguraMax: w - 80 * s });
      paragrafo(c, d.bio || '', 40 * s, 462 * s, w - 80 * s, { tam: 27 * s, peso: 500, cor: '#222', maxLinhas: 3 });
      ret(c, 40 * s, 580 * s, w - 80 * s, 64 * s, 14 * s, '#0095f6'); escrever(c, 'Seguir', w / 2, 622 * s, { tam: 30 * s, peso: 800, cor: '#fff', alinhar: 'center' });
      const cs = [['#fde68a', '#f59e0b'], ['#bfdbfe', '#3b82f6'], ['#fecaca', '#ef4444'], ['#bbf7d0', '#16a34a'], ['#e9d5ff', '#9333ea'], ['#fed7aa', '#ea580c']];
      for (let i = 0; i < 9; i++) { const x = (i % 3) * (w / 3); const y = 680 * s + Math.floor(i / 3) * (w / 3); c.fillStyle = gradiente(c, x, y, w / 3, w / 3, cs[i % cs.length]); c.fillRect(x + 2, y + 2, w / 3 - 4, w / 3 - 4); }
    } else if (app === 'whatsapp') {
      c.fillStyle = '#075e54'; c.fillRect(0, 0, w, 190 * s); barraStatus('#fff');
      c.fillStyle = d.corAvatar || '#94a3b8'; c.beginPath(); c.arc(90 * s, 135 * s, 38 * s, 0, Math.PI * 2); c.fill();
      escrever(c, iniciais(d.nome), 90 * s, 148 * s, { tam: 30 * s, peso: 800, cor: '#fff', alinhar: 'center' });
      escrever(c, d.nome || 'Contato', 148 * s, 130 * s, { tam: 34 * s, peso: 700, cor: '#fff', larguraMax: w - 180 * s });
      escrever(c, 'online', 148 * s, 166 * s, { tam: 24 * s, peso: 500, cor: '#cfe9e5' });
      c.fillStyle = '#ece5dd'; c.fillRect(0, 190 * s, w, h - 190 * s);
      let y = 240 * s;
      for (const msg of (d.mensagens || []).slice(0, 7)) {
        c.font = `600 ${36 * s}px ${FONTE}`;
        const larg = Math.min(w * 0.8, c.measureText(msg.texto).width + 70 * s);
        const linhas = Math.ceil((c.measureText(msg.texto).width + 70 * s) / (w * 0.8));
        const alt = (70 + (linhas - 1) * 44) * s;
        const eu = msg.de === 'eu'; const x = eu ? w - larg - 30 * s : 30 * s;
        ret(c, x, y, larg, alt, 16 * s, eu ? '#dcf8c6' : '#ffffff');
        paragrafo(c, msg.texto, x + 26 * s, y + 48 * s, larg - 52 * s, { tam: 36 * s, peso: 600, cor: '#111', maxLinhas: 4 });
        escrever(c, msg.hora || '', x + larg - 16 * s, y + alt - 10 * s, { tam: 22 * s, peso: 500, cor: '#667781', alinhar: 'right' });
        y += alt + 22 * s;
      }
    } else if (app === 'tiktok') {
      c.fillStyle = gradiente(c, 0, 0, w, h, [d.cor || '#1e1b4b', '#0f172a', '#7c2d12']); c.fillRect(0, 0, w, h); barraStatus('#fff');
      escrever(c, 'Seguindo   Para você', w / 2, 120 * s, { tam: 30 * s, peso: 700, cor: '#fff', alinhar: 'center' });
      [['♥', d.curtidas ?? '1,2 mi'], ['…', d.comentarios ?? '8.403'], ['↗', d.compartilhamentos ?? '21 mil']].forEach(([ic, v], i) => {
        const y = (860 + i * 170) * s;
        c.fillStyle = 'rgba(255,255,255,0.92)'; c.beginPath(); c.arc(w - 80 * s, y, 44 * s, 0, Math.PI * 2); c.fill();
        escrever(c, ic, w - 80 * s, y + 15 * s, { tam: 40 * s, peso: 700, cor: '#e11d48', alinhar: 'center' });
        escrever(c, fmt(v), w - 80 * s, y + 82 * s, { tam: 24 * s, peso: 700, cor: '#fff', alinhar: 'center' });
      });
      escrever(c, `@${d.usuario || 'perfil'}`, 36 * s, h - 250 * s, { tam: 32 * s, peso: 800, cor: '#fff' });
      paragrafo(c, d.legenda || '', 36 * s, h - 200 * s, w - 180 * s, { tam: 27 * s, peso: 500, cor: '#fff', maxLinhas: 3 });
    } else if (app === 'noticia') {
      barraStatus();
      c.fillStyle = d.cor || '#b91c1c'; c.fillRect(0, 70 * s, w, 110 * s);
      escrever(c, (d.site || 'Notícias').toUpperCase(), w / 2, 142 * s, { tam: 44 * s, peso: 900, cor: '#fff', alinhar: 'center', fonte: SERIFA, larguraMax: w * 0.9 });
      escrever(c, (d.editoria || 'Política').toUpperCase(), 40 * s, 240 * s, { tam: 24 * s, peso: 800, cor: d.cor || '#b91c1c' });
      const yFim = paragrafo(c, d.manchete || '', 40 * s, 300 * s, w - 80 * s, { tam: 50 * s, peso: 800, cor: '#111', fonte: SERIFA, maxLinhas: 4, entrelinha: 1.12 });
      const y2 = paragrafo(c, d.subtitulo || '', 40 * s, yFim + 20 * s, w - 80 * s, { tam: 28 * s, peso: 500, cor: '#444', maxLinhas: 3 });
      c.fillStyle = gradiente(c, 40 * s, y2 + 10 * s, w - 80 * s, 330 * s, ['#94a3b8', '#475569']); ret(c, 40 * s, y2 + 10 * s, w - 80 * s, 330 * s, 12 * s, c.fillStyle);
      if (d.compartilhar) {
        ret(c, 40 * s, y2 + 370 * s, w - 80 * s, 100 * s, 50 * s, d.cor || '#b91c1c');
        escrever(c, 'COMPARTILHAR', w / 2, y2 + 435 * s, { tam: 38 * s, peso: 900, cor: '#fff', alinhar: 'center' });
        for (let i = 0; i < 4; i++) { c.fillStyle = '#e2e2e2'; c.fillRect(40 * s, y2 + (510 + i * 40) * s, (i % 3 === 2 ? 0.6 : 1) * (w - 80 * s), 16 * s); }
      } else {
        escrever(c, d.data || '', 40 * s, y2 + 385 * s, { tam: 22 * s, peso: 500, cor: '#666' });
        for (let i = 0; i < 6; i++) { c.fillStyle = '#e2e2e2'; c.fillRect(40 * s, y2 + (420 + i * 40) * s, (i % 3 === 2 ? 0.6 : 1) * (w - 80 * s), 16 * s); }
      }
    } else if (app === 'banco') {
      c.fillStyle = d.cor || '#820ad1'; c.fillRect(0, 0, w, 470 * s); barraStatus('#fff');
      escrever(c, `Olá, ${d.nome || 'cliente'}`, 40 * s, 170 * s, { tam: 38 * s, peso: 700, cor: '#fff', larguraMax: w - 80 * s });
      escrever(c, 'Saldo disponível', 40 * s, 290 * s, { tam: 28 * s, peso: 500, cor: 'rgba(255,255,255,0.85)' });
      escrever(c, d.saldo ?? 'R$ 0,00', 40 * s, 370 * s, { tam: 66 * s, peso: 800, cor: '#fff', larguraMax: w - 80 * s });
      (d.transacoes || []).slice(0, 6).forEach((tr, i) => {
        const y = (540 + i * 120) * s;
        escrever(c, tr.texto, 40 * s, y, { tam: 30 * s, peso: 600, cor: '#111', larguraMax: w * 0.6 });
        escrever(c, tr.valor, w - 40 * s, y, { tam: 30 * s, peso: 800, cor: String(tr.valor).startsWith('-') ? '#c0392b' : '#1e8449', alinhar: 'right' });
        c.fillStyle = '#eee'; c.fillRect(40 * s, y + 36 * s, w - 80 * s, 2 * s);
      });
    }
    void destaque;
  }, { fundo: '#ffffff', emissivo: brilho, pxPorUnidade: 10000 });
  tela.position.set(0, 0.081, 0.0047); g.add(tela);
  g.userData.tela = tela;
  g.userData.enquadramentos = { geral: { pos: [0, 0.085, 0.42], alvo: [0, 0.081, 0], fov: 30 }, tela: { pos: [0, 0.1, 0.27], alvo: [0, 0.095, 0], fov: 30 }, topo: { pos: [0, 0.14, 0.2], alvo: [0, 0.13, 0], fov: 30 } };
  g.scale.setScalar(escala);
  return g;
}

// Jornal com manchete (papel). Fica de pé (frente +Z); deite com rotation.x = -PI/2.
export function jornal({ nome = 'DIÁRIO', manchete = '', subtitulo = '', data = '', largura = 0.32, altura = 0.44 } = {}) {
  const g = novo('jornal');
  const papel = caixa(largura, altura, 0.006, { raio: 0.002, cor: '#efe9dc' }); papel.position.y = altura / 2; g.add(papel);
  const tela = telaCanvas(largura * 0.98, altura * 0.98, (c, w, h) => {
    c.fillStyle = '#f4efe3'; c.fillRect(0, 0, w, h);
    escrever(c, nome, w / 2, h * 0.09, { tam: h * 0.07, peso: 900, cor: '#111', fonte: SERIFA, alinhar: 'center', larguraMax: w * 0.92 });
    c.fillStyle = '#111'; c.fillRect(w * 0.04, h * 0.11, w * 0.92, 3); c.fillRect(w * 0.04, h * 0.135, w * 0.92, 1);
    escrever(c, data, w * 0.05, h * 0.13, { tam: h * 0.018, peso: 600, cor: '#333' });
    const y = paragrafo(c, manchete, w * 0.05, h * 0.22, w * 0.9, { tam: h * 0.06, peso: 800, cor: '#111', fonte: SERIFA, maxLinhas: 3, entrelinha: 1.08 });
    const y2 = paragrafo(c, subtitulo, w * 0.05, y + h * 0.01, w * 0.9, { tam: h * 0.026, peso: 500, cor: '#333', maxLinhas: 2 });
    c.fillStyle = gradiente(c, w * 0.05, y2, w * 0.55, h * 0.3, ['#9ca3af', '#4b5563']); c.fillRect(w * 0.05, y2 + h * 0.01, w * 0.55, h * 0.3);
    for (let col = 0; col < 2; col++) for (let i = 0; i < 18; i++) {
      const x = col === 0 ? w * 0.63 : w * 0.05; const yy = col === 0 ? y2 + h * 0.015 + i * h * 0.017 : y2 + h * 0.34 + i * h * 0.017;
      if (col === 1 && yy > h * 0.96) break; if (col === 0 && i > 16) break;
      c.fillStyle = '#c9c3b6'; c.fillRect(x, yy, col === 0 ? w * 0.32 : w * 0.9, h * 0.007);
    }
  }, { fundo: '#f4efe3', emissivo: 0.1, pxPorUnidade: 2400 });
  tela.position.set(0, altura / 2, 0.0035); g.add(tela);
  g.userData.enquadramentos = { geral: { pos: [0, altura * 0.5, distPara(largura, 34) + 0.05], alvo: [0, altura * 0.5, 0], fov: 34 }, manchete: { pos: [0, altura * 0.78, 0.36], alvo: [0, altura * 0.78, 0], fov: 30 } };
  return g;
}

// ---------------- gente e lugares ----------------
// Multidão variada (pele, cabelo, roupa, altura, pose). olharPara: ponto que todos encaram.
// cores: força a paleta das roupas (ex.: torcida com as cores do time: ['#ffffff', '#111111']).
export function multidao({ n = 24, largura = 6, profundidade = 3, semente = 3, olharPara = [0, 1.5, 8], poses = ['em_pe', 'em_pe', 'bracos_cruzados', 'comemorando', 'acenando', 'maos_na_cintura'], cores = null } = {}) {
  const g = novo('multidao'); const rnd = mulberry32(semente); const P = pal();
  const peles = P.pele || ['#c68a5b', '#e2b48a', '#8b5a3c', '#f0c9a3', '#a86f48', '#5c3a26'];
  const roupas = cores && cores.length ? cores : [...(P.roupa || []), '#c0392b', '#2e86c1', '#f4d03f', '#7d3c98', '#1e8449', '#e67e22', '#ecf0f1'];
  const calcas = P.calca || ['#2a3a5e', '#1d1f24', '#3c4a3f', '#5a4a3a'];
  const cabelos = ['curto', 'curto', 'longo', 'coque', 'raspado', 'black', 'careca', 'lateral'];
  const corCab = ['#23180f', '#3b2416', '#0f0f10', '#6b4423', '#c9a35b', '#8a8a8a'];
  const alvo = new THREE.Vector3(...olharPara);
  g.userData.pessoas = [];
  const cols = Math.ceil(Math.sqrt(n * (largura / profundidade)));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) / Math.max(1, cols - 1) - 0.5; const cz = Math.floor(i / cols) / Math.max(1, Math.ceil(n / cols) - 1) - 0.5;
    const p = criarPersonagem({
      semente: i + 1, pele: peles[Math.floor(rnd() * peles.length)], roupa: roupas[Math.floor(rnd() * roupas.length)], calca: calcas[Math.floor(rnd() * calcas.length)],
      cabelo: cabelos[Math.floor(rnd() * cabelos.length)], corCabelo: corCab[Math.floor(rnd() * corCab.length)],
      acessorio: rnd() < 0.12 ? 'bone' : null, corAcessorio: roupas[Math.floor(rnd() * roupas.length)], escala: 0.9 + rnd() * 0.16,
      barba: rnd() < 0.18 ? (rnd() < 0.5 ? 'curta' : 'cheia') : null, oculos: rnd() < 0.15 ? true : null,
    });
    p.pose(poses[Math.floor(rnd() * poses.length)]);
    p.grupo.position.set(cx * largura + (rnd() - 0.5) * 0.35, 0, cz * profundidade + (rnd() - 0.5) * 0.35);
    p.grupo.rotation.y = Math.atan2(alvo.x - p.grupo.position.x, alvo.z - p.grupo.position.z) + (rnd() - 0.5) * 0.3;
    g.add(p.grupo); g.userData.pessoas.push(p);
  }
  const dir = new THREE.Vector3(alvo.x, 0, alvo.z).normalize();
  const longe = Math.max(distPara(largura, 38), 4);
  g.userData.enquadramentos = {
    geral: { pos: [dir.x * longe, 2.0, dir.z * longe], alvo: [0, 1.15, 0], fov: 38 },
    costas: { pos: [-dir.x * (profundidade / 2 + 2.4), 2.0, -dir.z * (profundidade / 2 + 2.4)], alvo: [alvo.x, 1.5, alvo.z], fov: 42 },
  };
  return g;
}

// Estúdio de criador de conteúdo: parede com LED e letreiro neon do canal, mesa, monitor, microfone de braço,
// ring light, câmera no tripé, estante e cadeira. userData.lugar = onde a pessoa senta; userData.monitor = tela.
export function estudioCriador({ canal = '', inscritos = null, corLed = '#7c4dff', corParede = '#2b2f3a', desenharMonitor = null } = {}) {
  const g = novo('estudio');
  const parede = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), mat.fosco(corParede)); parede.position.set(0, 1.4, -1.1); parede.receiveShadow = true; g.add(parede);
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.6), mat.madeira('#9c7a55')); piso.rotation.x = -Math.PI / 2; piso.position.set(0, 0.002, 0.6); piso.receiveShadow = true; g.add(piso);
  const led = caixa(3.8, 0.03, 0.02, { raio: 0.008, material: mat.emissivo(corLed, 2.2) }); led.position.set(0, 2.55, -1.08); g.add(led);
  const ledBaixo = caixa(3.8, 0.02, 0.02, { raio: 0.006, material: mat.emissivo(corLed, 1.6) }); ledBaixo.position.set(0, 0.06, -1.08); g.add(ledBaixo);
  if (canal) {
    const neon = telaCanvas(1.6, 0.42, (c, w, h) => {
      c.fillStyle = corParede; c.fillRect(0, 0, w, h);
      c.shadowColor = corLed; c.shadowBlur = h * 0.25;
      escrever(c, canal, w / 2, h * 0.68, { tam: h * 0.55, peso: 800, cor: '#ffffff', alinhar: 'center', larguraMax: w * 0.94 });
      c.shadowBlur = 0;
    }, { fundo: corParede, emissivo: 1.1, pxPorUnidade: 500 });
    neon.position.set(0, 2.0, -1.09); g.add(neon);
  }
  const estante = caixa(1.1, 0.04, 0.22, { raio: 0.01, material: mat.madeira('#b88a5a') }); estante.position.set(-1.15, 1.55, -0.99); g.add(estante);
  const coresLivro = ['#c0392b', '#2e86c1', '#f4d03f', '#16a085', '#8e44ad', '#ecf0f1', '#d35400'];
  for (let i = 0; i < 9; i++) { const a = 0.18 + (i % 3) * 0.03; const l = caixa(0.05, a, 0.16, { raio: 0.006, cor: coresLivro[i % coresLivro.length] }); l.position.set(-1.6 + i * 0.065, 1.57 + a / 2, -0.99); if (i === 8) l.rotation.z = 0.35; g.add(l); }
  const vaso = cilindro(0.07, 0.12, { cor: '#e9e4da', rTopo: 0.08 }); vaso.position.set(-0.75, 1.63, -0.99); g.add(vaso);
  for (let i = 0; i < 4; i++) { const f = esfera(0.07, { material: mat.fosco('#4f8a4f') }); f.position.set(-0.75 + (i - 1.5) * 0.04, 1.75 + (i % 2) * 0.05, -0.99); g.add(f); }
  const cad = cadeira({}); cad.position.set(0, 0, -0.2); g.add(cad);
  const m = mesa({ largura: 1.5, profundidade: 0.7 }); m.position.set(0, 0, 0.45); g.add(m);
  const monitor = novo('monitor');
  const quadro = caixa(0.68, 0.42, 0.03, { raio: 0.012, cor: '#111318' }); monitor.add(quadro);
  const tela = telaCanvas(0.64, 0.38, desenharMonitor || ((c, w, h) => {
    c.fillStyle = '#0f1115'; c.fillRect(0, 0, w, h);
    escrever(c, 'Estatísticas do canal', w * 0.05, h * 0.14, { tam: h * 0.08, peso: 700, cor: '#e5e7eb' });
    if (inscritos != null) escrever(c, `${fmt(inscritos)} inscritos`, w * 0.05, h * 0.3, { tam: h * 0.11, peso: 800, cor: '#ffffff', larguraMax: w * 0.9 });
    c.strokeStyle = '#3ea6ff'; c.lineWidth = h * 0.015; c.beginPath();
    for (let i = 0; i <= 24; i++) { const x = w * 0.05 + (i / 24) * w * 0.9; const y = h * 0.9 - Math.pow(i / 24, 1.8) * h * 0.45 - Math.sin(i * 1.7) * h * 0.02; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
  }), { fundo: '#0f1115', emissivo: 1.0, pxPorUnidade: 1200 });
  tela.position.z = 0.016; monitor.add(tela);
  const haste = cilindro(0.02, 0.22, { material: mat.metal('#2a2d33') }); haste.position.y = -0.3; monitor.add(haste);
  const pe = cilindro(0.11, 0.015, { material: mat.metal('#2a2d33') }); pe.position.y = -0.41; monitor.add(pe);
  monitor.position.set(0.66, 0.75 + 0.42, 0.5); monitor.rotation.y = Math.PI + 0.85; g.add(monitor);
  const braco = tubo([[-0.62, 0.76, 0.72], [-0.62, 1.12, 0.6], [-0.42, 1.18, 0.32], [-0.24, 1.1, 0.2]], 0.012, { cor: '#1f2228' }); g.add(braco);
  const mic = cilindro(0.035, 0.16, { material: mat.metal('#2a2d33') }); mic.position.set(-0.2, 1.04, 0.18); mic.rotation.set(-0.5, 0, -0.5); g.add(mic);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 12, 48), mat.emissivo('#fff7e6', 1.6)); ring.position.set(-0.75, 1.45, 1.45); ring.rotation.y = -0.45; g.add(ring);
  const tripeRing = cilindro(0.015, 1.25, { material: mat.metal('#2a2d33') }); tripeRing.position.set(-0.75, 0.62, 1.45); g.add(tripeRing);
  const cam = novo('camera');
  const corpoCam = caixa(0.16, 0.1, 0.09, { raio: 0.01, cor: '#1b1d22' }); cam.add(corpoCam);
  const lente = cilindro(0.035, 0.09, { material: mat.metal('#111') }); lente.rotation.x = Math.PI / 2; lente.position.z = -0.08; cam.add(lente);
  cam.position.set(0.75, 1.3, 1.5); cam.rotation.y = 0.45; g.add(cam);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.add(tubo([[0.75, 1.24, 1.5], [0.75 + Math.sin(a) * 0.35, 0.0, 1.5 + Math.cos(a) * 0.35]], 0.01, { cor: '#2a2d33' })); }
  g.userData.lugar = [0, 0, -0.15]; g.userData.monitor = tela;
  g.userData.enquadramentos = { geral: { pos: [-0.2, 1.45, 3.3], alvo: [0, 1.15, -0.4], fov: 40 }, pessoa: { pos: [-0.1, 1.28, 1.5], alvo: [0, 1.12, -0.15], fov: 34 }, ombro: { pos: [-0.3, 1.35, -0.6], alvo: [0.5, 1.15, 0.55], fov: 40 }, letreiro: { pos: [0, 1.9, 1.3], alvo: [0, 2.0, -1.09], fov: 34 } };
  return g;
}

// Palanque de comício: plataforma, púlpito com microfone, faixa com texto e bandeiras. userData.lugar = atrás do púlpito.
export function palanque({ faixa = '', cores = ['#d6332b', '#ffffff'], largura = 3.2, bandeiras = true } = {}) {
  const g = novo('palanque');
  const plat = caixa(largura, 0.45, 1.6, { raio: 0.02, material: mat.madeira('#a57c52') }); plat.position.y = 0.225; g.add(plat);
  const saia = caixa(largura + 0.02, 0.4, 0.02, { raio: 0.005, cor: cores[0] }); saia.position.set(0, 0.22, 0.81); g.add(saia);
  for (let i = 0; i < 3; i++) { const d = caixa(0.6, 0.15, 0.3, { raio: 0.01, material: mat.madeira('#9b7249') }); d.position.set(largura / 2 + 0.3, 0.075 + i * 0.15, 0.6 - i * 0.3); g.add(d); }
  const pulpito = caixa(0.6, 1.05, 0.42, { raio: 0.03, cor: '#2b2f3a' }); pulpito.position.set(0, 0.45 + 0.525, 0.35); g.add(pulpito);
  const frente = telaCanvas(0.5, 0.5, (c, w, h) => { c.fillStyle = cores[0]; c.fillRect(0, 0, w, h); escrever(c, (faixa.split(/\s+/)[0] || '').toUpperCase(), w / 2, h * 0.6, { tam: h * 0.3, peso: 900, cor: cores[1] || '#fff', alinhar: 'center', larguraMax: w * 0.9 }); }, { fundo: cores[0], emissivo: 0.3, pxPorUnidade: 400 });
  frente.position.set(0, 0.45 + 0.6, 0.565); g.add(frente);
  g.add(tubo([[0, 1.5, 0.45], [0, 1.62, 0.5], [0, 1.68, 0.62]], 0.008, { cor: '#1f2228' }));
  const mic = capsulaMic(); mic.position.set(0, 1.7, 0.66); g.add(mic);
  if (faixa) {
    const f = telaCanvas(largura * 0.92, 0.55, (c, w, h) => { c.fillStyle = cores[0]; c.fillRect(0, 0, w, h); escrever(c, faixa.toUpperCase(), w / 2, h * 0.66, { tam: h * 0.5, peso: 900, cor: cores[1] || '#fff', alinhar: 'center', larguraMax: w * 0.94 }); }, { fundo: cores[0], emissivo: 0.35, pxPorUnidade: 380 });
    f.position.set(0, 2.55, -0.7); g.add(f);
    for (const sx of [-1, 1]) { const poste = cilindro(0.03, 2.9, { material: mat.metal('#6b7280') }); poste.position.set(sx * largura * 0.47, 0.45 + 1.45 - 0.45, -0.72); g.add(poste); }
  }
  if (bandeiras) for (const sx of [-1, 1]) {
    const b = bandeira((c, w, h) => { c.fillStyle = cores[0]; c.fillRect(0, 0, w, h); c.fillStyle = cores[1] || '#fff'; c.fillRect(0, h * 0.4, w, h * 0.2); }, { largura: 0.7, altura: 0.46, mastro: 2.2 });
    b.position.set(sx * (largura / 2 + 0.5), 0, -0.4); g.add(b);
  }
  g.userData.lugar = [0, 0.45, 0.05];
  g.userData.enquadramentos = { geral: { pos: [0, 2.0, distPara(largura + 1.6, 38)], alvo: [0, 1.6, 0], fov: 38 }, orador: { pos: [0.35, 1.85, 2.6], alvo: [0, 1.75, 0.15], fov: 34 } };
  return g;
}
function capsulaMic() {
  const g = novo('mic');
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.05, 6, 12), mat.metal('#2a2d33')); c.rotation.x = Math.PI / 2; g.add(sombrear(c));
  return g;
}

// Plenário em semicírculo (Câmara, Senado, assembleia): fileiras em degraus viradas para a mesa diretora.
export function plenario({ fileiras = 4, porFileira = 12, raio = 3.2, passo = 0.85, abertura = 160, cor = '#2f7d4f', painel = null } = {}) {
  const g = novo('plenario');
  const ab = THREE.MathUtils.degToRad(abertura);
  for (let r = 0; r < fileiras; r++) {
    const R0 = raio + r * passo - 0.42; const R1 = raio + r * passo + 0.42; const alt = 0.12 + r * 0.18;
    const forma = new THREE.Shape();
    forma.absarc(0, 0, R1, Math.PI / 2 - ab / 2, Math.PI / 2 + ab / 2, false);
    forma.absarc(0, 0, R0, Math.PI / 2 + ab / 2, Math.PI / 2 - ab / 2, true);
    const degrau = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: alt, bevelEnabled: false, curveSegments: 48 }), mat.fosco('#d9d2c3'));
    degrau.rotation.x = -Math.PI / 2; degrau.position.z = 0; g.add(sombrear(degrau));
    for (let k = 0; k < porFileira; k++) {
      const a = Math.PI / 2 - ab / 2 + (ab * (k + 0.5)) / porFileira;
      const rr = raio + r * passo;
      const x = Math.cos(a) * rr; const z = -Math.sin(a) * rr;
      const lugar = novo('lugar');
      const bancada = caixa(0.5, 0.07, 0.22, { raio: 0.01, material: mat.madeira('#8b5e3c') }); bancada.position.set(0, 0.72, 0.12); lugar.add(bancada);
      const assento = caixa(0.42, 0.42, 0.4, { raio: 0.06, cor }); assento.position.set(0, 0.45, -0.2); lugar.add(assento);
      const encosto = caixa(0.42, 0.55, 0.1, { raio: 0.05, cor }); encosto.position.set(0, 0.85, -0.4); lugar.add(encosto);
      lugar.position.set(x, alt, z); lugar.rotation.y = Math.atan2(-x, -z); g.add(lugar);
    }
  }
  const mesaD = caixa(3, 0.9, 0.7, { raio: 0.03, material: mat.madeira('#7a4f2e') }); mesaD.position.set(0, 0.45 + 0.3, raio * 0.15); g.add(mesaD);
  const tablado = caixa(3.6, 0.3, 1.4, { raio: 0.02, cor: '#cfc6b6' }); tablado.position.set(0, 0.15, raio * 0.15 - 0.2); g.add(tablado);
  if (painel) { painel.position.set(0, 0, raio * 0.15 - 1.4); g.add(painel); }
  const rMax = raio + fileiras * passo;
  g.userData.enquadramentos = { geral: { pos: [0, rMax * 1.3, rMax * 1.25], alvo: [0, 0.5, -raio * 0.7], fov: 40 }, mesa: { pos: [0, 1.6 + fileiras * 0.18, -raio], alvo: [0, 1.0, raio * 0.15], fov: 42 } };
  return g;
}

// ---------------- automobilismo ----------------
// Carro de Fórmula 1 (proporção real: ~5 m, piloto de capacete no cockpit). Frente para +X.
// cor = carroceria, corDetalhe = bico/asas/faixas, numero no bico e na cobertura do motor,
// capacete/corCapaceteFaixa = o capacete do piloto (null = sem piloto). userData.rodas para girar (gira(t, vel)).
export function carroF1({ cor = '#c9ced6', corDetalhe = '#00a19b', numero = null, corNumero = '#ffffff', capacete = '#eef1f4', corCapaceteFaixa = null, corPneu = '#141518', faixaPneu = '#f5c518', escala = 1 } = {}) {
  const g = novo('carroF1');
  const mCor = mat.plastico(cor); const mDet = mat.plastico(corDetalhe);
  const mCarbono = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.45, metalness: 0.2 });
  const add = (o, x, y, z) => { o.position.set(x, y, z); sombrear(o); g.add(o); return o; };
  // assoalho e carroceria
  add(caixa(4.3, 0.05, 1.45, { raio: 0.02, material: mCarbono }), -0.1, 0.09, 0);
  add(caixa(2.4, 0.4, 0.62, { raio: 0.16, material: mCor }), -0.15, 0.36, 0); // monocoque
  for (const s of [-1, 1]) {
    add(caixa(1.55, 0.34, 0.4, { raio: 0.14, material: mCor }), -0.45, 0.3, s * 0.5); // sidepods
    add(caixa(1.2, 0.05, 0.03, { raio: 0.01, material: mDet }), -0.35, 0.36, s * 0.71); // faixa do sidepod
  }
  add(caixa(1.5, 0.42, 0.42, { raio: 0.16, material: mCor }), -1.45, 0.5, 0); // cobertura do motor
  add(caixa(0.36, 0.34, 0.3, { raio: 0.1, material: mCarbono }), -0.55, 0.8, 0); // tomada de ar
  const bico = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.21, 1.75, 20), mCor);
  bico.rotation.z = -Math.PI / 2; bico.scale.z = 1.35; add(bico, 1.85, 0.3, 0);
  add(caixa(0.3, 0.12, 0.2, { raio: 0.05, material: mDet }), 2.62, 0.24, 0); // ponta do bico
  // cockpit, piloto e halo
  add(caixa(0.72, 0.06, 0.44, { raio: 0.03, material: mCarbono }), 0.36, 0.56, 0);
  if (capacete) {
    const cap = criarCapacete({ cor: capacete, corFaixa: corCapaceteFaixa, escala: 1.25 });
    cap.rotation.y = Math.PI / 2; add(cap, 0.3, 0.7, 0);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.026, 8, 28, Math.PI), mCarbono);
  halo.rotation.set(Math.PI / 2, 0, Math.PI / 2); add(halo, 0.3, 0.84, 0);
  const pilar = add(cilindro(0.025, 0.3, { material: mCarbono }), 0.62, 0.7, 0); pilar.rotation.z = 0.35;
  // asas
  add(caixa(0.5, 0.04, 1.95, { raio: 0.015, material: mDet }), 2.55, 0.11, 0);
  add(caixa(0.32, 0.03, 1.8, { raio: 0.01, material: mCarbono }), 2.42, 0.17, 0);
  for (const s of [-1, 1]) add(caixa(0.5, 0.2, 0.03, { raio: 0.01, material: mDet }), 2.55, 0.17, s * 0.98);
  add(caixa(0.42, 0.06, 1.3, { raio: 0.02, material: mDet }), -2.3, 0.98, 0);
  add(caixa(0.3, 0.04, 1.3, { raio: 0.015, material: mCarbono }), -2.25, 1.08, 0);
  for (const s of [-1, 1]) add(caixa(0.62, 0.62, 0.03, { raio: 0.02, material: mCor }), -2.3, 0.78, s * 0.66);
  add(caixa(0.12, 0.4, 0.06, { raio: 0.02, material: mCarbono }), -2.1, 0.72, 0);
  // rodas
  const rodas = [];
  for (const [x, z] of [[1.55, 0.82], [1.55, -0.82], [-1.55, 0.84], [-1.55, -0.84]]) {
    const r = new THREE.Group();
    const pneu = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, x > 0 ? 0.32 : 0.4, 28), new THREE.MeshStandardMaterial({ color: corPneu, roughness: 0.85 }));
    pneu.rotation.x = Math.PI / 2; sombrear(pneu); r.add(pneu);
    const anel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.016, 8, 32), new THREE.MeshStandardMaterial({ color: faixaPneu, roughness: 0.5 }));
    anel.position.z = Math.sign(z) * ((x > 0 ? 0.16 : 0.2) + 0.002); r.add(anel);
    const aro = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20), mCarbono); aro.rotation.x = Math.PI / 2; aro.position.z = Math.sign(z) * ((x > 0 ? 0.16 : 0.2) + 0.004); r.add(aro);
    add(r, x, 0.34, z); rodas.push(r);
  }
  if (numero != null && numero !== '') {
    const n1 = placaNumero(numero, { fundo: corDetalhe, cor: corNumero, l: 0.3, a: 0.22 }); n1.rotation.x = -Math.PI / 2; n1.rotation.z = -Math.PI / 2; add(n1, 1.55, 0.41, 0);
    for (const s of [-1, 1]) { const n2 = placaNumero(numero, { fundo: corDetalhe, cor: corNumero, l: 0.3, a: 0.22 }); n2.rotation.y = s > 0 ? 0 : Math.PI; add(n2, -1.3, 0.55, s * 0.215); }
  }
  g.userData.rodas = rodas;
  g.userData.gira = (t, vel = 1) => { for (const r of rodas) r.rotation.z = -t * vel * 2.9; };
  g.scale.setScalar(escala);
  g.userData.enquadramentos = { geral: { pos: [0.8 * escala, 1.6 * escala, 7.5 * escala], alvo: [0, 0.45 * escala, 0], fov: 36 }, cockpit: { pos: [1.8 * escala, 1.3 * escala, 2.2 * escala], alvo: [0.3 * escala, 0.75 * escala, 0], fov: 34 } };
  return g;
}

// Pódio de três degraus (2-1-3). userData.lugares[1|2|3] = [x, y, z] do topo de cada degrau, para pôr os pilotos.
export function podio({ largura = 1.1, alturas = [1.1, 0.8, 0.55], cor = '#f4f2ee', corNumero = '#1d2026', vao = 0.1 } = {}) {
  const g = novo('podio');
  const lugares = {};
  for (const [pos, k] of [[2, -1], [1, 0], [3, 1]]) {
    const a = alturas[pos - 1]; const x = k * (largura + vao);
    const d = caixa(largura, a, 1.0, { raio: 0.03, cor }); d.position.set(x, a / 2, 0); sombrear(d); g.add(d);
    const n = telaCanvas(0.5, 0.4, (c, w, h) => escrever(c, String(pos), w / 2, h * 0.8, { tam: h * 0.9, peso: 900, cor: corNumero, alinhar: 'center' }), { fundo: cor, emissivo: 0.3 });
    n.position.set(x, a / 2, 0.505); g.add(n);
    lugares[pos] = [x, a, 0.05];
  }
  g.userData.lugares = lugares;
  g.userData.enquadramentos = { geral: { pos: [0, 2.2, 7.5], alvo: [0, 1.2, 0], fov: 34 } };
  return g;
}

// Troféu metálico (taça com alças sobre base escura). A origem é a base.
export function trofeu({ cor = '#e3e6ea', base = '#2c2f36', escala = 1 } = {}) {
  const g = novo('trofeu');
  const mT = mat.metal(cor); const mB = mat.metal(base);
  const add = (o, y) => { o.position.y = y; sombrear(o); g.add(o); return o; };
  add(cilindro(0.09, 0.07, { material: mB }), 0.035);
  add(cilindro(0.06, 0.05, { material: mB }), 0.095);
  add(cilindro(0.022, 0.16, { material: mT }), 0.2);
  const taca = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.05, 0.24, 28, 1, true), mT); taca.material.side = THREE.DoubleSide; add(taca, 0.4);
  for (const s of [-1, 1]) { const alca = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20, Math.PI), mT); alca.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; alca.position.set(s * 0.13, 0.42, 0); sombrear(alca); g.add(alca); }
  g.scale.setScalar(escala);
  return g;
}

// ---------------- futebol ----------------
// Bola de futebol (gomos pretos sobre branco). Raio padrão 0,11 m (tamanho real).
export function bola({ raio = 0.11, cor = '#ffffff', gomos = '#15171a' } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = cor; g.fillRect(0, 0, 512, 256);
  g.fillStyle = gomos;
  const pent = (x, y, r) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); };
  for (const [x, y] of [[64, 60], [192, 60], [320, 60], [448, 60], [0, 196], [128, 196], [256, 196], [384, 196], [512, 196], [128, 128], [384, 128]]) pent(x, y, 26);
  pent(256, 8, 40); pent(256, 250, 40);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(raio, 32, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
  sombrear(m); m.name = 'bola';
  return m;
}

// Estádio de futebol em diorama: gramado listrado com as marcações, arquibancada em 3 lados com degraus,
// torres de refletor, telão e placar eletrônico (telas de canvas atualizáveis no tempo).
// telao(g, w, h, t) e placar(g, w, h, t) desenham o conteúdo; chame userData.atualizar(t, chave) no render.
export function estadio({ nome = '', comprimento = 14, largura = 9, cor = '#1f2228', corAssento = '#d8d8d8', telao = null, placar = null, refletores = true, telaoTam = [5.2, 2.6], placarTam = [4.0, 1.4] } = {}) {
  const g = novo('estadio');
  const campo = telaCanvas(comprimento, largura, (c, w, h) => {
    for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? '#2f8f43' : '#38a14d'; c.fillRect((i * w) / 12, 0, w / 12 + 1, h); }
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = h * 0.008;
    const mx = w * 0.04, my = h * 0.06; c.strokeRect(mx, my, w - 2 * mx, h - 2 * my);
    c.beginPath(); c.moveTo(w / 2, my); c.lineTo(w / 2, h - my); c.stroke();
    c.beginPath(); c.arc(w / 2, h / 2, h * 0.14, 0, Math.PI * 2); c.stroke();
    for (const lado of [0, 1]) { const x0 = lado ? w - mx - w * 0.13 : mx; c.strokeRect(x0, h * 0.25, w * 0.13, h * 0.5); c.strokeRect(lado ? w - mx - w * 0.05 : mx, h * 0.38, w * 0.05, h * 0.24); }
  }, { pxPorUnidade: 70, emissivo: 0.15 });
  campo.rotation.x = -Math.PI / 2; campo.position.y = 0.012; g.add(campo);
  const mCor = mat.plastico(cor); const mAss = mat.plastico(corAssento);
  // arquibancada: 3 lados (fundo, esquerda, direita), 4 degraus
  const degrau = (l, p, x, z, rotY, i) => {
    const d = caixa(l, 0.42, p, { raio: 0.02, material: i % 2 ? mAss : mCor }); d.position.set(x, 0.21 + i * 0.42, z); d.rotation.y = rotY; sombrear(d); g.add(d);
  };
  for (let i = 0; i < 4; i++) {
    const off = 0.8 + i * 0.9;
    degrau(comprimento + 2 * off, 0.9, 0, -(largura / 2 + off), 0, i);
    degrau(largura + 2 * off, 0.9, -(comprimento / 2 + off), 0, Math.PI / 2, i);
    degrau(largura + 2 * off, 0.9, comprimento / 2 + off, 0, Math.PI / 2, i);
  }
  // telão sobre a arquibancada do fundo e placar ao lado
  const fundoZ = -(largura / 2 + 0.8 + 3 * 0.9) - 0.2;
  let telaTelao = null; let telaPlacar = null;
  if (telao) {
    const [tl, ta] = telaoTam; const ty = 2.1 + ta / 2;
    telaTelao = telaCanvas(tl, ta, telao, { pxPorUnidade: 160, emissivo: 0.95, fundo: '#0b0d12' });
    const moldura = caixa(tl + 0.3, ta + 0.3, 0.2, { raio: 0.04, cor: '#15171c' }); moldura.position.set(-2.2, ty, fundoZ - 0.12); g.add(moldura);
    telaTelao.position.set(-2.2, ty, fundoZ - 0.01); g.add(telaTelao);
    for (const sx of [-1, 1]) { const perna = cilindro(0.08, ty - ta / 2, { material: mat.metal('#5b6170') }); perna.position.set(-2.2 + sx * (tl / 2 - 0.2), (ty - ta / 2) / 2, fundoZ - 0.12); g.add(perna); }
  }
  if (placar) {
    const [pl, pa] = placarTam;
    telaPlacar = telaCanvas(pl, pa, placar, { pxPorUnidade: 160, emissivo: 0.95, fundo: '#0b0d12' });
    const moldura = caixa(pl + 0.3, pa + 0.3, 0.2, { raio: 0.04, cor: '#15171c' }); moldura.position.set(3.4, 3.0, fundoZ - 0.12); g.add(moldura);
    telaPlacar.position.set(3.4, 3.0, fundoZ - 0.01); g.add(telaPlacar);
  }
  if (nome) {
    const letreiro = telaCanvas(6, 0.6, (c, w, h) => escrever(c, nome.toUpperCase(), w / 2, h * 0.75, { tam: h * 0.62, peso: 900, cor: '#ffffff', alinhar: 'center', larguraMax: w * 0.96 }), { fundo: cor, emissivo: 0.4, pxPorUnidade: 160 });
    letreiro.position.set(0, 1.95, fundoZ + 3 * 0.9 + 0.47); g.add(letreiro);
  }
  if (refletores) {
    for (const [x, z] of [[-comprimento / 2 - 3.2, -largura / 2 - 3.2], [comprimento / 2 + 3.2, -largura / 2 - 3.2]]) {
      const torre = cilindro(0.12, 6.5, { material: mat.metal('#9aa0a8') }); torre.position.set(x, 3.25, z); g.add(torre);
      const luz = caixa(1.4, 0.8, 0.2, { raio: 0.04, material: mat.emissivo ? mat.emissivo('#fff7d6') : mat.plastico('#fff7d6') }); luz.position.set(x, 6.7, z + 0.1); luz.lookAt(0, 0, 0); g.add(luz);
    }
  }
  g.userData.telao = telaTelao; g.userData.placar = telaPlacar; g.userData.fundoZ = fundoZ;
  g.userData.atualizar = (t, chave) => { telaTelao?.userData.atualizar(t, chave); telaPlacar?.userData.atualizar(t, chave); };
  g.userData.enquadramentos = {
    geral: { pos: [0, 6.5, largura / 2 + 9], alvo: [0, 1.2, -1], fov: 40 },
    telao: { pos: [-2.2, 3.0, 4.5], alvo: [-2.2, 3.3, fundoZ], fov: 34 },
    placar: { pos: [3.4, 2.8, 3.0], alvo: [3.4, 3.0, fundoZ], fov: 30 },
    gramado: { pos: [0, 0.6, 3.5], alvo: [0, 0.8, -3], fov: 40 },
  };
  return g;
}

// Quadro de investigação (cortiça): itens presos com alfinete e fios vermelhos ligando-os (teoria, caso, pistas).
// itens: [{ tipo:'foto'|'recorte'|'nota', titulo, texto, x, y (0–1 no quadro), l, a (m), rot (graus), cor }]
// ligacoes: [[i, j], ...]. userData.mostrarItem(i, x 0–1), userData.revelarFio(k, x 0–1), userData.pino(i) → Vector3 (mundo).
export function quadroInvestigacao({ itens = [], ligacoes = [], largura = 3.2, altura = 2.2, corFio = '#d0202a' } = {}) {
  const g = novo('quadroInvestigacao');
  const moldura = caixa(largura + 0.16, altura + 0.16, 0.06, { raio: 0.02, material: mat.madeira ? mat.madeira('#7a5230') : mat.plastico('#7a5230') }); moldura.position.z = -0.04; g.add(moldura);
  const rnd = mulberry32(7);
  const cortica = telaCanvas(largura, altura, (c, w, h) => {
    c.fillStyle = '#b8875a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(90,55,25,.35)' : 'rgba(235,200,150,.3)'; c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3); }
  }, { pxPorUnidade: 260, emissivo: 0.12 });
  g.add(cortica);
  const pinos = []; const pecas = [];
  itens.forEach((it, i) => {
    const l = it.l || (it.tipo === 'nota' ? 0.42 : 0.6); const a = it.a || (it.tipo === 'foto' ? 0.7 : 0.45);
    const peca = telaCanvas(l, a, (c, w, h) => {
      if (it.tipo === 'foto') {
        c.fillStyle = '#f7f5ef'; c.fillRect(0, 0, w, h);
        c.fillStyle = it.cor || '#5b6573'; c.fillRect(w * 0.07, h * 0.06, w * 0.86, h * 0.68);
        if (it.desenho) it.desenho(c, w * 0.07, h * 0.06, w * 0.86, h * 0.68);
        escrever(c, it.titulo || '', w / 2, h * 0.9, { tam: h * 0.1, peso: 800, cor: '#1d2026', alinhar: 'center', larguraMax: w * 0.9 });
      } else if (it.tipo === 'nota') {
        c.fillStyle = it.cor || '#f5e663'; c.fillRect(0, 0, w, h);
        paragrafo(c, it.titulo || it.texto || '', w * 0.08, h * 0.3, w * 0.84, { tam: h * 0.16, peso: 800, cor: '#1d2026', maxLinhas: 4 });
      } else {
        c.fillStyle = '#efe8d8'; c.fillRect(0, 0, w, h);
        escrever(c, it.titulo || '', w * 0.06, h * 0.3, { tam: h * 0.2, peso: 900, cor: '#1d2026', larguraMax: w * 0.88 });
        if (it.texto) paragrafo(c, it.texto, w * 0.06, h * 0.5, w * 0.88, { tam: h * 0.11, peso: 600, cor: '#3a3f48', maxLinhas: 3 });
      }
    }, { pxPorUnidade: 700, emissivo: 0.25, fundo: '#efe8d8' });
    const x = (it.x - 0.5) * largura; const y = (0.5 - it.y) * altura;
    peca.position.set(x, y, 0.012 + i * 0.002); peca.rotation.z = THREE.MathUtils.degToRad(it.rot || 0); g.add(peca); pecas.push(peca);
    const pino = esfera(0.03, { cor: '#c0262d' }); pino.position.set(x, y + a / 2 - 0.05, 0.05); g.add(pino); pinos.push(pino);
  });
  const fios = ligacoes.map(([i, j]) => {
    const A = pinos[i].position, B = pinos[j].position;
    const meio = A.clone().add(B).multiplyScalar(0.5); meio.y -= 0.06 + A.distanceTo(B) * 0.05; meio.z += 0.02;
    const curva = new THREE.CatmullRomCurve3([A.clone().setZ(0.055), meio, B.clone().setZ(0.055)]);
    const geo = new THREE.TubeGeometry(curva, 48, 0.008, 6, false);
    const fio = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: corFio, roughness: 0.6 }));
    g.add(fio); return fio;
  });
  g.userData.pecas = pecas; g.userData.pinos = pinos; g.userData.fios = fios;
  g.userData.mostrarItem = (i, x) => { const p = pecas[i]; if (!p) return; const s = Math.max(0.001, x); p.scale.set(s, s, 1); p.visible = x > 0.001; pinos[i].visible = x > 0.5; };
  g.userData.revelarFio = (k, x) => { const f = fios[k]; if (!f) return; const total = f.geometry.index.count; f.geometry.setDrawRange(0, Math.floor((total * clamp(x)) / 6) * 6); f.visible = x > 0.001; };
  g.userData.pino = (i) => { const v = new THREE.Vector3(); pinos[i]?.getWorldPosition(v); return v; };
  g.userData.enquadramentos = { geral: { pos: [0, 0, distPara(largura + 0.6, 36)], alvo: [0, 0, 0], fov: 36 } };
  return g;
}

// Termômetro de "risco"/"chance": tubo de vidro com líquido, escala de 0 a 100 e o valor em destaque.
// userData.nivel(pct) muda o líquido e o número (redesenha só quando o valor inteiro muda).
export function termometro({ rotulo = 'RISCO', altura = 2.2, cor = '#e5484d', max = 100 } = {}) {
  const g = novo('termometro');
  const vidro = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, altura, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#dfe7ee', transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide }));
  vidro.position.y = altura / 2 + 0.25; g.add(vidro);
  const bulbo = esfera(0.22, { cor }); bulbo.position.y = 0.2; g.add(bulbo);
  const geo = new THREE.CylinderGeometry(0.085, 0.085, 1, 20); geo.translate(0, 0.5, 0);
  const liquido = new THREE.Mesh(geo, mat.plastico(cor)); liquido.position.y = 0.3; g.add(liquido);
  const escala = telaCanvas(0.5, altura, (c, w, h) => {
    c.fillStyle = '#f7f5ef'; c.fillRect(0, 0, w, h);
    for (let i = 0; i <= 10; i++) { const y = h - (i / 10) * h * 0.96 - h * 0.02; c.fillStyle = '#1d2026'; c.fillRect(0, y, i % 5 ? w * 0.25 : w * 0.45, h * 0.004); if (i % 2 === 0) escrever(c, `${(i * max) / 10}%`, w * 0.98, y + h * 0.012, { tam: h * 0.035, peso: 700, cor: '#3a3f48', alinhar: 'right' }); }
  }, { pxPorUnidade: 260, emissivo: 0.2 });
  escala.position.set(0.42, altura / 2 + 0.3, 0); g.add(escala);
  let valorAtual = 0;
  const visor = telaCanvas(1.4, 0.55, (c, w, h) => {
    c.fillStyle = '#1d2026'; c.fillRect(0, 0, w, h);
    escrever(c, rotulo, w / 2, h * 0.32, { tam: h * 0.2, peso: 800, cor: '#cfd6ea', alinhar: 'center', larguraMax: w * 0.94 });
    escrever(c, `${Math.round(valorAtual)}%`, w / 2, h * 0.86, { tam: h * 0.5, peso: 900, cor: '#ffffff', alinhar: 'center' });
  }, { pxPorUnidade: 300, emissivo: 0.6, fundo: '#1d2026' });
  visor.position.set(0, altura + 0.75, 0); g.add(visor);
  g.userData.nivel = (pct) => {
    const p = clamp(pct / max);
    liquido.scale.y = Math.max(0.001, p * (altura - 0.1));
    valorAtual = pct; visor.userData.atualizar(0, Math.round(pct));
  };
  g.userData.nivel(0);
  g.userData.enquadramentos = { geral: { pos: [0.6, altura * 0.6, distPara(1.6, 34) + 1.2], alvo: [0.1, altura * 0.55, 0], fov: 34 } };
  return g;
}

// Contrato/pergaminho que desenrola: título, linhas de texto, uma cláusula em destaque e a assinatura.
// userData.abrir(x 0–1) desenrola; userData.destacar(x 0–1) acende a cláusula.
export function contrato({ titulo = 'CONTRATO', clausula = '', assinatura = '', largura = 1.2, altura = 1.6, corDestaque = '#f5c518' } = {}) {
  const g = novo('contrato');
  let brilho = 0;
  const papel = telaCanvas(largura, altura, (c, w, h) => {
    c.fillStyle = '#f3ead6'; c.fillRect(0, 0, w, h);
    escrever(c, titulo, w / 2, h * 0.1, { tam: h * 0.05, peso: 900, cor: '#2b2118', alinhar: 'center', larguraMax: w * 0.9 });
    c.fillStyle = 'rgba(60,45,30,.35)';
    for (let i = 0; i < 9; i++) c.fillRect(w * 0.1, h * (0.18 + i * 0.045), w * (0.8 - (i % 3) * 0.1), h * 0.012);
    if (clausula) {
      c.fillStyle = `rgba(245,197,24,${0.25 + 0.55 * brilho})`; c.fillRect(w * 0.06, h * 0.6, w * 0.88, h * 0.14);
      c.strokeStyle = corDestaque; c.lineWidth = h * 0.006; c.strokeRect(w * 0.06, h * 0.6, w * 0.88, h * 0.14);
      escrever(c, clausula, w / 2, h * 0.69, { tam: h * 0.045, peso: 900, cor: '#2b2118', alinhar: 'center', larguraMax: w * 0.84 });
    }
    c.fillStyle = 'rgba(60,45,30,.5)'; c.fillRect(w * 0.55, h * 0.88, w * 0.35, h * 0.004);
    if (assinatura) escrever(c, assinatura, w * 0.72, h * 0.86, { tam: h * 0.04, peso: 700, cor: '#1d3a8a', alinhar: 'center', fonte: 'cursive', larguraMax: w * 0.4 });
  }, { pxPorUnidade: 600, emissivo: 0.3 });
  const rolo = () => cilindro(0.045, largura + 0.12, { material: mat.madeira ? mat.madeira('#6b4423') : mat.plastico('#6b4423') });
  const rTopo = rolo(); rTopo.rotation.z = Math.PI / 2; rTopo.position.y = altura / 2; g.add(rTopo);
  const rBase = rolo(); rBase.rotation.z = Math.PI / 2; g.add(rBase);
  const grupoPapel = new THREE.Group(); papel.position.y = -altura / 2; grupoPapel.add(papel); grupoPapel.position.y = altura / 2; g.add(grupoPapel);
  g.userData.abrir = (x) => { const p = Math.max(0.02, clamp(x)); grupoPapel.scale.y = p; rBase.position.y = altura / 2 - altura * p; };
  g.userData.destacar = (x) => { const b = Math.round(clamp(x) * 10) / 10; if (b !== brilho) { brilho = b; papel.userData.atualizar(0, `b${b}`); } };
  g.userData.abrir(1);
  g.userData.enquadramentos = { geral: { pos: [0, 0, distPara(largura + 0.4, 34)], alvo: [0, 0, 0], fov: 34 } };
  return g;
}

// Gol (traves, travessão e rede). Boca para +Z; origem no centro da linha do gol.
export function gol({ largura = 3.0, altura = 1.1, profundidade = 0.9, cor = '#ffffff' } = {}) {
  const g = novo('gol'); const m = mat.plastico(cor);
  for (const sx of [-1, 1]) { const t = cilindro(0.04, altura, { material: m }); t.position.set(sx * largura / 2, altura / 2, 0); sombrear(t); g.add(t); }
  const trav = cilindro(0.04, largura + 0.08, { material: m }); trav.rotation.z = Math.PI / 2; trav.position.set(0, altura, 0); sombrear(trav); g.add(trav);
  const rede = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, wireframe: true });
  const fundo = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura, 16, 8), rede); fundo.position.set(0, altura / 2, -profundidade); g.add(fundo);
  const teto = new THREE.Mesh(new THREE.PlaneGeometry(largura, profundidade, 16, 6), rede); teto.rotation.x = -Math.PI / 2; teto.position.set(0, altura, -profundidade / 2); g.add(teto);
  for (const sx of [-1, 1]) { const lado = new THREE.Mesh(new THREE.PlaneGeometry(profundidade, altura, 6, 8), rede); lado.rotation.y = Math.PI / 2; lado.position.set(sx * largura / 2, altura / 2, -profundidade / 2); g.add(lado); }
  g.userData.enquadramentos = { geral: { pos: [0, altura * 0.9, largura * 1.6], alvo: [0, altura * 0.5, -profundidade / 2], fov: 36 } };
  return g;
}

// ---------------- mascotes ----------------
// Porco (mascote do Palmeiras, ou só um porco): olha para +Z; camisa opcional (cor do time).
// userData.chorar(t) anima lágrimas, soluço e a poça; sem chamar, fica parado (triste ou não, conforme "triste").
export function porco({ cor = '#f4a7b9', camisa = null, escala = 1, triste = true } = {}) {
  const g = novo('porco');
  const mPele = mat.plastico(cor); const mEsc = mat.plastico('#e27d98'); const mPreto = mat.plastico('#16181c');
  const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.32, 28, 20), mPele); corpo.scale.set(1, 1, 1.45); corpo.position.y = 0.42; sombrear(corpo); g.add(corpo);
  if (camisa) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.328, 0.328, 0.44, 28, 1, true), new THREE.MeshStandardMaterial({ color: camisa, roughness: 0.6, side: THREE.DoubleSide })); c.rotation.x = Math.PI / 2; c.position.set(0, 0.42, -0.04); g.add(c); }
  const cab = new THREE.Group(); cab.position.set(0, 0.6, 0.42); g.add(cab);
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.22, 28, 20), mPele); sombrear(cabeca); cab.add(cabeca);
  const focinho = cilindro(0.09, 0.08, { material: mEsc }); focinho.rotation.x = Math.PI / 2; focinho.position.set(0, -0.04, 0.21); cab.add(focinho);
  for (const sx of [-1, 1]) {
    const narina = esfera(0.016, { material: mPreto }); narina.position.set(sx * 0.03, -0.04, 0.255); cab.add(narina);
    const olho = esfera(0.028, { material: mPreto }); olho.position.set(sx * 0.085, 0.06, 0.18); cab.add(olho);
    const sobr = caixa(0.07, 0.012, 0.012, { raio: 0.004, material: mPreto }); sobr.position.set(sx * 0.085, 0.115, 0.185); sobr.rotation.z = triste ? sx * -0.45 : 0; cab.add(sobr);
    const orelha = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 12), mEsc); orelha.position.set(sx * 0.13, 0.17, -0.02); orelha.rotation.set(triste ? 0.9 : 0.2, 0, sx * -0.5); cab.add(orelha);
  }
  if (triste) { const boca = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 16, Math.PI), mPreto); boca.position.set(0, -0.135, 0.185); cab.add(boca); }
  for (const [x, z] of [[-0.16, 0.26], [0.16, 0.26], [-0.16, -0.26], [0.16, -0.26]]) { const perna = cilindro(0.06, 0.26, { material: mPele }); perna.position.set(x, 0.13, z); g.add(perna); }
  const rabo = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 20, Math.PI * 1.6), mPele); rabo.position.set(0, 0.55, -0.47); rabo.rotation.y = Math.PI / 2; g.add(rabo);
  // lágrimas: dois fios de gotas e uma poça no chão
  const mLagrima = new THREE.MeshStandardMaterial({ color: '#59c2ff', emissive: '#2a8fd6', emissiveIntensity: 0.6, roughness: 0.1 });
  const gotas = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mLagrima); d.scale.set(0.8, 1.3, 0.8); g.add(d); gotas.push({ d, sx, k }); }
  const poca = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshStandardMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.55, roughness: 0.05 }));
  poca.rotation.x = -Math.PI / 2; poca.position.set(0, 0.006, 0.72); g.add(poca);
  const olhoMundo = (sx) => new THREE.Vector3(sx * 0.085, 0.6 + 0.06, 0.42 + 0.2);
  g.userData.chorar = (t) => {
    cab.position.y = 0.6 + Math.sin(t * 13) * 0.01; cab.rotation.x = 0.18 + Math.sin(t * 6.5) * 0.04;
    corpo.scale.y = 1 + Math.sin(t * 6.5) * 0.02;
    for (const { d, sx, k } of gotas) {
      const f = (t * 1.3 + k / 5 + (sx > 0 ? 0.1 : 0)) % 1;
      const o = olhoMundo(sx);
      d.position.set(o.x + sx * f * 0.05, o.y - f * 0.62, o.z + 0.03 + f * 0.1);
      d.visible = f < 0.95;
    }
    const s2 = 0.8 + 0.2 * Math.sin(t * 2); poca.scale.set(s2, s2, 1);
  };
  g.userData.chorar(0);
  g.scale.setScalar(escala);
  g.userData.enquadramentos = { geral: { pos: [0.6 * escala, 0.8 * escala, 2.4 * escala], alvo: [0, 0.5 * escala, 0.2 * escala], fov: 34 } };
  return g;
}

// Urubu (mascote do Flamengo): corpo preto, cabeça e pescoço pelados cinza-escuro, bico curvo claro, asas caídas,
// camisa opcional (listras na cor dada + preto) e choro com lágrimas e poça. userData.chorar(t) igual ao porco.
export function urubu({ camisa = null, escala = 1, triste = true } = {}) {
  const g = novo('urubu');
  const mPena = mat.plastico('#16171b'); const mPele = mat.plastico('#4a4d55'); const mBico = mat.plastico('#e6dcc6'); const mOlho = mat.plastico('#f4f4f4'); const mPreto = mat.plastico('#050506'); const mPe = mat.plastico('#8d8a84');
  const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 20), mPena); corpo.scale.set(1, 1.25, 0.95); corpo.position.y = 0.55; sombrear(corpo); g.add(corpo);
  if (camisa) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const x = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#111111' : camisa; x.fillRect(0, i * 8, 64, 8); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.29, 0.36, 28, 1, true), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6, side: THREE.DoubleSide })); c.position.y = 0.52; g.add(c);
  }
  const gola = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.06, 10, 20), mPena); gola.rotation.x = Math.PI / 2; gola.position.y = 0.88; g.add(gola);
  const pesc = cilindro(0.06, 0.16, { material: mPele }); pesc.position.y = 0.95; g.add(pesc);
  const cab = new THREE.Group(); cab.position.set(0, 1.06, 0.04); g.add(cab);
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), mPele); cabeca.scale.set(0.9, 0.95, 1.15); sombrear(cabeca); cab.add(cabeca);
  const bico = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 12), mBico); bico.rotation.x = Math.PI / 2 + 0.5; bico.position.set(0, -0.03, 0.16); cab.add(bico);
  for (const sx of [-1, 1]) {
    const olho = esfera(0.024, { material: mOlho }); olho.position.set(sx * 0.055, 0.03, 0.085); cab.add(olho);
    const pupila = esfera(0.012, { material: mPreto }); pupila.position.set(sx * 0.058, 0.025, 0.105); cab.add(pupila);
    const sobr = caixa(0.05, 0.01, 0.01, { raio: 0.003, material: mPreto }); sobr.position.set(sx * 0.055, 0.07, 0.095); sobr.rotation.z = triste ? sx * -0.5 : 0; cab.add(sobr);
    const asa = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), mPena); asa.scale.set(0.35, 1.1, 0.9); asa.position.set(sx * 0.29, 0.5, -0.02); asa.rotation.z = sx * (triste ? 0.12 : -0.3); g.add(asa);
    const pe = cilindro(0.025, 0.24, { material: mPe }); pe.position.set(sx * 0.1, 0.12, 0.02); g.add(pe);
    const garra = caixa(0.09, 0.02, 0.1, { raio: 0.008, material: mPe }); garra.position.set(sx * 0.1, 0.01, 0.06); g.add(garra);
  }
  const cauda = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 12), mPena); cauda.rotation.x = -2.2; cauda.position.set(0, 0.32, -0.28); g.add(cauda);
  const mLagrima = new THREE.MeshStandardMaterial({ color: '#59c2ff', emissive: '#2a8fd6', emissiveIntensity: 0.6, roughness: 0.1 });
  const gotas = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mLagrima); d.scale.set(0.8, 1.3, 0.8); g.add(d); gotas.push({ d, sx, k }); }
  const poca = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshStandardMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.55, roughness: 0.05 }));
  poca.rotation.x = -Math.PI / 2; poca.position.set(0, 0.006, 0.35); g.add(poca);
  g.userData.chorar = (t) => {
    cab.position.y = 1.06 + Math.sin(t * 13) * 0.008; cab.rotation.x = 0.25 + Math.sin(t * 6.5) * 0.05;
    corpo.scale.y = 1.25 + Math.sin(t * 6.5) * 0.02;
    for (const { d, sx, k } of gotas) {
      const f = (t * 1.3 + k / 5 + (sx > 0 ? 0.1 : 0)) % 1;
      d.position.set(sx * (0.06 + f * 0.04), 1.09 - f * 1.05, 0.15 + f * 0.12);
      d.visible = f < 0.95;
    }
    const s2 = 0.8 + 0.2 * Math.sin(t * 2); poca.scale.set(s2, s2, 1);
  };
  g.userData.chorar(0);
  g.scale.setScalar(escala);
  g.userData.enquadramentos = { geral: { pos: [0.6 * escala, 1.0 * escala, 2.4 * escala], alvo: [0, 0.7 * escala, 0.1 * escala], fov: 34 } };
  return g;
}

// ---------------- aviação ----------------
// Jato executivo (estilo Learjet): fuselagem, asas enflechadas, cauda em T, dois motores traseiros, janelas e para-brisa.
// Frente para +X; ~5 m de comprimento com escala 1. userData.luzes(t) pisca as luzes de navegação.
export function jatoExecutivo({ cor = '#f4f5f7', corFaixa = '#1f3b73', matricula = '', escala = 1 } = {}) {
  const g = novo('jatoExecutivo');
  const mCor = mat.plastico(cor); const mFaixa = mat.plastico(corFaixa);
  const mVidro = new THREE.MeshStandardMaterial({ color: '#1b2533', roughness: 0.1, metalness: 0.5 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 3.6, 8, 24), mCor); fus.rotation.z = Math.PI / 2; fus.position.y = 0.9; sombrear(fus); g.add(fus);
  const nariz = new THREE.Mesh(new THREE.ConeGeometry(0.31, 0.7, 24), mCor); nariz.rotation.z = -Math.PI / 2; nariz.position.set(2.45, 0.86, 0); sombrear(nariz); g.add(nariz);
  const faixa = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 3.4, 24, 1, true), mFaixa); faixa.rotation.z = Math.PI / 2; faixa.position.set(-0.1, 0.84, 0); faixa.scale.set(1, 1, 1); g.add(faixa);
  // para-brisa e janelas
  const brisa = caixa(0.36, 0.14, 0.44, { raio: 0.05, material: mVidro }); brisa.position.set(1.95, 1.08, 0); brisa.rotation.z = -0.5; g.add(brisa);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), mVidro); j.position.set(1.2 - i * 0.42, 0.98, s * 0.315); j.rotation.y = s > 0 ? 0 : Math.PI; g.add(j); }
  // asas enflechadas (forma 2D extrudada)
  const asaForma = new THREE.Shape(); asaForma.moveTo(0, 0); asaForma.lineTo(-0.9, 2.4); asaForma.lineTo(-1.35, 2.4); asaForma.lineTo(-1.1, 0); asaForma.closePath();
  const asaGeo = new THREE.ExtrudeGeometry(asaForma, { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  for (const s of [-1, 1]) {
    const asa = new THREE.Mesh(asaGeo, mCor); asa.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; asa.position.set(0.6, 0.72, 0); asa.scale.z = 1; if (s < 0) asa.scale.y = -1;
    sombrear(asa); g.add(asa);
    const ponta = caixa(0.18, 0.28, 0.04, { raio: 0.01, material: mFaixa }); ponta.position.set(-0.55, 0.86, s * 2.42); g.add(ponta); // winglet
  }
  // motores traseiros
  for (const s of [-1, 1]) {
    const mot = cilindro(0.17, 0.95, { material: mCor }); mot.rotation.z = Math.PI / 2; mot.position.set(-1.35, 1.12, s * 0.55); sombrear(mot); g.add(mot);
    const boca = cilindro(0.13, 0.05, { material: mat.plastico('#2b2f36') }); boca.rotation.z = Math.PI / 2; boca.position.set(-0.86, 1.12, s * 0.55); g.add(boca);
    const pilone = caixa(0.4, 0.06, 0.24, { raio: 0.01, material: mCor }); pilone.position.set(-1.35, 1.02, s * 0.36); g.add(pilone);
  }
  // cauda em T
  const deriva = caixa(0.8, 1.05, 0.08, { raio: 0.03, material: mCor }); deriva.position.set(-2.05, 1.55, 0); deriva.rotation.z = 0.45; sombrear(deriva); g.add(deriva);
  const estab = caixa(0.55, 0.06, 1.7, { raio: 0.02, material: mFaixa }); estab.position.set(-2.4, 2.05, 0); sombrear(estab); g.add(estab);
  if (matricula) { const m = telaCanvas(1.0, 0.18, (c, w, h) => escrever(c, matricula, w / 2, h * 0.78, { tam: h * 0.7, peso: 900, cor: corFaixa, alinhar: 'center' }), { fundo: cor, emissivo: 0.2, pxPorUnidade: 500 }); m.position.set(-0.9, 1.0, 0.322); g.add(m); }
  const luzE = esfera(0.05, { material: mat.emissivo('#ff3344', 2) }); luzE.position.set(-0.55, 0.9, 2.46); g.add(luzE);
  const luzD = esfera(0.05, { material: mat.emissivo('#33ff77', 2) }); luzD.position.set(-0.55, 0.9, -2.46); g.add(luzD);
  g.userData.luzes = (t) => { const on = (t * 1.2) % 1 < 0.15; luzE.visible = on; luzD.visible = on; };
  g.scale.setScalar(escala);
  g.userData.enquadramentos = { geral: { pos: [3.5 * escala, 2.2 * escala, 6.5 * escala], alvo: [0, 1 * escala, 0], fov: 36 }, lado: { pos: [0, 1.2 * escala, 7 * escala], alvo: [0, 1 * escala, 0], fov: 34 } };
  return g;
}

// Perfil de asa (corte) num túnel de vento.
// userData.gelo(x 0–1): camada FINA e áspera (grãos pequenos, como lixa) que cresce do bordo de ataque para trás.
// userData.vento(t, descolado 0–1): linhas de vento que contornam o perfil; no estol descolam do extradorso com redemoinhos.
// userData.forcas(sustentacao 0–1, arrasto 0–1): setas verde (para cima) e vermelha (para trás) com rótulo.
export function perfilAsa({ corda = 2.4, cor = '#d8dde4', corGelo = '#eef7ff' } = {}) {
  const g = novo('perfilAsa');
  const mix = (a, b, k) => a + (b - a) * k;
  const espessura = 0.12 * corda;
  const yt = (u) => { u = Math.min(1, Math.max(0, u)); return 5 * 0.12 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4); };
  const sup = (u) => yt(u) * corda * 1.4 + espessura * 0.15;
  const inf = (u) => -yt(u) * corda * 0.6;
  const X = (u) => u * corda - corda / 2;
  const forma = new THREE.Shape();
  const N = 60;
  forma.moveTo(X(0), inf(0));
  for (let i = 0; i <= N; i++) { const u = (i / N) ** 1.6; forma.lineTo(X(u), sup(u)); }
  for (let i = N; i >= 0; i--) { const u = (i / N) ** 1.6; forma.lineTo(X(u), inf(u)); }
  const asa = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 0.8, bevelEnabled: false }), mat.plastico(cor)); asa.position.z = -0.4; sombrear(asa); g.add(asa);

  // ---- gelo: grãos pequenos espalhados no bordo de ataque e na frente do extradorso (camada fina, tipo lixa)
  const normalEm = (us) => {
    const u = Math.abs(us); const e = 0.003; const f = us >= 0 ? sup : inf;
    const dx = X(u + e) - X(u); const dy = f(u + e) - f(u);
    const nx = us >= 0 ? -dy : dy; const ny = us >= 0 ? dx : -dx; const L = Math.hypot(nx, ny) || 1;
    return [nx / L, ny / L];
  };
  const NG = 460; const rnd = mulberry32(3);
  const mGelo = new THREE.MeshStandardMaterial({ color: corGelo, roughness: 0.5, metalness: 0, emissive: '#bfe0ff', emissiveIntensity: 0.22 });
  const gelo = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mGelo, NG); g.add(gelo);
  const graos = [];
  for (let i = 0; i < NG; i++) {
    let us = 0; let px; let py; let nx; let ny;
    if (rnd() < 0.1) { px = X(0); py = sup(0) * rnd(); nx = -1; ny = 0; }
    else {
      us = rnd() < 0.24 ? -0.07 * Math.pow(rnd(), 1.4) : 0.3 * Math.pow(rnd(), 1.5);
      const u = Math.abs(us); px = X(u); py = us >= 0 ? sup(u) : inf(u); [nx, ny] = normalEm(us);
    }
    const raio = 0.011 + rnd() * 0.013;
    graos.push({ x: px + nx * raio * 0.3, y: py + ny * raio * 0.3, z: (rnd() - 0.5) * 0.78, raio, limiar: Math.min(0.85, (Math.abs(us) / 0.3) * 0.7 + rnd() * 0.18) });
  }
  const tmp = new THREE.Object3D();
  g.userData.gelo = (x) => {
    graos.forEach((gr, i) => { const k = Math.min(1, Math.max(0, (x - gr.limiar) / 0.12)); tmp.position.set(gr.x, gr.y, gr.z); tmp.scale.setScalar(Math.max(1e-4, gr.raio * k)); tmp.updateMatrix(); gelo.setMatrixAt(i, tmp.matrix); });
    gelo.instanceMatrix.needsUpdate = true; gelo.visible = x > 0.01;
  };

  // ---- linhas de vento que contornam o perfil (por cima e por baixo)
  const mVento = new THREE.MeshStandardMaterial({ color: '#7cc4ff', emissive: '#3b8fd9', emissiveIntensity: 0.8, roughness: 0.4 });
  const mRedemoinho = new THREE.MeshStandardMaterial({ color: '#c3e6ff', emissive: '#5aa9ef', emissiveIntensity: 0.9, roughness: 0.4 });
  const offs = [0.07, 0.17, 0.29, 0.43, 0.6, -0.09, -0.21, -0.36, -0.53];
  const fios = offs.map(() => { const m = new THREE.Mesh(new THREE.BufferGeometry(), mVento); g.add(m); return m; });
  const Dsup = (x) => { const u = (x + corda / 2) / corda; if (u < 0) return sup(0) * Math.exp(-(((x - X(0)) / 0.18) ** 2)); if (u > 1) return sup(1) * Math.exp(-(((x - X(1)) / 0.35) ** 2)); return sup(u); };
  const Dinf = (x) => { const u = (x + corda / 2) / corda; return u < 0 || u > 1 ? 0 : inf(u); };
  const yColado = (x, y0) => {
    const w = Math.exp(-Math.abs(y0) / 0.38); const u = (x + corda / 2) / corda;
    if (y0 >= 0) { let y = y0 + w * Dsup(x); if (u >= 0 && u <= 1) y = Math.max(y, sup(u) + 0.03); return y; }
    let y = y0 + w * Dinf(x); if (u >= 0 && u <= 1) y = Math.min(y, inf(u) - 0.03); return y;
  };
  const redemoinhos = [0, 1, 2].map(() => {
    const pts = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 3.2; const r = 0.025 + (i / 40) * 0.07; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.009, 5, false), mRedemoinho); g.add(m); return m;
  });
  let ultimo = null;
  g.userData.vento = (t, descolado = 0) => {
    const d = Math.min(1, Math.max(0, descolado));
    const chave = `${Math.round(t * 24)}:${Math.round(d * 40)}`; if (chave === ultimo) return; ultimo = chave;
    const xSep = mix(X(1), X(0.36), d); // o descolamento anda do bordo de fuga para a frente
    fios.forEach((m, k) => {
      const y0 = offs[k]; const pts3 = []; const ySep = yColado(xSep, y0);
      const inclin = (ySep - yColado(xSep - 0.05, y0)) / 0.05; const w = Math.exp(-Math.abs(y0) / 0.38);
      for (let i = 0; i <= 90; i++) {
        const x = -corda * 0.95 + (i / 90) * corda * 2.0;
        let y = yColado(x, y0);
        if (d > 0.01 && y0 > 0 && x > xSep) {
          const dist = x - xSep;
          const solto = ySep + Math.max(0, inclin) * dist * 0.4 + 0.05 * d * w * Math.min(1, dist / 0.4);
          y = mix(y, solto, Math.min(1, d * 1.4) * w + (1 - w) * 0.3 * d) + Math.sin(x * 11 - t * 9 + k * 1.7) * (0.012 + 0.05 * d * w) * Math.min(1, dist / 0.5);
        }
        pts3.push(new THREE.Vector3(x, y, 0.42));
      }
      m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), 140, 0.012, 6, false);
    });
    redemoinhos.forEach((r, k) => {
      const u = mix(0.6, 0.92, k / 2); const x = X(u);
      r.visible = d > 0.08 && x > xSep + 0.1;
      r.position.set(x, sup(u) + 0.08 + k * 0.012, 0.43);
      r.rotation.z = -t * (4 + k); r.scale.setScalar(Math.max(0.001, d) * (1 + 0.25 * k));
    });
  };

  // ---- forças: sustentação (verde, para cima) e arrasto (vermelha, para trás), saindo do centro aerodinâmico
  const seta = (corS) => {
    const st = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: corS, emissive: corS, emissiveIntensity: 0.55, roughness: 0.4 });
    const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 14), m); const ponta = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 18), m);
    st.add(haste, ponta);
    st.userData.comprimento = (L) => { st.visible = L > 0.02; haste.scale.y = Math.max(0.001, L); haste.position.y = L / 2; ponta.position.y = L + 0.085; };
    return st;
  };
  const O = [X(0.25), (sup(0.25) + inf(0.25)) / 2, 0.47];
  const setaS = seta('#22c55e'); setaS.position.set(O[0], O[1], O[2]); g.add(setaS);
  const setaA = seta('#ef4444'); setaA.position.set(O[0], O[1], O[2]); setaA.rotation.z = -Math.PI / 2; g.add(setaA);
  const placa = (texto, corT, larg) => { const pl = telaCanvas(larg, 0.15, (c, w, h) => { c.fillStyle = 'rgba(10,14,22,0.85)'; c.fillRect(0, 0, w, h); escrever(c, texto, w / 2, h * 0.7, { tam: h * 0.55, peso: 900, cor: corT, alinhar: 'center', larguraMax: w * 0.92 }); }, { pxPorUnidade: 700, emissivo: 0.6 }); g.add(pl); return pl; };
  const rotS = placa('SUSTENTAÇÃO', '#4ade80', 0.95); const rotA = placa('ARRASTO', '#f87171', 0.7);
  g.userData.forcas = (sust = 0, arr = 0) => {
    const Ls = 1.05 * sust; const La = 0.85 * arr;
    setaS.userData.comprimento(Ls); setaA.userData.comprimento(La);
    rotS.visible = sust > 0.02; rotS.position.set(O[0] + 0.62, O[1] + Math.max(0.3, Ls * 0.75), 0.5);
    rotA.visible = arr > 0.02; rotA.position.set(O[0] + Math.max(0.38, La * 0.62), O[1] - 0.2, 0.5);
  };
  g.userData.gelo(0); g.userData.vento(0, 0); g.userData.forcas(0, 0);
  g.userData.enquadramentos = { geral: { pos: [0, 0.3, 3.6], alvo: [0, 0, 0], fov: 36 } };
  return g;
}

// Mapa plano com rota: desenhar(c, w, h) pinta o mapa; rota = [[u, v], ...] em 0–1 do mapa (u→x, v→z).
// userData.revelar(x 0–1) desenha a linha da rota; userData.pontoRota(x) → Vector3 (mundo) para pôr um avião/marcador.
export function mapaRota({ largura = 6, altura = 4, desenhar = null, rota = [], corRota = '#ff5a3c' } = {}) {
  const g = novo('mapaRota');
  const base = telaCanvas(largura, altura, (c, w, h) => { c.fillStyle = '#2f6fa8'; c.fillRect(0, 0, w, h); desenhar?.(c, w, h); }, { pxPorUnidade: 180, emissivo: 0.25 });
  base.rotation.x = -Math.PI / 2; base.position.y = 0.01; g.add(base);
  const moldura = caixa(largura + 0.2, 0.12, altura + 0.2, { raio: 0.03, material: mat.madeira ? mat.madeira('#6b4423') : mat.plastico('#6b4423') }); moldura.position.y = -0.08; g.add(moldura); // topo abaixo do mapa (sem z-fighting)
  const p3 = rota.map(([u, v]) => new THREE.Vector3((u - 0.5) * largura, 0.06, (v - 0.5) * altura));
  let curva = null; let tuboRota = null;
  if (p3.length > 1) {
    curva = new THREE.CatmullRomCurve3(p3);
    tuboRota = new THREE.Mesh(new THREE.TubeGeometry(curva, 120, 0.025, 6, false), new THREE.MeshStandardMaterial({ color: corRota, emissive: corRota, emissiveIntensity: 0.6 }));
    g.add(tuboRota);
  }
  g.userData.revelar = (x) => { if (!tuboRota) return; const total = tuboRota.geometry.index.count; tuboRota.geometry.setDrawRange(0, Math.floor((total * clamp(x)) / 6) * 6); };
  g.userData.pontoRota = (x) => { const v = curva ? curva.getPoint(clamp(x)) : new THREE.Vector3(); return g.localToWorld(v.clone()); };
  g.userData.paraMundo = (u, v, y = 0.06) => g.localToWorld(new THREE.Vector3((u - 0.5) * largura, y, (v - 0.5) * altura));
  g.userData.enquadramentos = { geral: { pos: [0, Math.max(largura, altura) * 1.1, altura * 0.9], alvo: [0, 0, 0], fov: 38 } };
  return g;
}

// Nuvem de tempestade (cúmulo-nimbo) com raios que piscam no tempo: userData.raios(t).
export function nuvemTempestade({ escala = 1, cor = '#4a5260', semente = 2, chuva = true } = {}) {
  const g = novo('nuvemTempestade'); const rnd = mulberry32(semente);
  const mBase = new THREE.MeshStandardMaterial({ color: '#2f353f', roughness: 0.95 });
  const mTopo = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.95 });
  for (let i = 0; i < 22; i++) { const r = 0.5 + rnd() * 0.65; const e = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), i < 9 ? mBase : mTopo); e.position.set((rnd() - 0.5) * 2.8, 1.15 + (i < 9 ? rnd() * 0.5 : 0.7 + rnd() * 1.9), (rnd() - 0.5) * 1.6); g.add(e); }
  const bigorna = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.3, 0.55, 28), mTopo); bigorna.position.y = 3.55; g.add(bigorna);
  // raios: núcleo brilhante + halo, e uma luz dentro da nuvem que acende junto (clarão)
  const mRaio = mat.emissivo('#fff6c2', 3.2);
  const mHalo = new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0.35, depthWrite: false });
  const raios = [];
  for (let k = 0; k < 3; k++) {
    const pts3 = []; let x = (rnd() - 0.5) * 1.6; let y = 1.05; const z = 0.55 + rnd() * 0.3;
    for (let i = 0; i < 8; i++) { pts3.push(new THREE.Vector3(x, y, z)); x += (rnd() - 0.5) * 0.55; y -= 0.34; }
    const curva = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0);
    const raio = new THREE.Group();
    raio.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 32, 0.045, 6, false), mRaio));
    raio.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 32, 0.14, 6, false), mHalo));
    g.add(raio); raios.push(raio);
  }
  const luz = new THREE.PointLight('#dfe8ff', 0, 16, 1.4); luz.position.set(0, 1.5, 1.2); g.add(luz);
  // chuva: riscos finos caindo da base da nuvem
  const NC = chuva ? 240 : 0;
  const gotas = NC ? new THREE.InstancedMesh(new THREE.CylinderGeometry(0.007, 0.007, 0.36, 4), new THREE.MeshBasicMaterial({ color: '#a9b8cc', transparent: true, opacity: 0.55 }), NC) : null;
  const dadosC = [];
  for (let i = 0; i < NC; i++) dadosC.push({ x: (rnd() - 0.5) * 3.0, z: (rnd() - 0.5) * 1.8, fase: rnd() * 3.8, v: 4.5 + rnd() * 1.5 });
  if (gotas) g.add(gotas);
  const tmp = new THREE.Object3D();
  // raios(t, forcar): pisca os raios (forcar = clarão agora, ex.: na palavra) e anima a chuva; devolve 1 no clarão
  g.userData.raios = (t, forcar = false) => {
    let clarao = 0;
    raios.forEach((r, k) => { const f = (t * 0.9 + k * 0.37) % 1; const on = f < 0.07 || (forcar && k === 0); r.visible = on; if (on) clarao = 1; });
    luz.intensity = clarao * 25;
    if (gotas) {
      dadosC.forEach((d, i) => { const y = 1.0 - ((t * d.v + d.fase) % 3.8); tmp.position.set(d.x + y * 0.06, y, d.z); tmp.rotation.z = 0.06; tmp.updateMatrix(); gotas.setMatrixAt(i, tmp.matrix); });
      gotas.instanceMatrix.needsUpdate = true;
    }
    return clarao;
  };
  g.userData.raios(0);
  g.scale.setScalar(escala);
  return g;
}

// Marcador amarelo de evidência (tenda numerada), como nas cenas de investigação.
export function marcadorEvidencia(numero = 1, { escala = 1 } = {}) {
  const g = novo('marcadorEvidencia');
  const forma = new THREE.Shape(); forma.moveTo(-0.08, 0); forma.lineTo(0.08, 0); forma.lineTo(0, 0.14); forma.closePath();
  const geo = new THREE.ExtrudeGeometry(forma, { depth: 0.1, bevelEnabled: false }); geo.translate(0, 0, -0.05);
  const tenda = new THREE.Mesh(geo, mat.plastico('#f5c518')); sombrear(tenda); g.add(tenda);
  const n = placaNumero(String(numero), { fundo: 'rgba(0,0,0,0)', cor: '#111111', l: 0.08, a: 0.07 }); n.position.set(0, 0.055, 0.052); g.add(n);
  g.scale.setScalar(escala);
  return g;
}

// Painel de instrumentos de avião: altímetro (ponteiro + pés), faixa de velocidade e luz de emergência.
// userData.estado(t, { altitude (pés), velocidade (nós), excesso (bool), emergencia (bool) }) redesenha quando muda.
export function painelAviao({ largura = 1.6, altura = 0.9, numeros = true } = {}) {
  const g = novo('painelAviao');
  const caixaP = caixa(largura + 0.1, altura + 0.1, 0.12, { raio: 0.03, cor: '#1a1d22' }); caixaP.position.z = -0.07; g.add(caixaP);
  let est = { altitude: 35000, velocidade: 250, excesso: false, emergencia: false, pisca: false };
  const tela = telaCanvas(largura, altura, (c, w, h) => {
    c.fillStyle = '#0e1116'; c.fillRect(0, 0, w, h);
    // altímetro
    const cx = w * 0.3, cy = h * 0.52, r = h * 0.36;
    c.fillStyle = '#1c2029'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8ecf1'; c.lineWidth = h * 0.01;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); c.lineTo(cx + Math.cos(a) * r * 0.96, cy + Math.sin(a) * r * 0.96); c.stroke(); escrever(c, String(i), cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66 + h * 0.02, { tam: h * 0.06, peso: 800, cor: '#e8ecf1', alinhar: 'center' }); }
    const ang = ((est.altitude % 1000) / 1000) * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = '#ffffff'; c.lineWidth = h * 0.018; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang) * r * 0.78, cy + Math.sin(ang) * r * 0.78); c.stroke();
    escrever(c, numeros ? `${Math.round(est.altitude).toLocaleString('pt-BR')} pés` : 'ALTÍMETRO', cx, cy + r + h * 0.1, { tam: h * 0.07, peso: 900, cor: '#ffffff', alinhar: 'center' });
    // velocidade
    c.fillStyle = est.excesso ? '#b91c1c' : '#1c2029'; c.fillRect(w * 0.62, h * 0.18, w * 0.3, h * 0.26);
    if (numeros) {
      escrever(c, `${Math.round(est.velocidade)} nós`, w * 0.77, h * 0.36, { tam: h * 0.08, peso: 900, cor: '#ffffff', alinhar: 'center' });
      if (est.excesso) escrever(c, 'OVERSPEED', w * 0.77, h * 0.24, { tam: h * 0.05, peso: 900, cor: '#ffffff', alinhar: 'center' });
    } else {
      escrever(c, 'VELOCIDADE', w * 0.77, h * 0.255, { tam: h * 0.045, peso: 800, cor: est.excesso ? '#ffd5d5' : '#8b93a3', alinhar: 'center' });
      escrever(c, est.excesso ? 'EXCESSO' : 'NORMAL', w * 0.77, h * 0.375, { tam: h * 0.075, peso: 900, cor: '#ffffff', alinhar: 'center' });
    }
    // emergência
    c.fillStyle = est.emergencia ? (est.pisca ? '#ff2b2b' : '#7a1010') : '#2a2f38'; c.fillRect(w * 0.62, h * 0.56, w * 0.3, h * 0.22);
    escrever(c, 'EMERGÊNCIA', w * 0.77, h * 0.7, { tam: h * 0.06, peso: 900, cor: est.emergencia ? '#ffffff' : '#5b6170', alinhar: 'center' });
  }, { pxPorUnidade: 700, emissivo: 0.9, fundo: '#0e1116' });
  g.add(tela);
  g.userData.estado = (t, novoEst) => {
    est = { ...est, ...novoEst, pisca: Boolean(novoEst.emergencia) && (t * 3) % 1 < 0.5 };
    tela.userData.atualizar(t, `${Math.round(est.altitude / 50)}:${Math.round(est.velocidade)}:${est.excesso}:${est.emergencia}:${est.pisca}`);
  };
  g.userData.enquadramentos = { geral: { pos: [0, 0, distPara(largura + 0.3, 34)], alvo: [0, 0, 0], fov: 34 } };
  return g;
}
