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
  const occlusion = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
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
    },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D image; uniform sampler2D occlusion;
      uniform vec2 pixel; uniform vec2 aoPixel; uniform float useAO; uniform float night;
      varying vec2 vUv;
      ${fxaa}
      float sceneLuminance(vec3 colour){return dot(colour,vec3(.2126,.7152,.0722));}
      vec3 glow(vec2 offset){vec3 c=texture2D(image,clamp(vUv+offset,vec2(0.),vec2(1.))).rgb;return c*max(0.,sceneLuminance(c)-1.5)/(sceneLuminance(c)+.001);}
      void main(){
        vec3 c=ApplyFXAA(image,pixel,vUv).rgb;
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
  let quality = 'high';
  function resize() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
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
        renderer.clear();
        quad.material = aoMaterial;
        quad.render(renderer);
        renderer.setClearColor(clear, alpha);
      }
      renderer.setRenderTarget(null);
      quad.material = finish;
      quad.render(renderer);
    },
  };
}
