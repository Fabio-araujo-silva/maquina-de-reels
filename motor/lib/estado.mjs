// Estado de cada vídeo: videos/<id>/estado.json é escrito SÓ pelo motor (rs.mjs).
// O painel nunca escreve aqui: ele chama o rs.mjs, que é o único dono do estado.
import fs from 'node:fs';
import path from 'node:path';
import { P, agora, lerJSON, gravarJSON, anexarLinha, lerJSONL, garantirPasta, existe, slug, hoje, registrarAtividade } from './util.mjs';

export function pipeline() {
  const pl = lerJSON(path.join(P.config, 'pipeline.json'));
  return pl.estagios.filter((e) => e.ativo !== false);
}
export function pipelineCompleto() { return lerJSON(path.join(P.config, 'pipeline.json')).estagios; }

export function pastaVideo(id) { return path.join(P.videos, id); }
export function arquivoEstado(id) { return path.join(pastaVideo(id), 'estado.json'); }

export function existeVideo(id) { return existe(arquivoEstado(id)); }

export function carregarEstado(id) {
  if (!id) throw new Error('Informe o id do vídeo.');
  if (!existeVideo(id)) throw new Error(`Vídeo "${id}" não existe em ${P.videos}.`);
  return normalizarEstado(lerJSON(arquivoEstado(id)));
}

// Estágios que entraram no pipeline depois que o vídeo foi criado: pendentes se ele ainda está em produção,
// pulados se já foi entregue (um vídeo pronto continua pronto).
export function normalizarEstado(est) {
  if (!est?.estagios) return est;
  const entregue = est.estagios.entrega?.status === 'concluido';
  for (const e of pipeline()) if (!est.estagios[e.id]) est.estagios[e.id] = { status: entregue ? 'pulado' : 'pendente' };
  return est;
}

export function salvarEstado(est) {
  est.atualizado_em = agora();
  gravarJSON(arquivoEstado(est.id), est);
  return est;
}

export function log(id, tipo, msg, extra = {}) {
  anexarLinha(path.join(pastaVideo(id), 'log.jsonl'), { ts: agora(), tipo, msg, ...extra });
}
export function lerLog(id, max = 400) { return lerJSONL(path.join(pastaVideo(id), 'log.jsonl')).slice(-max); }

export function novoVideo({ prompt, titulo = null, origem = 'chat', config = null }) {
  const base = `${hoje()}-${slug(titulo || prompt, 40)}`;
  let id = base; let n = 2;
  while (existe(pastaVideo(id))) id = `${base}-${n++}`;
  const pasta = garantirPasta(pastaVideo(id));
  for (const sub of ['voz', 'trilha', 'mix', 'projeto', 'out', 'quadros']) garantirPasta(path.join(pasta, sub));
  const estagios = {};
  for (const e of pipeline()) estagios[e.id] = { status: 'pendente' };
  const est = {
    id, titulo: titulo || null, prompt, origem,
    criado_em: agora(), atualizado_em: agora(),
    estagio: 'briefing', status: 'em_andamento',
    estagios, progresso: null,
    config: config || null,
    custos: { elevenlabs: { caracteres: 0, creditos: null, chamadas: [] } },
    arquivos: {}, qa: null, erro: null,
  };
  est.estagios.briefing = { status: 'concluido', inicio: agora(), fim: agora() };
  avancarPonteiro(est);
  salvarEstado(est);
  fs.writeFileSync(path.join(pasta, 'briefing.md'), `# Briefing\n\n${prompt}\n`, 'utf8');
  log(id, 'estagio', 'Vídeo criado', { origem });
  registrarAtividade(id, 'novo', { estagio: 'briefing' });
  return est;
}

// Marca um estágio e ajusta o ponteiro "estagio" para o próximo não concluído.
export function marcar(est, estagioId, status, extra = {}) {
  const atual = est.estagios[estagioId] || (est.estagios[estagioId] = { status: 'pendente' });
  atual.status = status;
  if (status === 'em_andamento' && !atual.inicio) atual.inicio = agora();
  if (status === 'em_andamento') { delete atual.fim; delete atual.erro; }
  if (['concluido', 'pulado', 'erro'].includes(status)) atual.fim = agora();
  Object.assign(atual, extra);
  if (status === 'erro') { est.status = 'erro'; est.erro = { estagio: estagioId, msg: extra.erro || 'erro', ts: agora() }; }
  else if (est.erro && est.erro.estagio === estagioId) { est.erro = null; }
  avancarPonteiro(est);
  return est;
}

export function avancarPonteiro(est) {
  const ordem = pipeline();
  normalizarEstado(est);
  const prox = ordem.find((e) => !['concluido', 'pulado'].includes(est.estagios[e.id]?.status));
  if (!prox) {
    est.estagio = 'entrega'; est.status = 'concluido'; est.progresso = null;
    return est;
  }
  est.estagio = prox.id;
  const st = est.estagios[prox.id].status;
  if (st === 'erro') est.status = 'erro';
  else if (prox.executor === 'usuario' && st !== 'em_andamento') est.status = 'aguardando_usuario';
  else est.status = 'em_andamento';
  return est;
}

// Reabre um estágio e todos os seguintes (para refazer a partir dele).
export function reabrirDesde(est, estagioId) {
  const ordem = pipeline().map((e) => e.id);
  const i = ordem.indexOf(estagioId);
  if (i < 0) throw new Error(`Estágio desconhecido: ${estagioId}`);
  for (const id of ordem.slice(i)) est.estagios[id] = { status: 'pendente', reaberto_em: agora() };
  est.erro = null;
  avancarPonteiro(est);
  return est;
}

export function proximo(est) {
  const ordem = pipeline();
  // o próximo é o primeiro estágio ativo ainda não concluído/pulado; null quando o vídeo está pronto
  const e = ordem.find((x) => !['concluido', 'pulado'].includes(est.estagios[x.id]?.status)) || null;
  return e ? { ...e, status: est.estagios[e.id]?.status || 'pendente' } : null;
}

export function listarVideos() {
  if (!existe(P.videos)) return [];
  return fs.readdirSync(P.videos, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existe(path.join(P.videos, d.name, 'estado.json')))
    .map((d) => { try { return normalizarEstado(lerJSON(path.join(P.videos, d.name, 'estado.json'))); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
}

export function progresso(id, estagio, pct, msg) {
  // Escrita leve e frequente: arquivo separado para não disputar o estado.json.
  gravarJSON(path.join(pastaVideo(id), 'progresso.json'), { estagio, pct: Math.max(0, Math.min(100, Math.round(pct))), msg, ts: agora() });
}

export function somarElevenLabs(est, chamada) {
  const c = est.custos.elevenlabs;
  c.caracteres += chamada.caracteres || 0;
  if (chamada.creditos != null) c.creditos = (c.creditos || 0) + chamada.creditos;
  c.chamadas.push({ ts: agora(), ...chamada });
  return est;
}
