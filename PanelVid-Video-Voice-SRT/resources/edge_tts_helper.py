# -*- coding: utf-8 -*-
"""Edge TTS helper cho PanelVid.

Doc file JSON argv[1] dang {"textFile": <txt UTF-8>, "voice": <voice id>, "output": <mp3>},
doc text tu file UTF-8 (tranh loi encoding cmd Windows), roi goi edge_tts.
"""
import asyncio
import json
import sys


def main():
    if len(sys.argv) < 2:
        print("thieu duong dan file JSON", file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)
    with open(cfg["textFile"], "r", encoding="utf-8") as f:
        text = f.read()
    voice = cfg["voice"]
    output = cfg["output"]
    import edge_tts
    asyncio.run(edge_tts.Communicate(
        text,
        voice,
        rate=cfg.get("rate", "+0%"),
        pitch=cfg.get("pitch", "+0Hz"),
        volume=cfg.get("volume", "+0%"),
    ).save(output))


if __name__ == "__main__":
    main()
