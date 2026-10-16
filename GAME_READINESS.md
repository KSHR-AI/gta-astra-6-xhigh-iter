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

## Current rendering pass

- Skip world instances fully hidden behind explicitly registered solid building bodies. Hollow interiors and inflated collision bounds are excluded; shadow casters remain available to light cameras. Unsupported camera/world transforms fall back to ordinary frustum visibility.
- Give skinned characters conservative pose envelopes for each render camera. Detached/external rigs, morphs, shear and invalid transforms retain the safe always-submit behavior.
- Reuse only byte-identical character vertices and reorder opaque/cutout triangles without changing source vertex arrays, skin weights, masks, textures, rigs or triangle count. Transparent brow/lash ordering remains intact.
- Correct the Aurora's projector cells so they sit inside both headlamp housings. The Blender source and both exported detail levels contain the fix.
- Refresh paused simulation poses once per frame instead of repeating zero-time physics subdivisions; photo camera movement and presentation continue normally.
- Same-view software-renderer probes show lower scene time from building occlusion and character vertex reuse. Pixel comparisons at the reference camera found no image changes from these optimizations; this does not establish performance or visual coverage across a hardware matrix.
- The final live sample measured 5.74 fps at 1039 × 491 internal resolution on llvmpipe, compared with 4.83 fps in the previous pass. Traffic and sampling windows differ. Controlled paused-view scene samples improved from roughly 149–152 ms to 135–137 ms with occlusion, then to 125–127 ms with character vertex reuse. These remain far below release frame pacing.
- A final CPU trace still attributes most sampled game-frame work to character animation. The next performance target is repeated NPC pose evaluation across physics substeps, with fresh muzzle and hit-volume poses retained for combat. Police shots also need actual vehicle/surface traces before cover can be considered reliable.

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
