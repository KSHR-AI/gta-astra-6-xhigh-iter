"""Original procedural head micro-surface maps, authored for Grand Theft Astra.

No diffuse gradients or photographed lighting are interpreted as geometry.
Pore relief is a deterministic band-limited height field in the original UV
image domain, so separately packed islands sample the same continuous signal.
Normal directions are glTF/OpenGL tangent-space +Y; glTF strength is set by the
atlas material. Hair has independent directional strand relief; eyes, brows
and lashes remain neutral. NumPy/Pillow only.
"""
import numpy as np
from PIL import Image


def resize_scalar_channels(channels, size):
    """Filter packed RGBA data independently; alpha is intensity, not opacity."""
    return Image.merge('RGBA', tuple(Image.fromarray(channels[:, :, channel]).resize(size, Image.Resampling.BOX)
                                    for channel in range(4)))


def _noise(width, height, cells, seed):
    rng = np.random.default_rng(seed)
    source = np.rint(rng.uniform(0, 255, (max(2, round(height / width * cells)), cells))).astype(np.uint8)
    image = Image.fromarray(source).resize((width, height), Image.Resampling.BICUBIC)
    return np.asarray(image, dtype=np.float32) / 255.0 - 0.5


def author_surface_maps(width, height, kind, seed=731, source_roughness=.85):
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
        # Long, gently swept fibers follow the source strip's V direction.
        # This relief is authored independently of painted color/alpha, so
        # dark gaps never become deep grooves and the hairline stays intact.
        u, v = np.meshgrid(np.arange(width) / width, np.arange(height) / height)
        phase = 2 * np.pi * (u * max(5, width / 7) + .22 * np.sin(v * 2 * np.pi)
                             + .08 * np.sin(v * 4 * np.pi + u * 2 * np.pi))
        relief = np.sin(phase) + .22 * np.sin(phase * 2 + .6)
        dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * .055
        dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * .055
        vector = np.stack([-dx, -dy, np.ones_like(dx)], axis=2)
        vector /= np.linalg.norm(vector, axis=2, keepdims=True)
        normal = np.rint((vector * .5 + .5) * 255).astype(np.uint8)
        # Keep the editable Blender material's matte response. The previous
        # atlas silently replaced its .85 roughness with a glossier .66.
        strands = _noise(width, 2, max(2, width // 5), seed + 3).mean(axis=0)
        broad = _noise(width, height, 19, seed + 4)
        rough = np.clip(source_roughness + strands[None, :] * .045 + broad * .02,
                        max(.0, source_roughness - .04), min(1., source_roughness + .04))
    else:
        rough = np.full((height, width), .24 if kind == 'eye' else .85, dtype=np.float32)
    return normal, np.rint(rough * 255).astype(np.uint8)
