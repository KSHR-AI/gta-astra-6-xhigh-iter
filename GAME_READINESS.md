# Grand Theft Astra: production readiness

This is a playable browser prototype, not a release-ready AAA game. The ongoing goal is a game ready for AAA studio review and release; the current vertical slice is only an intermediate milestone. A passing build or a good screenshot does not establish release readiness.

## Current slice

- Coastal district with an introductory contact, vehicle theft, police response, delivery and checkpoint persistence.
- Third-person walking, sprinting, aiming, semi-automatic pistol, reload, driving and photo mode.
- Editable Blender props and vehicles, authored replacement human heads, credited external source assets.
- Reduced gameplay HUD, keyboard/mouse and touch controls.

## Release gates still open

1. **Performance:** consistent frame pacing on a documented hardware/browser matrix. Current cloud browser uses llvmpipe software graphics and runs the full city at only a few frames per second. Isolated engine benchmarks do not establish game performance. Profile the complete scene and preserve close-up quality when optimizing.
2. **Characters:** production clothing, facial expressions/dialogue, convincing turns and stops, terrain-aware feet, vehicle interactions and hit reactions. Current procedural layers and imported base bodies remain visibly limited.
3. **Combat and driving:** synchronize the firing pose with rapid aim changes and retain hit feedback across slow displayed frames; extended playtests for cover, camera collision, aim feedback, police fairness, vehicle collision and recovery. Current simple collision volumes and arcade driving need further work.
4. **World and narrative:** authored mission variety, meaningful interiors and activities, pedestrian interactions, coherent art direction and soundscape. One short mission is not a complete game.
5. **Assets:** maintain editable sources, reproducible exports and documented licenses. Keep the game distribution separate from historical benchmark fixtures; audit all third-party characters, animations, textures and audio before considering distribution.
6. **Quality:** longer play sessions, recovery/save migration, accessibility, input rebinding and physical-device checks. Browser automation supports testing but does not replace human playtesting or subjective listening.

## Current character proportions and apparel pass

- Fit both heads against their posed body landmarks, shortening the female neck and reducing its lower flare. Keep the source skeleton, inverse binds, eyes and blink alignment intact.
- Tailor the existing garment meshes, replacing balloon trouser volume and knee graphics with continuous authored denim, pockets and stitching. Preserve exposed skin, contact rings and rig influences. Keep editable Blender sources and repeatable staged exports.
- Preserve cloth and hair texture contrast in the runtime material; add subtle original skin normals and spatial skin/hair roughness while retaining the eye response. This adds one 1K normal atlas per sex, about 5.33 MiB each with uncompressed RGBA8 mipmaps.
- Normalize character stature from referenced, skinned neutral geometry before any crouched setup animation. Correct the newly exposed toe/curb footprint miss, preserve standing height during car entry, and blend reload wrist targets continuously.
- Contact checks against the final fitted geometry measure relaxed standing at 1.8079 m male / 1.7446 m female for neutral stature requests of 1.82 / 1.76 m. Worst sampled shoe penetration is 1.264 / 0.746 mm, within the existing 2 mm bound. Smooth the final contact-target interpolation without changing touchdown timing or damping rates. These are sampled measurements, not a continuous terrain-collision guarantee.
- Fit the police cap to the skull with an oval crown and projecting visor, scaled across actor heights.
- Final integrated browser review covers protagonist front/side views, the civilian's ankle complexion, and a deployed officer's cap. Normal-input recordings cover walking onto the sidewalk, jumping/landing, running back to the road, car entry/steering/braking/exit, and aimed occupant fire, reload and theft. Photo zoom restores both models' near detail; settled pause/map/photo preserve simulation and facial state. The PR report carries the recordings, measurements and remaining limitations.
- The final full-city sample measured 6.29 fps at 1039 × 491 on llvmpipe (51 displayed frames in 8,112.1 ms, 421 draw calls and 347,039 triangles). The preceding pass measured 6.36 fps with different scene timing and traffic; this is not a controlled comparison or evidence of hardware frame pacing. The authored normal maps add memory and sampling cost, and full-city performance remains far below release requirements.

### Next iteration priorities

- **Shooting:** separate actual weapon readiness from the aim-button state; align the visible firing pose during rapid camera turns and retain hit feedback for a displayed frame. The current settled-aim encounter passes, but that does not cover rapid aim transitions.
- **Character finish:** compare faces in sun and shade before changing exposure or albedo; current direct sunlight washes out cheek/nose definition. Improve collar and sleeve shapes and structural trouser folds rather than adding more weave texture. Hair still lacks convincing strands and facial acting remains absent.
- **World surfaces:** reduce the road's uniformly speckled fine detail and improve broader wear variation and manhole rim/contact shading. These are visual review findings, not yet implemented changes.

## Previous grounding and distant-character pass

