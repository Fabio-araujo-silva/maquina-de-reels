# Estágio: Roteiro (executado pelo Claude)

Saída: `videos/<id>/roteiro.json`. Validação: `node motor/rs.mjs roteiro <id> --validar`. Publicação para revisão: `node motor/rs.mjs roteiro <id> --publicar` (gera `roteiro.md` e abre o estágio de revisão).

Leia antes: `modulos/roteiro/estrutura-referencia.md` (o vídeo de referência medido batida a batida) e a `config` do vídeo (`rs status <id>`): `duracao`, `arquetipo`, `tom`, `loop`, `cta`, `broll`, `estilo`.

Anuncie cada passo no painel, para o usuário saber o que está acontecendo: `node motor/rs.mjs passo <id> "pesquisando fontes"`, depois `"escrevendo o roteiro"` e `"validando"`.

## 0. Fonte do YouTube (quando o usuário mandou um link)

Se `rs status <id>` mostrar `fonte` (ou existir `videos/<id>/fonte/`), o reel é sobre o assunto daquele vídeo:
1. `rs passo <id> "lendo o vídeo do YouTube"`. Leia `fonte/resumo.md` e a transcrição inteira em `fonte/transcricao.txt` (as marcas `[mm:ss]` mostram onde cada trecho está). Sem legenda: `node motor/rs.mjs fonte <id> --transcrever` antes; legenda automática ruim (palavras sem sentido): `--whisper`.
2. Abra `fonte/capa.jpg` com Read: ela diz o lugar, as pessoas e os objetos que o público associa ao tema. Anote isso no campo `visual` das falas para a montagem ficar específica (sem copiar a imagem).
3. Liste as afirmações centrais do vídeo e **confira cada número, data e nome em fontes independentes** (seção 1). O vídeo é uma fonte, não a verdade: se ele defende uma posição, trate como posição de quem fala ("segundo o canal X…").
4. Escreva com as suas palavras e na estrutura cíclica da skill; não copie frases nem a ordem do vídeo. O prompt do usuário, se houver, define o ângulo.
5. Cite o vídeo em `fontes` (título, canal e link). Nunca use áudio, imagens ou trechos do vídeo original no reel.

## 1. Pesquisa e fatos (antes de escrever)

- Todo número, data e afirmação técnica precisa de fonte verificável. Pesquise (WebSearch) e anote em `fontes`.
- Prefira fontes primárias (órgão oficial, artigo, documentação, NASA/IBGE/TSE…). Na dúvida entre dois números, use o mais conservador e diga "mais de" / "cerca de".
- Não invente estatística. Se não há número confiável, a fala não leva número.
- Números na fala: escreva como se diz (`"fala": "quinhentas mil"`) quando a TTS pode errar; o `texto` (legenda) pode ter algarismos.

## 2. A estrutura (por arquétipo)

**mito-mecanismo** (padrão, a da referência):
1. `gancho` (0–3 s): consequência absurda, mito invertido ou número gigante. Máx. 12 palavras. Nada de "você sabia".
2. `soco` opcional que reforça a escala (2–5 palavras).
3. `pergunta` que abre a curiosidade até ~8 s ("Sabe por quê?", "Então de onde vem isso?").
4. 2–4 `mecanismo`, cada um fechando a objeção seguinte; ligue-os com `escada` ("E mesmo com X, não adianta.").
5. `soco`s de pergunta-resposta curtos espalhados ("Programa alterado? Ela não funciona.").
6. `comparacao` com 2–3 números concretos (um cartão por número).
7. `objecao` → `prova` ("E quem duvida pode testar…").
8. `callback` à cena de abertura (sensorial: um som, um gesto, um objeto).
9. `cta` (de acordo com o menu).
10. `ponte`: a ÚLTIMA fala, aberta, que a primeira completa (ver §3).

**por-dentro**: gancho com o objeto comum → "o que acontece lá dentro?" → peças na ordem do fluxo (cada uma um capítulo) → o detalhe que ninguém vê (soco) → callback ao uso cotidiano → cta → ponte.
**escala**: gancho com um número absurdo → comparação concreta 1 → maior → maior (cada degrau um cartão) → revelação → cta → ponte.
**virada**: crença comum dita como verdade → "só que não" no 1º terço → explicação → consequência → cta → ponte.

Ritmo: ~2,75 palavras/s (o validador estima a duração). Frases de até 16 palavras (máx. 18). Nova imagem a cada 2–4 s; novo capítulo a cada 8–15 s. Tom conforme o menu (`tom`).

## 3. O loop (o mais importante)

O vídeo é cíclico: **o fim emenda no começo**. Três camadas:

- **Texto (frase-ponte)**: a última fala termina ABERTA (`:`, `,`, `…` ou sem ponto) e a PRIMEIRA fala a completa. Teste lendo em voz alta "última + primeira": tem que soar como uma frase só. A primeira fala também precisa funcionar sozinha, para quem chega do zero.
  - Bons padrões de ponte: "…então, da próxima vez que alguém disser que X, lembra:" → [gancho] · "…e é exatamente por isso que" → [gancho como consequência] · "…porque, no fundo," → [gancho].
  - O CTA vem ANTES da ponte, nunca depois.
