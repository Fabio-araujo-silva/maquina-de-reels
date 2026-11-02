#!/usr/bin/env node
// rs — motor do Estúdio de Reels. Rode `node motor/rs.mjs ajuda` para a lista de comandos.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  P, RAIZ, PYTHON, HF_BIN, agora, lerJSON, gravarJSON, gravarTexto, existe, carregarEnv, temChave,
  registrarAtividade, rodarSync, hf, erroFatal, dormir, lerTexto, copiarPasta,
} from './lib/util.mjs';
import {
  pipeline, carregarEstado, salvarEstado, novoVideo, marcar, reabrirDesde, proximo, listarVideos,
  log, pastaVideo, existeVideo, somarElevenLabs, progresso,
} from './lib/estado.mjs';
import { perguntasMenu, resolverRespostas, respostasPadrao, salvarComoPadrao } from './lib/menu.mjs';
import { validarRoteiro, roteiroParaMarkdown } from './lib/roteiro.mjs';
import { criarPedido, listarPedidos, atualizarPedido, batimento, lerOperador, ACOES } from './lib/fila.mjs';
import { calcularTokens } from './lib/tokens.mjs';
import * as RU from '../modulos/revisao-usuario/rodadas.mjs';

carregarEnv();
const argv = process.argv.slice(2);
const cmd = argv[0];

function flags(args) {
  const f = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) f[k] = v;
      else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) f[k] = args[++i];
      else f[k] = true;
    } else f._.push(a);
  }
  return f;
}
const F = flags(argv.slice(1));
const saida = (obj) => process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n');

// cada pedido da fila vem com o que fazer (vale também para uma sessão que leu um SKILL.md antigo)
const comDica = (ps) => ps.map((p) => ({ ...p, o_que_fazer: ACOES[p.acao] || null }));

function exigirId() {
  const id = F._[0];
  if (!id) erroFatal('Informe o id do vídeo (veja `rs lista`).');
  if (!existeVideo(id)) erroFatal(`Vídeo "${id}" não existe.`);
  return id;
}

function ctxDe(id) {
  let est = carregarEstado(id);
  const pasta = pastaVideo(id);
  const ctx = {
    id, pasta, RAIZ, P,
    get est() { return est; },
    recarregar() { est = carregarEstado(id); return est; },
    salvar() { salvarEstado(est); },
    config: est.config || {},
    roteiro() { return lerJSON(path.join(pasta, 'roteiro.json')); },
    log: (tipo, msg, extra) => log(id, tipo, msg, extra),
    progresso: (estagio, pct, msg) => progresso(id, estagio, pct, msg),
    elevenlabs: (chamada) => { est = carregarEstado(id); somarElevenLabs(est, chamada); salvarEstado(est); },
    arquivo: (chave, rel) => { est = carregarEstado(id); est.arquivos[chave] = rel; salvarEstado(est); },
  };
  return ctx;
}

async function carregarModulo(nome) {
  const arq = path.join(P.modulos, nome, 'run.mjs');
  if (!existe(arq)) throw new Error(`Módulo "${nome}" não tem run.mjs (${arq}).`);
  return import(pathToFileURL(arq).href);
}

// Roda um estágio executado pelo motor. Devolve o status final.
async function rodarEstagio(id, estagioId, { forcar = false } = {}) {
  const def = pipeline().find((e) => e.id === estagioId);
  if (!def) throw new Error(`Estágio "${estagioId}" não existe ou está desligado em config/pipeline.json.`);
  let est = carregarEstado(id);
  if (!forcar) {
    const ordem = pipeline();
    const antes = ordem.slice(0, ordem.findIndex((e) => e.id === estagioId));
    const faltando = antes.filter((e) => !['concluido', 'pulado'].includes(est.estagios[e.id]?.status));
    if (faltando.length) throw new Error(`Antes de "${estagioId}" falta concluir: ${faltando.map((e) => e.id).join(', ')}. (Use --forcar para ignorar.)`);
  }
  if (!def.modulo) throw new Error(`Estágio "${estagioId}" não tem módulo do motor.`);
  marcar(est, estagioId, 'em_andamento'); salvarEstado(est);
  registrarAtividade(id, 'rodar', { estagio: estagioId });
  log(id, 'estagio', `Iniciando ${def.nome}`, { estagio: estagioId });
  const ctx = ctxDe(id);
  try {
    const mod = await carregarModulo(def.modulo);
    if (typeof mod.executar !== 'function') throw new Error(`Módulo ${def.modulo} não exporta executar().`);
    const r = (await mod.executar(estagioId, ctx)) || { status: 'concluido' };
    est = carregarEstado(id);
    if (r.status === 'aguardando_claude') {
      est.estagios[estagioId].aguardando_claude = true;
      est.estagios[estagioId].instrucoes = r.instrucoes || null;
      salvarEstado(est);
      log(id, 'estagio', `${def.nome}: motor terminou, aguardando o Claude`, { estagio: estagioId });
    } else if (r.status === 'aguardando_usuario') {
      est.estagios[estagioId].aguardando_usuario = true;
      est.status = 'aguardando_usuario';
      salvarEstado(est);
    } else {
      marcar(est, estagioId, r.status === 'pulado' ? 'pulado' : 'concluido', { nota: r.nota || null });
      salvarEstado(est);
      log(id, 'estagio', `${def.nome}: ${r.status === 'pulado' ? 'pulado' : 'concluído'}${r.nota ? ` (${r.nota})` : ''}`, { estagio: estagioId });
    }
    try { fs.unlinkSync(path.join(pastaVideo(id), 'progresso.json')); } catch {}
    return { ...r, estagio: estagioId };
  } catch (e) {
    est = carregarEstado(id);
    marcar(est, estagioId, 'erro', { erro: e.message });
    salvarEstado(est);
    log(id, 'erro', `${def.nome}: ${e.message}`, { estagio: estagioId, stack: String(e.stack || '').split('\n').slice(0, 6).join('\n') });
    try { fs.unlinkSync(path.join(pastaVideo(id), 'progresso.json')); } catch {}
    throw e;
  }
}

// O reel nasceu de um vídeo do YouTube? Então o roteiro começa pela fonte.
function avisoFonte(est) {
  const f = est.fonte;
  if (!f) return '';
  if (f.erro) return `FONTE: a busca do vídeo do YouTube falhou (${f.erro}). Tente \`node motor/rs.mjs fonte ${est.id}\` antes de escrever. `;
  if (f.sem_legenda) return `FONTE: o vídeo do YouTube "${f.titulo}" não tem legenda. Rode \`node motor/rs.mjs fonte ${est.id} --transcrever\` (minutos) e depois leia videos/${est.id}/fonte/resumo.md e fonte/transcricao.txt. `;
  return `FONTE: este reel é sobre o vídeo do YouTube "${f.titulo}". Leia antes videos/${est.id}/fonte/resumo.md e fonte/transcricao.txt (seção "Fonte do YouTube" do ${'modulos/roteiro/MODULO.md'}). `;
}