- Ground characters on the actual road, sidewalk, curb, beach and interior slabs. Player jumps use the current surface; pedestrian/officer animation and combat reads use their current floor. Vehicle approaches, exits, evictions and checkpoint placements retain the correct support height. Contact shadows follow the same surface.
- Calibrate each anatomical shoe from its own rendered sole and retain the authored foot orientation. Correct contact at the legs, including landing impact, instead of lifting the entire character. Preserve planted contacts, soften the torso's movement over steps, and query four footprint corners and the center of each shoe for split-level support.
- Calibrate neutral pelvis height from the actual leg lengths and measured soles. Standing knees retain about 20–22 degrees of flexion instead of the previous 42–48-degree crouch, raising the settled torso about 7 cm male / 4.9 cm female. Blend this posture out during gait, landing, airborne and seated motion; preserve source-foot touchdown timing.
- Dense shoe-surface checks found less than 0.8 mm of residual penetration in sampled idle, walk, run, turn, aim and low-cadence poses, down from roughly 29 mm. These sampled measurements do not establish perfect contact in every pose. The bounded footprint sampling is not a continuous terrain collision solver, and a flat sole cannot conform to arbitrary slopes.
- Reduce distant characters to 4,126 male / 4,914 female triangles while keeping the near GLBs and all mid-level definitions byte-for-byte unchanged. Compact only the offline simplifier's working set, use sampled motion to measure deformation, and map the result back to the original vertex IDs. Preserve open body/head boundaries and the existing far-blink policy.
- Final browser recordings cover walking onto the 22 cm sidewalk from the 3.45 cm road, jumping and landing, running back onto the road, car entry/steering/braking/exit, and an aimed occupant shot followed by theft. Close-up review covers settled front/side posture and a civilian on the sidewalk. Production motion, hardware frame pacing, facial acting and asset finish remain open gates.
- Cache current actor transforms during sole sampling instead of refreshing and inverting ancestors for every probe. The final live sample measured 6.36 fps at 1039 × 491 on llvmpipe; sampled animation CPU time was 8.83 ms per game callback versus 13.55 ms before the cache/posture changes. Windows and substep counts differ, so these are CPU observations rather than an isolated cache benchmark or evidence of hardware frame pacing. The PR verification report carries the actual runtime evidence.

## Previous character authoring pass

- Added original raised garment collars, cuffs, armholes and hems, with authored fabric normals, folds, seams and roughness. The base bodies and skeletons remain unchanged. The male hairstyle has a tapered nape and additional textured locks; editable Blender sources and repeatable exports are included.
- Added eyelid and lash deformation from pinned CC0 MakeHuman targets. Blinks use separate actor schedules, pause with simulation, and settle toward closed eyes when an actor is down. This is eyelid motion only: dialogue, eye tracking and facial acting remain missing.
- Matched the male head's neck boundary normals and skin weights to the body. Close-up browser review found and removed the previous horizontal shading band. The clothing still uses the existing body topology and does not establish production character quality.
- Near and middle character geometry preserve the eyelid deformation. Distant geometry explicitly disables the supported blink pair before using cheaper indices; photo zoom restores near detail and the paused phase. Bounds account for supported relative facial motion, retaining conservative fallbacks for unsupported rigs.
- New clothing and hair increase geometry cost. Far counts are 12,951 male and 8,844 female triangles, versus 10,177 and 7,920 previously. No claim of hardware performance or release frame pacing follows from this art pass.
- Browser review covered both faces, paused eyelid poses, front/back garments, far-to-near photo zoom, aimed occupant fire, driving and exit. It caught and corrected a collar strip crossing exposed skin and pale UV-edge bleeding. The final live sample measured 5.85 fps at 1039 × 491 on llvmpipe, versus the preceding 5.73 fps with different traffic and triangle counts; this is not a controlled performance improvement. Facial acting, body/garment finish, interaction motion, foot contact and hardware frame pacing remain open.

## Previous combat and animation pass

- Police rounds originate at the current posed muzzle and stop at the first building, ground, vehicle surface or posed actor they strike. Spread changes the visible ray; damage follows its actual impact. The initial warning window aims outside the player's full posed envelope, and shots retain a shared 1.7-second cadence.
- Normal browser play confirmed that a parked car intercepted rounds without player damage, followed by an exposed torso hit after leaving cover. A separate controlled live-scene fixture confirmed bystander/driver interception, unchanged player crime, fresh moving-car seats and preservation of the driver exit pose. This does not establish extended police-AI fairness or tactical cover behavior.
- NPC animation clocks and transient reactions still advance with physics. Expensive procedural pose solving happens once per displayed frame, or earlier when muzzle/hit geometry is needed. Player animation retains immediate updates.
- The final eight-second live sample processed 4,544 NPC advances with 752 pose solves. Sampled character-animation CPU time fell from 23.18 to 8.69 ms per game callback; mean game-callback CPU time fell from 41.46 to 27.94 ms. These are CPU trace observations, not graphics timings.
- Full-game performance remained effectively unchanged: 5.73 fps at 1039 × 491 internal resolution on llvmpipe, versus 5.74 fps in the preceding pass. Traffic and triangle counts differ. Hardware graphics and release frame pacing remain unproven.
- Low-cadence contact checks preserve planted-foot stability but retain an existing shallow shoe-floor intersection of roughly 2.7 cm on the female rig. Clothing, hair, facial animation, and the overall character finish still need substantial work.

