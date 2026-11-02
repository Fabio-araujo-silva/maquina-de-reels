// Fonte "YouTube": o usuário cola o link de um vídeo e o reel é feito sobre o assunto dele.
// Baixa só os metadados, a capa e a legenda (nunca o vídeo) com o yt-dlp e grava em <pasta>/fonte/:
//   youtube.json   metadados + de onde veio a transcrição
//   transcricao.txt texto com marcas [mm:ss] a cada ~30 s (para o roteiro citar trechos)
//   capa.jpg       capa do vídeo (referência visual para a montagem; não entra no reel)
//   resumo.md      o que o Claude lê primeiro no estágio de roteiro
// Sem legenda: com transcrever=true baixa só o áudio dos primeiros `maxMin` minutos e transcreve com o faster-whisper.
// whisper=true ignora a legenda e transcreve sempre pelo áudio (quando a legenda automática vier ruim).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rodarSync, garantirPasta, gravarJSON, gravarTexto, lerJSON, python, agora } from '../../motor/lib/util.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RE_YT = /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i;

export function idYoutube(url) {
  const m = String(url || '').trim().match(RE_YT);
  return m ? m[1] : null;
}

function ytdlp(args, opts = {}) {
  // o mesmo yt-dlp da skill tiktok-download (Python do sistema); se não estiver no PATH, tenta "python -m yt_dlp"
  let r = rodarSync('yt-dlp', args, { timeout: 300000, ...opts });
  if (r.codigo === -1 && /ENOENT/.test(r.erro)) r = rodarSync('python', ['-m', 'yt_dlp', ...args], { timeout: 300000, ...opts });
  return r;
}
const ultimaLinha = (t) => String(t || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'sem detalhe';
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Melhor faixa de legenda: manual no idioma falado > automática do idioma falado > manual pt/en > qualquer automática original > qualquer manual.
// (As automáticas "traduzidas" do YouTube ficam por último: são piores que a original.)
function escolherLegenda(info) {
  const man = info.subtitles || {};
  const aut = info.automatic_captions || {};
  const orig = String(info.language || '').split('-')[0];
  const prefixo = (obj, p) => Object.keys(obj).filter((k) => k === p || k.startsWith(`${p}-`));
  const tentativas = [];
  if (orig) tentativas.push(['manual', man, [orig, ...prefixo(man, orig)]], ['automatica', aut, [`${orig}-orig`, orig]]);
  tentativas.push(['manual', man, ['pt-BR', 'pt', ...prefixo(man, 'pt'), 'en', 'en-US', ...prefixo(man, 'en')]]);
  tentativas.push(['automatica', aut, Object.keys(aut).filter((k) => k.endsWith('-orig'))]);
  tentativas.push(['manual', man, Object.keys(man)]);
  tentativas.push(['automatica', aut, ['pt-BR', 'pt', 'en']]);
  for (const [tipo, obj, codigos] of tentativas) {
    const c = codigos.find((k) => k && Array.isArray(obj[k]) && obj[k].length);
    if (!c) continue;
    const f = obj[c].find((x) => x.ext === 'json3') || obj[c].find((x) => x.ext === 'vtt') || obj[c][0];
    return { tipo, idioma: c.replace(/-orig$/, ''), formato: f.ext, url: f.url };
  }
  return null;
}

function linhasDeJson3(j) {
  const out = [];
  for (const ev of j.events || []) {
    if (!ev.segs) continue;
    const txt = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (txt) out.push({ t: (ev.tStartMs || 0) / 1000, txt });
  }
  return out;
}

function linhasDeVtt(txt) {
  const out = [];
  let ultimo = '';
  for (const bloco of String(txt).split(/\r?\n\r?\n/)) {
    const ls = bloco.split(/\r?\n/);
    const i = ls.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const m = ls[i].match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
    const t = m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : 0;
    for (const l of ls.slice(i + 1)) {
      const limpo = l.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim();
      if (limpo && limpo !== ultimo) { out.push({ t, txt: limpo }); ultimo = limpo; }
    }
  }
  return out;
}

// Parágrafos de ~30 s com a marca de tempo de onde começam: "[02:30] texto…"
function agrupar(linhas, janela = 30) {
  const out = [];
  let ini = null;
  let buf = [];
  for (const l of linhas) {
    if (ini === null) ini = l.t;
    if (l.t - ini >= janela && buf.length) { out.push(`[${mmss(ini)}] ${buf.join(' ')}`); buf = []; ini = l.t; }
    buf.push(l.txt);
  }
  if (buf.length) out.push(`[${mmss(ini)}] ${buf.join(' ')}`);
  return out.join('\n\n').replace(/[ \t]+/g, ' ');
}

async function baixar(url, destino) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
}

