# -*- coding: utf-8 -*-
"""VieNeu-TTS batch cho PanelVid — clone giong tieng Viet tu file mau, gen tung cue ra wav.

argv[1]: file JSON {"cues": [{"text": str, "output": str}], "reference_voice": str,
                "cache_dir": str, "skip_existing": bool}
Tien do in ra stdout moi dong (flush): MODEL_LOADING / CUE_DONE <i> / CUE_SKIP <i> / DONE <n>
(giao thuc giong het chatterbox_batch.py de Electron dung chung bo doc tien do).
Loi -> traceback ra stderr + exit 1, message tieng Viet.

Luu y ky thuat (da kiem chung):
- PHAI dat HF_HUB_DISABLE_SYMLINKS=1 truoc khi import vieneu/huggingface_hub:
  cache HF dang symlink lam ONNX Runtime loi nap external data cua model.
- HF_HOME tro vao cache_dir ngoai thu muc app (userData) de model ~610MB khong
  phai tai lai moi lan cap nhat app.
- backend="onnx" + mode="v3turbo" ghim cung: "auto" se chon torch 2.7.1 dung
  chung voi Chatterbox (duong PyTorch chua kiem chung), con v4 la ban thuong
  mai/API nen chi dung v3 Turbo ma nguon mo.
"""
import json
import os
import sys
import traceback

# PHAI nam truoc moi import cham vao vieneu / huggingface_hub.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")


def fail(msg):
    print("LOI: " + msg, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        fail("thieu duong dan file JSON cong viec")
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        job = json.load(f)
    cues = job.get("cues") or []
    ref = job.get("reference_voice") or ""
    cache_dir = job.get("cache_dir") or ""
    skip_existing = bool(job.get("skip_existing", True))

    if not cues:
        fail("khong co cue nao de doc")
    if not ref or not os.path.isfile(ref):
        fail("khong tim thay file giong mau: " + (ref or "(chua chon)"))
    if cache_dir:
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            pass
        os.environ["HF_HOME"] = cache_dir

    try:
        from vieneu import Vieneu
    except Exception:
        traceback.print_exc()
        fail("chua cai VieNeu-TTS. Chay lai CHAY-PANELVID.bat de tu cai dat (can Internet 1 lan).")

    try:
        tts = Vieneu(mode="v3turbo", backend="onnx", precision="fp32")
    except Exception:
        traceback.print_exc()
        fail("khong tai duoc model VieNeu (lan dau can Internet de tai ~610MB model).")
    print("MODEL_LOADING", flush=True)
    try:
        tts.add_voice("clone", ref)
    except Exception:
        traceback.print_exc()
        fail("khong nap duoc giong mau (file loi hoac khong doc duoc).")

    for i, cue in enumerate(cues):
        out = cue.get("output", "")
        if skip_existing and out and os.path.isfile(out) and os.path.getsize(out) > 0:
            print("CUE_SKIP " + str(i), flush=True)
            continue
        text = (cue.get("text") or "").strip()
        if not text:
            fail("cue " + str(i + 1) + " khong co noi dung")
        try:
            audio = tts.infer(text, voice="clone")
            tts.save(audio, out)
        except Exception:
            traceback.print_exc()
            fail("tao voice that bai o cue " + str(i + 1))
        print("CUE_DONE " + str(i), flush=True)
    print("DONE " + str(len(cues)), flush=True)


if __name__ == "__main__":
    main()
