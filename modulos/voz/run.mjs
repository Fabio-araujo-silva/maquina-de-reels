// Estágio "voz": roteiro aprovado → narração + tempo de cada palavra.
// Provedores: ElevenLabs (with-timestamps, tempos por caractere) e Kokoro (offline, tempos via Whisper).
// Saídas em videos/<id>/voz/: narracao.wav, falas.json, palavras.json, meta.json (+ verificacao.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gravarJSON, lerJSON, existe, python, rodarSync, ffprobeDuracao, hf, garantirPasta, agora } from '../../motor/lib/util.mjs';
import { falarComTempos } from '../../motor/lib/elevenlabs.mjs';
import { resolverVoz } from './vozes.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const temLetra = (w) => /[\p{L}\p{N}]/u.test(w);
const normal = (w) => String(w).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// Quebra em palavras de legenda: pontuação solta gruda na palavra anterior.
export function palavrasDe(texto) {
  const out = [];
  for (const tok of String(texto).trim().split(/\s+/)) {
    if (!tok) continue;
    if (!temLetra(tok) && out.length) out[out.length - 1] += ` ${tok}`;
    else out.push(tok);
  }
  return out;
}

export async function executar(estagio, ctx) {
  const r = ctx.roteiro();
  const cfg = ctx.config;
  const pastaVoz = garantirPasta(path.join(ctx.pasta, 'voz'));
  const voz = await resolverVoz(cfg.voz, { log: ctx.log });
  const falas = r.falas.map((f) => ({
    id: f.id,
    textoFalado: String(f.fala || f.texto).trim(),
    legenda: palavrasDe(f.texto),
    falado: palavrasDe(f.fala || f.texto),
  }));
  ctx.progresso('voz', 5, `Voz: ${voz.nome} (${voz.provedor})`);
  let meta;
  if (voz.provedor === 'elevenlabs') meta = await viaElevenLabs(ctx, falas, voz, pastaVoz);
  else meta = await viaKokoro(ctx, falas, voz, pastaVoz);

  // verificação de pronúncia (Whisper) — avisa, não bloqueia
  if (cfg.voz_verificar !== false) {
    ctx.progresso('voz', 85, 'Conferindo a pronúncia com Whisper');
    const txt = path.join(pastaVoz, 'texto_falado.txt');
    fs.writeFileSync(txt, falas.map((f) => f.textoFalado).join(' '), 'utf8');
    const v = python([path.join(AQUI, 'alinhar.py'), '--audio', path.join(pastaVoz, 'narracao.wav'), '--verificar', txt, '--saida', path.join(pastaVoz, 'verificacao.json'), '--modelo', cfg.whisper_modelo || 'small']);
    const ver = lerJSON(path.join(pastaVoz, 'verificacao.json'), null);
    if (ver) {
      meta.verificacao = { acerto: ver.acerto, nao_reconhecidas: ver.nao_reconhecidas.slice(0, 15) };
      if (ver.acerto < 0.85) ctx.log('aviso', `Pronúncia: só ${(ver.acerto * 100).toFixed(0)}% das palavras reconhecidas pelo Whisper. Confira: ${ver.nao_reconhecidas.slice(0, 8).join(', ')}`);
    } else if (v.codigo !== 0) ctx.log('aviso', `Verificação de pronúncia falhou: ${v.erro.split('\n').filter(Boolean).slice(-1)[0] || ''}`);
  }
  gravarJSON(path.join(pastaVoz, 'meta.json'), meta);
  ctx.arquivo('narracao', 'voz/narracao.wav');
  return { status: 'concluido', nota: `${meta.provedor} · ${meta.voz.nome} · ${meta.duracao.toFixed(1)} s${meta.caracteres ? ` · ${meta.caracteres} caracteres` : ''}` };
}

