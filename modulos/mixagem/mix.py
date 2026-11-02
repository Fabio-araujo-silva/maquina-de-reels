"""Mixagem cíclica: voz + música (com ducking suave) + efeitos, com TODAS as caudas somadas de forma circular,
para que o fim do áudio emende no começo sem clique nem buraco.

A música é nivelada pela loudness percebida (ITU-R BS.1770, a mesma medida do Instagram/TikTok/YouTube),
relativa à voz, e não por RMS:
- sem fala, ela fica `--musica-rel` LU em relação à voz (padrão −4,5: presente, mas atrás da narração);
- com fala, abaixa `--abaixa-db` dB (padrão 3,5), com antecipação, segura entre frases, ataque e soltura suaves,
  para não "bombear" a cada respiração;
- ganha um "bolsão da voz" (`--bolsao-db`, padrão 3 dB a menos em torno de 2,5 kHz), um corte dos graves
  inaudíveis (35 Hz) e um alívio leve dos agudos ásperos (−1,5 dB acima de 9 kHz): assim pode ficar mais alta
  sem brigar com a narração.
Todos os filtros rodam de forma circular (3 voltas, fica a do meio), então o laço da música não ganha emenda.

Uso: python mix.py --voz narracao.wav --musica musica_loop.wav --eventos sfx_eventos.json
                   --lead-in 0.25 --total 82.4 --saida mix_bruto.wav [--musica-rel -4.5 --abaixa-db 3.5 --bolsao-db 3]
     --stems <pasta> grava voz.wav, musica.wav e efeitos.wav separados (para conferir a mixagem).
"""
import argparse, json, os, subprocess, tempfile

import numpy as np
import soundfile as sf
import soxr
from scipy.signal import butter, sosfilt

SR = 48000
BLOCO_S = 0.02  # resolução do envelope de fala
# K-weighting da BS.1770 em 48 kHz: pré-filtro de prateleira + passa-altas "RLB"
K_SOS = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
                  [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])


def ler(arq):
    try:
        x, sr = sf.read(arq, dtype="float32", always_2d=True)
    except Exception:
        tmp = os.path.join(tempfile.gettempdir(), f"mix_{os.getpid()}_{abs(hash(arq))}.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", arq, "-ar", str(SR), tmp], check=True)
        x, sr = sf.read(tmp, dtype="float32", always_2d=True)
        os.remove(tmp)
    if sr != SR:
        x = soxr.resample(x, sr, SR, quality="HQ").astype(np.float32)
    return x


def estereo(x):
    return np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x[:, :2]


def somar_circular(buf, x, inicio, ganho=1.0, pan=0.0):
    n = buf.shape[0]
    i0 = int(round(inicio * SR)) % n
    x = x * ganho
    if x.shape[1] == 1:
        l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
        x = np.concatenate([x * l, x * r], axis=1)
    pos = 0
    while pos < len(x):
        a = (i0 + pos) % n
        k = min(len(x) - pos, n - a)
        buf[a:a + k] += x[pos:pos + k]
        pos += k


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def suavizar_circular(env, ataque, soltura):
    """Seguidor de envelope com ataque/soltura (em blocos), rodado duas voltas para o estado ficar circular."""
    a_at = np.exp(-1.0 / max(1, ataque))
    a_so = np.exp(-1.0 / max(1, soltura))
    y = 0.0
    out = np.zeros_like(env)
    for volta in range(2):
        for i, v in enumerate(env):
            coef = a_at if v > y else a_so
            y = coef * y + (1 - coef) * v
            if volta == 1:
                out[i] = y
    return out


def manter_circular(a, antes, depois):
    """Máximo móvel circular: a fala 'vale' de `antes` blocos antes até `depois` blocos depois.
    Antes = a música começa a ceder um pouco antes da voz; depois = segura entre frases (sem bombear)."""
    out = a.copy()
    for k in range(-antes, depois + 1):
        out = np.maximum(out, np.roll(a, k))
    return out


# ---------- filtros (biquads do RBJ Audio EQ Cookbook) ----------
def biquad_pico(f, q, ganho_db):
    A = 10 ** (ganho_db / 40)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    c = np.cos(w)
    b = np.array([1 + al * A, -2 * c, 1 - al * A])
    a = np.array([1 + al / A, -2 * c, 1 - al / A])
    return np.concatenate([b / a[0], a / a[0]])


