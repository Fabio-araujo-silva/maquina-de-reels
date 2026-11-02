// kit/camera.js — planos de câmera no tempo. Cada plano é um trecho contínuo; trocar de plano = corte.
// Um plano: { ini, fim, de:{pos,alvo,fov}, para:{pos,alvo,fov}, ease, tipo, foco:{abertura,maximo}, tremor }
//   tipo 'linear'  (padrão) interpola pos/alvo/fov entre de e para
//   tipo 'orbita'  { centro, raio, altura:[a0,a1], ang:[g0,g1] em graus, alvoY } gira em volta do centro
//   tipo 'seguir'  { objeto, offset:[x,y,z], alvoOffset:[x,y,z] } acompanha um Object3D
import * as THREE from 'three';
import { seg, lerp, easeDe, ruido1 } from './nucleo.js';

const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(...(a || [0, 0, 0])));
const lerpArr = (a, b, p) => a.map((x, i) => lerp(x, b[i], p));

export function planos(lista) {
  const ps = [...lista].sort((a, b) => a.ini - b.ini);
  const indice = (t) => { let i = 0; for (let k = 0; k < ps.length; k++) if (t >= ps[k].ini) i = k; return i; };
  function estado(t) {
    const pl = ps[indice(t)];
    const p = easeDe(pl.ease || 'io')(seg(t, pl.ini, pl.fim));
    let pos, alvo, fov;
    if (pl.tipo === 'orbita') {
      const ang = THREE.MathUtils.degToRad(lerp(pl.ang[0], pl.ang[1], p));
      const r = Array.isArray(pl.raio) ? lerp(pl.raio[0], pl.raio[1], p) : pl.raio;
      const h = Array.isArray(pl.altura) ? lerp(pl.altura[0], pl.altura[1], p) : pl.altura;
      const c = v3(pl.centro);
      pos = new THREE.Vector3(c.x + Math.sin(ang) * r, c.y + h, c.z + Math.cos(ang) * r);
      alvo = new THREE.Vector3(c.x, (pl.alvoY ?? c.y), c.z);
      fov = Array.isArray(pl.fov) ? lerp(pl.fov[0], pl.fov[1], p) : (pl.fov ?? 30);
    } else if (pl.tipo === 'seguir') {
      const o = new THREE.Vector3(); pl.objeto.getWorldPosition(o);
      const off = Array.isArray(pl.offset?.[0]) ? lerpArr(pl.offset[0], pl.offset[1], p) : (pl.offset || [0, 1.6, 4]);
      const aoff = pl.alvoOffset || [0, 1.2, 0];
      pos = o.clone().add(v3(off)); alvo = o.clone().add(v3(aoff));
      fov = pl.fov ?? 30;
    } else {
      const de = pl.de; const para = pl.para || pl.de;
      pos = v3(de.pos).lerp(v3(para.pos), p);
      alvo = v3(de.alvo).lerp(v3(para.alvo), p);
      fov = lerp(de.fov ?? 30, para.fov ?? de.fov ?? 30, p);
    }
    if (pl.tremor) {
      const a = pl.tremor;
      pos.x += ruido1(t * 0.7, 1) * a; pos.y += ruido1(t * 0.6, 2) * a * 0.6;
      alvo.x += ruido1(t * 0.5, 3) * a * 0.5;
    }
    return { pos, alvo, fov, plano: pl, indice: indice(t), progresso: p };
  }
  return {
    lista: ps,
    indice,
    estado,
    aplicar(t, palco) {
      const e = estado(t);
      const cam = palco.camera;
      cam.position.copy(e.pos);
      cam.fov = e.fov; cam.updateProjectionMatrix();
      cam.lookAt(e.alvo);
      const f = e.plano.foco || {};
      if (f.ponto) palco.focarEm(v3(f.ponto), f.abertura ?? null, f.maximo ?? null);
      else palco.focarEm(e.alvo, f.abertura ?? null, f.maximo ?? null);
      return e;
    },
  };
}

// Atalhos para montar planos comuns.
export const mov = {
  // empurra a câmera em direção ao alvo (de dist0 para dist1), na direção dada (graus de azimute, altura)
  aproximar(alvo, { ini, fim, azimute = 20, elevacao = 12, dist: [d0, d1] = [6, 3], fov = 30, ease = 'io', foco } = {}) {
    const a = THREE.MathUtils.degToRad(azimute); const e = THREE.MathUtils.degToRad(elevacao);
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const c = v3(alvo);
    return { ini, fim, ease, foco, de: { pos: c.clone().addScaledVector(dir, d0).toArray(), alvo: c.toArray(), fov }, para: { pos: c.clone().addScaledVector(dir, d1).toArray(), alvo: c.toArray(), fov } };
  },
  // recua e sobe revelando a escala (bom para "500 mil")
  revelar(alvo, { ini, fim, de = [0, 1.4, 3], para = [0, 9, 16], fov = 32, ease = 'io' } = {}) {
    const c = v3(alvo);
    return { ini, fim, ease, de: { pos: c.clone().add(v3(de)).toArray(), alvo: c.toArray(), fov }, para: { pos: c.clone().add(v3(para)).toArray(), alvo: c.clone().add(new THREE.Vector3(0, 0, -para[2] * 0.4)).toArray(), fov } };
  },
  orbita(centro, { ini, fim, raio = 4, altura = 1.6, ang = [20, 60], alvoY = null, fov = 30, ease = 'io' } = {}) {
    return { ini, fim, ease, tipo: 'orbita', centro, raio, altura, ang, alvoY, fov };
  },
  fixo(pos, alvo, { ini, fim, fov = 30, tremor = 0 } = {}) {
    return { ini, fim, de: { pos, alvo, fov }, tremor };
  },
};
