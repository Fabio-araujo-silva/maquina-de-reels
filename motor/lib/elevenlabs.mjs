// Cliente mínimo da API da ElevenLabs (fetch nativo, sem dependências).
// Usado pelos módulos de voz, trilha (música e efeitos) e pelo painel (saldo e vozes).
// A chave vem de ELEVENLABS_API_KEY no .env da skill e nunca é impressa nem gravada em log.
import { carregarEnv, dormir } from './util.mjs';

const BASE = 'https://api.elevenlabs.io';

export function chave() {
  carregarEnv();
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error('ELEVENLABS_API_KEY não configurada. Coloque a chave no arquivo .env da skill.');
  return k.trim();
}
export function temChaveEleven() { carregarEnv(); return Boolean(process.env.ELEVENLABS_API_KEY); }

function cabecalhosUteis(h) {
  const out = {};
  for (const [k, v] of h.entries()) {
    if (/^(request-id|x-request-id|history-item-id|song-id|x-character-count|character-cost|x-ratelimit|current-concurrent-requests|maximum-concurrent-requests)/i.test(k)) out[k] = v;
  }
  return out;
}

async function chamar(metodo, rota, { json = null, query = null, binario = false, tentativas = 4, timeoutMs = 180000 } = {}) {
  const url = new URL(rota, BASE);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let ultimoErro = null;
  for (let t = 0; t < tentativas; t++) {
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'xi-api-key': chave(), ...(json ? { 'Content-Type': 'application/json' } : {}), Accept: binario ? 'audio/mpeg' : 'application/json' },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const meta = { status: r.status, cabecalhos: cabecalhosUteis(r.headers) };
      if (r.ok) {
        if (binario) return { dados: Buffer.from(await r.arrayBuffer()), meta };
        return { dados: await r.json(), meta };
      }
      const corpo = await r.text();
      let detalhe = corpo;
      try { const j = JSON.parse(corpo); detalhe = j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j); } catch {}
      const erro = new Error(`ElevenLabs ${metodo} ${url.pathname} → HTTP ${r.status}: ${String(detalhe).slice(0, 400)}`);
      erro.status = r.status; erro.corpo = corpo;
      if (r.status === 429 || r.status >= 500) { ultimoErro = erro; await dormir(1500 * 2 ** t); continue; }
      throw erro;
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      ultimoErro = e;
      await dormir(1500 * 2 ** t);
    }
  }
  throw ultimoErro || new Error('Falha desconhecida na ElevenLabs');
}