- **Imagem (eco visual)**: o último plano termina no plano de abertura (mesma câmera, mesmo estado da cena). Descreva em `loop.ancora_visual`; o storyboard repete isso em `loop.plano_inicial`/`plano_final`.
- **Som**: o motor já faz a trilha em loop perfeito e soma as caudas de forma circular. Você só garante que a última fala não termina num tom de "fim" (ponto final, "valeu", "tchau").

Tipos do menu: `ponte-total` (as três camadas — padrão), `frase-ponte` (só texto), `eco-visual` (só imagem), `pergunta-eco` (a última fala é a pergunta do gancho e o vídeo recomeça respondendo).

## 4. Elementos visuais por fala

- `visual`: o que se vê, em uma frase concreta (objeto, ação, câmera). Pense no estilo escolhido (`estilo`).
- `plano`: `3d` (mundo do estilo), `colagem` (insert de colagem gbro, só em frases abstratas, 1–3 no vídeo se `broll` = abstratas; nenhum se `nunca`; alternado por capítulo se `alternado`), `texto` (só tipografia).
- `overlay` (no máx. 1 por fala, ~1 a cada 2–3 falas):
  - `numero`: `{ "tipo":"numero", "rotulo":"URNAS NO BRASIL (2026)", "valor":"+500 MIL", "cor":"laranja", "gatilho":"500" }` — `gatilho` é a palavra em que o cartão aparece.
  - `manchete`: `{ "tipo":"manchete", "rotulo":"PROGRAMA ALTERADO", "valor":"URNA TRAVA", "cor":"laranja" }` (valor até 22 caracteres).
  - `negacao`: `{ "tipo":"negacao", "rotulo":"A URNA NÃO TEM", "itens":["Wi-Fi","Bluetooth","Cabo"] }` — cada item aparece quando é dito.
  - `lista`: `{ "tipo":"lista", "itens":["partidos","polícia federal","universidades"] }`.
  - `cta`: `{ "tipo":"cta", "rotulo":"MANDA PRA QUEM AINDA", "valor":"DESCONFIA DA URNA", "cor":"verde" }`.
  - Cores: `laranja`, `verde`, `vermelho`, `azul`, `amarelo`, `roxo` (da paleta).
- `rotulos`: etiquetas presas a objetos da cena com linha guia: `[{ "texto":"chip de segurança", "ancora":"chip", "cor":"azul", "gatilho":"chip" }]`. A âncora é um nome que o storyboard declara e o mundo registra.
- `destaques`: palavras que acendem na cor de destaque na legenda (1–2 por fala, só as que importam).
- `sfx`: efeito extra opcional na fala (`whoosh`, `pop`, `tick`, `nega`, `impacto`, `riser`, `clique`, `papel`). Os básicos (capítulo, cartões, itens) o motor já coloca sozinho.

## 5. Formato do roteiro.json

```json
{
  "titulo": "Por que o céu é azul",
  "tema": "CÉU AZUL",
  "promessa": "Explicar o espalhamento de Rayleigh com uma imagem só",
  "publico": "curiosos de ciência, 16–35",
  "arquetipo": "mito-mecanismo",
  "loop": {
    "tipo": "ponte-total",
    "frase_final": "Então, da próxima vez que alguém disser que é o reflexo do oceano, lembra:",
    "frase_inicial": "O céu não é azul por causa do mar.",
    "como_emenda": "A ponte termina em 'lembra:' e o vídeo recomeça com o gancho, que vira a resposta.",
    "ancora_visual": "Plano médio da pessoa na praia olhando o céu azul — abre e fecha o vídeo."
  },
  "capitulos": [ { "id": "c1", "rotulo": "MITO", "resumo": "o erro comum" } ],
  "falas": [
    { "id": "f01", "capitulo": "c1", "funcao": "gancho", "texto": "O céu não é azul por causa do mar.",
      "visual": "Pessoa de costas na praia olhando o céu; mar ao fundo.", "plano": "3d", "destaques": ["mar"] }
  ],
  "cta": { "tipo": "compartilhar", "texto": "Manda pra quem ainda acha que é o mar." },
  "fontes": [ { "afirmacao": "o azul espalha ~6× mais que o vermelho (λ⁻⁴)", "fonte": "Britannica, Rayleigh scattering", "url": "https://www.britannica.com/science/Rayleigh-scattering" } ]
}
```

Campos de cada fala: `id`, `capitulo`, `funcao`, `texto` (legenda), `fala` (opcional: como pronunciar), `visual`, `plano`, `overlay?`, `rotulos?`, `destaques?`, `sfx?`.

## 6. Checklist antes de publicar

- [ ] O gancho funciona sem som (o cartão/imagem conta a história) e com som.
- [ ] Há uma pergunta aberta até ~8 s.
- [ ] Cada mecanismo fecha uma objeção; nenhuma fala é "enchimento".
- [ ] Cada número tem fonte em `fontes`.
- [ ] "última fala + primeira fala" soa como uma frase só (leia em voz alta).
- [ ] O CTA vem antes da ponte e combina com o menu (`cta`).
- [ ] `rs roteiro <id> --validar` sem erros (avisos: avalie).

Depois de publicar, mostre ao usuário o `roteiro.md` resumido (título, duração, falas, a emenda do loop) e siga o SKILL.md (revisão).
Se o usuário pediu ajustes (`rs proximo` mostra as notas), reescreva só o necessário, valide e publique de novo.
