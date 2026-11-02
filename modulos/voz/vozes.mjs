// Catálogo de vozes.
//   config/vozes.json          base gerada pelo motor ("rs vozes --atualizar"): suas vozes da ElevenLabs + as mais
//                              usadas em pt-BR da biblioteca, ou as vozes padrão verificadas quando a chave não pode listar.
//   config/vozes_usuario.json  o que VOCÊ define no painel: vozes adicionadas por voice_id, favoritas (até 4, viram
//                              opções do menu) e as vozes automáticas masculina/feminina. Nunca é sobrescrito pelo motor.
// catalogoFinal() junta os dois; menu, painel e o estágio de voz leem daqui.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, lerJSON, gravarJSON, existe, agora, garantirPasta, anexarLinha } from '../../motor/lib/util.mjs';
import { temChaveEleven, minhasVozes, vozesDaBiblioteca, adicionarVozDaBiblioteca, falarComTempos } from '../../motor/lib/elevenlabs.mjs';

const ARQ = path.join(P.config, 'vozes.json');
const ARQ_USUARIO = path.join(P.config, 'vozes_usuario.json');
export const KOKORO = [
  { voice_id: 'pm_alex', nome: 'Alex (Kokoro)', genero: 'male', provedor: 'kokoro', descricao: 'offline, grátis' },
  { voice_id: 'pf_dora', nome: 'Dora (Kokoro)', genero: 'female', provedor: 'kokoro', descricao: 'offline, grátis' },
  { voice_id: 'pm_santa', nome: 'Santa (Kokoro)', genero: 'male', provedor: 'kokoro', descricao: 'offline, grátis' },
];

