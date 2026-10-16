# Blender source art

Save editable `.blend` projects here and export reviewed game assets to `public/models/` as `.glb` files. Blender backup files (`.blend1`, `.blend2`) are ignored; source `.blend` files are not.

The Niteshift setup installs the official **Blender 4.5.14 LTS** Linux binary with a pinned SHA-256 checksum, plus an isolated desktop on display `:100`. It starts automatically as the `blender` service on port **6082**. The game remains on port **3000**.

```sh
ns services status           # get the authenticated Blender and game preview URLs
ns preview 6082              # show Blender in the preview panel
ns preview 3000              # return to the game
ns services logs blender     # diagnose the desktop/editor
```

Open the Blender preview to control the desktop with the mouse and keyboard. Click the viewport before using shortcuts. Use the toolbar's **Save** and **Command search** buttons when the browser intercepts Ctrl+S or F3. Middle-drag orbits, the scroll wheel zooms, and Tab toggles Edit Mode. File → Import → glTF 2.0 imports the models under `public/models/`. File → Export → glTF 2.0 exports `.glb` files for Three.js.

There is no GPU device in this sandbox. Blender uses Mesa software graphics and four CPU rendering threads; use Solid viewport shading for interactive work. Heavy Cycles/EEVEE scenes are better handled on a GPU workstation. The desktop's VNC port stays on loopback, and the web client uses Niteshift's authenticated preview. Do not expose it through a public tunnel.

Closing the editor reopens it; reloading the browser keeps the editor session. Save before a service restart or sandbox shutdown. Saved files survive in the workspace; unsaved editor state is not guaranteed across restarts. User preferences live under `~/.config/blender`.

Agents can control this desktop through the browser with `agent-browser`, or use native X11 input with `DISPLAY=:100 xdotool …`. Blender is also on `PATH` for reproducible asset scripts:

```sh
blender --background --python path/to/asset_script.py
DISPLAY=:100 xdotool search --onlyvisible --class Blender
```

The browser desktop does not install a native computer-use connector or Unreal Engine. It provides remote desktop input and the Blender Python API for our asset workflow.

## Game asset sources

The game now uses these original Blender exports:

```sh
blender --background --factory-startup --threads 2 --python art/blender/vehicle_meridian.py
blender --background --factory-startup --threads 2 --python art/blender/city_streetscape.py
blender --background --factory-startup --threads 2 --python art/blender/character_sidearm.py
```

Each generator saves its editable `.blend` beside the script and its GLB under `public/models/`. The city generator also creates its original sign/newspaper/fabric atlas through `city_textures.py`. The vehicle generator exports both near and simplified far meshes. Runtime integration lives in `src/vehicles.js`, `src/world-props.js`, and `src/characters.js`. Keep the named wheel, door, grip, and muzzle attachment conventions when editing assets. Preview changes in-game, including door/steering motion and the seated driver, before committing exports.

## Civilian head rebuild

`character_humans.blend` contains the editable MakeHuman male/female head collections, fitted eyes, brows, lashes, primary hairstyles, and packed textures. The hidden hairstyle alternatives remain available for editing. These are third-party CC0 graphical assets; their [provenance](character_sources/PROVENANCE.md) and [license](character_sources/LICENSE-MAKEHUMAN-CC0.md) are separate from the original project-authored Blender models above.

Rebuild from the repository root with Blender 4.5, Python 3 with **Pillow** and **NumPy**, and the project's installed Node dependencies (including `three`):

```sh
blender --background --factory-startup --threads 2 --python art/blender/character_humans.py -- /tmp/astra-head-export
python3 art/blender/character_head_atlas.py /tmp/astra-head-export
node art/blender/character_humans.mjs /tmp/astra-head-export
```

The exporter opens the packed `.blend` without modifying it and writes the original head cages to the temporary directory; preview subdivision is omitted. The atlas step preserves geometry and face texture density while packing a 2048-pixel color atlas and a 1024-pixel roughness map. It produces both one-material `optimized_*_head.glb` files and the final two-material `soft_*_head.glb` variants: skin/eyes/hair use alpha masking, while fine brows/lashes use blending. Custom `_SKIN_MASK` and `_HAIR_MASK` attributes support runtime appearance variations.

The graft step reads the existing `CivilianMale.glb` and `Michelle-crowd.glb` bodies and writes `public/models/CivilianMaleNatural.glb` and `CivilianFemaleNatural.glb`. It replaces visible heads and blends the new necks into the retained bodies, preserving the original skeleton nodes, hierarchy, and inverse bind matrices. The resulting characters have three material batches each and 20,129 male / 21,168 female triangles. MakeHuman head assets are CC0; the male body retains EmoPreben's CC0 terms, while Michelle's body and the Mixamo locomotion retain their separate Adobe terms. See [asset credits](../../ASSETS.md).

The packed library contains everything needed to reproduce the head exports without downloading the original asset pack. Keep the collection/object names, source coordinate conventions, and region-mask attributes intact. Inspect the rebuilt characters in-game from the front and back, then exercise walking, aiming, entry/exit, and seated driving before shipping changed assets. These heads inherit skeletal head/neck motion; they do not add facial expressions or lip sync.

