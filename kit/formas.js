// kit/formas.js — objetos feitos de primitivas, no visual "maquete limpa" do estilo diorama.
// Tudo devolve THREE.Group/Mesh pronto para posicionar. Cores vêm da paleta (window.REEL.paleta).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { texturaMadeira } from './palco.js';
import { mulberry32 } from './nucleo.js';

const pal = () => window.REEL?.paleta || {};

// ---------- materiais ----------
export const mat = {
  fosco: (cor, extra = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85, metalness: 0, ...extra }),
  plastico: (cor, extra = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.42, metalness: 0, ...extra }),
  metal: (cor, extra = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.38, metalness: 0.65, ...extra }),
  emissivo: (cor, intensidade = 1.2) => new THREE.MeshStandardMaterial({ color: cor, emissive: cor, emissiveIntensity: intensidade, roughness: 0.6 }),
  // "raio-x": casca translúcida azulada que deixa ver o interior
  raioX: (cor = '#cfe6ff', opacidade = 0.22) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.15, metalness: 0, transparent: true, opacity: opacidade, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }),
  madeira: (cor) => new THREE.MeshStandardMaterial({ map: texturaMadeira(cor || pal().madeira || '#c9965d'), roughness: 0.7 }),
};

export function sombrear(obj, lanca = true, recebe = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = lanca; o.receiveShadow = recebe; } });
  return obj;
}

// ---------- primitivas ----------
export function caixa(l, a, p, { raio = 0.03, cor = '#f4f2ee', material = null, segs = 4 } = {}) {
  const r = Math.min(raio, l / 2 - 1e-3, a / 2 - 1e-3, p / 2 - 1e-3);
  const m = new THREE.Mesh(new RoundedBoxGeometry(l, a, p, segs, Math.max(0.001, r)), material || mat.plastico(cor));
  return sombrear(m);
}
export function cilindro(r, a, { cor = '#888', material = null, segs = 32, rTopo = null } = {}) {
  return sombrear(new THREE.Mesh(new THREE.CylinderGeometry(rTopo ?? r, r, a, segs), material || mat.plastico(cor)));
}
export function esfera(r, { cor = '#ccc', material = null, segs = 32 } = {}) {
  return sombrear(new THREE.Mesh(new THREE.SphereGeometry(r, segs, Math.max(12, segs / 2)), material || mat.plastico(cor)));
}
export function capsula(r, comp, { cor = '#ccc', material = null } = {}) {
  return sombrear(new THREE.Mesh(new THREE.CapsuleGeometry(r, comp, 8, 20), material || mat.plastico(cor)));
}
export function tubo(pontos, raio = 0.015, { cor = '#1f2228', material = null, segmentos = 64 } = {}) {
  const curva = new THREE.CatmullRomCurve3(pontos.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  return sombrear(new THREE.Mesh(new THREE.TubeGeometry(curva, segmentos, raio, 10, false), material || mat.fosco(cor)));
}

// ---------- telas e textos (canvas por quadro) ----------
// desenhar(ctx, w, h, t) é chamado a cada atualizar(t). Use para telas, placas, lousas, calendários.
export function telaCanvas(l, a, desenhar, { pxPorUnidade = 900, emissivo = 0.9, fundo = '#e8ebe6' } = {}) {
  const w = Math.max(64, Math.round(l * pxPorUnidade)); const h = Math.max(64, Math.round(a * pxPorUnidade));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(l, a), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: emissivo, roughness: 0.55 }));
  let ultimo = null;
  m.userData.atualizar = (t, chave = null) => {
    // redesenha só quando a "chave" muda (economiza tempo de render)
    const k = chave ?? t;
    if (k === ultimo) return;
    ultimo = k;
    g.save(); g.fillStyle = fundo; g.fillRect(0, 0, w, h); desenhar(g, w, h, t); g.restore();
    tex.needsUpdate = true;
  };
  m.userData.atualizar(0, '__inicial__');
  return m;
}

export function placaTexto(texto, { largura = 1.2, altura = 0.3, cor = '#1d2026', fundo = '#ffffff', fonte = '800 120px Inter, Arial, sans-serif', raio = 0.04 } = {}) {
  const tela = telaCanvas(largura, altura, (g, w, h) => {
    g.fillStyle = cor; g.font = fonte.replace(/\d+px/, `${Math.round(h * 0.55)}px`);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(texto, w / 2, h / 2 + h * 0.03);
  }, { fundo, emissivo: 0.25 });
  return tela;
}

// ---------- móveis e cenário ----------
export function mesa({ largura = 1.2, profundidade = 0.7, altura = 0.75, tampo = null, pes = null } = {}) {
  const P = pal();
  const g = new THREE.Group();
  const t = caixa(largura, 0.05, profundidade, { raio: 0.012, material: mat.madeira(tampo || P.madeira) });
  t.position.y = altura - 0.025; g.add(t);
  const corPe = pes || P.metal || '#2f6b4f';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pe = cilindro(0.018, altura - 0.05, { material: mat.metal(corPe) });
    pe.position.set(sx * (largura / 2 - 0.06), (altura - 0.05) / 2, sz * (profundidade / 2 - 0.06));
    g.add(pe);
  }
  const trave = caixa(largura - 0.12, 0.02, 0.02, { raio: 0.005, material: mat.metal(corPe) });
  trave.position.set(0, 0.18, -(profundidade / 2 - 0.06)); g.add(trave);
  g.userData.tampoY = altura;
  return g;
}

