# Estágio: Montagem (motor + Claude)

1. `node motor/rs.mjs auto <id>` (ou `rodar <id> montagem`) gera o projeto HyperFrames em `videos/<id>/projeto/`:
   - `index.html` (raiz 1080×1920, `mix.wav`, camadas: mundo → colagens → overlays → legendas)
   - `compositions/overlays.html` e `compositions/legendas.html` — **automáticos** (não edite; mude roteiro/config e rode de novo)
   - `compositions/colagem-<fala>.html` — automáticos, a partir de `storyboard.colagens`
   - `compositions/mundo.html` — **você escreve** (o motor cria um modelo que já funciona e nunca o sobrescreve)
   - `assets/dados.js` (`window.REEL`: falas com tempos, palavras, capítulos, overlays, rótulos, paleta), `assets/kit/`, `assets/lib/`, `assets/lemo/`, `assets/mix.wav`
2. Você escreve o mundo do tema seguindo `storyboard.json` e o STYLE.md do estilo, remove a linha `ESBOCO_MUNDO`, olha quadros com `node motor/rs.mjs quadros <id>` (ou `--at 1.0,5.2`) e conclui com `node motor/rs.mjs concluir <id> montagem` (roda o lint).

## Contrato do HyperFrames (não negociável)

- Tudo que aparece é **função do tempo**: `render(t)` desenha o quadro de `t` sem depender do quadro anterior. Nada de `Date.now()`, `Math.random()` sem semente (`mulberry32`), `requestAnimationFrame`, timers ou física acumulada.
- O tempo do evento `hf-seek` é **global** (segundos do vídeo). `window.REEL` usa os mesmos tempos.
- O fim do script registra uma timeline vazia: `window.__timelines['mundo'] = gsap.timeline({ paused: true });` (evita espera de 45 s).
- Imports por importmap: `three`, `three/addons/...`, `kit/...`, `lemo/...`.
- Nada de rede: texturas são desenhadas em canvas; ícones já vêm em `REEL.icones`.

## Kit (assets/kit) — referência rápida

**nucleo.js**: `clamp, lerp, seg(t,a,b), suave, ease.{linear,i,o,io,io2,expo,back,elastico,mola}, mulberry32(seed), hash, ruido1(t,s), trilha([{t,v,e}]), janelaVisivel(t,ini,fim,ent,sai), passo(t,qps)`; linha do tempo: `fala(id)`, `janela(id)` → `{ini,fim,falaIni,falaFim}`, `falaEm(t)`, `capituloEm(t)`, `palavraEm(t)`, `quando(falaId,'trecho')` (tempo em que a palavra é dita).

**palco.js**: `criarPalco({canvas, paleta, pos:'lemo'|'bokeh'|'nenhum', ao, sombras, ceu:[cores]|false, nevoa, fov})` → `{scene, camera, renderer, sol, hemi, foco(dist,abertura,max), focarEm(ponto), sombraEm(centro,raio), renderizar()}`. Pós `lemo` = DOF físico + GTAO + bloom + vinheta do lemo-opuscar (abertura padrão 55; maior = mais desfoque). `criarPiso(palco,{terrazzo,cor})`, `criarNuvens(palco)`, `sombraContato(obj,{raio,opacidade})`, `texturaGradiente(cores)`, `texturaTerrazzo`, `texturaMadeira`.
Trocar o céu no tempo: `scene.background = texturaGradiente([...])` só quando mudar (guarde a última); ou crie as texturas uma vez e alterne.

**formas.js**: materiais `mat.{fosco,plastico,metal,emissivo,raioX,madeira}`; primitivas `caixa(l,a,p,{raio,cor})`, `cilindro`, `esfera`, `capsula`, `tubo(pontos,raio)`; texto/telas `telaCanvas(l,a,desenhar(g,w,h,t))` (chame `.userData.atualizar(t, chave)`), `placaTexto(txt)`; cenário `mesa()`, `cadeira()`, `parede({lambri})`, `quadroNegro(desenhar)`, `bandeira(desenhar)` (`.userData.tremular(t)`), `calendario(numeroFn)`, `placaCircuito()`, `botao(rotulo)`; massa `grade(obj,{nx,nz,dx,dz})` + `revelarGrade(inst,fração)`; `raioX(obj, ligado)` (filhos com `userData.miolo` ficam opacos); `sombrear(obj)`.

