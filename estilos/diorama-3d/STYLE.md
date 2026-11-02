# Diorama 3D — estilo da casa (referência: KnowLab)

Explicador em 3D claro e limpo, como uma maquete fotografada de perto: bonecos sem rosto, objetos feitos de primitivas arredondadas, luz de dia difusa, fundo desfocado. Overlays escuros e precisos por cima (selo mono, pílula de capítulo, cartões de número, etiquetas com linha). Narração firme, ~2,8 palavras/s.

## 1. Essência
- Um mundo **concreto** (sala de aula, praia, laboratório, rua) onde a ideia acontece com objetos reais simplificados. Nada de abstração solta: a ideia vira um objeto que faz alguma coisa.
- **O objeto é a explicação**: abrir (raio-x), multiplicar (grade até o horizonte), comparar (lado a lado), acompanhar um caminho (câmera seguindo).
- O que é dito aparece **na palavra** em que é dito (use `quando('fXX','palavra')`).

## 2. Materiais e luz
- Primitivas com cantos arredondados (`caixa(..., {raio})`), plástico fosco (`mat.plastico`, roughness ~0,45), madeira com veio (`mat.madeira`), metal pintado verde nas pernas de mesa/cadeira.
- Piso terrazzo claro; parede bege com lambri de madeira; quadro-negro verde quando for escola.
- Luz: sol de dia (2,6) + hemisférica (1,15) + ambiente de sala (0,35). Sombras suaves; `sombraContato` sob personagens e móveis.
- Pós-processamento `lemo` (padrão): desfoque físico forte no fundo (abertura 55–80), GTAO leve, bloom sutil, vinheta 0,22.
- Brilhos (sol, telas, partículas): `criarBrilho` ou materiais `toneMapped:false`. **Nunca** sprite com AdditiveBlending (vira um quadrado escuro no DOF do lemo).

## 3. Cor (paleta `clara-neutra`)
Céu `#a9c6e3 → #dfe9f2`, chão `#ece6dc`, madeira `#c9965d`, metal `#2f6b4f`, objetos brancos `#f4f2ee`. Acentos só nos overlays e em 1 objeto-herói por cena: laranja `#ff8a1f` (número/alerta), verde `#22c55e` (ok/CTA), vermelho `#ff4d4d` (perigo/tempo), azul `#3b82f6` (técnico).

## 4. Personagens
Bonecos sem rosto (`criarPersonagem`), cabeça lisa, roupa de uma cor, sapato branco. Um protagonista recorrente (o "hacker de gorro", o "eleitor") dá continuidade. Poses legíveis de longe: digitando, apontando, braços cruzados, segurando, sentado. Microvida sempre (`.vida(t)`), olhar para o objeto (`.olhar`).

## 5. Câmera (vertical 9:16)
- Assunto no terço central; topo (250–520 px) é dos cartões, base (1350–1550 px) é da legenda.
- Planos: médio com movimento lento → macro no detalhe → órbita curta (20–40°) → recuo e subida para escala → corte seco na troca de fala.
- Nunca mais de 6 s sem mudança. Fov 30–36.
- **Loop**: o último plano termina no primeiro (mesma câmera, mesmo estado).

## 6. Movimentos nativos (cardápio)
- **Escala absurda**: um objeto vira centenas com `grade()` + `revelarGrade()` enquanto a câmera recua e sobe.
- **Raio-x**: `raioX(obj, true)` revela o miolo (placa de circuito, engrenagens); etiqueta aponta a peça.
- **Negação**: cartões riscados (overlay `negacao`) enquanto o objeto aparece sem a peça.
- **Linha do tempo física**: calendários virando (`calendario(n => …)`), relógios.
- **Comparação**: dois/três objetos lado a lado com bandeiras ou placas.
- **Mergulho**: aproximar até um detalhe minúsculo (moléculas, chip, célula).

## 7. Som
Pulso leve de marimba/pizzicato (~105 BPM), constante, sem intro nem final (o loop exige). Efeitos: whoosh na troca de capítulo, pop nos cartões, tick nos itens de lista, nega nos itens riscados, impacto no CTA.

## 8. Armadilhas
- Cena escura ou sem foco: confira `palco.foco` (o alvo do plano é o ponto focado).
- Texto 3D pequeno ilegível: use `telaCanvas` grande e perto, ou deixe o texto para os overlays.
- Muitos objetos: use `grade` (instâncias), não clones.
- Etiqueta saindo da tela: âncora fora do enquadramento no tempo da etiqueta.
