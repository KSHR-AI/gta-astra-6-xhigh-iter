# Blender source art

Save editable `.blend` projects here and export reviewed game assets to `public/models/` as `.glb` files. Blender backup files (`.blend1`, `.blend2`) are ignored; source `.blend` files are not.

The Niteshift setup installs the official **Blender 4.5.14 LTS** Linux binary with a pinned SHA-256 checksum, plus an isolated desktop on display `:100`. It starts automatically as the `blender` service on port **6082**. The game remains on port **3000**.

```sh
ns services status           # get the authenticated Blender and game preview URLs
ns preview 6082              # show Blender in the preview panel
ns preview 3000              # return to the game
ns services logs blender     # diagnose the desktop/editor
```

Open the Blender preview to control the desktop with the mouse and keyboard. Click the viewport before using shortcuts. Use the toolbar's **Save** and **Command search** buttons when the browser intercepts Ctrl+S or F3. Middle-drag orbits, the scroll wheel zooms, and Tab toggles Edit Mode. File → Import → glTF 2.0 imports the models under `public/models/`. File → Export → glTF 2.0 exports `.glb` files for Three.js.

There is no GPU device in this sandbox. Blender uses Mesa software graphics and four CPU rendering threads; use Solid viewport shading for interactive work. Heavy Cycles/EEVEE scenes are better handled on a GPU workstation. The desktop's VNC port stays on loopback, and the web client uses Niteshift's authenticated preview. Do not expose it through a public tunnel.

Closing the editor reopens it; reloading the browser keeps the editor session. Save before a service restart or sandbox shutdown. Saved files survive in the workspace; unsaved editor state is not guaranteed across restarts. User preferences live under `~/.config/blender`.

Agents can control this desktop through the browser with `agent-browser`, or use native X11 input with `DISPLAY=:100 xdotool …`. Blender is also on `PATH` for reproducible asset scripts:

```sh
blender --background --python path/to/asset_script.py
DISPLAY=:100 xdotool search --onlyvisible --class Blender
```

The browser desktop does not install a native computer-use connector or Unreal Engine. It provides remote desktop input and the Blender Python API for our asset workflow.

## Game asset sources

The game now uses these original Blender exports:

```sh
blender --background --factory-startup --threads 2 --python art/blender/vehicle_meridian.py
blender --background --factory-startup --threads 2 --python art/blender/city_streetscape.py
blender --background --factory-startup --threads 2 --python art/blender/character_sidearm.py
```

Each generator saves its editable `.blend` beside the script and its GLB under `public/models/`. The city generator also creates its original sign/newspaper/fabric atlas through `city_textures.py`. The vehicle generator exports both near and simplified far meshes. Runtime integration lives in `src/vehicles.js`, `src/world-props.js`, and `src/characters.js`. Keep the named wheel, door, grip, and muzzle attachment conventions when editing assets. Preview changes in-game, including door/steering motion and the seated driver, before committing exports.
