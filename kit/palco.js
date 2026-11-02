// kit/palco.js — renderer, cena, luz, céu, piso e pós-processamento (desfoque de profundidade).
// Visual de referência: dia claro e difuso, sombras suaves, fundo desfocado (como uma maquete fotografada).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePost } from 'lemo/post.js';
import { mulberry32 } from './nucleo.js';

export function texturaGradiente(cores, alto = 512) {
  const c = document.createElement('canvas'); c.width = 4; c.height = alto;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, alto);
  cores.forEach((cor, i) => gr.addColorStop(i / Math.max(1, cores.length - 1), cor));
  g.fillStyle = gr; g.fillRect(0, 0, 4, alto);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function texturaTerrazzo(cores, { base = '#ece6dc', tamanho = 1024, pontos = 2600, semente = 3 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = tamanho;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, tamanho, tamanho);
  const rnd = mulberry32(semente);
  for (let i = 0; i < pontos; i++) {
    const x = rnd() * tamanho, y = rnd() * tamanho;
    const r = 1.2 + rnd() ** 3 * 7;
    g.fillStyle = cores[Math.floor(rnd() * cores.length)];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.beginPath();
    const lados = 5 + Math.floor(rnd() * 3);
    for (let k = 0; k < lados; k++) {
      const a = (k / lados) * Math.PI * 2 + rnd() * 0.6;
      const rr = r * (0.6 + rnd() * 0.6);
      k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function texturaMadeira(cor = '#c9965d', { tamanho = 512, veios = 60, semente = 5 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = tamanho;
  const g = c.getContext('2d');
  g.fillStyle = cor; g.fillRect(0, 0, tamanho, tamanho);
  const rnd = mulberry32(semente);
  for (let i = 0; i < veios; i++) {
    const y = rnd() * tamanho; const a = 0.05 + rnd() * 0.08;
    g.strokeStyle = `rgba(80,45,20,${a})`; g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= tamanho; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (rnd() - 0.5) * 1.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cria o palco. Devolve utilidades para a cena montar em cima.
// pos: 'lemo' (padrão: DOF físico + GTAO + bloom + vinheta do lemo-opuscar) | 'bokeh' (three.js, mais leve) | 'nenhum'
export function criarPalco({ canvas, largura = 1080, altura = 1920, paleta, dof = true, pos = 'lemo', ao = true, sombras = true, ceu = null, nevoa = true, fov = 30 } = {}) {
  const P = paleta;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(largura, altura, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = P.luz?.exposicao ?? 1.0;
  renderer.shadowMap.enabled = sombras;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = ceu === false ? new THREE.Color(P.ceu?.[1] || '#dfe9f2') : texturaGradiente(ceu || P.ceu || ['#a9c6e3', '#dfe9f2']);
  if (nevoa) scene.fog = new THREE.Fog(P.nevoa || '#dfe7ee', 18, 70);

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = P.luz?.ambiente ?? 0.35;

  const hemi = new THREE.HemisphereLight(P.luz?.ceu || '#dfeaf7', P.luz?.chao || '#a8977e', P.luz?.hemi_intensidade ?? 1.15);
  scene.add(hemi);
  const sol = new THREE.DirectionalLight(P.luz?.sol || '#fff6e8', P.luz?.sol_intensidade ?? 2.6);
  sol.position.set(6, 12, 8);
  sol.castShadow = sombras;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.02;
  sol.shadow.radius = 4;
  scene.add(sol); scene.add(sol.target);

  const camera = new THREE.PerspectiveCamera(fov, largura / altura, 0.05, 400);
  camera.position.set(0, 1.6, 6);

  let composer; let bokeh = null; let lemo = null;
  if (dof && pos === 'lemo') {
    lemo = makePost(renderer, scene, camera, largura, altura, { ssaa: 1, ao });
    composer = lemo.composer;
    lemo.dof.focus = 6; lemo.dof.aper = 55; lemo.dof.maxCoc = 14;
    lemo.bloom.strength = 0.1;
    lemo.vig.uniforms.amt.value = 0.22; lemo.vig.uniforms.contrast.value = 0.06; lemo.vig.uniforms.sat.value = 1.04;
  } else {
    const alvoRT = new THREE.WebGLRenderTarget(largura, altura, { samples: 4, type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, alvoRT);
    composer.setPixelRatio(1);
    composer.setSize(largura, altura);
    composer.addPass(new RenderPass(scene, camera));
    if (dof && pos === 'bokeh') {
      bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.0022, maxblur: 0.009 });
      composer.addPass(bokeh);
    }
    composer.addPass(new OutputPass());
  }

  const palco = {
    THREE, renderer, scene, camera, composer, sol, hemi, bokeh, lemo, paleta: P, largura, altura,
    // ajusta o volume da sombra do sol em volta de um ponto (chame quando a câmera muda de região)
    sombraEm(centro = [0, 0, 0], raio = 8) {
      const c = new THREE.Vector3(...centro);
      sol.target.position.copy(c);
      sol.position.copy(c).add(new THREE.Vector3(6, 12, 8).normalize().multiplyScalar(30));
      const s = sol.shadow.camera;
      s.left = -raio; s.right = raio; s.top = raio; s.bottom = -raio; s.near = 1; s.far = 80;
      s.updateProjectionMatrix();
    },
    // distância de foco (m). abertura: lemo = px·m (padrão 55; maior = mais desfoque) | bokeh = 0.0022.
    foco(distancia, abertura = null, maximo = null) {
      if (lemo) {
        lemo.dof.focus = Math.max(0.05, distancia);
        if (abertura != null) lemo.dof.aper = abertura;
        if (maximo != null) lemo.dof.maxCoc = maximo;
        return;
      }
      if (!bokeh) return;
      bokeh.uniforms.focus.value = distancia;
      if (abertura != null) bokeh.uniforms.aperture.value = abertura;
      if (maximo != null) bokeh.uniforms.maxblur.value = maximo;
    },
    focarEm(ponto, abertura = null, maximo = null) {
      const d = camera.position.distanceTo(ponto.isVector3 ? ponto : new THREE.Vector3(...ponto));
      palco.foco(d, abertura, maximo);
    },
    renderizar() { composer.render(); },
  };
  palco.sombraEm([0, 0, 0], 10);
  return palco;
}

// Piso grande com terrazzo (ou cor lisa) que recebe sombra.
export function criarPiso(palco, { tamanho = 120, terrazzo = true, cor = null, repetir = 26 } = {}) {
  const P = palco.paleta;
  let mat;
  if (terrazzo) {
    const tex = texturaTerrazzo(P.terrazzo || ['#d9cfbf', '#8e8778'], { base: cor || P.chao || '#ece6dc' });
    tex.repeat.set(repetir, repetir);
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 });
  } else mat = new THREE.MeshStandardMaterial({ color: cor || P.chao, roughness: 0.9 });
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(tamanho, tamanho), mat);
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  palco.scene.add(piso);
  return piso;
}

// Nuvens macias ao fundo (esferas achatadas e brancas, longe; o desfoque faz o resto).
export function criarNuvens(palco, { n = 7, raio = 55, altura = 14, semente = 9 } = {}) {
  const grupo = new THREE.Group();
  const rnd = mulberry32(semente);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35, fog: false });
  for (let i = 0; i < n; i++) {
    const nuvem = new THREE.Group();
    const partes = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < partes; k++) {
      const s = 1.6 + rnd() * 2.4;
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 20, 14), mat);
      m.position.set((k - partes / 2) * 2.1 + rnd(), rnd() * 1.2, rnd() * 1.5);
      m.scale.y = 0.62;
      nuvem.add(m);
    }
    const a = -Math.PI * 0.85 + (i / n) * Math.PI * 0.7 + rnd() * 0.2;
    nuvem.position.set(Math.cos(a) * raio, altura + rnd() * 8, Math.sin(a) * raio);
    grupo.add(nuvem);
  }
  palco.scene.add(grupo);
  return grupo;
}

// Disco de sombra de contato (deixa objetos "pousados" no chão sem custo de AO).
export function sombraContato(alvo, { raio = 0.6, opacidade = 0.35, y = 0.004 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, `rgba(0,0,0,${opacidade})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(raio * 2, raio * 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  alvo.add(m);
  return m;
}

// Brilho/halo que funciona com o pós-processamento do lemo: painel virado para a câmera, mistura NORMAL.
// (Sprites com AdditiveBlending viram um quadrado escuro no DOF do lemo — use isto no lugar.)
// Chame brilho.userData.virar(camera) a cada quadro (o kit faz isso se você passar o palco em render).
export function criarBrilho({ cor = '#fff2c0', tamanho = 20, intensidade = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 6, 128, 128, 128);
  gr.addColorStop(0, `rgba(255,255,255,${intensidade})`); gr.addColorStop(0.22, `rgba(255,255,255,${0.42 * intensidade})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: cor, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  m.scale.setScalar(tamanho);
  m.renderOrder = -1;
  m.userData.virar = (camera) => m.quaternion.copy(camera.quaternion);
  return m;
}
