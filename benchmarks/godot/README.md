# Godot browser benchmark

This is a rendering/animation workload for the engine comparison, not a port of the game. It uses the same `../scene.json`, Ferrari LOD GLB and animated Soldier GLB as the JavaScript adapters. The 64 buildings are separate mesh instances sharing a box mesh and four materials. Two cars and four independent looping Walk animations retain their imported materials. The complete scene contains 79,428 triangles before culling.

## Reproduce

From the repository root on Linux x86_64:

```sh
.niteshift/install-godot
python3 benchmarks/godot/build.py
```

The installer pins official **Godot 4.7.2 stable** and matching web templates with SHA-256 verification. The Godot executable lives at `/opt/godot-4.7.2/godot` and is available through `/usr/local/bin/godot`. Archive downloads are cached. Only web templates are unpacked from the official platform template archive.

The build copies the common scene/assets locally, imports them, disables generated LODs and shadow-mesh simplification, applies the tracked texture parameters in `import-settings.json`, validates the instantiated scene in headless Godot, and exports `web/index.html`. Both Soldier textures use pinned VRAM compression, mipmaps and normal-map settings; 3D auto-detection is disabled after those settings are applied. This makes their imports consistent when the native editor opens the project. Generated asset copies, import caches and web bundles are ignored by Git. Source files remain in `public/models/` and retain their existing license terms; see the repository's `ASSETS.md`.

The engine comparison server mounts this export at `/godot/index.html`. Add `?variant=shadows` to enable shadows. WebGL2 is required. The export is single threaded and does not require cross-origin isolation headers. Canvas backing dimensions remain 960×540, with high-DPI scaling and antialiasing disabled.

When all other builds and browser measurements are paused, collect the reproducible import/export timing series:

```sh
python3 benchmarks/godot/benchmark_builds.py --cold-import --runs 3
```

This writes raw timings and conditions to `benchmarks/results/godot-builds.json`. “Cold import” clears Godot's generated resource cache only; source downloads, importer configuration and operating-system page caches remain warm. “Warm export” means packing the project using the installed precompiled web template, not compiling Godot itself. Diagnostic `build-times.json` is generated during ordinary builds and should not be confused with a controlled timing series.

## Harness contract

After scene initialization, the page exposes `window.__ENGINE_BENCH__.ready === true` and `.info`. Start an independent sample with:

```js
const result = await iframe.contentWindow.__ENGINE_BENCH__.begin({
  warmupMs: 4000,
  durationMs: 12000,
});
// result: { frameMs, elapsedMs, loadMs, info }
```

`frameMs` contains wall-clock intervals between Godot `_process` frames using `Time.get_ticks_usec`, rather than clamped simulation deltas or the parent iframe's unrelated animation callbacks. The camera orbit and animations reset at measurement start. There is no per-frame JavaScript bridge traffic. The ready/result messages are also sent to the same-origin parent using `astra-godot-ready` and `astra-godot-result`; boot failures send `astra-godot-error`.

This measures engine-frame cadence, not GPU timer queries. Browser scheduling, refresh-rate caps and software rasterization affect the result. No claim about typical player hardware should be inferred from the sandbox alone.

## Rendering differences

The Compatibility renderer uses a linear tone mapper, plain color background/ambient lighting, and one directional light. There are no reflection probes, post effects, occlusion culling or antialiasing. Imported glTF materials keep their embedded settings. The desktop web export uses S3TC-compressed Soldier textures with mipmaps; the JavaScript adapters load the images from the original GLB through their own loaders. Godot's PBR shading, texture import, ambient-light response, skinning pipeline and frustum culling are engine-specific and are not pixel-identical to the JavaScript adapters.

The optional shadow pass uses one 1024-pixel directional atlas with orthogonal mode and hard filtering. Godot fits the shadow projection to the camera, with a 110-unit maximum shadow distance; this differs from an explicitly fixed 110-unit square projection. The benchmark reports this limitation in `info.notes`.

## Official references

- [Pinned release and downloads](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable)
- [Godot web export requirements and limitations](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- [JavaScriptBridge](https://docs.godotengine.org/en/stable/classes/class_javascriptbridge.html)
- [Directional light shadow configuration](https://docs.godotengine.org/en/stable/classes/class_directionallight3d.html)

Browser verification and comparison results belong to the shared harness/report. A successful headless import/export alone does not establish browser rendering correctness.
