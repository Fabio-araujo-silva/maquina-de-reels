"""Transforma qualquer música (ElevenLabs Music ou sua faixa) num loop sem emenda com a duração exata do vídeo.

1. Procura, perto da duração alvo, o ponto de corte cujo "envelope de ataques" mais se parece com o começo.
2. Faz crossfade de potência constante entre o fim e o começo nesse ponto.
3. Reamostra o laço para a duração exata (mudança de afinação < 1%, inaudível) de forma circular.

Uso: python loop.py --entrada musica.wav --duracao 82.4 --saida musica_loop.wav [--xfade 1.5]
"""
import argparse, json

import numpy as np
import soundfile as sf
import soxr


def envelope_ataques(x, sr, hop=512):
    mono = x.mean(axis=1) if x.ndim == 2 else x
    n = (len(mono) - 2048) // hop
    if n <= 2:
        return np.zeros(1)
    janela = np.hanning(2048)
    mags = np.array([np.abs(np.fft.rfft(mono[i * hop: i * hop + 2048] * janela)) for i in range(n)])
    fluxo = np.maximum(0, np.diff(mags, axis=0)).sum(axis=1)
    return fluxo / (np.max(fluxo) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--entrada", required=True)
    ap.add_argument("--duracao", type=float, required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--xfade", type=float, default=1.5)
    a = ap.parse_args()

    x, sr = sf.read(a.entrada, dtype="float32", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    T = a.duracao
    F = int(a.xfade * sr)
    # se a faixa é curta, repete com crossfade até cobrir T + 3 s
    while len(x) < int((T + 3) * sr):
        cauda = x[-F:]
        y = np.concatenate([x[:-F], cauda * np.linspace(1, 0, F)[:, None] + x[:F] * np.linspace(0, 1, F)[:, None], x[F:]], axis=0)
        x = y
    # melhor ponto de laço L perto de T
    hop = 512
    env = envelope_ataques(x, sr, hop)
    W = int(4 * sr / hop)
    ref = env[:W]
    melhor_L, melhor_s = T, -1e9
    for L in np.arange(max(1.0, T - 0.6), T + 0.6, 0.01):
        i = int(L * sr / hop)
        if i + W >= len(env):
            break
        seg = env[i:i + W]
        s = float(np.dot(ref - ref.mean(), seg - seg.mean()) / (np.std(ref) * np.std(seg) * W + 1e-9))
        s -= 0.15 * abs(L - T)
        if s > melhor_s:
            melhor_s, melhor_L = s, float(L)
    M = int(round(melhor_L * sr))
    if M + F > len(x):
        M = len(x) - F
    laco = x[:M].copy()
    wi = np.sin(np.linspace(0, np.pi / 2, F))[:, None]
    wo = np.cos(np.linspace(0, np.pi / 2, F))[:, None]
    laco[:F] = x[:F] * wi + x[M:M + F] * wo
    # reamostra circularmente para exatamente T
    N = int(round(T * sr))
    if N != M:
        triplo = np.concatenate([laco, laco, laco], axis=0)
        r = soxr.resample(triplo, M, N, quality="HQ")
        laco = r[N:2 * N]
        if len(laco) < N:
            laco = np.pad(laco, ((0, N - len(laco)), (0, 0)))
    pico = float(np.max(np.abs(laco))) or 1.0
    laco = laco * min(1.0, 0.9 / pico)
    sf.write(a.saida, laco.astype(np.float32), sr, subtype="PCM_24")
    print(json.dumps({"ok": True, "laco_original": round(melhor_L, 3), "semelhanca": round(melhor_s, 3), "duracao": round(N / sr, 4)}))


if __name__ == "__main__":
    main()
