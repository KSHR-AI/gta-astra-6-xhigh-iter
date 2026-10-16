"""Original, repeatable road and cast-iron PBR surfaces for Grand Theft Astra.

Run with Python 3, NumPy and Pillow. No photographs or downloaded texture inputs
are used. The asphalt's 2.4 metre tile has small, subdued aggregate; broad wear
is applied in world space at runtime rather than repeated in this tile.
"""
from pathlib import Path
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/textures/city'


def periodic_noise(size, sigma, seed):
    """A band-limited field on a torus, including a seamless filtered border."""
    rng = np.random.default_rng(seed)
    frequency = np.fft.fftfreq(size)
    radius = frequency[:, None] ** 2 + frequency[None, :] ** 2
    field = np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) *
                         np.exp(-2 * np.pi ** 2 * sigma ** 2 * radius)).real
    return field / max(field.std(), 1e-8)


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(height, strength):
    # OpenGL (+Y) tangent-space normals. Image rows run opposite texture V.
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    normal = np.stack((-dx, dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal * 127.5 + 127.5


def save(name, value):
    image = Image.fromarray(np.clip(value, 0, 255).astype(np.uint8))
    image.save(OUT / f'{name}.jpg', quality=93, subsampling=0, optimize=True)
    return image


def asphalt():
    size = 1024
    aggregate = periodic_noise(size, 1.6, 341)
    sand = periodic_noise(size, .58, 932)
    binder = periodic_noise(size, 12, 41)
    weather = periodic_noise(size, 54, 121)
    stones = smoothstep(.05, 1.7, aggregate)
    # Aggregate is a small tonal shift, not white dots or baked light/shadow.
    luminance = 91 + 7.5 * stones + 1.2 * sand + 1.5 * binder + 1.3 * weather
    color = np.stack((luminance * 1.012, luminance * 1.006, luminance * .975), -1)
    height = .26 * aggregate + .07 * sand
    roughness = 211 - 11 * stones + 2 * binder + 1.4 * sand
    return [save('asphalt-fine-color', color),
            save('asphalt-fine-normal', normal_from_height(height, .42)),
            save('asphalt-fine-rough', roughness)]


def manhole():
    size = 512
    y, x = np.mgrid[:size, :size]
    u, v = (x + .5 - size / 2) / (size / 2), (y + .5 - size / 2) / (size / 2)
    radius = np.hypot(u, v)
    grain = periodic_noise(size, .7, 922)
    patina = periodic_noise(size, 18, 219)
    height = .014 * grain
    edge = 1 - smoothstep(.91, .96, radius)
    face = 1 - smoothstep(.76, .79, radius)
    # A raised, open diamond tread surrounds the cast maker's plaque.
    diagonal_a = np.abs(np.sin((u + v) * np.pi * 7))
    diagonal_b = np.abs(np.sin((u - v) * np.pi * 7))
    tread = (1 - smoothstep(.1, .32, np.minimum(diagonal_a, diagonal_b))) * face
    plaque = (1 - smoothstep(.40, .43, np.abs(u))) * (1 - smoothstep(.19, .22, np.abs(v)))
    tread *= 1 - plaque
    height += .9 * tread + .48 * plaque
    ring = 1 - smoothstep(.012, .026, np.abs(radius - .855))
    height += .7 * ring
    groove = 1 - smoothstep(.006, .015, np.abs(radius - .935))
    # Two narrow lifting recesses, authored in the height/albedo, not open holes.
    pockets = np.zeros_like(radius)
    for side in (-1, 1):
        pocket = (1 - smoothstep(.10, .12, np.abs(u))) * (1 - smoothstep(.025, .04, np.abs(v - side * .70)))
        pockets = np.maximum(pockets, pocket)
    height -= 1.35 * pockets + .48 * groove
    lettering = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(lettering)
    font_path = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
    font = ImageFont.truetype(font_path, 32)
    small = ImageFont.truetype(font_path, 16)
    draw.text((size / 2, size / 2 - 12), 'ASTRA', fill=255, font=font, anchor='mm')
    draw.text((size / 2, size / 2 + 23), 'PUBLIC WORKS', fill=255, font=small, anchor='mm')
    letters = np.asarray(lettering).astype(float) / 255
    height += .4 * letters
    luminance = 89 + 2.5 * grain + 4 * patina + 7 * tread + 9 * ring + 6 * letters
    luminance -= 38 * pockets + 23 * groove + 15 * (1 - edge)
    color = np.stack((luminance * 1.01, luminance, luminance * .96), -1)
    roughness = 207 + 3 * grain + 5 * patina - 23 * tread - 28 * ring - 10 * letters
    return [save('manhole-color', color),
            save('manhole-normal', normal_from_height(height, 1.8)),
            save('manhole-rough', roughness)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', type=Path, help='Optional original surface contact sheet')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    road = asphalt()
    iron = manhole()
    if args.preview:
        sheet = Image.new('RGB', (1536, 1064), '#22282b')
        draw = ImageDraw.Draw(sheet)
        for row, (name, maps) in enumerate((('2.4 m fine asphalt', road), ('0.954 m cast-iron cover', iron))):
            for column, (channel, image) in enumerate(zip(('Color', 'OpenGL normal', 'Roughness'), maps)):
                draw.text((column * 512 + 12, row * 532 + 6), f'{name} / {channel}', fill='#f3efdf')
                sheet.paste(image.resize((512, 512)), (column * 512, row * 532 + 20))
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.preview)
    for name in ('asphalt-fine', 'manhole'):
        print(f'Created original {name} color / OpenGL normal / roughness maps')


if __name__ == '__main__':
    main()
