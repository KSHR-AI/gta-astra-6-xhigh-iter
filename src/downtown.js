import * as THREE from 'three';
import { assetUrl } from './asset-url.js';

// Each elevation covers four storeys. Its night mask is registered to the
// photographed panes, so sills, spandrels and balcony rails stay dark.
const elevations = [
  { name: 'balconies', width: 16, roughness: .77, metalness: .04 },
  { name: 'curtain-wall', width: 12, roughness: .29, metalness: .30 },
  { name: 'limestone', width: 14, roughness: .76, metalness: .04 },
  { name: 'lofts', width: 16, roughness: .84, metalness: .02 },
];

export function addDowntown({ box, panel, cylinder, instance, bayGeometry, materials: m, range }) {
  const loader = new THREE.TextureLoader();
  function loadMap(name) {
    return loader.loadAsync(assetUrl(`textures/downtown/${name}.webp`)).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      return texture;
    });
  }
  const faces = elevations.map(({ name, roughness, metalness, width }) => {
    const material = new THREE.MeshStandardMaterial({ color: '#aba99e', roughness, metalness,
      emissive: '#fff4d8', emissiveIntensity: 0 });
    material.name = `Downtown / ${name}`;
    material.onBeforeCompile = shader => {
      // Shared instanced panels keep floor height and bay width independent of
      // tower proportions. Whole floors line up when a crown steps back.
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
        #include <uv_vertex>
        #if defined(USE_INSTANCING) && defined(USE_MAP)
          vec2 repeats = vec2(max(.25, floor(length(instanceMatrix[0].xyz) / ${width.toFixed(1)} * 4. + .5) / 4.),
                              max(.25, floor(length(instanceMatrix[1].xyz) / 3.35 + .5) / 4.));
          vMapUv = uv * repeats;
          #ifdef USE_EMISSIVEMAP
            vEmissiveMapUv = vMapUv;
          #endif
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'downtown-elevation-' + width;
    return material;
  });
  const ready = Promise.all(elevations.map(async ({ name }, i) => {
    try {
      const [colour, rooms] = await Promise.all([loadMap(name), loadMap(name + '-rooms')]);
      faces[i].color.set(0xffffff);
      faces[i].map = colour;
      faces[i].emissiveMap = rooms;
      faces[i].needsUpdate = true;
    } catch (error) { console.warn(`Downtown ${name} texture unavailable.`, error); }
  }));

  function storeys(style, x, base, z, w, h, d) {
    const y = base + h * .5;
    const wall = [m.pale, m.blue, m.limestone, m.terracotta][style];
    // Recess the backing enough to remain behind its panels at long depth-buffer distances.
    box(wall, x, y, z, w - .48, h, d - .48);
    for (const side of [-1, 1]) {
      panel(faces[style], x, y, z + side * (d / 2 + .04), w, h, side < 0 ? Math.PI : 0);
      panel(faces[style], x + side * (w / 2 + .04), y, z, d, h, side * Math.PI / 2);
    }
    box(style === 1 ? m.metal : m.trim, x, base + h + .12, z, w + .36, .26, d + .36);
  }

  // Two distant street grids meet the existing district at its outer edges.
  // Their low roadbed remains below the driveable district's paving.
  box(m.asphalt, 50, -.42, -345, 300, .5, 110, 0, false);
  box(m.asphalt, 250, -.42, -29, 78, .5, 530, 0, false);
  const crownSection = new THREE.Shape();
  crownSection.moveTo(-.5, 0);
  crownSection.lineTo(.5, 0);
  crownSection.lineTo(.5, .22);
  crownSection.lineTo(-.5, 1);
  crownSection.closePath();
  const slopedCrown = new THREE.ExtrudeGeometry(crownSection, { depth: 1, bevelEnabled: false });
  slopedCrown.translate(0, 0, -.5);

  // Separate city blocks leave shafts of sky between buildings. Keep the
  // boulevard's sightline clear for its round broadcast tower.
  for (let i = 0; i < 46; i++) {
    const northern = i < 22;
    const block = northern ? i : i - 22;
    const x = (northern ? -79 + (block % 8) * 39 : 162 + (block % 3) * 46) + range(-3, 3);
    const z = (northern ? -272 - Math.floor(block / 8) * 46 : -224 + Math.floor(block / 3) * 58) + range(-4, 4);
    if (Math.hypot(x + 3, z + 310) < 36) continue;
    // Rotate neighbouring districts through different building types.
    const type = (i + Math.floor(i / 3) + Math.floor(i / 8)) % 4;
    const w = range(17, 29), d = range(18, 32);
    const floors = Math.round(range(type === 3 ? 5 : 9, [19, 29, 23, 12][type]));
    const h = floors * 3.35;
    box(m.concrete, x, .06, z, w + 3.2, .48, d + 3.2, 0, false);
    storeys(type, x, 0, z, w, h, d);
    if (type === 1) {
      // Split-level glazed pavilion and full-height bronze seam.
      storeys(type, x - w * .12, h + .25, z, w * .75, 13.4, d * .92);
      box(m.metal, x + w * .19, h * .5, z, .45, h, d + .45);
      if (i % 3 === 1) {
        const roofY = h + 13.9;
        instance(slopedCrown, m.teal, [x - w * .12, roofY, z], [w * .69, 7, d * .88]);
        for (const side of [-1, 1]) {
          cylinder(m.metal, x - w * .45, roofY + 4.4, z + side * d * .40, .17, 8.8);
        }
      }
    } else if (type === 2) {
      // A narrow lantern crowns two connected setbacks on the civic towers.
      storeys(type, x, h + .25, z, w * .72, 10.05, d * .75);
      storeys(type, x, h + 10.55, z, w * .48, 6.7, d * .52);
      box(m.teal, x, h + 18.35, z, w * .39, 2.1, d * .43);
    } else if (type === 0) {
      storeys(type, x + w * .13, h + .25, z, w * .65, 6.7, d * .72);
      box(m.trim, x + w * .13, h + 7.18, z, w * .73, .41, d * .80);
    } else {
      box(m.terracotta, x - w * .23, h + 1.75, z + d * .18, 4.8, 3.4, 6.5);
      cylinder(m.metal, x + w * .24, h + 1.5, z - d * .16, 1.2, 3.0);
    }
  }
  const tx = -3, tz = -310;
  for (const [base, h, r] of [[0, 83.75, 15], [83.75, 20.1, 12.5], [103.85, 13.4, 9.5], [117.25, 10.05, 6.5]]) {
    instance(bayGeometry, m.teal, [tx, base + h / 2, tz], [r - .36, h, r - .36]);
    instance(bayGeometry, m.trim, [tx, base + h, tz], [r + .3, .75, r + .3]);
    // Match the actual cylinder's 24 facets to avoid intersections and gaps.
    for (let k = 0; k < 24; k++) {
      const yaw = (k + .5) * Math.PI / 12;
      const apothem = r * Math.cos(Math.PI / 24) + .025;
      panel(faces[1], tx + Math.sin(yaw) * apothem, base + h / 2, tz + Math.cos(yaw) * apothem,
        2 * r * Math.sin(Math.PI / 24) - .09, h - .6, yaw);
    }
  }
  cylinder(m.metal, tx, 131.8, tz, .34, 9);
  return { ready, setNight: enabled => { for (const face of faces) face.emissiveIntensity = enabled ? .95 : 0; } };
}
