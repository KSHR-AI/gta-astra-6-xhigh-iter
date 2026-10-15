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

Tests exercise mission progression, reward and checkpoint persistence, building visibility, witnesses, and police-state transitions. They do not replace playing the browser build. The production build is written to `dist/`; preview serves that build.

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
| Left mouse button | Fire |
| R | Reload |
| H | Horn while driving |
| M | City map |
| Escape | Pause / settings |

Touch controls provide movement, run/jump, contextual Use, firing, reload, and equip buttons. Drag the scene to look around; the contextual prompt itself can also be tapped. Settings include sound, Cinematic/Performance rendering, golden hour/night, and session restart.

## World and gameplay

- **An authored neighborhood:** the Orbit contact office, Sunline diner, Paloma motel office/courtyard, and Astra Auto Works garage have accessible openings and modeled furnishings. Other buildings provide the surrounding streetscape. Curbs, balconies, palms, shrubs, road wear, beach, promenade, and animated water give the district its coastal setting.
- **Animated people:** a civilian male protagonist, male and female pedestrians, Mara, visible vehicle occupants, and police officers. Retargeted idle/walk/run animation is combined with authored skeletal layers for aiming, reloading, jumping, driving, and entering/exiting cars. Taking an occupied vehicle includes a visible driver exit.
- **Driving and damage:** imported sports convertibles and original sedans/patrol cars, visible seated drivers, opening doors, steering wheels, wheel rotation, suspension lean, braking/reverse, tire grip, handbrake slip, automatic gears, and collision impulses. Damage changes body panels, glazing, lights, and smoke; repairs restore the vehicle. The HUD displays speed, gear, RPM, and condition.
- **Witnesses and police:** nearby civilians react to crimes, visible thefts can produce delayed witness reports, and gunfire can be heard nearby. Building collision volumes obstruct sight. Patrols pursue a last-known position, search after losing sight, and clear the alert after an uninterrupted escape. Visible officers can deploy and fire when they have line of sight.
- **Combat and presentation:** a pistol with ammunition/reload timing, muzzle and impact effects, building occlusion for shots, health, checkpoint respawning, mission subtitles, progress and reward notices, minimap/full map, and contextual interaction prompts.
- **Sound:** local engine and coastal recordings, concrete and beach footsteps, door/impact/reload foley, synthesized weapons and horns, spatial sirens, and a subdued adaptive pursuit motif. Audio starts after a user gesture.

## Implementation

The game is a static Vite site and needs no backend or API key. `src/main.js` connects input and gameplay. `missions.js` owns mission checkpoints and the small economy; `simulation.js` handles traffic, pedestrians, witnesses, and police. `driving.js` supplies fixed-step vehicle handling and collision responses, while `vehicles.js` constructs and animates vehicle meshes. `characters.js`, `character-animation.js`, and `character-pose.js` load and animate the population. The `world*.js` modules build the district and its materials. `ui.js`/`style.css` implement the HUD and menus; `audio.js` combines local recordings with Web Audio synthesis.

Rendering combines local PBR surface maps, a photographic HDR sky, local vehicle reflections, depth-based ambient occlusion, FXAA, restrained bloom/color grading, directional shadows, and contact shadows. Night mode changes the sky and illumination and adds nearby streetlight/headlight pools. Geometry instancing, shared vehicle assets, character detail reduction, and distance culling limit rendering cost. Software-rendered WebGL uses a lower internal resolution and cached building shadows; the interface remains at native resolution. Performance depends on hardware, resolution, browser, and selected quality.

Niteshift runs the Vite service on port 3000 using `.niteshift/`. A read-only `window.__GRAND_THEFT_ASTRA__.getState()` view exposes gameplay and renderer state for browser inspection.

## Prototype limits and asset terms

This is a compact prototype, not a finished AAA game or GTA V recreation. It contains one mission chain, a limited population and patrol, simplified road routing, and a small set of accessible ground-floor spaces. Most buildings and motel guest rooms remain scenery. It has no multiplayer, extensive campaign, cloud saves, advanced ragdolls, facial capture, spoken dialogue, or fully simulated vehicle interiors. Character interaction poses are partly procedural, and occasional clipping can occur. Driving uses custom arcade handling rather than a full rigid-body vehicle simulator.

The project includes original geometry, CC0 textures/recordings and a CC0 civilian model, plus Mixamo-derived characters/animation and an imported Ferrari model with separate usage terms. **The Ferrari model’s original upstream license declaration remains unverified; see the attribution caveat in [ASSETS.md](ASSETS.md).** No GTA V game files or Rockstar assets are included. Review the asset-specific terms before redistributing the game.
