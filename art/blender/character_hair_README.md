# Short swept hair authoring

The male hairstyle retains the credited CC0 MakeHuman `short04` scalp and its
packed fiber/alpha image. The former 21 long overlay cards had nearly opaque
outer edges and obscured the scalp's finer hairline. This pass removes those
cards and the old dense crown ribbons.

The retained scalp receives one applied subdivision and original geometric
shaping: a restrained asymmetric short sweep, shallow directional crown
ridges and a closer nape. Local vertex and triangle-interior clearance passes
repair exposed skin pinholes without changing the head. A denser 12-division
barycentric check validates the exposed scalp above the ears; it does not claim
clearance for the lower shell that tucks behind the ear surfaces. Sixteen
original narrow, tapered locks add sparse
crown/side silhouette detail with roots buried inside the scalp; the forehead
and temples retain the source's fine feathered hairline. These are deliberately
small accents rather than broad opaque plates.

`character_humans.blend` contains the editable result and an unexported,
fake-user mesh named `Astra short04 complete source`. That datablock preserves
the full original mesh and `astra_hair_rest` coordinates so the authoring pass
starts from the same source on every run. `character_hair_authoring.py` performs
the construction; `character_face_authoring.py` calls it. Head, eyes, brows,
lashes, neck and blink target coordinates are outside this pass.

```sh
blender --background --factory-startup --threads 2 --python art/blender/character_face_authoring.py -- --hair-only
blender --background --factory-startup --threads 2 --python art/blender/character_humans.py -- /tmp/astra-hair-stage/export
python3 art/blender/character_head_atlas.py /tmp/astra-hair-stage/export
```

The existing source matte response remains: roughness `0.85`, Blender specular
level `0.2` / glTF intensity `0.4`. The original source scalp image is unchanged.
A small original 128×256 lock image has dense centers and feathered strand
perimeters; geometry supplies the root/tip taper. The atlas still uses its
existing masked hair batch, scalar roughness/specular channels and normal map.
The base hairstyle retains a 32-pixel atlas guard; narrow locks use 192 pixels
to isolate a full bilinear footprint through mip 7 at every packing alignment.
Both fit within the existing 2K atlas. No runtime batch or extra image is added.

The hairstyle contains 2,048 scalp triangles and 320 accent triangles: 2,368
in total, compared with the prior 2,856. Final body/head fitting, distance meshes
and indexing remain downstream steps. Check the silhouette, hairline and police
cap in the actual game after those steps; source studio renders do not prove
runtime mip behavior or accessory clearance.
