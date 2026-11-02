// Fila de pedidos do painel para o Claude da máquina.
// O painel cria arquivos em dados/fila/; o Claude (rodando `rs fila --aguardar` em segundo plano)
// acorda quando chega um pedido, executa e marca como concluído.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, agora, lerJSON, gravarJSON, garantirPasta, existe, sessaoAtual } from './util.mjs';

export const ACOES = {
  novo: 'Criar um vídeo novo a partir de um prompt (e de uma config já escolhida no painel).',
  ajustes: 'Reescrever o roteiro com as notas do usuário.',
  'refazer-estagio': 'Refazer a partir de um estágio (payload.estagio).',
  'trocar-config': 'Mudou a config de um vídeo já em produção (payload.config); refazer o necessário.',
  rerender: 'Renderizar de novo (sem mudar nada).',
  'regenerar-voz': 'Gerar a voz de novo (ex.: trocou a voz) e refazer o que depende dela.',
  cancelar: 'Parar o vídeo.',
  mensagem: 'Recado livre do usuário para o Claude (payload.texto).',
  cenas: 'Aplicar os ajustes que o usuário pediu na revisão dele, cena a cena (payload.rodada, payload.cenas = falas). Siga modulos/revisao-usuario/MODULO.md: `node motor/rs.mjs cenas <id>` mostra os pedidos.',
  corrigir: 'Aplicar as correções que o usuário marcou num parecer do agente revisor (payload.rodada, payload.problemas = ids, payload.notas). Siga modulos/revisor/MODULO.md, seção "Pedido corrigir vindo do painel".',
};

export function criarPedido(acao, video = null, payload = {}) {
  if (!ACOES[acao]) throw new Error(`Ação desconhecida: ${acao}`);
  garantirPasta(P.fila);
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const pedido = { id, acao, video, payload, status: 'pendente', criado_em: agora() };
  gravarJSON(path.join(P.fila, `${id}.json`), pedido);
  return pedido;
}

export function listarPedidos({ status = null } = {}) {
  if (!existe(P.fila)) return [];
  return fs.readdirSync(P.fila).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return lerJSON(path.join(P.fila, f)); } catch { return null; } })
    .filter(Boolean)
    .filter((p) => !status || (Array.isArray(status) ? status.includes(p.status) : p.status === status))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function atualizarPedido(id, mudancas) {
  const arq = path.join(P.fila, `${id}.json`);
  const p = lerJSON(arq);
  Object.assign(p, mudancas, { atualizado_em: agora() });
  gravarJSON(arq, p);
  return p;
}

// Batimento do operador: o painel mostra se há um Claude escutando a fila.
export function batimento(info = {}) {
  gravarJSON(path.join(P.dados, 'operador.json'), { sessao: sessaoAtual(), pid: process.pid, ultimo_sinal: agora(), ...info });
}
export function lerOperador() {
  const o = lerJSON(path.join(P.dados, 'operador.json'), null);
  if (!o) return { ativo: false };
  const idade = (Date.now() - Date.parse(o.ultimo_sinal)) / 1000;
  return { ...o, ativo: idade < 45, idade_s: Math.round(idade) };
}
