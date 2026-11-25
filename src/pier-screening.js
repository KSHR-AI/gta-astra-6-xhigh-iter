import * as THREE from 'three';
import { assetUrl } from './asset-url.js';

export const PIER_SCREEN_CENTER = new THREE.Vector3(-98, 6.3, -17);
const SCREEN = PIER_SCREEN_CENTER;
const LENS = new THREE.Vector3(-97, 3.21, 15.75);
const WIDTH = 12.8, HEIGHT = 7.2;
const uvVertex = `
  varying vec2 frameUV;
  void main() {
    frameUV = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

function createFilm() {
  // Four shots on a single photographic strip. Two samples give each cut a
  // short optical dissolve; the film gate hides the adjacent atlas cells.
  const material = new THREE.ShaderMaterial({
    uniforms: { strip: { value: null }, seconds: { value: 0 } },
    vertexShader: uvVertex,
    fragmentShader: `
      uniform sampler2D strip;
      uniform float seconds;
      varying vec2 frameUV;
      vec3 shot(float index, float t) {
        vec2 pan = vec2(mod(index, 2.) < .5 ? 1. : -1., index < 2. ? -.28 : .28);
        vec2 uv = .5 + (frameUV - .5) * (.93 - .035 * t) + pan * (t - .5) * .045;
        vec2 cell = vec2(mod(index, 2.), 1. - floor(index / 2.));
        return texture2D(strip, (cell + uv) * .5).rgb;
      }
      void main() {
        float clock = seconds / 4.5;
        float frame = mod(floor(clock), 4.), t = fract(clock);
        vec3 color = mix(shot(frame,t),shot(mod(frame+1.,4.),0.),smoothstep(.83,1.,t));
        float vignette = 1. - .18 * dot(frameUV-.5, frameUV-.5);
        gl_FragColor = vec4(color * vignette, 1.);
        #include <colorspace_fragment>
      }
    `,
  });
  const film = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), material);
  film.position.copy(SCREEN);
  film.name = 'Pacific coast · four-reel travelogue';
  film.visible = false;
  return film;
}

function createBeam() {
  // The back faces bound the far end of each view ray. Integrate only the
  // segment crossing this short beam, including when the camera sits inside.
  const geometry = new THREE.ConeGeometry(1, 1, 24, 1);
  geometry.translate(0, -.5, 0);
  const direction = SCREEN.clone().sub(LENS);
  const length = direction.length();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { extent: { value: new THREE.Vector3(WIDTH * .51, length, HEIGHT * .51) } },
    vertexShader: `
      varying vec3 beamPoint;
      varying vec3 eye;
      void main() {
        beamPoint = position;
        eye = (inverse(modelViewMatrix) * vec4(0.,0.,0.,1.)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec3 beamPoint;
      varying vec3 eye;
      uniform vec3 extent;
      void main() {
        vec3 delta = eye-beamPoint;
        float distanceToEye = length(delta*extent);
        vec3 stepRay = delta / max(distanceToEye,.0001);
        vec3 invRay = sign(stepRay + 1.e-8)/max(abs(stepRay),vec3(1.e-8));
        vec3 exitDist = max((vec3(-1.,-1.,-1.)-beamPoint)*invRay,
                            (vec3(1.,0.,1.)-beamPoint)*invRay);
        float span = max(0.,min(distanceToEye,min(exitDist.x,min(exitDist.y,exitDist.z))));
        float haze = 0.;
        for(int i=0;i<10;i++) {
          vec3 p = beamPoint + stepRay * span * (float(i)+.5)/10.;
          float axial = clamp(-p.y,0.,1.);
          float radial = length(p.xz)/max(axial,.0001);
          haze += (1.-smoothstep(.22,1.,radial))*(1.-.7*axial);
        }
        gl_FragColor = vec4(.72,.78,1.,min(.13,haze * span * .00085));
        #include <colorspace_fragment>
      }`,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.name = 'Pier projector · light through salt air';
  beam.position.copy(LENS);
  beam.scale.copy(material.uniforms.extent.value);
  // Keep the broad axis of the elliptical beam parallel to the screen.
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.normalize());
  beam.visible = false;
  return beam;
}

export function createPierScreening({ box, panel, line, materials: m, root, colliders }) {
  const { x, y, z } = SCREEN;
  const addSolid = (cx, cz, w, d, bottom, top) => colliders.push({
    minX: cx-w/2, maxX: cx+w/2, minZ: cz-d/2, maxZ: cz+d/2, minY: bottom, maxY: top,
  });
  box(m.teal, x,y,z-.29, WIDTH+.49,HEIGHT+.5,.48);
  box(m.dark, x,y,z-.052, WIDTH+.15,HEIGHT+.15,.08);
  panel(m.pale, x,y,z-.008, WIDTH,HEIGHT);
  addSolid(x,z-.29,WIDTH+.49,.48,y-HEIGHT/2-.25,y+HEIGHT/2+.25);
  for (const dx of [-5.55,5.55]) {
    box(m.concrete,x+dx,.3,z-.37,1,.6,1.1);
    box(m.teal,x+dx,4.92,z-.41,.24,9.8,.26);
    line(m.metal,[x+dx,.25,z-2.24],[x+dx,6.3,z-.52],.09);
    addSolid(x+dx,z-.37,1,1.1,0,HEIGHT+2.7);
  }
  // The weatherproof booth stands behind the sidewalk and clear of the
  // receiving trolley. Its shutter, lens housing and canopy face the screen.
  box(m.concrete,-97,.22,17.7,3.82,.44,3.34);
  box(m.sage,-97,1.9,17.7,3.55,3.2,3);
  box(m.teal,-97,3.58,17.58,3.98,.21,3.55);
  box(m.dark,-97,3.13,16.15,1.48,.68,.18);
  box(m.blackMetal,LENS.x,LENS.y,LENS.z+.25,.52,.39,.58);
  box(m.glassLight,LENS.x,LENS.y,LENS.z,.25,.21,.08);
  for (const dx of [-1.53,1.53]) box(m.trim,-97+dx,1.89,16.16,.10,3.1,.13);
  addSolid(-97,17.7,3.72,3.22,0,3.7);

  const film = createFilm(), beam = createBeam();
  root.add(film, beam);
  let unlocked = false, night = false, loading = false, start;
  function refresh() {
    film.visible = Boolean(unlocked && film.material.uniforms.strip.value);
    beam.visible = film.visible && night;
  }
  function loadFilm() {
    if (unlocked && !loading && !film.material.uniforms.strip.value) {
      loading = true;
      new THREE.TextureLoader().loadAsync(assetUrl('art/world/pier-travelogue.webp')).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        film.material.uniforms.strip.value = texture;
        refresh();
      }).catch(error => console.warn('Pier travelogue unavailable.', error)).finally(() => { loading = false; });
    }
    refresh();
  }
  function setUnlocked(value) {
    if (unlocked === Boolean(value)) return;
    unlocked = Boolean(value);
    start = undefined;
    loadFilm();
  }
  return {
    setUnlocked,
    restart() {
      if (!unlocked) return;
      start = undefined;
      loadFilm();
    },
    setNight(value) { night = Boolean(value); refresh(); },
    update(time) {
      if (!film.visible) return;
      start ??= time;
      film.material.uniforms.seconds.value = (time-start) % 18;
    },
  };
}
