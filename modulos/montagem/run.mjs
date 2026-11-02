// Módulo "montagem": valida o storyboard (estágio claude) e gera o projeto HyperFrames (estágio motor+claude).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, lerJSON, gravarTexto, existe, garantirPasta, copiarPasta, hf } from '../../motor/lib/util.mjs';
import { construirLinha } from '../../motor/lib/linha.mjs';
import { gerarIndex, gerarOverlays, gerarLegendas, gerarColagem, paletaDe, carregarIcone, sugerirIcones } from './gerar.mjs';
import { estiloPorId } from './estilos.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCA_ESBOCO = 'ESBOCO_MUNDO';

// ---------- estilos: um só (menu) ou dinâmico (o Claude escolhe por trecho em storyboard.segmentos) ----------
// Devolve os trechos com o estilo de cada um e o tempo que ocupam: [{ falas:[ids], estilo, ini, fim }].
export function segmentosDe(cfg, sb, linha) {
  const falas = linha.falas;
  if (cfg.estilo !== 'dinamico' || !Array.isArray(sb?.segmentos) || !sb.segmentos.length) {
    return [{ falas: falas.map((f) => f.id), estilo: cfg.estilo === 'dinamico' ? 'diorama-3d' : cfg.estilo, ini: 0, fim: linha.total }];
  }
  return sb.segmentos.map((s) => {
    const idx = falas.map((f, i) => ((s.falas || []).includes(f.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const a = Math.min(...idx); const b = Math.max(...idx);
    return { falas: idx.map((i) => falas[i].id), estilo: s.estilo, motivo: s.motivo || null, ini: a === 0 ? 0 : (falas[a].janela_inicio ?? falas[a].inicio), fim: b === falas.length - 1 ? linha.total : falas[b].janela_fim };
  }).filter(Boolean);
}
// Um mundo (composição 3D) por estilo 3D usado: o do primeiro estilo é a base (por baixo o vídeo todo).
const ehMundo3d = (e) => Boolean(e) && e !== 'colagem-halftone';
export function mundosDe(segs, estiloColagem) {
  const estilos = [...new Set(segs.filter((s) => ehMundo3d(s.estilo)).map((s) => s.estilo))];
  if (!estilos.length) estilos.push(estiloColagem ? 'colagem-halftone' : 'diorama-3d');
  return estilos.map((e, i) => ({
    id: i === 0 ? 'mundo' : `mundo-${String(e).replace(/^lemo:/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    estilo: e, base: i === 0,
    janelas: segs.filter((s) => s.estilo === e).map((s) => [Math.round(s.ini * 1000) / 1000, Math.round(s.fim * 1000) / 1000]),
  }));
}
function modeloDoMundo(estilo) {
  if (estilo === 'colagem-halftone') return 'mundo-colagem.html';
  if (String(estilo).startsWith('lemo:')) return 'mundo-lemo.html';
  const m = estiloPorId(estilo)?.modelo;
  return m === 'colagem' ? 'mundo-colagem.html' : m === 'lemo' ? 'mundo-lemo.html' : 'mundo-diorama.html';
}

export async function executar(estagio, ctx) {
  if (estagio !== 'montagem') throw new Error(`O módulo montagem não executa "${estagio}" pelo motor.`);
  const cfg = ctx.config;
  const linha = construirLinha(ctx); // reconstrói (barato e determinístico) para refletir o código e o roteiro atuais
  const sb = lerJSON(path.join(ctx.pasta, 'storyboard.json'), {});
  const paleta = paletaDe(cfg);
  const proj = garantirPasta(path.join(ctx.pasta, 'projeto'));
  const comps = garantirPasta(path.join(proj, 'compositions'));
  const assets = garantirPasta(path.join(proj, 'assets'));
  ctx.progresso('montagem', 10, 'Copiando kit e bibliotecas');

  // bibliotecas
  const libThree = garantirPasta(path.join(assets, 'lib', 'three'));
  for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(P.nodeModules, 'three', 'build', f), path.join(libThree, f));
  if (!existe(path.join(libThree, 'addons', 'postprocessing'))) copiarPasta(path.join(P.nodeModules, 'three', 'examples', 'jsm'), path.join(libThree, 'addons'));
  fs.copyFileSync(path.join(P.nodeModules, 'gsap', 'dist', 'gsap.min.js'), path.join(assets, 'lib', 'gsap.min.js'));
  // kit (sempre atualizado) e lemo core
  copiarPasta(P.kit, path.join(assets, 'kit'));
  const lemoCore = path.join(P.externos, 'lemo-opuscar', 'core');
  const destLemo = garantirPasta(path.join(assets, 'lemo'));
  fs.copyFileSync(path.join(lemoCore, 'lib.js'), path.join(destLemo, 'lib.js'));
  fs.copyFileSync(path.join(lemoCore, 'three', 'post.js'), path.join(destLemo, 'post.js'));
  if (existe(path.join(lemoCore, 'post', 'crt.js'))) fs.copyFileSync(path.join(lemoCore, 'post', 'crt.js'), path.join(destLemo, 'crt.js'));
  // áudio
  const mix = path.join(ctx.pasta, 'mix', 'mix.wav');
  if (existe(mix)) fs.copyFileSync(mix, path.join(assets, 'mix.wav'));

  // colagens (inserts) e colagens do mundo (estilo colagem)
  const estiloColagem = cfg.estilo === 'colagem-halftone';
  const especs = normalizarColagens(sb, linha);
  const inserts = [];
  const colagensMapa = {};
  const colagensMundo = [];
  const usados = new Set();
  if (estiloColagem) {
    linha.falas.forEach((f, i) => {
      const e = especs.find((x) => x.falas.includes(f.id));
      if (!e) return;
      const ultima = i === linha.falas.length - 1;
      colagensMundo.push({ ...e.spec, inicio: i === 0 ? 0 : f.janela_inicio, fim: ultima ? linha.total : f.janela_fim, sair: ultima });
      for (const el of e.spec.elementos || []) if (el.icone) usados.add(el.icone);
    });
    // a última fala reaproveita a colagem da primeira (loop), desmontando no fim
    if (colagensMundo.length && !especs.find((x) => x.falas.includes(linha.falas.at(-1).id))) {
      const ult = linha.falas.at(-1);
      colagensMundo.push({ ...colagensMundo[0], inicio: ult.janela_inicio, fim: linha.total, sair: true });
    }
  } else {
    for (const e of especs) {
      const fs0 = linha.falas.filter((f) => e.falas.includes(f.id));
      if (!fs0.length) continue;
      const ini = Math.min(...fs0.map((f) => f.janela_inicio ?? f.inicio));
      const fim = Math.max(...fs0.map((f) => f.janela_fim));
      const id = `colagem-${fs0[0].id}`;
      const clip = path.join(ctx.pasta, 'colagem', `${id}.mp4`);
      if (existe(clip)) {
        fs.copyFileSync(clip, path.join(assets, `${id}.mp4`));
        inserts.push({ id, inicio: ini, fim, video: `assets/${id}.mp4` });
      } else {
        inserts.push({ id, inicio: ini, fim, semente: 7 + inserts.length });
        colagensMapa[id] = { ...e.spec, inicio: ini, fim };
        for (const el of e.spec.elementos || []) if (el.icone) usados.add(el.icone);
      }
    }
  }
  const icones = {};
  for (const nome of usados) { const ic = carregarIcone(nome); if (ic) icones[nome] = ic; }

  // estilos e mundos (vídeo híbrido: um mundo por estilo 3D; colagens por cima nos trechos de colagem)
  const segs = segmentosDe(cfg, sb, linha);
  const mundos = mundosDe(segs, estiloColagem);

  // dados embutidos
  ctx.progresso('montagem', 40, 'Escrevendo dados e composições');
  const REEL = { ...linha, paleta, estilo: cfg.estilo, segmentos: segs, mundos, transicao_mundos: cfg.transicao_mundos ?? 0.15, colagens: colagensMapa, colagens_mundo: colagensMundo, icones, storyboard: { ambiente: sb.ambiente || null, ancoras: sb.ancoras || [], biblia: sb.biblia || null } };
  gravarTexto(path.join(assets, 'dados.js'), `// Gerado pelo motor (não edite à mão: rode "rs rodar <id> montagem" de novo)\nwindow.REEL = ${JSON.stringify(REEL)};\n`);

  // composições
  const temLegenda = cfg.legenda !== 'sem';
  gravarTexto(path.join(proj, 'index.html'), gerarIndexComVideos({ linha, inserts, temLegenda, mundos }));
  gravarTexto(path.join(comps, 'overlays.html'), gerarOverlays(linha, paleta, cfg));
  if (temLegenda) gravarTexto(path.join(comps, 'legendas.html'), gerarLegendas(linha, paleta, cfg));
  else { try { fs.rmSync(path.join(comps, 'legendas.html')); } catch {} }
  for (const c of inserts.filter((x) => !x.video)) gravarTexto(path.join(comps, `${c.id}.html`), gerarColagem(c));
  if (!existe(path.join(proj, 'hyperframes.json'))) gravarTexto(path.join(proj, 'hyperframes.json'), JSON.stringify({ name: ctx.id, skill: 'estudio-de-reels' }, null, 2) + '\n');

  // mundos: um arquivo por estilo 3D, do modelo certo (nunca sobrescreve o que o Claude já escreveu)
  const criados = [];
  for (const m of mundos) {
    const arq = path.join(comps, `${m.id}.html`);
    if (existe(arq) && !ctx.config.recriar_mundo) continue;
    let txt = fs.readFileSync(path.join(AQUI, 'modelos', modeloDoMundo(m.estilo)), 'utf8');
    txt = txt.replaceAll('__ESTILO__', String(m.estilo).replace(/^lemo:/, '')).replaceAll('__MUNDO__', m.id);
    gravarTexto(arq, txt);
    criados.push(m.id);
  }

  // lint (não bloqueia aqui; o Claude corrige na checagem)
  ctx.progresso('montagem', 80, 'Lint do HyperFrames');
  const l = hf(['lint', '--json'], { cwd: proj });
  let resumoLint = '';
  try { const j = JSON.parse(l.saida); resumoLint = `${j.errorCount ?? j.errors?.length ?? '?'} erros, ${j.warningCount ?? j.warnings?.length ?? '?'} avisos`; } catch { resumoLint = l.codigo === 0 ? 'ok' : 'falhou (veja hf lint)'; }

  const fmtJ = (js) => js.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(', ');
  const pendentes = mundos.filter((m) => m.estilo !== 'colagem-halftone' && fs.readFileSync(path.join(comps, `${m.id}.html`), 'utf8').includes(MARCA_ESBOCO));
  if (!pendentes.length) return { status: 'concluido', nota: `projeto gerado · ${mundos.length} mundo(s) · lint ${resumoLint}` };
  const lista = pendentes.map((m) => `compositions/${m.id}.html (${m.estilo}${m.base ? ', base: fica por baixo o vídeo todo e abre e fecha o loop' : ''}; aparece em ${fmtJ(m.janelas)}${String(m.estilo).startsWith('lemo:') ? `; leia externos/lemo-opuscar/styles/${m.estilo.slice(5)}/STYLE.md` : ''})`).join('; ');
  return {
    status: 'aguardando_claude',
    instrucoes: `Projeto em videos/${ctx.id}/projeto. ${criados.length ? `Modelos criados: ${criados.join(', ')}.` : 'Mundos já existiam (mantidos).'} Escreva ${pendentes.length > 1 ? 'os mundos' : 'o mundo'} do tema seguindo modulos/montagem/MODULO.md e storyboard.json (remova a linha ${MARCA_ESBOCO} de cada um): ${lista}. Veja quadros com \`node motor/rs.mjs quadros ${ctx.id}\`. Depois: \`node motor/rs.mjs concluir ${ctx.id} montagem\`. Lint: ${resumoLint}.`,
  };
}

function gerarIndexComVideos({ linha, inserts, temLegenda, mundos }) {
  let html = gerarIndex({ linha, colagens: inserts.filter((c) => !c.video), legendas: temLegenda, mundos });
  const videos = inserts.filter((c) => c.video).map((c, i) => `  <video id="${c.id}" class="clip" src="${c.video}" muted playsinline data-start="${c.inicio.toFixed(3)}" data-duration="${(c.fim - c.inicio).toFixed(3)}" data-track-index="${10 + i}" style="position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover;z-index:2"></video>`);
  if (videos.length) html = html.replace('  <div id="overlays"', `${videos.join('\n')}\n  <div id="overlays"`);
  return html;
}

// storyboard.colagens: [{ fala | falas[], fundo, elementos[], acao }]
function normalizarColagens(sb, linha) {
  const lista = Array.isArray(sb.colagens) ? sb.colagens : [];
  return lista.map((c) => ({ falas: c.falas || (c.fala ? [c.fala] : []), spec: { fundo: c.fundo, elementos: c.elementos || [], acao: c.acao || null, metafora: c.metafora || null, falas: c.falas || (c.fala ? [c.fala] : []) } }))
    .filter((c) => c.falas.length);
}

export async function validarConclusao(estagio, ctx) {
  const erros = []; const avisos = [];
  if (estagio === 'storyboard') {
    const arq = path.join(ctx.pasta, 'storyboard.json');
    if (!existe(arq)) return { ok: false, erros: [`Escreva ${arq} (veja modulos/montagem/STORYBOARD.md).`] };
    let sb; try { sb = lerJSON(arq); } catch (e) { return { ok: false, erros: [`storyboard.json inválido: ${e.message}`] }; }
    const r = ctx.roteiro();
    const cfg = ctx.config;
    const linhaSb = lerJSON(path.join(ctx.pasta, 'linha.json'), { falas: [] });
    const planos = new Set((sb.planos || []).map((p) => p.fala));
    for (const f of r.falas) if (!planos.has(f.id)) avisos.push(`Fala ${f.id} sem plano no storyboard.`);
    const comCol = new Set((sb.colagens || []).flatMap((c) => c.falas || (c.fala ? [c.fala] : [])));
    // estilo dinâmico: os segmentos dizem o estilo de cada trecho (e quais falas são colagem)
    const dinamico = cfg.estilo === 'dinamico';
    const segsSb = Array.isArray(sb.segmentos) ? sb.segmentos : [];
    const falasColagemSeg = segsSb.filter((s) => s.estilo === 'colagem-halftone').flatMap((s) => s.falas || []);
    if (dinamico) {
      if (!segsSb.length) erros.push('Estilo dinâmico: escreva storyboard.segmentos (o estilo de cada trecho). Veja "Estilo dinâmico" em modulos/montagem/STORYBOARD.md.');
      else {
        const ordem = r.falas.map((f) => f.id);
        const vistas = segsSb.flatMap((s) => s.falas || []);
        if (vistas.join() !== ordem.join()) erros.push('storyboard.segmentos precisa cobrir todas as falas, cada uma uma vez, na ordem do roteiro.');
        for (const s of segsSb) {
          const nome = `${(s.falas || [])[0] || '?'}–${(s.falas || []).at(-1) || '?'}`;
          if (!s.estilo) erros.push(`Segmento ${nome}: falta "estilo".`);
          else if (!estiloPorId(s.estilo) || s.estilo === 'dinamico') erros.push(`Segmento ${nome}: o estilo "${s.estilo}" não existe (veja "node motor/rs.mjs estilos").`);
          if (!s.motivo) avisos.push(`Segmento ${nome}: diga o "motivo" do estilo (o que ele mostra melhor neste trecho).`);
        }
        const distintos = new Set(segsSb.map((s) => s.estilo));
        if (distintos.size > 3) erros.push(`${distintos.size} estilos no mesmo vídeo: o máximo é 3 (coerência).`);
        if (['ponte-total', 'eco-visual'].includes(cfg.loop) && segsSb[0]?.estilo !== segsSb.at(-1)?.estilo) erros.push('Loop: o último segmento precisa ter o mesmo estilo do primeiro (o fim emenda no começo).');
        const curtos = segsSb.filter((s) => {
          const fs1 = linhaSb.falas.filter((f) => (s.falas || []).includes(f.id));
          return fs1.length && Math.max(...fs1.map((f) => f.janela_fim)) - Math.min(...fs1.map((f) => f.janela_inicio ?? f.inicio)) < 2.5;
        }).length;
        if (curtos) avisos.push(`${curtos} segmento(s) com menos de 2,5 s: troca de estilo rápida demais vira pisca-pisca.`);
      }
    }
    const exigem = cfg.estilo === 'colagem-halftone' ? [r.falas[0].id] : dinamico ? falasColagemSeg : r.falas.filter((f) => f.plano === 'colagem').map((f) => f.id);
    for (const id of exigem) if (!comCol.has(id)) erros.push(`Fala ${id} usa colagem mas não tem entrada em storyboard.colagens.`);
    for (const c of sb.colagens || []) {
      if (!c.fundo) avisos.push(`Colagem ${c.fala || c.falas}: sem "fundo" (cor do campo).`);
      const n = (c.elementos || []).length;
      if (n < 2 || n > 7) avisos.push(`Colagem ${c.fala || c.falas}: ${n} elementos; o ideal é 3 a 6.`);
      for (const el of c.elementos || []) if (!carregarIcone(el.icone)) erros.push(`Ícone "${el.icone}" não existe no Phosphor. Parecidos: ${sugerirIcones(String(el.icone).split('-')[0]).join(', ') || '(nenhum)'}`);
    }
    // bíblia visual (contra o genérico): lugar reconhecível, objetos-herói do tema e texto real em cena
    const b = sb.biblia;
    if (!b) erros.push('Falta storyboard.biblia (lugar, objetos_heroi, pessoas, texto_em_cena): veja "Contra o genérico" em modulos/montagem/STORYBOARD.md.');
    else {
      if (!b.lugar) erros.push('storyboard.biblia.lugar: onde o vídeo acontece (um lugar reconhecível do tema).');
      if (!Array.isArray(b.objetos_heroi) || b.objetos_heroi.length < 3) erros.push('storyboard.biblia.objetos_heroi: pelo menos 3 objetos que só existem neste tema.');
      if (!Array.isArray(b.texto_em_cena) || !b.texto_em_cena.length) erros.push('storyboard.biblia.texto_em_cena: pelo menos 1 texto real dentro do mundo (placa, tela, faixa, manchete, placar).');
    }
    const semCenario = (sb.planos || []).filter((p) => !p.cenario && !falasColagemSeg.includes(p.fala)).length;
    if (cfg.estilo !== 'colagem-halftone' && semCenario) avisos.push(`${semCenario} plano(s) sem "cenario": diga onde cada plano acontece (teste da especificidade).`);
    const cenarios = new Set((sb.planos || []).map((p) => String(p.cenario || '').split(/[(,;:]/)[0].trim().toLowerCase()).filter(Boolean));
    const total = ctx.roteiro().falas.length;
    if (cfg.estilo !== 'colagem-halftone' && total >= 8 && cenarios.size < 3) avisos.push(`Só ${cenarios.size} cenário(s) diferente(s) para ${total} falas: o ideal é pelo menos 3.`);
    if (['ponte-total', 'eco-visual'].includes(cfg.loop) && !(sb.loop && sb.loop.plano_inicial && sb.loop.plano_final)) erros.push('storyboard.loop.plano_inicial e plano_final são obrigatórios (o último plano tem que ser o primeiro).');
    const ancoras = new Set(sb.ancoras || []);
    for (const f of r.falas) for (const rot of f.rotulos || []) if (rot.ancora && !ancoras.has(rot.ancora)) avisos.push(`Rótulo "${rot.texto}" usa a âncora "${rot.ancora}", que não está em storyboard.ancoras.`);
    return { ok: erros.length === 0, erros, avisos };
  }
  if (estagio === 'montagem') {
    const sbM = lerJSON(path.join(ctx.pasta, 'storyboard.json'), {});
    const linhaM = lerJSON(path.join(ctx.pasta, 'linha.json'), null);
    const mundosM = linhaM ? mundosDe(segmentosDe(ctx.config, sbM, linhaM), ctx.config.estilo === 'colagem-halftone') : [{ id: 'mundo', estilo: ctx.config.estilo }];
    for (const m of mundosM) {
      const arq = path.join(ctx.pasta, 'projeto', 'compositions', `${m.id}.html`);
      if (!existe(arq)) { erros.push(`compositions/${m.id}.html não existe. Rode "rs rodar <id> montagem".`); continue; }
      if (m.estilo !== 'colagem-halftone' && fs.readFileSync(arq, 'utf8').includes(MARCA_ESBOCO) && !ctx.config.aceitar_modelo) erros.push(`compositions/${m.id}.html (${m.estilo}) ainda é o modelo (tem ${MARCA_ESBOCO}). Escreva a cena ou rode "rs config <id> --set aceitar_modelo=true".`);
    }
    if (erros.length) return { ok: false, erros, avisos };
    const l = hf(['lint', '--json'], { cwd: path.join(ctx.pasta, 'projeto') });
    try {
      const j = JSON.parse(l.saida);
      const errs = j.errors || (j.findings || []).filter((f) => f.severity === 'error');
      if ((j.errorCount ?? errs?.length ?? 0) > 0) erros.push(`hf lint: ${(errs || []).slice(0, 5).map((e) => e.message || e.rule || JSON.stringify(e)).join(' | ')}`);
    } catch { if (l.codigo !== 0) erros.push(`hf lint falhou: ${(l.erro || l.saida).slice(0, 400)}`); }
    return { ok: erros.length === 0, erros, avisos };
  }
  return { ok: true };
}
