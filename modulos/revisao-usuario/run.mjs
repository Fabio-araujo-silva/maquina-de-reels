// Estágio "revisao_usuario" (Sua revisão): prepara uma rodada para você revisar o vídeo pronto
// cena a cena no painel (3 quadros por fala, do vídeo FINAL) e para, esperando a sua decisão.
// Você aprova (→ entrega) ou pede ajustes por cena (→ o Claude aplica, re-renderiza e uma rodada nova volta para você).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { P, lerJSON, existe, garantirPasta, agora, ffprobeDuracao } from '../../motor/lib/util.mjs';
import { lerLinha } from '../../motor/lib/linha.mjs';
import { listarRodadas, gravarRodada, TIPOS } from './rodadas.mjs';

// um quadro do vídeo final (seek rápido antes do -i); várias extrações em paralelo
function extrairQuadro(video, t, saida) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=270:-1', '-q:v', '4', saida], { windowsHide: true, stdio: 'ignore' });
    p.on('close', (c) => resolve(c === 0)); p.on('error', () => resolve(false));
  });
}
async function emParalelo(tarefas, n = 6) {
  const res = new Array(tarefas.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, async () => { while (i < tarefas.length) { const k = i++; res[k] = await tarefas[k](); } }));
  return res;
}

// Todos os quadros numa passada só pelo vídeo (select por número do quadro): cada quadro é decodificado uma vez.
// Devolve um array de booleanos (um por tarefa) ou null se a passada falhar.
async function passadaUnica(video, tarefas, fps, total, tmp, pasta) {
  fs.rmSync(tmp, { recursive: true, force: true });
  garantirPasta(tmp);
  const ultimo = Math.max(0, Math.floor(total * fps) - 1);
  const ns = tarefas.map((x) => Math.min(ultimo, Math.max(0, Math.round(x.t * fps))));
  const unicos = [...new Set(ns)].sort((a, b) => a - b);
  const sel = unicos.map((k) => `eq(n\\,${k})`).join('+');
  const codigo = await new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', `select='${sel}',scale=270:-1`, '-fps_mode', 'passthrough', '-q:v', '4', path.join(tmp, 'q_%04d.jpg')], { windowsHide: true, stdio: 'ignore' });
    p.on('close', resolve); p.on('error', () => resolve(-1));
  });
  const saidas = existe(tmp) ? fs.readdirSync(tmp).filter((f) => /^q_\d{4}\.jpg$/.test(f)).sort() : [];
  if (codigo !== 0 || saidas.length !== unicos.length) { fs.rmSync(tmp, { recursive: true, force: true }); return null; }
  const res = tarefas.map((x, k) => {
    try { fs.copyFileSync(path.join(tmp, saidas[unicos.indexOf(ns[k])]), path.join(pasta, ...x.rel.split('/'))); return true; } catch { return false; }
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return res;
}

export function ativa(cfg) {
  const pad = lerJSON(path.join(P.config, 'padroes.json'), {});
  return (cfg?.revisao_usuario ?? pad.respostas?.revisao_usuario ?? 'sim') !== 'nao';
}

export async function executar(estagio, ctx) {
  if (!ativa(ctx.config)) return { status: 'pulado', nota: 'sem a sua revisão (config revisao_usuario = nao)' };
  const rel = 'out/render.mp4';
  const video = path.join(ctx.pasta, rel);
  if (!existe(video)) throw new Error('out/render.mp4 não existe: a sua revisão precisa do vídeo renderizado.');
  const mtime = Math.round(fs.statSync(video).mtimeMs);
  const rods = listarRodadas(ctx.pasta);
  const ult = rods.at(-1);

  // Você pediu ajustes e o vídeo ainda não foi renderizado de novo: não abre rodada nova com o mesmo vídeo.
  if (ult?.decisao === 'ajustes' && mtime <= Date.parse(ult.decidido_em || 0)) {
    return {
      status: 'aguardando_claude',
      instrucoes: `O usuário pediu ajustes na rodada ${ult.rodada} da revisão dele e o vídeo ainda não mudou. Siga modulos/revisao-usuario/MODULO.md: \`node motor/rs.mjs cenas ${ctx.id}\` mostra os pedidos; corrija, responda com \`rs cenas ${ctx.id} --responder\`, \`rs refazer ${ctx.id} <estagio>\` e \`rs auto ${ctx.id}\`.`,
    };
  }

  // rodada ainda aberta (ex.: re-render sem decisão sua) é refeita no mesmo número; senão abre a próxima
  const n = ult && !ult.decisao ? ult.rodada : (ult ? ult.rodada + 1 : 1);
  const linha = lerLinha(ctx.pasta);
  const roteiro = ctx.roteiro();
  const porId = Object.fromEntries((roteiro.falas || []).map((f) => [f.id, f]));
  const caps = Object.fromEntries((linha.capitulos || []).map((c) => [c.id, c.rotulo]));
  const total = ffprobeDuracao(video) || linha.total;

  const dirQ = garantirPasta(path.join(ctx.pasta, 'revisao-usuario', `rodada-${n}`, 'quadros'));
  for (const f of fs.readdirSync(dirQ)) fs.rmSync(path.join(dirQ, f), { force: true });

  // 3 quadros por cena (15%, meio, 85%)
  const planos = linha.falas.map((f, i) => {
    const a = i === 0 ? 0 : f.inicio;
    const b = i === linha.falas.length - 1 ? total : linha.falas[i + 1].inicio;
    const tempos = [a + (b - a) * 0.15, (a + b) / 2, a + (b - a) * 0.85].map((t) => Math.min(total - 0.05, Math.max(0.04, t)));
    return { f, i, a, b, tempos };
  });
  const tarefas = planos.flatMap(({ f, tempos }) => tempos.map((t, k) => ({ t, rel: `revisao-usuario/rodada-${n}/quadros/${f.id}_${k + 1}.jpg` })));
  ctx.progresso('revisao_usuario', 10, 'Separando as cenas para você revisar');
  let ok = await passadaUnica(video, tarefas, linha.fps || 30, total, path.join(ctx.pasta, 'revisao-usuario', `rodada-${n}`, '_tmp'), ctx.pasta);
  if (!ok) {
    // reserva: um ffmpeg por quadro (mais lento: cada busca decodifica desde o keyframe anterior)
    let feitas = 0;
    ok = await emParalelo(tarefas.map((x) => async () => {
      const r = await extrairQuadro(video, x.t, path.join(ctx.pasta, ...x.rel.split('/')));
      feitas++;
      if (feitas % 6 === 0 || feitas === tarefas.length) ctx.progresso('revisao_usuario', Math.round((feitas / tarefas.length) * 95), `Separando as cenas para você revisar (${feitas}/${tarefas.length} quadros)`);
      return r;
    }));
  }
  const okRel = new Set(tarefas.filter((_, k) => ok[k]).map((x) => x.rel));

  const cenas = [];
  planos.forEach(({ f, i, a, b, tempos }) => {
    const quadros = [1, 2, 3].map((k) => `revisao-usuario/rodada-${n}/quadros/${f.id}_${k}.jpg`).filter((rel) => okRel.has(rel));
    const rf = porId[f.id] || {};
    cenas.push({
      fala: f.id, indice: i, capitulo: f.capitulo, capitulo_rotulo: caps[f.capitulo] || f.capitulo,
      inicio: Math.round(a * 100) / 100, fim: Math.round(b * 100) / 100, fala_inicio: f.inicio, fala_fim: f.fim,
      texto: f.texto, funcao: f.funcao || rf.funcao || null, plano: f.plano || rf.plano || '3d', visual: rf.visual || f.visual || '',
      overlay: rf.overlay || null, rotulos: (rf.rotulos || []).map((x) => x.texto),
      tempos: tempos.map((t) => Math.round(t * 100) / 100), quadros,
    });
  });

  gravarRodada(ctx.pasta, {
    rodada: n, criado_em: agora(), video: rel, video_mtime: mtime, duracao: Math.round(total * 100) / 100,
    loop: roteiro.loop ? { frase_final: roteiro.loop.frase_final, frase_inicial: roteiro.loop.frase_inicial } : null,
    cenas, decisao: null, pedidos: [], ok: [], geral: '', respostas: [],
  });
  ctx.log('revisao', `Sua revisão: rodada ${n} pronta (${cenas.length} cenas)`, { estagio });
  return { status: 'aguardando_usuario', nota: `rodada ${n}: revise cena a cena no painel` };
}

export { TIPOS };
