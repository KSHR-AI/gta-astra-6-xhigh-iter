#!/usr/bin/env python3
"""Build the engine lab only when its inputs change; keep generated files ignored."""
import hashlib
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parent.parent
bench=root/'benchmarks'

def build_if_changed(name, inputs, required, command):
    digest=hashlib.sha256()
    for path in sorted(inputs):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    signature=digest.hexdigest()
    stamp=bench/('.'+name+'-build-sha')
    if all(p.exists() for p in required) and stamp.exists() and stamp.read_text()==signature:
        print(name+': build already current',flush=True)
        return
    subprocess.run(command,cwd=root,check=True)
    stamp.write_text(signature)

web=bench/'engines'
web_inputs=list((web/'src').glob('*.js'))+[web/'package-lock.json',web/'index.html',web/'vite.config.js',bench/'scene.json']
build_if_changed('web',web_inputs,[web/'dist/index.html'],['npm','--prefix','benchmarks/engines','run','build'])
godot=bench/'godot'
godot_inputs=[godot/p for p in ['main.gd','main.tscn','project.godot','export_presets.cfg','shell.html','build.py','import-settings.json']]+[bench/'scene.json',root/'public/models/Soldier.glb',root/'public/models/vehicles/ferrari-lod.glb',root/'.niteshift/install-godot']
build_if_changed('godot',godot_inputs,[godot/'web/index.html',godot/'web/index.wasm',godot/'web/index.pck'],['python3','benchmarks/godot/build.py'])
