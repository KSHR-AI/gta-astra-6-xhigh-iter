# Civilian garment authoring

This pass authors garment fit, fabric surfaces and raised facing strips on the
checked-in `public/models/CivilianMale.glb` and `public/models/Michelle-crowd.glb`
bodies. Their existing attribution and redistribution terms still apply. The
new tailoring, procedural denim/cotton, folds, seam and pocket shading,
collar/cuff strips and authoring code are original project work.

Female trousers are reshaped from the source balloon silhouette into tapered
denim. The male shirt and jeans gain modest fabric ease and compression folds.
These are deliberate edits to selected original garment POSITION/NORMAL values;
they are not unchanged source geometry. Source vertex IDs, triangles, UVs,
joints and skin weights remain exact. Exposed skin, hands, soles and the source
neck/cuff/hem contact anchors remain outside the edit. Tight male underarm and
inside-thigh joins retain their source fit to avoid offsetting opposing faces
into one another.

The editable `character_clothing.blend` includes source body studies with
`Imported garment reference` and `Tailored apparel` shape keys, separate named
facing meshes, source skin groups and packed authored textures. The generator
writes GLBs directly to preserve the rig and inverse binds exactly instead of
passing the skeleton through an armature export conversion.

## Rebuild

Use Blender 4.5, Node with this repository's dependencies, and system Python
with NumPy, Pillow and SciPy. SciPy is an offline authoring dependency only; if
unavailable, the texture script also looks in `/tmp/astra-cloth-python`.

```sh
python3 -m pip install --target /tmp/astra-cloth-python scipy==1.18.1
python3 art/blender/character_clothing_boundaries.py /tmp/astra-clothing-stage
python3 art/blender/character_clothing_textures.py /tmp/astra-clothing-stage/textures
blender --background --factory-startup --threads 2 --python art/blender/character_clothing.py -- /tmp/astra-clothing-stage
node art/blender/character_clothing_validate.mjs /tmp/astra-clothing-stage
```

Finish texture generation before launching Blender: the generator embeds and
packs those PNGs. `character_apparel_shape.py` is applied automatically. The
result is a pair of **body inputs**, `CivilianMale.glb` and
`Michelle-crowd.glb`, under the staging directory. Feed them into the natural
head graft pipeline, then regenerate its LODs and index optimization. Do not
replace final `*Natural.glb` files with these head-bearing source bodies.

The front/back Blender studies show authored garment colors and rest poses.
Original heads are hidden by discarding whole triangles for inspection, so the
open neckline is intentionally not the final head/neck join. The graft pipeline
clips at its exact plane and supplies the natural head.

## Materials and runtime contract

The single body material carries `extras.clothingAuthored: true`,
`extras.trousersAuthored: true` and `extras.apparelShapeAuthored: true`.
`trousersAuthored` bypasses the legacy yellow-trouser/knee recoloring and male
trouser brightness lift: the denim now has an authored color and surface.
`extras.shirtDyeLuminance` records the measured linear shirt luminance used by
the runtime's multiplicative shirt dye, preserving source fold contrast.

The packed `metallicRoughnessTexture` is:

| Channel | Meaning |
| --- | --- |
| R | Shirt-only dye mask, excluding denim waistband and binding |
| G | Authored fabric and preserved source roughness |
| B | Exposed-body skin mask for complexion transfer |

Use metallic factor `0`, roughness factor `1`, and normal strength `.85`.
Retain the source normal convention: male runtime normals require a Y flip;
female normals do not. The female source yellow/cyan trouser graphics and their
normal-map relief are replaced with continuous denim. Original procedural
textures add restrained twill, double side seams, waistband/hem stitching,
front and rear pockets, fly detail and compression folds. The crop-top binding
is dark cotton. Source exposed-skin color/normal texels remain exact. Exposed female ankles
receive skin channel B through their two connected UV components; the mask
is added only after garment shading calculations, so it does not change
diffuse/normal textures or packed R/G. Shoes and denim remain outside it.

Added strips interpolate source skin influences and append white-to-gray
`COLOR_0` facing shading; original body vertices are white. No extra body
material or draw batch is introduced. Tailoring changes no topology and adds
no triangles beyond these existing facing strips:

| Body | Added vertices | Added triangles | Construction |
| --- | ---: | ---: | --- |
| Male | 672 | 1,008 | Raised collar and two sleeve cuffs |
| Female | 616 | 924 | Raised collar, two armholes and lower hem |

The male map remains 2048². The female source 512² image is resampled to 1024²
to hold authored seams; this does not add source photographic detail.

## Verification

Each `*-apparel-shaping.json` lists every deliberately edited source vertex and
all pinned contact anchors. `character_clothing_validate.mjs` independently
compares original node hierarchy, skins and inverse binds; requires original
JOINTS/WEIGHTS/UV attributes and triangle IDs to stay exact; and allows
POSITION/NORMAL changes only at the reported garment selection. Every
unselected position/normal must remain exact. It also protects hand, finger,
foot and toe influences, checks normalized added weights and bounds added
geometry.

The validator uses the shared neutral-stature measurement, then skins all
vertices with the actual Three.js humanoid animator in nine states: idle,
walking, running, two aim pitches, reload, seated driving, entry and exit. It
samples four phases per state (36 poses per body), compares the authored
garment against original positions under the same posed skeleton, rejects
newly collapsed triangles, checks bounded displacement and source-facing orientation,
and requires unselected skin, contact seams and shoes to move identically. It
emits `clothing-validation.json`; texture generation emits a separate byte
proof and shirt luminance report.

The generator also emits `clothing-report.json` and front/back Blender renders.
Final runtime verification must inspect grafted male/female neck joins and
apparel during aiming, locomotion and seated driving. Numerical source checks
and studio renders do not replace that browser inspection.
