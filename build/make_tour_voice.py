"""Records the tour's voice over (src/ui/voice/<scene>.mp3) with Piper, a free voice that runs
on this computer. Only needed when the tour's words change; the MP3s are kept in the project.

    python make_tour_voice.py <voice.onnx> [speaker number]

Needs piper-tts (pip install piper-tts) and ffmpeg. The words come from the "say" lines in
src/ui/tutorial.js.
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOUR = os.path.join(ROOT, "src", "ui", "tutorial.js")
OUT = os.path.join(ROOT, "src", "ui", "voice")


def scenes():
    text = open(TOUR, encoding="utf-8").read()
    for key, say in re.findall(r'key: "(\w+)".*?say: "((?:[^"\\]|\\.)*)"', text, re.S):
        yield key, say.replace('\\"', '"')


def main():
    model = sys.argv[1]
    speaker = sys.argv[2] if len(sys.argv) > 2 else None
    piper = os.path.join(os.path.dirname(sys.executable), "piper")
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for key, say in scenes():
            wav = os.path.join(tmp, key + ".wav")
            cmd = [piper, "-m", model, "-f", wav, "--length-scale", "1.04", "--sentence-silence", "0.25"]
            if speaker:
                cmd += ["-s", speaker]
            subprocess.run(cmd, input=say.encode("utf-8"), check=True, capture_output=True)
            mp3 = os.path.join(OUT, key + ".mp3")
            # A little warmth and even loudness, then a small mono MP3.
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af",
                            "highpass=f=70,equalizer=f=180:t=q:w=1:g=1.5,loudnorm=I=-16:TP=-1.5,apad=pad_dur=0.2",
                            "-ac", "1", "-ar", "44100", "-b:a", "80k", mp3], check=True)
            print(key, os.path.getsize(mp3) // 1024, "KB")


if __name__ == "__main__":
    main()
