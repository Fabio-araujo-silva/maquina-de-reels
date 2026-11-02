"""Alinha as palavras do roteiro ao áudio com faster-whisper (tempos por palavra).

Uso:
  python alinhar.py --audio narracao.wav --falas falas_alinhar.json --saida palavras.json [--modelo small]
  python alinhar.py --audio narracao.mp3 --verificar texto.txt --saida verificacao.json   (só confere a pronúncia)

falas_alinhar.json = [{"id", "inicio", "fim", "falado": ["palavras", "faladas"], "legenda": ["palavras", "da", "legenda"]}]
  inicio/fim são opcionais (quando a síntese foi por fala, ajudam a prender as palavras dentro da fala).
Saída: [{"texto", "inicio", "fim", "fala"}] em unidades de palavra da LEGENDA.
"""
import argparse, difflib, json, re, sys, unicodedata


# números por extenso (o Whisper costuma escrever em algarismos: "quinhentas" → "500")
NUMEROS = set("""zero dois duas tres quatro cinco seis sete oito nove dez onze doze treze catorze quatorze quinze
dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta sessenta setenta oitenta noventa cem cento
duzentos duzentas trezentos trezentas quatrocentos quatrocentas quinhentos quinhentas seiscentos seiscentas
setecentos setecentas oitocentos oitocentas novecentos novecentas mil milhao milhoes bilhao bilhoes""".split())


def norm(w: str) -> str:
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", w)


def transcrever(audio, modelo):
    from faster_whisper import WhisperModel
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(audio, language="pt", word_timestamps=True, vad_filter=False,
                           beam_size=5, condition_on_previous_text=False)
    out = []
    for s in segs:
        for w in (s.words or []):
            n = norm(w.word)
            if n:
                out.append({"n": n, "w": w.word.strip(), "ini": float(w.start), "fim": float(w.end)})
    return out


