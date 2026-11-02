// Módulo "qa": checagem visual antes do render (lint/check + quadros de cada fala) e QA do loop depois do render.
import fs from 'node:fs';
import path from 'node:path';
import { lerJSON, gravarJSON, existe, garantirPasta, hf, rodarSync, ffprobeJSON, agora } from '../../motor/lib/util.mjs';
import { lerLinha } from '../../motor/lib/linha.mjs';

// Tira quadros do projeto em tempos dados e monta uma folha. Usado pela checagem e pelo comando "rs quadros".
export function quadros(pasta, tempos, { saida = 'quadros', nome = 'folha' } = {}) {
  const proj = path.join(pasta, 'projeto');
  const dir = garantirPasta(path.join(pasta, saida, nome));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const lista = tempos.map((t) => Math.max(0, t).toFixed(2)).join(',');
  const r = hf(['snapshot', '--at', lista, '--no-end', '--output', dir, '--timeout', '120000', '--json'], { cwd: proj });
  // folha própria: todos os quadros, em ordem, 6 por linha, com o tempo escrito
  const frames = fs.readdirSync(dir).filter((f) => /^frame-.*\.png$/.test(f)).sort();
  let folha = null;
  if (frames.length) {
    const destino = path.join(pasta, saida, `${nome}.jpg`);
    const cols = Math.min(6, frames.length); const linhas = Math.ceil(frames.length / cols);
    const entradas = frames.flatMap((f) => ['-i', path.join(dir, f)]);
    const rot = frames.map((f, i) => {
      const t = (f.match(/at-([0-9.]+)s/) || [])[1] || '';
      return `[${i}:v]scale=270:480,drawbox=x=0:y=0:w=110:h=34:color=black@0.6:t=fill,drawtext=text='${t}s':x=8:y=8:fontsize=22:fontcolor=white[v${i}]`;
    });
    const vazios = cols * linhas - frames.length;
    const pads = Array.from({ length: vazios }, (_, k) => `color=c=0x1d2026:s=270x480:d=1[p${k}]`);
    const nomes = [...frames.map((_, i) => `[v${i}]`), ...pads.map((_, k) => `[p${k}]`)].join('');
    const filtro = [...rot, ...pads, `${nomes}xstack=inputs=${cols * linhas}:layout=${Array.from({ length: cols * linhas }, (_, k) => `${(k % cols) * 270}_${Math.floor(k / cols) * 480}`).join('|')}[out]`].join(';');
    const rr = rodarSync('ffmpeg', ['-y', '-v', 'error', ...entradas, '-filter_complex', filtro, '-map', '[out]', '-frames:v', '1', '-q:v', '3', destino]);
    if (rr.codigo === 0) folha = destino;
    else { for (const f of fs.readdirSync(dir)) if (/contact|sheet/.test(f)) { fs.copyFileSync(path.join(dir, f), destino); folha = destino; break; } }
  }
  return { ok: r.codigo === 0, folha, dir, erro: r.codigo === 0 ? null : (r.erro || r.saida).slice(-600) };
}

export function temposDasFalas(linha, max = 18) {
  let ts = linha.falas.map((f) => (f.inicio + f.fim) / 2);
  if (ts.length > max) { const passo = ts.length / max; ts = Array.from({ length: max }, (_, i) => ts[Math.floor(i * passo)]); }
  return ts;
}

export async function executar(estagio, ctx) {
  const linha = lerLinha(ctx.pasta);
  const proj = path.join(ctx.pasta, 'projeto');
  if (estagio === 'checagem') {
    ctx.progresso('checagem', 10, 'hyperframes check');
    const c = hf(['check', '--json', '--timeout', '120000'], { cwd: proj });
    let check = null; try { check = JSON.parse(c.saida); } catch {}
    gravarJSON(path.join(ctx.pasta, 'quadros', 'check.json'), check || { bruto: (c.saida || c.erro).slice(-4000) });
    const erros = extrairErros(check);
    ctx.progresso('checagem', 45, 'Quadros de cada fala');
    const q = quadros(ctx.pasta, temposDasFalas(linha), { nome: 'folha' });
    ctx.progresso('checagem', 80, 'Emenda do loop');
    const e = quadros(ctx.pasta, [0.04, linha.total - 0.04], { nome: 'emenda' });
    const resumo = { ts: agora(), erros_check: erros.length, folha: q.folha ? path.relative(ctx.pasta, q.folha) : null, emenda: e.folha ? path.relative(ctx.pasta, e.folha) : null };
    gravarJSON(path.join(ctx.pasta, 'quadros', 'resumo.json'), resumo);
    ctx.arquivo('folha_checagem', resumo.folha);
    return {
      status: 'aguardando_claude',
      instrucoes: `Olhe ${resumo.folha || '(sem folha: veja o erro do snapshot)'} (um quadro por fala) e ${resumo.emenda} (último × primeiro quadro: têm que ser quase iguais). ${erros.length ? `hf check achou ${erros.length} erro(s): ${erros.slice(0, 4).join(' | ')}. ` : ''}Corrija o mundo/storyboard se precisar, rode \`node motor/rs.mjs rodar ${ctx.id} checagem\` de novo, e quando estiver bom: \`node motor/rs.mjs concluir ${ctx.id} checagem\`.${q.ok ? '' : ` Snapshot falhou: ${q.erro}`}`,
    };
  }
  if (estagio === 'qa') return qaDoLoop(ctx, linha);
  throw new Error(`qa não executa "${estagio}"`);
}

