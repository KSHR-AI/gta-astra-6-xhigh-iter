#!/usr/bin/env bash
set -euo pipefail
# Inputs are the unmodified character files frozen at the indexed appearance build before this finishing pass.
repo_root=${1:?repository root};baseline_models=${2:?frozen baseline model directory};stage_out=${3:?new staging output directory};meshopt_root=${4:?meshoptimizer 0.24.0 module directory}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$stage_out/primary" "$stage_out/lod-input" "$stage_out/final"
blender --background --factory-startup --threads 2 --python-exit-code 1 --python "$script_dir/character_garment_surface.py" -- "$baseline_models/CivilianMaleNatural.glb" "$stage_out/primary/surface.glb"
python3 "$script_dir/character_cotton_finish.py" "$stage_out/primary/surface.glb" "$stage_out/primary/cotton.glb"
python3 "$script_dir/character_skin_mask_padding.py" "$stage_out/primary/cotton.glb" "$stage_out/primary/CivilianMaleNatural.glb" --report "$stage_out/primary/skin-mask-report.json"
python3 "$script_dir/character_image_repack.py" "$stage_out/primary/CivilianMaleNatural.glb" "$stage_out/lod-input/CivilianMaleNatural.glb"
cp "$baseline_models/CivilianFemaleNatural.glb" "$stage_out/lod-input/CivilianFemaleNatural.glb"
node "$repo_root/art/blender/character_lod.mjs" "$meshopt_root/meshopt_simplifier.module.js" --input-dir "$stage_out/lod-input" --output-dir "$stage_out/lod-input"
node "$script_dir/character_garment_indices.mjs" "$stage_out/lod-input" "$baseline_models" "$stage_out/final" "$repo_root" "$meshopt_root/meshopt_encoder.module.js"
python3 "$script_dir/character_garment_proof.py" "$baseline_models" "$stage_out/final" "$stage_out/final/asset-proof.json"
blender --background --factory-startup --threads 2 --python-exit-code 1 --python "$script_dir/character_garment_project.py" -- "$stage_out/final/CivilianMaleNatural.glb" "$stage_out/primary/garment_surface.blend"
