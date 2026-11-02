// Estágio "revisao_final": prepara o pacote para um AGENTE REVISOR independente (subagente do Claude)
// assistir ao vídeo pronto e dar um parecer. No modo "corrigir", o Claude produtor aplica as correções,
// re-renderiza e o motor volta aqui para a rodada seguinte (até config.revisor_rodadas).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, lerJSON, gravarTexto, existe, garantirPasta, python, rodarSync, ffprobeDuracao } from '../../motor/lib/util.mjs';
import { lerLinha } from '../../motor/lib/linha.mjs';
import { listarRodadas as listarRodadasUsuario } from '../revisao-usuario/rodadas.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VEREDITOS = ['aprovado', 'corrigir'];

export function modoRevisor(cfg) {
  const pad = lerJSON(path.join(P.config, 'padroes.json'), {});
  return cfg?.revisor || pad.respostas?.revisor || 'corrigir';
}
export function maxRodadas(cfg) {
  const pad = lerJSON(path.join(P.config, 'padroes.json'), {});
  return Number(cfg?.revisor_rodadas || pad.ajustes?.revisor_rodadas || 2);
}
export function rodadas(pasta) {
  const dir = path.join(pasta, 'revisor');
  if (!existe(dir)) return [];
  return fs.readdirSync(dir).map((f) => f.match(/^rodada-(\d+)\.json$/)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), ...lerJSON(path.join(dir, m[0]), {}) }))
    .sort((a, b) => a.n - b.n);
}

// Rodadas desde o último pedido de correção do usuário: o limite vale só para o ciclo automático,
// então um pedido seu sempre ganha uma rodada de conferência.
export function rodadasAutomaticas(rs) {
  let base = -1;
  rs.forEach((r, i) => { if (r.usuario?.acao === 'corrigir') base = i; });
  return rs.length - (base + 1);
}

