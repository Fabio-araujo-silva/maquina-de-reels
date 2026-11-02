---
name: estudio-de-reels
description: Transforma um prompt num reel vertical CÍCLICO (o fim emenda no começo) no estilo dos explicadores 3D tipo KnowLab — roteiro com fontes → o usuário aprova → voz ElevenLabs com tempo por palavra → motion no HyperFrames (mundo 3D, overlays, legenda karaokê, colagens gbro-collage-broll, estilos do lemo-opuscar) → render e QA do loop, com painel web local para acompanhar. Use quando o usuário pedir "faz um vídeo/reel/short sobre X", "roteiro de reel", "vídeo explicativo estilo KnowLab", "/estudio-de-reels", "continua o vídeo <id>", "opera o painel"/"escuta o painel", quando mandar um link do YouTube pedindo um vídeo sobre o assunto, ou quando chegar a chave da ElevenLabs para a skill. NÃO use para cortar/editar vídeos gravados (silenciador-de-videos) nem para baixar vídeos (tiktok-download).
---

# Estúdio de Reels

Raiz da skill: a pasta deste SKILL.md (o repositório clonado). Todo `rs …` abaixo é `node motor/rs.mjs …` rodado na raiz (de outra pasta, `node <raiz>/motor/rs.mjs …` funciona igual). Caminhos como `videos/<id>/roteiro.json` são relativos à raiz: ao escrever com Write, use o caminho absoluto.
Painel: `http://127.0.0.1:4777` (vídeos, estágios, roteiro, aprovação, configuração, custos e tokens por vídeo).

Fluxo: **prompt → menu de montagem (sempre perguntado) → roteiro → APROVAÇÃO DO USUÁRIO → produção 100% autônoma (com o agente revisor) → REVISÃO DO USUÁRIO, CENA A CENA → entrega**.

## 0. Ao iniciar (toda vez)

1. `node motor/rs.mjs doctor` — se algo crítico falhar, corrija (`npm install` na raiz; `.venv` Python) antes de seguir.
2. `node motor/rs.mjs painel` — sobe o painel (se já estiver no ar, só confirma). Diga a URL ao usuário uma vez.
3. Descubra o caso: vídeo novo (há um tema no pedido) · continuar (`rs lista`, `rs proximo <id>`) · operar o painel (§7) · chave chegou (§8).

## 1. Vídeo novo

`node motor/rs.mjs novo "<prompt do usuário>" --titulo "<2–4 palavras>"` → devolve o `id` (ex.: `2026-11-02-ceu-azul`).

Se o usuário mandar um **link do YouTube** ("faz um reel sobre este vídeo"), acrescente `--youtube <link>` (o prompt fica opcional e vira o ângulo). O motor lê só os metadados, a capa e a legenda e grava em `videos/<id>/fonte/`; o roteiro parte dali (seção 0 de `modulos/roteiro/MODULO.md`). Sem legenda: `rs fonte <id> --transcrever`.

## 2. Menu de montagem — pergunte SEMPRE, inteiro

1. `node motor/rs.mjs menu <id> --perguntas` → JSON com `lotes` (hoje 5 lotes de até 4 perguntas).
2. Para CADA lote, chame **AskUserQuestion** com `questions` = o array `lotes[i].questions` exatamente como veio. O padrão do usuário já é a primeira opção, marcado "(padrão)". Uma chamada por lote (hoje são 5).
3. Junte as respostas de todas as chamadas num objeto só (as chaves são o texto de cada pergunta, como o AskUserQuestion devolve) e grave: `node motor/rs.mjs menu <id> --responder '<json>'`. Também aceita chaves pelo `id` do menu (`lotes[i].ids`), e valores como rótulo, valor ou o texto livre do "Other". Para JSON grande ou com aspas, grave num arquivo e use `--arquivo <caminho>`.
   - "usa os padrões"/"tanto faz" → `--padrao`. "salva como padrão" → acrescente `--salvar-padrao`.
4. Mostre os `avisos` que voltarem (ex.: sem chave da ElevenLabs → voz Kokoro offline).
- Exceção: vídeo criado pelo painel já chega com o menu respondido (o estágio `menu` está concluído) — não pergunte de novo.

