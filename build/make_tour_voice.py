"""Records the tour's voice over (src/ui/voice/<scene>.mp3) with Kokoro, a free, natural sounding
voice (Apache 2.0) that runs on this computer. Only needed when the tour's words change; the MP3s
are kept in the project.

    python make_tour_voice.py <folder with kokoro-v1.0.onnx and voices-v1.0.bin> [voice]

The voice is af_heart unless another is given (af_bella, bf_emma, ...). Needs kokoro-onnx and
soundfile (pip install kokoro-onnx soundfile) and ffmpeg. The model files are on
github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0). The words come from the "say"
lines in src/ui/tutorial.js.
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
    import soundfile
    from kokoro_onnx import Kokoro
    models = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
    kokoro = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for key, say in scenes():
            samples, rate = kokoro.create(say, voice=voice, speed=0.98, lang="en-gb" if voice.startswith("b") else "en-us")
            wav = os.path.join(tmp, key + ".wav")
            soundfile.write(wav, samples, rate)
            mp3 = os.path.join(OUT, key + ".mp3")
            # Even loudness and a short breath of silence at the end, then a small mono MP3.
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af",
                            "highpass=f=60,loudnorm=I=-16:TP=-1.5,apad=pad_dur=0.25",
                            "-ac", "1", "-ar", "44100", "-b:a", "96k", mp3], check=True)
            print(key, os.path.getsize(mp3) // 1024, "KB", flush=True)


if __name__ == "__main__":
    main()
