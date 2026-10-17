# Grand Theft Astra: production readiness

This is a playable browser prototype, not a release-ready AAA game. The ongoing goal is a game ready for AAA studio review and release; the current vertical slice is only an intermediate milestone. A passing build or a good screenshot does not establish release readiness.

## Current slice

- Coastal district with an introductory contact, vehicle theft, police response, delivery and checkpoint persistence.
- Third-person walking, sprinting, aiming, semi-automatic pistol, reload, driving and photo mode.
- Editable Blender props and vehicles, authored replacement human heads, credited external source assets.
- Reduced gameplay HUD, keyboard/mouse and touch controls.

## Release gates still open

1. **Performance:** consistent frame pacing on a documented hardware/browser matrix. Current cloud browser uses llvmpipe software graphics and runs the full city at only a few frames per second. Isolated engine benchmarks do not establish game performance. Profile the complete scene and preserve close-up quality when optimizing.
2. **Characters:** production clothing, facial expressions and lip-sync, close actor self-shadows, convincing turns and stops, terrain-aware feet, vehicle interactions and hit reactions. Bounded gaze and head attention add responsiveness, but the procedural layers and imported base bodies remain visibly limited.
3. **Combat and driving:** extended playtests for cover, camera collision, aim feedback, police fairness, vehicle collision and recovery. Current simple collision volumes and arcade driving need further work.
4. **World and narrative:** authored mission variety, meaningful interiors and activities, pedestrian interactions, coherent art direction and soundscape. One short mission is not a complete game.
5. **Assets:** maintain editable sources, reproducible exports and documented licenses. Keep the game distribution separate from historical benchmark fixtures; audit all third-party characters, animations, textures and audio before considering distribution.
6. **Quality:** longer play sessions, recovery/save migration, accessibility, input rebinding and physical-device checks. Browser automation supports testing but does not replace human playtesting or subjective listening.

## Current coastal water and complexion pass

- Replace the old water pattern with coherent directional swells, filtered ripples, a rough sun reflection and broken coastal foam. Keep analytic fragment normals after rejecting an interpolated variant that saved little time and introduced up to 2.26° normal error. Use an owned small lighting-sky copy and release owned resources safely.
- Correct both sand slabs to end at X=-150, matching the ocean edge instead of extending five metres into wave troughs. Playable bounds and all existing beach/boardwalk heights remain unchanged.
- Author restrained male cheek/nose warmth and jaw stubble in the existing color atlas. Promote the rebuilt GLB and matching LOD/index proof together. Geometry, skeleton, morphs, female files and texture count remain unchanged; the male download grows by 13,816 bytes. This does not fix the hard hairline or add facial acting.
- Isolated native-resolution software-GPU observations put the new water draw around 13–16 ms versus 8–10 ms for the previous water in the same paused view. No-contribution foam/night branches avoid unnecessary work, but this is a quality/cost tradeoff, not a performance improvement. A separate stationary shoreline camera at gameplay resolution (1039 × 491) measured 4.26/4.10 ms for the new draw around a 5.35 ms old-water sample, with no GPU disjoint event. These are view-specific draw timings, not full-scene frame rates. Hardware frame pacing remains unverified.
- A 14.7-second normal-input browser recording covers a 12.08 m shoreline walk in both directions and a 0.837 m jump across 170 displayed samples, returning to supported idle on sand. Day/night photos and a six-frame frozen simulation check exercise the final surface.
- The straight shoreline, calm water repetition, sparse activity, soft garments, limited face shading and absent expressions remain visible. Player turn steps, shot-cancellation changes and close photo self-shadows are staged for subsequent browser acceptance; they are not part of this checkpoint.

## Previous beach and stationary visibility pass

- Replace the flat sand finish with original physical-scale color, normal and roughness maps, broad deposits and a damp shoreline. Add eight original Blender parasols with bowed cloth, seams, ribs and near/far meshes, retaining placement randomness and shared material batches. The editable sources and reproducible export steps are included.
- Register the visible sand and boardwalk as walking surfaces and place thin towels directly on sand. A normal-input browser recording crosses sand at 0 m, boardwalk at 0.2 m and pavement at 0.025 m in both directions across 176 displayed samples, with zero root/ground discrepancy. The jump reaches 0.825 m; foot-contact patches disappear in the air and return after landing.
- Reuse static instance selections only when camera, batch transform, occlusion revision and shadow bounds match exactly. In the browser, a stationary photo view reuses all 127 batches with zero classifications; all eight moving-camera samples immediately classify 34,473 instances, then all five settled samples reuse their selections. This proves skipped work, not an overall frame-rate improvement.
- Browser close-ups show the cloth canopy and underside supports. Blocking the near asset retains the authored far model; blocking both models and sand maps still loads a usable procedural parasol and flat sand. Restoring requests returns all eight authored parasols and the sand finish without unhandled application errors.
- The sea, hard character hairlines, soft garments and sparse beach activity remained visibly limited at this checkpoint. The subsequent water and complexion pass is described above; close photo shadows and turning remain under evaluation.

