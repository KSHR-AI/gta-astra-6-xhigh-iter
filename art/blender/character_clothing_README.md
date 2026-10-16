# Civilian garment authoring

This pass adds original cloth surface detail and raised garment facing strips to
the existing civilian bodies. It uses the checked-in source models
`public/models/CivilianMale.glb` and `public/models/Michelle-crowd.glb`; their
existing attribution and redistribution terms still apply. The new procedural
fabric, folds, seam shading, collar/cuff strips and authoring code are project
work, with no additional downloaded art.

The editable `character_clothing.blend` contains the source body studies and
separate named facing meshes, source skin groups and packed authored textures.
The generator writes GLBs directly so it can preserve the original rigs and
every original vertex attribute exactly instead of passing the skeleton through
an armature export conversion.

## Rebuild

Use Blender 4.5, Node with this repository's dependencies, and system Python
with NumPy, Pillow and SciPy. SciPy is an offline authoring dependency only; if
it is unavailable, the texture script also looks in `/tmp/astra-cloth-python`.

```sh
python3 -m pip install --target /tmp/astra-cloth-python scipy==1.18.1
python3 art/blender/character_clothing_boundaries.py /tmp/astra-clothing-stage
python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
blender --background --factory-startup --threads 2 --python art/blender/character_clothing.py -- /tmp/astra-clothing-stage
node art/blender/character_clothing_validate.mjs /tmp/astra-clothing-stage
```

The result is a pair of **body inputs**, `CivilianMale.glb` and
`Michelle-crowd.glb`, under the staging directory. Feed these into the natural
head graft pipeline, then regenerate its LODs and index optimization. Do not
replace final `*Natural.glb` files with these head-bearing source bodies.

The Blender front/back studies show the source garment colors and rest poses.
Their original heads are hidden by discarding whole triangles for inspection,
so the open cut edge is intentionally not the final head/neck join. The graft
pipeline clips at its exact plane and supplies the natural head.

## Runtime contract

The original single body material carries `extras.clothingAuthored: true`.
Its packed `metallicRoughnessTexture` is:

| Channel | Meaning |
| --- | --- |
| R | Exact shirt dye mask |
| G | Authored fabric and preserved source roughness |
| B | Exposed-body skin mask for the existing complexion transfer |

Use metallic factor `0`, roughness factor `1`, and normal strength `.85`.
Retain the source normal convention: the male runtime material requires a Y
flip; the female does not. The gray female crop top is the authored garment;
her original yellow trousers remain unchanged and retain their separate runtime
palette selection.

Original vertices retain all source attributes. Added strips interpolate the
source skin influences and append white-to-gray `COLOR_0` facing shading, with
the original body vertices white. No additional body material or draw batch is
introduced.

| Body | Added vertices | Added triangles | Construction |
| --- | ---: | ---: | --- |
| Male | 672 | 1,008 | Raised collar and two sleeve cuffs |
| Female | 616 | 924 | Raised collar, two armholes and lower hem |

The male map remains 2048². The female source 512² image is resampled to 1024²
to hold authored seams; this does not add source photographic detail.

## Verification

`character_clothing_validate.mjs` compares the original node hierarchy, skins,
inverse bind matrices and original vertex attribute prefixes, checks normalized
new skin weights and bounded geometry growth, then skins every new vertex using
the actual Three.js humanoid animator in nine states: idle, walking, running,
two aim pitches, reload, seated driving, entry and exit. It emits
`clothing-validation.json` in the staging directory.

The generator emits `clothing-report.json` and inspected front/back Blender
renders. Final runtime verification must inspect the grafted male and female
neck joins and the added facing strips during aiming, locomotion and seated
driving; the numerical check is not a replacement for that browser inspection.
