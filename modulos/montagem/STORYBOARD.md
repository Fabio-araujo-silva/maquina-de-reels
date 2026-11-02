# Estágio: Storyboard (executado pelo Claude)

Saída: `videos/<id>/storyboard.json`. Conclusão (com validação): `node motor/rs.mjs concluir <id> storyboard`.

O storyboard transforma o roteiro em **planos**: onde estamos, quem está em cena, para onde a câmera vai em cada fala, quais âncoras as etiquetas usam e como fica cada colagem. Ele é a ponte entre o roteiro e o código do mundo (`compositions/mundo.html`).

Leia antes: `roteiro.json`, `linha.json` (tempos reais de cada fala, já com a voz pronta) e o STYLE.md do estilo do vídeo (`estilos/<estilo>/STYLE.md` ou `externos/lemo-opuscar/styles/<slug>/STYLE.md`). Se o vídeo tem fonte do YouTube, abra também `fonte/capa.jpg`. Veja as peças prontas em `modulos/montagem/exemplos/kit-cenarios.jpg`.

## Formato

```json
{
  "biblia": {
    "lugar": "Praia de Copacabana ao meio-dia: calçadão de ondas pretas e brancas, mar, prédios ao fundo",
    "objetos_heroi": ["guarda-sol listrado", "o Sol (esfera com halo)", "moléculas de N₂ e O₂", "termômetro de rua"],
    "pessoas": [{ "quem": "banhista anônima", "tracos": "cabelo longo castanho, camiseta amarela" }],
    "texto_em_cena": ["placa 'POSTO 5'", "termômetro de rua marcando 31 °C"],
    "referencias": "fotos do calçadão (formas e cores); nada copiado"
  },
  "segmentos": [
    { "falas": ["f01", "f02", "f03"], "estilo": "diorama-3d", "motivo": "a praia e a pessoa: o lugar do mito" },
    { "falas": ["f04", "f05", "f06"], "estilo": "lemo:tilt-shift", "motivo": "o ar visto de cima, como maquete" },
    { "falas": ["f07", "f08"], "estilo": "colagem-halftone", "motivo": "o pôr do sol como virada emocional" },
    { "falas": ["f09", "f10", "f11"], "estilo": "diorama-3d", "motivo": "volta à praia para fechar o loop" }
  ],
  "ambiente": "Praia ao meio-dia: areia clara, mar azul-esverdeado ao fundo, céu em degradê, nuvens macias desfocadas.",
  "elenco": [
    { "id": "pessoa", "descricao": "boneco sem rosto, camiseta amarela, bermuda azul, de costas para a câmera", "pose_padrao": "em_pe" }
  ],
  "objetos": [
    { "id": "sol", "descricao": "esfera emissiva amarela com halo, alto no céu; desce até o horizonte no capítulo PÔR DO SOL" },
    { "id": "moleculas", "descricao": "pares de esferas (N₂ azul-claro, O₂ verde-claro) flutuando no ar" }
  ],
  "ancoras": ["mar", "pessoa", "nitrogenio", "oxigenio"],
  "planos": [
    { "fala": "f01", "cenario": "praia (calçadão + mar)", "camera": "plano médio por trás da pessoa, céu ocupando 2/3; sobe 30 cm", "acao": "pessoa olhando o céu (pose em_pe, cabeça para cima)" },
    { "fala": "f02", "cenario": "praia", "camera": "gira 40° para revelar o sol", "acao": "—" }
  ],
  "colagens": [
    { "fala": "f03", "metafora": "o sol de papel solta uma faixa com todas as cores",
      "fundo": "#f2b134",
      "elementos": [
        { "icone": "sun", "estilo": "halftone", "x": 0.5, "y": 0.36, "escala": 0.42, "entra": "cima", "ordem": 1 },
        { "icone": "rainbow", "estilo": "cartao", "cor": "#ff6b3d", "x": 0.5, "y": 0.6, "escala": 0.55, "entra": "baixo", "ordem": 2 },
        { "icone": "eye", "estilo": "halftone", "x": 0.72, "y": 0.78, "escala": 0.22, "entra": "direita", "ordem": 3 }
      ],
      "acao": { "tipo": "gira", "elemento": 0 } }
  ],
  "loop": {
    "plano_inicial": "f01: câmera em (0.4, 1.5, 3.2) olhando (0, 2.2, -6); pessoa de costas; céu azul",
    "plano_final": "f11 termina EXATAMENTE no plano_inicial: mesma posição, mesmo céu (dia), mesma pose"
  }
}
```