## Previous character attention, garment and lighting pass

- Add two authored eye joints per natural character, preserving the original skeleton and neutral eye placement. Held, seeded fixations and world-space aim/look targets stay within an 8° yaw / 5° pitch ellipse. Apply the current eyelid weights before gaze, blending each eye back to its audited neutral socket as that lid closes. Far or hidden faces use neutral eyes; paused near views restore the same fixation without advancing simulation.
- Turn a nearby conversation partner's head toward the other character's eyes, with bounded yaw and pitch and movement blending. Weapon aim, reload, vehicle interaction and downed poses retain priority. This is limited attention behavior, not facial expressions, lip-sync or dialogue performance.
- Rework the male shirt into a fitted crew-neck silhouette with shorter tapered sleeves and repaired upper-arm transitions. Replace the dense male hair cards with a refined scalp and sparse accent locks, preserving matte material response and guarded atlas sampling. Keep editable Blender sources and repeatable exports; these repairs do not establish production character quality.
- Separate the photographed solar disc from the HDR used for environment lighting, leaving the visible sky intact and the aligned directional light responsible for direct sun. Use the same lighting derivative for the cars' local reflection capture, then restore the visible background. This reduces duplicate unshadowed solar energy; close actor self-shadows remain a separate open gate.
- Final browser playtests cover held idle fixations, mutual conversation attention, weapon-aim priority, exact frozen facial/head poses, and near/far/near eye restoration. A paused night portrait captures both lids above 0.97 with the eyeballs back at their neutral socket rotation. Playtesting exposed repeated procedural head blending during unchanged zero-time deferred updates; preserving the displayed pose fixes that drift.
- A 17.7-second normal-input recording covers an aimed occupant hit, reload and theft. The first displayed hit retains full feedback after a 250 ms main-thread stall; reload reaches 12/95, the evicted driver remains down, and the seated pose matches the cockpit. Vehicle exit restores foot contacts. Final portraits cover both characters, the officer cap, and day/night vehicle reflections. Missing-model requests still recover through the playable fallback.
- The current male near/mid/far meshes contain 28,991 / 21,131 / 5,217 triangles, and the female meshes contain 22,092 / 12,618 / 4,844, with three material batches each. Faint upper-arm complexion transitions, small collar/shoulder creases, hard hairlines, soft garment shapes, limited face shading and absent facial acting remain visible. These are intermediate assets.
- Final full-city samples measure 5.77 fps exploring and 5.79 fps aiming at 1039 × 491 on llvmpipe, with 422/414 draw calls. These are lower than the preceding pass's 7.02/7.19 fps samples, but traffic, timing and scene content differ; no isolated cause or hardware frame-pacing conclusion is established. Hardware profiling and long play sessions remain open release gates.

## Previous character surface and contact pass

- Replace the original speckled shoe artwork with authored charcoal uppers, panel seams and restrained sole wear. Preserve the shoe geometry, rig, UVs and calibrated support points.
- Preserve source hair roughness and specular intensity in the head atlas. Store roughness and specular as independent scalar channels, and resize those channels independently. Wider atlas guards prevent neighboring skin colors from bleeding into narrow hair strands at the validated mip levels; coarse and anisotropic filtering still need broader coverage.
- Replace the natural characters' body-centered contact blobs with two independently fading patches projected from their final posed soles. Keep each patch flat on its supporting surface and clip it at curb discontinuities. Reuse existing grounding samples and skip unchanged paused poses; seated, downed and airborne states suppress contact as appropriate. The articulated fallback retains its simpler shadow.
- Fill the café frontage gap with registered pavement at 0.22 m, including the entrance threshold. The doorway retains one 18.55 cm step down to the interior floor rather than a narrow unpaved trench.
- Live input checks cover idle, walking, running, jump suppression and landing recovery, exact paused contact geometry, and hidden seated contacts that return after vehicle exit. A recorded walk/run/jump sequence preserves the actual software-rendered cadence. Café traversal covers both window barriers and the doorway in both directions across 152 displayed samples; root height always equals queried ground, and the crossing shoes can rest on different levels.
- Close photo views cover the protagonist's rear hair, shaded face, oblique head, footwear and night lighting, plus the civilian in bright daylight. The bright orange crown flecks are reduced by the atlas fix; front hairlines still read as a hard cap, clothing remains soft, and facial acting is absent. The female face still loses definition in bright daylight. Later shadow diagnostics confirmed that this street portrait was in building shade, despite its bright environment lighting. These changes are incremental character finish, not production character quality or AAA release readiness.