def biquad_prateleira_alta(f, ganho_db, s=1.0):
    A = 10 ** (ganho_db / 40)
    w = 2 * np.pi * f / SR
    c, sn = np.cos(w), np.sin(w)
    al = sn / 2 * np.sqrt((A + 1 / A) * (1 / s - 1) + 2)
    raiz = 2 * np.sqrt(A) * al
    b = np.array([A * ((A + 1) + (A - 1) * c + raiz), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - raiz)])
    a = np.array([(A + 1) - (A - 1) * c + raiz, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - raiz])
    return np.concatenate([b / a[0], a / a[0]])


def filtrar_circular(x, sos):
    """Filtra um laço sem criar emenda: 3 voltas, fica a do meio (o estado do filtro já chega 'aquecido')."""
    n = len(x)
    y = sosfilt(sos, np.concatenate([x, x, x]).astype(np.float64), axis=0)
    return y[n:2 * n].astype(np.float32)


def tratar_musica(mus, bolsao_db):
    sos = [butter(2, 35, "highpass", fs=SR, output="sos")[0]]
    if bolsao_db > 0:
        sos.append(biquad_pico(2500, 0.8, -bolsao_db))
    sos.append(biquad_prateleira_alta(9000, -1.5))
    return filtrar_circular(mus, np.array(sos))


# ---------- loudness (BS.1770) ----------
def energia_blocos(x, bloco=0.4, passo=0.1):
    """Energia K-ponderada por bloco de 400 ms (passo 100 ms), somando os canais; circular.
    Devolve (energias, centros em segundos)."""
    y = filtrar_circular(x, K_SOS).astype(np.float64)
    e = np.sum(y ** 2, axis=1)
    n, h = int(bloco * SR), int(passo * SR)
    cs = np.concatenate([[0.0], np.cumsum(np.concatenate([e, e[:n]]))])
    ini = np.arange(0, len(e), h)
    return (cs[ini + n] - cs[ini]) / n, ((ini + n / 2) / SR) % (len(e) / SR)


