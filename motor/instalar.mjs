#!/usr/bin/env node
// Instalação local: `npm run setup` (depois de `npm install`).
// 1) clona os projetos externos (MIT) em commits fixados  2) cria o .venv com as dependências Python
// 3) baixa o modelo de voz offline (Kokoro)  4) cria .env e configs locais a partir dos exemplos  5) roda o doctor
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const passo = (t) => console.log(`\n▸ ${t}`);
const rodar = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: RAIZ, shell: WIN && !cmd.includes(path.sep), ...opts });
  if (r.status !== 0) throw new Error(`falhou: ${cmd} ${args.join(' ')}`);
};

const EXTERNOS = [
  { pasta: 'lemo-opuscar', url: 'https://github.com/lemomo-ai/lemo-opuscar.git', commit: 'bebbbe1' },
  { pasta: 'gbro-collage-broll', url: 'https://github.com/pyang5166/gbro-collage-broll.git', commit: 'a1a4ee2' },
];

passo('Projetos externos (externos/)');
fs.mkdirSync(path.join(RAIZ, 'externos'), { recursive: true });
for (const e of EXTERNOS) {
  const dest = path.join(RAIZ, 'externos', e.pasta);
  if (fs.existsSync(path.join(dest, '.git'))) { console.log(`  ${e.pasta}: já existe`); continue; }
  rodar('git', ['clone', '--quiet', e.url, dest]);
  rodar('git', ['-C', dest, 'checkout', '--quiet', e.commit]);
  console.log(`  ${e.pasta}: ok (${e.commit})`);
}

passo('Python (.venv)');
const py = WIN ? path.join(RAIZ, '.venv', 'Scripts', 'python.exe') : path.join(RAIZ, '.venv', 'bin', 'python');
if (!fs.existsSync(py)) {
  const base = ['python3', 'python', 'py'].find((c) => spawnSync(c, ['--version'], { shell: WIN }).status === 0);
  if (!base) throw new Error('Python 3.10+ não encontrado. Instale e rode de novo.');
  rodar(base, ['-m', 'venv', '.venv']);
}
rodar(py, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
rodar(py, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt']);

passo('Modelo de voz offline (Kokoro, ~340 MB, só na primeira vez)');
const cache = path.join(os.homedir(), '.cache', 'hyperframes', 'tts');
const baixar = async (url, dest) => {
  if (fs.existsSync(dest)) return console.log(`  ${path.basename(dest)}: já existe`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url); if (!r.ok) throw new Error(`download ${r.status}: ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); console.log(`  ${path.basename(dest)}: ok`);
};
const K = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
try {
  await baixar(`${K}/kokoro-v1.0.onnx`, path.join(cache, 'models', 'kokoro-v1.0.onnx'));
  await baixar(`${K}/voices-v1.0.bin`, path.join(cache, 'voices', 'voices-v1.0.bin'));
} catch (err) { console.log(`  (pulei: ${err.message}; a voz offline fica indisponível até baixar)`); }

passo('Arquivos locais');
for (const [ex, real] of [['.env.example', '.env'], ['config/vozes_usuario.example.json', 'config/vozes_usuario.json']]) {
  if (!fs.existsSync(path.join(RAIZ, real)) && fs.existsSync(path.join(RAIZ, ex))) { fs.copyFileSync(path.join(RAIZ, ex), path.join(RAIZ, real)); console.log(`  ${real}: criado`); }
}
for (const d of ['videos', 'dados', 'biblioteca/sfx', 'biblioteca/musica', 'biblioteca/vozes']) fs.mkdirSync(path.join(RAIZ, d), { recursive: true });

passo('Diagnóstico');
rodar(process.execPath, ['motor/rs.mjs', 'doctor']);
console.log('\nPronto. Suba o painel com `npm run painel` e abra http://127.0.0.1:4777');
