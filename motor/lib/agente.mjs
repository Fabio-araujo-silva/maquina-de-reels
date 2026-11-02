// Agente por API: faz as etapas que, no modo padrão, o Claude Code faz (roteiro, storyboard, mundo 3D,
// checagem, revisor, ajustes). Dois provedores:
//   - anthropic: Claude pela API (SDK oficial @anthropic-ai/sdk), com busca na web do próprio servidor.
//   - openai: qualquer API compatível com OpenAI Chat Completions (OpenAI, OpenRouter, Groq, Ollama, LM Studio…).
// O agente só enxerga a pasta da skill: lê/escreve arquivos dentro dela e roda `node motor/rs.mjs …`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RAIZ, lerJSON, gravarJSON, carregarEnv } from './util.mjs';

export const ARQ_EXECUTOR = path.join(RAIZ, 'config', 'executor.json');
export const PADRAO_EXECUTOR = {
  modo: 'claude-code', // 'claude-code' | 'anthropic' | 'openai'
  anthropic: { modelo: 'claude-opus-5-5', esforco: 'high', busca_web: true },
  openai: { base_url: 'https://api.openai.com/v1', modelo: 'gpt-5', busca_web: false, visao: true },
  max_passos: 80, // chamadas de ferramenta por etapa (trava de custo)
};
export function lerExecutor() {
  const c = lerJSON(ARQ_EXECUTOR, {});
  return { ...PADRAO_EXECUTOR, ...c, anthropic: { ...PADRAO_EXECUTOR.anthropic, ...(c.anthropic || {}) }, openai: { ...PADRAO_EXECUTOR.openai, ...(c.openai || {}) } };
}
export function salvarExecutor(novo) { const c = { ...lerExecutor(), ...novo }; gravarJSON(ARQ_EXECUTOR, c); return c; }

// ---------------- ferramentas (as mesmas para os dois provedores) ----------------
const BLOQ = [/^\.env/, /^node_modules\//, /^\.venv\//, /^\.git\//];
function dentroDaRaiz(rel) {
  const alvo = path.resolve(RAIZ, String(rel || ''));
  const r = path.relative(RAIZ, alvo);
  if (r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)) throw new Error('caminho fora da pasta do projeto');
  const norm = r.split(path.sep).join('/');
  if (BLOQ.some((b) => b.test(norm))) throw new Error('caminho protegido');
  return alvo;
}
const RS_PROIBIDO = new Set(['painel', 'agente', 'aguardar', 'aprovar']); // aprovar é decisão do usuário

export const FERRAMENTAS = [
  { name: 'ler_arquivo', description: 'Lê um arquivo de texto da pasta do projeto (caminho relativo à raiz). Use inicio/linhas para arquivos grandes.',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' }, inicio: { type: 'integer' }, linhas: { type: 'integer' } }, required: ['caminho'] } },
  { name: 'escrever_arquivo', description: 'Cria ou substitui um arquivo de texto (caminho relativo à raiz).',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' }, conteudo: { type: 'string' } }, required: ['caminho', 'conteudo'] } },
  { name: 'editar_arquivo', description: 'Troca um trecho exato (que aparece uma vez só) por outro.',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' }, antigo: { type: 'string' }, novo: { type: 'string' } }, required: ['caminho', 'antigo', 'novo'] } },
  { name: 'listar', description: 'Lista arquivos e pastas de um diretório do projeto.',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } },
  { name: 'rs', description: 'Roda o motor: `node motor/rs.mjs <args…>` (ex.: ["roteiro","<id>","--validar"], ["quadros","<id>"], ["concluir","<id>","storyboard"]). Devolve a saída.',
    input_schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'] } },
  { name: 'ver_imagem', description: 'Abre uma imagem .jpg/.png do projeto (ex.: videos/<id>/quadros/folha.jpg) para você olhar.',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } },
  { name: 'buscar_url', description: 'Baixa uma página da web e devolve o texto (para conferir fatos e fontes).',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
];

function rodarRs(args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(RAIZ, 'motor', 'rs.mjs'), ...args], { cwd: RAIZ });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (codigo) => { clearTimeout(t); ok({ codigo, out, err }); });
  });
}
export { rodarRs };

const corta = (s, n = 30000) => (s.length > n ? s.slice(0, n) + `\n…[cortado: ${s.length - n} caracteres a mais]` : s);

