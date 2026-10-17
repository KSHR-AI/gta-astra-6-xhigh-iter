# Grand Theft Astra engine lab

This is an isolated rendering and animation workload for Three.js, Babylon.js, PlayCanvas, and Godot. It provides reproducible browser samples and separate build/export measurements. It does not port the game or measure its traffic AI, physics, combat, audio, streaming, or advanced post-processing.

The JavaScript lab has its own package manifest, lockfile, Vite configuration, and production server in [`engines/`](engines/). The game retains its existing dependencies and entry point. The adapters share the source models already in `public/models/`; their licenses remain documented in [`ASSETS.md`](../ASSETS.md).

## Installed tools

| Component | Pinned version | What is installed |
| --- | --- | --- |
| Three.js | 0.180.0 | npm engine and glTF loader |
| Babylon.js | 9.31.0 | npm core and glTF loaders |
| PlayCanvas | 2.23.3 | Standalone npm engine; the hosted PlayCanvas Editor is not installed or benchmarked |
| Vite | 7.1.9 | Shared JavaScript bundler and development server |
| Godot | 4.7.2 stable | Official Linux x86_64 editor and matching precompiled web export templates, verified by SHA-256 |

Niteshift's [setup script](../.niteshift/setup) installs the dependencies and prepares both production applications automatically. The scripts require Python 3 and a Node version accepted by Vite (`^20.19.0` or `>=22.12.0`). The pinned Godot installer targets Linux x86_64 and writes to `/opt` and `/usr/local/bin`.

For manual setup from the repository root:

```bash
bash .niteshift/install-godot
bash benchmarks/setup
```

`benchmarks/setup` runs `npm ci` when the lab lockfile requires it, then [`prepare.py`](prepare.py). Preparation rebuilds the production web lab and Godot export when their recorded inputs change. Downloaded tools, `node_modules`, bundles, asset copies, and Godot import caches are generated outputs; they are not replacement sources.

To install and build only the JavaScript lab:

```bash
npm --prefix benchmarks/engines ci --no-audit --no-fund
npm --prefix benchmarks/engines run build
```

The Godot selection becomes usable after `python3 benchmarks/godot/build.py` has prepared its export. See the [Godot-specific README](godot/README.md) for import settings and the browser bridge.

## Open the lab

The configured Niteshift service is `engine-bench`, on port 3100. It serves the production JavaScript bundle, mounts the shared `/models/` assets, and serves the Godot export under `/godot/`.

```bash
ns services status
ns services start engine-bench
ns preview 3100
```

Use the service's `local` address for sandbox automation and its `user-accessible-preview` address for the browser preview. Obtain those addresses from service status rather than constructing a preview URL. The main game remains on port 3000.

Outside the supervisor, start the same production server with:

```bash
npm --prefix benchmarks/engines run serve
```

The default local address is `http://localhost:3100`. For adapter development, `npm --prefix benchmarks/engines run dev` runs Vite on the same port; stop the production server first. Collect comparisons against the production server, not the development server.

Select an engine and lighting profile, choose **Load scene**, then **Run 12-second benchmark**. **Download session JSON** exports the recent browser history, including raw intervals and environment information. History is stored locally in that browser and keeps the last 30 runs.

The **Run** button repeats sampling in the already initialized scene; it does not reload modules or update the scene-ready measurement. Choose **Load scene** again for another navigation. Automation navigates anew before every trial. Query parameters support `?engine=three&shadows=0&auto=1`, with engine values `three`, `babylon`, `playcanvas`, or `godot`, and shadows `0` or `1`.

## Shared scene and rendering profiles

[`scene.json`](scene.json) defines a fixed 960 × 540 drawing buffer at pixel ratio 1, WebGL2, no antialiasing, one orbiting camera, and these visible objects:

- 64 separate buildings using shared box geometry and four rough materials, plus a ground plane.
- Two instances of the same Ferrari LOD GLB, retained byte-for-byte in `fixtures/ferrari-lod.glb`. The lab serves its original `/models/vehicles/ferrari-lod.glb` URL; the gameplay build does not contain this fixture.
- Four independently animated Soldier GLBs playing the imported `Walk` clip.
- One directional light and approximate ambient illumination.

The camera has a 60° vertical field of view, follows a 65-unit-radius orbit at height 32, and turns at 0.08 radians per second. Both profiles use the same geometry and animation workload. The first disables shadows; the second enables a 1024-pixel directional shadow map. There is no intentional building batching or hardware instancing, environment reflection, ambient occlusion, bloom, or additional tone mapping. Godot uses its single-threaded Compatibility web renderer; generated mesh LODs and simplified shadow meshes are disabled during import.

