"""Original procedural head micro-surface maps, authored for Grand Theft Astra.

No diffuse gradients or photographed lighting are interpreted as geometry.
Pore relief is a deterministic band-limited height field in the original UV
image domain, so separately packed islands sample the same continuous signal.
Normal directions are glTF/OpenGL tangent-space +Y; glTF strength is set by the
atlas material. Non-skin pixels remain neutral. NumPy/Pillow only.
"""
import numpy as np
from PIL import Image


def _noise(width, height, cells, seed):
    rng = np.random.default_rng(seed)
    source = np.rint(rng.uniform(0, 255, (max(2, round(height / width * cells)), cells))).astype(np.uint8)
    image = Image.fromarray(source).resize((width, height), Image.Resampling.BICUBIC)
    return np.asarray(image, dtype=np.float32) / 255.0 - 0.5


def author_surface_maps(width, height, kind, seed=731):
    """Return RGB normal and scalar roughness maps at source-image resolution."""
    normal = np.empty((height, width, 3), dtype=np.uint8)
    normal[:] = [128, 128, 255]
    if kind == 'skin':
        # Subtle pores: no wrinkles, baked shadows, or large face-shape relief.
        # At half-resolution atlas/mips this filters into a soft microtexture.
        pores = _noise(width, height, max(2, width // 3), seed)
        fine = _noise(width, height, max(2, width // 6), seed + 1)
        height_field = .7 * pores + .3 * fine
        dx = (np.roll(height_field, -1, axis=1) - np.roll(height_field, 1, axis=1)) * .09
        dy = (np.roll(height_field, -1, axis=0) - np.roll(height_field, 1, axis=0)) * .09
        # Source rows follow increasing glTF V in this atlas pipeline.
        vector = np.stack([-dx, -dy, np.ones_like(dx)], axis=2)
        vector /= np.linalg.norm(vector, axis=2, keepdims=True)
        normal = np.rint((vector * .5 + .5) * 255).astype(np.uint8)
        broad = _noise(width, height, 23, seed + 2)
        rough = np.clip(.64 + broad * .065 + pores * .025, .60, .68)
    elif kind == 'hair':
        # Strand-oriented response varies across U, with gentle V variation.
        strands = _noise(width, 2, max(2, width // 5), seed + 3).mean(axis=0)
        broad = _noise(width, height, 19, seed + 4)
        rough = np.clip(.66 + strands[None, :] * .11 + broad * .035, .59, .73)
    else:
        rough = np.full((height, width), .24 if kind == 'eye' else .85, dtype=np.float32)
    return normal, np.rint(rough * 255).astype(np.uint8)
