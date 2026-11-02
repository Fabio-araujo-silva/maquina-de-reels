// Tokens por vídeo e por estágio, lidos dos transcripts do Claude Code (~/.claude/projects).
//
// Como a atribuição funciona:
// 1. Todo comando do motor grava em dados/atividade.jsonl {ts, sessao, video, estagio}.
// 2. Para cada sessão que tocou um vídeo, lemos o transcript (e os de subagentes).
// 3. Dividimos a sessão em "turnos" (do prompt real do usuário até o próximo).
//    Num turno com comandos do motor, cada resposta vai para o vídeo/estágio do comando mais
//    recente se ele tiver no máximo 30 min, ou para o próximo comando se ele vier em até 10 min.
//    Num turno sem comandos, as respostas vão para o último vídeo ativo da sessão (até 30 min).
//    Fora dessas janelas a resposta não é atribuída a nenhum vídeo (conversa que não é produção).
// 4. Respostas são deduplicadas por message.id (o transcript repete o usage por bloco).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P, lerJSON, lerJSONL, gravarJSON, existe, agora } from './util.mjs';

const JANELA_DEPOIS = 30 * 60 * 1000; // resposta até 30 min depois de um comando do vídeo
const JANELA_ANTES = 10 * 60 * 1000;  // ou até 10 min antes do próximo comando (ex.: escrevendo o roteiro)

function pastaProjetos() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function arquivosDaSessao(sessao) {
  const raiz = pastaProjetos();
  const out = [];
  if (!existe(raiz)) return out;
  for (const proj of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const principal = path.join(raiz, proj.name, `${sessao}.jsonl`);
    if (existe(principal)) out.push({ arq: principal, sub: false });
    const subdir = path.join(raiz, proj.name, sessao, 'subagents');
    if (existe(subdir)) {
      for (const f of fs.readdirSync(subdir)) if (f.endsWith('.jsonl')) out.push({ arq: path.join(subdir, f), sub: true });
    }
  }
  return out;
}

function ehPromptReal(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  if (typeof c === 'string') return !/^\s*<(task-notification|system-reminder|command-|local-command)/.test(c);
  if (Array.isArray(c)) {
    if (c.some((b) => b?.type === 'tool_result')) return false;
    const txt = c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
    return Boolean(txt.trim()) && !/^\s*<(task-notification|system-reminder|command-|local-command)/.test(txt);
  }
  return false;
}

function lerTranscripts(sessao) {
  const msgs = new Map();
  const prompts = [];
  for (const { arq, sub } of arquivosDaSessao(sessao)) {
    let txt;
    try { txt = fs.readFileSync(arq, 'utf8'); } catch { continue; }
    for (const linha of txt.split(/\r?\n/)) {
      if (!linha) continue;
      let e; try { e = JSON.parse(linha); } catch { continue; }
      if (!sub && ehPromptReal(e)) prompts.push(Date.parse(e.timestamp));
      if (e.type !== 'assistant') continue;
      const m = e.message || {};
      const u = m.usage;
      if (!u) continue;
      const chave = m.id || e.requestId || e.uuid;
      const ts = Date.parse(e.timestamp);
      const anterior = msgs.get(chave);
      if (!anterior || (u.output_tokens || 0) > (anterior.u.output_tokens || 0)) {
        msgs.set(chave, { ts: anterior ? Math.min(anterior.ts, ts) : ts, modelo: m.model || 'desconhecido', u, sub });
      }
    }
  }
  return { mensagens: [...msgs.values()].filter((m) => Number.isFinite(m.ts)).sort((a, b) => a.ts - b.ts), prompts: prompts.filter(Number.isFinite).sort((a, b) => a - b) };
}

function zerado() { return { input: 0, output: 0, cache_write: 0, cache_read: 0, total: 0, custo_usd: 0, mensagens: 0 }; }

function precoDe(precos, modelo) {
  const limpo = String(modelo).replace(/\[.*?\]$/, '');
  return precos.modelos[limpo] || precos.modelos[Object.keys(precos.modelos).find((k) => limpo.startsWith(k))] || precos.padrao_desconhecido;
}