## 3. Roteiro

Siga `modulos/roteiro/MODULO.md` (e a análise da referência em `modulos/roteiro/estrutura-referencia.md`):
pesquise os fatos (WebSearch), escreva `videos/<id>/roteiro.json`, rode `node motor/rs.mjs roteiro <id> --validar` até `ok:true`, depois `node motor/rs.mjs roteiro <id> --publicar`.
O loop é obrigatório: a última fala termina aberta e a primeira a completa; o CTA vem antes da ponte.

## 4. Revisão — o usuário verifica o roteiro

1. Mostre no chat, compacto: título · duração estimada · falas numeradas por capítulo (texto + o que aparece) · a emenda do loop ("…última fala" → "primeira fala") · nº de fontes · link `http://127.0.0.1:4777/#/v/<id>`.
2. Rode em **segundo plano** (`run_in_background`): `node motor/rs.mjs aguardar <id>` — ele acorda você se o usuário aprovar ou pedir ajustes pelo painel.
3. Termine o turno perguntando: "Aprova? Responda aqui ou clique em Aprovar no painel."
- Aprovou no chat → `node motor/rs.mjs aprovar <id>`. Pediu mudanças → `node motor/rs.mjs ajustes <id> --notas "<o que pediu>"`, reescreva, valide, publique e volte ao passo 1.
- Se o `aguardar` voltar com `"evento":"revisao"`: `aprovado` → siga para §5; `ajustes` → reescreva com as `notas`.

## 5. Produção — 100% autônoma depois da aprovação (não pergunte nada)

**Anuncie o que está fazendo** em todo estágio seu (roteiro, storyboard, montagem, checagem): `node motor/rs.mjs passo <id> "pesquisando fontes"`, depois `"escrevendo o roteiro"`, `"validando"`, `"escrevendo a cena 3D"`, `"conferindo os quadros"`… O painel mostra o passo ao vivo com o tempo; sem isso, o usuário vê só "Claude trabalhando" e, depois de 10 min sem comandos, "Parado".

Repita `node motor/rs.mjs auto <id>` até `concluido:true`. Ele roda sozinho voz → trilha → mixagem → colagem → render → QA → revisão do agente → entrega e PARA quando um estágio é seu:

