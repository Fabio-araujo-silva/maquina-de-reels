// Estágio "mixagem": voz + música + efeitos → mix/mix.wav (48 kHz, estéreo, −14 LUFS, pico −1,5 dBTP), cíclico.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gravarJSON, lerJSON, existe, python, rodarSync, garantirPasta, agora, P } from '../../motor/lib/util.mjs';
import { lerLinha } from '../../motor/lib/linha.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export async function executar(estagio, ctx) {
  const cfg = ctx.config;
  const linha = lerLinha(ctx.pasta);
  const pastaM = garantirPasta(path.join(ctx.pasta, 'mix'));
  const bruto = path.join(pastaM, 'mix_bruto.wav');
  const musica = path.join(ctx.pasta, 'trilha', 'musica_loop.wav');
  ctx.progresso('mixagem', 10, 'Mixando voz, música e efeitos (circular)');
  const args = [path.join(AQUI, 'mix.py'), '--voz', path.join(ctx.pasta, 'voz', 'narracao.wav'), '--eventos', path.join(ctx.pasta, 'trilha', 'sfx_eventos.json'),
    '--lead-in', String(linha.lead_in), '--total', String(linha.total), '--saida', bruto];
  if (existe(musica)) args.push('--musica', musica);
  // música por loudness relativa à voz (os antigos musica_db/duck_db em RMS não valem mais)
  const aj = lerJSON(path.join(P.config, 'padroes.json'), {}).ajustes || {};
  const nivel = (k) => cfg[k] ?? aj[k];
  if (nivel('musica_rel') != null) args.push('--musica-rel', String(nivel('musica_rel')));
  if (nivel('musica_abaixa') != null) args.push('--abaixa-db', String(nivel('musica_abaixa')));
  if (nivel('musica_bolsao') != null) args.push('--bolsao-db', String(nivel('musica_bolsao')));
  const r = python(args);
  if (r.codigo !== 0) throw new Error(`Mixagem falhou: ${String(r.erro || r.saida).split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  const resumo = JSON.parse(r.saida.trim().split('\n').pop());

  // loudnorm em 2 passes (−14 LUFS integrado, −1,5 dBTP)
  ctx.progresso('mixagem', 60, 'Normalizando loudness (−14 LUFS)');
  const alvo = { I: cfg.lufs ?? -14, TP: -1.5, LRA: 11 };
  const m1 = rodarSync('ffmpeg', ['-hide_banner', '-nostats', '-i', bruto, '-af', `loudnorm=I=${alvo.I}:TP=${alvo.TP}:LRA=${alvo.LRA}:print_format=json`, '-f', 'null', '-']);
  const medido = extrairJSON(m1.erro);
  const final = path.join(pastaM, 'mix.wav');
  let filtro = `loudnorm=I=${alvo.I}:TP=${alvo.TP}:LRA=${alvo.LRA}`;
  if (medido) filtro += `:measured_I=${medido.input_i}:measured_TP=${medido.input_tp}:measured_LRA=${medido.input_lra}:measured_thresh=${medido.input_thresh}:offset=${medido.target_offset}:linear=true`;
  const m2 = rodarSync('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', bruto, '-af', `${filtro}:print_format=json`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', final]);
  if (m2.codigo !== 0) throw new Error(`loudnorm falhou: ${m2.erro.slice(-300)}`);
  const depois = extrairJSON(m2.erro);
  // a duração tem que ser exatamente a do vídeo (loudnorm pode mexer em amostras de borda)
  const fixo = path.join(pastaM, 'mix_fixo.wav');
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', final, '-af', `apad=whole_dur=${linha.total}`, '-t', String(linha.total), '-c:a', 'pcm_s16le', fixo]);
  if (existe(fixo)) { fs.rmSync(final); fs.renameSync(fixo, final); }
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', final, '-c:a', 'libmp3lame', '-b:a', '160k', path.join(pastaM, 'previa.mp3')]);
  try { fs.rmSync(bruto); } catch {}
  const meta = {
    criado_em: agora(), total: linha.total, lead_in: linha.lead_in, efeitos: resumo.efeitos,
    lufs_antes: medido ? Number(medido.input_i) : null, lufs: depois ? Number(depois.output_i) : null, true_peak: depois ? Number(depois.output_tp) : null,
    musica: resumo.musica_sob_a_fala_lu != null ? { sob_a_fala_lu: resumo.musica_sob_a_fala_lu, nas_pausas_lu: resumo.musica_nas_pausas_lu, alvo_lu: resumo.alvo_sob_a_fala_lu, oscilacao_db_s: resumo.oscilacao_db_s } : null,
  };
  gravarJSON(path.join(pastaM, 'meta.json'), meta);
  ctx.arquivo('mix', 'mix/mix.wav');
  ctx.arquivo('previa_audio', 'mix/previa.mp3');
  return { status: 'concluido', nota: `${linha.total.toFixed(2)} s · ${meta.lufs ?? '?'} LUFS · ${resumo.efeitos} efeitos${meta.musica ? ` · música ${meta.musica.sob_a_fala_lu} LU sob a voz` : ''}` };
}

function extrairJSON(txt) {
  const i = String(txt).lastIndexOf('{'); const j = String(txt).lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(txt.slice(i, j + 1)); } catch { return null; }
}
