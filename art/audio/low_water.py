"""Render the original Low Water score and its synchronized pursuit stem.

From the repository root run python art/audio/low_water.py with NumPy and FFmpeg
(libvorbis) installed. The deterministic performance is 24 bars at 91 BPM.
Pitch numbers below use MIDI conventions. Positions and lengths use beats.
"""

import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from numpy import sin, cos, pi, exp

SAMPLE_RATE = 32000
seconds_per_beat = 60 / 91
bar_count = 24
LOOP_SAMPLES = round(SAMPLE_RATE * seconds_per_beat * bar_count * 4)
rng = np.random.default_rng(47521)
mix = np.zeros((LOOP_SAMPLES, 2), np.float32)
wet = np.zeros_like(mix)


def add(samples, when, pan, send=0):
    start = round(when * SAMPLE_RATE) % LOOP_SAMPLES
    stereo = samples[:, None] * [cos((pan + 1) * pi / 4), sin((pan + 1) * pi / 4)]
    before_wrap = min(LOOP_SAMPLES - start, len(samples))
    for bus, level in [(mix, 1), (wet, send)]:
        if not level:
            continue
        bus[start : start + before_wrap] += stereo[:before_wrap] * level
        if before_wrap < len(samples):
            bus[: len(samples) - before_wrap] += stereo[before_wrap:] * level


def tone(kind, key, position_beats, length_beats, velocity=0.8, pan=0):
    duration = length_beats * seconds_per_beat
    release = {"guitar": 0.64, "keys": 0.5, "pad": 0.72, "bass": 0.08}[kind]
    time = np.arange(round((duration + release * 4) * SAMPLE_RATE)) / SAMPLE_RATE
    frequency = 440 * 2 ** ((key - 69) / 12)
    phase = 2 * pi * frequency * time
    if kind == "guitar":
        bend = 0.00085 * sin(2 * pi * 4.2 * time) * np.minimum(1, time / 0.38)
        phase += 2 * pi * frequency * (bend * 0.48 + 0.0006 * (1 - exp(-time / 0.022)))
        waveform = sum(
            sin(
                phase * harmonic * (1 + 0.000023 * harmonic * harmonic)
                + 0.08 * harmonic
            )
            * sin(0.23 * pi * harmonic)
            / harmonic**0.9
            * exp(-time * (1.4 + 0.66 * harmonic))
            for harmonic in range(1, min(20, int(SAMPLE_RATE / 2 / frequency)))
        )
        waveform += 0.06 * rng.normal(size=len(time)) * exp(-time / 0.011)
        level, send = 0.24, 0.53
    elif kind == "keys":
        waveform = sin(
            phase + 1.25 * velocity * exp(-time / 0.31) * sin(2.001 * phase)
        ) * 0.76 + 0.24 * sin(
            1.0019 * phase + 0.44 * exp(-time / 0.15) * sin(7 * phase)
        )
        waveform *= exp(-time / 1.9) * (0.96 + 0.04 * cos(time * 2 * pi * 3.2))
        level, send = 0.09, 0.42
    elif kind == "bass":
        waveform = (
            sin(phase)
            + 0.39 * sin(2 * phase + 0.25) * exp(-time / 0.45)
            + 0.27 * sin(3 * phase) * exp(-time / 0.23)
            + 0.16 * sin(5 * phase) * exp(-time / 0.07)
        ) * exp(-time / 1.3)
        level, send = 0.26, 0.045
    else:
        waveform = (
            sin(phase + 0.25 * sin(time * 3))
            + sin(phase * 1.0021 + 0.4)
            + 0.42 * sin(2 * phase * 0.998)
            + 0.16 * sin(3 * phase + 0.5)
        ) * 0.4
        waveform *= 1 - exp(-time / 0.45)
        level, send = 0.052, 0.49
    envelope = (1 - exp(-time / (0.008 if kind != "bass" else 0.009))) * exp(
        -np.maximum(0, time - duration) / (release * 0.46)
    )
    add(
        waveform * envelope * level * velocity,
        position_beats * seconds_per_beat + rng.uniform(-0.008, 0.008),
        pan,
        send,
    )