// Acrescenta a fonte ao briefing.md (uma vez; substitui a seção se já existir).
function anexarFonteNoBriefing(id, f) {
  const arq = path.join(pastaVideo(id), 'briefing.md');
  let txt = '';
  try { txt = fs.readFileSync(arq, 'utf8'); } catch {}
  txt = txt.replace(/\n## Fonte[\s\S]*$/, '\n').trimEnd();
  const linha = f.erro ? `- YouTube: ${f.url} (a busca falhou: ${f.erro})`
    : `- YouTube: [${f.titulo}](${f.url})${f.canal ? ` · ${f.canal}` : ''} · ${f.sem_legenda ? 'sem legenda (rode rs fonte <id> --transcrever)' : `${f.palavras} palavras em fonte/transcricao.txt`}`;
  fs.writeFileSync(arq, `${txt}\n\n## Fonte\n${linha}\n`, 'utf8');
}

function instrucaoPara(est, e) {
  const id = est.id;
  const rs = 'node motor/rs.mjs';
  const st = est.estagios[e.id] || {};
  if (e.id === 'menu') return { tipo: 'usuario', acao: `Rode \`${rs} menu ${id} --perguntas\`, faça TODAS as perguntas com AskUserQuestion (um lote por chamada) e salve com \`${rs} menu ${id} --responder '<json>'\`.` };
  if (e.id === 'revisao') return { tipo: 'usuario', acao: `Mostre o roteiro (videos/${id}/roteiro.md) ao usuário, rode \`${rs} aguardar ${id}\` em segundo plano e termine o turno. Aprovação: \`${rs} aprovar ${id}\`. Ajustes: \`${rs} ajustes ${id} --notas "..."\`.` };
  if (e.id === 'revisao_usuario') {
    if (st.aguardando_claude) return { tipo: 'claude', doc: e.doc, acao: st.instrucoes || `O usuário pediu ajustes na revisão dele. Siga ${e.doc}: \`${rs} cenas ${id}\` mostra os pedidos cena a cena.` };
    if (st.aguardando_usuario) return { tipo: 'usuario', doc: e.doc, acao: `O vídeo está pronto para a revisão do usuário, cena a cena: http://127.0.0.1:4777/#/v/${id}/revisar . Diga isso a ele, rode \`${rs} aguardar ${id}\` em segundo plano e termine o turno. Nunca aprove por ele. Aprovou no chat: \`${rs} aprovar ${id} --cenas\`. Ajustes: ${e.doc}.` };
  }
  if (e.id === 'roteiro') return { tipo: 'claude', doc: e.doc, acao: `${avisoFonte(est)}Leia ${e.doc}, escreva videos/${id}/roteiro.json, valide com \`${rs} roteiro ${id} --validar\` até passar e publique com \`${rs} roteiro ${id} --publicar\`.${(est.estagios.roteiro?.ajustes || []).length ? ` AJUSTES PEDIDOS: ${est.estagios.roteiro.ajustes.slice(-1)[0].notas}` : ''}` };
  if (e.executor === 'claude') return { tipo: 'claude', doc: e.doc, acao: `Leia ${e.doc} e faça o estágio "${e.nome}". Depois: \`${rs} concluir ${id} ${e.id}\`.` };
  if (e.executor === 'motor+claude') {
    if (st.aguardando_claude) return { tipo: 'claude', doc: e.doc, acao: st.instrucoes || `Complete o estágio lendo ${e.doc}; depois \`${rs} concluir ${id} ${e.id}\`.` };
    return { tipo: 'motor', acao: `\`${rs} auto ${id}\` (ou \`${rs} rodar ${id} ${e.id}\`).` };
  }
  return { tipo: 'motor', acao: `\`${rs} auto ${id}\` (ou \`${rs} rodar ${id} ${e.id}\`).` };
}

function resumoVideo(est) {
  const prog = lerJSON(path.join(pastaVideo(est.id), 'progresso.json'), null);
  const tk = lerJSON(path.join(pastaVideo(est.id), 'tokens.json'), null);
  return {
    id: est.id, titulo: est.titulo, estagio: est.estagio, status: est.status,
    atualizado_em: est.atualizado_em, progresso: prog, erro: est.erro,
    tokens: tk?.total || null, elevenlabs_caracteres: est.custos?.elevenlabs?.caracteres || 0,
    final: est.arquivos?.final || null,
  };
}

const comandos = {
  async ajuda() {
    saida(`rs — Estúdio de Reels
  doctor                         verifica dependências e chaves
  novo "<prompt>" [--titulo T]   cria um vídeo (devolve o id)
  novo [prompt] --youtube <link>  cria um vídeo sobre o assunto de um vídeo do YouTube (lê a legenda; prompt opcional)
  fonte <id> [link] [--transcrever|--whisper]  busca de novo a fonte do YouTube (sem legenda: --transcrever usa o áudio)
  lista                          lista os vídeos e seus estágios
  status <id>                    estado completo de um vídeo
  proximo <id>                   o que fazer agora (para o Claude)
  menu <id> --perguntas          lotes do menu de montagem (para AskUserQuestion)
  menu <id> --responder '<json>' [--salvar-padrao]   grava as escolhas
  menu <id> --padrao             aceita todos os padrões
  roteiro <id> --validar         valida videos/<id>/roteiro.json
  roteiro <id> --publicar        valida, gera roteiro.md e abre a revisão
  aprovar <id> [--notas "..."]   aprova o roteiro
  ajustes <id> --notas "..."     pede ajustes no roteiro (volta ao estágio roteiro)
  aguardar <id> [--timeout-min N]  espera aprovação/ajustes/pedido do painel (rode em 2º plano)
  rodar <id> <estagio> [--forcar]  roda um estágio do motor
  auto <id>                      roda em sequência todos os estágios do motor até precisar do Claude ou de você
  agente <id>                    modo API: o modelo de config/executor.json faz as etapas do Claude (para no painel nas suas decisões)
  agente --fila                  modo API: operador da fila do painel (pedidos novos viram vídeos sozinhos)
  concluir <id> <estagio> [--nota "..."]  marca um estágio feito pelo Claude
  refazer <id> <estagio>         reabre o estágio e os seguintes
  config <id> --set chave=valor  muda a config de um vídeo
  fila [--aguardar] [--timeout-min N]  pedidos do painel
  fila --pegar <pedido> | --concluir <pedido> [--resultado "..."] | --erro <pedido> --msg "..."
  pedir <acao> [<id>] [--json '{}']  cria um pedido na fila (o painel usa isto)
  tokens [<id>]                  recalcula tokens por vídeo a partir dos transcripts
  vozes [--atualizar]            lista/atualiza vozes pt-BR da ElevenLabs
  estilos                        lista estilos (casa + lemo-opuscar)
  painel [--garantir|--parar]    sobe o painel web (http://127.0.0.1:4777)
  passo <id> "texto"             anuncia o que o Claude está fazendo (aparece ao vivo no painel)
  quadros <id> [--at 1.2,5.0]    tira quadros do projeto (folha em videos/<id>/quadros/rascunho.jpg)
  aprovar <id> --previa          libera o render quando a prévia foi pedida no menu
  aprovar <id> --cenas [--arquivo f.json]  sua revisão cena a cena: aprova e entrega
  cenas <id>                     o que o usuário pediu na revisão cena a cena (para o Claude)
  cenas <id> --ajustes --arquivo f.json [--pedir]  registra ajustes por cena (o painel usa isto)
  cenas <id> --responder --arquivo f.json  o Claude responde cena a cena o que fez
  cenas <id> --abrir             abre uma rodada nova da sua revisão num vídeo já entregue
  log <id> "mensagem"            registra uma nota no log do vídeo`);
  },

  async doctor() {
    const itens = [];
    const ok = (nome, cond, det = '', dica = '') => itens.push({ nome, ok: Boolean(cond), detalhe: det, dica });
    const nodeV = process.versions.node.split('.').map(Number);
    ok('Node 22+', nodeV[0] >= 22, process.versions.node);
    const ff = rodarSync('ffmpeg', ['-version']);
    ok('ffmpeg', ff.codigo === 0, ff.saida.split('\n')[0]);
    ok('ffprobe', rodarSync('ffprobe', ['-version']).codigo === 0);
    ok('HyperFrames (local, fixado)', existe(HF_BIN), existe(HF_BIN) ? hf(['--version']).saida.trim() : '', 'npm install na pasta da skill');
    ok('three.js', existe(path.join(P.nodeModules, 'three', 'build', 'three.module.js')));
    ok('gsap', existe(path.join(P.nodeModules, 'gsap', 'dist', 'gsap.min.js')));
    ok('Ícones Phosphor (colagem)', existe(path.join(P.nodeModules, '@phosphor-icons', 'core', 'assets', 'fill')));
    ok('Python (.venv)', existe(PYTHON), PYTHON, 'python -m venv --system-site-packages .venv');
    if (existe(PYTHON)) {
      const r = rodarSync(PYTHON, ['-c', 'import numpy,scipy,soundfile,soxr,faster_whisper,kokoro_onnx,numba;print("ok")']);
      ok('Pacotes Python (numpy, scipy, soundfile, soxr, faster-whisper, kokoro-onnx, numba)', r.saida.includes('ok'), r.erro.split('\n').filter(Boolean).slice(-1)[0] || '');
    }
    ok('lemo-opuscar (externos)', existe(path.join(P.externos, 'lemo-opuscar', 'styles')));
    ok('gbro-collage-broll (externos)', existe(path.join(P.externos, 'gbro-collage-broll', 'SKILL.md')));
    ok('Chave ElevenLabs', temChave('ELEVENLABS_API_KEY'), temChave('ELEVENLABS_API_KEY') ? 'configurada' : 'ausente', 'Coloque ELEVENLABS_API_KEY=... no arquivo .env da skill');
    ok('Chave Gemini (opcional, colagem gbro original)', temChave('GEMINI_API_KEY'), temChave('GEMINI_API_KEY') ? 'configurada' : 'ausente (opcional)');
    if (F.completo) {
      const d = hf(['doctor', '--json']);
      try { const j = JSON.parse(d.saida); for (const c of j.checks || []) if (/chrome|ffmpeg/i.test(c.name)) ok(`HyperFrames: ${c.name}`, c.ok, c.detail); } catch { ok('HyperFrames doctor', false, d.erro.slice(0, 200)); }
    }
    const op = lerOperador();
    itens.push({ nome: 'Operador da fila (Claude escutando o painel)', ok: op.ativo, detalhe: op.ativo ? `sessão ${String(op.sessao).slice(0, 8)}` : 'nenhum', opcional: true });
    if (F.json) return saida(itens);
    for (const i of itens) saida(`${i.ok ? '✓' : (i.opcional || /opcional/.test(i.nome) ? '·' : '✗')} ${i.nome}${i.detalhe ? ` — ${i.detalhe}` : ''}${!i.ok && i.dica ? `\n    → ${i.dica}` : ''}`);
    const falhas = itens.filter((i) => !i.ok && !i.opcional && !/opcional|ElevenLabs/.test(i.nome));
    process.exitCode = falhas.length ? 1 : 0;
  },

  async novo() {
    let prompt = (F._.join(' ').trim() || (typeof F.prompt === 'string' ? F.prompt : '')).trim();
    const yt = typeof F.youtube === 'string' ? F.youtube.trim() : null;
    if (!prompt && !yt) erroFatal('Uso: rs novo "<prompt do vídeo>" [--youtube <link>]');
    let config = null;
    if (F.config) config = JSON.parse(F.config);
    // link do YouTube: busca antes de criar (o título do vídeo pode virar o nome do reel)
    let fonte = null; let erroFonte = null; let tmpFonte = null;
    if (yt) {
      const Y = await import(pathToFileURL(path.join(P.modulos, 'fonte', 'youtube.mjs')).href);
      tmpFonte = path.join(P.dados, 'tmp', `fonte-${Date.now()}`);
      try { fonte = await Y.buscarYoutube({ url: yt, pasta: tmpFonte, transcrever: Boolean(F.transcrever), whisper: Boolean(F.whisper) }); }
      catch (e) { erroFonte = e.message; }
      if (!prompt) prompt = fonte ? `Faça um vídeo sobre o assunto deste vídeo do YouTube: "${fonte.titulo}"${fonte.canal ? ` (canal ${fonte.canal})` : ''}.` : `Faça um vídeo sobre o assunto deste vídeo do YouTube: ${yt}`;
    }
    const semPrompt = !F._.length && typeof F.prompt !== 'string';
    const est = novoVideo({ prompt, titulo: F.titulo || (semPrompt && fonte ? String(fonte.titulo).slice(0, 60) : null), origem: F.origem || 'chat', config });
    if (yt) {
      const Y = await import(pathToFileURL(path.join(P.modulos, 'fonte', 'youtube.mjs')).href);
      if (fonte) { copiarPasta(path.join(tmpFonte, 'fonte'), path.join(pastaVideo(est.id), 'fonte')); }
      try { fs.rmSync(tmpFonte, { recursive: true, force: true }); } catch {}
      const e1 = carregarEstado(est.id);
      e1.fonte = Y.resumoFonte(fonte, yt, erroFonte);
      salvarEstado(e1);
      anexarFonteNoBriefing(est.id, e1.fonte);
      log(est.id, fonte ? 'fonte' : 'aviso', fonte ? `Fonte do YouTube: "${fonte.titulo}" (${fonte.palavras} palavras transcritas${fonte.sem_legenda ? '; sem legenda' : ''})` : `A busca do vídeo do YouTube falhou: ${erroFonte}`);
    }
    if (config) {
      const e2 = carregarEstado(est.id);
      const { config: cfg, avisos } = resolverRespostas(config);
      e2.config = cfg; marcar(e2, 'menu', 'concluido', { nota: 'escolhido no painel' }); salvarEstado(e2);
      if (avisos.length) log(est.id, 'aviso', avisos.join(' '));
    }
    const fim = carregarEstado(est.id);
    saida({ id: est.id, pasta: pastaVideo(est.id), proximo: proximo(fim)?.id, ...(fim.fonte ? { fonte: fim.fonte } : {}) });
  },

  // Fonte externa: busca (ou busca de novo) o vídeo do YouTube de um reel. --transcrever: sem legenda, transcreve o áudio; --whisper: sempre pelo áudio.
  async fonte() {
    const id = exigirId();
    const est = carregarEstado(id);
    const url = F._[1] || est.fonte?.url;
    if (!url) erroFatal('Uso: rs fonte <id> <link do YouTube> [--transcrever] [--whisper]');
    registrarAtividade(id, 'fonte', { estagio: est.estagio });
    const Y = await import(pathToFileURL(path.join(P.modulos, 'fonte', 'youtube.mjs')).href);
    let meta = null; let erro = null;
    try { meta = await Y.buscarYoutube({ url, pasta: pastaVideo(id), transcrever: Boolean(F.transcrever), whisper: Boolean(F.whisper), log: (m) => progresso(id, est.estagio, 30, m) }); }
    catch (e) { erro = e.message; }
    try { fs.unlinkSync(path.join(pastaVideo(id), 'progresso.json')); } catch {}
    const e2 = carregarEstado(id);
    e2.fonte = Y.resumoFonte(meta, url, erro);
    salvarEstado(e2);
    anexarFonteNoBriefing(id, e2.fonte);
    log(id, meta ? 'fonte' : 'aviso', meta ? `Fonte do YouTube: "${meta.titulo}" (${meta.palavras} palavras${meta.sem_legenda ? '; sem legenda' : ''})` : `A busca do vídeo do YouTube falhou: ${erro}`);
    if (!meta) { saida({ ok: false, erro }); process.exitCode = 1; return; }
    saida({ ok: true, fonte: e2.fonte, ler: [`videos/${id}/fonte/resumo.md`, `videos/${id}/fonte/transcricao.txt`] });
  },

  async lista() {
    const vs = listarVideos();
    if (F.json) return saida(vs.map(resumoVideo));
    if (!vs.length) return saida('Nenhum vídeo ainda.');
    for (const v of vs) saida(`${v.id}  [${v.estagio} · ${v.status}]  ${v.titulo || v.prompt.slice(0, 50)}`);
  },

  async status() {
    const id = exigirId();
    const est = carregarEstado(id);
    if (F.curto) return saida(resumoVideo(est));
    saida({ ...est, proximo: proximo(est), operador: lerOperador() });
  },

  async proximo() {
    const id = exigirId();
    const est = carregarEstado(id);
    const e = proximo(est);
    if (!e) return saida({ video: id, concluido: true, final: est.arquivos?.final || null });
    registrarAtividade(id, 'proximo', { estagio: e.id });
    saida({ video: id, estagio: e.id, nome: e.nome, executor: e.executor, status: e.status, ...instrucaoPara(est, e), config_pronta: Boolean(est.config) });
  },

  async menu() {
    const id = exigirId();
    registrarAtividade(id, 'menu', { estagio: 'menu' });
    if (F.perguntas) return saida(perguntasMenu());
    let respostas = null;
    if (F.padrao) respostas = respostasPadrao();
    if (F.responder) respostas = typeof F.responder === 'string' ? JSON.parse(F.responder) : null;
    if (F.arquivo) respostas = lerJSON(F.arquivo);
    if (!respostas) erroFatal('Use --perguntas, --responder \'<json>\', --arquivo <f.json> ou --padrao.');
    const { config, outros, avisos } = resolverRespostas(respostas);
    const est = carregarEstado(id);
    est.config = config;
    marcar(est, 'menu', 'concluido', { nota: Object.keys(outros).length ? `respostas livres: ${Object.keys(outros).join(', ')}` : null });
    salvarEstado(est);
    log(id, 'menu', 'Menu de montagem respondido', { config });
    if (avisos.length) log(id, 'aviso', avisos.join(' '));
    if (F['salvar-padrao']) {
      const pad = salvarComoPadrao(config);
      gravarJSON(path.join(P.config, 'padroes.json'), pad);
    }
    saida({ ok: true, config, avisos, respostas_livres: outros });
  },

  async roteiro() {
    const id = exigirId();
    registrarAtividade(id, 'roteiro', { estagio: 'roteiro' });
    const est = carregarEstado(id);
    const arq = path.join(pastaVideo(id), 'roteiro.json');
    if (!existe(arq)) erroFatal(`Escreva primeiro ${arq} (veja modulos/roteiro/MODULO.md).`);
    let r;
    try { r = lerJSON(arq); } catch (e) { return saida({ ok: false, erros: [`JSON inválido: ${e.message}`] }); }
    const v = validarRoteiro(r, est.config || {});
    if (F.validar && !F.publicar) { saida(v); process.exitCode = v.ok ? 0 : 1; return; }
    if (F.publicar) {
      if (!v.ok) { saida(v); erroFatal('Corrija os erros antes de publicar.'); }
      gravarTexto(path.join(pastaVideo(id), 'roteiro.md'), roteiroParaMarkdown(r, v, est.config || {}));
      est.titulo = r.titulo;
      est.metricas_roteiro = v.metricas;
      if (!est.estagios.roteiro.inicio) est.estagios.roteiro.inicio = agora();
      marcar(est, 'roteiro', 'concluido');
      est.estagios.revisao = { status: 'aguardando', desde: agora(), versao: (est.estagios.revisao?.versao || 0) + 1 };
      est.status = 'aguardando_usuario';
      salvarEstado(est);
      fs.copyFileSync(arq, path.join(pastaVideo(id), `roteiro.v${est.estagios.revisao.versao}.json`));
      log(id, 'estagio', `Roteiro v${est.estagios.revisao.versao} publicado para revisão`, { estagio: 'revisao', metricas: v.metricas });
      return saida({ ok: true, revisao: `videos/${id}/roteiro.md`, versao: est.estagios.revisao.versao, metricas: v.metricas, avisos: v.avisos });
    }
    saida(v);
  },

  async aprovar() {
    const id = exigirId();
    if (F.cenas) {
      // Sua revisão: aprovado → registra a decisão na rodada e roda a entrega na hora (segundos)
      registrarAtividade(id, 'aprovar', { estagio: 'revisao_usuario' });
      const pasta = pastaVideo(id);
      const aberta = RU.rodadaAberta(pasta);
      if (!aberta) erroFatal('Nenhuma rodada da sua revisão está aberta (o vídeo ainda não chegou nesse estágio ou já foi decidido).');
      const dados = F.arquivo ? lerJSON(F.arquivo, {}) : {};
      const d = RU.normalizarDecisao({ ok: dados.ok || aberta.cenas.map((c) => c.fala), geral: dados.geral || F.notas || '' }, aberta);
      Object.assign(aberta, { decisao: 'aprovado', decidido_em: agora(), via: F.via || 'chat', ok: d.ok, geral: d.geral, pedidos: [] });
      RU.gravarRodada(pasta, aberta);
      try { fs.rmSync(RU.arquivoRascunho(pasta, aberta.rodada), { force: true }); } catch {}
      const est = carregarEstado(id);
      marcar(est, 'revisao_usuario', 'concluido', { nota: `aprovado por você na rodada ${aberta.rodada}`, aguardando_usuario: false, aguardando_claude: false });
      salvarEstado(est);
      log(id, 'revisao', `Sua revisão: vídeo aprovado (rodada ${aberta.rodada})${d.geral ? ` · "${d.geral}"` : ''}`, { via: F.via || 'chat' });
      let entrega = null;
      if (proximo(carregarEstado(id))?.id === 'entrega') {
        try { const r = await rodarEstagio(id, 'entrega'); entrega = { ok: true, nota: r.nota || null }; }
        catch (e) { entrega = { ok: false, erro: e.message }; }
      }
      return saida({ ok: true, rodada: aberta.rodada, entrega, final: carregarEstado(id).arquivos?.final || null });
    }
    if (F.previa) {
      registrarAtividade(id, 'aprovar-previa', { estagio: 'render' });
      const e = carregarEstado(id);
      e.previa_aprovada = true;
      if (e.estagios.render) { e.estagios.render.status = 'pendente'; delete e.estagios.render.aguardando_usuario; }
      salvarEstado(e);
      log(id, 'revisao', 'Prévia aprovada', { via: F.via || 'chat' });
      return saida({ ok: true, proximo: 'render', dica: `node motor/rs.mjs auto ${id}` });
    }
    registrarAtividade(id, 'aprovar', { estagio: 'revisao' });
    const est = carregarEstado(id);
    if (!['concluido'].includes(est.estagios.roteiro?.status)) erroFatal('O roteiro ainda não foi publicado.');
    marcar(est, 'revisao', 'concluido', { aprovado_em: agora(), notas: F.notas || null, via: F.via || 'chat' });
    salvarEstado(est);
    gravarJSON(path.join(pastaVideo(id), 'revisao.json'), { decisao: 'aprovado', notas: F.notas || null, via: F.via || 'chat', ts: agora() });
    log(id, 'revisao', 'Roteiro aprovado', { via: F.via || 'chat' });
    saida({ ok: true, proximo: proximo(carregarEstado(id))?.id });
  },

  async ajustes() {
    const id = exigirId();
    registrarAtividade(id, 'ajustes', { estagio: 'roteiro' });
    if (!F.notas) erroFatal('Use --notas "o que mudar".');
    const est = carregarEstado(id);
    reabrirDesde(est, 'roteiro');
    est.estagios.roteiro.ajustes = [...(est.estagios.roteiro.ajustes || []), { notas: F.notas, ts: agora(), via: F.via || 'chat' }];
    salvarEstado(est);
    gravarJSON(path.join(pastaVideo(id), 'revisao.json'), { decisao: 'ajustes', notas: F.notas, via: F.via || 'chat', ts: agora() });
    log(id, 'revisao', `Ajustes pedidos: ${F.notas}`, { via: F.via || 'chat' });
    saida({ ok: true, notas: F.notas });
  },

  async aguardar() {
    const id = exigirId();
    const limite = Date.now() + (Number(F['timeout-min']) || 360) * 60000;
    const arqRev = path.join(pastaVideo(id), 'revisao.json');
    const inicial = lerJSON(arqRev, null)?.ts || null;
    const pedidosIniciais = new Set(listarPedidos().map((p) => p.id));
    const decisoesRU = () => RU.listarRodadas(pastaVideo(id)).filter((r) => r.decisao).map((r) => `${r.rodada}:${r.decisao}:${r.decidido_em}`);
    const iniciaisRU = new Set(decisoesRU());
    batimento({ esperando: id });
    while (Date.now() < limite) {
      const rev = lerJSON(arqRev, null);
      if (rev && rev.ts !== inicial) return saida({ evento: 'revisao', video: id, ...rev, proximo_passo: rev.decisao === 'aprovado' ? `node motor/rs.mjs auto ${id}` : 'reescreva o roteiro com as notas e publique de novo' });
      const novaRU = decisoesRU().find((k) => !iniciaisRU.has(k));
      if (novaRU) {
        const u = RU.listarRodadas(pastaVideo(id)).find((r) => `${r.rodada}:${r.decisao}:${r.decidido_em}` === novaRU);
        return saida({
          evento: 'revisao_usuario', video: id, rodada: u.rodada, decisao: u.decisao, via: u.via || null,
          ajustes: (u.pedidos || []).length, geral: u.geral || '',
          proximo_passo: u.decisao === 'aprovado' ? 'A entrega já rodou junto com a aprovação: relate a entrega (SKILL.md §6).' : `Siga modulos/revisao-usuario/MODULO.md: node motor/rs.mjs cenas ${id}`,
        });
      }
      const novos = listarPedidos({ status: 'pendente' }).filter((p) => !pedidosIniciais.has(p.id));
      if (novos.length) return saida({ evento: 'pedido', pedidos: novos });
      batimento({ esperando: id });
      await dormir(2000);
    }
    saida({ evento: 'timeout', video: id });
  },

  // Modo API: roda o vídeo inteiro sem Claude Code (o modelo vem de config/executor.json).
  // rs agente <id>   → leva o vídeo até a entrega, parando para o painel nas decisões do usuário
  // rs agente --fila → operador da fila do painel por API (fica escutando)
  async agente() {
    const { rodarAgente, rodarRs, lerExecutor } = await import('./lib/agente.mjs');
    const cfg = lerExecutor();
    if (cfg.modo === 'claude-code') erroFatal('O executor está em "claude-code". Mude em Configurações → Modelo (ou config/executor.json) para "anthropic" ou "openai".');
    const ultimoJSON = (txt) => { const i = txt.lastIndexOf('\n{'); try { return JSON.parse(i >= 0 ? txt.slice(i + 1) : txt); } catch { try { return JSON.parse(txt); } catch { return null; } } };
    const somarUso = (id, rotulo, uso) => {
      const arq = path.join(pastaVideo(id), 'tokens_api.json');
      const t = lerJSON(arq, { modelo: cfg.modo === 'anthropic' ? cfg.anthropic.modelo : cfg.openai.modelo, etapas: [] });
      t.etapas.push({ etapa: rotulo, ts: agora(), ...uso }); gravarJSON(arq, t);
    };
    const tarefa = async (id, rotulo, texto) => {
      log(id, 'agente', `API: ${rotulo}`);
      await rodarRs(['passo', id, `API · ${rotulo}`]);
      const r = await rodarAgente(texto, { aoEvento: (ev) => { if (ev.tipo === 'ferramenta') process.stderr.write(`  · ${ev.nome} ${JSON.stringify(ev.entrada).slice(0, 120)}\n`); } });
      somarUso(id, rotulo, r.uso);
      return r;
    };
    const levarVideo = async (id) => {
      const vistos = {};
      for (let guarda = 0; guarda < 60; guarda++) {
        const a = ultimoJSON((await rodarRs(['auto', id])).out);
        if (!a) erroFatal('Não consegui ler a saída de `rs auto`.');
        if (a.concluido) return { id, concluido: true };
        if (a.ok === false) return { id, erro_em: a.erro_em, erro: a.erro };
        const e = a.parou_em;
        const est = carregarEstado(id); const st = est.estagios[e] || {};
        if (e === 'menu') { await rodarRs(['menu', id, '--padrao']); continue; }
        const doUsuario = a.executor === 'usuario' || st.aguardando_usuario || (e === 'revisao_usuario' && !st.aguardando_claude);
        if (doUsuario) {
          process.stderr.write(`Esperando você no painel (${e}): http://127.0.0.1:4777/#/v/${id}\n`);
          const w = ultimoJSON((await rodarRs(['aguardar', id], 7 * 60 * 60 * 1000)).out);
          if (!w || w.evento === 'timeout') return { id, esperando: e };
          if (w.evento === 'pedido') return { id, pedido: true };
          continue;
        }
        vistos[e] = (vistos[e] || 0) + 1;
        if (vistos[e] > 4) return { id, erro_em: e, erro: 'o agente não conseguiu concluir esta etapa em 4 tentativas' };
        const base = `Vídeo: ${id} (pasta videos/${id}/). O motor parou no estágio "${e}".\nInstrução do motor: ${a.acao || ''}\nDocumento do estágio: ${a.doc || 'SKILL.md'}.`;
        if (e === 'revisao_final') {
          // revisor independente: conversa nova, só com o briefing e o pacote
          const pac = (a.acao || '').match(/pacote (\S+pacote\.md)/)?.[1];
          await tarefa(id, 'agente revisor', `Você é o agente revisor independente. Leia modulos/revisor/REVISOR.md e siga-o à risca para o pacote ${pac || `videos/${id}/revisor/`} do vídeo ${id}. Grave o parecer no arquivo indicado no pacote. Invenções marcadas no roteiro como autorizadas pelo usuário não são erro de fato. Não corrija nada: só avalie.`);
          await tarefa(id, 'aplicar parecer do revisor', `${base}\nO parecer desta rodada já foi gravado. Siga modulos/revisor/MODULO.md: aplique as correções, grave \`respostas\` como lista [{id, acao, como}] e re-renderize, ou conclua o estágio se o veredito for aprovado.`);
          continue;
        }
        if (e === 'roteiro') {
          await tarefa(id, 'roteiro', `${base}\nO pedido do usuário está em videos/${id}/briefing.md e a config em \`rs status ${id}\`. Pesquise os fatos (use a busca na web se tiver), escreva o roteiro.json, valide até ok:true e publique com \`rs roteiro ${id} --publicar\`. Não aprove: a aprovação é do usuário, no painel.`);
          continue;
        }
        await tarefa(id, e, `${base}\nFaça esta etapa completa seguindo o documento e o SKILL.md (§5), e termine com o comando de conclusão.`);
      }
      return { id, erro: 'muitas voltas no orquestrador' };
    };

    if (F.fila) {
      process.stderr.write(`Operador da fila por API (${cfg.modo}). Ctrl+C para parar.\n`);
      for (;;) {
        await rodarRs(['fila', '--aguardar', '--timeout-min', '600'], 11 * 60 * 60 * 1000);
        for (const p of listarPedidos({ status: 'pendente' })) {
          await rodarRs(['fila', '--pegar', p.id]);
          try {
            if (p.acao !== 'novo' && p.acao !== 'cancelar') {
              await tarefa(p.video || p.id, `pedido ${p.acao}`, `Pedido da fila do painel (já marcado como pego): ${JSON.stringify(p)}\nExecute-o seguindo o SKILL.md §7, sem rodar \`aguardar\`. Não feche o pedido: o orquestrador fecha.`);
            }
            const r = p.acao === 'cancelar' ? { cancelado: true } : p.video ? await levarVideo(p.video) : {};
            await rodarRs(['fila', '--concluir', p.id, '--resultado', JSON.stringify(r).slice(0, 400)]);
          } catch (err) { await rodarRs(['fila', '--erro', p.id, '--msg', String(err.message || err).slice(0, 400)]); }
        }
      }
    }
    const id = exigirId();
    try { saida(await levarVideo(id)); } catch (err) { erroFatal(err.message || String(err)); }
  },

  async rodar() {
    const id = exigirId();
    const estagio = F._[1];
    if (!estagio) erroFatal('Uso: rs rodar <id> <estagio>');
    try { const r = await rodarEstagio(id, estagio, { forcar: Boolean(F.forcar) }); saida({ ok: true, ...r, proximo: proximo(carregarEstado(id))?.id }); }
    catch (e) { erroFatal(e.message); }
  },

  async auto() {
    const id = exigirId();
    const feitos = [];
    for (let guarda = 0; guarda < 30; guarda++) {
      const est = carregarEstado(id);
      const e = proximo(est);
      if (!e) { saida({ ok: true, feitos, concluido: true, final: est.arquivos?.final || null }); return; }
      const st = est.estagios[e.id] || {};
      if (e.executor === 'usuario' || e.executor === 'claude' || (e.executor === 'motor+claude' && st.aguardando_claude) || (e.id === 'revisao_usuario' && st.aguardando_claude) || st.aguardando_usuario) {
        saida({ ok: true, feitos, parou_em: e.id, executor: e.executor, ...instrucaoPara(est, e) });
        return;
      }
      if (st.status === 'erro' && !F.repetir) { saida({ ok: false, feitos, erro_em: e.id, erro: st.erro, dica: `Corrija e rode \`node motor/rs.mjs rodar ${id} ${e.id}\`` }); process.exitCode = 1; return; }
      try { const r = await rodarEstagio(id, e.id); feitos.push({ estagio: e.id, status: r.status, nota: r.nota || null }); }
      catch (err) { saida({ ok: false, feitos, erro_em: e.id, erro: err.message }); process.exitCode = 1; return; }
    }
    saida({ ok: false, feitos, erro: 'Muitos passos seguidos; verifique o pipeline.' });
  },

  async concluir() {
    const id = exigirId();
    const estagio = F._[1];
    if (!estagio) erroFatal('Uso: rs concluir <id> <estagio>');
    registrarAtividade(id, 'concluir', { estagio });
    const def = pipeline().find((e) => e.id === estagio);
    if (!def) erroFatal(`Estágio desconhecido: ${estagio}`);
    // validação opcional do módulo (pule com --forcar)
    if (def.modulo && !F.forcar) {
      try {
        const mod = await carregarModulo(def.modulo);
        if (typeof mod.validarConclusao === 'function') {
          const v = await mod.validarConclusao(estagio, ctxDe(id));
          if (v && v.ok === false) { saida(v); erroFatal(`O estágio "${estagio}" ainda não pode ser concluído.`); }
        }
      } catch (e) { if (!/não tem run\.mjs/.test(e.message)) erroFatal(e.message); }
    }
    const est = carregarEstado(id);
    marcar(est, estagio, 'concluido', { nota: F.nota || null, aguardando_claude: false });
    salvarEstado(est);
    log(id, 'estagio', `${def.nome}: concluído${F.nota ? ` (${F.nota})` : ''}`, { estagio });
    saida({ ok: true, proximo: proximo(carregarEstado(id))?.id });
  },

  // Sua revisão cena a cena: ver (padrão), abrir uma rodada num vídeo já entregue, registrar ajustes, responder.
  async cenas() {
    const id = exigirId();
    const pasta = pastaVideo(id);
    if (F.abrir) {
      registrarAtividade(id, 'cenas', { estagio: 'revisao_usuario' });
      if (!existe(path.join(pasta, 'out', 'render.mp4'))) erroFatal('Este vídeo ainda não tem render: a sua revisão abre depois do render.');
      const ja = RU.rodadaAberta(pasta);
      if (ja) return saida({ ok: true, ja_aberta: true, rodada: ja.rodada });
      const est = carregarEstado(id);
      const ordem = pipeline().map((e) => e.id);
      if (!ordem.includes('revisao_usuario')) erroFatal('"Sua revisão" está desligada em config/pipeline.json.');
      const antes = ordem.slice(0, ordem.indexOf('revisao_usuario'));
      const falta = antes.filter((e) => !['concluido', 'pulado'].includes(est.estagios[e]?.status));
      if (falta.length) erroFatal(`Antes da sua revisão falta concluir: ${falta.join(', ')}.`);
      reabrirDesde(est, 'revisao_usuario');
      salvarEstado(est);
      log(id, 'revisao', 'Sua revisão reaberta pelo painel');
      try { const r = await rodarEstagio(id, 'revisao_usuario'); return saida({ ok: true, rodada: RU.rodadaAberta(pasta)?.rodada || null, nota: r.nota || null }); }
      catch (e) { erroFatal(e.message); }
    }
    if (F.ajustes) {
      registrarAtividade(id, 'cenas', { estagio: 'revisao_usuario' });
      const aberta = RU.rodadaAberta(pasta);
      if (!aberta) erroFatal('Nenhuma rodada da sua revisão está aberta para receber ajustes.');
      const dados = F.arquivo ? lerJSON(F.arquivo, {}) : { geral: F.notas || '' };
      const d = RU.normalizarDecisao(dados, aberta);
      if (!d.pedidos.length && !d.geral) erroFatal('Nada para ajustar: marque ao menos uma cena com "mudar" (dizendo o que mudar) ou escreva um comentário geral.');
      Object.assign(aberta, { decisao: 'ajustes', decidido_em: agora(), via: F.via || 'chat', pedidos: d.pedidos, ok: d.ok, geral: d.geral, respostas: [] });
      RU.gravarRodada(pasta, aberta);
      try { fs.rmSync(RU.arquivoRascunho(pasta, aberta.rodada), { force: true }); } catch {}
      const est = carregarEstado(id);
      const st = est.estagios.revisao_usuario || (est.estagios.revisao_usuario = {});
      Object.assign(st, {
        status: 'em_andamento', aguardando_usuario: false, aguardando_claude: true,
        instrucoes: `O usuário pediu ${d.pedidos.length} ajuste(s) na rodada ${aberta.rodada}${d.geral ? ' e deixou um comentário geral' : ''}. Siga modulos/revisao-usuario/MODULO.md: \`node motor/rs.mjs cenas ${id}\` mostra tudo cena a cena.`,
      });
      est.status = 'em_andamento';
      salvarEstado(est);
      log(id, 'revisao', `Sua revisão: ${d.pedidos.length} ajuste(s) pedidos na rodada ${aberta.rodada}${d.geral ? ` · geral: "${d.geral}"` : ''}`, { via: F.via || 'chat' });
      let pedido = null;
      if (F.pedir) pedido = criarPedido('cenas', id, { rodada: aberta.rodada, ajustes: d.pedidos.length, geral: Boolean(d.geral), cenas: d.pedidos.map((p) => p.fala) });
      return saida({ ok: true, rodada: aberta.rodada, ajustes: d.pedidos.length, pedido: pedido?.id || null });
    }
    if (F.responder) {
      registrarAtividade(id, 'cenas', { estagio: 'revisao_usuario' });
      const alvo = F.rodada ? RU.listarRodadas(pasta).find((r) => r.rodada === Number(F.rodada)) : RU.ultimaComAjustes(pasta);
      if (!alvo || alvo.decisao !== 'ajustes') erroFatal('Nenhuma rodada com ajustes pedidos para responder.');
      if (!F.arquivo) erroFatal('Use --arquivo <json> com [{ "fala": "f04", "acao": "feito|parcial|nao_feito", "como": "..." }].');
      const bruto = lerJSON(F.arquivo, null);
      const lista = Array.isArray(bruto) ? bruto : bruto?.respostas;
      if (!Array.isArray(lista)) erroFatal('O arquivo precisa ser uma lista de respostas (ou { "respostas": [...] }).');
      const validas = lista.filter((r) => r && r.fala).map((r) => ({ fala: String(r.fala), acao: ['feito', 'parcial', 'nao_feito'].includes(r.acao) ? r.acao : 'feito', como: String(r.como || '').slice(0, 1500) }));
      const faltam = (alvo.pedidos || []).map((p) => p.fala).filter((f) => !validas.some((r) => r.fala === f));
      alvo.respostas = validas; alvo.respondido_em = agora();
      RU.gravarRodada(pasta, alvo);
      log(id, 'revisao', `Respostas à sua revisão (rodada ${alvo.rodada}): ${validas.length}`);
      return saida({ ok: true, rodada: alvo.rodada, respostas: validas.length, sem_resposta: faltam });
    }
    // padrão: o que o usuário pediu (para o Claude)
    const rods = RU.listarRodadas(pasta);
    const aberta = RU.rodadaAberta(pasta);
    saida({
      video: id,
      rodadas: rods.map((r) => ({ rodada: r.rodada, decisao: r.decisao || null, decidido_em: r.decidido_em || null, ajustes: (r.pedidos || []).length, respondido: Boolean(r.respondido_em) })),
      aberta: aberta ? { rodada: aberta.rodada, link: `http://127.0.0.1:4777/#/v/${id}/revisar` } : null,
      ajustes: RU.resumoParaClaude(RU.ultimaComAjustes(pasta)),
      tipos: Object.fromEntries(Object.entries(RU.TIPOS).map(([k, v]) => [k, `${v.rotulo}: ${v.dica}`])),
    });
  },

  async refazer() {
    const id = exigirId();
    const estagio = F._[1];
    registrarAtividade(id, 'refazer', { estagio });
    const est = carregarEstado(id);
    reabrirDesde(est, estagio);
    salvarEstado(est);
    log(id, 'estagio', `Reaberto a partir de ${estagio}`);
    saida({ ok: true, proximo: proximo(carregarEstado(id))?.id });
  },

  async config() {
    const id = exigirId();
    const est = carregarEstado(id);
    est.config ||= {};
    const sets = [].concat(F.set || []);
    for (const s of argv.filter((a, i) => argv[i - 1] === '--set')) sets.push(s);
    for (const s of new Set(sets)) {
      if (typeof s !== 'string') continue;
      const [k, ...v] = s.split('=');
      let val = v.join('=');
      try { val = JSON.parse(val); } catch {}
      est.config[k] = val;
    }
    salvarEstado(est);
    log(id, 'config', `Config alterada: ${[...new Set(sets)].join(', ')}`);
    saida({ ok: true, config: est.config });
  },

  async fila() {
    if (F.pegar) return saida(atualizarPedido(F.pegar, { status: 'em_andamento', sessao: process.env.CLAUDE_CODE_SESSION_ID || null }));
    if (F.concluir) return saida(atualizarPedido(F.concluir, { status: 'concluido', resultado: F.resultado || null }));
    if (F.erro) return saida(atualizarPedido(F.erro, { status: 'erro', resultado: F.msg || null }));
    if (F.aguardar) {
      const limite = Date.now() + (Number(F['timeout-min']) || 600) * 60000;
      while (Date.now() < limite) {
        batimento({ esperando: 'fila' });
        const pend = listarPedidos({ status: 'pendente' });
        if (pend.length) return saida({ evento: 'pedido', pedidos: comDica(pend) });
        await dormir(2000);
      }
      return saida({ evento: 'timeout' });
    }
    saida({ pendentes: comDica(listarPedidos({ status: 'pendente' })), em_andamento: comDica(listarPedidos({ status: 'em_andamento' })), operador: lerOperador() });
  },

  async pedir() {
    const acao = F._[0];
    if (!ACOES[acao]) erroFatal(`Ação inválida. Opções: ${Object.keys(ACOES).join(', ')}`);
    const video = F._[1] || null;
    const payload = F.json ? JSON.parse(F.json) : {};
    saida(criarPedido(acao, video, payload));
  },

  // O Claude anuncia o que está fazendo num estágio dele (o painel mostra ao vivo, com o tempo).
  async passo() {
    const id = exigirId();
    const texto = F._.slice(1).join(' ').trim();
    if (!texto) erroFatal('Uso: rs passo <id> "pesquisando fontes"');
    const est = carregarEstado(id);
    gravarJSON(path.join(pastaVideo(id), 'passo.json'), { texto, estagio: est.estagio, ts: agora(), sessao: process.env.CLAUDE_CODE_SESSION_ID || null });
    log(id, 'passo', texto, { estagio: est.estagio });
    registrarAtividade(id, 'passo', { estagio: est.estagio });
    saida({ ok: true });
  },

  async tokens() {
    const id = F._[0] || null;
    const r = calcularTokens({ apenas: id });
    if (id) return saida(r[id] || { aviso: 'Nenhum token atribuído ainda a este vídeo.' });
    saida(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.total])));
  },

  async vozes() {
    const mod = await import(pathToFileURL(path.join(P.modulos, 'voz', 'vozes.mjs')).href);
    const r = await mod.listarVozes({ atualizar: Boolean(F.atualizar) });
    saida(r);
  },

  async estilos() {
    const mod = await import(pathToFileURL(path.join(P.modulos, 'montagem', 'estilos.mjs')).href);
    const lista = mod.listarEstilos();
    if (F.json) return saida(lista);
    for (const e of lista) saida(`${e.id.padEnd(28)} ${e.nome}${e.grupo ? `  [${e.grupo}]` : ''}`);
  },

  async painel() {
    const info = lerJSON(path.join(P.dados, 'painel.json'), null);
    const porta = Number(F.porta) || info?.porta || 4777;
    const url = `http://127.0.0.1:${porta}`;
    const vivo = async () => { try { const r = await fetch(`${url}/api/saude`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
    if (F.parar) {
      if (info?.pid) { try { process.kill(info.pid); } catch {} }
      return saida({ ok: true, parado: true });
    }
    if (await vivo()) return saida({ ok: true, url, ja_estava_rodando: true });
    const filho = spawn(process.execPath, [path.join(RAIZ, 'painel', 'servidor.mjs'), '--porta', String(porta)], { detached: true, stdio: 'ignore', windowsHide: true, cwd: RAIZ });
    filho.unref();
    for (let i = 0; i < 20; i++) { await dormir(300); if (await vivo()) return saida({ ok: true, url, pid: filho.pid }); }
    erroFatal(`O painel não respondeu em ${url}. Rode \`node painel/servidor.mjs\` para ver o erro.`);
  },

  async quadros() {
    const id = exigirId();
    registrarAtividade(id, 'quadros', { estagio: carregarEstado(id).estagio });
    const qa = await import(pathToFileURL(path.join(P.modulos, 'qa', 'run.mjs')).href);
    const linha = lerJSON(path.join(pastaVideo(id), 'linha.json'));
    const tempos = F.at ? String(F.at).split(',').map(Number).filter(Number.isFinite) : qa.temposDasFalas(linha);
    const r = qa.quadros(pastaVideo(id), tempos, { nome: F.nome || 'rascunho' });
    saida({ ok: r.ok, folha: r.folha, pasta: r.dir, tempos, erro: r.erro });
  },

  async log() {
    const id = exigirId();
    const msg = F._.slice(1).join(' ');
    log(id, 'nota', msg);
    registrarAtividade(id, 'log', { estagio: carregarEstado(id).estagio });
    saida({ ok: true });
  },
};

if (!cmd || !comandos[cmd]) {
  if (cmd && cmd !== 'ajuda' && cmd !== '--help') process.stderr.write(`Comando desconhecido: ${cmd}\n\n`);
  await comandos.ajuda();
  process.exitCode = cmd && cmd !== 'ajuda' && cmd !== '--help' ? 2 : 0;
} else {
  try { await comandos[cmd](); }
  catch (e) { erroFatal(e.message); }
}
