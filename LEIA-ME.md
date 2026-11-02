# Estúdio de Reels

Skill do Claude Code que transforma um prompt num reel vertical **cíclico** (o fim emenda no começo), no estilo dos explicadores 3D tipo KnowLab:

**prompt → menu de montagem → roteiro com fontes → você aprova → voz (ElevenLabs) → trilha e efeitos → mixagem cíclica → storyboard → mundo 3D/colagens (HyperFrames + kit + lemo-opuscar + gbro) → checagem → render → QA do loop → entrega**

Ferramentas usadas: [HyperFrames](https://github.com/heygen-com/hyperframes) (render HTML→MP4, fixado em 0.8.223), [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) (66 estilos, DOF físico/GTAO, síntese de trilha e foley), [gbro-collage-broll](https://github.com/pyang5166/gbro-collage-broll) (estética e prompts da colagem halftone; motor Gemini opcional) e a API da ElevenLabs (voz com tempo por caractere, música, efeitos).

## Como usar

- **No chat**: "faz um reel sobre <tema>" ou `/estudio-de-reels <tema>`. O Claude pergunta o menu inteiro, escreve o roteiro e para para você aprovar. Depois disso faz tudo sozinho.
- **No painel** (`http://127.0.0.1:4777`): veja todos os vídeos e o estágio de cada um, leia e aprove roteiros, mude configurações, veja vídeo/áudio/quadros, tokens e custo por vídeo. "Novo vídeo" cria o pedido na fila; diga ao Claude "opera o painel" para ele ficar escutando.
- **Chave da ElevenLabs**: cole em Configurações → Chaves (vai para `.env`), ou mande no chat. Sem chave, tudo funciona offline (voz Kokoro, trilha e efeitos do lemo).

Comandos úteis (na raiz): `node motor/rs.mjs ajuda` · `doctor` · `lista` · `status <id>` · `proximo <id>` · `auto <id>` · `quadros <id>` · `tokens` · `painel`.

## Onde fica cada coisa

```
SKILL.md                 protocolo que o Claude segue
config/menu.json         perguntas do menu de montagem (todas são feitas a cada vídeo)
config/padroes.json      seus padrões (1ª opção de cada pergunta), marca, ajustes de voz
config/pipeline.json     ordem dos estágios, quem executa, módulos ligados/desligados
config/precos.json       preços por milhão de tokens (estimativa de custo)
config/vozes.json        catálogo de vozes (gerado por "rs vozes --atualizar")
motor/rs.mjs             CLI: estado, menu, roteiro, fila, auto, quadros, tokens, painel
motor/lib/               estado, menu, validação do roteiro, linha do tempo, fila, tokens, ElevenLabs
modulos/<nome>/          um módulo por estágio: run.mjs + modulo.json + docs para o Claude
kit/                     biblioteca visual copiada para cada projeto (3D, personagem, câmera, rótulos, colagem,
                         cenarios.js = cenários e objetos do mundo real: Congresso, cidade, urna, placar, celular…)
estilos/                 estilos da casa (diorama-3d, colagem-halftone)
externos/                lemo-opuscar e gbro-collage-broll (clones)
painel/                  servidor (Node, sem dependências) e front
videos/<id>/             tudo de um vídeo: estado.json, roteiro.json/.md, voz/, trilha/, mix/, linha.json,
                         storyboard.json, projeto/ (HyperFrames), quadros/, out/ (MP4 final), revisor/ (pareceres
                         do agente revisor), tokens.json, log.jsonl
biblioteca/sfx/          efeitos gerados uma vez e reaproveitados
dados/                   atividade (para tokens), fila do painel, operador, painel.json
```

## Modularidade: adicionar, tirar ou trocar partes

**Desligar um estágio opcional**: no painel (Configurações → Módulos) ou `"ativo": false` em `config/pipeline.json`.

**Trocar quem faz um estágio**: aponte `"modulo"` do estágio para outra pasta em `modulos/`.

**Criar um módulo novo** (ex.: legendas traduzidas, upload automático):
1. `modulos/<nome>/run.mjs` exportando:
   ```js
   export async function executar(estagio, ctx) {
     // ctx.id, ctx.pasta, ctx.config, ctx.roteiro(), ctx.log(tipo,msg), ctx.progresso(estagio,pct,msg),
     // ctx.arquivo(chave, caminhoRelativo), ctx.elevenlabs({tipo, caracteres}), ctx.recarregar()/ctx.salvar()
     return { status: 'concluido' | 'pulado' | 'aguardando_claude' | 'aguardando_usuario', nota, instrucoes };
   }
   export async function validarConclusao(estagio, ctx) { return { ok: true }; } // opcional (rs concluir)
   ```
2. `modulos/<nome>/modulo.json` descrevendo entradas, saídas e provedores (documentação).
3. Um item em `config/pipeline.json` (`id`, `nome`, `executor`: motor | claude | usuario | motor+claude, `modulo`, `doc`).
4. Se o estágio é do Claude, escreva o `doc` (o que fazer e como concluir). `rs proximo`/`rs auto` passam a mostrá-lo.

**Adicionar uma escolha ao menu**: um objeto em `config/menu.json` (`id`, `lote`, `cabecalho` ≤ 12 letras, `pergunta`, `padrao`, `opcoes` 2–4). O valor chega ao módulo em `ctx.config[id]`. O painel mostra a pergunta sozinho.

**Provedores**:
- Voz (`modulos/voz/run.mjs`): `elevenlabs` e `kokoro`. Novo provedor = função `viaX()` que grave `voz/narracao.wav`, `falas.json`, `palavras.json`, `meta.json`.
- Música (`modulos/trilha/run.mjs`): `elevenlabs`, `lemo-pluck`, arquivo próprio, `sem`. Qualquer WAV passa por `loop.py`.
- Efeitos: `elevenlabs` (cache em `biblioteca/sfx/elevenlabs/`), `lemo-foley`. Novo kit = pasta `biblioteca/sfx/<nome>/<tipo>_<n>.wav`.
- Colagem (`modulos/colagem`): `codigo` (padrão) e `gemini` (gbro original).
- Fonte (`modulos/fonte`): link do YouTube como ponto de partida do roteiro (`rs novo --youtube <link>` ou o campo no painel). O yt-dlp baixa só metadados, capa e legenda; sem legenda, `rs fonte <id> --transcrever` transcreve o áudio com o faster-whisper. Para outra fonte (artigo, PDF), crie um arquivo ao lado com a mesma saída (`fonte/resumo.md` + `fonte/transcricao.txt`).
- Revisor (`modulos/revisor`): depois do QA, um agente revisor independente assiste ao vídeo pronto e grava um parecer. Liga ou desliga pelo menu (`revisor`: corrigir, relatorio, nao); o número de rodadas automáticas fica em `padroes.json → ajustes.revisor_rodadas`. O que ele confere está em `modulos/revisor/REVISOR.md`: edite esse checklist para mudar o critério.

**Estilos**: estilo da casa = pasta `estilos/<id>/` com `STYLE.md` e `estilo.json` (+ `poster.jpg`). Os 66 do lemo já aparecem como `lemo:<pasta>`. O mundo de cada vídeo é escrito pelo Claude a partir do STYLE.md.

**Estilos**: o menu tem `dinamico` (padrão: o Claude escolhe o estilo de cada trecho no storyboard e pode misturar até 3) ou um estilo fixo do catálogo (`node motor/rs.mjs estilos`). Num vídeo híbrido, cada estilo 3D vira um mundo próprio (`compositions/mundo-<estilo>.html`) que aparece só nas janelas dele (`ligarMundo` em `kit/nucleo.js`). Para um estilo novo da casa, crie `estilos/<id>/` com `estilo.json` (`modelo`: diorama, lemo ou colagem) e `STYLE.md`.

**Overlays e legendas**: gerados por `modulos/montagem/gerar.mjs` a partir da linha do tempo; cores em `kit/paletas.json`. Para um estilo de legenda novo, acrescente um caso em `gerarLegendas()` e uma opção em `menu.json → legenda`.

## Custos e tokens

- Cada comando do motor grava `dados/atividade.jsonl` com a sessão do Claude; `motor/lib/tokens.mjs` lê os transcripts em `~/.claude/projects` (incluindo subagentes) e atribui cada resposta ao vídeo e ao estágio em que o Claude estava. Resultado em `videos/<id>/tokens.json` e no painel (Uso e custos).
- O custo em US$ é o equivalente de API (tabela em `config/precos.json`); com assinatura, vale a assinatura, mas os tokens são exatos.
- ElevenLabs: caracteres por chamada ficam em `estado.json → custos.elevenlabs`; o saldo do plano aparece no painel.

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| Tela preta no mundo | Erro de JS no `mundo.html`: rode `hyperframes check` em `videos/<id>/projeto` (aparece em `runtime`). |
| Quadrado escuro no céu | Sprite com AdditiveBlending no pós do lemo: use `criarBrilho()` do kit. |
| Legendas empilhadas | Tempo inválido na linha (já protegido: o gerador recusa NaN). Rode `rs rodar <id> montagem --forcar`. |
| Render lento | Muitos objetos ou sombras: use `grade()`; `qualidade: rascunho` para testar. |
| Sem voz da ElevenLabs | Falta `ELEVENLABS_API_KEY` no `.env` (cai para Kokoro com aviso). |