- Final full-city samples measured 7.02 fps exploring and 7.19 fps aiming at 1039 × 491 on llvmpipe, with 422/414 draw calls. Foot-contact projection accounts for about 0.43/0.45 ms of sampled CPU time per game callback across all characters. These are observations from different traffic and timing windows, not an isolated speedup; the added physical head shader cost and hardware frame pacing remain unmeasured.

## Previous camera, aiming cost and road pass

- Prevent the camera from showing the protagonist's interior surfaces when the boom retracts into the body. Private player material write masks hide color and depth below 0.55 m and restore beyond 0.75 m, preserving logical visibility, bones, the muzzle and shadow casters. Contact shadows remain separate. Photo mode restores the whole character and retains gameplay hysteresis for its return; vehicle and interaction contexts restore drawing.
- Live wall checks cover clear visibility, a physical muzzle shot hitting the solid frame at 2.22 m, hidden reload, stepping away, three repeated approach/recovery cycles, restart and a paused photo round trip, including a preserved 0.567 m hysteresis-band position. All eight player materials restore; repeated crossings hold at 50 warmed shader programs. This is a binary proximity mask, not a production camera blend.
- Stop repeated pistol correction only after the original target, weapon transform and support wrist converge. Close targets, raising, reload, recoil and anatomically limited requests retain the five-pass cap. A paired 2,124-pose audit found no readiness changes and less than 49 nm of joint displacement difference.
- An isolated nine-round Node comparison of the complete animation update at a settled 90 m target measured 24.1% lower CPU time for the male rig and 27.5% for the female rig (five passes reduced to three). Close 2 m cases retained five passes with overlapping timing variation. This measures animation CPU cost, not browser frame rate or input latency.
- Author original low-contrast asphalt and cast-iron surface maps, with broad world-space weather and subtle wheel-path polish. Give manholes bevelled frames and recessed seats. New texture requests total 1.16 MB instead of the old asphalt's 2.52 MB; the eleven covers add 4,356 triangles and one dedicated instanced batch. Sources and rebuild instructions are in ASSETS.md.
- Final browser samples measured 6.04 fps exploring and 6.21 fps aiming at 1039 × 491 on llvmpipe. Aimed callback CPU averaged 30.10 ms (p95 32.39 ms), versus the previous sample's 32.23 ms (p95 39.30 ms); traffic, road materials and sampling windows differ. These are full-scene observations, not an isolated speedup or evidence of hardware frame pacing.
- Playtesting found a separate authored paving gap beside Sunline: the sidewalk ends at x=16.95 while the storefront begins at x=17.425. The accessible gap drops from 0.22 m to the 0.025 m base surface. The terrain query matches the authored surfaces; a local apron and doorway transition need a subsequent geometry pass.

## Previous shooting and aim pass

- Resolve movement and camera direction before the character pose. Turn the upper body within bounded yaw and reach; converge the visible pistol on the current reticle target, including close targets. Accept a buffered click only when the raised barrel is aligned, then apply one immediate recoil event without advancing animation twice.
- Preserve a confirmed hit until the HUD displays it. Freeze the feedback while paused and clear queued clicks when opening menus, holstering, reloading or entering a vehicle. Keep shot identifiers monotonic across restarts.
- Use actual movement distance for footstep cadence and weapon spread, so pushing against a wall does not count as running. Query exact driver hit volumes only when a camera or muzzle ray intersects their conservative envelope; missing bounds retain full checks.
- Normalize posed arm and wrist rotations and preserve the original lowered elbow position while refining wrist alignment. Visual review rejected an earlier wrist-only refinement because it raised the elbows unnaturally. The shorter female rig still limits the available elbow pose at the shared grip; this is not a production motion-capture solution.

