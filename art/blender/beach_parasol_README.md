# Original beach parasol

This is original project-authored geometry and a deterministic original canvas
normal map. It incorporates no third-party mesh, photograph, texture or logo.
The editable source is `beach_parasol.blend`; `beach_parasol.py` recreates the
source and both runtime levels from metric dimensions.

```sh
blender --background --factory-startup --threads 2 --python-exit-code 1 \
  --python art/blender/beach_parasol.py -- /tmp/astra-parasol-stage --preview
```

The output directory is required. Runtime exports and optional studio renders
remain staged there; the command does not overwrite `public/models/`. The
editable `.blend` beside the script is refreshed before export joins are made.
It retains named individual fabric panels, scalloped valances, seam/hem folds,
bowed ribs, stretchers, pole and fittings, with a separate hidden far-detail
collection. Its camera, ground and lighting are excluded from the GLBs.

The eight-panel canopy spans 3 metres. The ferrule reaches 2.61 metres above the
ground origin. A small mast spigot extends to -0.08 metres and is deliberately
buried when the object is placed at the sand height. The edge has 3.5–8 cm
valances; it is not a thick solid roof. A two-sided fabric material provides the
underside without duplicating every canopy triangle. Narrow rolled seams and
hems catch light geometrically. The canvas normal is a subtle, seamless 64²
warp/weft image, embedded in each GLB. Canvas color is uniform for instance tint.

| Export | Triangles | Bytes | Material batches |
| --- | ---: | ---: | ---: |
| `BeachParasol.glb` | 5,152 | 135,560 | 3 |
| `BeachParasol-lod.glb` | 808 | 27,744 | 3 |

Byte sizes describe the current Blender 4.5 export. `BeachParasol.json` records
fresh counts and sizes on every rebuild. Both levels have the same bounds and
identity node transforms, in glTF Y-up metres. Each level contains
`BeachParasol_Canopy`, `BeachParasol_Frame`, and `BeachParasol_Hardware` nodes.
The near level retains radial seam/hem folds and end pockets; the far level
preserves the bowed silhouette, scalloped edge and structural supports.

The runtime helper uses three shared material batches at each active level,
with per-instance color only on the canopy. It selects detail by distance and
camera field of view, with hysteresis. Its dynamic instance buffers must not
also be registered with the world's independent instance compactor. The helper
offers `restore()` for all-near shadow/reflection passes, and the regular camera
`update(camera)` restores normal detail selection. It keeps every placement in
one level so an offscreen parasol can still cast a shadow.

Missing high detail falls back to the authored far export. Missing both exports
uses a small original curved-canopy fallback. These fallbacks keep the world
playable but do not establish the intended asset quality. Inspect the actual
integrated near and far meshes in the browser before promoting rebuilt exports;
the studio renders only establish authored geometry and material appearance.