| Parou em | O que você faz |
|---|---|
| `storyboard` | Escreva `videos/<id>/storyboard.json` seguindo `modulos/montagem/STORYBOARD.md`, começando pela **bíblia visual** (lugar reconhecível, objetos-herói do tema, pessoas com os traços delas, texto real em cena: nada de blocos num chão vazio). Com estilo `dinamico` (o padrão), escolha você o estilo de cada trecho em `segmentos` e misture até 3 quando o conteúdo pedir (seção "Estilo dinâmico" do STORYBOARD.md). Veja as peças prontas em `modulos/montagem/exemplos/kit-cenarios.jpg`. Depois `node motor/rs.mjs concluir <id> storyboard`. |
| `montagem` (aguardando o Claude) | Escreva cada mundo listado nas instruções (`compositions/mundo.html` e, num vídeo híbrido, os `mundo-<estilo>.html`; veja "Vídeo híbrido" no MODULO.md). Base: `videos/<id>/projeto/compositions/mundo.html` seguindo `modulos/montagem/MODULO.md` + o STYLE.md do estilo (`estilos/<id>/STYLE.md` ou `externos/lemo-opuscar/styles/<slug>/STYLE.md`). Exemplo completo: `modulos/montagem/exemplos/ceu-azul-mundo.html`. Olhe com `node motor/rs.mjs quadros <id>` (abra o `.jpg` com Read), corrija, e `node motor/rs.mjs concluir <id> montagem`. |
| `checagem` | Abra `videos/<id>/quadros/folha.jpg` (um quadro por fala) e `quadros/emenda.jpg` (último × primeiro: devem ser quase iguais). Corrija o que estiver errado e rode `node motor/rs.mjs rodar <id> checagem`; quando estiver bom, `node motor/rs.mjs concluir <id> checagem`. Critérios em `modulos/qa/MODULO.md`. |
| `render` aguardando o usuário | Só se o menu pediu prévia: mostre `quadros/folha.jpg`, pergunte, e com o ok rode `node motor/rs.mjs aprovar <id> --previa`. |
| `revisao_final` (aguardando o Claude) | Dispare o **agente revisor**: um subagente independente (ferramenta Agent, `general-purpose`) com o briefing inteiro de `modulos/revisor/REVISOR.md` + o `pacote.md` da rodada, sem dar a sua opinião. Ele grava `videos/<id>/revisor/rodada-N.json`. Modo `corrigir` com veredito `corrigir`: corrija pela tabela de `modulos/revisor/MODULO.md`, anote em `respostas` e re-renderize (o motor volta aqui para a rodada seguinte, até `revisor_rodadas`). Veredito `aprovado`, ou modo `relatorio`: `node motor/rs.mjs concluir <id> revisao_final`. Texto aprovado da narração nunca muda sem o usuário. |
| `revisao_usuario` (aguardando o usuário) | **Sua revisão**: o motor já separou as cenas do vídeo final. Diga ao usuário que é a vez dele, com o link `http://127.0.0.1:4777/#/v/<id>/revisar` (lá ele assiste, marca cada cena como boa ou pede uma mudança, e aprova ou envia os ajustes), rode `node motor/rs.mjs aguardar <id>` em segundo plano e termine o turno. **Nunca aprove por ele.** Aprovou no chat: `node motor/rs.mjs aprovar <id> --cenas` (a entrega roda junto). |
| `revisao_usuario` (aguardando o Claude) | O usuário pediu ajustes cena a cena: siga `modulos/revisao-usuario/MODULO.md` (`rs cenas <id>` mostra os pedidos; corrija só o que ele marcou, responda com `rs cenas <id> --responder`, `rs refazer <id> <estagio>` e §5). Na volta o agente revisor é pulado e uma rodada nova abre para ele conferir. Pedido de mudança na narração vindo dele vale: aí o texto aprovado pode mudar. |

- O render leva minutos: rode `node motor/rs.mjs auto <id>` em segundo plano e espere a notificação. O progresso aparece no painel.
- Erro em um estágio: `node motor/rs.mjs status <id>` e `videos/<id>/log.jsonl`; corrija a causa e `node motor/rs.mjs rodar <id> <estagio>`. Para refazer a partir de um ponto: `rs refazer <id> <estagio>`.
- Não edite `overlays.html`, `legendas.html` ou `colagem-*.html` à mão: mude roteiro/storyboard/config e rode `rs rodar <id> montagem --forcar`.

## 6. Entrega

A entrega acontece quando o usuário aprova na revisão dele (painel ou `rs aprovar <id> --cenas`); o `aguardar` acorda com `"evento":"revisao_usuario","decisao":"aprovado"`. Relate em poucas linhas: arquivo `videos/<id>/out/<id>.mp4` · duração · emenda do loop (SSIM em `qa.json`) e loudness · veredito do agente revisor (nota, o que foi corrigido, pendências) · tokens e custo equivalente (`tokens.json`) · caracteres da ElevenLabs · link do painel. Mencione o teste da emenda (`out/teste-loop.mp4`).

## 7. Operar o painel (fila)

Quando o usuário pedir "opera/escuta o painel" (ou houver pedidos em `rs fila`):
1. Rode em segundo plano: `node motor/rs.mjs fila --aguardar`.
2. Ao acordar, para cada pedido pendente: `node motor/rs.mjs fila --pegar <pid>`, execute e feche com `--concluir <pid> --resultado "…"` (ou `--erro <pid> --msg "…"`):
   - `novo`: o vídeo já existe com a config do painel (e, se o usuário colou um link do YouTube, com a fonte em `fonte/`) → faça §3 e §4 (o painel aprova; você fica com `aguardar` em segundo plano).
   - `ajustes`: reescreva o roteiro com as notas, valide e publique.
   - `trocar-config`: `rs refazer <id> <payload.refazer_desde>` e continue §5.
   - `rerender`: `rs refazer <id> render` e `rs auto <id>`. `regenerar-voz`: `rs refazer <id> voz` e §5.
   - `refazer-estagio`: `rs refazer <id> <payload.estagio>` e §5. `mensagem`: leia e responda/aja. `cancelar`: pare o vídeo.
   - `corrigir`: o usuário marcou problemas de um parecer do agente revisor (`payload.rodada`, `payload.problemas`, `payload.notas`). Corrija só esses, seguindo "Pedido `corrigir` vindo do painel" em `modulos/revisor/MODULO.md`.
   - `cenas`: o usuário enviou a revisão dele cena a cena com ajustes (`payload.rodada`, `payload.cenas`). Siga `modulos/revisao-usuario/MODULO.md` ("Aplicar os ajustes") e feche o pedido quando o `auto` parar de novo em `revisao_usuario` (rodada nova esperando ele).
