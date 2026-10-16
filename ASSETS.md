# Grand Theft Astra asset credits

## Male civilian protagonist

- **Original body:** **Bald Man (Rigged)** by **EmoPreben**.
- **Creator listing and license declaration:** [OpenGameArt — Bald Man (Rigged)](https://opengameart.org/content/bald-man-rigged).
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) for the original model and supplied textures. The replacement MakeHuman head is also CC0; locomotion retains the separate Mixamo terms below.
- **Original download:** [baldman_painted_rigged.zip](https://opengameart.org/sites/default/files/baldman_painted_rigged.zip).
- **Local files:** `public/models/CivilianMale.glb` preserves the converted source; `public/models/CivilianMaleNatural.glb` is the current protagonist/civilian derivative.
- **Changes:** the source FBX was converted to an 8,784-triangle GLB with its original 2K albedo/normal images and Mixamo-compatible rig. The natural derivative replaces the original head with the fitted MakeHuman head described below, blends its neck into the clothed body, and preserves the original skeleton hierarchy and inverse bind matrices. Original project-authored garment detail adds a raised collar, sleeve cuffs, and cloth surface maps. The complete character retains three material batches: body, head/eyes/hair, and soft brows/lashes.
- **Runtime:** normalizes scale and floor origin, corrects the source normal-map Y convention, separates skin and clothing response, and varies clothing, warm skin tones, and natural hair colors. The head follows the existing neck/head bones; separate skin-and-lash morph targets provide blinking without moving the eyeballs. There is no jaw animation or lip sync.
- **Source inspected:** October 15, 2026. Attribution is supplied voluntarily under CC0.

## Source locomotion and retargeted animation

- **Source asset:** Mixamo Vanguard character with Idle, Walk, Run, and T-pose clips, distributed in the [Three.js Soldier.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb) example. Local file: `public/models/Soldier.glb`.
- **Attribution:** the [Three.js skeletal animation blending example](https://threejs.org/examples/webgl_animation_skinning_blending.html) credits Mixamo.
- **Usage terms:** the [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) permits royalty-free use of characters and animations in personal, commercial, and nonprofit projects, including video games. Mixamo content is **not CC0** and is not covered by the Three.js code license. It is included as part of this playable game, not as a standalone asset library.
- **Male locomotion:** `public/models/civilian-male-motion.json` retargets the existing Mixamo Idle/Walk/Run clips to the civilian's proportions and A-pose rest skeleton. The male mesh's CC0 status does not change the source animation terms.
- **Female locomotion:** `public/models/pedestrian-motion.json` retargets the same clips to Michelle, sampled at 30 Hz. Empty tracks for unmapped finger/end bones were removed so those bones retain their bind poses.
- **Additional motion:** driving, steering, door reach, entry/exit, jump/landing, reload, aiming, and hit reactions use original procedural skeletal layers authored for this game. These are not newly downloaded motion-capture clips. Runtime uses independent skeletons/mixers, crossfades, and pose layers.

## Female civilian population

- **Original body:** Mixamo Michelle from the [Three.js Michelle.glb asset](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Michelle.glb).
- **Local files:** `public/models/Michelle.glb`, `public/models/Michelle-crowd.glb`, `public/models/CivilianFemaleNatural.glb`, and the retargeted motion JSON described above.
- **Usage terms:** the Adobe Mixamo terms linked above continue to apply to Michelle's body and animations. Adding a CC0 MakeHuman head does **not** make the complete female derivative CC0, and the model is not licensed as Three.js source code.
- **Changes:** the crowd body was simplified with glTF Transform/Meshoptimizer from 28,106 to 8,431 triangles, retaining its embedded images, materials, UVs, skin weights, and 65-bone skeleton. The natural derivative replaces its original head, headphones, and hair with the MakeHuman head and ponytail below, fitting the new neck to the retained clothed body. Original project-authored detail adds raised collar, armhole and hem bindings to the gray crop top. It preserves the original skeleton hierarchy and inverse bind matrices, needs no runtime decoder, and retains three material batches.
- **Runtime:** clothing, height, warm skin-tone, and hair-color variations support the civilian population. Police styling adds an original navy cap and badge. The new head inherits neck/head motion and uses the same skin-and-lash blink targets as the male head; it has no jaw animation or lip sync.

## MakeHuman civilian heads

- **Source:** official [MakeHuman Community system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html), with the [MakeHuman base mesh and morph targets](https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data).
- **License:** CC0 1.0 Universal for the base mesh, morphs, skins, eyes, hair, brows, and lashes. See the project's [asset license statement](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md) and [license overview](https://static.makehumancommunity.org/about/license.html); the copied legal text is `art/blender/character_sources/LICENSE-MAKEHUMAN-CC0.md`.
- **Credited creators:** MakeHuman Community; the bundled CC0 notices identify Data Collection AB, Joel Palmius, and Jonas Hauquier. Attribution is supplied voluntarily.
- **Components:** young male/female macro morphs and skin textures; high-poly brown eyes; `short04` male hair; `ponytail01` female hair; `eyebrow001`/`eyebrow003`; and `eyelashes01`. The editable library also retains hidden `short02` and `bob01` hairstyle alternatives.
- **Changes:** fitted the accessory meshes with their original MHCLO mappings, retained the head UVs, cut below the neck, and grafted the heads onto the existing civilian rigs. Original skin textures are 2K; hair/eye textures are capped at 1K, with 512-pixel brows/lashes. The runtime heads use a 2K color atlas and 1K roughness map, with masked hair and softly blended brows/lashes. Skin/hair vertex masks permit appearance variation without recoloring the eyes. The male `short04` hair has original nape/crown refinements and 129 added curved locks (1,806 triangles), using an original analytic strand texture; its CC0 base remains credited above.
- **Eyelid morph source:** MakeHuman Community's official [faceunits01 target assets](https://github.com/makehumancommunity/extra-targets/tree/7eaba3453134385bb5ea9811ef0b33b85b4b556d/assets/faceunits01/targets/faceunits), pinned to commit `7eaba3453134385bb5ea9811ef0b33b85b4b556d`, under that repository's [CC0 1.0 license](https://github.com/makehumancommunity/extra-targets/blob/7eaba3453134385bb5ea9811ef0b33b85b4b556d/LICENSE). Local `eyeBlinkLeft.target` and `eyeBlinkRight.target` supply the graphical displacements for `blinkLeft`/`blinkRight`; the source hashes, vertex correspondence and transformations are documented in [facial authoring provenance](art/blender/character_sources/FACE_PROVENANCE.md). No MakeHuman application or plugin code is incorporated.
- **Surface detail and fit:** original deterministic pore normals and spatial roughness are authored in `character_head_surface.py`, independent of the skin's diffuse lighting. The 1K normal atlas uses strength 0.45: skin retains its pore field, hair gains original directional strand relief, and eyes/brows/lashes keep neutral normals. Hair roughness retains the editable source's matte 0.85 response. `KHR_materials_specular` preserves source hair intensity 0.4 in the existing roughness image's alpha channel; skin and eyes retain intensity 1. The solid head loads as a physical material while unchanged soft brows/lashes remain Standard. This adds no texture image or material batch; actual GPU cost requires runtime measurement. `character_head_fit.mjs` adjusts head proportions and compresses the female neck while retaining the body join. Eyes, hair and facial morphs share the head's affine fit above that transition; the skeleton and inverse binds are preserved.
- **Editable source and rebuild:** `art/blender/character_humans.blend`, `character_face_authoring.py`, `character_humans.py`, `character_head_surface.py`, `character_head_atlas.py`, `character_head_fit.mjs`, and `character_humans.mjs`. The Blender file supplies editable source heads; final body-specific fitting happens during the graft. [Rebuild instructions](art/blender/README.md#deliberate-appearance-rebuild-with-facial-morphs) and [full component provenance](art/blender/character_sources/PROVENANCE.md) document the packed-source workflow. Base-source hashes and the upstream commit are recorded in `character_sources/source-manifest.json`; the separate blink-target hashes are in `FACE_PROVENANCE.md`.
- **Limits:** these are authored human meshes with textured faces, not scanned people. Facial motion is limited to eyelid/lash closure; there is no speech animation, jaw motion, mouth interior or general expression system. Existing skeletal locomotion and gameplay pose layers remain separate.
- **Sources and licenses inspected:** October 16, 2026.

## Original civilian clothing detail

- **Source and authorship:** original project-authored garment facing geometry, procedural fabric/fold detail and mask maps, applied to the existing credited body UV layouts. No additional external garment model or texture was downloaded. The male body remains CC0; the female body retains its separate Mixamo terms.
- **Construction:** rounded male collar and sleeve cuffs add 1,008 triangles; female collar, armhole and hem bindings add 924 triangles. New vertices interpolate the source skin influences. A subsequent original tailoring pass deliberately changes selected garment positions/normals, tapering the female trousers and adding fabric ease to the male clothes. Skin influences, UVs, skeleton hierarchy and inverse bind matrices are preserved. Contact rings and unselected body vertices remain pinned. The strips share the original body material, adding no body material batch.
- **Maps:** male maps remain 2048²; female maps resample the original 512² inputs to 1024² for authored seam detail. This does not add source photographic detail. Original denim, pockets, stitching and fabric normals replace the trouser surfaces, including the female's yellow trousers and knee bands. The packed map uses R for the shirt dye mask, G for roughness and B for exposed skin, with metallic factor zero. Source albedo and normal pixels outside the garment and deliberately authored male footwear masks are preserved relative to the working-resolution source. The original high-contrast patterned male shoe uppers are replaced with original restrained charcoal footwear surface maps, while every shoe position, UV, skin weight and sole support point remains unchanged. Runtime dye preserves the authored cloth contrast; `trousersAuthored` bypasses legacy trouser recoloring. The female ankle mask follows its two connected UV components and pads only empty gutters, so complexion transfer includes the bare ankles without recoloring shoes or denim.
- **Editable source and rebuild:** `art/blender/character_clothing.blend`, `character_clothing.py`, `character_apparel_shape.py`, `character_clothing_boundaries.py`, `character_clothing_textures.py`, and `character_shoe_surface.py`. [Clothing reproduction instructions](art/blender/character_clothing_README.md) include the map contract and validator. Stage the body inputs, apply the natural-head graft, generate LODs, then perform index optimization in that order; the [appearance pipeline](art/blender/README.md#deliberate-appearance-rebuild-with-facial-morphs) documents the combined commands.
- **Verification scope:** inspected Blender studies and structural checks cover the authoring outputs. The clothing validator exercises added skinned vertices through nine existing animator states. These checks do not establish final game appearance; integrated browser checks remain necessary after rebuilding the characters.

### Integrated character geometry budgets

These counts describe the shipped natural-head, authored-clothing derivatives
after LOD generation and index optimization, excluding separately attached
weapons and police accessories. Each character uses three material batches.

| Character | Near triangles | Middle triangles | Far triangles |
| --- | ---: | ---: | ---: |
| `CivilianMaleNatural.glb` | 22,943 | 16,625 | 4,127 |
| `CivilianFemaleNatural.glb` | 22,092 | 12,618 | 4,845 |

The `.lod.json` sidecars contain the reduced index buffers and source hashes.
Near and middle levels retain the eyelid morphs; the far level disables those
targets to permit further face simplification. The index step preserves the
reviewed surface, attributes, rig and morph data and records its validation
proof. Any appearance edit must rerun graft, LOD generation and indexing before
the final assets and their sidecars are promoted together.

## Original geometry

The service pistol, articulated offline fallback, sedans/patrol vehicles, and authored district geometry are original Three.js work for Grand Theft Astra. This includes the accessible Orbit office, Sunline diner, Paloma Motor Lodge office/courtyard, Astra Auto Works garage, furnishings, street details, palms, and shrubs. Vehicle deformation, cracked glazing, smoke, suspension motion, and procedural character pose layers are original runtime effects. Leaf/foliage atlases, room-window atlases, signs, decals, and interface graphics are generated or authored by this project.

No Grand Theft Auto game files, characters, logos, or Rockstar assets are included.

## Original road and cast-iron surfaces

- **Author/source:** original deterministic texture artwork and runtime geometry for this project. No photographs, downloaded texture inputs or external model files are used.
- **Rebuild:** `python3 art/blender/road_surfaces.py` with NumPy and Pillow; add `--preview /tmp/road-surfaces.png` for a color/normal/roughness contact sheet. Cast lettering uses the installed Liberation Sans font.
- **Files:** `public/textures/city/asphalt-fine-{color,normal,rough}.jpg` (1024 × 1024) and `manhole-{color,normal,rough}.jpg` (512 × 512). Normal maps use the OpenGL tangent convention. The asphalt maps represent a seamless 2.4 m square; independent world-space weather and mild wheel-path polishing avoid repeating large cracks or baked lighting.
- **Geometry and appearance:** an original 0.954 m iron cover with cast diamond tread, two recessed lifting pockets, a maker's plaque and rings. Tread/pockets/lettering are surface-map relief, not open holes. A separate bevelled frame and recessed annular seat are instanced with the covers. They sit 5–7 mm above the asphalt and add no collision obstacles.

## City PBR textures

All assets below are from Poly Haven, released under CC0: https://polyhaven.com/license

- Asphalt 02: https://polyhaven.com/a/asphalt_02 — 1K diffuse, OpenGL normal, roughness. Retained as the original reference files `asphalt-{color,normal,rough}.jpg`; gameplay now uses the original fine asphalt above.
- Concrete Wall 001: https://polyhaven.com/a/concrete_wall_001 — 1K diffuse, OpenGL normal, roughness.
- Brown Brick 02: https://polyhaven.com/a/brown_brick_02 — 1K diffuse, OpenGL normal, roughness.
- White Stucco: https://polyhaven.com/a/white_stucco — 1K diffuse, OpenGL normal, roughness.

Stored locally under public/textures/city. Distant room-window atlases, street decals, vegetation atlases, and signage are original code-generated textures. The accessible district interiors use modeled original geometry.

## Historical engine-benchmark vehicle fixture

- **Asset:** Ferrari 458 Italia by **vicent091036**.
- **File:** `benchmarks/fixtures/ferrari-lod.glb`. This fixture is retained only to reproduce the historical engine comparison; it is not included in the game build or loaded by gameplay. The full-resolution Ferrari file was removed.
- **Upstream download:** https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/ferrari.glb
- **Official attribution:** https://threejs.org/examples/webgl_materials_car.html
- **Original model:** https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6
- **Original Three.js integration:** https://github.com/mrdoob/three.js/pull/14843
- **Reported model license:** Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/ . Author, title, and original source are confirmed by the official Three.js example. The original Sketchfab listing now returns 404/403, so its original license declaration could not be independently retrieved during this task. CC BY 4.0 is corroborated by current downstream attribution at https://www.optimumwrap.com/3d-visualizer/ and https://www.joyride.com/play/drag . The upstream license declaration remains unverified.
- **Changes:** decoded the upstream Draco asset offline; removed duplicated reverse-facing polygons; propagated consistent triangle winding; removed unused UV attributes; welded duplicate positions; reduced geometry with meshoptimizer into 69,096-triangle and 16,572-triangle models; regenerated smooth normals; assigned new paint, glass, leather, rubber, metallic and emissive materials; normalized orientation and size; extracted actual door panel, mirror, handle and interior parts into an articulated door assembly; added steering, wheel rotation and detail-level switching.
- **Benchmark dependencies:** the engine lab serves the preserved LOD fixture at its historical URL so recorded comparisons remain reproducible. The original license caveat above still applies to redistribution of the benchmark fixture.

The original procedural sedan remains an offline fallback; the runtime sedan and patrol car use the original Blender Meridian library below. Their paint finish now uses clearcoat. Vehicle license plates display ASTRA 01.

### Photographic sunset sky and environment

- **Asset:** Qwantani Sunset (Pure Sky), unchanged 2K Radiance HDR, 2048 × 1024.
- **Creators:** Greg Zaal (photography); Jarod Guest (processing).
- **Source:** https://polyhaven.com/a/qwantani_sunset_puresky
- **License:** CC0 1.0 Universal, https://polyhaven.com/license
- **Download:** https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_sunset_puresky_2k.hdr
- **Local asset:** `public/textures/sky/qwantani_sunset_puresky_2k.hdr`
- **Size:** 4,171,959 bytes.
- **SHA-256:** `d66e08231e9c09ca40c6d035214ae8efb638782745c82addbb2a063fa32cabef`
- **Poly Haven API MD5:** `b918af5fefb341535961ffdad5fab7bc`.
- **Runtime:** creates a separate cool night variant with compressed sun radiance. The photographed sun is approximately 6.06° above the horizon. Background, reflections, and directional lighting share the -1.25-radian sky rotation. No terrain/buildings are part of the panorama.
- **Source and license inspected:** October 16, 2026.

The previous `rustig_koppie_puresky_2k.hdr` remains in the repository as an unused reference, credited to Greg Zaal and Jarod Guest under the same Poly Haven CC0 terms: https://polyhaven.com/a/rustig_koppie_puresky.

### Original Blender asset library

All assets below are original project-authored geometry and artwork. They use no additional third-party models, textures, or brand-specific designs. Source projects are editable; the Python scripts reproduce the exports using Blender 4.5 LTS.

| Asset | Editable source / generator | Runtime export |
| --- | --- | --- |
| Meridian sedan and patrol variant | `art/blender/vehicle_meridian.blend`, `vehicle_meridian.py` | `public/models/vehicles/meridian.glb`, `meridian-lod.glb` |
| Bus shelter, news kiosk, cafe furniture and parasol | `art/blender/city_streetscape.blend`, `city_streetscape.py`, `city_textures.py` | `public/models/city/city-streetscape.glb`, original `city-atlas.png` |
| Compact sidearm | `art/blender/character_sidearm.blend`, `character_sidearm.py` | `public/models/character_sidearm.glb` |

The Meridian includes a curved body with open wheel arches, cabin, articulated driver door, wheels/brakes, lamps, and original police livery/equipment. Sedan geometry is 34,184 triangles near / 11,806 far; the police variant adds 1,096 triangles. The streetscape library uses 6,606 source triangles and 21 shared material batches across eight placements. The sidearm uses 3,732 triangles and four PBR materials; its grip and muzzle anchors drive hand articulation and effects. The gameplay sports car now uses the original Astra Aurora asset; the Ferrari licensing caveat applies only to the historical benchmark fixture above.



## Local recorded audio

All shipped recordings are CC0 1.0 / public domain and are served locally from `public/audio/`. Total asset transfer is 355,804 bytes (about 348 KiB). Audio playback needs no remote asset requests, account, API key, or third-party runtime library.

### Recorded engine

- **Racing car engine sound loops** — **domasx2**, OpenGameArt, 2011.
- Source and CC0 declaration: https://opengameart.org/content/racing-car-engine-sound-loops
- Download: https://opengameart.org/sites/default/files/loop_0.wav
- Local file: `engine-loop.wav`.
- The source author explicitly states the current version was remade from a public-domain recording (see final author comment on the page). The earlier sampling-license discussion concerns a superseded version.
- Modification: mono 44.1 kHz PCM WAV, 30 Hz high-pass to remove DC/very low rumble, and a 46 ms cosine crossfade to remove the original loop seam. Playback pitch varies with engine RPM; additional original synthesis supplies combustion, exhaust, transmission, road, and tire layers.

### Coastal field recording

- **Seagulls distant.wav** — **Ambientsoundapp**, Freesound, October 4, 2020.
- Source and CC0 declaration: https://freesound.org/people/Ambientsoundapp/sounds/537854/
- Public preview used: https://cdn.freesound.org/previews/537/537854_11926345-hq.mp3
- Local file: `coastal-gulls.mp3`.
- Modification: mono 32 kHz / 64 kbps MP3, 140 Hz high-pass, 34 dB gain compensation for the very quiet original, 1.5 s fade-in and 2.5 s fade-out. The full 30-second field recording is retained; the game mixes it quietly, strongest on the beach and almost silent at night.

### Footsteps and impact foley

- **Impact Sounds** — **Kenney**, 2019, CC0.
- Source and CC0 declaration: https://kenney.nl/assets/impact-sounds
- Official download: https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip
- Official licensing explanation: https://kenney.nl/support
- `step-concrete-{1,2,3}.mp3` derives respectively from `footstep_concrete_000.ogg`, `001`, `002`.
- `step-grass-{1,2,3}.mp3` derives respectively from `footstep_grass_000.ogg`, `001`, `002` (also used as the softer beach/sand footstep layer).
- `metal-impact.mp3` derives from `impactMetal_heavy_001.ogg`.
- `metal-click.mp3` derives from `impactMetal_light_002.ogg`.
- `door-thump.mp3` derives from `impactSoft_heavy_000.ogg`.
- `glass-impact.mp3` derives from `impactGlass_medium_001.ogg`.
- Modification: mono 32 kHz / 64 kbps MP3 for broad browser decoding support; gain 0.65 to retain headroom after lossy encoding. Playback pitch, filters, and mixing vary per event.

### Magazine handling

- **Gun Reload Sound Effects** — **BMacZero / Brian MacIntosh**, OpenGameArt, 2020, CC0.
- Source and CC0 declaration: https://opengameart.org/content/gun-reload-sound-effects
- Download: https://opengameart.org/sites/default/files/clipload2.wav
- Local file: `magazine.mp3`.
- Modification: mono 32 kHz / 64 kbps MP3, gain 0.65; repeated and pitched in a 1.05-second reload sequence with Kenney metal clicks.

CC0 license: https://creativecommons.org/publicdomain/zero/1.0/

Gunfire, horns, police sirens, sea/wind beds, engine enhancement, UI cues, and the subdued adaptive D-minor pursuit pulses are original Web Audio synthesis in `src/audio.js`. The short pursuit motif does not reproduce any commercial-game soundtrack.

## Original Astra Aurora sports car

- **Author/source:** original project-authored model and procedural materials, created in Blender 4.5 LTS. It contains no external car meshes, brand marks, photography, or textures.
- **Editable source:** `art/blender/vehicle_astra_aurora.blend` and reproducible generator `art/blender/vehicle_astra_aurora.py`. The generator reuses the project's original Meridian mesh utility functions.
- **Game exports:** `public/models/AstraAurora.glb` and `public/models/AstraAurora-lod.glb`, replacing the third-party Ferrari in gameplay.
- **Design:** an original two-seat grand touring roadster with sculpted body panels, open wheel arches, a glass windshield, saddle leather cockpit, stitched bucket seats, rollover hoops, swept split-spoke wheels, fixed brake calipers, modeled cooling intakes and LED light guides. Driver door, steering wheel, wheel pivots and attachment anchors are articulated separately.
- **Budgets:** 80,800 source triangles, 39,438 near / 12,758 far exported triangles, and 47 material batches per LOD. All geometry and materials are locally served; there are no remote asset requests.

These Aurora assets are original repository work and introduce no third-party attribution or licensing dependency. The historical Ferrari benchmark fixture retains its separate provenance caveat above.