// Vozes padrão da ElevenLabs verificadas com a conta do usuário (31/10/2026). Usadas quando a chave
// não tem a permissão voices_read (não dá para listar a conta nem a biblioteca).
// Falam português pelo modelo multilingual; para sotaque nativo brasileiro, adicione uma voz pt-BR da
// Voice Library à sua conta no site e cadastre o voice_id dela no painel (Configurações → Voz).
export const PADRAO_ELEVEN = [
  { voice_id: 'nPczCjzI2devNBz1zQrb', nome: 'Brian', genero: 'male', descricao: 'grave, narrador (testada em pt-BR)' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', nome: 'Sarah', genero: 'female', descricao: 'suave, calorosa' },
  { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', nome: 'Liam', genero: 'male', descricao: 'jovem, energética' },
  { voice_id: 'cgSgspJ2msm6clMCkdW9', nome: 'Jessica', genero: 'female', descricao: 'expressiva, jovem' },
  { voice_id: 'cjVigY5qzO86Huf0OWal', nome: 'Eric', genero: 'male', descricao: 'clara, conversacional' },
  { voice_id: 'FGY2WhTYpPnrIDTdsKH5', nome: 'Laura', genero: 'female', descricao: 'animada, direta' },
].map((v) => ({ ...v, sotaque: 'padrão ElevenLabs', provedor: 'elevenlabs', minha: true, origem: 'padrão' }));

function catalogoCurado(motivo) {
  return {
    atualizado_em: agora(), sem_permissao: ['voices_read'], motivo,
    minhas: PADRAO_ELEVEN, biblioteca: [], kokoro: KOKORO,
    favoritas: [PADRAO_ELEVEN[0], PADRAO_ELEVEN[1], PADRAO_ELEVEN[2], PADRAO_ELEVEN[3]],
    auto: { masculina: PADRAO_ELEVEN[0], feminina: PADRAO_ELEVEN[1] },
  };
}

const ehBR = (v) => {
  const txt = [v.accent, v.locale, v.language, v.labels?.accent, v.labels?.language, ...(v.verified_languages || []).map((l) => `${l.language} ${l.accent} ${l.locale}`)].filter(Boolean).join(' ').toLowerCase();
  return /pt-br|brazil|brasil/.test(txt) || (/\bpt\b|portuguese|portugu/.test(txt) && !/pt-pt|portugal|european/.test(txt));
};
const genero = (v) => String(v.gender || v.labels?.gender || '').toLowerCase();

function resumoMinha(v) {
  return {
    voice_id: v.voice_id, nome: v.name, categoria: v.category, genero: genero(v),
    sotaque: v.labels?.accent || null, descricao: v.description || v.labels?.description || null,
    idiomas: (v.verified_languages || []).map((l) => l.locale || l.language), preview_url: v.preview_url || null, provedor: 'elevenlabs', minha: true, origem: 'sua conta',
  };
}
function resumoBib(v) {
  return {
    voice_id: v.voice_id, public_owner_id: v.public_owner_id, nome: v.name, genero: genero(v), idade: v.age,
    sotaque: v.accent, descricao: v.description || v.descriptive || null, uso: v.use_case, idioma: v.language, locale: v.locale,
    preview_url: v.preview_url || null, uso_1y: v.usage_character_count_1y || 0, adicionada: Boolean(v.is_added_by_user), provedor: 'elevenlabs', minha: false, origem: 'biblioteca',
  };
}

// ---------------- preferências do usuário ----------------
export function lerUsuario() { return lerJSON(ARQ_USUARIO, { personalizadas: [], favoritas: null, auto: null }); }
function gravarUsuario(u) { u.atualizado_em = agora(); gravarJSON(ARQ_USUARIO, u); return u; }

export function adicionarPersonalizada({ voice_id, nome, genero: g = '', descricao = '' }) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(voice_id || ''))) throw new Error('voice_id inválido (copie o ID da voz no site da ElevenLabs).');
  const u = lerUsuario();
  u.personalizadas = (u.personalizadas || []).filter((v) => v.voice_id !== voice_id);
  u.personalizadas.push({ voice_id, nome: String(nome || voice_id).slice(0, 40), genero: g, descricao: String(descricao || '').slice(0, 160), adicionada_em: agora() });
  return gravarUsuario(u);
}
export function removerPersonalizada(voice_id) {
  const u = lerUsuario();
  u.personalizadas = (u.personalizadas || []).filter((v) => v.voice_id !== voice_id);
  if (u.favoritas) u.favoritas = u.favoritas.filter((id) => id !== voice_id);
  if (u.auto) for (const k of ['masculina', 'feminina']) if (u.auto[k] === voice_id) delete u.auto[k];
  return gravarUsuario(u);
}
export function salvarPreferencias({ favoritas = null, auto = null }) {
  const u = lerUsuario();
  if (Array.isArray(favoritas)) u.favoritas = favoritas.slice(0, 4);
  if (auto) u.auto = { ...(u.auto || {}), ...auto };
  return gravarUsuario(u);
}

// Junta a base (motor) com as escolhas do usuário (painel).
export function catalogoFinal() {
  let base = existe(ARQ) ? lerJSON(ARQ, null) : null;
  if (!base || base.sem_chave) base = temChaveEleven() ? catalogoCurado('Catálogo ainda não atualizado.') : { sem_chave: true, minhas: [], biblioteca: [], favoritas: [], auto: {} };
  const u = lerUsuario();
  const pers = (u.personalizadas || []).map((v) => ({ ...v, provedor: 'elevenlabs', minha: true, personalizada: true, origem: 'adicionada por você' }));
  const vistos = new Set(pers.map((v) => v.voice_id));
  const todas = [...pers, ...(base.minhas || []).filter((v) => !vistos.has(v.voice_id)), ...(base.biblioteca || []).filter((v) => !vistos.has(v.voice_id))];
  const porId = (id) => todas.find((v) => v.voice_id === id) || null;
  const favoritas = (Array.isArray(u.favoritas) && u.favoritas.length ? u.favoritas.map(porId).filter(Boolean) : (base.favoritas || [])).slice(0, 4);
  const auto = {
    masculina: porId(u.auto?.masculina) || base.auto?.masculina || null,
    feminina: porId(u.auto?.feminina) || base.auto?.feminina || null,
  };
  return { ...base, todas, personalizadas: pers, favoritas, auto, kokoro: KOKORO };
}

