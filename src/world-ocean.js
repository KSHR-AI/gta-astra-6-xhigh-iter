import * as THREE from 'three';

// Original bounded coastal water: two coherent swells, filtered wind ripples,
// one reflected HDR lookup and one small, original foam-pattern lookup. There
// are no reflection cameras, render targets, per-frame allocations or CPU waves.
const SHORE_X = -150;
const WIDTH = 1800, LENGTH = 1600;
const X_SEGMENTS = 128, Z_SEGMENTS = 96;

function coastalGeometry() {
  const geometry = new THREE.PlaneGeometry(WIDTH, LENGTH, X_SEGMENTS, Z_SEGMENTS);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    // Spend 3/4 of the existing columns on the first 240 m of water. The
    // remaining columns reach the same distant boundary; triangle count stays
    // unchanged. More alongshore samples cover the playable beach, too.
    const offshore = (WIDTH / 2 - positions.getX(i)) / WIDTH;
    const distance = offshore <= .75
      ? 240 * (offshore / .75) ** 2
      : 240 + 1560 * ((offshore - .75) / .25);
    const along = positions.getY(i) / (LENGTH / 2);
    const absolute = Math.abs(along);
    const mapped = absolute <= 2 / 3
      ? absolute * 480
      : 320 + (absolute - 2 / 3) * 1440;
    positions.setXY(i, WIDTH / 2 - distance, Math.sign(along) * mapped);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  // Displacement is in the plane's local Z. Include the maximum swell and
  // horizontal excursion in the culling bounds, even at a grazing angle.
  geometry.boundingBox.expandByScalar(.5);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

function foamTexture() {
  const size = 128, bytes = new Uint8Array(size * size * 4);
  const grids = [4, 8, 32, 64].map((cells, layer) => {
    let seed = 0x6a09e667 ^ (layer * 0x9e3779b9);
    return { cells, values: Float32Array.from({ length: cells * cells }, () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967295;
    }) };
  });
  function sample({ cells, values }, x, y) {
    const sx = x / size * cells, sy = y / size * cells;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    let fx = sx - ix, fy = sy - iy;
    fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy);
    const a = values[(iy % cells) * cells + ix % cells];
    const b = values[(iy % cells) * cells + (ix + 1) % cells];
    const c = values[((iy + 1) % cells) * cells + ix % cells];
    const d = values[((iy + 1) % cells) * cells + (ix + 1) % cells];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, fx), THREE.MathUtils.lerp(c, d, fx), fy);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    bytes[offset] = Math.round(255 * (.65 * sample(grids[0], x, y) + .35 * sample(grids[1], x, y)));
    bytes[offset + 1] = Math.round(255 * (.6 * sample(grids[2], x, y) + .4 * sample(grids[3], x, y)));
    bytes[offset + 2] = 0;
    bytes[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.name = 'Original coastal foam · seeded periodic value noise';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function reflectionTexture(source) {
  const image = source?.image;
  if (!source?.isDataTexture || source.format !== THREE.RGBAFormat
    || !Number.isSafeInteger(image?.width) || image.width <= 0
    || !Number.isSafeInteger(image?.height) || image.height <= 0) return null;
  const componentCount = image.width * image.height * 4;
  const typedLayout = source.type === THREE.HalfFloatType
    ? image.data instanceof Uint16Array
    : source.type === THREE.FloatType && image.data instanceof Float32Array;
  if (!typedLayout || !Number.isSafeInteger(componentCount)
    || image.data.length !== componentCount) return null;
  const width = Math.min(512, image.width), height = Math.min(256, image.height);
  const data = new Uint16Array(width * height * 4);
  const read = source.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat : value => value;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Four stratified box samples suppress cloud aliasing during downsampling.
    // Own these pixels: main.js releases the lighting HDR after car capture.
    const x0 = Math.floor((x + .25) * image.width / width);
    const x1 = Math.floor((x + .75) * image.width / width);
    const y0 = Math.floor((y + .25) * image.height / height);
    const y1 = Math.floor((y + .75) * image.height / height);
    for (let channel = 0; channel < 3; channel++) {
      const value = (read(image.data[(y0 * image.width + x0) * 4 + channel])
        + read(image.data[(y0 * image.width + x1) * 4 + channel])
        + read(image.data[(y1 * image.width + x0) * 4 + channel])
        + read(image.data[(y1 * image.width + x1) * 4 + channel])) * .25;
      data[(y * width + x) * 4 + channel] = THREE.DataUtils.toHalfFloat(Math.min(65504, Math.max(0, value)));
    }
    data[(y * width + x) * 4 + 3] = 0x3c00;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'Pacific water · owned low-resolution lighting sky';
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Surface derivatives include the shoreline/far-field envelope, so reflection
// normals follow the same displaced waves. The two steepness terms sum to
// less than .07; no Gerstner foldovers. Small wind waves affect normals only.
const waveFunctions = `
  const float TAU = 6.28318530718;
  const vec2 SWELL_A = vec2(.9939561, .1098788);
  const vec2 SWELL_B = vec2(.9731902, -.23);
  const float LENGTH_A = 24., LENGTH_B = 12.5;
  uniform float time;
  vec2 swellEnvelope(float x) {
    float depth = ${SHORE_X.toFixed(1)} - x;
    float nearT = clamp(depth / 30., 0., 1.);
    float farT = clamp((depth - 160.) / 80., 0., 1.);
    float nearValue = nearT * nearT * (3. - 2. * nearT);
    float farValue = 1. - farT * farT * (3. - 2. * farT);
    float nearDerivative = -6. * nearT * (1. - nearT) / 30.;
    float farDerivative = 6. * farT * (1. - farT) / 80.;
    return vec2(nearValue * farValue, nearDerivative * farValue + nearValue * farDerivative);
  }
  void addSwell(vec2 p, vec2 direction, float length, float amplitude, float chop,
    vec2 envelope, inout vec3 offset, inout vec3 tangentX, inout vec3 tangentZ,
    inout float crest) {
    float k = TAU / length;
    float phase = dot(direction, p) * k - sqrt(9.81 * k) * time;
    float s = sin(phase), c = cos(phase);
    vec3 displacement = vec3(chop * amplitude * direction.x * c,
      amplitude * s, chop * amplitude * direction.y * c);
    vec3 derivative = vec3(-chop * amplitude * direction.x * s,
      amplitude * c, -chop * amplitude * direction.y * s) * k;
    offset += envelope.x * displacement;
    tangentX += envelope.y * displacement + envelope.x * derivative * direction.x;
    tangentZ += envelope.x * derivative * direction.y;
    crest += amplitude * s;
  }
  void oceanSurface(vec2 p, out vec3 offset, out vec3 normal, out float crest) {
    offset = vec3(0.); crest = 0.;
    vec3 tangentX = vec3(1., 0., 0.), tangentZ = vec3(0., 0., 1.);
    vec2 envelope = swellEnvelope(p.x);
    addSwell(p, SWELL_A, LENGTH_A, .25, .55, envelope, offset, tangentX, tangentZ, crest);
    addSwell(p, SWELL_B, LENGTH_B, .09, .45, envelope, offset, tangentX, tangentZ, crest);
    normal = normalize(cross(tangentZ, tangentX));
  }
`;

export function createOcean() {
  const foam = foamTexture();
  const material = new THREE.ShaderMaterial({
    name: 'Pacific coastal water', fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, sky: { value: null }, skyReady: { value: 0 },
      skyRotation: { value: new THREE.Vector2(1, 0) }, night: { value: 0 },
      analyticSun: { value: 1 },
      sunDirection: { value: new THREE.Vector3(-.3, .106, .948).normalize() },
    }]),
    vertexShader: `varying vec3 vWorld; varying vec2 vSurface;
      ${waveFunctions}
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        vSurface = world.xz;
        vec3 offset, normal; float crest;
        oceanSurface(vSurface, offset, normal, crest);
        world.xyz += offset;
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vWorld; varying vec2 vSurface;
      uniform sampler2D sky; uniform float skyReady;
      uniform vec2 skyRotation; uniform float night;
      uniform float analyticSun;
      uniform vec3 sunDirection; uniform sampler2D foamPattern;
      ${waveFunctions}
      #include <fog_pars_fragment>
      float fifthPower(float x) { float square = x * x; return square * square * x; }
      vec2 ripple(vec2 p, vec2 direction, float length, float amplitude, float speed) {
        float k = TAU / length;
        float phase = dot(p, direction) * k - time * speed;
        // Fade before a ripple becomes smaller than roughly two pixels; this
        // removes crawling horizon stripes instead of merely blurring them.
        float resolved = 1. - smoothstep(.7, 2.8, fwidth(phase));
        return direction * (amplitude * k * cos(phase) * resolved);
      }
      void main() {
        vec3 offset, normal; float crest;
        oceanSurface(vSurface, offset, normal, crest);
        vec2 wind = ripple(vSurface, vec2(.94, .341174), 3.7, .022, 3.4)
          + ripple(vSurface, vec2(.835165, -.55), 1.75, .008, 4.5)
          + ripple(vSurface, vec2(.96, .28), .78, .003, 6.2);
        normal = normalize(normal + vec3(-wind.x, 0., -wind.y));
        vec3 eye = normalize(cameraPosition - vWorld);
        vec3 reflected = reflect(-eye, normal);
        reflected.xz = mat2(skyRotation.x, skyRotation.y, -skyRotation.y, skyRotation.x) * reflected.xz;
        vec2 uv = vec2(atan(reflected.z, reflected.x) / TAU + .5,
          asin(clamp(reflected.y, -1., 1.)) / 3.14159265 + .5);
        vec2 skyDx = dFdx(uv), skyDy = dFdy(uv);
        // atan wraps at U=0/1. Keep its derivatives local so the reflected sky
        // does not select a blurry mip stripe at the equirectangular seam.
        skyDx.x -= floor(skyDx.x + .5); skyDy.x -= floor(skyDy.x + .5);
        vec3 skyColor = mix(vec3(.38, .53, .66) * mix(1., .12, night),
          min(textureGrad(sky, uv, skyDx, skyDy).rgb, vec3(8.)), skyReady);
        // Match the visible sky's intensity in createAtmosphere().
        skyColor *= mix(.65, 1., night);
        float viewCosine = clamp(dot(normal, eye), .001, 1.);
        float fresnel = .0203 + .9797 * fifthPower(1. - viewCosine);
        float depth = max(${SHORE_X.toFixed(1)} - vSurface.x, 0.);
        float shallows = 1. - smoothstep(7., 70., depth);
        vec3 water = mix(vec3(.012, .058, .078), vec3(.055, .165, .145), shallows);
        water *= mix(1., .12, night);
        vec3 color = mix(water, skyColor, fresnel);

        // A finite rough sun reflection replaces the photographed HDR solar
        // disc when a lighting-only HDR is supplied. Filter its width with the
        // normal footprint to avoid glittering subpixel highlights.
        // This branch is uniform for the draw, so the normal derivatives are
        // well-defined while night/fallback skies skip all unused sun work.
        if ((1. - night) * analyticSun > 0.) {
          vec3 halfVector = sunDirection + eye;
          halfVector /= max(length(halfVector), .0001);
          float normalLight = clamp(dot(normal, sunDirection), 0., 1.);
          float normalHalf = clamp(dot(normal, halfVector), 0., 1.);
          float roughness = clamp(.17 + length(fwidth(normal)) * 1.5, .17, .48);
          float alpha = roughness * roughness;
          float alpha2 = alpha * alpha;
          float denominator = normalHalf * normalHalf * (alpha2 - 1.) + 1.;
          float distribution = alpha2 / (3.14159265 * denominator * denominator);
          float viewHalf = clamp(dot(eye, halfVector), 0., 1.);
          float sunFresnel = .0203 + .9797 * fifthPower(1. - viewHalf);
          float visibility = 1. / max(4. * (normalLight + .09) * (viewCosine + .09), .04);
          float glint = min(distribution * sunFresnel * visibility * normalLight, 8.);
          color += vec3(1., .72, .45) * glint * 3.1 * (1. - night) * analyticSun;
        }

        // Foam is broken into irregular patches on shoreward crests. It is
        // limited to the shallow 32 m band and never adds offshore white lines.
        float surf = smoothstep(2., 7., depth) * (1. - smoothstep(12., 32., depth));
        // Filter phase, not sin(phase): a crest's zero derivative must not
        // disguise undersampling and let a thin white stripe flicker back in.
        float foamFootprint = max(fwidth(dot(vSurface, SWELL_A) * TAU / LENGTH_A),
          fwidth(dot(vSurface, SWELL_B) * TAU / LENGTH_B));
        float foamResolved = 1. - smoothstep(.7, 2.8, foamFootprint);
        vec2 foamUv = vSurface * .055 + vec2(-time * .012, time * .003);
        // Derivatives stay outside this spatial branch. Explicit gradients
        // preserve the same mip choice where neighboring lanes skip foam.
        vec2 foamDx = dFdx(foamUv), foamDy = dFdy(foamUv);
        if (surf * foamResolved > 0.) {
          vec2 pattern = textureGrad(foamPattern, foamUv, foamDx, foamDy).rg;
          float front = smoothstep(.43 + pattern.x * .28, .91, crest / .34);
          float broken = smoothstep(.45, .76, pattern.y + pattern.x * .22 + front * .22);
          float foamAmount = surf * front * broken * foamResolved * .72;
          vec3 foamColor = vec3(.47, .54, .53) * mix(1., .13, night);
          color = mix(color, foamColor, foamAmount);
        }
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // Assign after UniformsUtils.merge so it owns exactly one generated texture.
  material.uniforms.foamPattern = { value: foam };
  const mesh = new THREE.Mesh(coastalGeometry(), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(-1050, -.08, -80);
  mesh.name = 'Pacific Ocean · directional swells and broken shore foam';
  let daySky, nightSky, ownedDaySky, disposed = false;
  return {
    mesh,
    update(time) {
      if (disposed) return false;
      material.uniforms.time.value = time;
      return true;
    },
    setNight(value) {
      if (disposed) return false;
      material.uniforms.night.value = Number(value);
      material.uniforms.sky.value = value ? nightSky : daySky;
      return true;
    },
    setSky(data) {
      // Guard before reading the payload, cloning pixels or creating textures:
      // a late asynchronous sky load must not resurrect a released ocean.
      if (disposed) return false;
      const { texture, lightingTexture, nightTexture, rotation, sunDirection } = data;
      ownedDaySky?.dispose();
      ownedDaySky = lightingTexture ? reflectionTexture(lightingTexture) : null;
      daySky = ownedDaySky || texture;
      nightSky = nightTexture || texture;
      // An external non-data fallback retains its own photographed sun instead
      // of receiving a second analytic one. Normal startup owns the low-res map.
      material.uniforms.analyticSun.value = Number(Boolean(ownedDaySky));
      material.uniforms.sky.value = material.uniforms.night.value ? nightSky : daySky;
      material.uniforms.skyReady.value = 1;
      material.uniforms.skyRotation.value.set(Math.cos(rotation.y), Math.sin(rotation.y));
      material.uniforms.sunDirection.value.copy(sunDirection).normalize();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.visible = false;
      mesh.removeFromParent();
      mesh.geometry.dispose(); material.dispose(); foam.dispose(); ownedDaySky?.dispose();
      material.uniforms.sky.value = material.uniforms.foamPattern.value = null;
      daySky = nightSky = ownedDaySky = null;
    },
  };
}