export function cadeira({ cor = null, altura = 0.45 } = {}) {
  const P = pal();
  const g = new THREE.Group();
  const assento = caixa(0.42, 0.04, 0.4, { raio: 0.01, material: mat.madeira(P.madeira) }); assento.position.y = altura; g.add(assento);
  const encosto = caixa(0.42, 0.22, 0.03, { raio: 0.01, material: mat.madeira(P.madeira) }); encosto.position.set(0, altura + 0.3, -0.19); g.add(encosto);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pe = cilindro(0.012, altura, { material: mat.metal(cor || P.metal) }); pe.position.set(sx * 0.18, altura / 2, sz * 0.17); g.add(pe);
  }
  for (const sx of [-1, 1]) { const h = cilindro(0.012, 0.36, { material: mat.metal(cor || P.metal) }); h.position.set(sx * 0.18, altura + 0.18, -0.19); g.add(h); }
  return g;
}

export function parede({ largura = 8, altura = 3, cor = null, lambri = true, corLambri = null } = {}) {
  const P = pal();
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura), mat.fosco(cor || P.parede || '#f1e6d2'));
  p.position.y = altura / 2; p.receiveShadow = true; g.add(p);
  if (lambri) {
    const n = Math.round(largura / 0.12);
    const corL = corLambri || P.lambri || '#c98b55';
    const geo = []; const base = new THREE.BoxGeometry(0.105, 1.0, 0.02);
    for (let i = 0; i < n; i++) { const b = base.clone(); b.translate(-largura / 2 + 0.06 + i * 0.12, 0.5, 0.012); geo.push(b); }
    const l = new THREE.Mesh(mergeGeometries(geo), mat.madeira(corL));
    l.receiveShadow = true; g.add(l);
  }
  return g;
}

export function quadroNegro(desenhar = null, { largura = 2.4, altura = 1.2 } = {}) {
  const P = pal();
  const g = new THREE.Group();
  const moldura = caixa(largura + 0.08, altura + 0.08, 0.04, { raio: 0.01, material: mat.madeira(P.madeira_escura || '#8a5a32') }); g.add(moldura);
  const tela = telaCanvas(largura, altura, (c, w, h, t) => {
    c.fillStyle = P.quadro || '#2e5e45'; c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.08; c.fillStyle = '#fff';
    for (let i = 0; i < 60; i++) c.fillRect((i * 97) % w, (i * 53) % h, 120, 2);
    c.globalAlpha = 1;
    if (desenhar) desenhar(c, w, h, t);
  }, { emissivo: 0.15, fundo: P.quadro || '#2e5e45' });
  tela.position.z = 0.022; g.add(tela);
  g.userData.tela = tela;
  return g;
}

