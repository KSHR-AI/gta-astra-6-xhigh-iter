import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/addons/shaders/GTAOShader.js';

// One scene render supplies both HDR colour and depth. Ambient occlusion runs at
// half resolution, without rendering the city's geometry a second time.
export function createRendering(renderer, scene, camera, software) {
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const colour = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthTexture: depth,
    samples: software ? 0 : 2,
  });
  // GTAO only stores a scalar visibility value. R8 retains the same 8-bit
  // precision as RGBA8 while using one quarter of its attachment bandwidth.
  const occlusion = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RedFormat, depthBuffer: false,
  });
  const noise = generateMagicSquareNoise();
  const aoUniforms = THREE.UniformsUtils.clone(GTAOShader.uniforms);
  Object.assign(aoUniforms, {
    tDepth: { value: depth }, tNoise: { value: noise },
    cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
    radius: { value: 1.6 }, thickness: { value: 1.5 },
    distanceFallOff: { value: 1.2 }, scale: { value: 1 },
  });
  const aoMaterial = new THREE.ShaderMaterial({
    defines: { ...GTAOShader.defines, SAMPLES: 9, NORMAL_VECTOR_TYPE: 0 },
    uniforms: aoUniforms, vertexShader: GTAOShader.vertexShader,
    fragmentShader: GTAOShader.fragmentShader,
    depthTest: false, depthWrite: false,
  });
  const fxaa=FXAAShader.fragmentShader.slice(FXAAShader.fragmentShader.indexOf('#define EDGE_STEP_COUNT'),FXAAShader.fragmentShader.lastIndexOf('void main()'));
  const finish = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      image: { value: colour.texture }, occlusion: { value: occlusion.texture },
      pixel: { value: new THREE.Vector2() }, aoPixel: { value: new THREE.Vector2() },
      useAO: { value: 1 }, night: { value: 0 },
      depthMap: { value: depth }, nearPlane: { value: camera.near }, farPlane: { value: camera.far },
      focusDistance: { value: 8 }, aperture: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D image; uniform sampler2D occlusion;
      uniform vec2 pixel; uniform vec2 aoPixel; uniform float useAO; uniform float night;
      uniform sampler2D depthMap; uniform float nearPlane; uniform float farPlane;
      uniform float focusDistance; uniform float aperture;
      varying vec2 vUv;
      ${fxaa}
      float sceneLuminance(vec3 colour){return dot(colour,vec3(.2126,.7152,.0722));}
      float sceneDistance(vec2 uv){float d=texture2D(depthMap,uv).x;return nearPlane*farPlane/(farPlane-d*(farPlane-nearPlane));}
      vec3 glow(vec2 offset){vec3 c=texture2D(image,clamp(vUv+offset,vec2(0.),vec2(1.))).rgb;return c*max(0.,sceneLuminance(c)-1.5)/(sceneLuminance(c)+.001);}
      void main(){
        vec3 c=ApplyFXAA(image,pixel,vUv).rgb;
        // Optional photographic depth of field. Reject foreground samples when
        // blurring a background pixel so silhouettes do not acquire bright halos.
        if(aperture>.001){
          float distance=sceneDistance(vUv);
          float blur=clamp(abs(distance-focusDistance)/max(distance,1.),0.,1.)*aperture*9.;
          vec3 total=c;float weight=1.;
          for(int i=0;i<32;i++){
            float a=float(i)*2.399963;float r=sqrt((float(i)+.5)/32.);
            vec2 uv=clamp(vUv+vec2(cos(a),sin(a))*r*blur*pixel,vec2(0.),vec2(1.));
            float sd=sceneDistance(uv);float w=smoothstep(distance*.8,distance,sd)*(1.-r*.65);
            total+=texture2D(image,uv).rgb*w;weight+=w;
          }
          c=total/weight;
        }
        float ao=texture2D(occlusion,vUv).r*.4;
        ao+=texture2D(occlusion,vUv+vec2(aoPixel.x,0.)).r*.15;
        ao+=texture2D(occlusion,vUv-vec2(aoPixel.x,0.)).r*.15;
        ao+=texture2D(occlusion,vUv+vec2(0.,aoPixel.y)).r*.15;
        ao+=texture2D(occlusion,vUv-vec2(0.,aoPixel.y)).r*.15;
        c*=mix(1.,mix(.42,1.,ao),useAO);
        vec2 r=pixel*7.;
        vec3 bloom=glow(r)+glow(-r)+glow(vec2(r.x,-r.y))+glow(vec2(-r.x,r.y));
        bloom+=glow(vec2(r.x*2.,0.))+glow(vec2(-r.x*2.,0.))+glow(vec2(0.,r.y*2.))+glow(vec2(0.,-r.y*2.));
        c+=bloom*.017;
        // Restrained warm highlights and cool shadows; no opaque screen tint.
        float light=smoothstep(.08,1.8,sceneLuminance(c));
        c*=mix(vec3(.96,1.,1.035),vec3(1.035,1.008,.965),light)*(1.-night*.03);
        vec2 p=vUv*(1.-vUv.yx);float vignette=pow(clamp(p.x*p.y*16.,0.,1.),.14);
        c*=mix(.83,1.,vignette);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new FullScreenQuad(aoMaterial);
  const clear = new THREE.Color();
  const drawingSize = new THREE.Vector2();
  let quality = 'high';
  function resize() {
    const size = renderer.getDrawingBufferSize(drawingSize);
    colour.setSize(size.x, size.y);
    occlusion.setSize(Math.max(1, Math.ceil(size.x / 2)), Math.max(1, Math.ceil(size.y / 2)));
    aoUniforms.resolution.value.set(occlusion.width, occlusion.height);
    finish.uniforms.pixel.value.set(1 / size.x, 1 / size.y);
    finish.uniforms.aoPixel.value.set(1 / occlusion.width, 1 / occlusion.height);
  }
  resize();
  return {
    resize,
    setNight(value) { finish.uniforms.night.value = value ? 1 : 0; },
    setPhotoQuality(active) {
      const samples = active ? 4 : (software ? 0 : 2);
      if (colour.samples !== samples) { colour.samples = samples; colour.dispose(); }
    },
    setLens(focus, aperture) { finish.uniforms.focusDistance.value = focus; finish.uniforms.aperture.value = aperture; },
    setQuality(value) { quality = value; finish.uniforms.useAO.value = value === 'high' ? 1 : 0; resize(); },
    render() {
      renderer.info.reset();
      renderer.setRenderTarget(colour);
      renderer.render(scene, camera);
      if (quality === 'high') {
        aoUniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        aoUniforms.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
        aoUniforms.cameraWorldMatrix.value.copy(camera.matrixWorld);
        renderer.getClearColor(clear);
        const alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(occlusion);
        renderer.setClearColor(0xffffff, 1);
        // The renderer clears this pass once. GTAO discards background pixels,
        // so its white clear remains necessary; an additional explicit clear is not.
        quad.material = aoMaterial;
        quad.render(renderer);
        renderer.setClearColor(clear, alpha);
      }
      renderer.setRenderTarget(null);
      quad.material = finish;
      // This opaque full-screen triangle writes every output pixel and never
      // tests depth. Clearing the canvas first only repeats a full-buffer write.
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try { quad.render(renderer); }
      finally { renderer.autoClear = autoClear; }
    },
  };
}
