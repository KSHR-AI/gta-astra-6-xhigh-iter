# Pacific Heat

An original GTA-inspired, single-player browser sandbox built with Three.js. Explore a compact coastal city, steal a car, complete a driving objective, and evade the police.

## Run

Requires Node.js 22+ and a browser supporting WebGL 2.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. `npm run build` produces the static site in `dist/`; `npm run preview` serves that build.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move or drive |
| Shift | Sprint |
| Space | Jump / handbrake |
| E / F | Enter or exit a nearby vehicle |
| Drag the mouse | Orbit the camera |
| Double-click the scene | Lock the pointer for mouse look; Escape releases it |
| 1 | Equip / holster pistol |
| Right mouse button | Aim |
| Left mouse button | Fire |
| R | Reload |
| H | Horn while driving |
| M | City map |
| Escape | Pause / settings |

Touch devices receive directional and action buttons. Drag the scene to look around. Settings offer sound, rendering quality, golden hour/night, and session restart.

## What's playable

- A modeled coastal district with 37 building collision volumes, storefronts, balconies, palms, a promenade, beach, and animated ocean.
- Skeletally animated player and pedestrians, with idle/walk/run transitions and aiming poses.
- Nine vehicles with turning/spinning wheels, opening doors, headlights, acceleration, reverse, steering, braking, and collisions.
- Car theft, a waypoint driving objective, reward money, police pursuit, wanted-level decay, health, and respawning.
- Pistol ammunition/reloading, muzzle flashes, tracer and impact effects, pedestrian reactions, vehicle damage, and building occlusion for shots.
- Live minimap, full map, mission HUD, synthesized engine/horn/weapon/siren sounds, and pause/settings.

This is a compact original prototype. It does not include GTA V's map, licensed assets, multiplayer, interiors, a full campaign, advanced ragdoll physics, or saved progression. Cars and character movement use purpose-built arcade physics. The player uses a tactical character model; civilian pedestrians use a second detailed model. See [ASSETS.md](ASSETS.md) for sources and usage terms.

## Implementation

The application is a static Vite site. `src/main.js` coordinates gameplay and input, `world.js` builds the district using instanced geometry, `vehicles.js` builds the articulated cars, `characters.js` loads local GLBs and cloned skeletons, and `ui.js`/`style.css` implement the HUD. `audio.js` generates sound locally with Web Audio; no audio files or external API keys are needed.

Building shadows are cached and refreshed as the player travels. Moving actors use soft contact shadows. Repeated architecture is instanced, cars share geometry, and distant pedestrians are culled. Hardware-accelerated WebGL is recommended; the renderer reduces its internal resolution on software graphics implementations. The UI stays at native resolution.

Niteshift starts the Vite service on port 3000 using the checked-in `.niteshift/` configuration. A read-only `window.__PACIFIC_HEAT__.getState()` view exposes gameplay and renderer counters for browser verification without mutating the simulation.