def alinhar_seq(esperadas, reconhecidas):
    """DP de edição entre listas de palavras normalizadas; devolve mapa idx_esperada -> idx_reconhecida."""
    n, m = len(esperadas), len(reconhecidas)
    INF = 10 ** 9
    custo = [[INF] * (m + 1) for _ in range(n + 1)]
    volta = [[None] * (m + 1) for _ in range(n + 1)]
    custo[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            c = custo[i][j]
            if c >= INF:
                continue
            if i < n and j < m:
                sim = difflib.SequenceMatcher(None, esperadas[i], reconhecidas[j]).ratio()
                sub = 0 if sim >= 0.999 else (0.6 if sim >= 0.6 else 2.0)
                if c + sub < custo[i + 1][j + 1]:
                    custo[i + 1][j + 1] = c + sub
                    volta[i + 1][j + 1] = (i, j, "m" if sim >= 0.6 else "s")
            if i < n and c + 1 < custo[i + 1][j]:
                custo[i + 1][j] = c + 1
                volta[i + 1][j] = (i, j, "d")
            if j < m and c + 1 < custo[i][j + 1]:
                custo[i][j + 1] = c + 1
                volta[i][j + 1] = (i, j, "i")
    mapa = {}
    i, j = n, m
    while (i, j) != (0, 0) and volta[i][j] is not None:
        pi, pj, op = volta[i][j]
        if op == "m":
            mapa[pi] = pj
        i, j = pi, pj
    return mapa


def interpolar(itens, ini_lim, fim_lim):
    """Preenche inicio/fim que faltam proporcionalmente ao tamanho das palavras."""
    n = len(itens)
    k = 0
    while k < n:
        if itens[k]["inicio"] is not None:
            k += 1
            continue
        j = k
        while j < n and itens[j]["inicio"] is None:
            j += 1
        a = itens[k - 1]["fim"] if k > 0 else ini_lim
        b = itens[j]["inicio"] if j < n else fim_lim
        if b is None or a is None or b < a:
            b = (a or 0) + 0.25 * (j - k)
        pesos = [max(1, len(norm(itens[x]["texto"]))) for x in range(k, j)]
        tot = float(sum(pesos))
        t = a
        for x, p in zip(range(k, j), pesos):
            d = (b - a) * p / tot
            itens[x]["inicio"], itens[x]["fim"] = round(t, 4), round(t + d, 4)
            t += d
        k = j
    return itens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--falas")
    ap.add_argument("--verificar")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--modelo", default="small")
    a = ap.parse_args()

    rec = transcrever(a.audio, a.modelo)

    if a.verificar:
        esperado = [norm(w) for w in open(a.verificar, encoding="utf-8").read().split() if norm(w)]
        mapa = alinhar_seq(esperado, [r["n"] for r in rec])
        tem_digito = any(re.search(r"[0-9]", r["n"]) for r in rec)
        faltando = [w for i, w in enumerate(esperado) if i not in mapa and not (tem_digito and w in NUMEROS)]
        acerto = 1 - len(faltando) / max(1, len(esperado))
        json.dump({"acerto": round(acerto, 4), "palavras": len(esperado), "reconhecidas": len(rec),
                   "nao_reconhecidas": faltando[:60], "transcricao": " ".join(r["w"] for r in rec)},
                  open(a.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(json.dumps({"ok": True, "acerto": round(acerto, 4)}))
        return

    falas = json.load(open(a.falas, encoding="utf-8"))
    esperadas, origem = [], []
    for fi, f in enumerate(falas):
        for wi, w in enumerate(f["falado"]):
            if norm(w):
                esperadas.append(norm(w))
                origem.append((fi, wi))
    mapa = alinhar_seq(esperadas, [r["n"] for r in rec])

    saida = []
    for fi, f in enumerate(falas):
        faladas = [{"texto": w, "inicio": None, "fim": None} for w in f["falado"]]
        for k, (ofi, owi) in enumerate(origem):
            if ofi == fi and k in mapa:
                r = rec[mapa[k]]
                ini, fim = r["ini"], r["fim"]
                if f.get("inicio") is not None:
                    ini = max(ini, f["inicio"]); fim = min(max(fim, ini + 0.05), f["fim"])
                faladas[owi]["inicio"], faladas[owi]["fim"] = round(ini, 4), round(fim, 4)
        ini_f = f.get("inicio")
        fim_f = f.get("fim")
        if ini_f is None:
            conhecidos = [x for x in faladas if x["inicio"] is not None]
            ini_f = conhecidos[0]["inicio"] if conhecidos else (saida[-1]["fim"] if saida else 0.0)
            fim_f = conhecidos[-1]["fim"] if conhecidos else ini_f + 0.35 * len(faladas)
        faladas = interpolar(faladas, ini_f, fim_f)
        # palavras da legenda: 1:1 se iguais, senão proporcional dentro da fala
        legenda = f["legenda"]
        if [norm(w) for w in legenda] == [norm(w) for w in f["falado"]]:
            for w, x in zip(legenda, faladas):
                saida.append({"texto": w, "inicio": x["inicio"], "fim": x["fim"], "fala": f["id"]})
        else:
            a0 = faladas[0]["inicio"] if faladas else ini_f
            b0 = faladas[-1]["fim"] if faladas else fim_f
            pesos = [max(1, len(norm(w))) for w in legenda]
            tot = float(sum(pesos)) or 1.0
            t = a0
            for w, p in zip(legenda, pesos):
                d = (b0 - a0) * p / tot
                saida.append({"texto": w, "inicio": round(t, 4), "fim": round(t + d, 4), "fala": f["id"]})
                t += d
    json.dump(saida, open(a.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    casadas = len(mapa) / max(1, len(esperadas))
    print(json.dumps({"ok": True, "palavras": len(saida), "casadas": round(casadas, 3)}))


if __name__ == "__main__":
    main()
