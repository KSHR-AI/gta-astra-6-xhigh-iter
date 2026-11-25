import { assetUrl } from './asset-url.js';
import * as THREE from 'three';

// Original road/iron maps and CC0 Poly Haven building surfaces. World-space
// UVs retain physical scale when an instanced cube becomes an entire building.
export function applyCityMaterials(materials, canvasTexture, random) {
  const loader = new THREE.TextureLoader();
  const pending = [];
  const load = (name, color = false) => {
    let resolve;
    pending.push(new Promise(done => { resolve = done; }));
    const texture = loader.load(assetUrl(`textures/city/${name}.jpg`), resolve, undefined, error => {
      console.warn(`City surface failed to load: ${name}`, error);
      resolve();
    });
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  const sets = {};
  for (const name of ['asphalt', 'concrete', 'brick', 'stucco', 'manhole']) {
    const source = name === 'asphalt' ? 'asphalt-fine' : name;
    sets[name] = { map: load(`${source}-color`, true), normalMap: load(`${source}-normal`), roughnessMap: load(`${source}-rough`) };
  }

  // A metre-scaled coverage mask lets mipmaps filter the zebra bars and stop
  // lines into the actual road surface at grazing angles.
  const crossingMask = canvasTexture(512, 512, (ctx, width) => {
    const span = 36;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, width);
    ctx.scale(width / span, width / span);
    ctx.translate(span / 2, span / 2);
    const stripe = (x, z, w, d) => ctx.fillRect(x - w / 2, z - d / 2, w, d);
    ctx.fillStyle = 'white';
    for (const side of [-1, 1]) {
      for (let x = -9; x <= 9; x += 1.7) stripe(x, side * 13, .8, 3.3);
      for (let z = -8; z <= 8; z += 1.6) stripe(side * 14.6, z, 3.3, .75);
      stripe(side * 5.4, side * 16, 9.2, .23);
    }
    // Abrasion follows the two wheel paths within each traffic lane.
    for (const lane of [-7.85, -2.65, 2.65, 7.85]) {
      for (const wheel of [lane - .82, lane + .82]) {
        const wear = ctx.createLinearGradient(wheel - .48, 0, wheel + .48, 0);
        wear.addColorStop(0, 'transparent');
        wear.addColorStop(.5, 'rgba(0,0,0,.52)');
        wear.addColorStop(1, 'transparent');
        ctx.fillStyle = wear;
        ctx.fillRect(wheel - .48, -17, .96, 34);
        ctx.save(); ctx.rotate(Math.PI / 2);
        ctx.fillRect(wheel - .48, -17, .96, 34); ctx.restore();
      }
    }
  });
  crossingMask.colorSpace = THREE.NoColorSpace;
  crossingMask.flipY = false;
  crossingMask.anisotropy = 8;

  function worldMapping(material, meters, weather = false, road = false, pavement = false) {
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vCitySurface;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
        #include <uv_vertex>
        mat4 cityTransform = modelMatrix;
        #ifdef USE_INSTANCING
          cityTransform = modelMatrix * instanceMatrix;
        #endif
        vec3 cityPosition = (cityTransform * vec4(position, 1.)).xyz;
        vCitySurface = cityPosition;
        vec3 cityNormal = normalize(mat3(cityTransform) * normal);
        vec2 cityUv = abs(cityNormal.y) > .5 ? cityPosition.xz : (abs(cityNormal.x) > .5 ? cityPosition.zy : cityPosition.xy);
        cityUv /= ${meters.toFixed(3)};
        #ifdef USE_MAP
          vMapUv = cityUv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = cityUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = cityUv;
        #endif
        #ifdef USE_ALPHAMAP
          vAlphaMapUv = cityUv;
        #endif
      `);
      shader.fragmentShader = `varying vec3 vCitySurface;
        float cityHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float cityWeather(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(cityHash(i),cityHash(i+vec2(1.,0.)),f.x),mix(cityHash(i+vec2(0.,1.)),cityHash(i+vec2(1.,1.)),f.x),f.y);}
      ` + shader.fragmentShader;
      if (road) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          // Broad binder/weather variation has no texture-tile repetition.
          diffuseColor.rgb *= .88 + .18 * cityWeather(vCitySurface.xz * .075)
            + .05 * cityWeather(vCitySurface.xz * .28 + vec2(17.3, 9.1));
          // Faint polished wheel paths follow the two boulevards and three
          // cross streets. They dissolve at junctions rather than crossing
          // each other as repeated stripes in the underlying surface tile.
          float cityNorth = min(abs(vCitySurface.x), abs(vCitySurface.x - 80.));
          float cityCross = min(abs(vCitySurface.z), min(abs(vCitySurface.z + 90.), abs(vCitySurface.z - 90.)));
          float cityAlongNorth = step(cityNorth, cityCross);
          float cityAcross = mix(cityCross, cityNorth, cityAlongNorth);
          float cityAlong = mix(vCitySurface.x, vCitySurface.z, cityAlongNorth);
          float cityJunction = smoothstep(9., 16., mix(cityNorth, cityCross, cityAlongNorth));
          float cityLane = min(abs(cityAcross - 2.65), abs(cityAcross - 7.85));
          float cityWheelWear = (1. - smoothstep(.18, .65, abs(cityLane - .82))) * cityJunction;
          cityWheelWear *= .6 + .4 * cityWeather(vec2(cityAcross * .7, cityAlong * .04));
          diffuseColor.rgb *= 1. - .12 * cityWheelWear;
          // Dust collects in the gutter while traffic cleans the wheel paths.
          float shoulder = smoothstep(8.5, 10.65, cityAcross) * cityJunction;
          diffuseColor.rgb += vec3(.019, .014, .008) * shoulder;
        `);
        if (material === materials.asphalt) {
          shader.uniforms.crossingMask = { value: crossingMask };
          shader.fragmentShader = 'uniform sampler2D crossingMask;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            vec2 junction = vec2(vCitySurface.x - (vCitySurface.x < 40. ? 0. : 80.),
              vCitySurface.z - 90. * clamp(floor(vCitySurface.z / 90. + .5), -1., 1.));
            vec2 crossingUv = junction / 36. + .5;
            vec2 crossingDx = dFdx(vCitySurface.xz) / 36., crossingDy = dFdy(vCitySurface.xz) / 36.;
            if (max(abs(junction.x), abs(junction.y)) < 18.) {
              float paint = textureGrad(crossingMask, crossingUv, crossingDx, crossingDy).r;
              float aggregate = smoothstep(.060, .110, diffuseColor.r);
              vec3 pigment = vec3(.61, .59, .49) * (.57 + .47 * aggregate);
              diffuseColor.rgb = mix(diffuseColor.rgb, pigment, paint * (.63 + .32 * cityWeather(vCitySurface.xz * 1.75)));
            }
          `);
        }
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
          #include <roughnessmap_fragment>
          roughnessFactor *= 1. - .055 * cityWheelWear;
        `);
      } else if (pavement) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          // Cast panels retain metre-scale joints as each instance changes size.
          vec2 slab = vCitySurface.xz / vec2(2.8, 2.9);
          vec2 edge = (.5 - abs(fract(slab) - .5)) * vec2(2.8, 2.9);
          float distanceToJoint = min(edge.x, edge.y);
          float aa = max(.004, fwidth(distanceToJoint));
          float joint = 1. - smoothstep(.009, .009 + aa, distanceToJoint);
          float closeView = 1. - smoothstep(.025, .15, aa);
          float slabTone = .90 + .18 * cityHash(floor(slab));
          diffuseColor.rgb *= slabTone * (.92 + .16 * cityWeather(vCitySurface.xz * .22));
          diffuseColor.rgb *= 1. - joint * closeView * .48;
        `);
      } else if (weather) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float contact = mix(.68, 1., smoothstep(.1, 4.5, vCitySurface.y));
        float mottling = .88 + .16 * cityWeather(vec2(vCitySurface.x+vCitySurface.z,vCitySurface.y)*.23);
        diffuseColor.rgb *= contact * mottling;
      `);
      else shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        // Several-metre weather patterns break the repetition of a 1K surface
        // without stretching the photographed aggregate and cracks themselves.
        diffuseColor.rgb *= .87 + .19 * cityWeather(vCitySurface.xz*.13);
      `);
    };
    material.customProgramCacheKey = () => `city-world-${meters}-${weather}-${road}-${pavement}-${material === materials.asphalt}`;
    material.needsUpdate = true;
  }
  for (const key of ['limestone', 'white', 'pale', 'blush', 'peach', 'sage']) {
    Object.assign(materials[key], sets.stucco);
    materials[key].normalScale = new THREE.Vector2(.34, .34);
    materials[key].roughness = .94;
    worldMapping(materials[key], 2.4, true);
  }
  for (const key of ['concrete', 'curb', 'sidewalk', 'trim']) {
    Object.assign(materials[key], sets.concrete);
    materials[key].normalScale = new THREE.Vector2(.32, .32);
    materials[key].roughness = .95;
    worldMapping(materials[key], key === 'sidewalk' ? 2.8 : 3.6, key !== 'sidewalk', false, key === 'sidewalk');
  }
  materials.brick = new THREE.MeshStandardMaterial({ color: '#a38d77', ...sets.brick, normalScale: new THREE.Vector2(.55, .55), roughness: .96 });
  worldMapping(materials.brick, 1.8, true);
  Object.assign(materials.asphalt, sets.asphalt);
  materials.asphalt.color.set('#dcdbd1');
  materials.asphalt.bumpMap = null;
  materials.asphalt.normalScale = new THREE.Vector2(.28, .28);
  materials.asphalt.roughness = 1;
  materials.asphalt.envMapIntensity = .35;
  worldMapping(materials.asphalt, 2.4, false, true);
  materials.patch = materials.asphalt.clone();
  materials.patch.color.set('#b8b8ae');
  worldMapping(materials.patch, 2.4, false, true);

  Object.assign(materials.iron, sets.manhole);
  materials.iron.color.set('#ffffff');
  materials.iron.normalScale = new THREE.Vector2(.65, .65);
  materials.iron.roughness = 1;
  materials.iron.metalness = .45;
  materials.iron.envMapIntensity = .65;
  materials.manholeFrame = new THREE.MeshStandardMaterial({
    color: '#777a77', roughness: .68, metalness: .55, envMapIntensity: .65,
  });

  // A tiny four-room atlas supplies actual ceiling, wall, curtain and furniture
  // cues behind the glazing. Parallax offsets the room as the camera passes it.
  const rooms = canvasTexture(1024, 256, (ctx) => {
    for (let room = 0; room < 4; room++) {
      const x = room * 256;
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, ['#727c7c', '#8c8a79', '#626e75', '#8b8475'][room]);
      gradient.addColorStop(.38, '#39484b'); gradient.addColorStop(1, '#202a2e');
      ctx.fillStyle = gradient; ctx.fillRect(x, 0, 256, 256);
      ctx.fillStyle = '#9d9d8c'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 256, 0); ctx.lineTo(x + 211, 61); ctx.lineTo(x + 44, 61); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5c6260'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 44, 61); ctx.lineTo(x + 44, 210); ctx.lineTo(x, 256); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#343c3e'; ctx.beginPath(); ctx.moveTo(x + 256, 0); ctx.lineTo(x + 211, 61); ctx.lineTo(x + 211, 210); ctx.lineTo(x + 256, 256); ctx.closePath(); ctx.fill();
      ctx.fillStyle = room === 1 ? '#ad9271' : '#637071'; ctx.fillRect(x + 46, 63, 164, 148);
      ctx.fillStyle = '#273335'; ctx.fillRect(x + 63, 91, 48, 71); ctx.fillRect(x + 63, 91, 48, 4);
      ctx.fillStyle = '#a79a79'; ctx.fillRect(x + 69, 98, 36, 56);
      ctx.fillStyle = '#263033'; ctx.fillRect(x + 137, 158, 58, 54);
      ctx.fillStyle = '#4b5350'; ctx.fillRect(x + 128, 151, 75, 13);
      ctx.fillStyle = '#d3bf91'; ctx.fillRect(x + 161, 112, 26, 15);
      ctx.fillStyle = '#2f393b'; ctx.fillRect(x + 172, 127, 3, 25);
      ctx.fillStyle = room === 2 ? '#abb1a4' : '#aaa18a';
      const curtainWidth = room === 2 ? 82 : 29;
      ctx.fillRect(x + 4, 7, curtainWidth, 241);
      for (let n = 0; n < curtainWidth; n += 7) { ctx.fillStyle = n % 14 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,240,.08)'; ctx.fillRect(x + 4 + n, 7, 3, 241); }
      ctx.fillStyle = 'rgba(140,170,182,.13)'; ctx.fillRect(x, 0, 256, 256);
      const reflection = ctx.createLinearGradient(x, 0, x + 220, 256);
      reflection.addColorStop(0, 'rgba(195,210,215,.34)'); reflection.addColorStop(.45, 'rgba(185,200,206,.02)'); reflection.addColorStop(1, 'rgba(20,38,43,.16)');
      ctx.fillStyle = reflection; ctx.fillRect(x, 0, 256, 256);
      ctx.strokeStyle = 'rgba(15,26,30,.7)'; ctx.lineWidth = 9; ctx.strokeRect(x + 4, 4, 248, 248);
    }
  });
  for (const [key, color, roughness] of [
    ['glass', '#c2cfce', .16], ['glassDark', '#7d989e', .21],
    ['glassLight', '#d5dbd4', .12], ['glassWarm', '#cbc5ae', .2],
  ]) {
    const material = materials[key];
    material.color.set(color); material.map = rooms; material.metalness = .1;
    material.roughness = roughness; material.envMapIntensity = 1.35;
    material.emissive.set(key === 'glassWarm' ? '#d0a068' : '#000000');
    material.emissiveIntensity = key === 'glassWarm' ? .035 : 0;
    if (key === 'glassWarm') {
      material.emissiveMap = rooms;
      material.userData.warmWindowLight = { value: false };
    }
    material.onBeforeCompile = shader => {
      if (key === 'glassWarm') {
        shader.uniforms.warmWindowLight = material.userData.warmWindowLight;
        shader.fragmentShader = 'uniform bool warmWindowLight;\n' + shader.fragmentShader.replace(
          '#include <emissivemap_fragment>', 'if (warmWindowLight) {\n#include <emissivemap_fragment>\n}');
      }
      shader.vertexShader = 'varying vec3 vRoomView; varying float vRoomSeed;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
        #include <uv_vertex>
        mat4 roomTransform = modelMatrix;
        #ifdef USE_INSTANCING
          roomTransform = modelMatrix * instanceMatrix;
        #endif
        vec3 roomPosition = (roomTransform * vec4(position, 1.)).xyz;
        vec3 roomEye = cameraPosition - roomPosition;
        vRoomView = vec3(dot(roomEye, normalize(roomTransform[0].xyz)), dot(roomEye, normalize(roomTransform[1].xyz)), dot(roomEye, normalize(roomTransform[2].xyz)));
        vRoomSeed = fract(sin(dot(roomTransform[3].xyz, vec3(12.9898, 33.414, 78.233))) * 43758.5453);
      `);
      shader.fragmentShader = 'varying vec3 vRoomView; varying float vRoomSeed;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 roomUv = clamp(vMapUv + clamp(vRoomView.xy / max(abs(vRoomView.z), .5), vec2(-2.), vec2(2.)) * .055, vec2(.015), vec2(.985));
          roomUv.x = (roomUv.x + floor(vRoomSeed * 4.)) * .25;
          diffuseColor *= texture2D(map, roomUv);
          diffuseColor.rgb *= .48 + vRoomSeed * .15;
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'city-parallax-rooms';
    material.needsUpdate = true;
  }

  const wear = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8500; i++) {
      ctx.fillStyle = random() > .4 ? '#bbb' : '#111';
      ctx.fillRect(random() * 512, random() * 512, random() * 3 + .5, random() * 4 + .5);
    }
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 13; i++) { const x = random() * 512; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 70, 180); ctx.lineTo(x + 15, 400); ctx.stroke(); }
  });
  wear.wrapS = wear.wrapT = THREE.RepeatWrapping; wear.colorSpace = THREE.NoColorSpace;
  for (const key of ['paint', 'yellow']) {
    materials[key].alphaMap = wear; materials[key].alphaTest = .3;
    worldMapping(materials[key], 3.2);
  }
  const stain = canvasTexture(256, 256, ctx => {
    ctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 80; i++) {
      const x = 128 + (random() - .5) * 160, y = 128 + (random() - .5) * 140, r = 10 + random() * 40;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, 'rgba(28,31,30,.15)'); gradient.addColorStop(1, 'rgba(28,31,30,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  materials.stain = new THREE.MeshStandardMaterial({ map: stain, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  // Poured bitumen follows the broken joint and feathers out into hairline branches.
  const sealedJoint = canvasTexture(384, 768, ctx => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const fracture = (points, width) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.strokeStyle = 'rgba(78,75,65,.56)';
      ctx.lineWidth = width + 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(31,32,31,.87)';
      ctx.lineWidth = width;
      ctx.stroke();
    };
    fracture([[180,3],[173,61],[190,109],[174,155],[194,213],[192,261],[211,293],
      [193,342],[156,377],[163,410],[149,458],[176,483],[164,529],[180,578],
      [157,625],[164,658],[131,706],[139,764]], 4.8);
    fracture([[193,342],[219,351],[242,372],[281,379],[295,394],[333,401]], 2.4);
    fracture([[164,529],[142,535],[134,553],[111,560],[102,578],[68,594]], 1.9);
    fracture([[190,109],[213,103],[233,109],[249,92]], 1.3);
  });
  materials.sealedJoint = new THREE.MeshStandardMaterial({
    map: sealedJoint, transparent: true, depthWrite: false, roughness: .76,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const tyre = canvasTexture(256, 512, ctx => {
    ctx.clearRect(0, 0, 256, 512);
    for (const x of [45, 178]) for (let y = 0; y < 512; y += 3) {
      ctx.fillStyle = `rgba(30,32,30,${.07 + random() * .14})`;
      ctx.fillRect(x + Math.sin(y / 160) * 15, y, 25, 2.4);
    }
  });
  materials.tyre = new THREE.MeshStandardMaterial({ map: tyre, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  const bark = canvasTexture(128, 512, ctx => {
    ctx.fillStyle = '#aa9170'; ctx.fillRect(0, 0, 128, 512);
    for (let y = 0; y < 512; y += 24) {
      ctx.fillStyle = '#746b57'; ctx.fillRect(0, y, 128, 4);
      ctx.fillStyle = '#c0ac88'; ctx.fillRect(0, y + 5, 128, 2);
    }
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = random() > .5 ? 'rgba(42,39,29,.17)' : 'rgba(235,219,181,.17)';
      ctx.fillRect(random() * 128, random() * 512, .5 + random(), 2 + random() * 13);
    }
  });
  materials.trunk.map = bark; materials.trunkLight.map = bark;
  materials.trunk.color.set('#b7aa92'); materials.trunkLight.color.set('#c3b69b');
  materials.leaves.color.set('#5b7650'); materials.leaves.roughness = .72; materials.leaves.envMapIntensity = .4;
  return { ready: Promise.all(pending) };
}
