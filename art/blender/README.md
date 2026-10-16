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

### Civilian distance meshes

After rebuilding either natural character, regenerate its distance meshes:

```sh
npm install --prefix /tmp/astra-lod-tool meshoptimizer@0.24.0 --no-audit --no-fund
node art/blender/character_lod.mjs /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_simplifier.module.js
node --test tests/character-lod.test.js
```

The [MIT-licensed meshoptimizer](https://github.com/zeux/meshoptimizer) runs only during authoring. It produces `public/models/CivilianMaleNatural.lod.json` and `CivilianFemaleNatural.lod.json`; no simplifier or additional package is shipped to the browser. These index buffers derive from the same credited meshes and retain their original licensing. Source SHA-256 checks in the tests catch stale generated data.

LOD geometry references the original vertices, UVs, normals, joint weights, masks, and skeleton. Mixed-weight vertices and open boundaries are locked to protect joints and neck joins. Male triangle counts are 20,129 / 12,955 / 10,177, and female counts are 21,168 / 11,426 / 7,920. The playable character stays at full quality. NPCs transition at 14 / 30 m apparent distance with 15% hysteresis; camera FOV adjusts that distance, so photo zoom restores detail. Call `updateLOD(camera)` once per presented frame. Inspect both near/far transitions and zoomed photo views after authoring changes.
