"""Trilha minimalista em loop perfeito, sintetizada com o lemo-opuscar (pluck.py + sfx.py, sem amostras).

O truque do loop: o andamento é escolhido para que a duração do vídeo seja um número inteiro de
compassos, e todas as caudas (notas e reverb) são somadas de forma circular. O último instante
emenda no primeiro sem corte.

Uso: python compor_lemo.py --duracao 82.4 --saida musica.wav [--humor didatico] [--seed 7]
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

LEMO = Path(__file__).resolve().parents[2] / "externos" / "lemo-opuscar"
sys.path.insert(0, str(LEMO))
from core.audio import pluck as PL  # noqa: E402
from core.audio import sfx as FX  # noqa: E402

SR = FX.SR
HUMORES = {
    "didatico": dict(bpm=(100, 112), modo="maior", brilho=0.9),
    "curioso": dict(bpm=(92, 104), modo="maior", brilho=1.0),
    "urgente": dict(bpm=(112, 124), modo="menor", brilho=0.8),
    "humor": dict(bpm=(100, 116), modo="maior", brilho=1.1),
}
RAIZES = {"C": 60, "D": 62, "F": 65, "G": 67, "A": 69}
GRAUS_MAIOR = [(0, [0, 4, 7]), (7, [0, 4, 7]), (9, [0, 3, 7]), (5, [0, 4, 7])]   # I V vi IV
GRAUS_MENOR = [(0, [0, 3, 7]), (8, [0, 4, 7]), (3, [0, 4, 7]), (10, [0, 4, 7])]  # i VI III VII


def somar_circular(buf, x, inicio, ganho=1.0, pan=0.0):
    n = buf.shape[0]
    i0 = int(round(inicio * SR)) % n
    x = np.asarray(x, dtype=np.float32) * ganho
    l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    pos = 0
    while pos < len(x):
        a = (i0 + pos) % n
        k = min(len(x) - pos, n - a)
        buf[a:a + k, 0] += x[pos:pos + k] * l
        buf[a:a + k, 1] += x[pos:pos + k] * r
        pos += k


def sala(x, rng, tamanho=0.45, mix=0.2):
    """Reverb de convolução com IR de ruído decrescente, aplicado de forma circular (loop)."""
    rt = 0.4 + 3.0 * tamanho
    n_ir = int(rt * SR)
    t = np.arange(n_ir) / SR
    ir = rng.standard_normal((n_ir, 2)) * np.exp(-6.9 * t / rt)[:, None]
    ir = sosfilt(butter(2, 7000, "low", fs=SR, output="sos"), ir, axis=0)
    ir /= np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True)) + 1e-9
    dobro = np.concatenate([x, x], axis=0)
    molhado = np.stack([fftconvolve(dobro[:, c], ir[:, c])[: dobro.shape[0]] for c in range(2)], axis=1)
    molhado = molhado[x.shape[0]:]
    return (1 - mix) * x + mix * molhado


def shaker(rng, vel=0.3):
    n = int(0.06 * SR)
    ruido = rng.standard_normal(n)
    ruido = sosfilt(butter(2, [5500, 11000], "band", fs=SR, output="sos"), ruido)
    env = np.exp(-np.arange(n) / (0.012 * SR))
    return (ruido * env * vel * 0.25).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duracao", type=float, required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--humor", default="didatico")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    rng = np.random.default_rng(a.seed)
    PL._rng = np.random.default_rng(a.seed + 1)
    FX._rng = np.random.default_rng(a.seed + 2)
    h = HUMORES.get(a.humor, HUMORES["didatico"])
    T = a.duracao
    bmin, bmax = h["bpm"]
    alvo = (bmin + bmax) / 2
    compassos = max(4, round(T * alvo / 240))
    bpm = 240 * compassos / T
    while bpm < bmin and compassos > 4:
        compassos += 1; bpm = 240 * compassos / T
    while bpm > bmax and compassos > 4:
        compassos -= 1; bpm = 240 * compassos / T
    batida = 60 / bpm
    raiz_nome = list(RAIZES)[a.seed % len(RAIZES)]
    raiz = RAIZES[raiz_nome]
    graus = GRAUS_MAIOR if h["modo"] == "maior" else GRAUS_MENOR

    n = int(round(T * SR))
    buf = np.zeros((n, 2), dtype=np.float32)
    padrao = [0, 1, 2, 1, 3, 2, 1, 2]
    for c in range(compassos):
        grau, acorde = graus[c % 4]
        t0 = c * 4 * batida
        base = raiz - 12 + grau
        # baixo pizzicato: tônica no 1, quinta no 3
        somar_circular(buf, PL.pluck("upright_bass_pizz", base - 12, None, vel=0.6), t0, 0.9, -0.1)
        somar_circular(buf, PL.pluck("upright_bass_pizz", base - 5, None, vel=0.5), t0 + 2 * batida, 0.8, -0.1)
        # harpa: acorde suave no começo do compasso (cama)
        for k, iv in enumerate(acorde):
            somar_circular(buf, PL.pluck("harp", base + 12 + iv, 4 * batida, vel=0.28), t0 + k * 0.02, 0.45, 0.25)
        # kalimba: arpejo em colcheias com respiros
        notas = [base + 24 + iv for iv in acorde] + [base + 36]
        for k in range(8):
            if rng.random() < 0.18 and k not in (0, 4):
                continue
            nota = notas[padrao[k] % len(notas)]
            vel = (0.5 if k % 2 == 0 else 0.36) * h["brilho"]
            somar_circular(buf, PL.pluck("kalimba", nota, None, vel=min(1, vel)), t0 + k * batida / 2 + rng.normal(0, 0.004), 0.55, -0.3 + 0.6 * (k % 2))
        # caixinha de música: brilho a cada 2 compassos
        if c % 2 == 1:
            somar_circular(buf, PL.pluck("music_box", base + 36 + acorde[rng.integers(0, 3)], None, vel=0.3), t0 + 3.5 * batida, 0.35, 0.4)
        # shaker leve nos contratempos
        for k in range(8):
            if k % 2 == 1:
                somar_circular(buf, shaker(rng, 0.5 + 0.2 * rng.random()), t0 + k * batida / 2, 0.6, 0.15)

    buf = sala(buf, rng, tamanho=0.4, mix=0.22)
    buf = sosfilt(butter(2, 35, "high", fs=SR, output="sos"), buf, axis=0)
    pico = float(np.max(np.abs(buf))) or 1.0
    buf = (buf * (0.7 / pico)).astype(np.float32)
    sf.write(a.saida, buf, SR, subtype="PCM_24")
    print(json.dumps({"ok": True, "bpm": round(bpm, 3), "compassos": compassos, "tom": raiz_nome, "modo": h["modo"], "duracao": round(n / SR, 4)}))


if __name__ == "__main__":
    main()