function somar(alvo, u, preco) {
  const cw5 = u.cache_creation?.ephemeral_5m_input_tokens;
  const cw1 = u.cache_creation?.ephemeral_1h_input_tokens;
  const cw = u.cache_creation_input_tokens || 0;
  const cwSplit5 = cw5 != null || cw1 != null ? (cw5 || 0) : cw;
  const cwSplit1 = cw5 != null || cw1 != null ? (cw1 || 0) : 0;
  const inp = u.input_tokens || 0; const out = u.output_tokens || 0; const cr = u.cache_read_input_tokens || 0;
  alvo.input += inp; alvo.output += out; alvo.cache_write += cw; alvo.cache_read += cr;
  alvo.total += inp + out + cw + cr;
  alvo.mensagens += 1;
  alvo.custo_usd += (inp * preco.input + out * preco.output + cr * preco.cache_read + cwSplit5 * preco.cache_write_5m + cwSplit1 * preco.cache_write_1h) / 1e6;
}

export function calcularTokens({ apenas = null } = {}) {
  const atividade = lerJSONL(path.join(P.dados, 'atividade.jsonl')).filter((a) => a.sessao && a.video);
  const precos = lerJSON(path.join(P.config, 'precos.json'));
  const porSessao = new Map();
  for (const a of atividade) {
    a.t = Date.parse(a.ts);
    if (!porSessao.has(a.sessao)) porSessao.set(a.sessao, []);
    porSessao.get(a.sessao).push(a);
  }
  const res = {};
  const garantir = (v) => (res[v] ||= { total: zerado(), por_estagio: {}, por_modelo: {}, sessoes: new Set() });

  for (const [sessao, eventos] of porSessao) {
    if (apenas && !eventos.some((e) => e.video === apenas)) continue;
    eventos.sort((a, b) => a.t - b.t);
    const { mensagens, prompts } = lerTranscripts(sessao);
    if (!mensagens.length) continue;
    // marca entregas para não atribuir conversa posterior a um vídeo já entregue
    const entregue = new Map();
    for (const e of eventos) if (e.cmd === 'entregue') entregue.set(e.video, e.t);

    for (const m of mensagens) {
      const ini = lastLE(prompts, m.ts) ?? -Infinity;
      const fim = firstGT(prompts, m.ts) ?? Infinity;
      const doTurno = eventos.filter((e) => e.t >= ini && e.t < fim);
      let alvo = null;
      if (doTurno.length) {
        const antes = doTurno.filter((e) => e.t <= m.ts);
        const ant = antes[antes.length - 1];
        const dep = doTurno.find((e) => e.t > m.ts);
        // perto de um comando do vídeo: até 30 min depois do anterior ou 10 min antes do próximo
        if (ant && m.ts - ant.t <= JANELA_DEPOIS) alvo = ant;
        else if (dep && dep.t - m.ts <= JANELA_ANTES) alvo = dep;
      } else {
        const antes = eventos.filter((e) => e.t <= m.ts);
        const ult = antes[antes.length - 1];
        if (ult && m.ts - ult.t < JANELA_DEPOIS && !(entregue.has(ult.video) && entregue.get(ult.video) <= m.ts)) alvo = ult;
      }
      if (alvo && entregue.has(alvo.video) && entregue.get(alvo.video) < m.ts - 60000) alvo = null;
      if (!alvo) continue;
      if (apenas && alvo.video !== apenas) continue;
      const r = garantir(alvo.video);
      r.sessoes.add(sessao);
      const preco = precoDe(precos, m.modelo);
      somar(r.total, m.u, preco);
      const est = alvo.estagio || 'outros';
      somar((r.por_estagio[est] ||= zerado()), m.u, preco);
      somar((r.por_modelo[m.modelo] ||= zerado()), m.u, preco);
    }
  }

  const saida = {};
  for (const [video, r] of Object.entries(res)) {
    const obj = {
      atualizado_em: agora(), sessoes: [...r.sessoes],
      total: arred(r.total),
      por_estagio: Object.fromEntries(Object.entries(r.por_estagio).map(([k, v]) => [k, arred(v)])),
      por_modelo: Object.fromEntries(Object.entries(r.por_modelo).map(([k, v]) => [k, arred(v)])),
      obs: 'Custo equivalente de API (estimativa). Ver config/precos.json.',
    };
    const pasta = path.join(P.videos, video);
    if (existe(pasta)) gravarJSON(path.join(pasta, 'tokens.json'), obj);
    saida[video] = obj;
  }
  return saida;
}

function arred(o) { return { ...o, custo_usd: Math.round(o.custo_usd * 10000) / 10000 }; }
function lastLE(arr, x) { let r = null; for (const v of arr) { if (v <= x) r = v; else break; } return r; }
function firstGT(arr, x) { for (const v of arr) if (v > x) return v; return null; }
