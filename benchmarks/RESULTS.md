# Engine comparison — 15 October 2026

**Keep Three.js + Blender for the current Astra iteration.** This preserves the working game with no engine port, has the shortest measured JavaScript adapter build at **1.470 seconds**, and trails PlayCanvas's median FPS by only **1.67% without shadows and 1.01% with shadows** here. This is a project-specific iteration judgment, not a universal engine ranking or a measured comparison of developer productivity.

## Measured workload

The production lab rendered 64 buildings, two Ferrari LOD models, and four independently animated Soldier models at **960 × 540**, pixel ratio 1, with WebGL2 and no antialiasing. The two profiles disabled shadows or enabled a 1024-pixel directional shadow map. Each engine/profile received **three trials**, with four seconds of warm-up and twelve seconds of sampling: 24 final browser samples. The 18 JavaScript samples came from the original rotated-order series. Opening the Godot editor changed texture imports; those settings are now pinned, and six Godot-only samples were recollected afterward. Superseded samples are retained separately and excluded. This follow-up order is not fully interleaved or balanced.

The host reported an **Intel Xeon at 2.60 GHz, 16 logical CPUs**, Linux, and **Chrome 155**. Rendering used **Mesa llvmpipe through ANGLE/Vulkan: software rasterization, not a physical GPU**. These conditions cannot establish a hardware-performance winner.

Values below are medians across three runs; parentheses contain the observed minimum–maximum FPS. Shadow p95 is the median of each run's p95, not a pooled percentile. Displayed values are rounded; the [summary JSON](results/summary.json) and [CSV](results/summary.csv) retain full precision.

| Engine | FPS, shadows off (range) | FPS, shadows on (range) | Shadow p95, ms | Local scene ready, ms off / on | JS build median, s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three.js | 29.34 (28.13–29.38) | 16.27 (15.35–16.31) | 66.70 | 322.3 / 362.9 | 1.470 |
| PlayCanvas | 29.84 (28.96–30.17) | 16.43 (16.33–16.52) | 66.80 | 373.4 / 446.2 | 3.951 |
| Babylon.js | 27.63 (26.63–27.92) | 14.69 (14.38–14.71) | 83.30 | 532.2 / 592.5 | 21.092 |
| Godot | 15.54 (15.52–15.63) | 12.29 (12.27–12.59) | 91.97 | 1286.6 / 1327.4 | Separate export metric |

PlayCanvas had the highest median FPS in both profiles. Its small lead over Three.js, overlapping no-shadow ranges, and nearly identical shadow p95 do not justify a game migration on performance evidence alone. No significance test or confidence interval was calculated from these three-run samples.

## Build and loading costs

The JavaScript timings measure clean production **adapter/library** builds, each in a fresh Node/Vite process after a preliminary warm-up. They include module loading, bundling, minification, and output writes; common UI and assets are excluded. Trial ranges were **1.436–1.501 s** for Three.js, **3.901–4.179 s** for PlayCanvas, and **20.697–21.293 s** for Babylon.js. HMR and incremental editing latency were not measured.

Emitted JavaScript sizes were **0.991 MB / 0.211 MB gzip** for Three.js, **2.608 / 0.606 MB** for PlayCanvas, and **5.447 / 1.208 MB** for Babylon.js, using decimal MB. These reflect the implemented adapters and their imports, not theoretical minimum engine sizes.

Godot's median **3.215-second export** used its installed, precompiled web template; its three exports ranged from **3.112 to 3.365 s**. The separate cold-resource import took **3.393 s**. Its **42.50 MB** complete web output includes the WASM runtime and packed project assets. Packing that export and minifying JavaScript libraries are different work; their payloads are also different categories. Godot export does not mean compiling the engine from source. [Godot explains that distinction and its WebAssembly/WebGL2 requirements](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).

Scene-ready times came from **repeated local navigations**, not a controlled warm HTTP-cache test. They include engine and asset initialization; Godot additionally starts its iframe and WASM runtime. Browser code caches and OS page caches were not cleared. External preview-network performance was not measured.

## What to investigate next

**PlayCanvas is the most promising browser alternative** from this experiment. Its standalone npm engine supports the existing code-based workflow; this benchmark did not install or evaluate the hosted Editor. A focused prototype on representative player hardware would be the next useful comparison before considering a port. [Standalone engine documentation](https://developer.playcanvas.com/user-manual/engine/standalone/).

**Consider Godot when priorities shift toward a native editor and broader project tooling.** Its measured web performance here does not establish native performance. **Consider Babylon.js for specific integrated features**, such as its Inspector, node material tools, or Havok integration; those capabilities were not exercised and it did not lead this benchmark's performance measurements. [Babylon.js specifications](https://www.babylonjs.com/specifications/).

Ambient/PBR response, shadow filtering, projection fitting, bias, and culling differ between engines. Godot uses pinned mipmapped S3TC character textures; the JavaScript adapters retain their native GLB texture paths. Frame intervals include browser scheduling and vsync effects, not pure GPU execution time. No asset-quality or visual-quality score was assigned; physics, gameplay, and full-city scaling were not measured. Continue improving Astra's assets and animation pipeline in Three.js + Blender while using the lab to test specific alternatives.

Reproduction and definitions: [methodology](README.md). Evidence: [raw browser runs](results/results.json), [JavaScript build trials](results/web-builds.json), [Godot import/export trials](results/godot-builds.json), and the [shared scene specification](scene.json).

## Separate browser profile

A diagnostic Three.js shadows-on trace, excluded from the 24 samples, recorded 196 animation callbacks in its marked 12.073-second window. Callback duration was **1.76 ms median / 2.55 ms p95**, with no main-thread task over 50 ms. Long gaps between callbacks overlapped GPU-service scheduler work. This points toward graphics-service waits or work on other threads rather than long JavaScript callbacks; it does not identify the responsible render pass or measure hardware GPU time. The profiler and possible development-server startup are additional confounders. See [the trace summary](results/three-shadow-profile.json).
