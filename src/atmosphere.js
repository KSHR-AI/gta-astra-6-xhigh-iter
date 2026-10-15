import * as THREE from 'three';

// A continuous sky dome with a warm marine horizon and soft high-altitude clouds.
export function createAtmosphere(scene) {
  const uniforms = {
    zenith: { value: new THREE.Color('#65b5dc') },
    horizon: { value: new THREE.Color('#ffb883') },
    night: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: `varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform float night; varying vec3 vDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){
        vec3 d=normalize(vDirection);float h=max(d.y,0.);
        vec3 col=mix(horizon,zenith,pow(smoothstep(.10,.9,h),.8));
        vec3 sun=normalize(vec3(-.55,.16,-.9));float alignment=max(dot(d,sun),0.);
        col+=vec3(1.,.55,.22)*pow(alignment,32.)*.18*(1.-night);
        col+=vec3(1.,.8,.45)*smoothstep(.99945,.9998,alignment)*2.4*(1.-night);
        vec2 p=d.xz/max(.08,d.y)*vec2(1.1,5.);
        float n=noise(p)*.55+noise(p*2.1)*.28+noise(p*4.3)*.17;
        float clouds=smoothstep(.55,.78,n)*smoothstep(.06,.25,h)*(1.-smoothstep(.55,.9,h));
        col=mix(col,vec3(.93,.83,.73),clouds*.38*(1.-night));
        float stars=pow(hash(floor(d.xz/max(.1,d.y)*500.)),85.)*smoothstep(.12,.5,h);
        col+=vec3(stars)*night*.6;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900,32,20), material);
  dome.frustumCulled=false;scene.add(dome);
  return { setNight(value){uniforms.night.value=value?1:0;uniforms.zenith.value.set(value?'#071021':'#65b5dc');uniforms.horizon.value.set(value?'#263745':'#ffb883');} };
}
