// Catálogo de estilos: os da casa (estilos/<id>/) + os 66 do lemo-opuscar (externos/lemo-opuscar/styles/<slug>/).
import fs from 'node:fs';
import path from 'node:path';
import { P, lerJSON, existe } from '../../motor/lib/util.mjs';

export function listarEstilos() {
  const out = [{
    id: 'dinamico', nome: 'Dinâmico (o Claude escolhe por cena)', grupo: 'Casa', modelo: 'dinamico', poster: null, doc: 'modulos/montagem/STORYBOARD.md',
    descricao: 'O Claude escolhe o estilo de cada trecho pelo que ele precisa mostrar e pode misturar até 3 (diorama 3D, colagem, estilos do lemo-opuscar).',
  }];
  if (existe(P.estilos)) {
    for (const d of fs.readdirSync(P.estilos, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const meta = lerJSON(path.join(P.estilos, d.name, 'estilo.json'), {});
      out.push({ id: d.name, nome: meta.nome || d.name, grupo: 'Casa', descricao: meta.descricao || '', doc: `estilos/${d.name}/STYLE.md`, modelo: meta.modelo || 'diorama', poster: existe(path.join(P.estilos, d.name, 'poster.jpg')) ? `estilos/${d.name}/poster.jpg` : null });
    }
  }
  const lemo = path.join(P.externos, 'lemo-opuscar', 'styles');
  if (existe(lemo)) {
    for (const d of fs.readdirSync(lemo, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('_')) continue;
      const sj = lerJSON(path.join(lemo, d.name, 'style.json'), null);
      if (!sj) continue;
      out.push({
        id: `lemo:${d.name}`, nome: sj.en || d.name, grupo: sj.category_en || 'lemo-opuscar',
        descricao: [sj.cn, sj.uses?.length ? `bom para: ${sj.uses.join(', ')}` : '', sj.line].filter(Boolean).join(' · ').slice(0, 220),
        doc: `externos/lemo-opuscar/styles/${d.name}/STYLE.md`, modelo: 'lemo',
        poster: existe(path.join(lemo, d.name, 'poster.jpg')) ? `externos/lemo-opuscar/styles/${d.name}/poster.jpg` : null,
      });
    }
  }
  return out;
}

export function estiloPorId(id) { return listarEstilos().find((e) => e.id === id) || null; }
