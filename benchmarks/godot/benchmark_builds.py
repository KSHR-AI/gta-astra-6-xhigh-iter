#!/usr/bin/env python3
"""Measure Godot import/export only when the browser harness and other builds are idle."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import time

from build import PROJECT, REPO, run_timed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--cold-import', action='store_true', help='Delete only generated .godot cache before measuring asset import; preserve exact-workload importer settings.')
    parser.add_argument('--output', type=Path, default=REPO / 'benchmarks/results/godot-builds.json')
    args = parser.parse_args()
    if not (PROJECT / 'assets/Soldier.glb.import').exists():
        raise SystemExit('Run python3 benchmarks/godot/build.py first to prepare the exact workload.')
    data = {
        'recordedAt': datetime.now(timezone.utc).isoformat(),
        'engine': 'Godot',
        'version': subprocess.check_output(['godot', '--version'], text=True).strip(),
        'conditions': [
            'Official precompiled single-thread Compatibility release web template; this measures export/packing, not engine compilation.',
            'Source assets and importer settings prepared before this command; OS filesystem caches are not flushed.',
            'Invoke only after all rendering benchmarks and other builds are paused.',
        ],
    }
    if args.cold_import:
        shutil.rmtree(PROJECT / '.godot', ignore_errors=True)
        data['coldImportSeconds'] = run_timed(['godot', '--headless', '--path', str(PROJECT), '--editor', '--import'])
        data['conditions'].append('Cold import means no Godot .godot resource cache. Importer settings retain disabled mesh LOD/shadow-mesh generation. Download/source and OS page caches are warm.')
    data['warmExportSeconds'] = []
    for _ in range(args.runs):
        seconds = run_timed(['godot', '--headless', '--path', str(PROJECT), '--export-release', 'Web', str(PROJECT / 'web/index.html')])
        data['warmExportSeconds'].append(seconds)
    data['files'] = {p.name: p.stat().st_size for p in sorted((PROJECT / 'web').iterdir()) if p.is_file() and not p.name.startswith('.') and not p.name.endswith('.import')}
    data['webBytes'] = sum(data['files'].values())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data, indent=2))


if __name__ == '__main__':
    main()