async function executar(nome, e) {
  for (const k of (FERRAMENTAS.find((f) => f.name === nome)?.input_schema.required || [])) if (e?.[k] === undefined) throw new Error(`faltou o campo "${k}"`);
  switch (nome) {
    case 'ler_arquivo': {
      const txt = fs.readFileSync(dentroDaRaiz(e.caminho), 'utf8');
      if (!e.inicio && !e.linhas) return corta(txt);
      const l = txt.split('\n'); const i = Math.max(0, (e.inicio || 1) - 1);
      return l.slice(i, i + (e.linhas || 400)).join('\n');
    }
    case 'escrever_arquivo': { const a = dentroDaRaiz(e.caminho); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, e.conteudo, 'utf8'); return `ok (${e.conteudo.length} caracteres)`; }
    case 'editar_arquivo': {
      const a = dentroDaRaiz(e.caminho); const txt = fs.readFileSync(a, 'utf8');
      const n = txt.split(e.antigo).length - 1;
      if (n !== 1) throw new Error(n ? `o trecho aparece ${n} vezes; mande mais contexto` : 'trecho não encontrado');
      fs.writeFileSync(a, txt.replace(e.antigo, () => e.novo), 'utf8'); return 'ok';
    }
    case 'listar': return fs.readdirSync(dentroDaRaiz(e.caminho || '.'), { withFileTypes: true }).map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n');
    case 'rs': {
      if (!Array.isArray(e.args) || !e.args.length) throw new Error('args vazio');
      if (RS_PROIBIDO.has(e.args[0])) throw new Error(`o comando "${e.args[0]}" é do orquestrador, não do agente`);
      const r = await rodarRs(e.args.map(String));
      return corta(`código ${r.codigo}\n${r.out}${r.err ? `\n[stderr]\n${r.err}` : ''}`, 20000);
    }
    case 'ver_imagem': {
      const a = dentroDaRaiz(e.caminho);
      const ext = path.extname(a).toLowerCase();
      const tipo = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { imagem: fs.readFileSync(a).toString('base64'), tipo };
    }
    case 'buscar_url': {
      if (!/^https?:\/\//.test(e.url)) throw new Error('url inválida');
      const r = await fetch(e.url, { headers: { 'user-agent': 'maquina-de-reels/1.0' }, signal: AbortSignal.timeout(30000) });
      const h = await r.text();
      return corta(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 15000);
    }
    default: throw new Error(`ferramenta desconhecida: ${nome}`);
  }
}

// ---------------- prompt de sistema (estável, para cache) ----------------
function sistema() {
  const skill = fs.readFileSync(path.join(RAIZ, 'SKILL.md'), 'utf8');
  return `Você é o operador da Máquina de Reels rodando por API (sem Claude Code e sem chat com o usuário).
Raiz do projeto: a pasta onde está o SKILL.md. Todos os caminhos são relativos a ela. Você age só por ferramentas.
Regras deste modo:
- Não existe chat: o usuário fala com você pelo painel (menu, aprovação do roteiro, revisão cena a cena, pedidos da fila). Nunca aprove nada por ele.
- Quando o SKILL.md mandar perguntar algo ao usuário ou rodar \`aguardar\`, PARE e termine o turno com um resumo curto: o orquestrador espera o painel.
- Quando o SKILL.md mandar disparar um subagente revisor, use apenas o seu próprio julgamento seguindo modulos/revisor/REVISOR.md com o pacote da rodada e grave o parecer no arquivo indicado (o orquestrador já isola o revisor numa conversa separada quando possível).
- Cada etapa termina com o comando de conclusão que o motor indicar (\`rs concluir …\`, \`rs roteiro … --publicar\` etc.). Termine o turno logo depois.
- Economize: leia só os trechos de arquivo de que precisa; prefira editar a reescrever arquivos inteiros.

===== SKILL.md (manual completo do fluxo) =====
${skill}`;
}