export async function executar(estagio, ctx) {
  const cfg = ctx.config;
  const modo = modoRevisor(cfg);
  if (modo === 'nao') return { status: 'pulado', nota: 'sem agente revisor (escolha do menu)' };
  const video = path.join(ctx.pasta, 'out', 'render.mp4');
  if (!existe(video)) throw new Error('out/render.mp4 não existe: o revisor precisa do vídeo renderizado.');
  // Voltando de ajustes que VOCÊ pediu na sua revisão cena a cena: não gasta outra rodada do agente,
  // a próxima rodada da sua revisão é quem confere.
  const ultUsuario = listarRodadasUsuario(ctx.pasta).at(-1);
  if (ultUsuario?.decisao === 'ajustes') return { status: 'concluido', nota: `ajustes da sua revisão (rodada ${ultUsuario.rodada}): sem nova rodada do agente` };
  const feitas = rodadas(ctx.pasta);
  const max = maxRodadas(cfg);
  const ultima = feitas.at(-1);
  // acabou o limite de rodadas: entrega com as pendências registradas
  if (modo === 'corrigir' && rodadasAutomaticas(feitas) >= max && ultima?.veredito === 'corrigir') {
    const pend = (ultima.problemas || []).filter((p) => p.gravidade !== 'baixa').length;
    return { status: 'concluido', nota: `limite de ${max} rodadas; ${pend} pendência(s) no último parecer` };
  }
  const n = feitas.length + 1;
  const linha = lerLinha(ctx.pasta);
  const dir = garantirPasta(path.join(ctx.pasta, 'revisor', `rodada-${n}`));
  const dirQ = garantirPasta(path.join(dir, 'quadros'));
  const dirX = garantirPasta(path.join(dir, 'extras'));
  for (const f of fs.readdirSync(dirQ)) fs.rmSync(path.join(dirQ, f), { force: true });
  ctx.progresso('revisao_final', 10, `Preparando o pacote da rodada ${n}`);

  // um quadro no meio de cada fala, do vídeo FINAL
  const quadros = [];
  linha.falas.forEach((f, i) => {
    const t = Math.min(linha.total - 0.05, (f.inicio + f.fim) / 2);
    const nome = `q_${String(i + 1).padStart(3, '0')}_${f.id}.jpg`;
    rodarSync('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=540:-1', '-q:v', '3', path.join(dirQ, nome)]);
    quadros.push({ fala: f.id, t: Math.round(t * 100) / 100, arquivo: path.join(dirQ, nome) });
  });
  const cols = Math.min(6, quadros.length);
  const lin = Math.ceil(quadros.length / cols);
  // folha: copia para uma sequência simples (001.jpg, 002.jpg…) e monta a grade
  const seq = garantirPasta(path.join(dir, '_seq'));
  quadros.forEach((q, i) => fs.copyFileSync(q.arquivo, path.join(seq, `${String(i + 1).padStart(3, '0')}.jpg`)));
  rodarSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(seq, '%03d.jpg'), '-vf', `scale=270:480,tile=${cols}x${lin}:padding=4:color=0x1d2026`, '-frames:v', '1', '-q:v', '3', path.join(dir, 'folha.jpg')]);
  fs.rmSync(seq, { recursive: true, force: true });
  const emenda = path.join(ctx.pasta, 'out', 'emenda.jpg');
  if (existe(emenda)) fs.copyFileSync(emenda, path.join(dir, 'emenda.jpg'));

  // o áudio final diz o que o roteiro diz? (Whisper sobre a mixagem final)
  ctx.progresso('revisao_final', 45, 'Transcrevendo o áudio final (Whisper)');
  const r = ctx.roteiro();
  const txt = path.join(dir, 'texto_falado.txt');
  fs.writeFileSync(txt, r.falas.map((f) => f.fala || f.texto).join(' '), 'utf8');
  const mix = path.join(ctx.pasta, 'mix', 'mix.wav');
  python([path.join(P.modulos, 'voz', 'alinhar.py'), '--audio', existe(mix) ? mix : video, '--verificar', txt, '--saida', path.join(dir, 'transcricao.json'), '--modelo', cfg.whisper_modelo || 'small']);
  const transc = lerJSON(path.join(dir, 'transcricao.json'), null);

  const qa = lerJSON(path.join(ctx.pasta, 'qa.json'), {});
  const mixMeta = lerJSON(path.join(ctx.pasta, 'mix', 'meta.json'), {});
  const check = lerJSON(path.join(ctx.pasta, 'quadros', 'check.json'), {});
  const errosCheck = ((check.runtime?.findings || []).concat(check.layout?.findings || [])).filter((x) => x.severity === 'error').length;
  const saidaJSON = path.join(ctx.pasta, 'revisor', `rodada-${n}.json`);
  const ant = feitas.map((x) => `### Rodada ${x.n}: ${x.veredito} (nota ${x.nota ?? '?'})\n${(x.problemas || []).map((p) => `- [${p.id}] ${p.gravidade} · ${p.onde} · ${p.descricao}${(x.respostas || []).find((q) => q.id === p.id) ? ` → produtor: ${(x.respostas || []).find((q) => q.id === p.id).acao} (${(x.respostas || []).find((q) => q.id === p.id).como || ''})` : ''}`).join('\n')}`).join('\n\n');
  const tabela = linha.falas.map((f, i) => `| ${f.id} | ${f.inicio.toFixed(2)}–${f.fim.toFixed(2)} | ${String(f.texto).replace(/\|/g, '/')} | ${f.overlay ? `${f.overlay.tipo}: ${f.overlay.valor || (f.overlay.itens || []).join(', ')}` : ''} | ${quadros[i] ? path.basename(quadros[i].arquivo) : ''} |`).join('\n');
  gravarTexto(path.join(dir, 'pacote.md'), `# Pacote de revisão: ${r.titulo} (rodada ${n} de ${max}, modo ${modo})

- Vídeo final: ${video} (${(ffprobeDuracao(video) || 0).toFixed(2)} s, ${linha.fps} qps, 1080×1920)
- Teste do loop (últimos 3 s + primeiros 3 s): ${path.join(ctx.pasta, 'out', 'teste-loop.mp4')}
- Quadros, um no meio de cada fala: ${dirQ}
- Pasta para os quadros extras que você extrair: ${dirX}
- Folha com todos os quadros (na ordem das falas): ${existe(path.join(dir, 'folha.jpg')) ? path.join(dir, 'folha.jpg') : '(não gerada: abra os quadros individuais)'}
- Emenda (último quadro × primeiro quadro): ${existe(emenda) ? path.join(dir, 'emenda.jpg') : '(não gerada)'}
- Roteiro aprovado pelo usuário: ${path.join(ctx.pasta, 'roteiro.json')}
- Linha do tempo (tempos de falas, palavras, legendas, cartões): ${path.join(ctx.pasta, 'linha.json')}
- Storyboard: ${path.join(ctx.pasta, 'storyboard.json')}
- Estilo: ${cfg.estilo}${Array.isArray(lerJSON(path.join(ctx.pasta, 'storyboard.json'), {}).segmentos) ? ` (${lerJSON(path.join(ctx.pasta, 'storyboard.json'), {}).segmentos.map((s) => `${(s.falas || [])[0]}–${(s.falas || []).at(-1)} ${s.estilo}`).join(' · ')})` : ''} · paleta ${cfg.paleta} · legenda ${cfg.legenda} · loop ${cfg.loop}

## Medições automáticas
- QA: duração ${qa.duracao ?? '?'} s (esperado ${qa.esperado ?? '?'}), áudio ${qa.audio ? 'ok' : 'AUSENTE'}, SSIM da emenda ${qa.ssim_emenda ?? '?'}, loudness ${qa.lufs ?? '?'} LUFS${(qa.avisos || []).length ? `, avisos: ${qa.avisos.join(' | ')}` : ''}
- hyperframes check: ${errosCheck} erro(s)
- Música: ${mixMeta.musica ? `${mixMeta.musica.sob_a_fala_lu} LU sob a voz (alvo ${mixMeta.musica.alvo_lu}), ${mixMeta.musica.nas_pausas_lu ?? '?'} LU nas pausas, oscilação ${mixMeta.musica.oscilacao_db_s} dB/s` : 'não medida (mixagem antiga)'}
- Áudio final × texto (Whisper): ${transc ? `${Math.round(transc.acerto * 100)}% das palavras reconhecidas; não reconhecidas: ${(transc.nao_reconhecidas || []).slice(0, 20).join(', ') || 'nenhuma'}` : 'não medido'}

## Falas
| fala | tempo (s) | texto | cartão | quadro |
|---|---|---|---|---|
${tabela}

## Loop do roteiro
- Última fala: "${r.loop?.frase_final || ''}"
- Primeira fala: "${r.loop?.frase_inicial || ''}"
- Como emenda: ${r.loop?.como_emenda || ''}

${ant ? `## Rodadas anteriores (confira se o que foi corrigido ficou bom)\n${ant}\n` : ''}
## Onde gravar o parecer
${saidaJSON}
`);
  return {
    status: 'aguardando_claude',
    instrucoes: `Rodada ${n} de ${max} (modo ${modo}). Siga modulos/revisor/MODULO.md: dispare o agente revisor com o briefing de modulos/revisor/REVISOR.md e o pacote ${path.join(dir, 'pacote.md')}; ele grava ${saidaJSON}. Depois ${modo === 'corrigir' ? 'aplique as correções e re-renderize (o motor volta aqui) ou, se o veredito for "aprovado", ' : ''}rode \`node motor/rs.mjs concluir ${ctx.id} revisao_final\`.`,
  };
}

