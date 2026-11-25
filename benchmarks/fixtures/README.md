# Historical benchmark fixture

`ferrari-lod.glb` is the unchanged model used for the recorded engine comparison. Its SHA-256 is `4995af73eb4c96f64ad87055b4944a0d36f8de0e11565e5dcbc8181836aa9b8a`.

The benchmark servers map only the exact `/models/vehicles/ferrari-lod.glb` URL to this file so `scene.json` and historical results remain reproducible. Godot copies the same bytes into its ignored generated assets directory. This file is outside the game's `public/` directory and is excluded from the gameplay distribution.

See [the asset attribution and unresolved upstream license caveat](../../ASSETS.md). Retaining a historical benchmark fixture does not establish redistribution rights; review those terms before distributing the benchmark itself.