def drums(kind, position_beats, velocity, pan):
    duration = {
        "kick": 0.43,
        "rim": 0.19,
        "hat": 0.15,
        "open": 0.37,
        "brush": 0.25,
        "tom": 0.35,
    }[kind]
    time = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    noise = rng.normal(size=len(time))
    bright_noise = np.diff(noise, prepend=0)
    if kind == "kick":
        waveform = 0.36 * sin(
            2 * pi * (48 * time + 1.95 * (1 - exp(-time / 0.033)))
        ) * exp(-time / 0.11) + 0.065 * noise * exp(-time / 0.006)
    if kind in ("hat", "open"):
        waveform = (
            0.035 * bright_noise
            + 0.014
            * sum(
                sin(time * 2 * pi * frequency) for frequency in [4231, 5863, 7221, 8901]
            )
        ) * exp(-time / (0.029 if kind == "hat" else 0.089))
    if kind == "rim":
        waveform = (
            0.14 * sin(time * 2 * pi * 176) * exp(-time / 0.048)
            + 0.11 * sin(time * 2 * pi * 521) * exp(-time / 0.024)
            + 0.075 * bright_noise * exp(-time / 0.042)
            + 0.085 * noise * exp(-time / 0.066)
        )
    if kind == "brush":
        waveform = 0.057 * bright_noise * exp(-(((time - 0.048) / 0.047) ** 2))
    if kind == "tom":
        waveform = (
            0.13
            * sin(2 * pi * (95 * time + 1.3 * (1 - exp(-time / 0.05))))
            * exp(-time / 0.095)
        )
    add(
        waveform * (1 - exp(-time / 0.00085)) * velocity,
        position_beats * seconds_per_beat,
        pan,
        0.19 if kind in ("brush", "rim", "tom") else 0.055,
    )


D = (38, [53, 57, 60, 64])
Bb = (34, [53, 57, 60, 62])
G = (31, [53, 57, 58, 62])
A = (33, [55, 58, 61, 64])
F = (41, [52, 55, 57, 60])
C = (36, [52, 55, 59, 62])
E = (40, [50, 55, 58, 62])
changes = [D, Bb, G, A, D, Bb, G, A, F, C, G, D, Bb, G, E, A, D, Bb, G, A, D, Bb, G, A]
# Phrases have pickups, space for the answering guitar, and a separate bridge.
phrases = [
    [(0.45, 69, 0.48), (1.22, 72, 0.24), (1.57, 74, 1.36), (3.32, 76, 0.4)],
    [(0.02, 77, 0.85), (1.55, 74, 0.5), (2.54, 72, 0.96)],
    [(0.48, 69, 0.42), (1.24, 67, 0.29), (1.57, 65, 0.9), (3.05, 67, 0.53)],
    [(0.06, 69, 1.2), (2.57, 67, 0.28), (3.05, 64, 0.68)],
    [(0.48, 69, 0.5), (1.26, 72, 0.26), (1.57, 74, 1.3), (3.32, 76, 0.38)],
    [(0.05, 77, 1.25), (1.85, 81, 0.38), (2.57, 79, 0.39), (3.08, 77, 0.6)],
    [(0.08, 74, 0.78), (1.56, 72, 0.4), (2.1, 70, 1.3)],
    [(0.08, 73, 1.72), (3.03, 67, 0.6)],
    [(0.02, 69, 1.48), (2.58, 72, 0.4), (3.11, 76, 0.75)],
    [(0.06, 74, 1.6), (2.57, 71, 0.4), (3.18, 67, 0.56)],
    [(0.06, 70, 1.38), (2.12, 74, 1.18)],
    [(0.55, 72, 0.52), (1.52, 69, 1.67)],
    [(0.05, 65, 0.7), (1.08, 69, 0.5), (2.08, 72, 0.5), (3.04, 77, 0.62)],
    [(0.08, 79, 1.55), (2.57, 77, 0.45), (3.15, 74, 0.6)],
    [(0.05, 70, 1.1), (1.58, 67, 0.48), (2.56, 64, 1.15)],
    [(0.06, 61, 1.75), (3.25, 64, 0.48)],
]
for bar, (root, voicing) in enumerate(changes):
    bar_start = bar * 4
    bridge = 8 <= bar < 16
    for index, pitch in enumerate(voicing):
        tone(
            "keys",
            pitch,
            bar_start + 0.035 + index * 0.018,
            1.53 if not bridge else 2.25,
            0.92 - index * 0.035,
            -0.42 + index * 0.15,
        )
        if bar % 4 != 3:
            tone(
                "keys",
                pitch,
                bar_start + (2.57 if bar % 2 == 0 else 3.08) + index * 0.009,
                0.60,
                0.55,
                -0.48 + index * 0.18,
            )
        if bar >= 4:
            tone("pad", pitch + 12, bar_start + 0.04, 3.82, 0.64, (-1) ** index * 0.68)
    bass = [
        (0, root, 1.28),
        (1.58, root + 12, 0.26),
        (2.05, root + 7, 0.67),
        (3.54, changes[(bar + 1) % bar_count][0] - 1, 0.32),
    ]
    if bar % 2:
        bass = [(0, root, 1.73), (2.56, root + 7, 0.53), (3.3, root + 12, 0.39)]
    for offset, pitch, length in bass:
        tone("bass", pitch, bar_start + offset, length, 0.94)
    phrase = phrases[bar if bar < 16 else bar - 16]
    for index, (offset, pitch, length) in enumerate(phrase):
        tone(
            "guitar",
            pitch,
            bar_start + offset,
            length,
            0.86 + (0.13 if length > 0.65 else 0),
            0.12,
        )
        if bar >= 16 and length > 0.85:
            tone(
                "guitar",
                pitch - 12,
                bar_start + offset + 0.027,
                length * 0.88,
                0.38,
                -0.38,
            )
    if bar in (1, 5, 11, 17, 21):
        tone("guitar", voicing[1] + 12, bar_start + 3.60, 0.27, 0.48, -0.58)
    for index in range(8):
        if 8 <= bar < 12 and index % 2:
            continue
        drums(
            "open" if index == 7 and bar % 2 else "hat",
            bar_start
            + index * 0.5
            + (0.046 if index % 2 else 0.006)
            + rng.uniform(-0.007, 0.007),
            (0.53 if index % 2 else 0.82) * rng.uniform(0.8, 1.12),
            0.35,
        )
    for offset, velocity in (
        [(0, 0.93), (2.53, 0.69)]
        if bar % 2 == 0
        else [(0, 0.9), (1.55, 0.56), (2.04, 0.8)]
    ):
        drums("kick", bar_start + offset, velocity, 0)
    for offset in ([3] if 8 <= bar < 12 else [1, 3]):
        drums("rim", bar_start + offset + 0.036, 0.85, -0.10)
    if bar % 2:
        drums("brush", bar_start + 2.80, 0.48, -0.38)
    if bar % 8 == 7:
        for index, offset in enumerate([3.52, 3.78]):
            drums("tom", bar_start + offset, 0.54 + index * 0.12, -0.3 + index * 0.4)
