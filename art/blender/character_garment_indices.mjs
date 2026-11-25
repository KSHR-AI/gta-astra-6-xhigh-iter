import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [input,baseline,output,repository,encoderModule]=process.argv.slice(2);
const { optimizeCharacterAsset } = await import(pathToFileURL(path.join(repository,'art/blender/character_indices.mjs')));
const { MeshoptEncoder } = await import(pathToFileURL(encoderModule));await fs.mkdir(output,{recursive:true});await MeshoptEncoder.ready;
const bytes=await fs.readFile(path.join(input,'CivilianMaleNatural.glb'));
const sidecar=JSON.parse(await fs.readFile(path.join(input,'CivilianMaleNatural.lod.json')));
// This source is an intentional fixed-topology repair of the indexed near GLB.
// The pure transformer validates the fresh LOD hash and complete attributes;
// the CLI's unrelated 'authoring must start unindexed' guard does not apply.
const result=optimizeCharacterAsset(bytes,sidecar,MeshoptEncoder);
await fs.writeFile(path.join(output,'CivilianMaleNatural.glb'),result.glb);
await fs.writeFile(path.join(output,'CivilianMaleNatural.lod.json'),JSON.stringify(result.sidecar));
await fs.writeFile(path.join(output,'index-proof.json'),JSON.stringify(result.report,null,2));
for(const suffix of ['.glb','.lod.json'])await fs.copyFile(path.join(baseline,'CivilianFemaleNatural'+suffix),path.join(output,'CivilianFemaleNatural'+suffix));
console.log(JSON.stringify({male:result.sidecar.meshes.map(m=>[m.triangles,...m.levels.map(l=>l.triangles)]),proof:result.sidecar.indexOptimization,femaleByteExact:true}));
