# Estágios: Checagem (motor + Claude) e QA do loop (motor)

## Checagem (antes do render)

`node motor/rs.mjs rodar <id> checagem` (ou `auto`) roda o `hyperframes check` (lint, erros de página, layout, contraste, movimento) e tira:
- `quadros/folha.jpg` — um quadro no meio de cada fala;
- `quadros/emenda.jpg` — primeiro quadro × último quadro.

Abra as duas imagens (Read) e confira:

1. **Fala ↔ imagem**: o que cada fala diz está visível no quadro dela (objeto, ação, número).
2. **Zonas**: nada importante atrás do selo/pílula/cartão (topo, ~250–520 px) nem da legenda (~1380–1560 px).
3. **Legenda**: um grupo por vez, sem sobreposição, palavra ativa acesa.
4. **Cartões e etiquetas**: aparecem na fala certa, etiqueta aponta o objeto certo e não sai da tela.
5. **Mundo**: sem tela preta, sem quadrados estranhos, foco no assunto, nada cortado na borda.
6. **Emenda**: último quadro ≈ primeiro (mesma câmera, céu/luz, poses). Se diferir, ajuste o último plano no `mundo.html`.
7. `quadros/check.json`: zero erros (`ok: true`). Avisos de "track too dense" podem ser ignorados.

Corrigiu algo? `node motor/rs.mjs rodar <id> checagem` de novo. Tudo certo: `node motor/rs.mjs concluir <id> checagem`.

## QA do loop (depois do render, automático)

`qa.json` traz: duração real × esperada, áudio presente, **SSIM da emenda** (último × primeiro quadro; ≥ 0,55 esperado no loop visual), loudness integrado (alvo −14 LUFS) e o clipe `out/teste-loop.mp4` (últimos 3 s + primeiros 3 s) para ouvir e ver a emenda. Avisos aparecem no log e no painel; não bloqueiam a entrega, mas reporte-os ao usuário.
