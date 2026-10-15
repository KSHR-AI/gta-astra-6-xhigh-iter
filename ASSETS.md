# Grand Theft Astra asset credits

## Male civilian protagonist

- **Original asset:** **Bald Man (Rigged)** by **EmoPreben**.
- **Creator listing and license declaration:** [OpenGameArt — Bald Man (Rigged)](https://opengameart.org/content/bald-man-rigged).
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). This applies to the original model and supplied textures; the retargeted locomotion below has separate Mixamo terms.
- **Original download:** [baldman_painted_rigged.zip](https://opengameart.org/sites/default/files/baldman_painted_rigged.zip).
- **Local model:** `public/models/CivilianMale.glb`.
- **Changes:** converted FBX to GLB, retaining the 8,784-triangle skinned mesh, original 2K albedo/normal images, and Mixamo-compatible rig (65 nodes, 52 skin joints). Runtime normalizes scale and floor origin, corrects the source normal map's Y convention, applies nonmetallic rough clothing materials, and varies cloth colors while preserving the original skin, face, and texture detail.
- **Use:** male protagonist and part of the civilian population. This independent-artist model has modest facial and ear topology; it is not a scanned character.
- **Source inspected:** October 15, 2026. Attribution is supplied voluntarily under CC0.

## Source locomotion and retargeted animation

- **Source asset:** Mixamo Vanguard character with Idle, Walk, Run, and T-pose clips, distributed in the [Three.js Soldier.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb) example. Local file: `public/models/Soldier.glb`.
- **Attribution:** the [Three.js skeletal animation blending example](https://threejs.org/examples/webgl_animation_skinning_blending.html) credits Mixamo.
- **Usage terms:** the [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) permits royalty-free use of characters and animations in personal, commercial, and nonprofit projects, including video games. Mixamo content is **not CC0** and is not covered by the Three.js code license. It is included as part of this playable game, not as a standalone asset library.
- **Male locomotion:** `public/models/civilian-male-motion.json` retargets the existing Mixamo Idle/Walk/Run clips to the civilian's proportions and A-pose rest skeleton. The male mesh's CC0 status does not change the source animation terms.
- **Female locomotion:** `public/models/pedestrian-motion.json` retargets the same clips to Michelle, sampled at 30 Hz. Empty tracks for unmapped finger/end bones were removed so those bones retain their bind poses.
- **Additional motion:** driving, steering, door reach, entry/exit, jump/landing, reload, aiming, and hit reactions use original procedural skeletal layers authored for this game. These are not newly downloaded motion-capture clips. Runtime uses independent skeletons/mixers, crossfades, and pose layers.

## Female civilian population

- **Original asset:** Mixamo Michelle from the [Three.js Michelle.glb asset](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Michelle.glb).
- **Local files:** `public/models/Michelle.glb`, `public/models/Michelle-crowd.glb`, and the retargeted motion JSON described above.
- **Usage terms:** the Adobe Mixamo terms linked above apply; the model is not CC0 or licensed as Three.js source code.
- **Changes:** the crowd derivative was simplified with glTF Transform/Meshoptimizer from 28,106 to 8,431 triangles, retaining original embedded images, materials, UVs, skin weights, and the 65-bone skeleton. It needs no additional runtime decoder. Clothing palettes and NPC height variation preserve the original face, skin, hair, and texture detail. Police styling adds an original navy cap and badge.

## Original geometry

The service pistol, articulated offline fallback, sedans/patrol vehicles, and authored district geometry are original Three.js work for Grand Theft Astra. This includes the accessible Orbit office, Sunline diner, Paloma Motor Lodge office/courtyard, Astra Auto Works garage, furnishings, street details, palms, and shrubs. Vehicle deformation, cracked glazing, smoke, suspension motion, and procedural character pose layers are original runtime effects. Leaf/foliage atlases, room-window atlases, signs, decals, and interface graphics are generated or authored by this project.

No Grand Theft Auto game files, characters, logos, or Rockstar assets are included.

## City PBR textures

All assets below are from Poly Haven, released under CC0: https://polyhaven.com/license

- Asphalt 02: https://polyhaven.com/a/asphalt_02 — 1K diffuse, OpenGL normal, roughness.
- Concrete Wall 001: https://polyhaven.com/a/concrete_wall_001 — 1K diffuse, OpenGL normal, roughness.
- Brown Brick 02: https://polyhaven.com/a/brown_brick_02 — 1K diffuse, OpenGL normal, roughness.
- White Stucco: https://polyhaven.com/a/white_stucco — 1K diffuse, OpenGL normal, roughness.

Stored locally under public/textures/city. Distant room-window atlases, street decals, vegetation atlases, and signage are original code-generated textures. The accessible district interiors use modeled original geometry.

## Imported vehicle model

- **Asset:** Ferrari 458 Italia by **vicent091036**.
- **Files:** `public/models/vehicles/ferrari.glb` and `public/models/vehicles/ferrari-lod.glb`.
- **Upstream download:** https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/ferrari.glb
- **Official attribution:** https://threejs.org/examples/webgl_materials_car.html
- **Original model:** https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6
- **Original Three.js integration:** https://github.com/mrdoob/three.js/pull/14843
- **Reported model license:** Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/ . Author, title, and original source are confirmed by the official Three.js example. The original Sketchfab listing now returns 404/403, so its original license declaration could not be independently retrieved during this task. CC BY 4.0 is corroborated by current downstream attribution at https://www.optimumwrap.com/3d-visualizer/ and https://www.joyride.com/play/drag . The upstream license declaration remains unverified.
- **Changes:** decoded the upstream Draco asset offline; removed duplicated reverse-facing polygons; propagated consistent triangle winding; removed unused UV attributes; welded duplicate positions; reduced geometry with meshoptimizer into 69,096-triangle and 16,572-triangle models; regenerated smooth normals; assigned new paint, glass, leather, rubber, metallic and emissive materials; normalized orientation and size; extracted actual door panel, mirror, handle and interior parts into an articulated door assembly; added steering, wheel rotation and detail-level switching.
- **Runtime dependencies:** the bundled GLB files load locally through the installed Three.js GLTFLoader. No external asset requests or runtime decoder are required.

The original procedural sedan and patrol coupe remain original project geometry. Their paint finish now uses clearcoat. Vehicle license plates display ASTRA 01.

### Photographic sky and environment

- **Asset:** Rustig Koppie (Pure Sky), 2K Radiance HDR, 2048 × 1024.
- **Creators:** Greg Zaal (original photography); Jarod Guest (sky edits).
- **Source:** https://polyhaven.com/a/rustig_koppie_puresky
- **License:** CC0 1.0 Universal, https://polyhaven.com/license and https://creativecommons.org/publicdomain/zero/1.0/
- **Download:** https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rustig_koppie_puresky_2k.hdr
- **Local asset:** `public/textures/sky/rustig_koppie_puresky_2k.hdr`
- **Size:** 4,047,254 bytes (3.86 MiB).
- **SHA-256:** `e70bf97a44982db07fb952b1f74c07e818649c2bbdfeb6ad4f98af7b4431a38f`
- **Poly Haven API MD5:** `08c11a244add6ef1c3e027234c1fdd22`; local file matches.
- **Changes:** Original HDR is redistributed unchanged. Runtime creates a separate, reduced-resolution cool night variant with compressed sun radiance. No photographic terrain, buildings, or vegetation is included in this pure-sky panorama.
- **Source and license verified:** October 15, 2026.

The HDR's brightest source pixel is (1223, 351), corresponding to sun elevation 28.212890625°. With both scene background and environment rotated 2.83 radians about Y, the world-space sun direction is `(-0.53128378, 0.47274903, -0.70302624)`.


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