The adapters aim to match the workload, not to produce identical pixels. Ambient light uses Three.js `AmbientLight`, Babylon's equal-color hemispheres, PlayCanvas scene ambient light, and Godot's environment ambient color. Their PBR and color pipelines interpret those inputs differently. Godot's tracked `godot/import-settings.json` pins both Soldier texture imports, including mipmaps and S3TC compression for the desktop web export, so native editor auto-detection cannot silently change them. The JavaScript loaders use the images embedded in the original GLB.

Shadow implementations also differ. Three.js uses `BasicShadowMap`; Babylon uses an unfiltered directional map. PlayCanvas uses PCF1 with bilinear depth comparison and engine-specific bias settings. Godot uses hard filtering with an orthogonal directional atlas whose projection follows the camera. Projection fitting, depth bias, sampling, culling, and skinning paths remain engine-specific. Each run includes the adapter's `info.notes`; read those alongside comparisons. Draw-call and triangle counters have engine-specific meanings, particularly when shadow passes and culling are involved.

## Browser measurement protocol

Pause unrelated rendering, editor activity, builds, installations, and other CPU-heavy jobs before sampling. Keep one benchmark page visible, use the same browser and renderer, and leave the resolution and scene inputs unchanged. The harness rejects samples if the tab becomes hidden; automation also checks the drawing buffer is exactly 960 × 540.

With the production server already running and `agent-browser` available:

```bash
mkdir -p benchmarks/results
node benchmarks/run-browser.mjs
```

The runner defaults to `http://localhost:3100`; set `BENCH_URL` to a different local server origin when needed. It runs 24 samples: four engines × two profiles × three trials, sequentially in the same Chrome tab. Engine order changes between trials, and the profile order reverses on the middle trial:

| Trial | Engine order | Profile order |
| --- | --- | --- |
| 1 | Three.js, Babylon.js, PlayCanvas, Godot | Shadows off, then on |
| 2 | Godot, PlayCanvas, Babylon.js, Three.js | Shadows on, then off |
| 3 | PlayCanvas, Three.js, Godot, Babylon.js | Shadows off, then on |

Each navigation initializes the selected engine, loads its assets, warms up for four seconds, and then samples for twelve seconds. The runner records every successful trial to [`results/results.json`](results/results.json) and navigates to a blank page when finished. It uses `agent-browser --webgpu` to launch Chrome, but all four workloads explicitly select **WebGL2**; the launch flag does not make this a WebGPU comparison.

These are **repeated local loads**, not a warm HTTP-cache benchmark or a clean-browser cold-start benchmark. The production server sends `Cache-Control: no-cache`; the runner neither clears nor controls browser code/WASM caches or OS page caches between navigations. Network transfer over an external preview connection is a different condition from local serving.

| Browser metric | Definition |
| --- | --- |
| `loadMs` | Parent page navigation time origin through engine/asset initialization and scene readiness. Includes loading, parsing, initialization, and the adapter's readiness work. Godot also starts its iframe, WASM runtime, and packed project. It is not network-download time alone. |
| `frameMs` | Raw intervals after warm-up. JavaScript adapters use consecutive `requestAnimationFrame` timestamps; Godot uses monotonic timestamps between its own `_process` frames, with bridge messages only at sample boundaries. |
| `fps` | Number of measured intervals × 1000 / sum of their durations; not the mean of instantaneous FPS values. |
| Median / p95 frame time | Interpolated 50th / 95th percentile of the raw interval distribution. Lower values indicate shorter intervals under the recorded conditions. |
| Environment | Browser user agent, reported hardware concurrency, device pixel ratio, WebGL renderer/vendor where exposed, and actual drawing-buffer dimensions. |

Frame cadence includes CPU work, animation, renderer submission, browser scheduling, synchronization, and refresh-rate/vsync limits. It is not a GPU timer-query measurement. A refresh-rate ceiling can hide differences, while a slow software renderer can magnify costs that behave differently on physical GPUs. **A sandbox using Mesa llvmpipe or another software rasterizer cannot establish a hardware-performance winner.** Repeat on representative player hardware before drawing that conclusion. This small scene also cannot establish full-game performance, editor productivity, or migration cost.

## JavaScript build measurements

Run this separately from browser sampling and Godot import/export work:

