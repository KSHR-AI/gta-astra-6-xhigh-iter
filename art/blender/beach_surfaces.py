"""Original seamless coastal sand maps for Grand Theft Astra.

Python 3 / NumPy / Pillow. No photographs or downloaded texture sources.
A 2.4 m tile contains fine quartz grain, sparse pale shell flecks and shallow,
broken wind ripples. Broad weather and shore wetness belong to world space,
so no dark patches or shoreline are baked into the repeated color map.
"""
from pathlib import Path
import argparse
import json
import hashlib
import numpy as np
from PIL import Image, ImageDraw

TILE_METRES = 2.4


def periodic_noise(size, sigma, seed):
    rng = np.random.default_rng(seed)
    frequency = np.fft.fftfreq(size)
    radius = frequency[:, None] ** 2 + frequency[None, :] ** 2
    field = np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) *
                         np.exp(-2 * np.pi ** 2 * sigma ** 2 * radius)).real
    return field / max(field.std(), 1e-8)


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_metres(height):
    # OpenGL (+Y) tangent normals; image rows run opposite texture V.
    step = TILE_METRES / height.shape[0]
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * step)
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * step)
    normal = np.stack((-dx, dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal


def create_maps(size=1024):
    y, x = np.mgrid[:size, :size]
    u, v = (x + .5) / size, (y + .5) / size
    grain = periodic_noise(size, .65, 73014)
    clusters = periodic_noise(size, 2.1, 19083)
    deposits = periodic_noise(size, 28, 8256)
    drift = periodic_noise(size, 84, 7352)
    patch = periodic_noise(size, 62, 4701)
    # Integer-frequency phase plus a periodic warp keeps every border seamless.
    phase = np.pi * 2 * (17 * u + 5 * v) + drift * 1.1
    ripples = (np.cos(phase) + .25 * np.cos(2 * phase + .65))
    ripple_mask = smoothstep(-.8, 1.3, patch) * .85
    shells = smoothstep(1.75, 2.8, clusters) * smoothstep(.0, 1.0, grain)
    dark_grains = smoothstep(1.2, 2.4, -clusters) * .8
    # Albedo carries material color only, with no directional ripple shading.
    variation = 1.8 * grain + 1.3 * clusters + 1.4 * deposits
    color = np.stack((211 + variation + 6 * shells - 4 * dark_grains,
                      195 + variation + 6 * shells - 4 * dark_grains,
                      162 + variation + 7 * shells - 4 * dark_grains), axis=-1)
    height = .00010 * grain + .00015 * clusters + .0013 * ripple_mask * ripples
    normal = normal_from_metres(height)
    roughness = np.clip(237 + 1.2 * grain + 2 * deposits - 8 * shells, 224, 248)
    return color, normal * 127.5 + 127.5, roughness, normal, height


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True,
                        help='Stage explicitly; promote reviewed maps to public/textures/beach')
    parser.add_argument('--preview', type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    color, normal, roughness, vectors, height = create_maps()
    images = []
    files = []
    for name, pixels in [('sand-color', color), ('sand-normal', normal), ('sand-rough', roughness)]:
        image = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))
        if name == 'sand-rough':
            image = image.resize((512, 512), Image.Resampling.LANCZOS)
        target = args.output_dir / f'{name}.jpg'
        image.save(target, quality=94, subsampling=0, optimize=True)
        images.append(image)
        files.append({'name': target.name, 'size': target.stat().st_size,
                      'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    if args.preview:
        sheet = Image.new('RGB', (1536, 548), '#20282b')
        draw = ImageDraw.Draw(sheet)
        for i, (label, image) in enumerate(zip(('Sand albedo / 2.4 m', 'OpenGL normal / millimetre relief', 'Dry roughness / shoreline applied in world space'), images)):
            draw.text((i * 512 + 10, 10), label, fill='#f2eadc')
            sheet.paste(image.resize((512, 512)), (i * 512, 36))
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.preview)
    # Border steps should be of the same order as ordinary adjacent pixels:
    # a seamless field need not duplicate its first and last texel centres.
    seams = {}
    for name, pixels in [('color', color), ('normal', normal), ('roughness', roughness)]:
        seams[name] = {'wrap_x_mean': float(np.abs(pixels[:, 0] - pixels[:, -1]).mean()),
                       'inside_x_mean': float(np.abs(np.diff(pixels, axis=1)).mean()),
                       'wrap_y_mean': float(np.abs(pixels[0] - pixels[-1]).mean()),
                       'inside_y_mean': float(np.abs(np.diff(pixels, axis=0)).mean())}
    report = {'tileMetres': TILE_METRES, 'files': files, 'heightRangeMetres': [float(height.min()), float(height.max())],
              'normalZMinimum': float(vectors[..., 2].min()), 'normalSlopeRMS': float(np.sqrt(np.mean(vectors[..., :2] ** 2))),
              'seams': seams, 'textureGpuBytesWithMips': int((1024 * 1024 * 2 + 512 * 512) * 4 * 4 / 3)}
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