// Texto → fala com tempo de cada caractere.
export async function falarComTempos({ voiceId, texto, modelo = 'eleven_multilingual_v2', ajustes = {}, anterior = null, proximo = null, idioma = 'pt', seed = null }) {
  const corpo = { text: texto, model_id: modelo };
  const vs = {};
  for (const k of ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed']) if (ajustes[k] !== undefined) vs[k] = ajustes[k];
  if (modelo === 'eleven_v3' && vs.stability !== undefined) vs.stability = [0, 0.5, 1].reduce((a, b) => (Math.abs(b - vs.stability) < Math.abs(a - vs.stability) ? b : a));
  if (Object.keys(vs).length) corpo.voice_settings = vs;
  if (anterior) corpo.previous_text = anterior;
  if (proximo) corpo.next_text = proximo;
  if (seed != null) corpo.seed = seed;
  if (!/multilingual_v2/.test(modelo) && idioma) corpo.language_code = idioma;
  try {
    return await chamar('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, { json: corpo, query: { output_format: 'mp3_44100_128' } });
  } catch (e) {
    // alguns modelos recusam campos (speed/style/language_code): tenta de novo só com o essencial
    if (e.status === 422 || e.status === 400) {
      const enxuto = { text: texto, model_id: modelo };
      if (vs.stability !== undefined) enxuto.voice_settings = { stability: vs.stability, similarity_boost: vs.similarity_boost ?? 0.75 };
      if (anterior) enxuto.previous_text = anterior;
      if (proximo) enxuto.next_text = proximo;
      return chamar('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, { json: enxuto, query: { output_format: 'mp3_44100_128' } });
    }
    throw e;
  }
}

export async function gerarMusica({ prompt, duracaoMs, modelo = 'music_v1', instrumental = true }) {
  const json = { prompt, music_length_ms: Math.max(3000, Math.min(600000, Math.round(duracaoMs))), model_id: modelo, force_instrumental: instrumental };
  return chamar('POST', '/v1/music', { json, binario: true, query: { output_format: 'mp3_44100_128' }, timeoutMs: 600000, tentativas: 3 });
}

export async function gerarEfeito({ texto, duracao = null, influencia = 0.45, loop = false, modelo = null }) {
  const json = { text: texto, prompt_influence: influencia, loop };
  if (duracao) json.duration_seconds = Math.max(0.5, Math.min(30, duracao));
  if (modelo) json.model_id = modelo;
  return chamar('POST', '/v1/sound-generation', { json, binario: true, query: { output_format: 'mp3_44100_128' } });
}

export async function minhasVozes() {
  const out = []; let token = null;
  for (let i = 0; i < 10; i++) {
    const { dados } = await chamar('GET', '/v2/voices', { query: { page_size: 100, next_page_token: token } });
    out.push(...(dados.voices || []));
    if (!dados.has_more || !dados.next_page_token) break;
    token = dados.next_page_token;
  }
  return out;
}

export async function vozesDaBiblioteca({ idioma = 'pt', sotaque = null, genero = null, tamanho = 40, ordenar = 'usage_character_count_1y' } = {}) {
  const { dados } = await chamar('GET', '/v1/shared-voices', { query: { language: idioma, accent: sotaque, gender: genero, page_size: tamanho, sort: ordenar } });
  return dados.voices || [];
}

export async function adicionarVozDaBiblioteca(publicOwnerId, voiceId, nome) {
  const { dados } = await chamar('POST', `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, { json: { new_name: nome } });
  return dados.voice_id;
}

// Voice Design: cria prévias de uma voz NOVA a partir de uma descrição (ex.: narrador brasileiro).
// Devolve { previews: [{ audio_base_64, generated_voice_id, duration_secs, language }], text } e os cabeçalhos.
export async function desenharVoz({ descricao, texto = null, modelo = 'eleven_multilingual_ttv_v2', guidance = 5, loudness = 0.5, seed = null, gerarTexto = false }) {
  const json = { voice_description: descricao, model_id: modelo, guidance_scale: guidance, loudness, auto_generate_text: gerarTexto };
  if (texto) json.text = texto;
  if (seed != null) json.seed = seed;
  return chamar('POST', '/v1/text-to-voice/design', { json, query: { output_format: 'mp3_44100_128' }, timeoutMs: 300000, tentativas: 2 });
}

// Salva uma prévia escolhida como voz da conta. Devolve o voice_id (usável direto na TTS).
export async function criarVozDesenhada({ nome, descricao, generatedVoiceId, rotulos = null, naoEscolhidas = null }) {
  const json = { voice_name: nome, voice_description: descricao, generated_voice_id: generatedVoiceId };
  if (rotulos) json.labels = rotulos;
  if (naoEscolhidas?.length) json.played_not_selected_voice_ids = naoEscolhidas;
  const { dados } = await chamar('POST', '/v1/text-to-voice', { json, timeoutMs: 120000, tentativas: 2 });
  return dados.voice_id;
}

export async function assinatura() {
  const { dados } = await chamar('GET', '/v1/user/subscription', { tentativas: 2, timeoutMs: 15000 });
  return {
    plano: dados.tier, caracteres_usados: dados.character_count, limite: dados.character_limit,
    renova_em: dados.next_character_count_reset_unix ? new Date(dados.next_character_count_reset_unix * 1000).toISOString() : null,
    status: dados.status,
  };
}