### Civilian distance meshes and index optimization

After rebuilding the natural heads and bodies above, generate the distance meshes, then optimize vertex reuse in that order:

```sh
npm install --prefix /tmp/astra-lod-tool meshoptimizer@0.24.0 --no-audit --no-fund
node art/blender/character_lod.mjs /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_simplifier.module.js
node art/blender/character_indices.mjs /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_encoder.module.js
node --test tests/character-lod.test.js tests/character-indices.test.js
```

The [MIT-licensed meshoptimizer](https://github.com/zeux/meshoptimizer), pinned to version 0.24.0, runs only during authoring. The simplifier produces `public/models/CivilianMaleNatural.lod.json` and `CivilianFemaleNatural.lod.json`; no simplifier, encoder, or additional package is shipped to the browser. These index buffers derive from the same credited meshes and retain their original licensing. Source SHA-256 checks in the tests catch stale generated data.

LOD geometry references the original vertices, UVs, normals, joint weights, masks, and skeleton. Mixed-weight vertices and open boundaries are locked to protect joints and neck joins. Male triangle counts are 20,129 / 12,955 / 10,177, and female counts are 21,168 / 11,426 / 7,920. The playable character stays at full quality. NPCs transition at 14 / 30 m apparent distance with 15% hysteresis; camera FOV adjusts that distance, so photo zoom restores detail. Call `updateLOD(camera)` once per presented frame. Inspect both near/far transitions and zoomed photo views after authoring changes.

The final index step preserves every original vertex buffer, vertex number, material, skeleton, and triangle. It adds indices to the unindexed body meshes, sharing vertices only when every attribute and morph value matches exactly. The male body then references 4,970 of its 23,289 retained vertices, and the female body 2,924 of 13,128. This reduces repeated skinning work without changing the geometry or the vertex numbers used by sole and hit probes. Opaque and alpha-masked triangle indices are reordered for vertex reuse at every LOD; blended brows and lashes keep their original order.

`character_indices.mjs` validates complete surface equivalence and immutable attributes before writing either character. It updates the LOD source hashes and records an `indexOptimization` proof in each sidecar. Running the final index step again validates those hashes and leaves the files unchanged. A stale proof fails instead of silently reoptimizing edited data: rebuild the heads/bodies, regenerate the LODs, then run the index step again. The asset tests also retain fingerprints of the original attributes, rig, materials, and oriented surfaces so an index-only change cannot silently alter them.

## Astra Aurora roadster

`vehicle_astra_aurora.py` authors the original two-seat Aurora in metres with the same reusable geometry helpers as the Meridian. Its body profiles, cockpit, wheels, fairings, lights, and trim are new project artwork; it does not import external car geometry or textures.

```sh
blender --background --factory-startup --threads 4 --python art/blender/vehicle_astra_aurora.py
# Optional front, rear, and open-door source review renders in /tmp:
blender --background --factory-startup --threads 4 --python art/blender/vehicle_astra_aurora.py -- --render-only
```

The saved `vehicle_astra_aurora.blend` retains the full 80,800-triangle editable source. Export optimizes small trim and planar areas to produce `public/models/AstraAurora.glb` (39,438 triangles) and `AstraAurora-lod.glb` (12,758 triangles). Each export has 47 material batches, including independently moving parts. Mesh validation runs after simplification. The source renders use the full source mesh; the browser must also be checked because it uses the optimized exports and different lighting.

The `AstraAurora` root uses +Z forward and Y up in glTF. Keep these game-space attachment points and names when editing:

| Node | Position / contract |
| --- | --- |
| `body_group` | Fixed body and visible cabin, zero origin |
| `driver_door` | Hinge at `(-.94, .76, .70)`; positive Y rotation opens the left door |
| `wheel_fl`, `wheel_fr` | Steering pivots at `(±.91, .352, 1.36)` |
| `wheel_rl`, `wheel_rr` | Rear pivots at `(±.96, .352, -1.38)` |
| `wheel_*_spin` | Child of each wheel pivot; spin local X; calipers stay outside the spin group |
| `steering_wheel` | Rim, spokes and paddles at `(-.43, .85, .13)`; turn local Z |
| `driver_seat`, `passenger_seat` | Pelvis anchors at `(±.43, .50, -.34)`; driver is negative X |
| `door_entry` | Approach point `(-1.65, 0, -.15)` |
| `engine_anchor` | Front engine bay `(0, .63, 1.25)` |
| `exhaust_left`, `exhaust_right` | Rear outlets `(±.61, .29, -2.33)` |

Tire radius is `.352 m`. The windshield runs from half-width `.82`, height `.88`, Z `.72` to half-width `.73`, height `1.29`, Z `.15`, with a `.025 m` vertical crown and `.04 m` forward crown. The rear plate backing is `.429 × .166 m`, centered at `(0, .52, -2.257)`; runtime lettering sits just behind it. Named paint, glass, lamp and interior materials are shared across static detail, while runtime clones materials that need individual damage or brake-light state. Verify steering, wheel rotation, door travel, seated hands, both LODs, and the windshield after changing the source.

### Deliberate appearance rebuild with facial morphs

Stage an appearance change separately from the browser's current assets. Raw head GLBs must name relative morph targets through `mesh.extras.targetNames` (`blinkLeft`, `blinkRight`, optionally `jawOpen`) and provide finite `POSITION`/`NORMAL` deltas with the original vertex counts. Rest weights are zero. The atlas aligns targets by name, zero-fills unaffected eyes/hair, supports sparse source accessors, and carries targets onto both opaque and translucent material batches. Head node transforms must already be baked, as in `character_humans.py` exports. Default mesh weights for the same merged target must agree.

```sh
python3 art/blender/character_head_atlas.py /tmp/astra-face-stage
node art/blender/character_humans.mjs /tmp/astra-face-stage \
  --body-dir /tmp/astra-clothing-stage --output-dir /tmp/astra-appearance-stage
node art/blender/character_lod.mjs \
  /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_simplifier.module.js \
  --input-dir /tmp/astra-appearance-stage --output-dir /tmp/astra-appearance-stage
node art/blender/character_indices.mjs \
  /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_encoder.module.js \
  --input-dir /tmp/astra-appearance-stage --output-dir /tmp/astra-appearance-stage
node --test tests/character-morph-pipeline.test.js tests/character-indices.test.js
```

The optional body directory contains `CivilianMale.glb` and `Michelle-crowd.glb` with their original rig contracts. Omit `--body-dir` to retain the existing clothed bodies. Facial position deltas are transformed by the graft's scale/bind linear transform without translation. Normal deltas share the transformed base normal's divisor, preserving correct partial-weight interpolation. Facial targets must not move the fitted neck seam. Near/mid LOD simplification locks every morph-active vertex and includes every morph delta in exact-weld comparisons. Far LOD alone may suppress exactly the named `blinkLeft`/`blinkRight` pair when every mesh/node default is zero and no other target exists; its sidecar level carries `disabledMorphTargets: ["blinkLeft", "blinkRight"]`. Runtime validates that contract and zeros those weights on every far update. Generic/custom morphs remain fully protected. Geometry keeps original morph attributes so approaching/zooming restores animation without replacing vertex buffers; the subsequent index optimizer already preserves complete morph payloads and transparent triangle order.

Inspect staged rest, half-blink, and closed-eye poses, validate the complete original skeleton and inverse binds, exercise near/far transitions, and review actual game rendering before promoting the staged GLBs/sidecars. A deliberate appearance rebuild changes the production surface/material fingerprints in `tests/character-indices.test.js`; keep those checks enabled and only update their expected values after reviewing the new geometry/materials. The index optimizer's generated proof describes exact index-only preservation of the newly reviewed inputs; it is not permission to bypass an appearance change review.

The current authored assets contain male 22,943 / 16,603 / 4,126 and female 22,092 / 12,562 / 4,914 triangles at near/mid/far distance, each in three material batches. Far geometry now compacts the simplifier working set before reducing triangles. This removes unused duplicate vertices that otherwise appear to be complex seams. Returned indices map back to original vertex IDs, keeping all shipped skin weights, UVs, normals, masks, rig data, and morph attributes exact. True geometric open boundaries remain locked for the body and head skin; alpha hair surfaces use the normal/UV/posed-error metric rather than blanket border locks. Male neck cut normals and bone weights match the interpolated body contour, fading smoothly back to authored head values above the cut.

### Far-only character rebuild

To update distant geometry without touching the reviewed near GLBs or any mid-level index stream:

```sh
node art/blender/character_lod.mjs \
  /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_simplifier.module.js \
  --far-only --input-dir public/models --output-dir /tmp/astra-character-far-stage
```

The command writes sidecars only. Copy the unchanged GLBs beside them when staging a complete asset directory. The sidecar `farLODRebuild` records the input sidecar SHA256, matching GLB SHA256, previous index-optimization proof, and nine deformation sample phases. It replaces, rather than falsely reusing, the old top-level index-only proof because the far triangle surfaces deliberately changed. Do not run the full index optimizer on this far-only result; use the ordinary graft → LOD → index pipeline when rebuilding the complete appearance.

Far simplification targets 18% of source triangles with a maximum .018 normalized surface error. Its 32-channel metric includes original normals/UVs plus nine real Idle/Walk/Run deformation samples. Mixed skinning is evaluated through these sampled deformations instead of categorically locking every influenced vertex. Generic morph-active vertices remain locked; only the explicit zero-rest blink pair is suppressed at far distance. Near geometry and the existing mid index streams remain untouched.

The staged candidate was independently sampled in 22 actual procedural poses per sex (including aiming, reload, airborne, seated, downed, split support and step transitions), using vertices, edge midpoints, and triangle centroids against the opposite triangle surface in both directions. Maximum observed surface deviations were 38.17 mm male / 15.29 mm female, with silhouette support changes 22.23 / 12.52 mm. Visible shoe-floor changes introduced no downward penetration; true body/head-skin boundary edges were unchanged. This is dense sampled evidence, not an exhaustive Hausdorff bound. Re-run posed geometry and browser checks after changing the assets, locomotion, or simplification policy.