## Previous rendering pass

- Skip world instances fully hidden behind explicitly registered solid building bodies. Hollow interiors and inflated collision bounds are excluded; shadow casters remain available to light cameras. Unsupported camera/world transforms fall back to ordinary frustum visibility.
- Give skinned characters conservative pose envelopes for each render camera. Detached/external rigs, unsupported morphs, shear and invalid transforms retain the safe always-submit behavior; the current character pass adds bounds for supported relative facial motion.
- Reuse only byte-identical character vertices and reorder opaque/cutout triangles without changing source vertex arrays, skin weights, masks, textures, rigs or triangle count. Transparent brow/lash ordering remains intact.
- Correct the Aurora's projector cells so they sit inside both headlamp housings. The Blender source and both exported detail levels contain the fix.
- Refresh paused simulation poses once per frame instead of repeating zero-time physics subdivisions; photo camera movement and presentation continue normally.
- Same-view software-renderer probes show lower scene time from building occlusion and character vertex reuse. Pixel comparisons at the reference camera found no image changes from these optimizations; this does not establish performance or visual coverage across a hardware matrix.
- The final live sample measured 5.74 fps at 1039 × 491 internal resolution on llvmpipe, compared with 4.83 fps in the previous pass. Traffic and sampling windows differ. Controlled paused-view scene samples improved from roughly 149–152 ms to 135–137 ms with occlusion, then to 125–127 ms with character vertex reuse. These remain far below release frame pacing.
- That pass identified repeated NPC pose evaluation and nonphysical police damage as the next targets; the current pass above addresses them and records the remaining limitations.

## Previous draw batching pass

- Merge opaque world batches without changing their geometry, materials, transforms or instance colors. Distant vehicles instance identical wheel parts while preserving steering, spin and stationary calipers; nearby models retain their original meshes.
- Shadow refreshes retain the union of camera-visible instances and casters inside the light frustum. Reflections still restore full geometry. Missing shadow bounds retain the safe full-set fallback.
- Overhead cables retain physical 3D tubes nearby and use filtered coverage at subpixel sizes. Coverage follows the actual viewport, including photo and reflection passes, rather than vanishing into dotted raster samples.
- That pass's full-game samples remained only about 4.7–4.9 fps on the software renderer. Draw calls fell substantially, but hardware performance and release frame pacing remain unproven.

## Previous vehicle and combat pass

- Vehicle shots and camera obstruction now query the full-detail body, glass, wheels and articulated doors. Open cockpit space is no longer filled by a generic hit box; broken glass and body deformation update the query geometry.
- Occupant hit volumes follow the posed skull and torso. Exposed drivers slump in their seat, retain their down state when evicted, and recover; vehicle surfaces shield them from covered shots.
- Seated characters follow suspension orientation as well as position, and palm targets follow the steering rim. Photo lens zoom restores vehicle detail as it already did for characters.
- Camera visibility compacts offscreen instances out of world batches; the current pass extends this to preserve off-camera shadow casters without restoring every instance.
- The earlier GPU timer sample on the software renderer attributed about 172 ms to the scene, 3 ms to ambient occlusion and 8 ms to the final image pass. This identifies further scene work; it does not establish release performance.

## Previous asset and interaction pass

- Replaced the gameplay Ferrari with the original Blender-authored Astra Aurora, including a cockpit, articulated steering wheel and door, wheel assemblies and two detail levels. Historical benchmark fixtures stay outside the game distribution.
- Added eased walking approaches to car doors, shorter pedestrian strides, smoother locomotion transitions and directional foot placement.
- Added pedestrian detours around parked vehicles and civilian traffic yielding to people in its path.

## Previous optimization pass

- Generated two lower triangle-count versions of each natural character while preserving skinning and source vertex attributes. Nearby characters and the playable protagonist retain original detail; camera field of view influences NPC detail.
- Removed redundant final-canvas multisampling, reduced the ambient-occlusion attachment to its single used channel, and removed redundant full-screen clears.
- Kept collision substeps while updating HUD, minimap, audio and lighting once per displayed frame.

See the PR verification report for actual runtime observations and limitations. Do not interpret these changes as evidence that any release gate above is complete.