def lufs_de(ms):
    """Loudness integrada com as duas comportas da BS.1770 (−70 LUFS absoluta, −10 LU relativa)."""
    ms = ms[ms > 0]
    if not len(ms):
        return None
    ms = ms[-0.691 + 10 * np.log10(ms) > -70]
    if not len(ms):
        return None
    rel = -0.691 + 10 * np.log10(np.mean(ms)) - 10
    ms = ms[-0.691 + 10 * np.log10(ms) > rel]
    return float(-0.691 + 10 * np.log10(np.mean(ms)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voz", required=True)
    ap.add_argument("--musica")
    ap.add_argument("--eventos")
    ap.add_argument("--lead-in", type=float, default=0.25)
    ap.add_argument("--total", type=float, required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--voz-db", type=float, default=-18.0, help="RMS da voz nos trechos com fala (dBFS)")
    ap.add_argument("--musica-rel", type=float, default=-4.5, help="música sem fala, em LU relativa à voz")
    ap.add_argument("--abaixa-db", type=float, default=3.5, help="quanto a música abaixa enquanto há fala")
    ap.add_argument("--antecipa", type=float, default=0.06, help="s: a música começa a ceder antes da voz")
    ap.add_argument("--segura", type=float, default=0.30, help="s: segura o abaixamento entre frases")
    ap.add_argument("--ataque", type=float, default=0.08, help="s")
    ap.add_argument("--soltura", type=float, default=0.60, help="s")
    ap.add_argument("--bolsao-db", type=float, default=3.0, help="corte na faixa da voz dentro da música")
    ap.add_argument("--sfx-db", type=float, default=-14.0)
    ap.add_argument("--stems")
    a = ap.parse_args()

    N = int(round(a.total * SR))
    mix = np.zeros((N, 2), dtype=np.float32)

    # voz
    voz = ler(a.voz)[:, :1]
    ativo = voz[np.abs(voz[:, 0]) > 0.02]
    voz = voz * 10 ** ((a.voz_db - rms_db(ativo if len(ativo) else voz)) / 20)
    trilha_voz = np.zeros((N, 2), dtype=np.float32)
    somar_circular(trilha_voz, voz, a.lead_in, 1.0, 0.0)
    ms_voz, centros = energia_blocos(trilha_voz)
    lufs_voz = lufs_de(ms_voz)

    # envelope de fala (circular): antecipa, segura entre frases, ataque/soltura suaves
    bloco = int(BLOCO_S * SR)
    nb = N // bloco
    energia = np.sqrt(np.mean(trilha_voz[: nb * bloco, 0].reshape(nb, bloco) ** 2, axis=1))
    fala = np.clip(energia / 10 ** ((a.voz_db - 14) / 20), 0, 1)
    segurada = manter_circular(fala, antes=int(round(a.antecipa / BLOCO_S)), depois=int(round(a.segura / BLOCO_S)))
    curva_b = suavizar_circular(segurada, ataque=a.ataque / BLOCO_S, soltura=a.soltura / BLOCO_S)
    curva = np.interp(np.arange(N), (np.arange(nb) + 0.5) * bloco, curva_b, period=N)

    medidas = {"voz_lufs": round(lufs_voz, 1) if lufs_voz is not None else None}
    trilha_mus = None
    if a.musica and os.path.exists(a.musica):
        mus = estereo(ler(a.musica))
        if len(mus) != N:
            mus = soxr.resample(np.concatenate([mus, mus, mus]), len(mus), N, quality="HQ")[N:2 * N] if abs(len(mus) - N) < SR else np.resize(mus, (N, 2))
        mus = tratar_musica(mus, a.bolsao_db)
        lufs_mus = lufs_de(energia_blocos(mus)[0])
        if lufs_mus is not None and lufs_voz is not None:
            mus = mus * 10 ** ((lufs_voz + a.musica_rel - lufs_mus) / 20)
        trilha_mus = (mus * (10 ** (-a.abaixa_db * curva / 20))[:, None]).astype(np.float32)
        mix += trilha_mus
        # medições da música como ficou (por loudness, relativa à voz)
        ms_mus, _ = energia_blocos(trilha_mus)
        com_fala = np.interp(centros, (np.arange(nb) + 0.5) * BLOCO_S, fala, period=N / SR) > 0.6
        sob = lufs_de(ms_mus[com_fala]) if com_fala.sum() >= 3 else None
        pausa = lufs_de(ms_mus[~com_fala]) if (~com_fala).sum() >= 3 else None
        ganho_db = -a.abaixa_db * curva_b
        medidas.update({
            "musica_lufs": round(lufs_de(ms_mus), 1),
            "musica_sob_a_fala_lu": round(sob - lufs_voz, 1) if sob is not None and lufs_voz is not None else None,
            "musica_nas_pausas_lu": round(pausa - lufs_voz, 1) if pausa is not None and lufs_voz is not None else None,
            "alvo_sob_a_fala_lu": round(a.musica_rel - a.abaixa_db, 1),
            "oscilacao_db_s": round(float(np.mean(np.abs(np.diff(ganho_db))) / BLOCO_S), 2),
        })

    mix += trilha_voz

    # efeitos
    usados = 0
    trilha_sfx = np.zeros((N, 2), dtype=np.float32) if a.stems else None
    if a.eventos and os.path.exists(a.eventos):
        eventos = json.load(open(a.eventos, encoding="utf-8"))
        cache = {}
        rng = np.random.default_rng(5)
        for ev in eventos:
            arq = ev["arquivo"]
            if arq not in cache:
                x = ler(arq)
                pico = float(np.max(np.abs(x))) or 1.0
                cache[arq] = x * (10 ** (a.sfx_db / 20) / pico)
            pan = float(rng.uniform(-0.25, 0.25))
            # atraso de 1 quadro: o som chega um pouco depois da imagem (soa natural)
            somar_circular(mix, cache[arq], ev["t"] + 1 / 30, float(ev.get("ganho", 0.5)) * 2.0, pan)
            if trilha_sfx is not None:
                somar_circular(trilha_sfx, cache[arq], ev["t"] + 1 / 30, float(ev.get("ganho", 0.5)) * 2.0, pan)
            usados += 1

    # limitador suave
    pico = float(np.max(np.abs(mix)))
    if pico > 0.97:
        mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    sf.write(a.saida, mix.astype(np.float32), SR, subtype="FLOAT")
    if a.stems:
        os.makedirs(a.stems, exist_ok=True)
        sf.write(os.path.join(a.stems, "voz.wav"), trilha_voz, SR, subtype="FLOAT")
        if trilha_mus is not None:
            sf.write(os.path.join(a.stems, "musica.wav"), trilha_mus, SR, subtype="FLOAT")
        sf.write(os.path.join(a.stems, "efeitos.wav"), trilha_sfx, SR, subtype="FLOAT")
    print(json.dumps({"ok": True, "duracao": round(N / SR, 4), "efeitos": usados, "pico": round(float(np.max(np.abs(mix))), 3), **medidas}))


if __name__ == "__main__":
    main()
