// Utilidades compartilhadas do motor: caminhos, JSON atômico, .env, processos e registro de atividade.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const P = {
  raiz: RAIZ,
  config: path.join(RAIZ, 'config'),
  videos: path.join(RAIZ, 'videos'),
  dados: path.join(RAIZ, 'dados'),
  fila: path.join(RAIZ, 'dados', 'fila'),
  modulos: path.join(RAIZ, 'modulos'),
  kit: path.join(RAIZ, 'kit'),
  estilos: path.join(RAIZ, 'estilos'),
  externos: path.join(RAIZ, 'externos'),
  biblioteca: path.join(RAIZ, 'biblioteca'),
  nodeModules: path.join(RAIZ, 'node_modules'),
};
export const IS_WIN = process.platform === 'win32';
export const PYTHON = IS_WIN ? path.join(RAIZ, '.venv', 'Scripts', 'python.exe') : path.join(RAIZ, '.venv', 'bin', 'python');
export const HF_BIN = path.join(RAIZ, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

export function agora() { return new Date().toISOString(); }
export function sessaoAtual() { return process.env.CLAUDE_CODE_SESSION_ID || null; }

export function garantirPasta(p) { fs.mkdirSync(p, { recursive: true }); return p; }
export function existe(p) { try { fs.accessSync(p); return true; } catch { return false; } }

export function lerJSON(p, padrao = undefined) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch (e) {
    if (padrao !== undefined) return padrao;
    throw new Error(`Não consegui ler JSON em ${p}: ${e.message}`);
  }
}

function esperar(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

export function gravarJSON(p, obj) {
  garantirPasta(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, p); return; }
    catch (e) { if (i === 7) { try { fs.unlinkSync(tmp); } catch {} throw e; } esperar(50 * (i + 1)); }
  }
}
export function lerTexto(p, padrao = '') { try { return fs.readFileSync(p, 'utf8'); } catch { return padrao; } }
export function gravarTexto(p, txt) { garantirPasta(path.dirname(p)); fs.writeFileSync(p, txt, 'utf8'); }
export function anexarLinha(p, obj) { garantirPasta(path.dirname(p)); fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8'); }
export function lerJSONL(p) {
  const txt = lerTexto(p, '');
  const out = [];
  for (const linha of txt.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    try { out.push(JSON.parse(linha)); } catch { /* linha corrompida: ignora */ }
  }
  return out;
}

// .env simples (CHAVE=valor). Nunca imprime valores.
export function carregarEnv() {
  const arq = path.join(RAIZ, '.env');
  const txt = lerTexto(arq, '');
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) process.env[m[1]] = v; // o .env da skill é a fonte da verdade (troca de chave vale na hora)
  }
}
export function temChave(nome) { carregarEnv(); return Boolean(process.env[nome] && process.env[nome].trim()); }

export function slug(txt, max = 48) {
  return String(txt).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'video';
}
export function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Registro global de atividade: liga cada comando do motor à sessão do Claude que o executou.
// É a base da contagem de tokens por vídeo (motor/lib/tokens.mjs).
export function registrarAtividade(video, cmd, extra = {}) {
  anexarLinha(path.join(P.dados, 'atividade.jsonl'), { ts: agora(), sessao: sessaoAtual(), video, cmd, ...extra });
}

// Executa um processo e devolve {codigo, saida, erro}. Sem shell: argumentos vão crus.
export function rodarSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, ...opts });
  return { codigo: r.status ?? (r.error ? -1 : 0), saida: r.stdout || '', erro: (r.stderr || '') + (r.error ? String(r.error) : '') };
}

// Executa um processo em streaming, chamando aoLinha(linha, fonte) para cada linha. Devolve Promise<{codigo}>.
export function rodarStream(cmd, args, { aoLinha = () => {}, logArquivo = null, ...opts } = {}) {
  return new Promise((resolve) => {
    const filho = spawn(cmd, args, { windowsHide: true, ...opts });
    let log = null;
    if (logArquivo) { garantirPasta(path.dirname(logArquivo)); log = fs.createWriteStream(logArquivo, { flags: 'a' }); }
    const tratar = (fonte) => {
      let resto = '';
      return (buf) => {
        const txt = resto + buf.toString('utf8');
        const linhas = txt.split(/\r?\n/);
        resto = linhas.pop();
        for (const l of linhas) {
          if (log) log.write(l + '\n');
          try { aoLinha(l, fonte); } catch { /* ignora */ }
        }
      };
    };
    filho.stdout?.on('data', tratar('out'));
    filho.stderr?.on('data', tratar('err'));
    filho.on('error', (e) => { if (log) log.write(String(e) + '\n'); resolve({ codigo: -1, erro: String(e) }); });
    filho.on('close', (codigo) => { if (log) log.end(); resolve({ codigo }); });
  });
}

export function ffprobeDuracao(arq) {
  const r = rodarSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', arq]);
  const d = parseFloat(r.saida.trim());
  return Number.isFinite(d) ? d : null;
}
export function ffprobeJSON(arq) {
  const r = rodarSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', arq]);
  try { return JSON.parse(r.saida); } catch { return null; }
}

const ENV_PY = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
export function python(args, opts = {}) { return rodarSync(PYTHON, args, { env: ENV_PY(), ...opts }); }
export function pythonStream(args, opts = {}) { return rodarStream(PYTHON, args, { env: ENV_PY(), ...opts }); }

const ENV_HF = () => ({ ...process.env, HYPERFRAMES_PYTHON: PYTHON, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' });
export function hf(args, opts = {}) { return rodarSync(process.execPath, [HF_BIN, ...args], { env: ENV_HF(), ...opts }); }
export function hfStream(args, opts = {}) { return rodarStream(process.execPath, [HF_BIN, ...args], { env: ENV_HF(), ...opts }); }

export function erroFatal(msg, codigo = 1) {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(codigo);
}

export function formatarDuracao(s) {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60); const r = Math.round(s % 60);
  return m ? `${m}min ${String(r).padStart(2, '0')}s` : `${r}s`;
}

export function copiarPasta(origem, destino) { fs.cpSync(origem, destino, { recursive: true, force: true }); }

export function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Arredonda segundos para a grade de quadros (piso), como o HyperFrames espera.
export function paraQuadro(t, fps = 30) { return Math.floor(t * fps + 1e-6) / fps; }
