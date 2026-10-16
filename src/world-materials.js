import * as THREE from 'three';

// Photographed, CC0 Poly Haven surfaces. World-space UVs retain a consistent
// physical scale even when a single instanced cube becomes an entire building.
export function applyCityMaterials(materials, canvasTexture, random) {
  const loader = new THREE.TextureLoader();
  const pending = [];
  const load = (name, color = false) => {
    let resolve;
    pending.push(new Promise(done => { resolve = done; }));
    const texture = loader.load(`/textures/city/${name}.jpg`, resolve, undefined, error => {
      console.warn(`City surface failed to load: ${name}`, error);
      resolve();
    });
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  const sets = {};
  for (const name of ['asphalt', 'concrete', 'brick', 'stucco']) {
    sets[name] = { map: load(`${name}-color`, true), normalMap: load(`${name}-normal`), roughnessMap: load(`${name}-rough`) };
  }

  function worldMapping(material, meters, weather = false) {
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
      if (weather) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
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
    material.customProgramCacheKey = () => `city-world-${meters}-${weather}`;
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
    worldMapping(materials[key], key === 'sidewalk' ? 2.8 : 3.6, key !== 'sidewalk');
  }
  materials.brick = new THREE.MeshStandardMaterial({ color: '#a38d77', ...sets.brick, normalScale: new THREE.Vector2(.55, .55), roughness: .96 });
  worldMapping(materials.brick, 1.8, true);
  Object.assign(materials.asphalt, sets.asphalt);
  materials.asphalt.color.set('#c0c2bf');
  materials.asphalt.bumpMap = null;
  materials.asphalt.normalScale = new THREE.Vector2(.4, .4);
  materials.asphalt.roughness = .92;
  materials.asphalt.envMapIntensity = .35;
  worldMapping(materials.asphalt, 5.8);
  materials.patch = materials.asphalt.clone();
  materials.patch.color.set('#868b88');
  worldMapping(materials.patch, 4.8);

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
    material.onBeforeCompile = shader => {
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
