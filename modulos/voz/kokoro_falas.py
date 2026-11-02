"""Sintetiza cada fala com o Kokoro (offline) e junta tudo numa narração com pausas por pontuação.

Uso: python kokoro_falas.py --entrada falas.json --saida-dir voz/ --voz pf_dora --velocidade 1.06
falas.json = [{"id": "f01", "texto": "texto a ser falado"}, ...]
Gera: narracao.wav (24 kHz mono) e falas_tempos.json [{"id", "inicio", "fim"}] e imprime um JSON-resumo.
"""
import argparse, inspect, json, os, shutil, sys, tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

CACHE = Path.home() / ".cache" / "hyperframes" / "tts"
MODELO = CACHE / "models" / "kokoro-v1.0.onnx"
VOZES = CACHE / "voices" / "voices-v1.0.bin"

PAUSAS = {".": 0.30, "!": 0.30, "?": 0.34, ":": 0.24, ";": 0.18, ",": 0.14, "…": 0.36}


def pausa_depois(texto: str) -> float:
    t = texto.rstrip()
    if t.endswith("..."):
        return PAUSAS["…"]
    return PAUSAS.get(t[-1:], 0.10) if t else 0.10


def espeak_curto():
    import kokoro_onnx
    if os.name != "nt" or "espeak_config" not in inspect.signature(kokoro_onnx.Kokoro.__init__).parameters:
        return {}
    import espeakng_loader
    from kokoro_onnx.config import EspeakConfig
    origem = espeakng_loader.get_data_path()
    if len(origem) < 200:
        return {}
    alvo = os.path.join(tempfile.gettempdir(), "hyperframes-espeak-ng-data")
    if not os.path.isdir(alvo):
        tmp = alvo + "." + str(os.getpid())
        shutil.copytree(origem, tmp)
        try:
            os.rename(tmp, alvo)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    return {"espeak_config": EspeakConfig(data_path=alvo)}


def aparar(x: np.ndarray, sr: int, limiar_db: float = -45.0, margem_s: float = 0.03) -> np.ndarray:
    if x.size == 0:
        return x
    env = np.abs(x)
    lim = np.max(env) * (10 ** (limiar_db / 20))
    idx = np.where(env > lim)[0]
    if idx.size == 0:
        return x
    m = int(margem_s * sr)
    return x[max(0, idx[0] - m): min(x.size, idx[-1] + m)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--entrada", required=True)
    ap.add_argument("--saida-dir", required=True)
    ap.add_argument("--voz", default="pf_dora")
    ap.add_argument("--velocidade", type=float, default=1.0)
    ap.add_argument("--lang", default="pt-br")
    a = ap.parse_args()

    if not MODELO.exists() or not VOZES.exists():
        print(json.dumps({"ok": False, "erro": "modelo_ausente", "dica": "rode 'hyperframes tts' uma vez para baixar o Kokoro"}))
        sys.exit(3)

    import kokoro_onnx
    modelo = kokoro_onnx.Kokoro(str(MODELO), str(VOZES), **espeak_curto())
    kwargs = {"voice": a.voz, "speed": a.velocidade}
    if "lang" in inspect.signature(modelo.create).parameters:
        kwargs["lang"] = a.lang

    falas = json.load(open(a.entrada, encoding="utf-8"))
    saida = Path(a.saida_dir)
    saida.mkdir(parents=True, exist_ok=True)
    pedacos, tempos, t, sr_final = [], [], 0.0, None
    for f in falas:
        amostras, sr = modelo.create(f["texto"], **kwargs)
        x = aparar(np.asarray(amostras, dtype=np.float32), sr)
        sr_final = sr_final or sr
        ini = t
        pedacos.append(x)
        t += x.size / sr
        tempos.append({"id": f["id"], "inicio": round(ini, 4), "fim": round(t, 4)})
        p = pausa_depois(f["texto"])
        pedacos.append(np.zeros(int(p * sr), dtype=np.float32))
        t += p
    audio = np.concatenate(pedacos) if pedacos else np.zeros(1, dtype=np.float32)
    pico = float(np.max(np.abs(audio))) or 1.0
    audio = audio * (0.89 / pico)
    sf.write(saida / "narracao.wav", audio, sr_final, subtype="PCM_16")
    json.dump(tempos, open(saida / "falas_tempos.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({"ok": True, "duracao": round(audio.size / sr_final, 3), "sr": sr_final, "falas": len(tempos)}))


if __name__ == "__main__":
    main()