function transcreverAudio(dir, url, maxMin, log) {
  for (const f of fs.readdirSync(dir)) if (f.startsWith('audio.')) fs.rmSync(path.join(dir, f), { force: true });
  log(`Sem legenda: baixando só o áudio dos primeiros ${maxMin} min para transcrever`);
  const a = ytdlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-warnings', '--download-sections', `*0-${maxMin * 60}`, '-o', path.join(dir, 'audio.%(ext)s'), url]);
  const arq = fs.readdirSync(dir).find((f) => f.startsWith('audio.'));
  if (a.codigo !== 0 || !arq) throw new Error(`não consegui baixar o áudio: ${ultimaLinha(a.erro)}`);
  const saida = path.join(dir, 'whisper.json');
  log('Transcrevendo com o faster-whisper (pode levar alguns minutos)');
  const r = python([path.join(AQUI, 'transcrever.py'), '--audio', path.join(dir, arq), '--saida', saida, '--modelo', 'small']);
  fs.rmSync(path.join(dir, arq), { force: true });
  if (r.codigo !== 0) throw new Error(`a transcrição falhou: ${ultimaLinha(r.erro)}`);
  const w = lerJSON(saida, { segmentos: [] });
  fs.rmSync(saida, { force: true });
  return { linhas: w.segmentos.map((s) => ({ t: s.t, txt: s.txt })), idioma: w.idioma };
}

function resumoMd(m) {
  const leg = m.sem_legenda ? 'SEM LEGENDA: rode `node motor/rs.mjs fonte <id> --transcrever` antes de escrever (baixa só o áudio e transcreve; leva alguns minutos).'
    : `${m.palavras} palavras · ${{ manual: 'legenda manual', automatica: 'legenda automática do YouTube', whisper: 'transcrita do áudio pelo Whisper' }[m.legenda.tipo]} em "${m.legenda.idioma}"`;
  return `# Fonte do reel: vídeo do YouTube

- Título: ${m.titulo}
- Canal: ${m.canal || '?'}${m.canal_url ? ` (${m.canal_url})` : ''}
- Publicado em: ${m.publicado || '?'} · Duração: ${m.duracao_s ? mmss(m.duracao_s) : '?'} · Visualizações: ${m.visualizacoes ?? '?'}
- Link: ${m.url}
- Transcrição: fonte/transcricao.txt (${leg})
- Capa (referência visual, não entra no reel): ${m.capa || '(sem capa)'}

## Descrição (início)
${(m.descricao || '(sem descrição)').slice(0, 1500)}
${m.capitulos.length ? `\n## Capítulos\n${m.capitulos.map((c) => `- ${c.inicio} ${c.titulo}`).join('\n')}\n` : ''}
## Como usar no roteiro
- O assunto do reel é o assunto deste vídeo, no ângulo que o prompt do usuário pedir.
- A transcrição é o ponto de partida, não a única fonte: confira cada número, data e afirmação em fontes independentes antes de usar, e cite este vídeo em \`fontes\` (com o link).
- Escreva com as suas palavras, na estrutura cíclica da skill. Não copie frases nem a ordem do vídeo original.
- Não use o áudio, as imagens nem trechos do vídeo original no reel. A capa serve só de referência para a montagem ficar específica (lugar, objetos, pessoas, cores).
- Se o vídeo defende uma posição, trate-a como a posição de quem fala ("segundo o canal X…") e não como fato.
`;
}

