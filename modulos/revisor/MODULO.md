# Estágio: Revisão do agente (motor + Claude produtor + subagente revisor)

Liga quando o menu diz `revisor = corrigir` (padrão) ou `relatorio`. Com `nao`, o motor pula o estágio.

## Fluxo de uma rodada

1. `node motor/rs.mjs auto <id>` para em `revisao_final` depois do render e do QA. O motor já montou `videos/<id>/revisor/rodada-N/pacote.md` (quadros do vídeo final, folha, emenda, transcrição, medições, rodadas anteriores).
2. Anuncie: `node motor/rs.mjs passo <id> "agente revisor avaliando o vídeo (rodada N)"`.
3. Dispare o revisor com a ferramenta **Agent** (contexto limpo, independente de você):
   - `subagent_type`: `general-purpose`
   - `description`: `Revisar reel <id> rodada N`
   - `prompt`: o conteúdo INTEIRO de `modulos/revisor/REVISOR.md`, seguido de:
     `Pacote: <caminho absoluto do pacote.md>` e `Grave o parecer em: <caminho absoluto de revisor/rodada-N.json>`.
   - Não passe a sua opinião sobre o vídeo nem diga o que você acha que está errado: o valor do revisor é ser independente.
   - Espere a notificação de que o subagente terminou e leia `revisor/rodada-N.json`.
4. Decida pelo modo:
   - **relatorio**: `node motor/rs.mjs concluir <id> revisao_final`. O usuário lê o parecer no painel e, se quiser, pede correções (chega como pedido `corrigir` na fila).
   - **corrigir** com veredito `aprovado`: `node motor/rs.mjs concluir <id> revisao_final` e `rs auto <id>` (entrega).
   - **corrigir** com veredito `corrigir`: aplique as correções (abaixo), registre o que fez no campo `respostas` do `rodada-N.json` e re-renderize. O motor volta a este estágio e monta a rodada N+1 (até `revisor_rodadas`, padrão 2). Se o limite acabar, o motor entrega e lista as pendências.

## Como aplicar cada tipo de correção

Anuncie cada uma com `rs passo` ("corrigindo o gancho", "ajustando a música"…).

| `estagio` do problema | O que mudar | Como refazer |
|---|---|---|
| `montagem` (câmera, objetos, etiquetas, cena) | `videos/<id>/projeto/compositions/mundo.html` (ou `storyboard.json` + mundo) | `rs refazer <id> checagem` e `rs auto <id>`; na checagem, confira os quadros e `rs concluir <id> checagem` |
| overlays/legendas (posição, cartão atrasado, cor) | campos `overlay`/`rotulos`/`destaques` do `roteiro.json` (NUNCA o `texto` aprovado) ou `rs config <id> --set legenda_y=1380` | `rs refazer <id> montagem` e `rs auto <id>` (o mundo é mantido) |
| `mixagem` (níveis) | `rs config <id> --set musica_rel=-6` (música sem fala, LU relativa à voz; ou `musica_abaixa`, `musica_bolsao`, `lufs`) | `rs refazer <id> mixagem`, `rs auto <id>`; quando parar no storyboard já feito: `rs concluir <id> storyboard` |
| `voz` (pronúncia) | campo `fala` da fala (como se pronuncia; a legenda continua o `texto`) | `rs refazer <id> voz`, `rs auto <id>` (conclua storyboard e checagem quando parar) |
| `trilha` (música/efeitos) | `rs config <id> --set musica_prompt="…"` ou o campo `sfx` da fala | `rs refazer <id> trilha`, `rs auto <id>` |
| `roteiro` / `sugestao_usuario` (texto da narração) | **não mude sozinho**: o texto foi aprovado | responda com `"acao": "para_usuario"`; o painel mostra para o usuário decidir |

Formato de `respostas` (no próprio `rodada-N.json`): `[{ "id": "p1", "acao": "corrigido" | "ignorado" | "para_usuario", "como": "o que foi feito ou por que não" }]`. Ignore só problema que você consiga justificar (ex.: escolha de estilo do usuário). Para gravar, leia o JSON, acrescente `respostas` e grave de volta preservando todo o resto, inclusive o campo `usuario` que o painel escreve.

O motor só deixa concluir no modo `corrigir` quando cada problema alto ou médio tem resposta `ignorado` ou `para_usuario`; problema `corrigido` exige re-render (e uma nova rodada).

## Pedido `corrigir` vindo do painel

O usuário marcou problemas de um parecer e pediu correção: `payload.rodada`, `payload.problemas` (ids) e `payload.notas`. O painel já gravou a decisão no campo `usuario` do parecer. Aplique só esses problemas (pela tabela), anote em `respostas` e re-renderize com `rs refazer` + `rs auto`. O motor monta uma rodada de conferência mesmo que o limite de rodadas já tenha sido atingido: dispare o revisor de novo e conclua conforme o modo. No fim, conte ao usuário o que mudou. Sugestões de texto (`sugestao_usuario`) que o usuário marcou: aí sim mude o `texto` da fala, porque foi ele quem pediu, e refaça a partir da voz.
