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
3. **Combat and driving:** extended playtests for cover, camera collision, aim feedback, police fairness, vehicle collision and recovery. Current simple collision volumes and arcade driving need further work.
4. **World and narrative:** authored mission variety, meaningful interiors and activities, pedestrian interactions, coherent art direction and soundscape. One short mission is not a complete game.
5. **Assets:** maintain editable sources, reproducible exports and documented licenses. Keep the game distribution separate from historical benchmark fixtures; audit all third-party characters, animations, textures and audio before considering distribution.
6. **Quality:** longer play sessions, recovery/save migration, accessibility, input rebinding and physical-device checks. Browser automation supports testing but does not replace human playtesting or subjective listening.

## Current combat and animation pass

- Police rounds originate at the current posed muzzle and stop at the first building, ground, vehicle surface or posed actor they strike. Spread changes the visible ray; damage follows its actual impact. The initial warning window aims outside the player's full posed envelope, and shots retain a shared 1.7-second cadence.
- Normal browser play confirmed that a parked car intercepted rounds without player damage, followed by an exposed torso hit after leaving cover. A separate controlled live-scene fixture confirmed bystander/driver interception, unchanged player crime, fresh moving-car seats and preservation of the driver exit pose. This does not establish extended police-AI fairness or tactical cover behavior.
- NPC animation clocks and transient reactions still advance with physics. Expensive procedural pose solving happens once per displayed frame, or earlier when muzzle/hit geometry is needed. Player animation retains immediate updates.
- The final eight-second live sample processed 4,544 NPC advances with 752 pose solves. Sampled character-animation CPU time fell from 23.18 to 8.69 ms per game callback; mean game-callback CPU time fell from 41.46 to 27.94 ms. These are CPU trace observations, not graphics timings.
- Full-game performance remained effectively unchanged: 5.73 fps at 1039 × 491 internal resolution on llvmpipe, versus 5.74 fps in the preceding pass. Traffic and triangle counts differ. Hardware graphics and release frame pacing remain unproven.
- Low-cadence contact checks preserve planted-foot stability but retain an existing shallow shoe-floor intersection of roughly 2.7 cm on the female rig. Clothing, hair, facial animation, and the overall character finish still need substantial work.

## Previous rendering pass

- Skip world instances fully hidden behind explicitly registered solid building bodies. Hollow interiors and inflated collision bounds are excluded; shadow casters remain available to light cameras. Unsupported camera/world transforms fall back to ordinary frustum visibility.
- Give skinned characters conservative pose envelopes for each render camera. Detached/external rigs, morphs, shear and invalid transforms retain the safe always-submit behavior.
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
