"""Motor Gemini do gbro-collage-broll (experimental: exige GEMINI_API_KEY e gera custo).

Para cada pedido: (1) gera o still final da colagem com um modelo de imagem do Gemini usando o prompt
do gbro; (2) cria o primeiro quadro como campo de cor vazio; (3) chama o scripts/generate_video.py do
próprio gbro (Gemini Omni Flash, quadro inicial + final) e (4) tira o áudio do resultado.

Uso: python gemini.py --pedidos pedidos.json --saida-dir colagem/ --gbro externos/gbro-collage-broll/scripts
"""
import argparse, json, os, subprocess, sys
from pathlib import Path

PROMPT_STILL = (
    "Use case: ads-marketing. Asset type: final still frame for a 9:16 image-to-video B-roll clip. "
    "Primary request: Create a finished editorial paper-collage image expressing: {metafora}. "
    "Scene/backdrop: perfectly flat {fundo} paper field with subtle uncoated paper fiber. "
    "Style/medium: premium editorial stop-motion paper collage; black-and-white halftone photographic cut-outs mixed with selective colored cardstock. "
    "Composition/framing: vertical 9:16 locked poster frame; central subject within the middle 70 percent; generous clean color-field negative space; "
    "3-6 large separable paper groups for later assemble-from-empty animation. Key objects: {objetos}. "
    "Materials/textures: visible printed halftone dots, crisp machine-cut edges, thin warm-cream paper keylines, soft low-opacity physical drop shadows. "
    "Avoid: no typography, no readable letters, no numerals, no logos, no watermark, no UI, no subtitles, no glossy 3D, no photoreal environment, no clutter."
)
PROMPT_VIDEO = (
    "Paper-collage stop-motion assembly, using Image 1 as the exact empty first frame and Image 2 as the exact completed last frame. "
    "In one continuous locked-off vertical shot, open on the empty flat {fundo} paper field. Assemble the scene piece by piece with crisp "
    "physical stop-motion timing: {ordem}. End by holding the supplied completed composition. Preserve the exact 9:16 framing, color field, "
    "colored cardstock accents, uncoated paper grain, halftone dots, cream keylines, crisp cut edges and soft shadows. Restrained tactile 2D "
    "paper craft only. No scene cuts, no camera movement, no zoom, no morphing, no new objects, no text, no letters, no numbers, no logos, no watermark, no UI, no sound."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pedidos", required=True)
    ap.add_argument("--saida-dir", required=True)
    ap.add_argument("--gbro", required=True)
    ap.add_argument("--modelo-imagem", default="gemini-2.5-flash-image")
    a = ap.parse_args()
    from google import genai
    from google.genai import types

    cliente = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    saida = Path(a.saida_dir)
    pedidos = json.load(open(a.pedidos, encoding="utf-8"))
    jobs = []
    for p in pedidos:
        objetos = ", ".join(e.get("icone", "") for e in p["elementos"]) or "symbolic paper cut-outs"
        prompt = PROMPT_STILL.format(metafora=p["metafora"] or p["texto"], fundo=p["fundo"], objetos=objetos)
        r = cliente.models.generate_content(model=a.modelo_imagem, contents=[prompt],
                                            config=types.GenerateContentConfig(response_modalities=["IMAGE"]))
        img = None
        for parte in r.candidates[0].content.parts:
            if getattr(parte, "inline_data", None) and parte.inline_data.data:
                img = parte.inline_data.data
        if not img:
            print(json.dumps({"ok": False, "erro": f"sem imagem para {p['id']}"}), file=sys.stderr)
            continue
        bruto = saida / f"{p['id']}_still_bruto.png"
        bruto.write_bytes(img)
        final = saida / f"{p['id']}_ultimo.png"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(bruto), "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", str(final)], check=True)
        primeiro = saida / f"{p['id']}_primeiro.png"
        cor = p["fundo"].lstrip("#")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x{cor}:s=1080x1920", "-frames:v", "1", str(primeiro)], check=True)
        ordem = "; ".join(f"{e.get('icone')} slides in from the {e.get('entra', 'bottom')} and snaps into place" for e in p["elementos"]) or "the elements slide in and snap into place one by one"
        jobs.append({"prompt": PROMPT_VIDEO.format(fundo=p["fundo"], ordem=ordem), "image": [str(primeiro), str(final)],
                     "output": str(saida / f"{p['id']}_com_audio.mp4"), "aspect_ratio": "9:16", "duration": p["duracao"]})
    arq = saida / "omni-jobs.json"
    json.dump(jobs, open(arq, "w", encoding="utf-8"), indent=1)
    if jobs:
        subprocess.run([sys.executable, str(Path(a.gbro) / "generate_video.py"), "--batch", str(arq), "--concurrency", "3"], check=True)
    for p in pedidos:
        cv = saida / f"{p['id']}_com_audio.mp4"
        if cv.exists():
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(cv), "-map", "0:v:0", "-an", "-c:v", "copy", str(saida / f"{p['id']}.mp4")], check=True)
    print(json.dumps({"ok": True, "jobs": len(jobs)}))


if __name__ == "__main__":
    main()