export function bandeira(desenhar, { largura = 0.6, altura = 0.4, mastro = 1.4 } = {}) {
  const g = new THREE.Group();
  const m = cilindro(0.012, mastro, { cor: '#c9c9c9', material: mat.metal('#bdbdbd') }); m.position.y = mastro / 2; g.add(m);
  const bola = esfera(0.022, { material: mat.metal('#d4b26a') }); bola.position.y = mastro + 0.02; g.add(bola);
  const base = cilindro(0.12, 0.03, { material: mat.metal('#2a2d33') }); base.position.y = 0.015; g.add(base);
  const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  desenhar(c.getContext('2d'), 600, 400);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(largura, altura, 24, 6);
  const pano = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  pano.position.set(largura / 2 + 0.012, mastro - altura / 2 - 0.04, 0);
  pano.castShadow = true;
  g.add(pano);
  const pos = geo.attributes.position; const orig = pos.array.slice();
  g.userData.tremular = (t) => {
    for (let i = 0; i < pos.count; i++) {
      const x = orig[i * 3] + largura / 2;
      pos.array[i * 3 + 2] = Math.sin(x * 9 - t * 6) * 0.025 * (x / largura);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  };
  return g;
}

export function calendario(numeroFn, { largura = 0.5, altura = 0.42, cabecalho = 'DIA', corCab = null } = {}) {
  const P = pal();
  const g = new THREE.Group();
  const base = caixa(largura + 0.04, altura + 0.04, 0.08, { raio: 0.02, material: mat.madeira(P.madeira) }); base.position.z = -0.05; g.add(base);
  const tela = telaCanvas(largura, altura, (c, w, h, t) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = corCab || P.acento?.vermelho || '#ff4d4d'; c.fillRect(0, 0, w, h * 0.24);
    c.fillStyle = '#fff'; c.font = `900 ${Math.round(h * 0.15)}px Inter, Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(cabecalho, w / 2, h * 0.125);
    c.fillStyle = '#23262c'; c.font = `900 ${Math.round(h * 0.52)}px Inter, Arial`;
    c.fillText(String(numeroFn(t)), w / 2, h * 0.63);
  }, { emissivo: 0.2, fundo: '#ffffff' });
  g.add(tela);
  g.userData.tela = tela;
  return g;
}

// Placa de circuito verde com trilhas e chips (para "abrir" aparelhos por dentro).
export function placaCircuito({ largura = 1.0, profundidade = 0.7, chips = 4, semente = 4 } = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(semente);
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * profundidade / largura);
  const x = c.getContext('2d');
  x.fillStyle = '#2f8f5b'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#d8e86a'; x.lineWidth = 3; x.globalAlpha = 0.85;
  for (let i = 0; i < 70; i++) {
    let px = rnd() * c.width, py = rnd() * c.height;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 4; k++) { if (rnd() < 0.5) px += (rnd() - 0.5) * 300; else py += (rnd() - 0.5) * 300; x.lineTo(px, py); }
    x.stroke();
    x.fillStyle = '#e8d07a'; x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const placa = new THREE.Mesh(new RoundedBoxGeometry(largura, 0.02, profundidade, 2, 0.006), [
    mat.plastico('#2f8f5b'), mat.plastico('#2f8f5b'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), mat.plastico('#2f8f5b'), mat.plastico('#2f8f5b'), mat.plastico('#2f8f5b'),
  ]);
  sombrear(placa); g.add(placa);
  g.userData.chips = [];
  for (let i = 0; i < chips; i++) {
    const s = 0.08 + rnd() * 0.08;
    const ch = caixa(s, 0.025, s, { raio: 0.004, cor: '#1c1f24' });
    ch.position.set((rnd() - 0.5) * largura * 0.7, 0.022, (rnd() - 0.5) * profundidade * 0.7);
    g.add(ch); g.userData.chips.push(ch);
  }
  const dissipador = new THREE.Group();
  for (let i = 0; i < 9; i++) { const a = caixa(0.012, 0.07, 0.16, { raio: 0.002, material: mat.metal('#9aa3ad') }); a.position.set(-0.07 + i * 0.018, 0.045, 0); dissipador.add(a); }
  dissipador.position.set(largura * 0.28, 0, -profundidade * 0.18); g.add(dissipador);
  return g;
}

// Tecla/botão com rótulo (teclados, painéis).
export function botao(rotulo = '', { l = 0.07, a = 0.025, p = 0.06, cor = '#2a2d33', corTexto = '#ffffff' } = {}) {
  const g = new THREE.Group();
  const b = caixa(l, a, p, { raio: 0.008, cor }); g.add(b);
  if (rotulo) {
    const t = placaTexto(rotulo, { largura: l * 0.9, altura: p * 0.6, cor: corTexto, fundo: cor });
    t.rotation.x = -Math.PI / 2; t.position.y = a / 2 + 0.0015; g.add(t);
  }
  return g;
}

// ---------- multiplicação em massa (escala: "500 mil") ----------
// Funde um objeto composto numa geometria só (cores por vértice) e instancia N cópias numa grade.
export function mesclar(obj) {
  obj.updateMatrixWorld(true);
  const geos = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const cor = (m.color || new THREE.Color('#ccc')).clone();
    if (m.map && !m.color) cor.set('#cccccc');
    const n = g.attributes.position.count;
    const cores = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cores[i * 3] = cor.r; cores[i * 3 + 1] = cor.g; cores[i * 3 + 2] = cor.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  return mergeGeometries(geos);
}
export function grade(obj, { nx = 10, nz = 10, dx = 1.6, dz = 1.6, origem = [0, 0, 0], jitter = 0.04, semente = 2 } = {}) {
  const geo = mesclar(obj);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const inst = new THREE.InstancedMesh(geo, material, nx * nz);
  const rnd = mulberry32(semente); const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion();
  let k = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = new THREE.Vector3(origem[0] + (i - (nx - 1) / 2) * dx + (rnd() - 0.5) * jitter, origem[1], origem[2] - j * dz + (rnd() - 0.5) * jitter);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * jitter);
    m4.compose(p, q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(k++, m4);
  }
  inst.castShadow = true; inst.receiveShadow = true;
  return inst;
}

// Revela N instâncias progressivamente (ex.: urnas aparecendo até o horizonte).
export function revelarGrade(inst, fracao) {
  inst.count = Math.max(0, Math.min(inst.instanceMatrix.count, Math.round(inst.instanceMatrix.count * fracao)));
}

// Liga/desliga "raio-x" num objeto: casca translúcida (os filhos marcados com userData.miolo continuam opacos).
export function raioX(obj, ligado, opacidade = 0.22) {
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.miolo) return;
    if (!o.userData.matOriginal) o.userData.matOriginal = o.material;
    o.material = ligado ? (o.userData.matRaioX ||= mat.raioX('#d6ebff', opacidade)) : o.userData.matOriginal;
    o.castShadow = !ligado;
  });
}