3. Volte a armar `node motor/rs.mjs fila --aguardar` em segundo plano.

## 8. Chaves

- ElevenLabs: o usuário pode colar no painel (Configurações) ou no chat. No chat, grave no `.env` da raiz como `ELEVENLABS_API_KEY=<valor>` sem repetir o valor na resposta; depois `node motor/rs.mjs vozes --atualizar` e mostre as vozes pt-BR encontradas (as favoritas viram opções do menu).
- Voz e ajustes: o usuário configura no painel (Configurações → Voz, Marca, Áudio, Legenda e render). Voz pt-BR nativa sai do **Voice Design** (Configurações → Voz → "Criar voz brasileira": 3 prévias, ele escolhe, a voz entra na conta e vira o padrão). Não escolha voz por ele; use o padrão salvo.
- Chave restrita: uma chave da ElevenLabs sem `voices_read`/`user_read` ainda gera voz, música, efeitos e Voice Design. Sem `voices_read`, `rs vozes` usa as vozes padrão verificadas (Brian, Sarah, Liam, Jessica, Eric, Laura); para sotaque nativo brasileiro, adicione uma voz pt-BR da Voice Library à conta e informe o `voice_id` (menu → Other). Sem `user_read`, o painel não mostra o saldo do plano, mas os créditos gastos por vídeo continuam registrados (cabeçalho `character-cost`). Se música ou efeitos forem recusados por permissão, o motor cai sozinho para o lemo-opuscar e avisa no log.
- Gemini (opcional, só para a colagem "gbro original"): `GEMINI_API_KEY` no `.env`.
- Nunca imprima, registre em log ou envie chaves para outro lugar.

## Regras

- O menu é perguntado inteiro em todo vídeo novo (exceto os criados pelo painel).
- Nada é produzido antes da aprovação explícita do roteiro. Depois dela, não pergunte: decida e siga (salvo `previa = sim`).
- Nada é entregue antes da aprovação do usuário na revisão cena a cena (estágio "Sua revisão"; desligável em Configurações → Módulos do pipeline).
- Todo número tem fonte em `fontes`. Sem fonte, sem número.
- Kit sempre específico (obrigatório): se o tema pede gente ou objeto que o kit não tem (piloto com capacete, carro de F1, astronauta, médico…), crie no kit (`kit/personagem.js`, `kit/cenarios.js`) como peça reutilizável antes de montar; nada de boneco genérico. Regra completa em `modulos/montagem/MODULO.md`.
- Custo: uma chamada de TTS por vídeo (o roteiro inteiro); o kit de efeitos da ElevenLabs é gerado uma vez e reaproveitado; a música é uma geração por vídeo.
- Não faça commits no repositório sem o usuário pedir.
- Modo API (sem Claude Code): `rs agente <id>` e `rs agente --fila` rodam este mesmo fluxo com o modelo de `config/executor.json` (Configurações → Modelo no painel). Veja o README.

## Mapa

`motor/rs.mjs` (CLI e estado) · `config/` (menu, pipeline, padrões, preços, vozes) · `modulos/<estágio>/` (cada um com `run.mjs`, docs e `modulo.json`) · `kit/` (3D, personagem, câmera, rótulos, colagem — copiado para cada projeto) · `estilos/` (estilos da casa) · `externos/` (lemo-opuscar, gbro-collage-broll) · `painel/` (servidor + front) · `videos/<id>/` (tudo de cada vídeo). Como adicionar/trocar módulos: `LEIA-ME.md`.
