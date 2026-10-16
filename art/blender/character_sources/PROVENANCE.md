# Fitted MakeHuman head components

All mesh, morph, skin, eye, hair, eyebrow and eyelash inputs used here are official MakeHuman Community core graphical assets, released under CC0-1.0. No MakeHuman application code is incorporated in the fitted mesh exports or the project-authored rebuild scripts. This CC0 statement applies to the head components; the body and animation terms remain separate, as documented in [ASSETS.md](../../../ASSETS.md).

First-party licensing:

- https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md
- https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md
- https://static.makehumancommunity.org/about/license.html
- https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html (individual asset catalog explicitly marks these inputs CC0)

Sources:

- `base.obj`: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj
- `caucasian-male-young.target`: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/targets/macrodetails/caucasian-male-young.target
- `caucasian-female-young.target`: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/targets/macrodetails/caucasian-female-young.target
- Official asset pack: https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip

Selected pack paths:

- `skins/young_caucasian_male/young_lightskinned_male_diffuse.png`
- `skins/young_caucasian_female/young_lightskinned_female_diffuse.png`
- `eyes/high-poly/high-poly.obj` and `.mhclo`
- `eyes/materials/brown_eye.png`
- `hair/short04/short04.obj`, `.mhclo`, `short04_diffuse.png` (male primary)
- `hair/ponytail01/ponytail01.obj`, `.mhclo`, `ponytail01_diffuse.png` (female primary)
- `hair/short02/short02.obj`, `.mhclo`, `short02_diffuse.png` (male alternative, hidden and omitted from GLB)
- `hair/bob01/bob01.obj`, `.mhclo`, `bob01_diffuse.png` (female alternative, hidden and omitted from GLB)
- `eyebrows/eyebrow001/eyebrow001.obj`, `.mhclo`, `.png` (male)
- `eyebrows/eyebrow003/eyebrow003.obj`, `.mhclo`, `.png` (female)
- `eyelashes/eyelashes01/eyelashes01.obj`, `.mhclo`, `.png` (both)

Authors identified by the bundled CC0 notices: MakeHuman Community; Data Collection AB; Joel Palmius; Jonas Hauquier. Attribution is recorded voluntarily; CC0 does not require it.

## Fitting and coordinate contract

The fitted geometry is stored in `art/blender/character_humans.blend`. Its original construction added the single sex/age macro target's vertex deltas to the base OBJ (zero-based target indices). The default average-muscle/average-weight target contains no displacement, so is not needed. The original body group's polygons are isolated and bisected at native Y=6.62 male / Y=5.16 female. UVs are retained through the cut, with no body/clothes/helper geometry in the exported head meshes.

The MHCLO files define each accessory vertex as three base vertex indices, barycentric weights, and XYZ offsets; offsets are scaled by the named head dimension ratios. This fitting is applied to the complete morphed 19,158-vertex base, including helpers used by the eye and hair fits. The final eye, hair, eyebrow and eyelash objects are separate named meshes.

Native MakeHuman coordinates are Y-up / +Z forward, approximately decimeters. The Blender library bakes `MH(x,y,z) -> Blender(x,-z,y)` into mesh positions, with identity object transforms. GLB Y-up export restores original native MH coordinates (no unit rescaling or translation). The original cut planes remain Y=6.62 for male and Y=5.16 for female. The packed mesh coordinates preserve those native bounds for the later body graft.

The `.blend` keeps original quad topology plus a reversible single-level preview subdivision modifier on heads. GLBs omit preview subdivision and export the original detailed cage, triangulated by glTF. Nothing is decimated. Hair and eye PNG alpha are wired to the PBR material; eye alpha is essential because the source includes transparent outer shell UVs. Hair uses roughness .85, reduced specular and a natural dark brown color multiplier. Skin uses roughness .48 and a small subsurface contribution in Blender. Textures are packed: skin 2048x2048; hair and eyes no larger than 1024x1024; brows and lashes 512x512. The resized working textures are packed into the `.blend`; the original images remain available from the official asset pack. `source-manifest.json` records its SHA-256 and the pinned upstream base-mesh/morph commit.