// Busca a fonte e grava em <pasta>/fonte/. Devolve os metadados (o que vai para youtube.json).
export async function buscarYoutube({ url, pasta, transcrever = false, whisper = false, maxMin = 20, log = () => {} }) {
  const vid = idYoutube(url);
  if (!vid) throw new Error(`Isso não parece um link de vídeo do YouTube: ${url}`);
  const link = `https://www.youtube.com/watch?v=${vid}`;
  const dir = garantirPasta(path.join(pasta, 'fonte'));
  log('Lendo os dados do vídeo no YouTube');
  const r = ytdlp(['-J', '--skip-download', '--no-playlist', '--no-warnings', link]);
  if (r.codigo !== 0 || !r.saida.trim().startsWith('{')) throw new Error(`o yt-dlp não conseguiu ler o vídeo (${ultimaLinha(r.erro)})`);
  const info = JSON.parse(r.saida);

  let linhas = [];
  let legenda = null;
  const esc = whisper ? null : escolherLegenda(info);
  if (esc) {
    try {
      const resp = await fetch(esc.url, { signal: AbortSignal.timeout(60000) });
      if (resp.ok) {
        const corpo = await resp.text();
        linhas = esc.formato === 'json3' ? linhasDeJson3(JSON.parse(corpo)) : linhasDeVtt(corpo);
        if (linhas.length) legenda = { tipo: esc.tipo, idioma: esc.idioma };
      }
    } catch (e) { log(`Legenda não baixou (${e.message}); sigo sem ela`); }
  }
  if (!linhas.length && (transcrever || whisper)) {
    const w = transcreverAudio(dir, link, maxMin, log);
    linhas = w.linhas;
    if (linhas.length) legenda = { tipo: 'whisper', idioma: w.idioma, limite_min: maxMin };
  }

  // capa em JPG (a de maior resolução que o YouTube oferecer)
  let capa = null;
  const jpgs = (info.thumbnails || []).filter((t) => /\.jpe?g(\?|$)/i.test(t.url || '')).sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0) || (b.width || 0) - (a.width || 0));
  for (const u of [...jpgs.map((t) => t.url), `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`]) {
    try { await baixar(u, path.join(dir, 'capa.jpg')); capa = 'fonte/capa.jpg'; break; } catch {}
  }

  const texto = agrupar(linhas);
  const ud = String(info.upload_date || '');
  const meta = {
    tipo: 'youtube', url: link, id: vid,
    titulo: info.title || link, canal: info.channel || info.uploader || null, canal_url: info.channel_url || info.uploader_url || null,
    publicado: ud.length === 8 ? `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6)}` : null,
    duracao_s: info.duration ?? null, visualizacoes: info.view_count ?? null, idioma: info.language || legenda?.idioma || null,
    descricao: String(info.description || '').slice(0, 4000),
    capitulos: (info.chapters || []).map((c) => ({ inicio: mmss(c.start_time || 0), titulo: c.title })),
    tags: (info.tags || []).slice(0, 15),
    legenda, palavras: texto ? texto.replace(/\[\d+:\d+\]/g, '').split(/\s+/).filter(Boolean).length : 0,
    sem_legenda: !linhas.length, capa, buscado_em: agora(),
  };
  gravarJSON(path.join(dir, 'youtube.json'), meta);
  gravarTexto(path.join(dir, 'transcricao.txt'), texto ? `${texto}\n` : '');
  gravarTexto(path.join(dir, 'resumo.md'), resumoMd(meta));
  return meta;
}

// O que fica no estado do vídeo (estado.json → fonte) e aparece no painel.
export function resumoFonte(meta, url, erro = null) {
  if (!meta) return { tipo: 'youtube', url, erro: erro || 'falhou' };
  return { tipo: 'youtube', url: meta.url, titulo: meta.titulo, canal: meta.canal, duracao_s: meta.duracao_s, palavras: meta.palavras, legenda: meta.legenda, sem_legenda: meta.sem_legenda, capa: meta.capa, buscado_em: meta.buscado_em };
}