**personagem.js**: `criarPersonagem({pele,roupa,calca,sapato,cabelo:'curto'|'coque'|'longo'|'raspado'|'black'|'careca'|'lateral',corCabelo,barba:'cheia'|'curta'|'cavanhaque'|'bigode',corBarba,oculos:true|'redondo'|'sol',paleto,camisa,gravata,acessorio:'gorro'|'bone'|'mochila'|null,escala,semente})` (os traços identificam uma pessoa real: o estilo não tem rosto) → `{grupo, partes, pose(nome|obj), misturar(a,b,x), andar(fase), vida(t), olhar(alvo,força), mao('D'|'E'), prender(obj,'D')}`. Poses: `em_pe, digitando, apontando, segurando, bracos_cruzados, maos_na_cintura, pensando, acenando, comemorando, sentado, sentado_digitando, duvida`. `sequenciaPoses([{t,pose}],dur)` → função de t; `caminhar(pontos[[x,z]], t, t0, t1)` → `{pos, rumo, fase}` (use `grupo.position.set(...pos); grupo.rotation.y = rumo; p.andar(fase)`).
Uniformes: `traje:'macacao'` (peça única em `corTraje`, faixas em `corFaixa` no peito, braços e pernas, gola, `numero`/`corNumero` no peito e nas costas, `luvas`, `botas`) e `acessorio:'capacete'` (casco em `corAcessorio`, coroa e faixa em `corCapaceteFaixa`, `viseira`; esconde cabelo, barba e óculos) fazem um piloto de verdade. Soltos: `criarCapacete({cor, corFaixa, viseira, escala})` (ex.: piloto no cockpit) e `placaNumero(txt, {fundo, cor, l, a})`. Futebol: `traje:'futebol'` (camisa em `corTraje` com `listras:{tipo:'vertical'|'horizontal'|'faixa', cores, n}`, `corCalcao`, `corMeiao`, `corGola`, `numero`/`corNumero` nas costas e no peito, manga curta, chuteira em `botas`). Ex.: Corinthians `{corTraje:'#fff', corCalcao:'#111', corMeiao:'#111', corNumero:'#111'}`; São Paulo `listras:{tipo:'faixa', cores:['#c8102e','#fff','#111']}`; Flamengo `listras:{tipo:'horizontal', cores:['#c8102e','#111']}`.

**camera.js**: `planos([{ini,fim,de:{pos,alvo,fov},para:{...},ease,foco:{abertura,maximo,ponto},tremor}])` → `.aplicar(t, palco)`; tipos `orbita` e `seguir`; atalhos `mov.aproximar(alvo,{ini,fim,azimute,elevacao,dist:[d0,d1]})`, `mov.revelar(alvo,{ini,fim,de,para})`, `mov.orbita(centro,{ini,fim,raio,altura,ang:[g0,g1]})`, `mov.fixo(pos,alvo,{ini,fim,tremor})`.