```bash
node benchmarks/engines/measure-builds.mjs
```

The script uses the installed Vite API with `configFile: false`, no public asset copying, and `src/<engine>.js` as the sole ES-library entry. It verifies that `createScene` remains exported and no other comparison engine is bundled. The shared UI, scene JSON, models, and other assets are excluded from this metric.

It performs one preliminary build per engine to prime filesystem caches, then three measured trials per engine in rotated order: Three/Babylon/PlayCanvas, Babylon/PlayCanvas/Three, and PlayCanvas/Three/Babylon. Every trial starts a fresh Node process and clears that engine's output directory. “Warm” describes filesystem conditions; this is a clean rebuild rather than HMR or a persistent bundler-cache test.

Raw wall-clock time covers child-process startup through normal shutdown, including Vite loading, module resolution, output cleanup, bundling, minification, and file writes. Gzip, hashing, and result serialization happen outside that timed interval. Builds use the same ES2022 target and esbuild settings. Vite's ES-library mode preserves whitespace/pure annotations needed for downstream tree-shaking, so sizes describe that library output rather than a separately post-minified full game.

[`results/web-builds.json`](results/web-builds.json) contains raw nanoseconds/milliseconds, per-file sizes and hashes, summed JavaScript bytes, summed separately gzipped JavaScript bytes at gzip level 9, and summary statistics. Input hashes detect source changes during a run. Artifact identity across trials is reported. Logs and final per-engine bundles are under ignored `engines/.build-metrics/`; a failed run saves partial results with `status: "failed"`.

## Godot import/export measurements

Prepare the project once, then collect the separate timing series while other workloads are idle:

```bash
python3 benchmarks/godot/build.py
python3 benchmarks/godot/benchmark_builds.py --cold-import --runs 3
```

[`results/godot-builds.json`](results/godot-builds.json) records one optional cold-resource-import measurement and three warm exports. “Cold import” removes only Godot's generated `.godot` cache; downloads, source files, importer settings, and OS caches remain warm. “Warm export” runs the native Godot tool to pack the project using an already compiled web runtime template. It does **not** compile Godot from source.

Godot export and JavaScript library bundling/minification perform different work. The Godot web output includes the precompiled WASM runtime and packed project assets; the JavaScript library-size metric excludes shared assets and UI. Report those timing and size categories separately rather than treating them as equivalent compiler-speed or payload comparisons. Ordinary preparation also writes `godot/build-times.json` for diagnostics; that file is not the controlled three-run series.

## Optional Godot editor

The `godot-editor` Niteshift service is installed but has `autostart: false`. It shares the existing Blender desktop's X display `:100`, so start that desktop before opening the editor:

```bash
ns services start blender
ns services start godot-editor
ns preview 6082
```

The editor opens `benchmarks/godot` in the browser-accessible desktop. Its service uses the Compatibility renderer and software GL settings. This GUI is optional: imports, exports, and browser measurements use the command-line tools and exported application. Keep editor activity out of timed runs. Use `ns preview 3100` to return to the lab or `ns preview 3000` to return to the game.

The native editor uses Godot's Dummy audio driver because the sandbox has no audio output device; native editor play sessions have no hardware audio output. Closing the editor leaves its service stopped. An intentional service stop also closes any native play session and exits cleanly; start `godot-editor` again when needed.

## Stop rendering and summarize

Navigate the benchmark tab to `about:blank` before measuring builds or using the editor. The diagnostic `pause()` helper only pauses JavaScript adapters; Godot owns an independent loop. Keep other game tabs closed or navigated away. The recorded sandbox run left the idle Blender desktop and supervised servers running.

After all three measurement commands complete, run `node benchmarks/summarize.mjs` to write the median-based `results/summary.json` and `results/summary.csv`. The human-readable conclusions are in [RESULTS.md](RESULTS.md).

## Recorded rerun after import stabilization

The checked-in final dataset retains 18 JavaScript samples from the original rotated-order run. Opening the Godot editor enabled texture compression/mipmaps, so its six earlier samples were superseded. Texture import parameters are now pinned in `godot/import-settings.json`; six new Godot-only samples and its import/export timings were collected afterward. These are sequential follow-up samples, not a fully interleaved or balanced four-engine experiment. Superseded Godot samples remain in `results/godot-before-import-pin.json` for provenance and are excluded from the summary. `node benchmarks/run-browser.mjs --godot-only` reproduces this partial replacement; omit the flag to collect a fresh 24-run series with the pinned settings.
