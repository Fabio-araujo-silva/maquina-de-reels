// Módulo "render": render final pelo HyperFrames e entrega (arquivo final, capa, folha, tokens).
import fs from 'node:fs';
import path from 'node:path';
import { gravarJSON, existe, garantirPasta, hfStream, rodarSync, ffprobeDuracao, registrarAtividade, agora } from '../../motor/lib/util.mjs';
import { lerLinha } from '../../motor/lib/linha.mjs';
import { calcularTokens } from '../../motor/lib/tokens.mjs';

export async function executar(estagio, ctx) {
  if (estagio === 'render') return render(ctx);
  if (estagio === 'entrega') return entrega(ctx);
  throw new Error(`render não executa "${estagio}"`);
}

async function render(ctx) {
  const cfg = ctx.config;
  const est = ctx.est;
  if (cfg.previa === 'sim' && !est.previa_aprovada) {
    return { status: 'aguardando_usuario', nota: 'Prévia pronta: aprove com "rs aprovar <id> --previa" (ou no painel).' };
  }
  const linha = lerLinha(ctx.pasta);
  const proj = path.join(ctx.pasta, 'projeto');
  const out = garantirPasta(path.join(ctx.pasta, 'out'));
  const destino = path.join(out, 'render.mp4');
  const q = cfg.qualidade || '1080p30';
  const args = ['render', '--output', destino, '--workers', String(cfg.workers || 'auto')];
  if (q === 'rascunho') args.push('--quality', 'draft', '--fps', '15');
  else args.push('--quality', cfg.qualidade_render || 'looks', '--fps', String(linha.fps));
  const log = path.join(out, 'render.log');
  try { fs.rmSync(log); } catch {}
  ctx.progresso('render', 1, 'Iniciando o render');
  let ultimo = 0;
  const r = await hfStream(args, {
    cwd: proj, logArquivo: log,
    aoLinha: (l) => {
      const m = l.match(/@hf-progress\s+(\{.*\})/);
      if (!m) return;
      try {
        const p = JSON.parse(m[1]);
        if (Date.now() - ultimo < 1500 && p.pct < 99) return;
        ultimo = Date.now();
        const rot = { capture: 'Capturando quadros', encode: 'Codificando', assemble: 'Juntando vídeo e áudio' }[p.code] || p.code;
        ctx.progresso('render', p.pct, `${rot}${p.total ? ` ${p.done}/${p.total}` : ''}`);
      } catch {}
    },
  });
  if (r.codigo !== 0 || !existe(destino)) {
    const cauda = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(-8).join(' | ') : '';
    throw new Error(`Render falhou (código ${r.codigo}). ${cauda.slice(0, 900)}`);
  }
  const dur = ffprobeDuracao(destino);
  ctx.arquivo('render', 'out/render.mp4');
  return { status: 'concluido', nota: `${dur?.toFixed(2)} s · ${(fs.statSync(destino).size / 1e6).toFixed(1)} MB` };
}

async function entrega(ctx) {
  const out = path.join(ctx.pasta, 'out');
  const render = path.join(out, 'render.mp4');
  if (!existe(render)) throw new Error('Sem out/render.mp4.');
  const final = path.join(out, `${ctx.id}.mp4`);
  fs.copyFileSync(render, final);
  const linha = lerLinha(ctx.pasta);
  // capa: o quadro do primeiro cartão grande (ou 1,2 s)
  const tCapa = Math.min(linha.total - 0.1, (linha.overlays.find((o) => o.tipo === 'numero' || o.tipo === 'manchete')?.inicio ?? 0.9) + 0.45);
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-ss', tCapa.toFixed(2), '-i', final, '-frames:v', '1', '-q:v', '3', path.join(out, 'capa.jpg')]);
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-i', final, '-vf', `fps=${(12 / linha.total).toFixed(4)},scale=240:-1,tile=6x2`, '-frames:v', '1', '-q:v', '4', path.join(out, 'folha.jpg')]);
  ctx.arquivo('final', `out/${ctx.id}.mp4`);
  ctx.arquivo('capa', 'out/capa.jpg');
  ctx.arquivo('folha', 'out/folha.jpg');
  registrarAtividade(ctx.id, 'entregue', { estagio: 'entrega' });
  let tk = null;
  try { tk = calcularTokens({ apenas: ctx.id })[ctx.id] || null; } catch (e) { ctx.log('aviso', `Tokens: ${e.message}`); }
  const est = ctx.recarregar();
  est.entregue_em = agora();
  if (tk) est.custos.claude = tk.total;
  ctx.salvar();
  gravarJSON(path.join(ctx.pasta, 'entrega.json'), { ts: agora(), arquivo: `out/${ctx.id}.mp4`, tokens: tk?.total || null });
  return { status: 'concluido', nota: `out/${ctx.id}.mp4${tk ? ` · ${tk.total.total.toLocaleString('pt-BR')} tokens (~US$ ${tk.total.custo_usd.toFixed(2)})` : ''}` };
}
