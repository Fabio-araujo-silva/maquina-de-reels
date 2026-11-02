// Menu de montagem: transforma config/menu.json em lotes prontos para o AskUserQuestion
// e traduz as respostas (rótulo, valor ou texto livre) de volta para a config do vídeo.
import path from 'node:path';
import { P, lerJSON, existe, temChave } from './util.mjs';
import { catalogoFinal } from '../../modulos/voz/vozes.mjs';

export function carregarMenu() { return lerJSON(path.join(P.config, 'menu.json')); }
export function carregarPadroes() { return lerJSON(path.join(P.config, 'padroes.json')); }

const GENERO = { male: 'masculina', female: 'feminina' };
export function opcaoDeVoz(v, provedor = 'elevenlabs') {
  return {
    valor: `${provedor}:${v.voice_id}`,
    rotulo: String(v.nome || v.voice_id).slice(0, 40),
    descricao: [GENERO[v.genero] || v.genero, v.origem, v.descricao].filter(Boolean).join(' · ').slice(0, 160) || 'Voz da ElevenLabs',
  };
}

function opcoesDinamicas(q, padroes) {
  if (q.dinamica === 'vozes') {
    const fav = catalogoFinal().favoritas.slice(0, 4);
    if (fav.length >= 2) return fav.map((v) => opcaoDeVoz(v));
  }
  if (q.dinamica === 'marca') {
    return q.opcoes.map((o) => o.valor === '__salvo__'
      ? { ...o, rotulo: `${padroes.marca_nome || 'Nome salvo'}`.slice(0, 40), descricao: `Selo "${(padroes.marca_nome || '').toUpperCase()} · TEMA" no topo (nome salvo).` }
      : o);
  }
  return q.opcoes;
}

// Monta lotes de até 4 perguntas, cada uma com 2 a 4 opções, padrão primeiro e marcado.
export function perguntasMenu() {
  const menu = carregarMenu();
  const padroes = carregarPadroes();
  const lotes = [];
  const mapa = {};
  for (const lote of menu.lotes) {
    const qs = menu.perguntas.filter((q) => q.lote === lote.id);
    for (let i = 0; i < qs.length; i += 4) {
      const fatia = qs.slice(i, i + 4);
      const perguntas = fatia.map((q) => {
        let padrao = padroes.respostas?.[q.id] ?? q.padrao;
        let opcoes = opcoesDinamicas(q, padroes).slice();
        if (q.dinamica === 'vozes') {
          const cat = catalogoFinal();
          if (/^elevenlabs:auto-(masculina|feminina)$/.test(String(padrao))) {
            const v = cat.auto?.[String(padrao).endsWith('feminina') ? 'feminina' : 'masculina'];
            if (v) padrao = 'elevenlabs:' + v.voice_id;
          }
          // padrão é uma voz fora das favoritas: cria a opção com o nome dela
          const [prov, vid] = String(padrao).split(/:(.*)/s);
          const v = prov === 'kokoro' ? cat.kokoro.find((x) => x.voice_id === vid) : cat.todas.find((x) => x.voice_id === vid);
          if (v && !opcoes.some((o) => o.valor === padrao)) opcoes.unshift(opcaoDeVoz(v, prov));
        }
        // padrão primeiro; se o padrão é um valor fora da lista (ex.: estilo lemo), cria a opção
        let iPad = opcoes.findIndex((o) => o.valor === padrao);
        if (iPad < 0 && padrao) {
          opcoes.unshift({ valor: padrao, rotulo: String(padrao).replace(/^lemo:/, 'lemo: ').slice(0, 40), descricao: 'Seu padrão salvo.' });
          iPad = 0;
        }
        if (iPad > 0) { const [o] = opcoes.splice(iPad, 1); opcoes.unshift(o); }
        opcoes = opcoes.slice(0, 4);
        mapa[q.id] = {};
        const options = opcoes.map((o, k) => {
          const label = (k === 0 ? `${o.rotulo} (padrão)` : o.rotulo).slice(0, 60);
          mapa[q.id][label] = o.valor;
          mapa[q.id][o.rotulo] = o.valor;
          mapa[q.id][o.valor] = o.valor;
          return { label, description: o.descricao };
        });
        return { question: q.pergunta, header: q.cabecalho.slice(0, 12), multiSelect: false, options };
      });
      // "questions" vai direto para o AskUserQuestion; "ids" diz a que pergunta do menu cada uma corresponde
      lotes.push({ titulo: lote.titulo, questions: perguntas, ids: fatia.map((q) => q.id) });
    }
  }
  return { lotes, mapa };
}