export async function validarConclusao(estagio, ctx) {
  const modo = modoRevisor(ctx.config);
  if (modo === 'nao') return { ok: true };
  const rs = rodadas(ctx.pasta);
  if (!rs.length) return { ok: false, erros: ['Nenhum parecer ainda: dispare o agente revisor (modulos/revisor/MODULO.md).'] };
  const u = rs.at(-1);
  const erros = [];
  if (!VEREDITOS.includes(u.veredito)) erros.push(`rodada-${u.n}.json: "veredito" precisa ser ${VEREDITOS.join(' ou ')}.`);
  if (!Array.isArray(u.problemas)) erros.push(`rodada-${u.n}.json: falta a lista "problemas" (pode ser vazia).`);
  if (!erros.length && modo === 'corrigir' && u.veredito === 'corrigir' && rodadasAutomaticas(rs) < maxRodadas(ctx.config)) {
    const resp = new Map((u.respostas || []).map((x) => [x.id, x.acao]));
    const pend = u.problemas.filter((p) => p.gravidade !== 'baixa' && !['ignorado', 'para_usuario'].includes(resp.get(p.id)));
    if (pend.length) erros.push(`O revisor pediu correções na rodada ${u.n} (${pend.map((p) => p.id).join(', ')}). Corrija seguindo modulos/revisor/MODULO.md e re-renderize: o motor volta a este estágio para a rodada ${u.n + 1}. Para não corrigir um item, justifique em "respostas" com "acao": "ignorado" ou "para_usuario".`);
  }
  return { ok: erros.length === 0, erros };
}
