# Civilian garment authoring

The male derivative replaces the source long, inflated shirt with an original
fitted crew shirt, set-in sleeve seams and mid-bicep cuffs. The panels reuse the
credited CC0 civilian topology as a starting surface, then subdivide and refit
it. The new opening is measured against the actual grafted neck and transfers
its supporting skin weights. Hidden original V-neck skin is discarded only
after the head graft has measured its original cut contour.

Shorter sleeves expose a newly authored upper-arm continuation. The old cuff
was a wavy clothing contour, so its small upper-arm region is refitted into a
smooth section and joined to the retained arm. These vertices and their UVs
**are deliberately changed**. Original forearms, hands, finger/grip anatomy,
feet, soles, original joint order, transforms and inverse-bind prefix remain
unchanged. Two calibrated eye joints are appended separately by the head
pipeline; they do not change original motion-track indices.

Female tapered denim, crop-top collar/armhole/hem bindings and male denim/shoe
surfaces retain their earlier authoring. The complete female derivative keeps
the original Mixamo terms; CC0 head and original garment additions do not
change those terms. The male body remains CC0. No new external garment asset
was downloaded.

## Rebuild

Use Blender 4.5, Node with repository dependencies, and Python with NumPy,
Pillow and SciPy. SciPy and meshoptimizer are offline tools only. Run the
commands in a fail-fast shell; Blender requires `--python-exit-code 1` because
its default exit status can hide Python authoring errors.

```sh
set -e
python3 art/blender/character_clothing_boundaries.py /tmp/astra-clothing-stage
python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
python3 art/blender/character_shirt_textures.py /tmp/astra-clothing-stage/textures
blender --background --factory-startup --threads 2 --python-exit-code 1 \
  --python art/blender/character_clothing.py -- /tmp/astra-clothing-stage
node art/blender/character_clothing_validate.mjs /tmp/astra-clothing-stage
```

The generator saves editable `character_clothing.blend` and stages **body
inputs** `CivilianMale.glb` and `Michelle-crowd.glb`. Feed those into the natural
head graft with explicit `--body-dir` and `--output-dir`, then generate LODs and
index optimization. Do not replace final `*Natural.glb` files with body inputs.
The combined commands are in [the appearance pipeline](README.md#deliberate-appearance-rebuild-with-facial-morphs).

## Materials and source boundaries

The final body still uses one material batch. The male 2K atlas has a proven
unused 544-pixel allocation: a restrained jersey region and two 96-by-224 skin
islands with 16-pixel guards. The new/refitted upper-arm triangles use those
broad skin islands instead of tiny original UV patches that leaked gray cuff
colors through filtering. The skin color is sampled from pure connected skin
on the same source arm; fine grain is original. Source cuff-side painted
clothing is repaired inside its audited skin-face footprint.

The original lower-hem, belt and buckle geometry and UVs remain intact. Only
pure shirt-mask texels receive the matching gray fabric surface. Whole-face
hem remapping is deliberately avoided because source triangles can cross the
shirt/waistband color boundary. Original source surfaces outside the explicitly
authored garment, cuff-skin and shoe regions remain unchanged.

The packed body texture carries R = shirt dye, G = roughness and B = skin tint.
Use metallic factor 0, roughness factor 1 and normal strength .85; retain the
male source normal-map Y correction. Material extras include
`clothingAuthored`, `trousersAuthored`, `apparelShapeAuthored`,
`crewShirtAuthored` and the measured `shirtDyeLuminance`. `_GARMENT_MASK`
separates new cloth and skin triangles for authoring validation. Female ankle
skin remains explicitly masked without tinting adjacent denim or shoes.

## Validation and limits

`male-crew-shirt.json` lists replaced shirt faces, deliberately refitted arm
vertices/faces, discarded hidden neck faces, replacement counts and bridge
seams. `male-crew-textile.json` records source UV clearance, authorized pixel
regions, source skin donors and exact preservation outside those regions.
`character_clothing_validate.mjs` checks the untouched reference rig and body
attributes, normalized replacement influences, finite/unit attributes,
noncollapsed triangles, shared contact seams and 44 posed samples per body,
including aiming, head turns, locomotion, reload and vehicle interactions.
The production shirt test independently protects source anatomy outside the
bounded upper-arm/hidden-neck exception and samples actual packed skin/cloth
texels after assembly. Eye, face, surface, LOD and index checks cover the final
combined exports.

The final reviewed male has 28,991 / 21,131 / 5,217 triangles at near/middle/far;
the female has 22,092 / 12,618 / 4,844. Each uses three character material batches.
Clay and actual-material idle, aim, head-turn and minified studies establish
source appearance, but browser playtesting remains required. A faint upper-arm
complexion/shape transition and small shoulder/clavicle creases at full aim
remain; these models are authored game meshes, not scanned humans.