## Packed source and rebuild

The repository's reproducible pipeline is:

1. `art/blender/character_humans.blend` stores the `MakeHuman_male` and `MakeHuman_female` collections with packed textures, original quad cages, and reversible preview subdivision. Hidden alternative hairstyles are retained.
2. `art/blender/character_humans.py` exports the primary components as temporary `male_head.glb` and `female_head.glb` files without changing the source `.blend`. It omits preview subdivision and preserves the Blender hair multiplier as a linear glTF color factor.
3. `art/blender/character_head_atlas.py` packs those components into the atlases described below.
4. `art/blender/character_humans.mjs` fits the selected heads to the existing clothed bodies, weights the new geometry to the existing neck/head bones with the original body-weight mixture at the female neck boundary, and writes `public/models/CivilianMaleNatural.glb` and `public/models/CivilianFemaleNatural.glb`. The original skeleton nodes, hierarchy, and inverse bind matrices are preserved. Female headphone-edge remnants are removed before fitting the neck contour; its boundary overlaps the original body by 1.5 mm and inherits the original joint mixture to keep the join closed during head motion.

Run the exact commands in the [Blender README](../README.md#civilian-head-rebuild). Blender 4.5, Python with Pillow/NumPy, and the project's Node dependencies are required. Reproduction starts from the packed `.blend`, so the original 281 MB asset pack, loose OBJ/MHCLO inputs, and temporary asset-study renders are not needed in the checkout.

The final characters retain the original body licenses: EmoPreben's male body is CC0; Mixamo Michelle's female body remains subject to Adobe Mixamo terms. The common locomotion likewise retains its Mixamo terms. New head components do not change those licenses. The heads have no facial-expression rig or lip sync; their motion comes from the existing head/neck bones and gameplay pose layers.

## Atlas optimization

`art/blender/character_head_atlas.py` takes an input/output directory argument (defaults to its own directory). It reads `male_head.glb` and `female_head.glb`, crops each connected skin/eye/brow/lash UV island independently, preserves overlapping hair strip UVs in one tile, and packs an RGBA 2048 atlas without reducing face texel density. Each tile has eight pixels of padding. Original repeat wrapping is retained for the few hair UVs extending outside 0–1. Hair's linear PBR multiplier is baked through sRGB decoding/encoding rather than multiplied directly in gamma space.

The roughness map is 1024 square, with the glTF G channel .64 for skin, .24 for eyes and .85 for hair/brows/lashes. Metallic is zero. Custom scalar float vertex attributes `_SKIN_MASK` and `_HAIR_MASK` permit later skin/hair variation without changing eye color. `_SKIN_MASK` marks only skin; `_HAIR_MASK` marks hair, brows and lashes.

Outputs in the selected temporary directory:

- `optimized_male_head.glb` / `optimized_female_head.glb`: one mesh/primitive/material with alpha MASK cutoff .3. Their skin is opaque, while eye/hair/brow/lash texture alpha is preserved for the cutoff.
- `soft_male_head.glb` / `soft_female_head.glb`: recommended two-draw alternative. The same atlas is shared by MASK skin/eyes/hair and a second BLEND primitive for brows/lashes, which preserves their fine translucent strands. Hair stays MASK to avoid layered transparency sorting artifacts.
- `atlas-report.json` records the head geometry and file sizes; the graft step additionally writes `integrated-report.json`.

The shipped graft uses the soft variant: one body material plus two head materials, for three material batches per character. Complete body/head meshes contain 20,129 male / 21,168 female triangles. Offline Blender renders of the actual optimized GLBs were inspected during authoring; browser/gameplay verification is a separate requirement.

Validation confirms that positions and normals are bit-exact versus the five-mesh input; the one-draw triangle index sequence is bit-exact; the two-draw variant contains exactly the same triangle multiset. Maximum sampled linear texture color difference is 0.00155 (rounding from baked 8-bit color tint); mean per-channel difference is below 0.00008. Both preserve 12,366 male / 16,792 female triangles, with no decimation.
