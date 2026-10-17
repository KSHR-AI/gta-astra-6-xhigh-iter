import * as THREE from 'three';

const DIAMETER = 0.034;
const TUBE_THRESHOLD = 2;

export function projectedWireWidth(depth, focalPixels, diameter = DIAMETER) {
  return diameter * focalPixels / Math.max(0.001, depth);
}

// Reference form of the shader's analytic box-footprint/strip intersection.
export function wirePixelCoverage(across, width, footprint = 1) {
  const halfPixel = Math.max(footprint, 0.0001) * 0.5;
  return Math.max(0, Math.min(across + halfPixel, width * 0.5)
    - Math.max(across - halfPixel, -width * 0.5)) / (halfPixel * 2);
}

/** Physical tubes nearby; analytically filtered coverage for subpixel cables. */
export function createUtilityWires(segments, sourceMaterial) {
  const uniforms = { viewport: { value: new THREE.Vector2(1, 1) }, focalPixels: { value: 1 }, nearPlane: { value: .1 } };
  const tubeMaterial = sourceMaterial.clone();
  tubeMaterial.name = 'Utility cable / physical close surface';
  tubeMaterial.onBeforeCompile = shader => {
    shader.uniforms.wireFocalPixels = uniforms.focalPixels;
    shader.fragmentShader = 'uniform float wireFocalPixels;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      if (${DIAMETER} * wireFocalPixels / max(vViewPosition.z, 0.001) < ${TUBE_THRESHOLD.toFixed(1)}) discard;
    `);
  };
  tubeMaterial.customProgramCacheKey = () => 'physical-utility-cable-v1';
  const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(DIAMETER / 2, DIAMETER / 2, 1, 6, 1, true), tubeMaterial, segments.length);
  tubes.name = 'Utility cables / close 3D tubes';
  tubes.castShadow = false; tubes.receiveShadow = true;
  tubes.frustumCulled = false;
  const transform = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const matrices = [], endpoints = [];
  const positions = [], starts = [], ends = [], corners = [], indices = [];
  for (const [index, segment] of segments.entries()) {
    const a = new THREE.Vector3(...segment[0]), b = new THREE.Vector3(...segment[1]);
    endpoints.push([a, b]);
    transform.position.copy(a).add(b).multiplyScalar(.5);
    transform.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    transform.scale.set(1, a.distanceTo(b), 1); transform.updateMatrix();
    matrices.push(transform.matrix.clone()); tubes.setMatrixAt(index, transform.matrix);
    for (const [along, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      positions.push(...(along ? b : a).toArray()); starts.push(...a.toArray()); ends.push(...b.toArray()); corners.push(along, side);
    }
    const k = index * 4; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('wireStart', new THREE.Float32BufferAttribute(starts, 3));
  geometry.setAttribute('wireEnd', new THREE.Float32BufferAttribute(ends, 3));
  geometry.setAttribute('wireCorner', new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'Utility cable / filtered subpixel coverage',
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms, wireColor: { value: sourceMaterial.color.clone() } },
    vertexShader: `
      uniform vec2 viewport; uniform float focalPixels; uniform float nearPlane;
      attribute vec3 wireStart; attribute vec3 wireEnd; attribute vec2 wireCorner;
      varying vec2 screenAcross; varying float viewDepth;
      #include <fog_pars_vertex>
      void main() {
        vec4 start = modelViewMatrix * vec4(wireStart, 1.0);
        vec4 end = modelViewMatrix * vec4(wireEnd, 1.0);
        // Clip endpoints before perspective division when a photo camera flies
        // through a span; this avoids enormous or inverted screen-space quads.
        if (start.z > -nearPlane && end.z > -nearPlane) { gl_Position = vec4(2.,2.,2.,1.); screenAcross=vec2(0.,1.); viewDepth=1.; return; }
        if (start.z > -nearPlane) start = mix(start, end, (-nearPlane-start.z)/(end.z-start.z));
        if (end.z > -nearPlane) end = mix(end, start, (-nearPlane-end.z)/(start.z-end.z));
        vec4 ca = projectionMatrix * start, cb = projectionMatrix * end;
        vec2 direction = (cb.xy/cb.w - ca.xy/ca.w) * viewport;
        vec2 normal = vec2(-direction.y, direction.x) / max(length(direction), 0.0001);
        vec4 mvPosition = mix(start, end, wireCorner.x);
        viewDepth = -mvPosition.z;
        float physicalWidth = ${DIAMETER} * focalPixels / max(viewDepth, .001);
        // The widest square-pixel footprint normal to a diagonal cable is
        // sqrt(2). A full pixel margin covers it without clipping filter support.
        float halfWidth = physicalWidth * .5 + 1.;
        float across = wireCorner.y * halfWidth;
        gl_Position = projectionMatrix * mvPosition;
        gl_Position.xy += normal * across * 2. / viewport * gl_Position.w;
        // Emulate noperspective interpolation: coverage is measured in raster
        // pixels, so perspective-correct interpolation must not distort it.
        screenAcross = vec2(across * gl_Position.w, gl_Position.w);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float focalPixels; uniform vec3 wireColor;
      varying vec2 screenAcross; varying float viewDepth;
      #include <fog_pars_fragment>
      void main() {
        float width = ${DIAMETER} * focalPixels / max(viewDepth, .001);
        float across = screenAcross.x / screenAcross.y;
        // Evaluate derivatives before a nonuniform discard at the tube boundary.
        float footprint = max(fwidth(across), .0001);
        if (width >= ${TUBE_THRESHOLD.toFixed(1)}) discard;
        float halfPixel = footprint * .5;
        // Exact overlap of the physical strip and the pixel's projected box
        // footprint. One continuous expression covers thin and wide cables;
        // integrated opacity remains proportional to actual projected diameter.
        float overlap = max(0., min(across + halfPixel, width * .5)
          - max(across - halfPixel, -width * .5));
        float coverage = overlap / footprint;
        if (coverage < .002) discard;
        gl_FragColor = vec4(wireColor, coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const ribbons = new THREE.Mesh(geometry, material);
  ribbons.name = 'Utility cables / continuous distant spans'; ribbons.frustumCulled = false;
  const root = new THREE.Group(); root.name = 'Filtered overhead utility cables'; root.add(tubes, ribbons);
  const passViewport = new THREE.Vector4();
  const updatePassUniforms = (renderer, _scene, camera) => {
    // Cubemap faces and offscreen passes have their own physical viewport.
    // Do not compact instances here: their GPU buffers were already uploaded.
    renderer.getCurrentViewport(passViewport);
    uniforms.viewport.value.set(Math.max(1, passViewport.z), Math.max(1, passViewport.w));
    uniforms.focalPixels.value = camera.projectionMatrix.elements[5] * uniforms.viewport.value.y * .5;
    uniforms.nearPlane.value = camera.near;
  };
  tubes.onBeforeRender = updatePassUniforms;
  ribbons.onBeforeRender = updatePassUniforms;
  const localView = new THREE.Matrix4(), aView = new THREE.Vector3(), bView = new THREE.Vector3();
  let selected = matrices.map((_, index) => index);
  let stats = { segments: segments.length, tubeSegments: segments.length, filteredSegments: 0 };
  return {
    root,
    restoreWires() {
      // Cube-camera capture needs every physical span. Per-pass shader widths
      // still choose tubes or ribbons; the next camera update compacts again.
      if (selected.length !== matrices.length) {
        for (let index = 0; index < matrices.length; index++) tubes.setMatrixAt(index, matrices[index]);
        tubes.instanceMatrix.needsUpdate = true;
        selected = matrices.map((_, index) => index);
      }
      tubes.count = matrices.length;
      stats = { segments: segments.length, tubeSegments: segments.length, filteredSegments: 0 };
    },
    updateWires(camera, renderSize) {
      if (!camera?.isPerspectiveCamera || !renderSize || renderSize.x <= 0 || renderSize.y <= 0) return;
      camera.updateWorldMatrix(true, false); root.updateWorldMatrix(true, false);
      localView.multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
      uniforms.viewport.value.copy(renderSize);
      uniforms.focalPixels.value = camera.projectionMatrix.elements[5] * renderSize.y * .5;
      uniforms.nearPlane.value = camera.near;
      const next = [];
      for (let i = 0; i < endpoints.length; i++) {
        aView.copy(endpoints[i][0]).applyMatrix4(localView); bView.copy(endpoints[i][1]).applyMatrix4(localView);
        if (aView.z > -camera.near && bView.z > -camera.near) continue;
        // Submit physical geometry only if any part of this segment can reach
        // two pixels. Fragment thresholds make the tube/ribbon boundary exact.
        if (projectedWireWidth(Math.max(camera.near, Math.min(-aView.z, -bView.z)), uniforms.focalPixels.value) >= TUBE_THRESHOLD * .98) next.push(i);
      }
      if (next.length !== selected.length || next.some((index, i) => index !== selected[i])) {
        for (let i = 0; i < next.length; i++) tubes.setMatrixAt(i, matrices[next[i]]);
        tubes.instanceMatrix.needsUpdate = true; selected = next;
      }
      tubes.count = next.length;
      stats = { segments: segments.length, tubeSegments: next.length, filteredSegments: segments.length - next.length };
    },
    getWireStats: () => ({ ...stats }),
  };
}
