# Estágio: Sua revisão (motor + usuário)

Depois do render, do QA e da revisão do agente, o motor prepara uma **rodada** para o usuário revisar o vídeo pronto, cena a cena (uma cena = uma fala). O vídeo só é entregue quando ele aprovar.

- O motor (`run.mjs`) tira 3 quadros de cada cena do vídeo final e grava `revisao-usuario/rodada-N.json`. Depois para com `aguardando_usuario`.
- O usuário revisa em `http://127.0.0.1:4777/#/v/<id>/revisar`: assiste, marca cada cena como "boa" ou "mudar" (com o tipo de problema e o que quer), deixa um comentário geral e então **aprova** ou **envia os ajustes**. O rascunho fica salvo no servidor (`rascunho-N.json`), então dá para fechar o navegador e continuar depois.
- Pelo chat também vale: "aprovo" → `node motor/rs.mjs aprovar <id> --cenas`; pedidos no chat → grave-os com `rs cenas <id> --ajustes --arquivo <json>` (formato abaixo) antes de corrigir.

## Quando o `auto` para aqui

`parou_em: revisao_usuario` (aguardando o usuário): diga ao usuário que o vídeo está pronto para a revisão dele, com o link `http://127.0.0.1:4777/#/v/<id>/revisar`, rode `node motor/rs.mjs aguardar <id>` em segundo plano e termine o turno. **Nunca aprove por ele.**

O `aguardar` acorda com `"evento":"revisao_usuario"`:
- `decisao: "aprovado"`: a entrega já rodou junto com a aprovação. Relate a entrega (SKILL.md §6).
- `decisao: "ajustes"`: siga "Aplicar os ajustes" abaixo. Se houver um pedido `cenas` na fila (o painel cria um), pegue-o (`rs fila --pegar <pid>`) e feche-o no fim.

## Aplicar os ajustes

1. `node motor/rs.mjs passo <id> "lendo a sua revisão"` e `node motor/rs.mjs cenas <id>`: mostra a última rodada com ajustes, com `pedidos` (cena, `tipos`, `nota`, `instante` em segundos quando ele marcou um momento, e o texto e o visual da cena) e o `geral`.
2. Para cada pedido, olhe a cena: os quadros em `revisao-usuario/rodada-N/quadros/<fala>_1..3.jpg` e, se precisar de um instante exato, `ffmpeg -ss <instante> -i out/render.mp4 -frames:v 1 …`. Corrija **só o que ele pediu**, por `tipos`:

| tipo | por onde começar | onde mexer |
|---|---|---|
| `imagem` | montagem | `storyboard.json` (plano/colagem) e `projeto/compositions/mundo.html` (câmera, objetos, ações). Colagem: `storyboard.colagens` → `rs refazer <id> colagem`. |
| `tela` | montagem | `overlay`/`rotulos` da fala no `roteiro.json` → `rs rodar <id> montagem --forcar` |
| `legenda` | montagem | `destaques` da fala, `config legenda`/`legenda_y` → `rs rodar <id> montagem --forcar` |
| `narracao` | voz | o `texto` (e `fala`) da cena no `roteiro.json`: aqui o texto aprovado **pode** mudar, porque foi o usuário quem pediu. Valide (`rs roteiro <id> --validar`) e `rs refazer <id> voz`. |
| `voz` | voz | o campo `fala` (grafia para a TTS) ou `voz_ajustes` → `rs refazer <id> voz` |
| `audio` | trilha | `sfx` da fala, `config musica_rel`/`musica_abaixa` → `rs refazer <id> trilha` (ou `mixagem`) |
| `ritmo` | montagem | tempos de câmera e de entrada de cartões no mundo; encurtar texto só se ele pediu |

   O `geral` vale para o vídeo todo (música, ritmo geral, tom). Se um pedido for impossível ou contraditório, faça o mais próximo e explique na resposta.
3. Grave o que fez, cena por cena, num JSON e rode `node motor/rs.mjs cenas <id> --responder --arquivo <json>`:
   ```json
   [{ "fala": "f04", "acao": "feito", "como": "o troféu agora fica na mão do piloto" },
    { "fala": "geral", "acao": "parcial", "como": "música 2 dB mais baixa; não troquei a faixa" }]
   ```
   `acao`: `feito` | `parcial` | `nao_feito`. O usuário vê isso na próxima rodada, ao lado do pedido dele, e confere.
4. Reabra a partir do estágio mais cedo que você mexeu (`rs refazer <id> <estagio>`; mudou só o `mundo.html`: `rs refazer <id> checagem`) e siga o SKILL.md §5 até o `auto` parar de novo aqui. Mexeu na voz? O storyboard e o mundo continuam válidos: só confira se os tempos ainda batem e conclua.
5. Na volta, a **revisão do agente é pulada** (os ajustes foram seus; o motor não gasta outra rodada do revisor) e o motor abre a rodada N+1 para o usuário conferir. Feche o pedido `cenas` da fila com `--concluir <pid> --resultado "…"`.

## Formato de `rs cenas <id> --ajustes --arquivo <json>` (pedidos vindos do chat)

```json
{ "pedidos": [{ "fala": "f05", "tipos": ["imagem"], "nota": "o troféu está flutuando", "t": 23.4 }],
  "ok": ["f01", "f02"], "geral": "a música está alta" }
```

## Configuração

Ligada por padrão para todo vídeo. Para desligar: Configurações → Módulos do pipeline ("Sua revisão"), ou só num vídeo com `rs config <id> --set revisao_usuario=nao`.
