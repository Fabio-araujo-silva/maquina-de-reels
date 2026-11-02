// Estágio "trilha": música em loop com a duração exata do vídeo + efeitos sonoros nos eventos da linha do tempo.
// Provedores de música: elevenlabs | lemo-pluck | arquivo (caminho) | sem.
// Provedores de efeitos: elevenlabs | lemo-foley | sem.  (cache em biblioteca/sfx/<provedor>/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, gravarJSON, lerJSON, existe, python, rodarSync, garantirPasta, agora } from '../../motor/lib/util.mjs';
import { construirLinha } from '../../motor/lib/linha.mjs';
import { temChaveEleven, gerarMusica, gerarEfeito } from '../../motor/lib/elevenlabs.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Prompts dos efeitos da ElevenLabs (em inglês: o modelo entende melhor). 2–3 tomadas para os repetidos.
export const KIT_ELEVEN = {
  whoosh: { n: 3, d: 0.8, p: 'Soft fast whoosh transition, airy clean swish, short, no music' },
  pop: { n: 2, d: 0.5, p: 'Short soft UI pop, bubbly satisfying click, clean, minimal' },
  tick: { n: 2, d: 0.5, p: 'Tiny crisp UI tick, very short soft click' },
  nega: { n: 1, d: 0.6, p: 'Short soft negative UI error blip, subtle low buzz' },
  impacto: { n: 1, d: 1.4, p: 'Soft deep cinematic impact hit with short airy tail' },
  riser: { n: 1, d: 1.5, p: 'Short airy tension riser swelling upward, 1.5 seconds' },
  papel: { n: 2, d: 0.7, p: 'Quick paper cutout sliding on a wooden table, paper swipe' },
  clique: { n: 1, d: 0.5, p: 'Plastic button press click, crisp electronic beep confirm' },
};
const GANHO = { whoosh: 0.45, pop: 0.55, tick: 0.45, nega: 0.5, impacto: 0.6, riser: 0.4, papel: 0.5, clique: 0.55 };

const HUMOR = { 'didatico-confiante': 'didatico', 'curioso-espantado': 'curioso', 'urgente-polemico': 'urgente', 'humor-seco': 'humor' };

function promptMusica(cfg, linha) {
  const estilo = {
    'diorama-3d': 'light curious documentary underscore, soft marimba and pizzicato strings pulse, gentle light percussion',
    'colagem-halftone': 'quirky editorial underscore, plucked kalimba, muted guitar, soft claps, playful',
    'lemo:tilt-shift': 'minimalist tuned percussion, marimba and glockenspiel phasing pulse, Steve Reich inspired',
    dinamico: 'versatile modern explainer underscore that works under changing visual scenes, warm pads, soft plucks and light percussion with a steady pulse',
  }[cfg.estilo] || 'clean modern explainer underscore, soft plucks and light percussion';
  const humor = {
    'didatico-confiante': 'confident, steady, optimistic', 'curioso-espantado': 'curious, wondering, light',
    'urgente-polemico': 'tense, driving, minor key', 'humor-seco': 'playful, slightly quirky',
  }[cfg.tom] || 'steady and engaging';
  return `${estilo}; ${humor}; around 105 BPM; warm, pleasant and melodic, polished modern production, full but soft low end, smooth high end, no harsh, shrill or distorted sounds; constant energy from start to end, no intro, no outro, no big drops, no vocals; designed to loop seamlessly under a voiceover for a ${Math.round(linha.total)} second vertical video.`;
}

