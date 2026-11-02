// Rodadas da "Sua revisão" (revisão do usuário, cena a cena). Funções puras sobre os arquivos,
// usadas pelo módulo (run.mjs), pelo motor (rs cenas / rs aprovar --cenas) e pelo painel.
//
// videos/<id>/revisao-usuario/rodada-N.json   a rodada: cenas (com quadros) + a sua decisão + as respostas do Claude
// videos/<id>/revisao-usuario/rascunho-N.json o que você já marcou e ainda não enviou (o painel grava enquanto você revisa)
// videos/<id>/revisao-usuario/rodada-N/quadros/<fala>_<k>.jpg   3 quadros por cena, do vídeo final
import fs from 'node:fs';
import path from 'node:path';
import { lerJSON, gravarJSON, existe } from '../../motor/lib/util.mjs';

// O que você pode apontar numa cena. "estagio" é por onde o Claude costuma começar a correção.
export const TIPOS = {
  imagem: { rotulo: 'Imagem / cena', estagio: 'montagem', dica: 'cena 3D, câmera, objetos, colagem (storyboard.json / mundo.html)' },
  tela: { rotulo: 'Texto na tela', estagio: 'montagem', dica: 'cartões e etiquetas (overlay/rotulos no roteiro.json, depois rs rodar <id> montagem --forcar)' },
  legenda: { rotulo: 'Legenda', estagio: 'montagem', dica: 'quebra, destaques, posição (roteiro.destaques, config legenda/legenda_y)' },
  narracao: { rotulo: 'Texto da narração', estagio: 'voz', dica: 'muda o texto aprovado: o usuário pediu, então pode; refaz a partir da voz' },
  voz: { rotulo: 'Voz / pronúncia', estagio: 'voz', dica: 'campo "fala" (grafia para a TTS) ou ajustes de voz; refaz a partir da voz' },
  audio: { rotulo: 'Música / efeitos', estagio: 'trilha', dica: 'sfx da fala, volume da música (config musica_rel), mixagem' },
  ritmo: { rotulo: 'Ritmo / duração', estagio: 'montagem', dica: 'tempo de câmera, cortes, quando o cartão entra; texto mais curto só com o pedido do usuário' },
};

export const pastaRevisao = (pasta) => path.join(pasta, 'revisao-usuario');
export const arquivoRodada = (pasta, n) => path.join(pastaRevisao(pasta), `rodada-${n}.json`);
export const arquivoRascunho = (pasta, n) => path.join(pastaRevisao(pasta), `rascunho-${n}.json`);

export function listarRodadas(pasta) {
  const dir = pastaRevisao(pasta);
  if (!existe(dir)) return [];
  return fs.readdirSync(dir).map((f) => f.match(/^rodada-(\d+)\.json$/)).filter(Boolean)
    .map((m) => ({ ...lerJSON(path.join(dir, m[0]), {}), rodada: Number(m[1]) }))
    .sort((a, b) => a.rodada - b.rodada);
}

// A rodada que espera a sua decisão (a última, se ainda não foi aprovada nem teve ajustes pedidos).
export function rodadaAberta(pasta) {
  const u = listarRodadas(pasta).at(-1);
  return u && !u.decisao ? u : null;
}

// A última rodada em que você pediu ajustes (o Claude trabalha nela e grava "respostas").
export function ultimaComAjustes(pasta) {
  return listarRodadas(pasta).filter((r) => r.decisao === 'ajustes').at(-1) || null;
}

export function gravarRodada(pasta, r) {
  const { rodada } = r;
  gravarJSON(arquivoRodada(pasta, rodada), r);
  return r;
}

// Normaliza o que veio do painel (ou do chat) num pedido de ajustes.
export function normalizarDecisao(dados, rodada) {
  const falas = new Set((rodada.cenas || []).map((c) => c.fala));
  const pedidos = [];
  for (const p of [].concat(dados?.pedidos || [])) {
    const fala = String(p.fala || '').trim();
    if (fala !== 'geral' && !falas.has(fala)) continue;
    const tipos = [...new Set([].concat(p.tipos || []).map(String).filter((t) => TIPOS[t]))];
    const nota = String(p.nota || '').trim().slice(0, 2000);
    if (!nota && !tipos.length) continue;
    const t = Number.isFinite(Number(p.t)) && p.t !== null && p.t !== '' ? Math.round(Number(p.t) * 100) / 100 : null;
    pedidos.push({ fala, tipos, nota, t });
  }
  const ok = [...new Set([].concat(dados?.ok || []).map(String).filter((f) => falas.has(f) && !pedidos.some((p) => p.fala === f)))];
  const geral = String(dados?.geral || '').trim().slice(0, 4000);
  return { pedidos, ok, geral };
}

// Resumo de uma rodada para o Claude (rs cenas <id>): o que você pediu, cena por cena.
export function resumoParaClaude(r) {
  if (!r) return null;
  const porFala = Object.fromEntries((r.cenas || []).map((c) => [c.fala, c]));
  return {
    rodada: r.rodada, decisao: r.decisao || null, decidido_em: r.decidido_em || null, via: r.via || null,
    geral: r.geral || '',
    pedidos: (r.pedidos || []).map((p) => {
      const c = porFala[p.fala];
      return {
        fala: p.fala, tipos: p.tipos, nota: p.nota, instante: p.t,
        cena: c ? { inicio: c.inicio, fim: c.fim, texto: c.texto, visual: c.visual, overlay: c.overlay || null } : null,
        por_onde_comecar: [...new Set(p.tipos.map((t) => TIPOS[t]?.estagio).filter(Boolean))],
      };
    }),
    ok: r.ok || [],
    respostas: r.respostas || [],
  };
}
