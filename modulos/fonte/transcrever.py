"""Transcreve um áudio com o faster-whisper (CPU) e grava os segmentos com tempo.

Uso: python transcrever.py --audio audio.m4a --saida whisper.json [--modelo small]
Saída: {"idioma": "pt", "segmentos": [{"t": 0.0, "txt": "..."}]}
"""
import argparse, json

from faster_whisper import WhisperModel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--modelo", default="small")
    a = ap.parse_args()
    modelo = WhisperModel(a.modelo, device="cpu", compute_type="int8")
    segs, info = modelo.transcribe(a.audio, vad_filter=True, beam_size=1)
    out = {"idioma": info.language, "segmentos": [{"t": round(s.start, 2), "txt": s.text.strip()} for s in segs if s.text.strip()]}
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(json.dumps({"ok": True, "idioma": info.language, "segmentos": len(out["segmentos"])}))


if __name__ == "__main__":
    main()
