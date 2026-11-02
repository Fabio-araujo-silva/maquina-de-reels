#!/usr/bin/env node
// Painel do Estúdio de Reels — servidor local sem dependências (http://127.0.0.1:4777).
// Regra: o painel LÊ os arquivos dos vídeos e MUDA o estado só chamando o motor (motor/rs.mjs),
// que é o único dono de videos/<id>/estado.json. Pedidos para o Claude vão para a fila (dados/fila/).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { P, RAIZ, lerJSON, gravarJSON, lerJSONL, existe, carregarEnv, temChave } from '../motor/lib/util.mjs';
import { listarVideos, pipelineCompleto, normalizarEstado } from '../motor/lib/estado.mjs';
import { listarPedidos, lerOperador } from '../motor/lib/fila.mjs';
import { perguntasMenu } from '../motor/lib/menu.mjs';
import { listarEstilos } from '../modulos/montagem/estilos.mjs';
import { catalogoFinal } from '../modulos/voz/vozes.mjs';
import * as RU from '../modulos/revisao-usuario/rodadas.mjs';
import { lerExecutor, salvarExecutor } from '../motor/lib/agente.mjs';

// Modo API: o painel sobe sozinho o operador da fila (rs agente --fila) quando o executor não é o Claude Code.
let OPERADOR_API = null;
function garantirOperadorAPI() {
  const modo = lerExecutor().modo;
  if (modo === 'claude-code') { if (OPERADOR_API) { OPERADOR_API.kill(); OPERADOR_API = null; } return false; }
  if (OPERADOR_API && OPERADOR_API.exitCode === null) return true;
  const log = fs.openSync(path.join(RAIZ, 'dados', 'operador-api.log'), 'a');
  OPERADOR_API = spawn(process.execPath, [path.join(RAIZ, 'motor', 'rs.mjs'), 'agente', '--fila'], { cwd: RAIZ, stdio: ['ignore', log, log] });
  OPERADOR_API.on('exit', () => { OPERADOR_API = null; });
  return true;
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PORTA = Number(args[args.indexOf('--porta') + 1]) || 4777;
const RS = path.join(RAIZ, 'motor', 'rs.mjs');
carregarEnv();

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };

function rs(argumentos, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [RS, ...argumentos], { cwd: RAIZ, windowsHide: true, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } });
    let out = '', err = '';
    const t = setTimeout(() => filho.kill(), timeoutMs);
    filho.stdout.on('data', (d) => (out += d)); filho.stderr.on('data', (d) => (err += d));
    filho.on('close', (codigo) => { clearTimeout(t); let json = null; try { json = JSON.parse(out); } catch {} resolve({ codigo, json, out, err: err.trim() }); });
  });
}