export async function executar(estagio, ctx) {
  const cfg = ctx.config;
  const pastaT = garantirPasta(path.join(ctx.pasta, 'trilha'));
  ctx.progresso('trilha', 5, 'Montando a linha do tempo');
  const linha = construirLinha(ctx);
  const meta = { criado_em: agora(), total: linha.total };

  // ---------- música ----------
  let prov = cfg.musica || 'elevenlabs';
  if (prov === 'elevenlabs' && !temChaveEleven()) { ctx.log('aviso', 'Sem ELEVENLABS_API_KEY: música feita pelo lemo-opuscar (offline).'); prov = 'lemo-pluck'; }
  const loopFinal = path.join(pastaT, 'musica_loop.wav');
  // Refazer a trilha só para mexer nos efeitos não gera outra música (custo e faixa nova): mesma duração,
  // mesmo provedor e mesmo pedido = reaproveita. Para forçar outra música: config "musica_nova": true.
  const metaAnt = lerJSON(path.join(pastaT, 'meta.json'), null);
  const promptAtual = prov === 'elevenlabs' ? (cfg.musica_prompt || promptMusica(cfg, linha)) : null;
  const reaproveitar = !cfg.musica_nova && existe(loopFinal) && metaAnt?.musica && Math.abs((metaAnt.total ?? -1) - linha.total) < 0.05
    && metaAnt.musica.provedor === (prov === 'arquivo' ? 'arquivo' : prov) && (prov !== 'elevenlabs' || metaAnt.musica.prompt === promptAtual);
  if (reaproveitar) {
    meta.musica = { ...metaAnt.musica, reaproveitada: true };
    ctx.log('info', 'Música reaproveitada (mesma duração e mesmo pedido): só os efeitos foram refeitos.');
  } else if (prov === 'sem') {
    meta.musica = { provedor: 'sem' };
  } else if (prov === 'lemo-pluck') {
    ctx.progresso('trilha', 15, 'Compondo trilha em loop (lemo-opuscar)');
    const r = python([path.join(AQUI, 'compor_lemo.py'), '--duracao', String(linha.total), '--saida', loopFinal, '--humor', HUMOR[cfg.tom] || 'didatico', '--seed', String(semente(ctx.id))]);
    if (r.codigo !== 0) throw new Error(`Composição lemo falhou: ${ultimas(r)}`);
    meta.musica = { provedor: 'lemo-pluck', ...json(r.saida) };
  } else {
    let bruta = path.join(pastaT, 'musica_bruta.wav');
    let musicaEleven = null;
    if (prov === 'elevenlabs') {
      ctx.progresso('trilha', 15, 'Gerando trilha na ElevenLabs Music');
      const prompt = cfg.musica_prompt || promptMusica(cfg, linha);
      try {
        const { dados, meta: m } = await gerarMusica({ prompt, duracaoMs: (linha.total + 6) * 1000, modelo: cfg.musica_modelo || 'music_v1' });
        const mp3 = path.join(pastaT, 'musica_eleven.mp3');
        fs.writeFileSync(mp3, dados);
        const cr = Number(m.cabecalhos?.['character-cost']);
        ctx.elevenlabs({ tipo: 'musica', caracteres: 0, creditos: Number.isFinite(cr) ? cr : null, segundos: Math.round(linha.total + 6), cabecalhos: m.cabecalhos, prompt });
        converter(mp3, bruta);
        meta.musica = { provedor: 'elevenlabs', prompt };
        musicaEleven = true;
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) throw e;
        ctx.log('aviso', 'ElevenLabs Music recusou (' + e.message.slice(0, 120) + '). Trilha feita pelo lemo-opuscar.');
        musicaEleven = false;
      }
    }
    if (musicaEleven === false) {
      const r = python([path.join(AQUI, 'compor_lemo.py'), '--duracao', String(linha.total), '--saida', loopFinal, '--humor', HUMOR[cfg.tom] || 'didatico', '--seed', String(semente(ctx.id))]);
      if (r.codigo !== 0) throw new Error('Composição lemo falhou: ' + ultimas(r));
      meta.musica = { provedor: 'lemo-pluck', motivo: 'sem permissão na ElevenLabs', ...json(r.saida) };
    } else if (musicaEleven === true) {
      // segue para o corte em loop abaixo
    } else {
      const arq = prov === 'arquivo' ? cfg.musica_arquivo : prov;
      if (!arq || !existe(arq)) throw new Error(`Arquivo de música não encontrado: "${arq}". Use config musica_arquivo ou responda o menu com o caminho.`);
      converter(arq, bruta);
      meta.musica = { provedor: 'arquivo', origem: arq };
    }
    if (musicaEleven !== false) {
      ctx.progresso('trilha', 45, 'Cortando a música em loop sem emenda');
      const r = python([path.join(AQUI, 'loop.py'), '--entrada', bruta, '--duracao', String(linha.total), '--saida', loopFinal]);
      if (r.codigo !== 0) throw new Error('Loop da música falhou: ' + ultimas(r));
      Object.assign(meta.musica, json(r.saida));
    }
  }

  // ---------- efeitos ----------
  let provSfx = cfg.sfx || 'elevenlabs';
  if (provSfx === 'elevenlabs' && !temChaveEleven()) { ctx.log('aviso', 'Sem ELEVENLABS_API_KEY: efeitos do lemo-opuscar (offline).'); provSfx = 'lemo-foley'; }
  const eventos = [];
  if (provSfx !== 'sem' && linha.sfx.length) {
    ctx.progresso('trilha', 60, 'Preparando a biblioteca de efeitos');
    let kit;
    try { kit = await garantirKit(provSfx, ctx); }
    catch (e) {
      if (provSfx !== 'elevenlabs' || (e.status !== 401 && e.status !== 403)) throw e;
      ctx.log('aviso', 'ElevenLabs SFX recusou (' + e.message.slice(0, 120) + '). Efeitos do lemo-opuscar.');
      provSfx = 'lemo-foley';
      kit = await garantirKit(provSfx, ctx);
    }
    const usados = {};
    for (const ev of linha.sfx) {
      const opcoes = kit[ev.tipo] || kit.pop;
      if (!opcoes?.length) continue;
      const i = (usados[ev.tipo] = (usados[ev.tipo] ?? -1) + 1) % opcoes.length;
      eventos.push({ t: ev.t, tipo: ev.tipo, arquivo: opcoes[i], ganho: GANHO[ev.tipo] ?? 0.5, motivo: ev.motivo });
    }
  }
  gravarJSON(path.join(pastaT, 'sfx_eventos.json'), eventos);
  meta.sfx = { provedor: provSfx, eventos: eventos.length };
  gravarJSON(path.join(pastaT, 'meta.json'), meta);
  return { status: 'concluido', nota: `música ${meta.musica.provedor}${meta.musica.bpm ? ` (${meta.musica.bpm} BPM)` : ''} · ${eventos.length} efeitos (${provSfx})` };
}