- Final normal-input browser checks cover first raise, immediate 90/180-degree turns, upward/downward aim, hip-fire follow-up, cancelled clicks, frozen armed poses, close occupant fire, reload and theft. The first raise accepted after 262.5 ms; sampled rapid turns accepted after about 29–75 ms, with the visible barrel within 1.25 degrees of the final ray. These are simulation-time observations on the software renderer, not measured hardware input latency. An induced 250 ms browser stall retained a full-strength hit marker on its first displayed frame.
- The final full-city samples measured 6.45 fps exploring and 6.30 fps aiming at 1039 × 491 on llvmpipe, with 421/415 draw calls and 347,039/372,444 triangles. Scene timing and traffic differ from the previous 6.29 fps sample, so this is not an isolated improvement benchmark. Hardware frame pacing remains unproven.
- Blocking all primary/legacy character downloads exercised the articulated fallback: it still raises, turns, fires once per press and kicks immediately. Restoring requests reloads the natural rigs. The fallback is deliberately simple and is not the intended visual presentation.
- Wall movement correctly reports zero speed and stationary spread. The same playtest exposes a remaining camera defect: at the storefront near x=17.075, z=23, boom retraction places the camera inside the protagonist. The camera mask in the current pass resolves the interior-surface obstruction; the paving gap remains separate.

## Previous character proportions and apparel pass

- Fit both heads against their posed body landmarks, shortening the female neck and reducing its lower flare. Keep the source skeleton, inverse binds, eyes and blink alignment intact.
- Tailor the existing garment meshes, replacing balloon trouser volume and knee graphics with continuous authored denim, pockets and stitching. Preserve exposed skin, contact rings and rig influences. Keep editable Blender sources and repeatable staged exports.
- Preserve cloth and hair texture contrast in the runtime material; add subtle original skin normals and spatial skin/hair roughness while retaining the eye response. This adds one 1K normal atlas per sex, about 5.33 MiB each with uncompressed RGBA8 mipmaps.
- Normalize character stature from referenced, skinned neutral geometry before any crouched setup animation. Correct the newly exposed toe/curb footprint miss, preserve standing height during car entry, and blend reload wrist targets continuously.
- Contact checks against the final fitted geometry measure relaxed standing at 1.8079 m male / 1.7446 m female for neutral stature requests of 1.82 / 1.76 m. Worst sampled shoe penetration is 1.264 / 0.746 mm, within the existing 2 mm bound. Smooth the final contact-target interpolation without changing touchdown timing or damping rates. These are sampled measurements, not a continuous terrain-collision guarantee.
- Fit the police cap to the skull with an oval crown and projecting visor, scaled across actor heights.
- Final integrated browser review covers protagonist front/side views, the civilian's ankle complexion, and a deployed officer's cap. Normal-input recordings cover walking onto the sidewalk, jumping/landing, running back to the road, car entry/steering/braking/exit, and aimed occupant fire, reload and theft. Photo zoom restores both models' near detail; settled pause/map/photo preserve simulation and facial state. The PR report carries the recordings, measurements and remaining limitations.
- The final full-city sample measured 6.29 fps at 1039 × 491 on llvmpipe (51 displayed frames in 8,112.1 ms, 421 draw calls and 347,039 triangles). The preceding pass measured 6.36 fps with different scene timing and traffic; this is not a controlled comparison or evidence of hardware frame pacing. The authored normal maps add memory and sampling cost, and full-city performance remains far below release requirements.

### Next iteration priorities

- **Camera and thresholds:** refine the binary proximity transition and extend obstruction coverage around doors, low roofs, moving vehicles and extreme pitch. Preserve photo close-ups, shadows and physical shot queries.
- **Performance:** profile the complete city on hardware; investigate geometry/fragment cost and precise actor-pose demand during combat. Preserve the proven close-target and recoil behavior.
- **Combat depth:** extend movement/cover playtests, improve hit reactions and adversary tactics, and evaluate weapon sound and input latency on hardware. The current pistol and bounded procedural grip remain a small combat slice.
- **Character finish:** review the repaired hairline, shirt and upper arms across motion, distance and oblique filtering. Extend bounded gaze and head attention into facial expressions, lip-sync and authored dialogue gestures. Improve close actor self-shadows and shoe geometry while preserving the corrected material channels, eye sockets and foot contact. Compare faces in sun and shade after solar separation before changing exposure or albedo. The sidearm's physical bore and muzzle anchor already agree with its local +Z firing axis.
- **World geometry:** extend threshold and obstruction coverage beyond the corrected café entrance. Add authored street wear and repair variation without uniform noise or excessive geometry.

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
- Added eyelid and lash deformation from pinned CC0 MakeHuman targets. Blinks use separate actor schedules, pause with simulation, and settle toward closed eyes when an actor is down. That pass covered eyelid motion only; the current pass adds bounded gaze, while facial expressions and lip-sync remain missing.
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
