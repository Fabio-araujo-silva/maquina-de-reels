# Colagem halftone — estilo da casa (gbro-collage-broll, em código)

Colagem editorial de papel: campo de cor chapado e forte, recortes de "foto" em meio-tom preto e branco, cartolinas coloridas, contorno creme, sombra física suave, grão de papel. Cada ideia é **montada do zero** em stop-motion (12 qps): peças entram deslizando, encaixam e param.

Pode ser o estilo principal (todas as falas são colagens) ou inserts no meio de outro estilo (falas com `plano: "colagem"`).

## Regras (herdadas do gbro)
- **Uma ideia por colagem**, dita em uma frase (`metafora`). 3 a 6 peças grandes e separáveis; muitas peças enfraquecem o sentido.
- Campo de cor forte e uniforme, escolhido pelo sentido: laranja/vermelho (tempo, urgência), mostarda (ferramenta, alerta), verde-escuro (conhecimento), roxo (memória, regra), azul-petróleo (decisão, colaboração). Varie a cor entre colagens do mesmo vídeo, mantendo a linguagem.
- Peças principais em meio-tom P&B (`estilo: "halftone"`); cartolina colorida (`estilo: "cartao"`, `cor`) só onde a hierarquia pede.
- Montagem: estrutura primeiro → personagem/cartão → conexões → ação → resultado (`ordem`). Entradas por `cima`/`baixo`/`esquerda`/`direita`/`cresce`.
- Sem texto, letras, números, logos ou UI dentro da colagem (o texto vive nos overlays e na legenda).
- Ação final opcional (`gira`, `pulsa`, `treme`, `balanca`) em uma peça.

## Loop
No estilo principal, a última colagem é a primeira e termina **desmontando** (as peças saem em ordem inversa) até o campo vazio — que é exatamente o primeiro quadro do vídeo.

## Motor
- `codigo` (padrão, grátis): `kit/colagem.js`, ícones Phosphor (fill) como recortes.
- `gemini` (gbro original, opcional): still por modelo de imagem do Gemini + vídeo de montagem pelo Gemini Omni Flash, com os prompts e scripts do gbro (`modulos/colagem/gemini.py`). Exige `GEMINI_API_KEY` e custa por clipe.