## Estilo dinâmico (o padrão do menu)

Quando o menu diz `dinamico`, **você escolhe o estilo de cada trecho** pelo que ele precisa mostrar, e pode misturar. Escreva `segmentos` (a conclusão do estágio exige): blocos de falas seguidas, cada um com `estilo` e `motivo`. Um segmento só, com todas as falas, também vale quando o tema pede um visual único.

Como escolher:
- Veja o catálogo com `node motor/rs.mjs estilos` (cada estilo do lemo diz para que é bom) e, antes de decidir, leia o STYLE.md e veja o `poster.jpg` dos candidatos.
- Ponto de partida (não é regra): `diorama-3d` para mecanismos, lugares e pessoas em situação (é a espinha da maioria dos vídeos); `colagem-halftone` para história, arquivo, personagens reais, citações e viradas emocionais; do lemo, `tilt-shift` para cidades e escala, `iso-infographic` para sistemas e fluxos, `blueprint` e `teardown` para "por dentro de", `newsreel` e `archive-lighttable` para o passado e documentos, `dataviz` e `data-physical` para números, `satellite-briefing` e `transit-map` para mapas e rotas, `chalkboard` e `whiteboard` para explicação passo a passo.

Regras do híbrido:
- No máximo 3 estilos por vídeo. O do primeiro segmento é a **base**: fica por baixo o vídeo todo, abre e fecha o loop.
- Troque de estilo na virada de capítulo ou num "soco", nunca no meio de uma frase; cada segmento dura pelo menos ~3 s.
- O último segmento tem o mesmo estilo do primeiro (o fim emenda no começo).
- O que unifica os estilos: a paleta, os cartões, a legenda e a bíblia visual (os mesmos objetos-herói e as mesmas pessoas, cada estilo do seu jeito).
- Segmento `colagem-halftone`: as falas dele precisam de entradas em `colagens`.
- Cada estilo 3D vira um mundo próprio na montagem (veja "Vídeo híbrido" em `modulos/montagem/MODULO.md`). Mais estilos = mais mundos para escrever: misture quando o conteúdo ganha com isso, não por enfeite.

## Contra o genérico (obrigatório)

O erro mais comum é o vídeo que poderia ser sobre qualquer assunto: blocos coloridos num chão branco, o mesmo boneco, o mesmo objeto em todo plano, e o tema só nos cartões de texto. Antes dos planos, escreva a **bíblia visual** (`biblia`; a conclusão do estágio exige):
- `lugar`: onde o assunto acontece de verdade (o Congresso, uma rua de Recife, uma sala de aula, um laboratório, um estúdio de YouTube). Use as peças de `kit/cenarios.js` (`predio`, `cidade`, `plenario`, `palanque`, `estudioCriador`…) ou construa o lugar.
- `objetos_heroi` (3 a 5): objetos que SÓ existem neste tema (a urna eletrônica, o placar com os votos reais, o celular com a página do canal, o jornal com a manchete). Nada de blocos abstratos sem rótulo.
- `pessoas`: quem aparece e os traços que identificam (cabelo, barba, óculos, terno, cores, uniforme). Pessoa real nunca é o boneco padrão: confira como ela se apresenta e use `criarPersonagem({ cabelo, barba, oculos, paleto, gravata… })`. Profissão com roupa própria aparece com ela: piloto = `traje:'macacao'` + `acessorio:'capacete'` nas cores da equipe.
- **Kit sempre específico (obrigatório)**: para cada pessoa e objeto-herói, confira se o kit já tem a peça com os traços do tema (`modulos/montagem/MODULO.md`, seção Kit). Não tem? Ela entra no kit antes da montagem (regra completa no MODULO.md). Nunca resolva com o boneco comum ou com caixas soltas.
- `texto_em_cena`: textos REAIS dentro do mundo (placa, tela, faixa, manchete, placar), com nomes e números das `fontes` do roteiro.
- `referencias`: o que você consultou (capa do vídeo-fonte, fotos do lugar, a página do canal) para formas e cores. Nunca copie imagens.