export async function listarVozes({ atualizar = false } = {}) {
  if (!atualizar) return catalogoFinal();
  if (!temChaveEleven()) return catalogoFinal();
  let minhas;
  try { minhas = (await minhasVozes()).map(resumoMinha); }
  catch (e) {
    if (e.status === 401 && /voices_read/.test(e.message)) {
      gravarJSON(ARQ, catalogoCurado('A chave não tem a permissão voices_read: usando vozes padrão verificadas.'));
      return catalogoFinal();
    }
    throw e;
  }
  let bib = [];
  try {
    const brutas = [
      ...(await vozesDaBiblioteca({ idioma: 'pt', sotaque: 'brazilian', tamanho: 60 })),
      ...(await vozesDaBiblioteca({ idioma: 'pt', tamanho: 60 })),
    ];
    const vistos = new Set();
    bib = brutas.filter((v) => ehBR(v) && !vistos.has(v.voice_id) && vistos.add(v.voice_id)).map(resumoBib)
      .sort((a, b) => b.uso_1y - a.uso_1y);
  } catch { bib = []; }
  const minhasBR = minhas.filter((v) => v.idiomas.some((l) => /pt/i.test(l)) || /brazil|pt/i.test(String(v.sotaque)));
  const melhor = (g) => minhasBR.find((v) => v.genero === g) || bib.find((v) => v.genero === g) || null;
  const auto = { masculina: melhor('male'), feminina: melhor('female') };
  const favoritas = [];
  const add = (v) => { if (v && !favoritas.some((f) => f.voice_id === v.voice_id)) favoritas.push(v); };
  add(auto.masculina); add(auto.feminina);
  for (const v of [...minhasBR, ...bib]) { if (favoritas.length >= 4) break; add(v); }
  gravarJSON(ARQ, { atualizado_em: agora(), minhas, biblioteca: bib.slice(0, 40), favoritas, auto, kokoro: KOKORO });
  return catalogoFinal();
}

// "elevenlabs:auto-masculina" | "elevenlabs:<voice_id>" | "kokoro:pf_dora" | "<voice_id>"
export async function resolverVoz(valor, { permitirAdicionar = true, log = () => {} } = {}) {
  const [prov, id] = String(valor || '').includes(':') ? String(valor).split(/:(.*)/s) : ['elevenlabs', String(valor || '')];
  if (prov === 'kokoro') {
    const k = KOKORO.find((v) => v.voice_id === id) || KOKORO[0];
    return { provedor: 'kokoro', voice_id: k.voice_id, nome: k.nome, genero: k.genero };
  }
  if (!temChaveEleven()) {
    const fem = /feminina|female/.test(id);
    const k = fem ? KOKORO[1] : KOKORO[0];
    log('aviso', `Sem ELEVENLABS_API_KEY: usando ${k.nome} no lugar de "${valor}".`);
    return { provedor: 'kokoro', voice_id: k.voice_id, nome: k.nome, genero: k.genero, substituta: true };
  }
  let cat = catalogoFinal();
  if (!cat.todas.length) cat = await listarVozes({ atualizar: true });
  let v = null;
  if (id === 'auto-masculina') v = cat.auto?.masculina;
  else if (id === 'auto-feminina') v = cat.auto?.feminina;
  else v = cat.todas.find((x) => x.voice_id === id) || { voice_id: id, nome: id, minha: true };
  if (!v) throw new Error(`Não achei uma voz para "${valor}". Escolha uma voz em Configurações → Voz no painel.`);
  if (!v.minha && !v.adicionada && v.public_owner_id && permitirAdicionar && !cat.sem_permissao) {
    const nome = `${v.nome} (Estúdio de Reels)`.slice(0, 60);
    const novoId = await adicionarVozDaBiblioteca(v.public_owner_id, v.voice_id, nome);
    log('voz', `Voz "${v.nome}" adicionada à sua conta da ElevenLabs para poder ser usada pela API.`);
    v = { ...v, voice_id: novoId || v.voice_id, adicionada: true };
    try { await listarVozes({ atualizar: true }); } catch {}
  }
  return { provedor: 'elevenlabs', voice_id: v.voice_id, nome: v.nome, genero: v.genero };
}

