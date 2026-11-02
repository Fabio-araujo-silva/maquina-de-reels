// Módulo "colagem" (gbro-collage-broll). Dois motores:
//   codigo  (padrão, grátis): a colagem é desenhada pelo kit/colagem.js dentro do HyperFrames; nada a pré-renderizar.
//   gemini  (gbro original): still por modelo de imagem do Gemini + vídeo de montagem pelo Gemini Omni Flash
//           (scripts do próprio gbro). Exige GEMINI_API_KEY e custa por clipe.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerJSON, gravarJSON, existe, garantirPasta, temChave, python } from '../../motor/lib/util.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export async function executar(estagio, ctx) {
  const cfg = ctx.config;
  const r = ctx.roteiro();
  const sb = lerJSON(path.join(ctx.pasta, 'storyboard.json'), {});
  const colagens = (sb.colagens || []).filter((c) => (c.falas || [c.fala]).some((id) => r.falas.find((f) => f.id === id && f.plano === 'colagem')));
  if (cfg.estilo === 'colagem-halftone') return { status: 'concluido', nota: 'estilo principal é colagem (desenhada no mundo, em código)' };
  if (!colagens.length) return { status: 'pulado', nota: 'nenhuma fala com plano "colagem"' };
  const usarGemini = cfg.broll === 'gemini' && temChave('GEMINI_API_KEY');
  if (cfg.broll === 'gemini' && !usarGemini) ctx.log('aviso', 'Colagem Gemini sem GEMINI_API_KEY: usando o motor em código.');
  if (!usarGemini) return { status: 'concluido', nota: `${colagens.length} colagem(ns) no motor em código (renderizadas pelo HyperFrames)` };

  // ---- motor gemini (gbro original) ----
  const pasta = garantirPasta(path.join(ctx.pasta, 'colagem'));
  const linha = lerJSON(path.join(ctx.pasta, 'linha.json'));
  const jobs = colagens.map((c) => {
    const id = `colagem-${(c.falas || [c.fala])[0]}`;
    const fs0 = linha.falas.filter((f) => (c.falas || [c.fala]).includes(f.id));
    const durS = Math.min(10, Math.max(3, Math.round(Math.max(...fs0.map((f) => f.janela_fim)) - Math.min(...fs0.map((f) => f.janela_inicio ?? f.inicio)))));
    return { id, fundo: c.fundo || '#e8a33d', metafora: c.metafora || '', elementos: c.elementos || [], duracao: durS, texto: fs0.map((f) => f.texto).join(' ') };
  });
  const arqJobs = path.join(pasta, 'pedidos.json');
  gravarJSON(arqJobs, jobs);
  ctx.progresso('colagem', 10, `Gemini: ${jobs.length} colagem(ns)`);
  const res = python([path.join(AQUI, 'gemini.py'), '--pedidos', arqJobs, '--saida-dir', pasta, '--gbro', path.join(ctx.P.externos, 'gbro-collage-broll', 'scripts'), '--modelo-imagem', cfg.gemini_modelo_imagem || 'gemini-2.5-flash-image']);
  if (res.codigo !== 0) throw new Error(`Colagem Gemini falhou: ${String(res.erro || res.saida).split('\n').filter(Boolean).slice(-4).join(' | ')}`);
  const feitos = jobs.filter((j) => existe(path.join(pasta, `${j.id}.mp4`))).length;
  return { status: 'concluido', nota: `${feitos}/${jobs.length} colagens geradas pelo Gemini` };
}