async function garantirKit(prov, ctx) {
  const dir = garantirPasta(path.join(P.biblioteca, 'sfx', prov === 'elevenlabs' ? 'elevenlabs' : 'lemo'));
  if (prov === 'lemo-foley') {
    if (!existe(path.join(dir, 'whoosh_1.wav'))) {
      const r = python([path.join(AQUI, 'foley_lemo.py'), '--saida-dir', dir]);
      if (r.codigo !== 0) throw new Error(`Foley lemo falhou: ${ultimas(r)}`);
    }
  } else {
    for (const [tipo, k] of Object.entries(KIT_ELEVEN)) {
      for (let i = 1; i <= k.n; i++) {
        const arq = path.join(dir, `${tipo}_${i}.mp3`);
        if (existe(arq)) continue;
        ctx.progresso('trilha', 65, `ElevenLabs SFX: ${tipo} ${i}/${k.n} (uma vez só)`);
        const { dados, meta } = await gerarEfeito({ texto: k.p, duracao: k.d });
        fs.writeFileSync(arq, dados);
        const cr = Number(meta.cabecalhos?.['character-cost']);
        ctx.elevenlabs({ tipo: 'sfx', caracteres: 0, creditos: Number.isFinite(cr) ? cr : null, segundos: k.d, cabecalhos: meta.cabecalhos, efeito: tipo });
      }
    }
  }
  const kit = {};
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^([a-z]+)_(\d+)\.(wav|mp3)$/);
    if (m) (kit[m[1]] ||= []).push(path.join(dir, f));
  }
  for (const k of Object.keys(kit)) kit[k].sort();
  return kit;
}

function converter(origem, destino) {
  const r = rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', origem, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', destino]);
  if (r.codigo !== 0) throw new Error(`ffmpeg não converteu ${origem}: ${r.erro.slice(0, 300)}`);
}
function json(s) { try { return JSON.parse(String(s).trim().split('\n').pop()); } catch { return {}; } }
function ultimas(r) { return String(r.erro || r.saida).split('\n').filter(Boolean).slice(-3).join(' | '); }
function semente(id) { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 997; }
