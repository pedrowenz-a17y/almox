from pathlib import Path
import subprocess

import numpy as np

RATE = 48000
BEAT = 60 / 96
DEST = Path(__file__).resolve().parent.parent / "public" / "audio"
DEST.mkdir(parents=True, exist_ok=True)


def frequency(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def score(name, duration, changes, cues):
    mix = np.zeros((int(duration * RATE), 2), dtype=np.float32)
    rng = np.random.default_rng(420)
    chords = [(45, 52, 60, 64), (41, 48, 57, 64), (43, 50, 59, 62), (40, 47, 55, 62)]

    def add(start, signal, level, pan=0):
        frame = round(start * RATE)
        count = min(len(signal), len(mix) - frame)
        if count <= 0:
            return
        stereo = np.array([np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)])
        mix[frame:frame + count] += signal[:count, None] * stereo * level

    def time(length):
        return np.arange(int(length * RATE)) / RATE

    for bar in range(int(duration / (4 * BEAT)) + 1):
        start = bar * 4 * BEAT
        chord = chords[bar % len(chords)]
        for index, note in enumerate(chord):
            t = time(4.7 * BEAT)
            hz = frequency(note)
            wave = np.sin(2 * np.pi * hz * t) + .27 * np.sin(4 * np.pi * hz * 1.001 * t)
            envelope = (1 - np.exp(-t * 3.2)) * np.minimum(1, (t.max() - t) / .68)
            add(start, wave * envelope, .029 + .005 * (index == 0), (index - 1.5) * .21)

        for off, degree in [(0.5, 2), (1.5, 1), (2.25, 3), (3.25, 2)]:
            t = time(1.6)
            hz = frequency(chord[degree] + 12)
            wave = np.sin(2 * np.pi * hz * t) + .25 * np.sin(2 * np.pi * 2.004 * hz * t)
            envelope = (1 - np.exp(-t * 82)) * np.exp(-t * 5.8)
            add(start + BEAT * off, wave * envelope, .046, -.32 + .2 * degree)
            add(start + BEAT * off + .24, wave * envelope, .012, .39 - .17 * degree)

        for count in (0, 2, 3.5):
            t = time(.44)
            phase = 2 * np.pi * (44 * t + 1.9 * (1 - np.exp(-26 * t)))
            add(start + BEAT * count, np.sin(phase) * np.exp(-t * 12) * (1 - np.exp(-t * 165)), .101)
        for count in (.75, 1.5, 2.75, 3.5):
            t = time(.16)
            noise = np.diff(rng.normal(size=len(t) + 1)) * (1 - np.exp(-t * 550)) * np.exp(-t * 30)
            add(start + BEAT * count, noise, .010, .24 * np.cos(count))

    for start in changes:
        t = time(.51)
        noise = rng.normal(size=len(t))
        airy = np.convolve(noise, np.ones(36) / 36, mode="same")
        add(start - .18, airy * np.sin(np.pi * t / .51) ** 2, .11, -.18)

    for start, cue in cues:
        if cue == "click":
            t = time(.15)
            wave = np.sin(2 * np.pi * 375 * t) + .36 * np.sin(2 * np.pi * 1574 * t)
            add(start, wave * np.exp(-t * 48) * (1 - np.exp(-t * 250)), .104, -.23)
        elif cue == "confirm":
            for index, note in enumerate((69, 76, 81)):
                t = time(.78)
                wave = np.sin(2 * np.pi * frequency(note) * t)
                add(start + index * .076, wave * np.exp(-t * 6.2) * (1 - np.exp(-t * 90)), .065, index * .16)
        else:
            t = time(2.6)
            wave = np.sin(2 * np.pi * 55 * t) + .6 * np.sin(2 * np.pi * 110 * t)
            add(start, wave * np.exp(-t * 3.4) * (1 - np.exp(-t * 28)), .12)
            for index, note in enumerate((57, 64, 69)):
                tone = np.sin(2 * np.pi * frequency(note) * t)
                add(start + index * .085, tone * np.exp(-t * 2) * (1 - np.exp(-t * 15)), .078, index * .21 - .22)

    t = time(duration)
    bed_envelope = np.minimum(1, t / .72) * np.minimum(1, (duration - t) / 1.25)
    mix *= bed_envelope[:, None]
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(RATE),
        "-ac", "2", "-i", "pipe:0", "-af", "loudnorm=I=-15.5:TP=-1.5:LRA=8",
        "-ar", str(RATE), "-c:a", "aac", "-b:a", "192k", str(DEST / (name + ".m4a")),
    ], input=mix.astype("<f4", copy=False).tobytes(), check=True)


score("full", 78, [5, 11, 19, 29, 35, 41, 48, 54, 61, 67, 73], [
    (6.15, "click"), (14.82, "confirm"), (23.10, "click"), (39.10, "click"),
    (45.34, "confirm"), (46.18, "click"), (51.08, "click"), (57.4, "click"),
    (65.32, "click"), (73.62, "logo"),
])
score("launch", 35, [3, 7, 10, 14, 18, 25, 29], [
    (3.76, "click"), (8.45, "confirm"), (11.65, "click"),
    (22.35, "confirm"), (23.18, "click"), (30.85, "logo"),
])
