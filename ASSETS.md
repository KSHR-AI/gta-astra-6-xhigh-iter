# Grand Theft Astra asset credits

## Animated human character

- **File:** `public/models/Soldier.glb` (2.16 MB).
- **Original asset:** Mixamo Vanguard character and Idle, Walk, Run, and T-pose animation clips, distributed as the Three.js skeletal animation example.
- **Source:** [Three.js Soldier.glb](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb).
- **Example attribution:** [Three.js skeletal animation blending](https://threejs.org/examples/webgl_animation_skinning_blending.html) credits Mixamo.
- **Usage terms:** [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) permits royalty-free use of characters and animations in personal, commercial, and nonprofit projects, including video games. Mixamo content is not CC0 or covered by the Three.js code license. The model is included as part of this playable game, not offered as a standalone asset library.
- **In-game adaptations:** normalized human scale, independent skeleton clones, outfit material tints, animation crossfades, and procedural arm aiming. Original embedded textures and skeletal clips are preserved.

## Civilian pedestrian character

- **Files:** `public/models/Michelle.glb` (3.28 MB) and `public/models/pedestrian-motion.json` (0.59 MB).
- **Original asset:** Mixamo Michelle character from the [Three.js Michelle.glb asset](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Michelle.glb).
- **Usage terms:** the same Adobe Mixamo terms linked above apply.
- **In-game adaptations:** the Vanguard Idle, Walk, and Run skeletal clips were retargeted to Michelle's rest pose and proportions, sampled at 30 Hz, and stored locally. Each pedestrian has an independent animation mixer and subtly tinted clothing materials. The original mesh, skinning, and embedded texture are preserved.

## Original geometry

The game's service pistol and articulated offline fallback are original Three.js geometry created for Grand Theft Astra.

No Grand Theft Auto game files, characters, logos, or Rockstar assets are included.

## City PBR textures

All assets below are from Poly Haven, released under CC0: https://polyhaven.com/license

- Asphalt 02: https://polyhaven.com/a/asphalt_02 — 1K diffuse, OpenGL normal, roughness.
- Concrete Wall 001: https://polyhaven.com/a/concrete_wall_001 — 1K diffuse, OpenGL normal, roughness.
- Brown Brick 02: https://polyhaven.com/a/brown_brick_02 — 1K diffuse, OpenGL normal, roughness.
- White Stucco: https://polyhaven.com/a/white_stucco — 1K diffuse, OpenGL normal, roughness.

Stored locally under public/textures/city. Procedural room interiors, street decals, and signage are original code-generated textures.

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

Suggested starting settings: ACES tone-mapping exposure 0.9–1.0, day background intensity 0.7, day environment intensity 0.55, warm directional light `#ffe1bc` at intensity 3–3.8, and hemisphere fill 0.6–0.9. The actual material and renderer configuration should determine final tuning. Use `sun.position.copy(playerPosition).addScaledVector(atmosphere.sunDirection, 140)` and target the player position to align the key light with the photograph.