// ---------------- Voice Design: vozes brasileiras nativas criadas a partir de uma descrição ----------------
// Funciona mesmo sem voices_read: a voz criada entra na sua conta e o voice_id vai para o catálogo.
export const DESIGN_PRESETS = {
  masculina: 'A confident Brazilian man in his early 30s, native Brazilian Portuguese speaker with a neutral São Paulo accent. Warm, clear, slightly deep voice; engaging science and technology explainer narrator, like a YouTube documentary host. Steady, energetic pace, crisp diction, studio-quality recording, no background noise.',
  feminina: 'A confident Brazilian woman in her late 20s, native Brazilian Portuguese speaker with a neutral São Paulo accent. Bright, warm and clear voice; engaging science and technology explainer narrator, like a YouTube documentary host. Energetic pace, crisp diction, studio-quality recording, no background noise.',
};
export const TEXTO_DESIGN = 'Pra fraudar uma eleição no Brasil, um hacker teria que invadir mais de quinhentas mil urnas eletrônicas. Uma por uma, pessoalmente. Sabe por quê? A urna não tem Wi-Fi, nem Bluetooth, nem entrada de cabo.';
const ARQ_PREVIAS = () => path.join(P.biblioteca, 'vozes', 'design', 'ultimas.json');

export function ultimasPrevias() { return lerJSON(ARQ_PREVIAS(), { previas: [] }); }

export async function gerarPreviasDesign({ genero: g = 'masculina', descricao = null, texto = null, modelo = 'eleven_multilingual_ttv_v2' } = {}) {
  const { desenharVoz } = await import('../../motor/lib/elevenlabs.mjs');
  const desc = String(descricao || DESIGN_PRESETS[g] || DESIGN_PRESETS.masculina).slice(0, 1000);
  let txt = String(texto || TEXTO_DESIGN).trim();
  if (txt.length < 100) txt = `${txt} ${TEXTO_DESIGN}`.slice(0, 1000);
  const { dados, meta } = await desenharVoz({ descricao: desc, texto: txt.slice(0, 1000), modelo });
  const dir = garantirPasta(path.join(P.biblioteca, 'vozes', 'design'));
  const creditos = Number(meta.cabecalhos?.['character-cost']);
  const previas = (dados.previews || []).map((p, i) => {
    const nome = `${p.generated_voice_id}.mp3`;
    fs.writeFileSync(path.join(dir, nome), Buffer.from(p.audio_base_64, 'base64'));
    return { generated_voice_id: p.generated_voice_id, arquivo: `biblioteca/vozes/design/${nome}`, duracao: p.duration_secs, idioma: p.language || null, ordem: i + 1 };
  });
  const registro = { ts: agora(), genero: g, descricao: desc, texto: dados.text || txt, modelo, creditos: Number.isFinite(creditos) ? creditos : null, previas };
  // guarda as últimas rodadas (as mais novas primeiro) para o painel mostrar mesmo depois de recarregar
  const hist = ultimasPrevias();
  hist.rodadas = [registro, ...(hist.rodadas || [])].slice(0, 6);
  hist.previas = registro.previas;
  gravarJSON(ARQ_PREVIAS(), hist);
  anexarLinha(path.join(P.dados, 'elevenlabs_amostras.jsonl'), { ts: agora(), tipo: 'voice-design', genero: g, previas: previas.length, creditos: registro.creditos });
  return registro;
}

