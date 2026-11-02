// kit/personagem.js — boneco low-poly sem rosto (estilo da referência), com articulações e poses.
// Escala em metros (altura ~1,75). O boneco olha para +Z. Esquerda dele = +X.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, ease } from './nucleo.js';

const rad = (g) => (g * Math.PI) / 180;
const pal = () => window.REEL?.paleta || {};

function m(cor, rough = 0.6) { return new THREE.MeshStandardMaterial({ color: cor, roughness: rough, metalness: 0 }); }
function malha(geo, material) { const x = new THREE.Mesh(geo, material); x.castShadow = true; x.receiveShadow = true; return x; }
function capsulaY(r, comp, material) {
  // cápsula pendurada a partir do pivô (vai de 0 até -comp)
  const g = new THREE.CapsuleGeometry(r, comp, 6, 14); g.translate(0, -comp / 2, 0);
  return malha(g, material);
}

// POSES em graus. Campos: tronco{inclina,gira,lado}, cabeca{gira,inclina,lado},
// bracoE/bracoD{frente,lado,gira,cotovelo}, pernaE/pernaD{frente,lado,joelho}, quadrilY (altura do quadril)
export const POSES = {
  em_pe: { bracoE: { frente: 3, lado: 7, cotovelo: 8 }, bracoD: { frente: 3, lado: 7, cotovelo: 8 } },
  digitando: { tronco: { inclina: 9 }, cabeca: { inclina: 16 }, bracoE: { frente: 52, lado: 12, gira: -10, cotovelo: 62 }, bracoD: { frente: 52, lado: 12, gira: 10, cotovelo: 62 } },
  apontando: { cabeca: { gira: -10 }, bracoD: { frente: 82, lado: 12, cotovelo: 4 }, bracoE: { frente: 2, lado: 7, cotovelo: 8 } },
  segurando: { cabeca: { inclina: 22 }, bracoE: { frente: 38, lado: 8, cotovelo: 78 }, bracoD: { frente: 38, lado: 8, cotovelo: 78 } },
  bracos_cruzados: { bracoE: { frente: 30, lado: -8, gira: 30, cotovelo: 112 }, bracoD: { frente: 34, lado: -8, gira: -30, cotovelo: 112 } },
  maos_na_cintura: { bracoE: { frente: -12, lado: 38, gira: 20, cotovelo: 108 }, bracoD: { frente: -12, lado: 38, gira: -20, cotovelo: 108 } },
  pensando: { cabeca: { inclina: -6, lado: 8 }, bracoD: { frente: 58, lado: 6, gira: -20, cotovelo: 132 }, bracoE: { frente: 22, lado: -4, gira: 30, cotovelo: 95 } },
  acenando: { bracoD: { frente: 10, lado: 142, cotovelo: 25 }, bracoE: { frente: 3, lado: 7, cotovelo: 8 } },
  comemorando: { bracoE: { frente: 15, lado: 150, cotovelo: 10 }, bracoD: { frente: 15, lado: 150, cotovelo: 10 }, cabeca: { inclina: -12 } },
  sentado: { quadrilY: 0.49, pernaE: { frente: 88, joelho: 88 }, pernaD: { frente: 88, joelho: 88 }, bracoE: { frente: 40, lado: 6, cotovelo: 50 }, bracoD: { frente: 40, lado: 6, cotovelo: 50 } },
  sentado_digitando: { quadrilY: 0.49, tronco: { inclina: 8 }, cabeca: { inclina: 14 }, pernaE: { frente: 88, joelho: 88 }, pernaD: { frente: 88, joelho: 88 }, bracoE: { frente: 55, lado: 10, cotovelo: 60 }, bracoD: { frente: 55, lado: 10, cotovelo: 60 } },
  duvida: { cabeca: { lado: 12, inclina: -4 }, bracoE: { frente: 25, lado: 30, gira: 40, cotovelo: 70 }, bracoD: { frente: 25, lado: 30, gira: -40, cotovelo: 70 } },
};

