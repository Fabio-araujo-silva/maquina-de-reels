"""Kit de efeitos sonoros sintetizados com o sfx.py do lemo-opuscar (offline, grátis).

Uso: python foley_lemo.py --saida-dir biblioteca/sfx/lemo
Gera: whoosh_1..3, pop_1..2, tick_1..2, nega_1, impacto_1, riser_1, papel_1..2, clique_1 (WAV 48 kHz mono).
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

LEMO = Path(__file__).resolve().parents[2] / "externos" / "lemo-opuscar"
sys.path.insert(0, str(LEMO))
from core.audio import sfx as FX  # noqa: E402

SR = FX.SR


def norm(x, pico=0.8):
    m = float(np.max(np.abs(x))) or 1.0
    return (x * (pico / m)).astype(np.float32)


def mistura(a, b, gb=1.0):
    a = np.asarray(a, dtype=np.float64).ravel(); b = np.asarray(b, dtype=np.float64).ravel()
    n = max(len(a), len(b))
    return np.pad(a, (0, n - len(a))) + gb * np.pad(b, (0, n - len(b)))


def riser(d=1.4):
    n = int(d * SR)
    t = np.arange(n) / SR
    ruido = FX._rng.standard_normal(n)
    saida = np.zeros(n)
    passos = 24
    for k in range(passos):
        a, b = int(k * n / passos), int((k + 1) * n / passos)
        f0 = 600 * (2 ** (3.2 * k / passos))
        saida[a:b] = sosfilt(butter(2, [f0, min(f0 * 1.8, 18000)], "band", fs=SR, output="sos"), ruido[a:b])
    env = (t / d) ** 2.2
    return saida * env


def papel(d=0.45):
    n = int(d * SR)
    t = np.arange(n) / SR
    ruido = FX._rng.standard_normal(n)
    corpo = sosfilt(butter(2, [900, 6000], "band", fs=SR, output="sos"), ruido)
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5 * (1 + 0.6 * np.sin(2 * np.pi * 23 * t))
    return corpo * env


def nega():
    a = FX.thump(0.8, f=140)
    b = FX.click(0.6, 0.7)
    out = np.zeros(int(0.32 * SR))
    out[: len(a)] += a[: len(out)]
    k = int(0.11 * SR)
    out[k:k + len(b)] += b[: len(out) - k]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida-dir", required=True)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    FX._rng = np.random.default_rng(a.seed)
    out = Path(a.saida_dir)
    out.mkdir(parents=True, exist_ok=True)
    kit = {
        "whoosh_1": FX.whoosh(0.32, 0.9), "whoosh_2": FX.whoosh(0.4, 0.8), "whoosh_3": FX.whoosh(0.28, 1.0),
        "pop_1": FX.pop(0.9), "pop_2": FX.pop(0.75),
        "tick_1": FX.click(1.6, 0.6), "tick_2": FX.click(1.9, 0.5),
        "nega_1": nega(),
        "impacto_1": mistura(FX.thump(1.0, f=55), FX.crash(0.4), 0.25),
        "riser_1": riser(),
        "papel_1": papel(0.42), "papel_2": papel(0.5),
        "clique_1": FX.click(1.0, 0.9),
    }
    feitos = {}
    for nome, x in kit.items():
        x = np.asarray(x, dtype=np.float64).ravel()
        sf.write(out / f"{nome}.wav", norm(x), SR, subtype="PCM_16")
        feitos[nome] = round(len(x) / SR, 3)
    print(json.dumps({"ok": True, "arquivos": feitos}))


if __name__ == "__main__":
    main()