export async function salvarVozDesenhada({ generated_voice_id, nome, genero: g = 'masculina', descricao = '', tornarPadrao = true }) {
  const { criarVozDesenhada } = await import('../../motor/lib/elevenlabs.mjs');
  const hist = ultimasPrevias();
  const rodada = (hist.rodadas || []).find((r) => r.previas.some((p) => p.generated_voice_id === generated_voice_id));
  const outras = rodada ? rodada.previas.map((p) => p.generated_voice_id).filter((x) => x !== generated_voice_id) : [];
  const desc = String(descricao || rodada?.descricao || DESIGN_PRESETS[g] || '').slice(0, 1000);
  const voiceId = await criarVozDesenhada({
    nome: String(nome || `Narrador BR ${g}`).slice(0, 60), descricao: desc, generatedVoiceId: generated_voice_id,
    rotulos: { accent: 'brazilian', language: 'pt', gender: g === 'feminina' ? 'female' : 'male', use_case: 'narration' }, naoEscolhidas: outras,
  });
  adicionarPersonalizada({ voice_id: voiceId, nome: nome || `Narrador BR ${g}`, genero: g === 'feminina' ? 'female' : 'male', descricao: 'pt-BR nativa · criada no Voice Design' });
  const u = lerUsuario();
  const fav = [voiceId, ...((u.favoritas && u.favoritas.length ? u.favoritas : catalogoFinal().favoritas.map((v) => v.voice_id)) || []).filter((id) => id !== voiceId)].slice(0, 4);
  salvarPreferencias({ favoritas: fav, auto: { [g === 'feminina' ? 'feminina' : 'masculina']: voiceId } });
  if (tornarPadrao) {
    const arq = path.join(P.config, 'padroes.json');
    const pad = lerJSON(arq);
    pad.respostas.voz = `elevenlabs:${voiceId}`;
    gravarJSON(arq, pad);
  }
  return { voice_id: voiceId };
}

// ---------------- amostras para ouvir no painel (com cache) ----------------
export const TEXTO_AMOSTRA = 'Pra fraudar uma eleição no Brasil, um hacker teria que invadir quinhentas mil urnas.';
const AJUSTES_CHAVES = ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'];
export function chaveAmostra({ voice_id, texto, modelo, ajustes }) {
  const aj = {};
  for (const k of AJUSTES_CHAVES) if (ajustes?.[k] !== undefined && ajustes[k] !== null && ajustes[k] !== '') aj[k] = typeof ajustes[k] === 'boolean' ? ajustes[k] : Number(ajustes[k]);
  return crypto.createHash('sha1').update(JSON.stringify({ voice_id, texto, modelo, aj })).digest('hex').slice(0, 20);
}
export async function gerarAmostra({ voice_id, texto = TEXTO_AMOSTRA, modelo = 'eleven_multilingual_v2', ajustes = {} }) {
  texto = String(texto || TEXTO_AMOSTRA).trim().slice(0, 300);
  const dir = garantirPasta(path.join(P.biblioteca, 'vozes'));
  const nome = `${chaveAmostra({ voice_id, texto, modelo, ajustes })}.mp3`;
  const arq = path.join(dir, nome);
  const rel = `biblioteca/vozes/${nome}`;
  if (existe(arq)) return { arquivo: rel, cache: true, creditos: 0 };
  const aj = {};
  for (const k of AJUSTES_CHAVES) if (ajustes?.[k] !== undefined && ajustes[k] !== '') aj[k] = typeof ajustes[k] === 'boolean' ? ajustes[k] : Number(ajustes[k]);
  const { dados, meta } = await falarComTempos({ voiceId: voice_id, texto, modelo, ajustes: aj });
  fs.writeFileSync(arq, Buffer.from(dados.audio_base64, 'base64'));
  const creditos = Number(meta.cabecalhos?.['character-cost']);
  anexarLinha(path.join(P.dados, 'elevenlabs_amostras.jsonl'), { ts: agora(), voice_id, modelo, caracteres: texto.length, creditos: Number.isFinite(creditos) ? creditos : null });
  return { arquivo: rel, cache: false, creditos: Number.isFinite(creditos) ? creditos : null };
}
