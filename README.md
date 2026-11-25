# Grand Theft Astra

A single-player browser action game built with Three.js. Explore Los Pacificos, a compact coastal district, play **The Coastal Job**, steal and drive cars, and escape a police search. This is an original playable prototype inspired by open-world crime games, with a small authored neighborhood and one mission chain.

## Run and test

Requires Node.js 22+ and a browser supporting WebGL 2. Hardware-accelerated graphics are recommended.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`.

```sh
npm test
npm run build
npm run preview
```

Tests exercise mission progression, persistence, witnesses, police-state transitions, shot occlusion, recoil timing, and the imported characters’ gait, grip, and reload poses. They do not replace playing the browser build. The production build is written to `dist/`; preview serves that build.

## The Coastal Job

1. Meet **Mara** inside the Orbit corner office and press **E** for the briefing.
2. Take the teal convertible on the boulevard. The theft draws attention.
3. Break police line of sight and remain hidden until the search ends.
4. Drive into Mara’s workshop, stop, and press **E** to deliver the car for **$1,500**.
5. Visit the **Paloma Motor Lodge** courtyard to claim your safehouse, rest, and save.

After the delivery, continue exploring. Mara sells **36 pistol rounds for $150**, subject to the 192-round reserve limit. The workshop repairs a damaged vehicle for **$100** after the job. Resting at the Paloma restores health and stamina and replenishes the reserve to at least 96 rounds. A wrecked mission car resets the attempt so the job can be retried.

Progress uses the current browser’s `localStorage`, under `grand-theft-astra:coastal-job:v1`. Saves retain the mission checkpoint, money, and completed-job count. Returning during an escape or delivery restores the pre-theft checkpoint with a fresh mission car; it does not serialize the live traffic, police, or every vehicle’s position. The title menu offers Continue when a save exists. **Start a fresh session** clears this progress. If browser storage is unavailable, play continues without persistent saves. Saves are local to this browser and site origin, with no account or cloud synchronization.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move or drive |
| Shift | Sprint |
| Space | Jump / handbrake |
| E / F | Talk, buy supplies, deliver, repair, rest, or enter/exit a vehicle, according to the nearby prompt |
| Drag the mouse | Orbit the camera |
| Double-click the scene | Lock the pointer for mouse look; Escape releases it |
| 1 | Equip / holster pistol |
| Right mouse button | Aim |
| Left mouse button | Fire one pistol round per press |
| R | Reload |
| H | Horn while driving |
| M | City map |
| P | Enter / leave photo mode |
| Escape | Pause / settings; leave photo mode |

Touch controls provide movement, run/jump, contextual Use, separate hold-to-aim and fire buttons, reload, and equip. Dragging the scene looks around without firing. The pistol fires once per press; an equipped weapon rests low until aiming or firing. The contextual prompt itself can also be tapped. Settings include sound, Cinematic/Performance rendering, golden hour/night, and session restart.

## Photo mode

Press **P** during play, or select **Photo mode** in the pause menu. The world freezes while you compose the shot: **WASD** flies the camera, **Q/E** lowers/raises it, **Shift** moves faster, dragging looks around, and the wheel changes the lens. The toolbar controls field of view, focus distance, depth blur, roll, and exposure. **H** hides the controls; **Save photo** downloads a PNG of the actual rendered scene without HUD. **Reset camera** restores the entry view. **Escape/P** returns to the previous game or pause state, restoring rendering resolution and camera settings.

Photo mode renders at native resolution (up to 1.5× device pixels) with four-sample antialiasing and optional depth blur. These still-image settings cost more than normal play, especially on software graphics.

## World and gameplay

- **An authored neighborhood:** the Orbit contact office, Sunline diner, Paloma motel office/courtyard, and Astra Auto Works garage have accessible openings and modeled furnishings. Other buildings provide the surrounding streetscape. Curbs, balconies, palms, shrubs, road wear, beach, promenade, and animated water give the district its coastal setting.
- **Original Blender assets:** curved bus shelters, a newspaper kiosk, cafe seating/parasols, the Meridian executive sedan and police variant, and a detailed compact pistol. Editable `.blend` projects and deterministic generation scripts live in `art/blender/`; the game loads the exported GLBs locally.
- **Animated people:** anatomically proportioned MakeHuman heads with textured skin, fitted eyes, short hair or ponytails, and varied skin/hair tones replace the earlier stylized faces. The civilian protagonist, pedestrians, Mara, visible vehicle occupants, and police officers retain their clothed, rigged bodies. Retargeted idle/walk/run animation is combined with authored skeletal layers for aiming, reloading, jumping, driving, and entering/exiting cars. Taking an occupied vehicle includes a visible driver exit. Planted-foot correction, asymmetrical breathing, and articulated fingers improve standing, locomotion, weapon grips, and seated steering.
- **Driving and damage:** imported sports convertibles and original sedans/patrol cars, visible seated drivers, opening doors, steering wheels, wheel rotation, suspension lean, braking/reverse, tire grip, handbrake slip, automatic gears, and collision impulses. Damage changes body panels, glazing, lights, and smoke; repairs restore the vehicle. The compact driving HUD shows speed and gear, with a condition warning when the vehicle is damaged.
- **Witnesses and police:** nearby civilians react to crimes, visible thefts can produce delayed witness reports, and gunfire can be heard nearby. Building collision volumes obstruct sight. Patrols pursue a last-known position, search after losing sight, and clear the alert after an uninterrupted escape. Visible officers can deploy and fire when they have line of sight.
- **Combat and presentation:** a semi-automatic pistol with a raised firing stance, shoulder aiming, recoverable recoil, movement-dependent accuracy, brief muzzle flash, ejected brass, spatial shots/impacts, and timed reload foley. The raised pistol follows the current reticle target, including rapid turns and close-range convergence; firing waits for the actual barrel to align. Raised stationary turns use alternating foot placement and a bounded body rotation. A brief trigger tap retains its original eligibility window while the weapon settles; menu, holster and reload actions cancel pending fire. Each accepted shot kicks the visible weapon immediately, and hit feedback survives until its first displayed frame. A second trace from the muzzle checks buildings, vehicles, and people so nearby cover blocks shots. Accuracy and footstep cadence follow actual movement, including when an obstruction stops the player. The HUD shows accuracy, hit feedback, obstruction, low ammunition, and reload progress. Exploration keeps only a small minimap and objective line; full mission details, balance, and controls live in the map or pause menu. Police status appears once, and brief notifications stay at the screen edge. Menus constrain keyboard focus and restore it on close. Health, checkpoint respawning, mission subtitles, rewards, maps, and contextual prompts remain available.
- **Sound:** local engine and coastal recordings, concrete and beach footsteps, door/impact/reload foley, synthesized weapons and horns, spatial sirens, and a subdued adaptive pursuit motif. Audio starts after a user gesture.

## Implementation

The game is a static Vite site and needs no backend or API key. `src/main.js` connects input and gameplay. `missions.js` owns mission checkpoints and the small economy; `simulation.js` handles traffic, pedestrians, witnesses, and police. `driving.js` supplies fixed-step vehicle handling and collision responses, while `vehicles.js` constructs and animates vehicle meshes. `characters.js`, `character-animation.js`, and `character-pose.js` load and animate the population. The `world*.js` modules build the district and its materials. `ui.js`/`style.css` implement the HUD and menus; `audio.js` combines local recordings with Web Audio synthesis.

Rendering combines local PBR surface maps, a photographic sunset HDR sky aligned to the directional sun, local vehicle reflections, depth-based ambient occlusion, FXAA, restrained bloom/color grading, directional shadows, and contact shadows. The ocean reflects the same sky over layered waves and shoreline foam. Night mode changes the sky and illumination and adds nearby streetlight/headlight pools. Geometry instancing, shared vehicle assets, character detail reduction, and distance culling limit rendering cost. Software-rendered WebGL uses a lower internal resolution and cached building shadows; the interface remains at native resolution. Performance depends on hardware, resolution, browser, and selected quality.

Niteshift runs the Vite service on port 3000 using `.niteshift/`. A read-only `window.__GRAND_THEFT_ASTRA__.getState()` view exposes gameplay and renderer state for browser inspection.

Blender 4.5.14 LTS is available through a separate interactive desktop on port 6082. Use `ns preview 6082` to model assets, then `ns preview 3000` to return to the game. See [the Blender workspace guide](art/blender/README.md) for controls, source files, exports, and command-line automation.

## Engine comparison workspace

Three.js, Babylon.js, PlayCanvas, and Godot are installed in an isolated [engine lab](benchmarks/README.md). Run `ns preview 3100` to compare the same scene and export raw frame timings. Godot also has an optional native editor on the Blender desktop: `ns services start godot-editor`, then `ns preview 6082`. The game remains on its existing Three.js stack. See [the measured results and recommendation](benchmarks/RESULTS.md).

## Prototype limits and asset terms

This is a compact prototype, not a finished AAA game or GTA V recreation. It contains one mission chain, a limited population and patrol, simplified road routing, and a small set of accessible ground-floor spaces. Most buildings and motel guest rooms remain scenery. It has no multiplayer, extensive campaign, cloud saves, advanced ragdolls, facial capture, spoken dialogue, or fully simulated vehicle interiors. Character interaction poses are partly procedural, and occasional clipping can occur. Driving uses custom arcade handling rather than a full rigid-body vehicle simulator.

The game includes original vehicle geometry, CC0 textures/recordings and civilian source assets, plus Mixamo-derived characters/animation with separate usage terms. The original Astra Aurora replaces the imported Ferrari in gameplay. The historical engine benchmark retains a separate Ferrari fixture with an unverified upstream license declaration; it is excluded from the game build. See [ASSETS.md](ASSETS.md) for provenance and asset-specific terms. No GTA V game files or Rockstar assets are included. Review the asset-specific terms before redistributing the game.