**cenarios.js** (o mundo real, contra o genérico). Toda peça tem `userData.enquadramentos`; `enquadrar(peça, nome)` devolve `{pos, alvo, fov}` em coordenadas do mundo, pronto para `planos([{ ini, fim, de: enquadrar(urna, 'geral'), para: enquadrar(urna, 'tela') }])`, já calculado para o vídeo vertical.
- `predio(tipo, {nome, cor, altura})`: `congresso` (Brasília: torres, cúpula do Senado, cuia da Câmara, rampa, espelho d'água; enquadramentos `geral`, `torres`, `cupulas`), `classico` (tribunal/banco/museu com `nome` na fachada), `casa`, `torre`, `fabrica`, `hospital`, `escola`, `igreja`, `residencial`.
- `cidade({quadrasX, quadrasZ, quadra, rua, alturas, semente})`: quadras com prédios com janelas, ruas com faixa, calçadas e árvores; `userData.predios` para animar; enquadramentos `geral` (aéreo) e `rua`.
- `urnaEletronica({cargo, numero, nome, partido})`: a urna brasileira (tela de votação + teclado com BRANCO/CORRIGE/CONFIRMA); `userData.estado({digitos, fim})` digita o número ou mostra FIM; enquadramentos `geral`, `tela`, `teclado`.
- `placar({titulo, linhas:[{nome, valor, cor}], porcentagem, sufixo})`: painel de resultados; `userData.revelar(x)` cresce as barras.
- `grafico3d({valores, rotulos, cores, formatar})`: barras com valor e rótulo; `userData.crescer(x)`.
- `celular({app:'youtube'|'instagram'|'whatsapp'|'tiktok'|'noticia'|'banco', dados, escala})`: a tela de verdade do app (canal com inscritos e títulos reais, perfil, conversa, post, notícia, extrato). Tamanho real (8 cm): para um celular "gigante", `escala: 10–15`.
- `jornal({nome, manchete, subtitulo, data})`: jornal com manchete (deite com `rotation.x = -Math.PI / 2`).
- `multidao({n, largura, profundidade, olharPara})`: gente variada (pele, cabelo, roupa, altura, pose); enquadramentos `geral` (de frente) e `costas`.
- `estudioCriador({canal, inscritos, corLed})`: estúdio de youtuber (letreiro neon com o nome do canal, LED, estante, mesa, monitor, microfone, ring light, câmera); sente a pessoa em `userData.lugar` com a pose `sentado`; enquadramentos `geral`, `pessoa`, `ombro`, `letreiro`.
- `palanque({faixa, cores})`: comício com púlpito, microfone, faixa e bandeiras; `userData.lugar`; enquadramentos `geral`, `orador`.
- `plenario({fileiras, porFileira, cor, painel})`: Câmara, Senado ou assembleia em semicírculo; enquadramentos `geral`, `mesa`.
- `carroF1({cor, corDetalhe, numero, corNumero, capacete, corCapaceteFaixa, corPneu, faixaPneu, escala})`: Fórmula 1 em proporção real (~5 m, frente para +X) com bico, sidepods, halo, asas, pneus com faixa e o piloto de capacete no cockpit (`capacete: null` = sem piloto); `userData.gira(t, vel)` gira as rodas; enquadramentos `geral`, `cockpit`.
- `podio({alturas, cor, corNumero, largura})`: pódio 2-1-3 com os números; `userData.lugares[1|2|3]` = topo de cada degrau (para pôr os pilotos).
- `trofeu({cor, base, escala})`: taça metálica com alças (origem na base).
- `estadio({nome, comprimento, largura, cor, corAssento, telao(g,w,h,t), placar(g,w,h,t), telaoTam:[l,a], placarTam:[l,a]})`: gramado listrado com marcações, arquibancada em 3 lados, refletores, letreiro, telão e placar desenhados no tempo (`userData.telao/placar.userData.atualizar(t, chave)`, `userData.fundoZ`); enquadramentos `geral`, `telao`, `placar`, `gramado`. Em vídeo vertical, use telão "em pé" (`telaoTam: [3.4, 3.8]`).
- `bola({raio})`, `gol({largura, altura, profundidade})` (boca para +Z).
- `quadroInvestigacao({itens:[{tipo:'foto'|'recorte'|'nota', titulo, texto, x, y, l, a, rot, cor, desenho(c,x,y,w,h)}], ligacoes:[[i,j]], largura, altura})`: quadro de cortiça com alfinetes e fios vermelhos; `userData.mostrarItem(i, x)`, `userData.revelarFio(k, x)`, `userData.pino(i)`.
- `termometro({rotulo, altura, cor, max})`: `userData.nivel(pct)` (líquido + visor com o número).
- `contrato({titulo, clausula, assinatura, largura, altura})`: pergaminho que desenrola (`userData.abrir(x)`) e cláusula que acende (`userData.destacar(x)`).
- `porco({cor, camisa, escala, triste})`: mascote (ex.: Palmeiras de camisa verde); `userData.chorar(t)` anima lágrimas, soluço e poça.
- `multidao({…, cores})`: `cores` força a paleta das roupas (torcida com as cores do time).
- Aviação:
  - `jatoExecutivo({cor, corFaixa, matricula, escala})`: jato de cauda em T com motores traseiros, nariz para +X; `userData.luzes(t)` pisca as luzes de navegação. Com `escala: 0.09`, vira miniatura que voa sobre um mapa.
  - `perfilAsa({corda, cor, corGelo, linhas})`: corte da asa (perfil NACA extrudado) num túnel de vento; `userData.gelo(x)` faz a crosta crescer no bordo de ataque (0–1), `userData.vento(t, descolado)` desenha as linhas de vento (0 = coladas, 1 = descoladas em redemoinho, o estol). Use uma asa mais escura que o gelo, senão a crosta some.
  - `mapaRota({largura, altura, desenhar(c,w,h), rota:[[u,v]…], corRota})`: mapa em diorama desenhado por você, com rota; `userData.revelar(x)` desenha a rota (0–1), `userData.pontoRota(x)` dá a posição ao longo dela, `userData.paraMundo(u,v)` converte coordenadas do mapa. Nome de cidade perto da borda sai cortado pelo próprio mapa: escreva para dentro (`alinhar: 'right'` ou acima do ponto) e fora da linha da rota.
  - `nuvemTempestade({escala})`: célula de tempestade escura; `userData.raios(t)` faz os raios piscarem.
  - `marcadorEvidencia(n, {escala})`: cone amarelo numerado de perícia, para destroços numa mesa de investigação.
  - `painelAviao({largura, altura, numeros})`: altímetro de ponteiro, caixa de velocidade e luz de emergência; `userData.estado(t, {altitude, velocidade, excesso, emergencia})`. Sem fonte para altitude e velocidade, use `numeros: false`: o painel mostra "ALTÍMETRO" e "VELOCIDADE: NORMAL/EXCESSO" (o ponteiro ainda gira) em vez de números inventados.
- `escrever(g, texto, x, y, opts)` e `paragrafo(g, texto, x, y, largura, opts)`: texto em canvas para as suas próprias telas e placas.
Todas renderizadas em `modulos/montagem/exemplos/kit-cenarios.jpg` (abra com Read); código de uso em `modulos/montagem/exemplos/vitrine-cenarios.html`.

**rotulos.js**: `criarRotulos(tela.parentElement, palco)` → `.ancorar('nome', objeto|Vector3|fn(t), offset)`, `.doRoteiro()` (lê `REEL.rotulos`), `.adicionar({texto,ancora,cor,inicio,fim,estilo:'nega'})`, `.atualizar(t)` (chame no render, depois da câmera).

**colagem.js**: `criarColagem(canvas, spec)` → `.desenhar(t)` (usado pelas colagens; útil também para telas dentro do 3D).

## Vídeo híbrido (vários estilos no mesmo vídeo)

Com estilo `dinamico`, cada estilo 3D dos `segmentos` do storyboard vira um mundo: `compositions/mundo.html` é a **base** (o estilo do primeiro segmento; fica por baixo o vídeo todo) e cada outro estilo ganha `compositions/mundo-<estilo>.html` (ex.: `mundo-tilt-shift.html`), criado do modelo certo (diorama, lemo ou colagem). Os segmentos de colagem são as composições de colagem de sempre, por cima.
- `REEL.mundos` lista cada mundo com as suas janelas de tempo; as instruções do motor dizem quais arquivos escrever e quando cada um aparece.
- Cada mundo é um mundo completo (palco, câmera, objetos próprios), mas só precisa de planos nas suas janelas. O mundo base também aparece durante as transições.
- A última linha do modelo, `ligarMundo('<id>', tela, render)`, mostra o canvas só nas janelas do mundo e pula o render quando ele não é visto. **Não troque por um `addEventListener` próprio.**
- Transição padrão: 0,15 s de fusão (`rs config <id> --set transicao_mundos=0` para corte seco). Para uma transição própria (cortina, zoom), use `presencaMundo('<id>', t)` (0 a 1) dentro do `render`.
- Mundo do lemo: leia `externos/lemo-opuscar/styles/<estilo>/STYLE.md` e use `lemo/post.js` como o estilo pede. O kit (`cenarios.js`, personagem, câmera) funciona em qualquer mundo.
- Mantenha a bíblia visual nos dois mundos: o mesmo objeto-herói reaparece no outro estilo (ex.: o Congresso em diorama e depois como maquete tilt-shift).

## Como escrever o mundo (receita)

1. **Ambiente** (seção 1): o `lugar` da bíblia visual do storyboard (peças de `cenarios.js` ou construído), com céu, piso e fundo do tema. Nunca só o chão vazio.
2. **Elenco e objetos** (seção 2): os `objetos_heroi` e as `pessoas` da bíblia (proporção real, cantos arredondados, cores da paleta); números em `placar`/`grafico3d`; textos reais em telas e placas (`texto_em_cena`). Registre as âncoras do storyboard. Faltou alguma peça no kit? Veja a regra abaixo.

**Kit sempre específico (obrigatório).** Quando o tema pede uma pessoa ou um objeto que o kit não tem (piloto de F1 com capacete e macacão, carro de corrida, astronauta, médico de jaleco, bombeiro, avião, foguete…), crie no kit ANTES de montar a cena: parâmetro novo em `criarPersonagem` (traje, acessório, uniforme) ou peça nova em `kit/cenarios.js`/`kit/formas.js`, com cores, números e textos parametrizáveis; anote aqui na referência do kit; copie o arquivo para `projeto/assets/kit/` (ou rode `rs rodar <id> montagem --forcar`) e só então use no mundo. Boneco de roupa comum fazendo papel de piloto, carro feito de caixas soltas e afins são proibidos: cada peça nova deixa o próximo vídeo menos genérico.

3. **Planos** (seção 3): uma entrada por fala usando os tempos de `REEL.falas` (`janela_inicio`/`janela_fim` cobrem tudo sem buracos). O **último plano termina no primeiro** (loop).
4. **Ações** (seção 4): estado da cena como função de t (poses, objetos aparecendo, raio-x, céu mudando). Use `seg()`/`ease` com os tempos das palavras (`quando('f05','seis')`) para a imagem chegar junto com a palavra.
5. `render(t)`: aplicar câmera → atualizar objetos → `rotulos.atualizar(t)` → `palco.renderizar()`.

Gramática de câmera que funciona em vertical: gancho em plano médio com um movimento lento; detalhe (macro) em mecanismos; órbita curta (20–40°) para mostrar volume; recuo + subida para escala; corte seco a cada fala ou a cada 2–4 s; nunca mais de 6 s parado. Mantenha o assunto no terço central (as faixas de cima e de baixo têm overlays e legenda).

Foco: em close de objeto pequeno (câmera a menos de ~1,2 m), use `palco.foco(distancia, 4, 3)`; a abertura padrão (55) borra tudo de perto (telas e textos ficam ilegíveis).

Desempenho: cada quadro precisa ficar abaixo de ~150 ms. Evite milhares de objetos (use `grade`), sombras 2048 são suficientes, redesenhe telas de canvas só quando o conteúdo muda (`atualizar(t, chave)`).

## Checklist (antes de concluir)

- [ ] `rs quadros <id>`: um quadro por fala; o que a fala diz está na tela; nada importante atrás do cartão (topo) ou da legenda (embaixo).
- [ ] Teste da especificidade: cada quadro da folha só poderia ser deste vídeo (lugar, objeto-herói ou texto real visível). Se algum serviria para outro tema, troque.
- [ ] Último quadro ≈ primeiro (`rs quadros <id> --at 0.04,<total-0.04>`).
- [ ] Etiquetas apontam para o objeto certo e não saem da tela.
- [ ] Sem `Math.random()`/`Date.now()`; nenhum erro no console (o lint e o snapshot avisam).
- [ ] `node motor/rs.mjs concluir <id> montagem` passa.