// ---------------- provedor Anthropic (SDK oficial) ----------------
async function rodarAnthropic(tarefa, cfg, aoEvento) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
  const a = cfg.anthropic;
  const tools = FERRAMENTAS.filter((f) => !(a.busca_web && f.name === 'buscar_url')).map((f) => ({ ...f, eager_input_streaming: true }));
  if (a.busca_web) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 8 });
  const system = [{ type: 'text', text: sistema(), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: tarefa }];
  const uso = { entrada: 0, saida: 0, cache_lido: 0, cache_escrito: 0, chamadas: 0 };
  let passos = 0, falhasJson = 0;
  while (true) {
    const stream = client.messages.stream({
      model: a.modelo, max_tokens: 64000, system, tools, messages,
      thinking: { type: 'adaptive' }, output_config: { effort: a.esforco || 'high' },
      cache_control: { type: 'ephemeral' },
    });
    let msg;
    try { msg = await stream.finalMessage(); falhasJson = 0; }
    catch (err) { if (err instanceof Anthropic.APIError || falhasJson++ >= 2) throw err; continue; }
    uso.chamadas++; uso.entrada += msg.usage.input_tokens || 0; uso.saida += msg.usage.output_tokens || 0;
    uso.cache_lido += msg.usage.cache_read_input_tokens || 0; uso.cache_escrito += msg.usage.cache_creation_input_tokens || 0;
    const texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (texto) aoEvento?.({ tipo: 'texto', texto });
    if (msg.stop_reason === 'refusal') throw new Error('o modelo recusou a tarefa');
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    const usos = msg.content.filter((b) => b.type === 'tool_use');
    if (!usos.length) return { texto, uso };
    if (msg.stop_reason === 'max_tokens') throw new Error('resposta cortada em max_tokens no meio de uma ferramenta');
    messages.push({ role: 'assistant', content: msg.content });
    const resultados = [];
    for (const u of usos) {
      if (++passos > cfg.max_passos) throw new Error(`limite de ${cfg.max_passos} passos atingido (config/executor.json → max_passos)`);
      aoEvento?.({ tipo: 'ferramenta', nome: u.name, entrada: u.input });
      try {
        const r = await executar(u.name, u.input);
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: r?.imagem ? [{ type: 'image', source: { type: 'base64', media_type: r.tipo, data: r.imagem } }] : String(r) });
      } catch (err) { resultados.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: String(err.message || err) }); }
    }
    messages.push({ role: 'user', content: resultados });
  }
}

// ---------------- provedor compatível com OpenAI (fetch) ----------------
async function rodarOpenAI(tarefa, cfg, aoEvento) {
  const o = cfg.openai;
  const chave = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
  const url = o.base_url.replace(/\/+$/, '') + '/chat/completions';
  const tools = FERRAMENTAS.map((f) => ({ type: 'function', function: { name: f.name, description: f.description, parameters: f.input_schema } }));
  const messages = [{ role: 'system', content: sistema() }, { role: 'user', content: tarefa }];
  const uso = { entrada: 0, saida: 0, cache_lido: 0, cache_escrito: 0, chamadas: 0 };
  let passos = 0;
  while (true) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify({ model: o.modelo, messages, tools, tool_choice: 'auto' }), signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 500)}`);
    const j = await r.json();
    uso.chamadas++; uso.entrada += j.usage?.prompt_tokens || 0; uso.saida += j.usage?.completion_tokens || 0;
    uso.cache_lido += j.usage?.prompt_tokens_details?.cached_tokens || 0;
    const m = j.choices?.[0]?.message;
    if (!m) throw new Error('resposta sem mensagem');
    if (m.content) aoEvento?.({ tipo: 'texto', texto: m.content });
    const chamadas = m.tool_calls || [];
    if (!chamadas.length) return { texto: m.content || '', uso };
    messages.push({ role: 'assistant', content: m.content || null, tool_calls: chamadas });
    const imagens = [];
    for (const c of chamadas) {
      if (++passos > cfg.max_passos) throw new Error(`limite de ${cfg.max_passos} passos atingido`);
      let entrada; try { entrada = JSON.parse(c.function.arguments || '{}'); } catch { messages.push({ role: 'tool', tool_call_id: c.id, content: 'erro: argumentos não são JSON válido' }); continue; }
      aoEvento?.({ tipo: 'ferramenta', nome: c.function.name, entrada });
      try {
        const res = await executar(c.function.name, entrada);
        if (res?.imagem) {
          messages.push({ role: 'tool', tool_call_id: c.id, content: o.visao ? 'imagem anexada na próxima mensagem' : 'este modelo está configurado sem visão; descreva o que esperava ver e siga pelos números do qa.json' });
          if (o.visao) imagens.push({ type: 'image_url', image_url: { url: `data:${res.tipo};base64,${res.imagem}` } });
        } else messages.push({ role: 'tool', tool_call_id: c.id, content: String(res) });
      } catch (err) { messages.push({ role: 'tool', tool_call_id: c.id, content: `erro: ${err.message || err}` }); }
    }
    if (imagens.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Imagens pedidas:' }, ...imagens] });
  }
}

export async function rodarAgente(tarefa, { aoEvento } = {}) {
  carregarEnv();
  const cfg = lerExecutor();
  if (cfg.modo === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY no .env (Configurações → Modelo).');
    return rodarAnthropic(tarefa, cfg, aoEvento);
  }
  if (cfg.modo === 'openai') return rodarOpenAI(tarefa, cfg, aoEvento);
  throw new Error('O modo do executor é "claude-code": abra o Claude Code na pasta e use a skill, ou mude o modo em Configurações → Modelo.');
}
