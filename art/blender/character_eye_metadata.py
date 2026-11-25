"""Calibrate the existing CC0 MakeHuman high-poly eyes without moving vertices.

The source texture has one small corneal swatch and two iris islands. Fit the
outer shell, not its front-biased vertex mean; rotate both shell layers together.
Inputs and returned vectors use glTF coordinates/UVs (Y up, V down).
"""
import numpy as np

# Centers measured from the dark pupil pixels in the original eye texture.
PUPIL_UV = ((.289009358783646, 1-.2879517671733457),
            (.7052600293837107, 1-.70044729786056))


def eye_metadata(positions, uv, triangles):
    positions = np.asarray(positions, dtype=np.float64)
    uv = np.asarray(uv, dtype=np.float64)
    labels = np.zeros((len(positions), 1), dtype=np.float32)
    # Small synthetic/legacy eyes do not claim this source-specific rig.
    if len(positions) < 128:
        return labels, []
    if not np.isfinite(positions).all() or not np.isfinite(uv).all():
        raise ValueError('Eye source contains nonfinite geometry')
    result = []
    for label, side, sign, pupil in [(1, 'left', 1, PUPIL_UV[0]), (2, 'right', -1, PUPIL_UV[1])]:
        selected = positions[:, 0] * sign > 1e-5
        # Original outer/cornea island; its mirrored eyes share these UVs.
        outer = selected & (uv[:, 0] > .87) & (uv[:, 1] > .87)
        points = np.unique(positions[outer], axis=0)
        if len(points) < 128:
            raise ValueError('Unsupported eye source: missing outer-shell calibration island')
        matrix = np.c_[2 * points, np.ones(len(points))]
        fitted, _, rank, _ = np.linalg.lstsq(matrix, (points * points).sum(axis=1), rcond=None)
        if rank != 4:
            raise ValueError('Eye shell cannot determine a spherical rotation pivot')
        center = fitted[:3]
        radius = np.sqrt(fitted[3] + center @ center)
        error = np.sqrt(np.mean((np.linalg.norm(points-center, axis=1)-radius)**2))
        if not np.isfinite(radius) or radius <= 0 or error > radius * .04:
            raise ValueError('Eye shell is too far from spherical for bounded rotation')
        iris = np.unique(positions[selected & (np.linalg.norm(uv-pupil, axis=1) < .07)], axis=0)
        if len(iris) < 24:
            raise ValueError('Unsupported eye source: missing authored pupil neighborhood')
        _, _, axes = np.linalg.svd(iris-iris.mean(axis=0), full_matrices=False)
        axis = axes[-1]
        if axis[2] < 0:
            axis = -axis
        if axis[2] < .9:
            raise ValueError('Authored iris does not face the source head front')
        labels[selected] = label
        result.append({'version': 1, 'label': label, 'side': side,
                       'pivot': center.tolist(), 'neutralAxis': axis.tolist(), 'upAxis': [0, 1, 0],
                       'radius': float(radius), 'fitRms': float(error),
                       'shellVertices': len(points), 'irisVertices': len(iris),
                       'maxYawDegrees': 8, 'maxPitchDegrees': 5})
    if np.any(labels == 0):
        raise ValueError('Eye source crosses the anatomical midline')
    triangle_labels = labels[np.asarray(triangles, dtype=int)].reshape((-1, 3))
    if np.any(triangle_labels[:, 1:] != triangle_labels[:, :1]):
        raise ValueError('Eye source triangles span two independently rotating eyes')
    return labels, result
