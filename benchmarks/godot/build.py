#!/usr/bin/env python3
"""Prepare the common assets, import and export the pinned Godot benchmark."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

PROJECT = Path(__file__).resolve().parent
REPO = PROJECT.parent.parent


def run_timed(command):
    started = time.perf_counter()
    process = subprocess.run(command, cwd=PROJECT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    elapsed = round(time.perf_counter() - started, 3)
    print(process.stdout, end='')
    if process.returncode or 'ERROR:' in process.stdout:
        raise RuntimeError(f'Godot command failed validation: {command}')
    return elapsed


def configure_import(path, settings):
    """Pin only importer parameters; generated resource paths/UIDs remain Godot's."""
    previous = path.read_text()
    section = re.search(r'(?ms)^\[params\]\n(.*?)(?=^\[|\Z)', previous)
    if section is None:
        raise RuntimeError(f'Godot import file has no parameter section: {path}')
    parameters = section.group(1)
    for key, value in settings.items():
        line = key + '=' + json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        pattern = r'(?m)^' + re.escape(key) + r'=.*$'
        if re.search(pattern, parameters):
            parameters = re.sub(pattern, lambda _: line, parameters)
        else:
            parameters = parameters.rstrip('\n') + '\n' + line + '\n'
    current = previous[:section.start(1)] + parameters + previous[section.end(1):]
    if current == previous:
        return False
    path.write_text(current)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    (PROJECT / 'web').mkdir(exist_ok=True)
    (PROJECT / 'web/.gdignore').touch()
    assets = PROJECT / 'assets'
    assets.mkdir(exist_ok=True)
    copies = {
        REPO / 'benchmarks/scene.json': assets / 'scene.json',
        REPO / 'public/models/Soldier.glb': assets / 'Soldier.glb',
        REPO / 'public/models/vehicles/ferrari-lod.glb': assets / 'ferrari-lod.glb',
    }
    for source, destination in copies.items():
        if not destination.exists() or source.read_bytes() != destination.read_bytes():
            shutil.copy2(source, destination)
    if args.prepare_only:
        return
    if shutil.which('godot') is None:
        raise SystemExit('Run .niteshift/install-godot first.')
    timings = {'version': subprocess.check_output(['godot', '--version'], text=True).strip()}
    timings['importSeconds'] = run_timed(['godot', '--headless', '--path', str(PROJECT), '--editor', '--import'])
    # Godot creates importer settings on the first scan. Pin geometry and
    # texture behavior before export so opening the native editor cannot
    # silently change the web workload through 3D texture auto-detection.
    changed = False
    for path in assets.glob('*.glb.import'):
        previous = path.read_text()
        current = previous.replace('meshes/generate_lods=true', 'meshes/generate_lods=false')
        current = current.replace('meshes/create_shadow_meshes=true', 'meshes/create_shadow_meshes=false')
        if current != previous:
            path.write_text(current)
            changed = True
    import_settings = json.loads((PROJECT / 'import-settings.json').read_text())
    for filename, settings in import_settings['texture_imports'].items():
        if configure_import(assets / filename, settings):
            changed = True
    if changed:
        timings['workloadSettingsReimportSeconds'] = run_timed(['godot', '--headless', '--path', str(PROJECT), '--editor', '--import'])
    timings['headlessSceneValidationSeconds'] = run_timed(['godot', '--headless', '--path', str(PROJECT), '--quit-after', '5'])
    (PROJECT / 'web').mkdir(exist_ok=True)
    timings['exportSeconds'] = run_timed(['godot', '--headless', '--path', str(PROJECT), '--export-release', 'Web', str(PROJECT / 'web/index.html')])
    timings['webBytes'] = sum(path.stat().st_size for path in (PROJECT / 'web').iterdir() if path.is_file())
    (PROJECT / 'build-times.json').write_text(json.dumps(timings, indent=2) + '\n')
    print(json.dumps(timings, indent=2))


if __name__ == '__main__':
    main()
