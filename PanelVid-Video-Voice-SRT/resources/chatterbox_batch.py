# -*- coding: utf-8 -*-
"""Chatterbox batch TTS cho PanelVid — clone giong tu file mau, gen tung cue ra wav.

argv[1]: file JSON {"cues": [{"text": str, "output": str}], "reference_voice": str,
                "language_id": "vi"|"en"|"ja", "exaggeration": float, "skip_existing": bool}
Tien do in ra stdout moi dong (flush): MODEL_LOADING / CUE_DONE <i> / CUE_SKIP <i> / DONE <n>.
Loi -> in ra stderr + exit 1, message tieng Viet.
"""
import json
import os
import sys


def fail(msg):
    print("LOI: " + msg, file=sys.stderr)
    sys.exit(1)


def cue_stats(torch, torchaudio, path):
    """(rms_db, crest_db, seconds) cua 1 file wav cue; None neu khong doc duoc.

    crest = dinh - RMS (dB): tieng doc sach thuong 10-20 dB; cue bi clone
    "het vo tieng" (doan cam xuc toan chu hoa) co RMS rat nong va crest thap
    (< 6 dB) vi song am bi be det gan nhu song vuong.
    """
    try:
        wav, sr = torchaudio.load(path)
        x = wav.float().reshape(-1)
        if x.numel() < int(0.4 * sr):
            return None
        peak = float(x.abs().max())
        rms = float(torch.sqrt(torch.mean(x * x)))
        import math
        peak_db = 20 * math.log10(peak + 1e-9)
        rms_db = 20 * math.log10(rms + 1e-9)
        return (rms_db, peak_db - rms_db, x.numel() / float(sr))
    except Exception:
        return None


def guard_regen(torch, torchaudio, model, cues, ref, lang, exaggeration):
    """Vong 2 (v6t): sinh lai cac cue vo tieng voi exaggeration thap hon.

    Cue bi gan co khi RMS nong hon trung vi toan batch > 5 dB VA crest < 6.
    Moi cue chi sinh lai 1 lan; giu ban co crest cao hon (it vo hon).
    """
    stats = []
    for cue in cues:
        out = cue.get("output", "")
        stats.append(cue_stats(torch, torchaudio, out) if out and os.path.isfile(out) else None)
    rmss = sorted(s[0] for s in stats if s)
    if len(rmss) < 4:
        return
    median = rmss[len(rmss) // 2]
    flagged = [i for i, s in enumerate(stats)
               if s and s[0] > median + 5 and s[1] < 6]
    if not flagged:
        return
    ex2 = max(0.3, exaggeration - 0.15)
    print("CANH BAO: " + str(len(flagged)) + " cue nghi vo tieng, sinh lai voi exaggeration " + str(ex2), flush=True)
    model.prepare_conditionals(ref, exaggeration=ex2)
    for i in flagged:
        cue = cues[i]
        out = cue.get("output", "")
        text = (cue.get("text") or "").strip()
        if not out or not text:
            continue
        tmp_out = out + ".regen.wav"
        try:
            wav = model.generate(text, language_id=lang, exaggeration=ex2, cfg_weight=0.5)
            torchaudio.save(tmp_out, wav, model.sr)
        except Exception:
            continue
        new = cue_stats(torch, torchaudio, tmp_out)
        if new and stats[i] and new[1] > stats[i][1] + 0.5:
            os.replace(tmp_out, out)
        else:
            try:
                os.remove(tmp_out)
            except Exception:
                pass
        print("CUE_REGEN " + str(i), flush=True)


def main():
    if len(sys.argv) < 2:
        fail("thieu duong dan file JSON cong viec")
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        job = json.load(f)
    cues = job.get("cues") or []
    ref = job.get("reference_voice") or ""
    lang = job.get("language_id") or "en"
    SUPPORTED_LANGS = ("ar", "da", "de", "el", "en", "es", "fi", "fr", "he",
                       "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt",
                       "ru", "sv", "sw", "tr", "zh")
    if lang not in SUPPORTED_LANGS:
        fail("Chatterbox khong ho tro doc text ngon ngu '" + str(lang) +
             "' (khong co tieng Viet). Trong PanelVid, o Ngon ngu cua giong clone "
             "chi chon Anh/Nhat/TBN/BDN.")
    try:
        exaggeration = float(job.get("exaggeration", 0.5))
    except Exception:
        exaggeration = 0.5
    skip_existing = bool(job.get("skip_existing", True))

    if not cues:
        fail("khong co cue nao de doc")
    if not ref or not os.path.isfile(ref):
        fail("khong tim thay file giong mau: " + (ref or "(chua chon)"))

    try:
        import torch
    except Exception:
        fail("thieu thu vien torch. Chay 1-cai-dat.bat cua bo Chatterbox de cai dat.")
    try:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    except Exception:
        fail("chua cai Chatterbox. Chay 1-cai-dat.bat cua bo Chatterbox de cai dat (can Internet 1 lan).")

    cuda = False
    try:
        cuda = bool(torch.cuda.is_available())
    except Exception:
        cuda = False
    device = "cuda" if cuda else "cpu"
    if not cuda:
        print("CANH BAO: khong thay GPU CUDA, chay bang CPU (se cham hon nhieu).", flush=True)

    print("MODEL_LOADING", flush=True)
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    except Exception as e:
        fail("khong tai duoc model Chatterbox: " + str(e)[:400])
    try:
        model.prepare_conditionals(ref, exaggeration=exaggeration)
    except Exception as e:
        fail("khong nap duoc giong mau (file loi hoac khong doc duoc): " + str(e)[:400])

    import torchaudio
    for i, cue in enumerate(cues):
        out = cue.get("output", "")
        if skip_existing and out and os.path.isfile(out) and os.path.getsize(out) > 0:
            print("CUE_SKIP " + str(i), flush=True)
            continue
        text = (cue.get("text") or "").strip()
        if not text:
            fail("cue " + str(i + 1) + " khong co noi dung")
        try:
            wav = model.generate(text, language_id=lang, exaggeration=exaggeration, cfg_weight=0.5)
        except Exception as e:
            fail("tao voice that bai o cue " + str(i + 1) + ": " + str(e)[:400])
        try:
            torchaudio.save(out, wav, model.sr)
        except Exception as e:
            fail("khong luu duoc file cue " + str(i + 1) + ": " + str(e)[:300])
        print("CUE_DONE " + str(i), flush=True)
    # Vong kiem tra cue vo tieng (v6t) — loi o vong nay khong duoc lam hong job.
    try:
        guard_regen(torch, torchaudio, model, cues, ref, lang, exaggeration)
    except Exception as e:
        print("CANH BAO: bo qua vong kiem tra cue vo tieng: " + str(e)[:200], flush=True)
    print("DONE " + str(len(cues)), flush=True)


if __name__ == "__main__":
    main()