Nos planos:
- **Teste da especificidade**: troque mentalmente o tema do vídeo. Se o plano ainda servisse, ele é genérico: troque o objeto, o lugar ou o texto por algo que só existe neste tema.
- Todo plano 3D diz o seu `cenario`. Chão vazio sem cenário só para um plano de respiro, no máximo 1 a cada 5.
- Pelo menos 3 cenários diferentes num vídeo de 60–90 s e 2 num de 30–45 s.
- O mesmo objeto-herói em no máximo 3 planos (salvo a âncora do loop); varie escala, ângulo e contexto.
- Números viram objetos com rótulo (`placar`, `grafico3d`) ou texto no mundo (tela, placa, faixa), não blocos soltos.
- Metáfora visual com objeto concreto do mundo real (moedas com "R$", a urna, o carimbo, a manchete), não formas abstratas.

## Regras

- **Um plano por fala** (`planos[].fala`). Câmera: diga de onde, para onde e o movimento (aproximar, orbitar, recuar, seguir, corte seco). Varie: plano aberto → médio → detalhe → aberto. Uma ideia = uma imagem.
- **Âncoras**: todo `rotulos[].ancora` do roteiro precisa estar em `ancoras`, e o mundo vai registrar cada uma (`rotulos.ancorar('nome', objeto)`).
- **Colagens** (falas com `plano: "colagem"`; no estilo `colagem-halftone`, uma por fala ou por grupo de falas):
  - 3 a 6 elementos, um só visual por colagem (a metáfora em uma frase).
  - `icone`: nome de um ícone Phosphor (sem "-fill"): veja `node_modules/@phosphor-icons/core/assets/fill/`. Ex.: sun, moon, planet, rainbow, eye, brain, lightbulb, lock, key, shield-check, cpu, wifi-high, bluetooth, globe, user, users, hand-pointing, clock, hourglass, chart-line-up, coins, warning, check-circle, x-circle, chat-circle, megaphone, rocket, atom, flask, dna, leaf, drop, fire, lightning, scales, gavel, house, car, airplane, phone, envelope, camera, puzzle-piece, target, magnifying-glass, fingerprint, robot.
  - `estilo`: `halftone` (recorte de foto P&B em meio-tom) ou `cartao` (cartolina colorida; use `cor`).
  - `x`, `y` (0–1, posição do centro), `escala` (fração da largura), `rot` (graus), `entra` (`cima`/`baixo`/`esquerda`/`direita`/`cresce`), `ordem` (sequência de montagem).
  - `fundo`: cor chapada forte conforme o sentido (laranja/vermelho = urgência; mostarda = alerta/ferramenta; verde-escuro = conhecimento; roxo = memória/regra; azul-petróleo = decisão).
  - `acao` opcional depois de montar: `gira`, `pulsa`, `treme`, `balanca` num elemento.
  - **Sincronia com a fala (use sempre que a frase tiver uma virada):** `gatilho` = palavra da narração em que o elemento entra (ou `em` = segundos desde o início da colagem). Sem os dois, os elementos entram em sequência na primeira metade do trecho, sem relação com o que é dito. `dur` muda a duração da entrada (0,45 s por padrão).
  - `vai: { x, y, gatilho | em, dur, passos }`: o elemento anda até (x, y) nessa palavra, com passinhos (ex.: a torcida indo até o farol em "a Fiel segue").
  - Formas desenhadas, sem ícone: `forma: 'farol'` (torre listrada de papel; `cor` das listras), `forma: 'facho'` (luz amarela saindo da lanterna do farol: `origem` = índice do farol, `rot` em graus, `comprimento`, `abertura`; use `entra: 'acende'`), `forma: 'polaroid'` (foto de papel com `texto` embaixo e `retrato: { pele, cabelo, corCabelo, barba, corBarba, terno, camisa, gravata, fundo }` desenhado dentro: a pessoa real com os traços dela, não um ícone genérico).
  - Mantenha tudo entre o cartão do topo (y > 0,22) e a legenda (y < 0,70); nada pela metade na borda.
- **Loop**: `plano_inicial` e `plano_final` são obrigatórios em `ponte-total`/`eco-visual`. O último plano termina exatamente no primeiro (posição, alvo, fov, luz, poses). Estados que mudaram no meio (pôr do sol, Marte, raio-x) voltam ao estado inicial antes do fim.
- Cada plano deve servir a fala: o que é DITO aparece na tela no momento em que é dito (os tempos estão em `linha.json` → `falas[].palavras`).
