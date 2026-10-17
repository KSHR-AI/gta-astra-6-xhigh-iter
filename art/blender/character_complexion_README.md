# Original male complexion pigment

`character_complexion.py` authors a small albedo-only refinement over the credited CC0 MakeHuman male skin. It adds restrained cheek/nose warmth, chromatic variation and faint jaw stubble. The pigment field uses the existing male head's native rest-space coordinates and is rasterized through its current UV triangles. It has no lighting, view direction or surface-normal inputs and does not bake shadows. These coordinates intentionally target the current `male_headMesh`; this is not a generic character-texturing tool.

The lower neck fade reaches exactly neutral below native glTF Y=7.20. Alpha, geometry, eyelid targets, eyes, hair and the rig are unchanged. The original source binary is retained exactly; only the skin image binding gains the authored PNG. Female input is copied byte for byte. The existing 2K runtime color atlas holds the result, adding no image, material batch or shader feature. Original skin attribution remains in [ASSETS.md](../../ASSETS.md).

The packed `character_humans.blend` remains the editable unmodified skin source. The procedural pigment script is the editable derivative source; change its anatomical fields rather than repeatedly tinting generated images. The output carries an `astraComplexion` source/version marker, and the authoring step rejects already-authored input to prevent accidental double application.

```sh
blender --background --factory-startup --threads 2 --python-exit-code 1 \
  --python art/blender/character_humans.py -- /tmp/astra-face-raw
python3 art/blender/character_complexion.py \
  --source /tmp/astra-face-raw --output /tmp/astra-face-stage
python3 art/blender/character_head_atlas.py /tmp/astra-face-stage/after
```

Continue the [full appearance pipeline](README.md#deliberate-appearance-rebuild-with-facial-morphs) using `/tmp/astra-face-stage/after` as its head directory and the current authored body directory explicitly. Regenerate LODs and the index proof; promote the final GLB and matching sidecar together. Do not merely replace a PNG in a shipping GLB while retaining its old SHA/proof metadata.

The authoring output includes untouched `before/` head exports, derived `after/` exports, a source-map preview and `complexion-audit.json`. Keep these staging artifacts outside the repository. Review fixed-camera browser before/after images in both sunlight and shade, at gameplay distance and with darker NPC skin tints, before promoting changes. Confirm the neck join, blinking and aiming. This pass changes complexion only; it does not add expressions, hair geometry or facial animation.
