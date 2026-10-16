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

## Current asset and interaction pass

- Replaced the gameplay Ferrari with the original Blender-authored Astra Aurora, including a cockpit, articulated steering wheel and door, wheel assemblies and two detail levels. Historical benchmark fixtures stay outside the game distribution.
- Added eased walking approaches to car doors, shorter pedestrian strides, smoother locomotion transitions and directional foot placement.
- Added pedestrian detours around parked vehicles and civilian traffic yielding to people in its path.

## Previous optimization pass

- Generated two lower triangle-count versions of each natural character while preserving skinning and source vertex attributes. Nearby characters and the playable protagonist retain original detail; camera field of view influences NPC detail.
- Removed redundant final-canvas multisampling, reduced the ambient-occlusion attachment to its single used channel, and removed redundant full-screen clears.
- Kept collision substeps while updating HUD, minimap, audio and lighting once per displayed frame.

See the PR verification report for actual runtime observations and limitations. Do not interpret these changes as evidence that any release gate above is complete.
