# Eyelid morphs and original hair refinement

The existing MakeHuman head cages, UVs, eyeballs and skin rest positions remain unchanged. This update adds two relative shape keys to each skin mesh and its fitted eyelash mesh: `blinkLeft` and `blinkRight`. Values run from zero (original open-eye rest pose) to one (full skin-and-lash closure). Neither target scales or moves the eyeball. No jaw, mouth interior, teeth, lip sync or expression system is introduced.

## Additional CC0 graphical inputs

The source displacement tables are the official MakeHuman Community **faceunits01** graphical assets in [extra-targets](https://github.com/makehumancommunity/extra-targets/tree/7eaba3453134385bb5ea9811ef0b33b85b4b556d). That repository licenses its contents under [CC0 1.0](https://github.com/makehumancommunity/extra-targets/blob/7eaba3453134385bb5ea9811ef0b33b85b4b556d/LICENSE). The existing [CC0 license copy](LICENSE-MAKEHUMAN-CC0.md) applies to these additional assets as well. No MakeHuman application or plugin code is incorporated.

Pinned upstream commit: `7eaba3453134385bb5ea9811ef0b33b85b4b556d`.

| Copied graphical asset | Official source path | SHA-256 |
| --- | --- | --- |
| `eyeBlinkLeft.target` | `assets/faceunits01/targets/faceunits/eyeBlinkLeft.target` | `53d35e0a8357140d4e37277a674f211bdaf97be011b61cfcdff618f0bfea0ec8` |
| `eyeBlinkRight.target` | `assets/faceunits01/targets/faceunits/eyeBlinkRight.target` | `00d159a70fad650b336eb6f739a1a6a47f916da4331ef9848fb0eef989ca5cc5` |

`face_vertex_map.json` is an original mapping from the current fitted Blender mesh indices to the existing pinned MakeHuman `hm08` base indices. Head vertices were matched to the original base plus the sex-specific macro target; maximum coordinate error was below `0.0000005` native units. The generated neck-cut vertices have index `-1` and receive no displacement. Eyelash vertices map to their original MakeHuman helper indices from `eyelashes01.mhclo`. The source rest-position SHA-256 values are checked before authoring to prevent using the table after an unreviewed topology or rest-shape change.

Target displacement vectors undergo the same axis conversion as the existing meshes: native `(x, y, z)` becomes Blender `(x, -z, y)`. Each target affects 718 source skin vertices and 65 lash vertices. Source normals are recomputed for the closed surface; the glTF export includes relative POSITION and NORMAL targets with default weights zero.

## Original hair artwork

The male `short04` hair remains the credited CC0 base. Original procedural edits tighten and taper its nape, add a slight asymmetric sweep to the crown, and align shading normals across disconnected cards to reduce the appearance of rigid overlapping plates. The original cage positions remain stored in the editable `astra_hair_rest` mesh attribute, so regeneration is repeatable.

The new `male_hair_strands` mesh adds 129 small curved locks, totaling 1,806 triangles. Its 64 × 256 RGBA strand texture is generated from original analytic fiber strokes and packed in the `.blend`; it contains no downloaded texture content. Strands follow the existing hair surface, taper at their tips and avoid the transparent forehead region. These original additions introduce no additional third-party asset license.

## Rebuilding

From the repository root with Blender 4.5 LTS:

```sh
blender --background --factory-startup --threads 2 --python art/blender/character_face_authoring.py
blender --background --factory-startup --threads 2 --python art/blender/character_humans.py -- /tmp/astra-face-stage
```

The first command updates the packed editable head library idempotently. The second exports staging meshes without applying modifiers, preserving the morph targets and original cage geometry. Continue with the atlas, graft and LOD commands in the [Blender README](../README.md).

For source review images, append `-- --render-only` to the authoring command. `--male-only` narrows the render to the male head; `--back-view` renders the open-eye back view. Preview subdivision is disabled so the source review uses the exported cage topology. Source images are written under `/tmp/astra-face-*`; they supplement browser verification and do not prove the integrated game appearance.

Blender's shape-key export introduces small recomputed normal deltas on untouched face vertices. The exporter removes these theoretical zeros outside two triangle-adjacency rings around moved vertices, including coincident position aliases at UV seams. Two rings conservatively cover the original quad adjacency. It preserves every POSITION displacement and the original exported NORMAL displacement inside the affected region. This prevents tiny unrelated normal differences from locking the entire face against distance simplification. The original head positions and base normals are not changed by this cleanup.