function json(res, codigo, obj) { res.writeHead(codigo, { 'Content-Type': TIPOS['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function lerCorpo(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
}

// arquivos servidos: só dentro destas raízes
const RAIZES_ARQ = [P.videos, P.estilos, path.join(P.externos, 'lemo-opuscar', 'styles'), path.join(P.biblioteca)];
function servirArquivo(req, res, rel) {
  const alvo = path.resolve(RAIZ, decodeURIComponent(rel));
  if (!RAIZES_ARQ.some((r) => alvo.startsWith(path.resolve(r) + path.sep))) { res.writeHead(403); return res.end('proibido'); }
  let st; try { st = fs.statSync(alvo); } catch { res.writeHead(404); return res.end('não encontrado'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('não é arquivo'); }
  const tipo = TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let ini = m && m[1] ? parseInt(m[1], 10) : 0; let fim = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (fim >= st.size) fim = st.size - 1;
    if (ini > fim) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': fim - ini + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(alvo, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(alvo).pipe(res);
}

const url = (id, rel) => (rel ? `/arquivo/videos/${encodeURIComponent(id)}/${String(rel).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}` : null);
const existeRel = (id, rel) => rel && existe(path.join(P.videos, id, rel));

// ---------- pareceres do agente revisor ----------
function rodadasRevisor(id) {
  const dir = path.join(P.videos, id, 'revisor');
  if (!existe(dir)) return [];
  return fs.readdirSync(dir).map((f) => f.match(/^rodada-(\d+)\.json$/)).filter(Boolean)
    .map((m) => {
      const n = Number(m[1]);
      const j = lerJSON(path.join(dir, m[0]), {});
      return { n, ...j, folha: existeRel(id, `revisor/rodada-${n}/folha.jpg`) ? url(id, `revisor/rodada-${n}/folha.jpg`) : null };
    })
    .sort((a, b) => a.n - b.n);
}

// Parecer que ainda pede uma decisão sua: o último, se você não pediu correção nem dispensou,
// com veredito "corrigir" e problemas abertos, ou com sugestões de texto (só você muda o texto aprovado).
function revisaoPendente(id) {
  const ult = rodadasRevisor(id).at(-1);
  if (!ult || ult.usuario) return null;
  const resp = new Map((ult.respostas || []).map((r) => [r.id, r.acao]));
  const abertos = (ult.problemas || []).filter((p) => !['corrigido', 'ignorado'].includes(resp.get(p.id)));
  const texto = abertos.filter((p) => p.sugestao_usuario || resp.get(p.id) === 'para_usuario').length;
  if (ult.veredito === 'corrigir' && abertos.length) return { rodada: ult.n, problemas: abertos.length, texto };
  if (texto) return { rodada: ult.n, problemas: texto, texto };
  return null;
}

// ---------- sua revisão (cena a cena) ----------
function revisaoUsuario(id, est) {
  const pasta = path.join(P.videos, id);
  const def = pipelineCompleto().find((e) => e.id === 'revisao_usuario');
  const st = est.estagios?.revisao_usuario || {};
  const comUrls = (r) => ({
    ...r,
    cenas: (r.cenas || []).map((c) => ({ ...c, quadros: (c.quadros || []).filter((q) => existeRel(id, q)).map((q) => url(id, q)) })),
    video_url: r.video && existeRel(id, r.video) ? `${url(id, r.video)}?v=${r.video_mtime || ''}` : null,
  });
  const rodadas = RU.listarRodadas(pasta).map(comUrls);
  const atual = rodadas.at(-1) || null;
  const rascunho = atual && !atual.decisao ? lerJSON(RU.arquivoRascunho(pasta, atual.rodada), null) : null;
  const antes = ['concluido', 'pulado'].includes(est.estagios?.revisao_final?.status) || !pipelineCompleto().some((e) => e.id === 'revisao_final' && e.ativo !== false);
  return {
    ativo: def ? def.ativo !== false : false,
    status: st.status || 'pendente',
    esperando_voce: Boolean(st.aguardando_usuario) && Boolean(atual && !atual.decisao),
    com_claude: Boolean(st.aguardando_claude),
    rodadas, atual, rascunho,
    tipos: Object.fromEntries(Object.entries(RU.TIPOS).map(([k, v]) => [k, v.rotulo])),
    pode_abrir: Boolean(def && def.ativo !== false) && existeRel(id, 'out/render.mp4') && antes && !st.aguardando_usuario && !st.aguardando_claude && st.status !== 'em_andamento',
  };
}

// ---------- situação real de um vídeo (o que está acontecendo AGORA) ----------
const NOMES_PEDIDO = { cenas: 'aplicar os ajustes da sua revisão', corrigir: 'aplicar as correções que você pediu', rerender: 'renderizar de novo', 'regenerar-voz': 'gerar a voz de novo', 'refazer-estagio': 'refazer um estágio', 'trocar-config': 'aplicar a configuração nova', mensagem: 'responder o seu recado', ajustes: 'reescrever o roteiro', cancelar: 'parar o vídeo' };
function ultimaAtividade(id) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(P.dados, 'atividade.jsonl'), 'utf8'); } catch { return null; }
  const linhas = txt.trim().split(/\r?\n/).slice(-600);
  for (let i = linhas.length - 1; i >= 0; i--) {
    try { const a = JSON.parse(linhas[i]); if (a.video === id) return a; } catch {}
  }
  return null;
}
const recente = (ts, ms) => Boolean(ts) && Date.now() - Date.parse(ts) < ms;

function situacao(est, { op, pedidos }) {
  const pasta = path.join(P.videos, est.id);
  const etapas = pipelineCompleto().filter((e) => e.ativo !== false);
  const feitos = etapas.filter((e) => ['concluido', 'pulado'].includes(est.estagios?.[e.id]?.status)).length;
  const geral = { feitos, total: etapas.length, pct: Math.round((feitos / Math.max(1, etapas.length)) * 100) };
  const def = etapas.find((e) => e.id === est.estagio) || {};
  const st = est.estagios?.[est.estagio] || {};
  const base = { geral, estagio: est.estagio, nome: def.nome, executor: def.executor, tipica: def.duracao_tipica || null, operador: Boolean(op?.ativo) };
  if (est.status === 'concluido') {
    // pronto, mas com um pedido seu na fila? Então o que importa é o pedido.
    const meus = pedidos.filter((p) => p.video === est.id);
    const ativo = meus.find((p) => p.status === 'em_andamento');
    const pend = meus.find((p) => p.status === 'pendente');
    const oQue = (p) => NOMES_PEDIDO[p.acao] || p.acao;
    if (ativo) return { ...base, nome: 'Seu pedido', tipica: null, tipo: 'claude', texto: `Claude vai ${oQue(ativo)}`, desde: ativo.atualizado_em || ativo.criado_em, pedido_acao: ativo.acao };
    if (pend) return { ...base, nome: 'Seu pedido', tipica: null, tipo: 'parado', texto: `Seu pedido espera um Claude: ${oQue(pend)}`, pedido_na_fila: true, pedido_desde: pend.criado_em, pedido_acao: pend.acao, desde: pend.criado_em };
    // pronto, mas o último parecer do revisor ainda pede uma decisão sua?
    return { ...base, tipo: 'pronto', texto: 'Pronto', revisao_pendente: revisaoPendente(est.id) };
  }
  if (est.status === 'erro') return { ...base, tipo: 'erro', texto: `Erro em ${def.nome || est.estagio}` };
  const prog = lerJSON(path.join(pasta, 'progresso.json'), null);
  if (prog && recente(prog.ts, 120000)) return { ...base, tipo: 'motor', texto: prog.msg, pct: prog.pct, desde: st.inicio || prog.ts };
  if (def.executor === 'usuario' || st.aguardando_usuario || est.status === 'aguardando_usuario') {
    const texto = def.id === 'revisao' ? 'Sua vez: aprove o roteiro ou peça ajustes' : def.id === 'menu' ? 'Sua vez: responder o menu de montagem' : def.id === 'render' ? 'Sua vez: aprovar a prévia' : def.id === 'revisao_usuario' ? 'Sua vez: revise o vídeo cena a cena' : 'Sua vez';
    return { ...base, tipo: 'voce', texto, desde: st.desde || st.inicio || est.atualizado_em };
  }
  const passo = lerJSON(path.join(pasta, 'passo.json'), null);
  const ult = ultimaAtividade(est.id);
  const pedidoAtivo = pedidos.find((p) => p.video === est.id && p.status === 'em_andamento');
  const pedidoPend = pedidos.find((p) => p.video === est.id && p.status === 'pendente');
  const passoValido = passo && passo.estagio === est.estagio && recente(passo.ts, 20 * 60000);
  const trabalhando = pedidoAtivo || (ult?.sessao && recente(ult.ts, 10 * 60000)) || passoValido;
  if (trabalhando) {
    return {
      ...base, tipo: 'claude', texto: passoValido ? passo.texto : `Claude trabalhando: ${def.nome || est.estagio}`,
      desde: st.inicio || pedidoAtivo?.atualizado_em || ult?.ts, ultima: ult ? { cmd: ult.cmd, ts: ult.ts } : null, passo_desde: passoValido ? passo.ts : null,
    };
  }
  return {
    ...base, tipo: 'parado', texto: `Parado: ${def.nome || est.estagio} espera um Claude`,
    pedido_na_fila: Boolean(pedidoPend), pedido_desde: pedidoPend?.criado_em || null, operador: Boolean(op?.ativo), desde: pedidoPend?.criado_em || est.atualizado_em,
  };
}

function resumo(est, ctx = null) {
  const pasta = path.join(P.videos, est.id);
  const prog = lerJSON(path.join(pasta, 'progresso.json'), null);
  const sit = situacao(est, ctx || { op: lerOperador(), pedidos: listarPedidos({ status: ['pendente', 'em_andamento'] }) });
  const tk = lerJSON(path.join(pasta, 'tokens.json'), null);
  let miniatura = existeRel(est.id, 'out/capa.jpg') ? 'out/capa.jpg' : null;
  for (const sub of ['quadros/folha', 'quadros/rascunho']) {
    if (miniatura) break;
    const dir = path.join(pasta, ...sub.split('/'));
    if (existe(dir)) { const f = fs.readdirSync(dir).filter((x) => x.endsWith('.png')).sort()[0]; if (f) miniatura = `${sub}/${f}`; }
  }
  return {
    id: est.id, titulo: est.titulo || est.prompt?.slice(0, 60), prompt: est.prompt, estagio: est.estagio, status: est.status,
    criado_em: est.criado_em, atualizado_em: est.atualizado_em, erro: est.erro, progresso: prog,
    estagios: est.estagios, config: est.config,
    tokens: tk?.total || null, elevenlabs: est.custos?.elevenlabs?.caracteres || 0,
    duracao: lerJSON(path.join(pasta, 'linha.json'), null)?.total || null,
    miniatura: url(est.id, miniatura), final: est.arquivos?.final ? url(est.id, est.arquivos.final) : null,
    qa: est.qa || null, situacao: sit, fonte: est.fonte || null,
    revisar: Boolean(est.estagios?.revisao_usuario?.aguardando_usuario),
  };
}

// Nome legível da voz: a que foi usada (voz/meta.json) ou a escolhida no menu (auto → a voz automática do catálogo).
function nomeDaVoz(cfgVoz, pasta) {
  const usada = lerJSON(path.join(pasta, 'voz', 'meta.json'), null)?.voz?.nome;
  if (usada) return usada;
  const v = String(cfgVoz || '');
  if (!v) return null;
  if (v.startsWith('kokoro:')) return v.slice(7);
  const id = v.replace(/^elevenlabs:/, '');
  try {
    const cat = catalogoFinal();
    if (id === 'auto-feminina') return cat.auto?.feminina?.nome || null;
    if (id === 'auto-masculina') return cat.auto?.masculina?.nome || null;
    return cat.todas.find((x) => x.voice_id === id)?.nome || null;
  } catch { return null; }
}

function detalhe(id) {
  const pasta = path.join(P.videos, id);
  const est = normalizarEstado(lerJSON(path.join(pasta, 'estado.json')));
  const linha = lerJSON(path.join(pasta, 'linha.json'), null);
  const arquivos = {};
  for (const [k, rel] of Object.entries(est.arquivos || {})) if (rel && existeRel(id, rel)) arquivos[k] = url(id, rel);
  for (const [k, rel] of Object.entries({ emenda: 'out/emenda.jpg', folha_final: 'out/folha.jpg', folha_checagem: 'quadros/folha.jpg', emenda_checagem: 'quadros/emenda.jpg', narracao: 'voz/narracao.wav', musica: 'trilha/musica_loop.wav', previa_audio: 'mix/previa.mp3', teste_loop: 'out/teste-loop.mp4', capa: 'out/capa.jpg', rascunho: 'quadros/rascunho.jpg' })) {
    if (!arquivos[k] && existeRel(id, rel)) arquivos[k] = url(id, rel);
  }
  return {
    ...resumo(est), estado: est,
    roteiro: lerJSON(path.join(pasta, 'roteiro.json'), null),
    revisao: lerJSON(path.join(pasta, 'revisao.json'), null),
    storyboard: lerJSON(path.join(pasta, 'storyboard.json'), null),
    linha: linha ? { total: linha.total, falas: linha.falas.map((f) => ({ id: f.id, inicio: f.inicio, fim: f.fim, texto: f.texto, capitulo: f.capitulo })), capitulos: linha.capitulos } : null,
    tokens: lerJSON(path.join(pasta, 'tokens.json'), null),
    qa: lerJSON(path.join(pasta, 'qa.json'), null),
    voz: lerJSON(path.join(pasta, 'voz', 'meta.json'), null),
    trilha: lerJSON(path.join(pasta, 'trilha', 'meta.json'), null),
    mix: lerJSON(path.join(pasta, 'mix', 'meta.json'), null),
    log: lerJSONL(path.join(pasta, 'log.jsonl')).slice(-250),
    arquivos,
    pedidos: listarPedidos().filter((p) => p.video === id).slice(-20),
    voz_nome: nomeDaVoz(est.config?.voz, pasta),
    revisor: (() => { const pad = lerJSON(path.join(P.config, 'padroes.json'), {}); return { modo: est.config?.revisor || pad.respostas?.revisor || 'corrigir', max: Number(est.config?.revisor_rodadas || pad.ajustes?.revisor_rodadas || 2), rodadas: rodadasRevisor(id), pendente: revisaoPendente(id) }; })(),
    revisao_usuario: revisaoUsuario(id, est),
  };
}

// ---------- vozes: catálogo, amostras, Voice Design (pt-BR) ----------
const urlArq = (rel) => (rel ? `/arquivo/${String(rel).split('/').map(encodeURIComponent).join('/')}` : null);
async function rotasVozes(req, res, p) {
  const V = await import('../modulos/voz/vozes.mjs');
  const corpo = req.method === 'POST' ? await lerCorpo(req) : {};
  const erroEleven = (e) => json(res, e.status === 401 ? 403 : 400, { erro: String(e.message || e).replace(/sk_[A-Za-z0-9]+/g, 'sk_***') });
  try {
    if (p === '/api/vozes' && req.method === 'GET') {
      const pad = lerJSON(path.join(P.config, 'padroes.json'));
      const cat = V.catalogoFinal();
      const hist = V.ultimasPrevias();
      return json(res, 200, {
        catalogo: cat, padrao_voz: pad.respostas?.voz, modelo_voz: pad.respostas?.modelo_voz, voz_ajustes: pad.voz_ajustes, ajustes: pad.ajustes || {},
        texto_amostra: V.TEXTO_AMOSTRA, presets: V.DESIGN_PRESETS, texto_design: V.TEXTO_DESIGN,
        rodadas: (hist.rodadas || []).map((r) => ({ ...r, previas: r.previas.map((x) => ({ ...x, url: urlArq(x.arquivo) })) })),
        chave: temChave('ELEVENLABS_API_KEY'),
      });
    }
    if (p === '/api/vozes/atualizar' && req.method === 'POST') { const r = await rs(['vozes', '--atualizar'], { timeoutMs: 60000 }); return json(res, r.codigo === 0 ? 200 : 400, r.json ? { ok: true } : { erro: r.err }); }
    if (p === '/api/vozes/amostra' && req.method === 'POST') {
      if (!corpo.voice_id) return json(res, 400, { erro: 'Escolha a voz.' });
      const r = await V.gerarAmostra({ voice_id: corpo.voice_id, texto: corpo.texto, modelo: corpo.modelo || 'eleven_multilingual_v2', ajustes: corpo.ajustes || {} });
      return json(res, 200, { ...r, url: urlArq(r.arquivo) });
    }
    if (p === '/api/vozes/adicionar' && req.method === 'POST') {
      V.adicionarPersonalizada(corpo);
      if (corpo.testar) {
        try { await V.gerarAmostra({ voice_id: corpo.voice_id, texto: 'Oi, tudo bem?', modelo: 'eleven_multilingual_v2' }); }
        catch (e) { V.removerPersonalizada(corpo.voice_id); return json(res, 400, { erro: `A ElevenLabs não aceitou esse voice_id (${String(e.message).slice(0, 160)}). Adicione a voz em "My Voices" no site antes.` }); }
      }
      return json(res, 200, { ok: true });
    }
    if (p === '/api/vozes/remover' && req.method === 'POST') { V.removerPersonalizada(corpo.voice_id); return json(res, 200, { ok: true }); }
    if (p === '/api/vozes/preferencias' && req.method === 'POST') { V.salvarPreferencias(corpo); return json(res, 200, { ok: true }); }
    if (p === '/api/vozes/design' && req.method === 'POST') {
      const r = await V.gerarPreviasDesign({ genero: corpo.genero, descricao: corpo.descricao, texto: corpo.texto, modelo: corpo.modelo });
      return json(res, 200, { ...r, previas: r.previas.map((x) => ({ ...x, url: urlArq(x.arquivo) })) });
    }
    if (p === '/api/vozes/design/salvar' && req.method === 'POST') {
      if (!corpo.generated_voice_id) return json(res, 400, { erro: 'Escolha uma prévia.' });
      return json(res, 200, await V.salvarVozDesenhada({ generated_voice_id: corpo.generated_voice_id, nome: corpo.nome, genero: corpo.genero, descricao: corpo.descricao, tornarPadrao: corpo.padrao !== false }));
    }
    return json(res, 404, { erro: 'rota de vozes desconhecida' });
  } catch (e) { return erroEleven(e); }
}

let cacheAssinatura = { ts: 0, dados: null };
async function usoGeral() {
  const vs = listarVideos().map(resumo);
  const total = { input: 0, output: 0, cache_write: 0, cache_read: 0, total: 0, custo_usd: 0 };
  for (const v of vs) if (v.tokens) for (const k of Object.keys(total)) total[k] += v.tokens[k] || 0;
  let eleven = null;
  if (temChave('ELEVENLABS_API_KEY')) {
    if (Date.now() - cacheAssinatura.ts > 60000) {
      try { const m = await import('../motor/lib/elevenlabs.mjs'); cacheAssinatura = { ts: Date.now(), dados: await m.assinatura() }; }
      catch (e) { cacheAssinatura = { ts: Date.now(), dados: { erro: e.message } }; }
    }
    eleven = cacheAssinatura.dados;
  }
  return { videos: vs.map((v) => ({ id: v.id, titulo: v.titulo, tokens: v.tokens, elevenlabs: v.elevenlabs, status: v.status, criado_em: v.criado_em })), total, elevenlabs: eleven, precos: lerJSON(path.join(P.config, 'precos.json')) };
}

// ---------- eventos ao vivo (SSE) ----------
const clientes = new Set();
let pendente = null;
function avisar(motivo) {
  if (pendente) return;
  pendente = setTimeout(() => {
    pendente = null;
    for (const c of clientes) c.write(`data: ${JSON.stringify({ tipo: 'mudou', motivo, ts: Date.now() })}\n\n`);
  }, 350);
}
for (const dir of [P.videos, P.dados, P.config]) {
  try { fs.watch(dir, { recursive: true }, (_, nome) => { if (nome && /\.(tmp)$/.test(nome)) return; avisar(nome || dir); }); } catch {}
}
setInterval(() => { for (const c of clientes) c.write(': ping\n\n'); }, 20000);

// ---------- rotas ----------
const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    if (p === '/api/saude') return json(res, 200, { ok: true, porta: PORTA, raiz: RAIZ });
    if (p === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n'); clientes.add(res); req.on('close', () => clientes.delete(res)); return;
    }
    if (p === '/api/videos' && req.method === 'GET') {
      const ctx = { op: lerOperador(), pedidos: listarPedidos({ status: ['pendente', 'em_andamento'] }) };
      return json(res, 200, { videos: listarVideos().map((e) => resumo(e, ctx)), operador: ctx.op, fila: ctx.pedidos });
    }
    let m;
    if ((m = p.match(/^\/api\/videos\/([^/]+)$/)) && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      if (!existe(path.join(P.videos, id, 'estado.json'))) return json(res, 404, { erro: 'vídeo não existe' });
      return json(res, 200, detalhe(id));
    }
    if ((m = p.match(/^\/api\/videos\/([^/]+)\/([a-z-]+)$/)) && req.method === 'POST') {
      const id = decodeURIComponent(m[1]); const acao = m[2]; const corpo = await lerCorpo(req);
      let r;
      if (acao === 'aprovar') r = await rs(['aprovar', id, '--via', 'painel', ...(corpo.notas ? ['--notas', corpo.notas] : [])]);
      else if (acao === 'aprovar-previa') r = await rs(['aprovar', id, '--previa', '--via', 'painel']);
      else if (acao === 'ajustes') {
        r = await rs(['ajustes', id, '--notas', corpo.notas || '(sem notas)', '--via', 'painel']);
        await rs(['pedir', 'ajustes', id, '--json', JSON.stringify({ notas: corpo.notas || '' })]);
      } else if (acao === 'config') {
        const sets = Object.entries(corpo.config || {}).flatMap(([k, v]) => ['--set', `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`]);
        r = await rs(['config', id, ...sets]);
        if (corpo.refazer_desde) await rs(['pedir', 'trocar-config', id, '--json', JSON.stringify({ config: corpo.config, refazer_desde: corpo.refazer_desde })]);
      } else if (acao === 'pedido') r = await rs(['pedir', corpo.acao, id, '--json', JSON.stringify(corpo.payload || {})]);
      else if (acao === 'revisor') {
        // sua decisão sobre um parecer do agente revisor: pedir correções (vira pedido "corrigir" na fila) ou dispensar
        const n = Number(corpo.rodada);
        const arq = path.join(P.videos, id, 'revisor', `rodada-${n}.json`);
        if (!n || !existe(arq)) return json(res, 404, { erro: 'Essa rodada de revisão não existe.' });
        const parecer = lerJSON(arq, {});
        if (corpo.acao === 'dispensar') {
          parecer.usuario = { acao: 'dispensado', ts: new Date().toISOString() };
          gravarJSON(arq, parecer);
          r = { codigo: 0, json: { ok: true } };
        } else if (corpo.acao === 'corrigir') {
          const problemas = [].concat(corpo.problemas || []).map(String);
          if (!problemas.length) return json(res, 400, { erro: 'Marque pelo menos um problema.' });
          parecer.usuario = { acao: 'corrigir', problemas, notas: corpo.notas || '', ts: new Date().toISOString() };
          gravarJSON(arq, parecer);
          r = await rs(['pedir', 'corrigir', id, '--json', JSON.stringify({ rodada: n, problemas, notas: corpo.notas || '' })]);
        } else return json(res, 400, { erro: 'Use acao "corrigir" ou "dispensar".' });
      }
      else if (acao === 'cenas') {
        // sua revisão cena a cena: rascunho (salvo enquanto você revisa), ajustes, aprovar, abrir uma rodada nova
        const pasta = path.join(P.videos, id);
        if (corpo.acao === 'abrir') r = await rs(['cenas', id, '--abrir'], { timeoutMs: 300000 });
        else {
          const aberta = RU.rodadaAberta(pasta);
          if (!aberta) return json(res, 409, { erro: 'Esta rodada da revisão não está mais aberta (já foi decidida). Recarregue a página.' });
          if (corpo.rodada && Number(corpo.rodada) !== aberta.rodada) return json(res, 409, { erro: `A rodada aberta agora é a ${aberta.rodada}. Recarregue a página.` });
          if (corpo.acao === 'rascunho') {
            const cenas = {};
            for (const [f, v] of Object.entries(corpo.cenas || {})) {
              if (!aberta.cenas.some((c) => c.fala === f)) continue;
              cenas[f] = { estado: ['ok', 'mudar'].includes(v?.estado) ? v.estado : null, tipos: [].concat(v?.tipos || []).filter((t) => RU.TIPOS[t]), nota: String(v?.nota || '').slice(0, 2000), t: Number.isFinite(Number(v?.t)) && v?.t !== null ? Number(v.t) : null };
            }
            const rasc = { rodada: aberta.rodada, cenas, geral: String(corpo.geral || '').slice(0, 4000), salvo_em: new Date().toISOString() };
            gravarJSON(RU.arquivoRascunho(pasta, aberta.rodada), rasc);
            return json(res, 200, { ok: true, salvo_em: rasc.salvo_em });
          }
          const tmp = path.join(P.dados, 'tmp', `cenas-${Date.now()}.json`);
          fs.mkdirSync(path.dirname(tmp), { recursive: true });
          gravarJSON(tmp, { pedidos: corpo.pedidos || [], ok: corpo.ok || [], geral: corpo.geral || '' });
          if (corpo.acao === 'ajustes') r = await rs(['cenas', id, '--ajustes', '--arquivo', tmp, '--via', 'painel', '--pedir']);
          else if (corpo.acao === 'aprovar') r = await rs(['aprovar', id, '--cenas', '--arquivo', tmp, '--via', 'painel'], { timeoutMs: 300000 });
          else { try { fs.rmSync(tmp, { force: true }); } catch {} return json(res, 400, { erro: 'Use acao "rascunho", "ajustes", "aprovar" ou "abrir".' }); }
          try { fs.rmSync(tmp, { force: true }); } catch {}
        }
      }
      else if (acao === 'tokens') r = await rs(['tokens', id], { timeoutMs: 300000 });
      else if (acao === 'abrir-pasta') {
        const pasta = path.join(P.videos, id);
        spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [pasta], { detached: true, stdio: 'ignore' }).unref();
        r = { codigo: 0, json: { ok: true } };
      } else return json(res, 404, { erro: `ação desconhecida: ${acao}` });
      return json(res, r.codigo === 0 ? 200 : 400, r.json || { ok: r.codigo === 0, saida: r.out, erro: r.err });
    }
    if (p === '/api/novo' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const prompt = String(corpo.prompt || '').trim();
      const youtube = String(corpo.youtube || '').trim();
      if (!prompt && !youtube) return json(res, 400, { erro: 'Escreva o assunto do vídeo ou cole um link do YouTube.' });
      const a = ['novo', ...(prompt ? [prompt] : []), '--origem', 'painel'];
      if (youtube) a.push('--youtube', youtube);
      if (corpo.titulo) a.push('--titulo', corpo.titulo);
      if (corpo.config) a.push('--config', JSON.stringify(corpo.config));
      const r = await rs(a, { timeoutMs: youtube ? 240000 : 120000 });
      if (r.codigo !== 0 || !r.json) return json(res, 400, { erro: r.err || r.out });
      garantirOperadorAPI();
      await rs(['pedir', 'novo', r.json.id, '--json', JSON.stringify({ prompt: prompt || null, youtube: youtube || null })]);
      return json(res, 200, r.json);
    }
    if (p === '/api/menu') return json(res, 200, { menu: lerJSON(path.join(P.config, 'menu.json')), padroes: lerJSON(path.join(P.config, 'padroes.json')), lotes: perguntasMenu().lotes });
    if (p === '/api/padroes' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const arq = path.join(P.config, 'padroes.json'); const pad = lerJSON(arq);
      for (const k of ['respostas', 'marca_cores', 'voz_ajustes', 'ajustes']) if (corpo[k]) pad[k] = { ...(pad[k] || {}), ...corpo[k] };
      for (const k of ['marca_nome', 'palavras_por_segundo', 'lead_in_s', 'cauda_s']) if (corpo[k] !== undefined) pad[k] = corpo[k];
      gravarJSON(arq, pad);
      return json(res, 200, { ok: true, padroes: pad });
    }
    if (p === '/api/pipeline' && req.method === 'GET') return json(res, 200, { estagios: pipelineCompleto() });
    if (p === '/api/pipeline' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const arq = path.join(P.config, 'pipeline.json'); const pl = lerJSON(arq);
      for (const e of pl.estagios) if (corpo.ativos && e.id in corpo.ativos && e.opcional) e.ativo = Boolean(corpo.ativos[e.id]);
      gravarJSON(arq, pl);
      return json(res, 200, { ok: true, estagios: pl.estagios });
    }
    if (p === '/api/estilos') return json(res, 200, { estilos: listarEstilos().map((e) => ({ ...e, poster: e.poster ? `/arquivo/${e.poster.split('/').map(encodeURIComponent).join('/')}` : null })) });
    if (p.startsWith('/api/vozes')) return await rotasVozes(req, res, p);
    if (p === '/api/uso') return json(res, 200, await usoGeral());
    if (p === '/api/tokens' && req.method === 'POST') { const r = await rs(['tokens'], { timeoutMs: 300000 }); return json(res, 200, r.json || { erro: r.err }); }
    if (p === '/api/fila') return json(res, 200, { pedidos: listarPedidos().slice(-60).reverse(), operador: lerOperador() });
    if (p === '/api/chaves' && req.method === 'GET') { carregarEnv(); return json(res, 200, { ELEVENLABS_API_KEY: temChave('ELEVENLABS_API_KEY'), GEMINI_API_KEY: temChave('GEMINI_API_KEY'), ANTHROPIC_API_KEY: temChave('ANTHROPIC_API_KEY'), OPENAI_API_KEY: temChave('OPENAI_API_KEY') }); }
    if (p === '/api/chaves' && req.method === 'POST') {
      // o usuário cola a chave no próprio painel local; gravamos no .env da skill (nunca devolvemos o valor)
      const corpo = await lerCorpo(req);
      const arq = path.join(RAIZ, '.env');
      let txt = existe(arq) ? fs.readFileSync(arq, 'utf8') : '';
      for (const nome of ['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        const v = String(corpo[nome] || '').trim();
        if (!v) continue;
        if (!/^[A-Za-z0-9_\-.:]{10,200}$/.test(v)) return json(res, 400, { erro: `${nome} com formato estranho.` });
        const linha = `${nome}=${v}`;
        txt = new RegExp(`^${nome}=.*$`, 'm').test(txt) ? txt.replace(new RegExp(`^${nome}=.*$`, 'm'), linha) : `${txt.replace(/\s*$/, '')}\n${linha}\n`;
        process.env[nome] = v;
      }
      fs.writeFileSync(arq, txt.replace(/^\n+/, ''), 'utf8');
      return json(res, 200, { ok: true, ELEVENLABS_API_KEY: temChave('ELEVENLABS_API_KEY'), GEMINI_API_KEY: temChave('GEMINI_API_KEY'), ANTHROPIC_API_KEY: temChave('ANTHROPIC_API_KEY'), OPENAI_API_KEY: temChave('OPENAI_API_KEY') });
    }
    if (p === '/api/executor' && req.method === 'GET') return json(res, 200, { ...lerExecutor(), operador_api: Boolean(OPERADOR_API) });
    if (p === '/api/executor' && req.method === 'POST') {
      const c = await lerCorpo(req);
      const modo = ['claude-code', 'anthropic', 'openai'].includes(c.modo) ? c.modo : 'claude-code';
      const salvo = salvarExecutor({ modo, anthropic: c.anthropic || {}, openai: c.openai || {}, ...(Number(c.max_passos) ? { max_passos: Number(c.max_passos) } : {}) });
      return json(res, 200, { ...salvo, operador_api: garantirOperadorAPI() });
    }
    if (p === '/api/doctor') { const r = await rs(['doctor', '--json'], { timeoutMs: 60000 }); return json(res, 200, { itens: r.json || [] }); }
    if (p.startsWith('/arquivo/')) return servirArquivo(req, res, p.slice('/arquivo/'.length));
    // estáticos
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const arq = path.resolve(AQUI, 'publico', rel);
    if (!arq.startsWith(path.resolve(AQUI, 'publico')) || !existe(arq)) {
      const idx = path.join(AQUI, 'publico', 'index.html');
      res.writeHead(200, { 'Content-Type': TIPOS['.html'] }); return fs.createReadStream(idx).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(arq).pipe(res);
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  try { garantirOperadorAPI(); } catch {}
  gravarJSON(path.join(P.dados, 'painel.json'), { pid: process.pid, porta: PORTA, url: `http://127.0.0.1:${PORTA}`, desde: new Date().toISOString() });
  console.log(`Painel do Estúdio de Reels em http://127.0.0.1:${PORTA}`);
});