export function respostasPadrao() {
  const menu = carregarMenu();
  const padroes = carregarPadroes();
  const r = {};
  for (const q of menu.perguntas) r[q.id] = padroes.respostas?.[q.id] ?? q.padrao;
  return r;
}

// respostas: { id: valor | rótulo | texto livre }  (também aceita chave = texto da pergunta)
export function resolverRespostas(respostas) {
  const menu = carregarMenu();
  const padroes = carregarPadroes();
  const { mapa } = perguntasMenu();
  const config = {};
  const outros = {};
  const avisos = [];
  for (const q of menu.perguntas) {
    let bruto = respostas[q.id];
    if (bruto === undefined) bruto = respostas[q.pergunta];
    if (bruto === undefined || bruto === null || bruto === '') { config[q.id] = padroes.respostas?.[q.id] ?? q.padrao; continue; }
    bruto = String(bruto).trim();
    const valor = mapa[q.id]?.[bruto] ?? mapa[q.id]?.[bruto.replace(/\s*\(padrão\)\s*$/, '')];
    if (valor !== undefined) config[q.id] = valor;
    else { config[q.id] = bruto; outros[q.id] = bruto; }
  }
  // resolve marca
  if (config.marca === '__salvo__') config.marca_nome = padroes.marca_nome || '';
  else if (config.marca === '__sem__') config.marca_nome = '';
  else { config.marca_nome = config.marca; }
  config.marca_cores = padroes.marca_cores;
  config.voz_ajustes = { ...(padroes.voz_ajustes || {}) };
  config.palavras_por_segundo = padroes.palavras_por_segundo || 2.75;
  config.lead_in_s = padroes.lead_in_s ?? 0.25;
  config.cauda_s = padroes.cauda_s ?? 0.45;
  // ajustes finos salvos no painel (Configurações): mixagem, legenda, render, verificação de voz…
  for (const [k, v] of Object.entries(padroes.ajustes || {})) {
    if (k === 'obs') continue;
    if (config[k] === undefined && v !== '' && v !== null && v !== undefined) config[k] = v;
  }
  // "Other" com um voice_id puro vira elevenlabs:<id>
  if (outros.voz && /^[A-Za-z0-9]{10,40}$/.test(String(config.voz))) config.voz = `elevenlabs:${config.voz}`;
  // estilos lemo digitados sem prefixo
  if (outros.estilo && !String(config.estilo).includes(':') && existe(path.join(P.externos, 'lemo-opuscar', 'styles', config.estilo, 'STYLE.md'))) {
    config.estilo = `lemo:${config.estilo}`;
  }
  // avisos de chaves
  const precisaEleven = String(config.voz).startsWith('elevenlabs') || config.musica === 'elevenlabs' || config.sfx === 'elevenlabs';
  if (precisaEleven && !temChave('ELEVENLABS_API_KEY')) {
    avisos.push('ELEVENLABS_API_KEY ainda não está no .env: voz cai para Kokoro, música para lemo-pluck e efeitos para lemo-foley até a chave chegar.');
  }
  if (config.broll === 'gemini' && !temChave('GEMINI_API_KEY')) {
    avisos.push('Colagem Gemini escolhida sem GEMINI_API_KEY: as colagens serão feitas pelo motor em código (grátis).');
  }
  if (String(config.estilo).startsWith('lemo:')) {
    const s = String(config.estilo).slice(5);
    if (!existe(path.join(P.externos, 'lemo-opuscar', 'styles', s, 'STYLE.md'))) avisos.push(`Estilo lemo "${s}" não encontrado em externos/lemo-opuscar/styles. Rode "rs estilos" para ver a lista.`);
  }
  return { config, outros, avisos };
}

export function salvarComoPadrao(config) {
  const arq = path.join(P.config, 'padroes.json');
  const pad = lerJSON(arq);
  const menu = carregarMenu();
  for (const q of menu.perguntas) if (config[q.id] !== undefined) pad.respostas[q.id] = config[q.id];
  if (config.marca && !['__salvo__', '__sem__'].includes(config.marca)) { pad.marca_nome = config.marca; pad.respostas.marca = '__salvo__'; }
  return pad;
}
