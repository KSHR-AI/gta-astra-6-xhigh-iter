import * as THREE from 'three';

// Analytic waves and a reflected photographic sky, with no second scene render.
// The water shares the lighting direction and HDR rotation used by the city.
export function createOcean() {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, sky: { value: null }, skyReady: { value: 0 },
      skyRotation: { value: 0 }, night: { value: 0 },
      sunDirection: { value: new THREE.Vector3(-.3,.106,.948) },
    }]),
    vertexShader: `varying vec3 vWorld; uniform float time;
      #include <fog_pars_vertex>
      void main(){
        vec3 p=position;
        p.z+=sin(p.x*.065+time*.75)*.16+sin(p.y*.105-p.x*.02+time*.53)*.10;
        vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;
        vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vWorld;
      uniform float time; uniform sampler2D sky; uniform float skyReady;
      uniform float skyRotation; uniform float night; uniform vec3 sunDirection;
      #include <fog_pars_fragment>
      vec2 slope(vec2 p){
        return vec2(cos(dot(p,vec2(.54,.18))+time*.8)*.08+cos(dot(p,vec2(1.4,-.7))-time*1.1)*.035,
          cos(dot(p,vec2(.18,.63))-time*.63)*.065+cos(dot(p,vec2(.9,1.8))+time*1.4)*.025);
      }
      void main(){
        vec2 wave=slope(vWorld.xz);
        vec3 normal=normalize(vec3(-wave.x,1.,-wave.y));
        vec3 eye=normalize(cameraPosition-vWorld);
        vec3 reflected=reflect(-eye,normal);
        float cs=cos(skyRotation),sn=sin(skyRotation);
        reflected.xz=mat2(cs,sn,-sn,cs)*reflected.xz;
        vec2 uv=vec2(atan(reflected.z,reflected.x)/6.2831853+.5,asin(clamp(reflected.y,-1.,1.))/3.14159265+.5);
        vec3 skyColor=mix(vec3(.38,.53,.66),min(texture2D(sky,uv).rgb,vec3(8.)),skyReady);
        float fresnel=.035+.965*pow(1.-max(dot(normal,eye),0.),5.);
        float shore=smoothstep(-190.,-150.,vWorld.x);
        vec3 water=mix(vec3(.018,.095,.12),vec3(.08,.22,.20),shore)*mix(1.,.14,night);
        vec3 color=mix(water,skyColor*.65,clamp(fresnel,.08,.94));
        vec3 halfVector=normalize(sunDirection+eye);
        float glint=pow(max(dot(normal,halfVector),0.),420.);
        color+=vec3(1.,.65,.31)*glint*1.7*(1.-night);
        float breaker=sin((vWorld.x+sin(vWorld.z*.1)*.8)*.4+time*.7);
        float foam=smoothstep(.78,.99,breaker)*shore;
        foam*=.5+.5*sin(vWorld.z*4.+wave.x*20.);
        color=mix(color,vec3(.5,.58,.54)*mix(1.,.18,night),foam*.5);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1800,1600,128,96), material);
  mesh.rotation.x=-Math.PI/2; mesh.position.set(-1050,-.08,-80);
  mesh.name='Pacific Ocean · reflected sky and rolling surf';
  let daySky, nightSky;
  return {
    mesh,
    update(time) { material.uniforms.time.value=time; },
    setNight(value) { material.uniforms.night.value=Number(value); material.uniforms.sky.value=value?nightSky:daySky; },
    setSky({texture,nightTexture,rotation,sunDirection}) {
      daySky=texture; nightSky=nightTexture||texture;
      material.uniforms.sky.value=material.uniforms.night.value?nightSky:daySky;
      material.uniforms.skyReady.value=1;
      material.uniforms.skyRotation.value=rotation.y;
      material.uniforms.sunDirection.value.copy(sunDirection);
    },
  };
}