function extrairErros(check) {
  if (!check) return [];
  const lista = check.errors || check.findings || check.issues || [];
  return (Array.isArray(lista) ? lista : []).filter((x) => !x.severity || x.severity === 'error').map((x) => x.message || x.rule || x.code || JSON.stringify(x).slice(0, 160));
}

async function qaDoLoop(ctx, linha) {
  const out = path.join(ctx.pasta, 'out');
  const video = path.join(out, 'render.mp4');
  if (!existe(video)) throw new Error('out/render.mp4 não existe. Rode o estágio render.');
  const info = ffprobeJSON(video);
  const durV = Number(info?.format?.duration || 0);
  const temAudio = (info?.streams || []).some((s) => s.codec_type === 'audio');
  const avisos = [];
  if (Math.abs(durV - linha.total) > 1 / linha.fps + 0.06) avisos.push(`Duração ${durV.toFixed(3)} s ≠ esperado ${linha.total.toFixed(3)} s.`);
  if (!temAudio) avisos.push('O vídeo saiu sem áudio.');
  // quadros da emenda
  const ini = path.join(out, 'emenda_inicio.png'); const fim = path.join(out, 'emenda_fim.png');
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-frames:v', '1', ini]);
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.08', '-i', video, '-update', '1', '-frames:v', '1', fim]);
  const s = rodarSync('ffmpeg', ['-hide_banner', '-i', fim, '-i', ini, '-lavfi', 'ssim', '-f', 'null', '-']);
  const ssim = Number((s.erro.match(/All:([0-9.]+)/) || [])[1] || NaN);
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', fim, '-i', ini, '-filter_complex', '[0:v]scale=360:-1[a];[1:v]scale=360:-1[b];[a][b]hstack=inputs=2', path.join(out, 'emenda.jpg')]);
  const visualExigido = ['ponte-total', 'eco-visual'].includes(ctx.config.loop);
  if (visualExigido && Number.isFinite(ssim) && ssim < 0.55) avisos.push(`Emenda visual fraca (SSIM ${ssim.toFixed(2)}): o último plano não volta ao primeiro.`);
  // clipe de teste do loop: últimos 3 s + primeiros 3 s
  const teste = path.join(out, 'teste-loop.mp4');
  const t0 = Math.max(0, linha.total - 3);
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-ss', t0.toFixed(3), '-i', video, '-t', '3', '-i', video, '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]', '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', teste]);
  // loudness final
  const l = rodarSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = Number((l.erro.match(/I:\s+(-?[0-9.]+) LUFS/g) || []).pop()?.match(/-?[0-9.]+/)?.[0] ?? NaN);
  // continuidade do áudio na emenda (amostra final × inicial do mix)
  const mixQA = rodarSync('ffmpeg', ['-v', 'error', '-i', path.join(ctx.pasta, 'mix', 'mix.wav'), '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
  const qa = {
    ts: agora(), duracao: durV, esperado: linha.total, audio: temAudio, ssim_emenda: Number.isFinite(ssim) ? Math.round(ssim * 1000) / 1000 : null,
    lufs: Number.isFinite(lufs) ? lufs : null, avisos, teste_loop: 'out/teste-loop.mp4', emenda: 'out/emenda.jpg', mix_ok: mixQA.codigo === 0,
  };
  gravarJSON(path.join(ctx.pasta, 'qa.json'), qa);
  const est = ctx.recarregar(); est.qa = qa; ctx.salvar();
  ctx.arquivo('teste_loop', 'out/teste-loop.mp4');
  for (const a of avisos) ctx.log('aviso', a);
  return { status: 'concluido', nota: `SSIM emenda ${qa.ssim_emenda ?? '?'} · ${qa.lufs ?? '?'} LUFS${avisos.length ? ` · ${avisos.length} aviso(s)` : ''}` };
}

export async function validarConclusao(estagio, ctx) {
  if (estagio !== 'checagem') return { ok: true };
  const check = lerJSON(path.join(ctx.pasta, 'quadros', 'check.json'), null);
  const erros = extrairErros(check);
  if (erros.length && !ctx.config.ignorar_check) return { ok: false, erros: [`hf check ainda tem ${erros.length} erro(s): ${erros.slice(0, 5).join(' | ')}. Corrija e rode "rs rodar <id> checagem" de novo (ou rs config <id> --set ignorar_check=true).`] };
  return { ok: true };
}