# Stereo tape returns and a small diffuse room. Circular returns keep the loop intact.
for delay, level, flip in [
    (0.028, 0.14, 1),
    (0.047, 0.11, 0),
    (0.076, 0.09, 1),
    (0.12, 0.072, 0),
    (seconds_per_beat * 0.75, 0.25, 1),
    (seconds_per_beat * 1.5, 0.105, 0),
    (seconds_per_beat * 2.25, 0.055, 1),
]:
    mix += (
        np.roll(wet[:, ::-1] if flip else wet, round(delay * SAMPLE_RATE), axis=0)
        * level
    )
mix = np.tanh(1.65 * mix)
mix *= 0.90 / np.max(np.abs(mix))


def encode(name, samples):
    channels = 1 if samples.ndim == 1 else samples.shape[1]
    destination = Path(__file__).resolve().parents[2] / "public" / "audio" / name
    with tempfile.TemporaryDirectory() as folder:
        pcm = Path(folder) / "mix.wav"
        with wave.open(str(pcm), "wb") as output:
            output.setparams((channels, 2, SAMPLE_RATE, 0, "NONE", ""))
            output.writeframes((32767 * samples).astype("<i2").tobytes())
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(pcm),
                "-c:a",
                "libvorbis",
                "-q:a",
                "4",
                str(destination),
            ],
            check=True,
        )


encode("low-water.ogg", mix)

# A muted analog bass ostinato enters on two stars. Syncopations over the
# backbeat answer the main bass in its upper register. The clip is mono so
# the centered groove holds its position as the game's radio pan changes.
pursuit = np.zeros(LOOP_SAMPLES, np.float32)
for bar, (root, chord) in enumerate(changes):
    pattern = [
        (0.52, root + 12, 0.82),
        (0.79, root + 12, 0.49),
        (1.52, root + 19, 0.87),
        (2.27, root + 12, 0.67),
        (2.78, root + 24, 0.53),
        (3.52, root + 19, 0.91),
    ]
    if bar % 4 == 3:
        pattern.append((3.79, changes[(bar + 1) % bar_count][0] + 11, 0.55))
    for offset, pitch, accent in pattern:
        time = np.arange(round(0.27 * SAMPLE_RATE)) / SAMPLE_RATE
        phase = 2 * pi * 440 * 2 ** ((pitch - 69) / 12) * time
        pulse = sin(phase + 0.85 * exp(-time / 0.038) * sin(phase * 2))
        pulse += 0.31 * sin(phase * 2 + 0.25) + 0.24 * sin(phase * 3) * exp(
            -time / 0.057
        )
        note = 0.62 * accent * pulse * (1 - exp(-time / 0.005)) * exp(-time / 0.058)
        start = round((bar * 4 + offset) * seconds_per_beat * SAMPLE_RATE)
        pursuit[(start + np.arange(len(time))) % LOOP_SAMPLES] += note
encode("low-water-pursuit.ogg", pursuit)