// Placa com número/texto (canvas) para peito de macacão, carro, capacete.
export function placaNumero(txt, { fundo = '#ffffff', cor = '#111111', l = 0.11, a = 0.085, raio = 36 } = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * (a / l));
  const g = c.getContext('2d');
  g.fillStyle = fundo; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, c.width, c.height, raio); else g.rect(0, 0, c.width, c.height); g.fill();
  g.fillStyle = cor; g.font = `900 ${Math.round(c.height * 0.78)}px Inter, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(txt), c.width / 2, c.height * 0.54, c.width * 0.92);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(l, a), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, transparent: true }));
  return p;
}

// Capacete de piloto (F1, kart, moto): casco brilhante, viseira escura, coroa e faixa frontal na cor de destaque, aerofólio.
// Centrado no centro da cabeça (o personagem posiciona). Use sozinho também (ex.: piloto dentro do cockpit).
export function criarCapacete({ cor = '#eef1f4', corFaixa = null, viseira = '#0d1014', escala = 1 } = {}) {
  const g = new THREE.Group(); g.name = 'capacete';
  const mC = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.26, metalness: 0.12 });
  const mF = corFaixa ? new THREE.MeshStandardMaterial({ color: corFaixa, roughness: 0.3, metalness: 0.1 }) : mC;
  const mV = new THREE.MeshStandardMaterial({ color: viseira, roughness: 0.06, metalness: 0.65 });
  const forma = (geo, mt) => { const x = malha(geo, mt); x.scale.set(1, 1.04, 1.12); x.position.set(0, 0.012, -0.006); g.add(x); return x; };
  forma(new THREE.SphereGeometry(0.15, 36, 26), mC); // casco
  forma(new THREE.SphereGeometry(0.1516, 36, 10, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.37, Math.PI * 0.17), mV); // viseira (frente = +Z)
  if (corFaixa) {
    forma(new THREE.SphereGeometry(0.1512, 36, 8, 0, Math.PI * 2, 0, Math.PI * 0.2), mF); // coroa
    forma(new THREE.SphereGeometry(0.1514, 6, 16, Math.PI / 2 - 0.13, 0.26, Math.PI * 0.18, Math.PI * 0.18), mF); // faixa até a viseira
    forma(new THREE.SphereGeometry(0.1512, 36, 4, 0, Math.PI * 2, Math.PI * 0.8, Math.PI * 0.06), mF); // aro de baixo
  }
  const asa = malha(new RoundedBoxGeometry(0.13, 0.018, 0.05, 2, 0.008), mF); asa.position.set(0, 0.15, -0.11); asa.rotation.x = -0.4; g.add(asa);
  g.scale.setScalar(escala);
  return g;
}

// Traços para reconhecer uma pessoa REAL (o estilo não tem rosto): cabelo ('curto'|'longo'|'coque'|'raspado'|'black'|'careca'|'lateral'),
// barba ('cheia'|'curta'|'cavanhaque'|'bigode'), oculos (true|'redondo'|'sol'), paleto (cor do terno) + camisa + gravata.
// Uniformes: traje 'macacao' (piloto/mecânico: peça única em corTraje, faixas em corFaixa no peito, braços e pernas, gola,
// numero no peito, luvas e botas). acessorio 'capacete' (corAcessorio + corCapaceteFaixa; esconde cabelo, barba e óculos),
// 'bone' (boné de equipe na corAcessorio), 'gorro', 'mochila'.
export function criarPersonagem({ pele = null, roupa = null, calca = null, sapato = '#f2f2f2', cabelo = 'curto', corCabelo = '#23180f', acessorio = null, corAcessorio = '#1f2228', escala = 1, semente = 1,
  barba = null, corBarba = null, oculos = null, corOculos = '#1d1f24', paleto = null, camisa = '#f4f4f2', gravata = null,
  traje = null, corTraje = null, corFaixa = null, numero = null, corNumero = null, luvas = null, botas = null, corCapaceteFaixa = null, viseira = '#0d1014',
  listras = null, corCalcao = null, corMeiao = null, corGola = null } = {}) {
  const P = pal();
  const peles = P.pele || ['#c68a5b']; const roupas = P.roupa || ['#1f2228']; const calcas = P.calca || ['#2a3a5e'];
  const macacao = traje === 'macacao';
  const futebol = traje === 'futebol';
  const capacete = acessorio === 'capacete';
  const mPele = m(pele || peles[semente % peles.length], 0.55);
  let mRoupa = m(macacao ? (corTraje || roupa || '#1c1f24') : (paleto || roupa || roupas[semente % roupas.length]), macacao ? 0.5 : 0.7);
  if (futebol) {
    // camisa do time: cor base + listras (vertical/horizontal) ou faixa no peito, desenhadas numa textura
    const base = corTraje || roupa || '#ffffff';
    mRoupa = m(base, 0.65);
    if (listras?.cores?.length) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = base; g.fillRect(0, 0, 256, 256);
      const n = listras.n || (listras.tipo === 'faixa' ? listras.cores.length : 8);
      if (listras.tipo === 'diagonal') {
        // faixa transversal (ex.: Vasco): banda inclinada do ombro ao quadril; listras.cores = [faixa, filete?]
        const larg = 256 * (listras.largura || 0.2), x0 = 256 * (listras.inicio ?? 0.15);
        const banda = (cor, w) => { g.fillStyle = cor; g.beginPath(); g.moveTo(x0 - w / 2, 0); g.lineTo(x0 + w / 2, 0); g.lineTo(x0 + w / 2 + 128, 256); g.lineTo(x0 - w / 2 + 128, 256); g.closePath(); g.fill(); };
        if (listras.cores[1]) banda(listras.cores[1], larg * 1.25);
        banda(listras.cores[0], larg);
      } else if (listras.tipo === 'faixa') {
        const alt = 256 * 0.24 / listras.cores.length;
        listras.cores.forEach((cor, i) => { g.fillStyle = cor; g.fillRect(0, 256 * 0.3 + i * alt, 256, alt + 1); });
      } else {
        for (let i = 0; i < n; i++) {
          g.fillStyle = listras.cores[i % listras.cores.length];
          if (listras.tipo === 'vertical') g.fillRect((i * 256) / n, 0, 256 / n + 1, 256); else g.fillRect(0, (i * 256) / n, 256, 256 / n + 1);
        }
      }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      mRoupa = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
    }
  }
  const mCalca = macacao ? mRoupa : futebol ? m(corCalcao || '#111111', 0.6) : m(calca || calcas[semente % calcas.length], 0.75);
  const mMeiao = futebol ? m(corMeiao || corCalcao || '#111111', 0.6) : mCalca;
  const mSapato = m(macacao ? (botas || '#16181c') : futebol ? (botas || '#15171a') : (botas || sapato), 0.5);
  const mMao = luvas ? m(luvas, 0.6) : mPele;
  const mFaixa = m(corFaixa || '#00a19b', 0.45);
  if (capacete) { cabelo = 'careca'; barba = null; oculos = null; }

  const raiz = new THREE.Group(); raiz.name = 'personagem';
  const quadril = new THREE.Group(); quadril.position.y = 0.95; raiz.add(quadril);
  const bacia = malha(new RoundedBoxGeometry(0.32, 0.16, 0.2, 3, 0.07), mCalca); bacia.position.y = -0.02; quadril.add(bacia);

  const tronco = new THREE.Group(); quadril.add(tronco);
  const torso = malha(new RoundedBoxGeometry(0.4, 0.52, 0.24, 4, 0.1), mRoupa); torso.position.y = 0.26; tronco.add(torso);

  const pescoco = new THREE.Group(); pescoco.position.y = 0.53; tronco.add(pescoco);
  const colo = malha(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 12), mPele); colo.position.y = 0.03; pescoco.add(colo);
  const cabeca = new THREE.Group(); cabeca.position.y = 0.07; pescoco.add(cabeca);
  const cranio = malha(new THREE.SphereGeometry(0.118, 28, 20), mPele); cranio.position.y = 0.1; cranio.scale.set(0.96, 1.04, 1); cabeca.add(cranio);
  const mCabelo = m(corCabelo, 0.8);
  if (cabelo === 'raspado') {
    const cap = malha(new THREE.SphereGeometry(0.121, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), m(corCabelo, 0.95));
    cap.position.y = 0.102; cap.rotation.x = -0.18; cap.scale.set(0.98, 1.05, 1.02); cabeca.add(cap);
  }
  if (cabelo === 'black') {
    const mB = m(corCabelo, 0.95);
    const topo = malha(new THREE.SphereGeometry(0.158, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.3), mB);
    topo.position.set(0, 0.1, -0.015); topo.scale.set(1.04, 1.0, 1.02); cabeca.add(topo);
    const lados = malha(new THREE.SphereGeometry(0.158, 28, 12, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, Math.PI * 0.3, Math.PI * 0.3), mB);
    lados.position.set(0, 0.1, -0.015); lados.scale.set(1.04, 1.0, 1.02); cabeca.add(lados);
  }
  if (cabelo === 'lateral') {
    // calvo em cima, cabelo nas laterais e atrás
    const anel = malha(new THREE.SphereGeometry(0.124, 28, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, Math.PI * 0.3, Math.PI * 0.26), m(corCabelo, 0.85));
    anel.position.y = 0.1; anel.scale.set(0.98, 1.04, 1.02); cabeca.add(anel);
  }
  if (cabelo === 'curto' || cabelo === 'coque' || cabelo === 'longo') {
    const cap = malha(new THREE.SphereGeometry(0.124, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), mCabelo);
    cap.position.y = 0.105; cap.rotation.x = -0.25; cap.scale.set(1, 1.05, 1.04); cabeca.add(cap);
    if (cabelo === 'coque') { const c = malha(new THREE.SphereGeometry(0.06, 16, 12), mCabelo); c.position.set(0, 0.2, -0.09); cabeca.add(c); }
    if (cabelo === 'longo') { const l = malha(new RoundedBoxGeometry(0.24, 0.28, 0.09, 2, 0.04), mCabelo); l.position.set(0, -0.0, -0.08); cabeca.add(l); }
  }
  const mAc = m(corAcessorio, 0.85);
  if (acessorio === 'gorro') {
    const g1 = malha(new THREE.SphereGeometry(0.128, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), mAc); g1.position.y = 0.115; g1.scale.set(1, 1.15, 1); cabeca.add(g1);
    const g2 = malha(new THREE.TorusGeometry(0.122, 0.022, 10, 32), mAc); g2.rotation.x = Math.PI / 2; g2.position.y = 0.12; cabeca.add(g2);
  }
  if (acessorio === 'bone') {
    const b1 = malha(new THREE.SphereGeometry(0.126, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), mAc); b1.position.y = 0.11; cabeca.add(b1);
    const aba = malha(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), mAc); aba.position.set(0, 0.12, 0.08); aba.scale.z = 1.3; cabeca.add(aba);
  }
  if (capacete) {
    const cap = criarCapacete({ cor: corAcessorio === '#1f2228' ? '#eef1f4' : corAcessorio, corFaixa: corCapaceteFaixa, viseira });
    cap.position.y = 0.1; cabeca.add(cap);
  }
  if (futebol) {
    // gola, número grande nas costas e pequeno no peito
    const gola = malha(new THREE.CylinderGeometry(0.062, 0.068, 0.04, 20), m(corGola || corNumero || '#111111', 0.6)); gola.position.y = 0.0; pescoco.add(gola);
    if (numero != null && numero !== '') {
      const nc = placaNumero(numero, { fundo: 'rgba(0,0,0,0)', cor: corNumero || '#111111', l: 0.2, a: 0.17 }); nc.position.set(0, 0.29, -0.1235); nc.rotation.y = Math.PI; tronco.add(nc);
      const nf = placaNumero(numero, { fundo: 'rgba(0,0,0,0)', cor: corNumero || '#111111', l: 0.07, a: 0.06 }); nf.position.set(-0.08, 0.38, 0.1235); tronco.add(nf);
    }
  }
  if (macacao) {
    // gola, duas faixas no peito, número no peito
    const gola = malha(new THREE.CylinderGeometry(0.064, 0.07, 0.05, 20), mFaixa); gola.position.y = 0.005; pescoco.add(gola);
    for (const sx of [-1, 1]) {
      const f = malha(new RoundedBoxGeometry(0.03, 0.36, 0.006, 1, 0.003), mFaixa); f.position.set(sx * 0.088, 0.26, 0.1215); tronco.add(f);
      const ft = malha(new RoundedBoxGeometry(0.03, 0.36, 0.006, 1, 0.003), mFaixa); ft.position.set(sx * 0.088, 0.26, -0.1215); tronco.add(ft);
    }
    if (numero != null && numero !== '') {
      const n = placaNumero(numero, { fundo: corFaixa || '#ffffff', cor: corNumero || '#111111' }); n.position.set(0, 0.36, 0.1235); tronco.add(n);
      const nc = placaNumero(numero, { fundo: corFaixa || '#ffffff', cor: corNumero || '#111111', l: 0.16, a: 0.12 }); nc.position.set(0, 0.3, -0.1235); nc.rotation.y = Math.PI; tronco.add(nc);
    }
  }

  // sem rosto desenhado, barba preta sobre pele escura vira mancha: o padrão mistura um pouco da pele
  const mBarba = m(corBarba || '#' + new THREE.Color(corCabelo).lerp(new THREE.Color(pele || peles[semente % peles.length]), 0.28).getHexString(), 0.9);
  if (barba === 'cheia' || barba === 'curta') {
    const b = malha(new THREE.SphereGeometry(barba === 'cheia' ? 0.126 : 0.122, 28, 16, Math.PI / 2 - 1.25, 2.5, Math.PI * (barba === 'cheia' ? 0.6 : 0.64), Math.PI * (barba === 'cheia' ? 0.4 : 0.36)), mBarba); // até embaixo do queixo: barba em U, sem faixa de pele
    b.position.y = 0.1; b.scale.set(0.98, 1.06, barba === 'cheia' ? 1.08 : 1.03); cabeca.add(b);
    // costeletas: ligam a barba ao cabelo pelas laterais (a barba vira um U, não uma máscara)
    for (const s of [-1, 1]) {
      const cost = malha(new THREE.SphereGeometry(barba === 'cheia' ? 0.1265 : 0.1225, 10, 10, s < 0 ? Math.PI / 2 - 1.25 : Math.PI / 2 + 0.83, 0.42, Math.PI * 0.4, Math.PI * 0.24), mBarba);
      cost.position.y = 0.1; cost.scale.copy(b.scale); cabeca.add(cost);
    }
  }
  if (barba === 'cavanhaque') {
    const b = malha(new THREE.SphereGeometry(0.123, 20, 12, Math.PI / 2 - 0.42, 0.84, Math.PI * 0.68, Math.PI * 0.2), mBarba);
    b.position.y = 0.1; b.scale.set(0.98, 1.06, 1.05); cabeca.add(b);
  }
  if (barba === 'bigode' || barba === 'cavanhaque' || barba === 'cheia' || barba === 'curta') {
    const cheia = barba === 'cheia' || barba === 'curta';
    const bg = malha(new THREE.CapsuleGeometry(cheia ? 0.013 : 0.011, cheia ? 0.058 : 0.05, 4, 10), mBarba);
    // com barba, o bigode encosta na borda de cima dela (sem faixa de pele entre os dois)
    bg.rotation.z = Math.PI / 2; bg.position.set(0, cheia ? 0.063 : 0.067, cheia ? 0.119 : 0.112); cabeca.add(bg);
  }
  if (oculos) {
    const mO = m(corOculos, 0.35);
    const lenteR = oculos === 'redondo' ? 0.03 : 0.028;
    for (const lx of [-0.046, 0.046]) {
      const aro = malha(new THREE.TorusGeometry(lenteR, 0.0055, 8, 28), mO);
      aro.position.set(lx, 0.118, 0.114); if (oculos !== 'redondo') aro.scale.set(1.12, 0.86, 1); cabeca.add(aro);
      if (oculos === 'sol') {
        const lente = malha(new THREE.CircleGeometry(lenteR, 24), new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.15, metalness: 0.3 }));
        lente.position.set(lx, 0.118, 0.115); lente.scale.set(1.12, 0.86, 1); cabeca.add(lente);
      }
      const haste = malha(new THREE.BoxGeometry(0.006, 0.006, 0.1), mO);
      haste.position.set(lx > 0 ? 0.108 : -0.108, 0.122, 0.066); haste.rotation.y = lx > 0 ? 0.12 : -0.12; cabeca.add(haste);
    }
    const ponte = malha(new THREE.BoxGeometry(0.03, 0.005, 0.005), mO); ponte.position.set(0, 0.122, 0.116); cabeca.add(ponte);
  }
  if (paleto) {
    // camisa aparecendo no decote em V e gravata (opcional), na frente do tronco (frente = +Z)
    const v = new THREE.Shape(); v.moveTo(-0.07, 0.47); v.lineTo(0.07, 0.47); v.lineTo(0, 0.29); v.closePath();
    const decote = malha(new THREE.ShapeGeometry(v), m(camisa, 0.6)); decote.position.z = 0.1215; tronco.add(decote);
    if (gravata) {
      const mG = m(gravata, 0.5);
      const no = malha(new RoundedBoxGeometry(0.04, 0.032, 0.012, 2, 0.005), mG); no.position.set(0, 0.452, 0.126); tronco.add(no);
      const corpo = malha(new RoundedBoxGeometry(0.036, 0.18, 0.008, 2, 0.003), mG); corpo.position.set(0, 0.35, 0.125); tronco.add(corpo);
    }
  }

  function braco(lado) {
    const ombro = new THREE.Group(); ombro.position.set(lado * 0.235, 0.47, 0); tronco.add(ombro);
    const sup = capsulaY(0.052, 0.2, mRoupa); ombro.add(sup);
    const cotovelo = new THREE.Group(); cotovelo.position.y = -0.27; ombro.add(cotovelo);
    const ante = capsulaY(0.045, 0.19, futebol ? mPele : mRoupa); cotovelo.add(ante); // camisa de futebol: manga curta
    const mao = malha(new THREE.SphereGeometry(0.048, 16, 12), mMao); mao.position.y = -0.27; mao.scale.set(0.9, 1.15, 0.8); cotovelo.add(mao);
    if (macacao) {
      // faixa no lado de fora do braço + punho
      const fs = capsulaY(0.013, 0.2, mFaixa); fs.position.x = lado * 0.045; ombro.add(fs);
      const fa = capsulaY(0.012, 0.19, mFaixa); fa.position.x = lado * 0.038; cotovelo.add(fa);
      const punho = malha(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), mFaixa); punho.position.y = -0.225; cotovelo.add(punho);
    }
    return { ombro, cotovelo, mao };
  }
  function perna(lado) {
    const q = new THREE.Group(); q.position.set(lado * 0.095, -0.06, 0); quadril.add(q);
    const coxa = capsulaY(0.072, 0.3, mCalca); q.add(coxa);
    const joelho = new THREE.Group(); joelho.position.y = -0.42; q.add(joelho);
    const canela = capsulaY(0.062, 0.3, futebol ? mMeiao : mCalca); joelho.add(canela); // futebol: meião
    const pe = malha(new RoundedBoxGeometry(0.12, 0.08, 0.24, 3, 0.035), mSapato); pe.position.set(0, -0.43, 0.045); joelho.add(pe);
    if (macacao) {
      const fc = capsulaY(0.016, 0.3, mFaixa); fc.position.x = lado * 0.064; q.add(fc);
      const fk = capsulaY(0.014, 0.3, mFaixa); fk.position.x = lado * 0.054; joelho.add(fk);
    }
    return { quadril: q, joelho, pe };
  }
  const bE = braco(1), bD = braco(-1), pE = perna(1), pD = perna(-1);
  if (acessorio === 'mochila') {
    const mo = malha(new RoundedBoxGeometry(0.34, 0.42, 0.16, 3, 0.06), mAc); mo.position.set(0, 0.28, -0.2); tronco.add(mo);
  }

  raiz.scale.setScalar(escala);
  const partes = { raiz, quadril, tronco, pescoco, cabeca, bE, bD, pE, pD };

  function aplicar(pose) {
    const p = pose || {};
    const tr = p.tronco || {}; const ca = p.cabeca || {};
    tronco.rotation.set(rad(tr.inclina || 0), rad(tr.gira || 0), rad(tr.lado || 0));
    cabeca.rotation.set(rad(ca.inclina || 0), rad(ca.gira || 0), rad(ca.lado || 0));
    for (const [b, lado, k] of [[bE, 1, 'bracoE'], [bD, -1, 'bracoD']]) {
      const x = p[k] || {};
      b.ombro.rotation.set(-rad(x.frente || 0), rad(x.gira || 0) * lado, rad(x.lado || 0) * lado);
      b.cotovelo.rotation.set(-rad(x.cotovelo || 0), 0, 0);
    }
    for (const [pp, lado, k] of [[pE, 1, 'pernaE'], [pD, -1, 'pernaD']]) {
      const x = p[k] || {};
      pp.quadril.rotation.set(-rad(x.frente || 0), 0, rad(x.lado || 0) * lado);
      pp.joelho.rotation.set(rad(x.joelho || 0), 0, 0);
    }
    quadril.position.y = p.quadrilY ?? 0.95;
  }

  const api = {
    grupo: raiz, partes,
    pose(nomeOuPose) { aplicar(typeof nomeOuPose === 'string' ? POSES[nomeOuPose] : nomeOuPose); return api; },
    // mistura duas poses (0 = a, 1 = b)
    misturar(a, b, x) { aplicar(misturarPoses(typeof a === 'string' ? POSES[a] : a, typeof b === 'string' ? POSES[b] : b, x)); return api; },
    // ciclo de caminhada; fase em ciclos (1 = passo esquerdo + direito)
    andar(fase, intensidade = 1) {
      const s = Math.sin(fase * Math.PI * 2);
      const c = Math.cos(fase * Math.PI * 2);
      aplicar({
        tronco: { inclina: 4, gira: s * 4 * intensidade },
        cabeca: { gira: -s * 2 },
        bracoE: { frente: -s * 22 * intensidade, lado: 7, cotovelo: 14 + Math.max(0, -s) * 18 },
        bracoD: { frente: s * 22 * intensidade, lado: 7, cotovelo: 14 + Math.max(0, s) * 18 },
        pernaE: { frente: s * 24 * intensidade, joelho: Math.max(0, -c) * 38 * intensidade + 4 },
        pernaD: { frente: -s * 24 * intensidade, joelho: Math.max(0, c) * 38 * intensidade + 4 },
      });
      quadril.position.y = 0.95 + Math.abs(c) * 0.025 * intensidade;
      return api;
    },
    // respiração / microvida (somar por cima da pose)
    vida(t, semente2 = 0) {
      tronco.scale.set(1, 1 + Math.sin(t * 1.6 + semente2) * 0.006, 1 + Math.sin(t * 1.6 + semente2) * 0.01);
      cabeca.rotation.y += Math.sin(t * 0.45 + semente2 * 3) * 0.04;
      return api;
    },
    // vira a cabeça para um ponto do mundo (limitado)
    olhar(alvo, forca = 1) {
      const pos = new THREE.Vector3(); cabeca.getWorldPosition(pos);
      const d = (alvo.isVector3 ? alvo.clone() : new THREE.Vector3(...alvo)).sub(pos);
      const inv = new THREE.Quaternion(); raiz.getWorldQuaternion(inv); inv.invert(); d.applyQuaternion(inv);
      const yaw = Math.atan2(d.x, d.z); const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      cabeca.rotation.y = lerp(cabeca.rotation.y, clamp(yaw, -1.1, 1.1), forca);
      cabeca.rotation.x = lerp(cabeca.rotation.x, clamp(pitch, -0.6, 0.7), forca);
      return api;
    },
    // posição da mão direita/esquerda no mundo (para segurar objetos)
    mao(lado = 'D') { const v = new THREE.Vector3(); (lado === 'D' ? bD : bE).mao.getWorldPosition(v); return v; },
    prender(obj, lado = 'D', offset = [0, -0.04, 0.03]) { const b = lado === 'D' ? bD : bE; b.mao.add(obj); obj.position.set(...offset); return api; },
  };
  aplicar(POSES.em_pe);
  return api;
}

export function misturarPoses(a = {}, b = {}, x = 0) {
  const out = {};
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of chaves) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' || typeof vb === 'number') { out[k] = lerp(va ?? (k === 'quadrilY' ? 0.95 : 0), vb ?? (k === 'quadrilY' ? 0.95 : 0), x); continue; }
    out[k] = {};
    for (const s of new Set([...Object.keys(va || {}), ...Object.keys(vb || {})])) out[k][s] = lerp(va?.[s] ?? 0, vb?.[s] ?? 0, x);
  }
  return out;
}

// Sequência de poses no tempo: [{t, pose}] com transição de `dur` segundos (suave) entre elas.
export function sequenciaPoses(lista, dur = 0.45) {
  const ks = [...lista].sort((a, b) => a.t - b.t);
  return (t) => {
    let i = 0; while (i + 1 < ks.length && t >= ks[i + 1].t) i++;
    const atual = ks[i]; const ant = ks[i - 1];
    const pa = typeof atual.pose === 'string' ? POSES[atual.pose] : atual.pose;
    if (!ant || t >= atual.t + dur) return pa;
    const pb = typeof ant.pose === 'string' ? POSES[ant.pose] : ant.pose;
    return misturarPoses(pb, pa, ease.io((t - atual.t) / dur));
  };
}

// Caminho no chão: pontos [x,z]; devolve {pos:[x,0,z], rumo (rad), fase} para t entre t0 e t1.
export function caminhar(pontos, t, t0, t1, { passoPorMetro = 0.75 } = {}) {
  const pts = pontos.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curva = new THREE.CatmullRomCurve3(pts);
  const comp = curva.getLength();
  const u = clamp((t - t0) / Math.max(0.001, t1 - t0));
  const uu = ease.io2(u);
  const pos = curva.getPointAt(uu);
  const tan = curva.getTangentAt(Math.min(0.999, Math.max(0.001, uu)));
  return { pos: [pos.x, 0, pos.z], rumo: Math.atan2(tan.x, tan.z), fase: uu * comp * passoPorMetro, andando: u > 0 && u < 1 };
}