// ---------- ElevenLabs ----------
async function viaElevenLabs(ctx, falas, voz, pastaVoz) {
  const cfg = ctx.config;
  const modelo = cfg.modelo_voz || 'eleven_multilingual_v2';
  const limite = modelo === 'eleven_v3' ? 2800 : 9000;
  // agrupa falas em blocos que caibam no limite de caracteres do modelo
  const blocos = [];
  let atual = [];
  let tam = 0;
  for (const f of falas) {
    if (tam + f.textoFalado.length + 1 > limite && atual.length) { blocos.push(atual); atual = []; tam = 0; }
    atual.push(f); tam += f.textoFalado.length + 1;
  }
  if (atual.length) blocos.push(atual);

  const partes = [];
  let deslocamento = 0;
  let caracteres = 0;
  const falasT = []; const palavrasT = [];
  for (let b = 0; b < blocos.length; b++) {
    const bloco = blocos[b];
    const texto = bloco.map((f) => f.textoFalado).join(' ');
    ctx.progresso('voz', 10 + (70 * b) / blocos.length, `ElevenLabs: bloco ${b + 1}/${blocos.length}`);
    const anterior = b > 0 ? blocos[b - 1].map((f) => f.textoFalado).join(' ').slice(-600) : null;
    const proximo = b < blocos.length - 1 ? blocos[b + 1].map((f) => f.textoFalado).join(' ').slice(0, 600) : null;
    const { dados, meta } = await falarComTempos({ voiceId: voz.voice_id, texto, modelo, ajustes: cfg.voz_ajustes || {}, anterior, proximo, seed: cfg.voz_seed ?? null });
    caracteres += texto.length;
    const creditos = Number(meta.cabecalhos?.['character-cost']);
    ctx.elevenlabs({ tipo: 'tts', caracteres: texto.length, creditos: Number.isFinite(creditos) ? creditos : null, modelo, voz: voz.nome, cabecalhos: meta.cabecalhos });
    const mp3 = path.join(pastaVoz, `bloco_${b + 1}.mp3`);
    fs.writeFileSync(mp3, Buffer.from(dados.audio_base64, 'base64'));
    gravarJSON(path.join(pastaVoz, `bloco_${b + 1}_alinhamento.json`), dados.alignment || dados.normalized_alignment);
    const dur = ffprobeDuracao(mp3);
    const al = dados.alignment || dados.normalized_alignment;
    mapearBloco(bloco, texto, al, deslocamento, falasT, palavrasT);
    partes.push(mp3);
    deslocamento += dur;
  }
  // junta em WAV 48 kHz mono (o mixer trabalha em WAV)
  const lista = path.join(pastaVoz, 'concat.txt');
  fs.writeFileSync(lista, partes.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const wav = path.join(pastaVoz, 'narracao.wav');
  const c = rodarSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  if (c.codigo !== 0) throw new Error(`ffmpeg não juntou a narração: ${c.erro.slice(0, 300)}`);
  gravarJSON(path.join(pastaVoz, 'falas.json'), falasT);
  gravarJSON(path.join(pastaVoz, 'palavras.json'), palavrasT);
  return { provedor: 'elevenlabs', voz, modelo, duracao: ffprobeDuracao(wav), caracteres, blocos: blocos.length, criado_em: agora(), arquivo: 'narracao.wav' };
}

export function mapearBloco(bloco, texto, al, desloc, falasT, palavrasT) {
  const chars = al?.characters || [];
  const ini = al?.character_start_times_seconds || [];
  const fim = al?.character_end_times_seconds || [];
  // índice do texto → índice do alinhamento (normalmente 1:1; senão casamos em sequência)
  let mapa;
  if (chars.join('') === texto) mapa = (i) => i;
  else {
    const m = new Array(texto.length).fill(-1);
    let j = 0;
    for (let i = 0; i < texto.length && j < chars.length; i++) {
      if (texto[i] === chars[j]) { m[i] = j; j++; }
      else if (/\s/.test(texto[i])) continue;
      else { const k = chars.indexOf(texto[i], j); if (k >= 0 && k - j < 6) { m[i] = k; j = k + 1; } }
    }
    mapa = (i) => m[i];
  }
  const tIni = (i) => { for (let k = i; k < texto.length; k++) { const a = mapa(k); if (a >= 0 && a < ini.length) return ini[a]; } return null; };
  const tFim = (i) => { for (let k = i; k >= 0; k--) { const a = mapa(k); if (a >= 0 && a < fim.length) return fim[a]; } return null; };
  let cursor = 0;
  for (const f of bloco) {
    const pos = texto.indexOf(f.textoFalado, cursor);
    const p0 = pos >= 0 ? pos : cursor;
    const p1 = p0 + f.textoFalado.length;
    cursor = p1;
    const fi = (tIni(p0) ?? 0) + desloc;
    const ff = (tFim(p1 - 1) ?? fi + 0.3) + desloc;
    falasT.push({ id: f.id, inicio: r4(fi), fim: r4(ff) });
    // palavras faladas com tempo
    const faladas = [];
    const re = /\S+/g; let m;
    const trecho = texto.slice(p0, p1);
    while ((m = re.exec(trecho))) {
      if (!temLetra(m[0])) continue;
      const a = p0 + m.index; const b = a + m[0].length - 1;
      let s = a; while (s < b && !temLetra(texto[s])) s++;
      let e = b; while (e > s && !temLetra(texto[e])) e--;
      faladas.push({ texto: m[0], inicio: (tIni(s) ?? fi - desloc) + desloc, fim: (tFim(e) ?? ff - desloc) + desloc });
    }
    distribuirLegenda(f, faladas, fi, ff, palavrasT);
  }
}

function distribuirLegenda(f, faladas, fi, ff, palavrasT) {
  const igual = f.legenda.length === faladas.length && f.legenda.every((w, i) => normal(w) === normal(faladas[i].texto));
  if (igual) {
    f.legenda.forEach((w, i) => palavrasT.push({ texto: w, inicio: r4(faladas[i].inicio), fim: r4(faladas[i].fim), fala: f.id }));
    return;
  }
  const a = faladas.length ? faladas[0].inicio : fi;
  const b = faladas.length ? faladas[faladas.length - 1].fim : ff;
  const pesos = f.legenda.map((w) => Math.max(1, normal(w).length));
  const tot = pesos.reduce((x, y) => x + y, 0) || 1;
  let t = a;
  f.legenda.forEach((w, i) => { const d = ((b - a) * pesos[i]) / tot; palavrasT.push({ texto: w, inicio: r4(t), fim: r4(t + d), fala: f.id }); t += d; });
}

// ---------- Kokoro (offline) ----------
async function viaKokoro(ctx, falas, voz, pastaVoz) {
  const cfg = ctx.config;
  const entrada = path.join(pastaVoz, 'falas_tts.json');
  gravarJSON(entrada, falas.map((f) => ({ id: f.id, texto: f.textoFalado })));
  const vel = String(cfg.voz_ajustes?.speed ?? 1.0);
  ctx.progresso('voz', 15, `Kokoro: sintetizando ${falas.length} falas`);
  let r = python([path.join(AQUI, 'kokoro_falas.py'), '--entrada', entrada, '--saida-dir', pastaVoz, '--voz', voz.voice_id, '--velocidade', vel]);
  if (r.codigo === 3) {
    ctx.progresso('voz', 18, 'Baixando o modelo Kokoro (uma vez só)');
    hf(['tts', 'teste', '-v', voz.voice_id, '-l', 'pt-br', '-o', path.join(pastaVoz, '_aquecimento.wav'), '--json']);
    r = python([path.join(AQUI, 'kokoro_falas.py'), '--entrada', entrada, '--saida-dir', pastaVoz, '--voz', voz.voice_id, '--velocidade', vel]);
  }
  if (r.codigo !== 0) throw new Error(`Kokoro falhou: ${(r.erro || r.saida).split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  const tempos = lerJSON(path.join(pastaVoz, 'falas_tempos.json'));
  // 24 kHz → 48 kHz para o mixer
  const bruto = path.join(pastaVoz, 'narracao.wav');
  const tmp = path.join(pastaVoz, 'narracao_24k.wav');
  fs.renameSync(bruto, tmp);
  const c = rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', bruto]);
  if (c.codigo !== 0) throw new Error(`ffmpeg: ${c.erro.slice(0, 300)}`);
  fs.unlinkSync(tmp);
  ctx.progresso('voz', 55, 'Alinhando palavras (Whisper)');
  const alinhar = falas.map((f, i) => ({ id: f.id, inicio: tempos[i].inicio, fim: tempos[i].fim, falado: f.falado, legenda: f.legenda }));
  const arqAl = path.join(pastaVoz, 'falas_alinhar.json');
  gravarJSON(arqAl, alinhar);
  const a = python([path.join(AQUI, 'alinhar.py'), '--audio', bruto, '--falas', arqAl, '--saida', path.join(pastaVoz, 'palavras.json'), '--modelo', cfg.whisper_modelo || 'small']);
  if (a.codigo !== 0) throw new Error(`Alinhamento falhou: ${(a.erro || a.saida).split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  gravarJSON(path.join(pastaVoz, 'falas.json'), tempos.map((t) => ({ id: t.id, inicio: r4(t.inicio), fim: r4(t.fim) })));
  return { provedor: 'kokoro', voz, modelo: 'kokoro-v1.0', duracao: ffprobeDuracao(bruto), caracteres: 0, criado_em: agora(), arquivo: 'narracao.wav', alinhamento: JSON.parse(a.saida.trim().split('\n').pop() || '{}') };
}

function r4(x) { return Math.round(x * 10000) / 10000; }
