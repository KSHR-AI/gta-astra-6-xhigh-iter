import * as THREE from 'three';

// Original pinnate palm geometry. Every blade has its own taper, fold and tip;
// the opaque vein atlas supplies detail without large transparent frond cards.
export function createPalmAssets(canvasTexture) {
  let seed = 0x50a1f09d;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const range = (a, b) => a + random() * (b - a);
  const map = canvasTexture(1024, 256, (ctx, width, height) => {
    const palettes = [
      ['#2d4c30', '#4c723d', '#82964f'],
      ['#294c32', '#456c3c', '#738c49'],
      ['#405b32', '#657c3e', '#8d9851'],
      ['#2c4c31', '#4c703d', '#7b914e'],
    ];
    for (let tile = 0; tile < 4; tile++) {
      const left = tile * width / 4, span = width / 4;
      const [dark, base, light] = palettes[tile];
      const gradient = ctx.createLinearGradient(0, 0, 0, height - 24);
      gradient.addColorStop(0, dark);
      gradient.addColorStop(0.38, base);
      gradient.addColorStop(0.49, light);
      gradient.addColorStop(0.53, base);
      gradient.addColorStop(1, dark);
      ctx.fillStyle = gradient;
      ctx.fillRect(left, 0, span, height);
      // Fine longitudinal fibers, not a repetitive silhouette painted on a card.
      for (let strand = 0; strand < 100; strand++) {
        const y = range(8, height - 30);
        ctx.strokeStyle = strand % 3 ? 'rgba(207,214,145,.09)' : 'rgba(27,48,19,.16)';
        ctx.lineWidth = range(0.4, 1.5);
        ctx.beginPath(); ctx.moveTo(left, y);
        ctx.bezierCurveTo(left + span * 0.3, y + range(-3, 3), left + span * 0.65, y + range(-2, 2), left + span, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(203,209,130,.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(left, height * 0.48); ctx.lineTo(left + span, height * 0.48); ctx.stroke();
      // A solid atlas strip lets the rachis share the same material/draw call.
      ctx.fillStyle = ['#97986a', '#8c915f', '#a3a175', '#909466'][tile];
      ctx.fillRect(left, height - 18, span, 18);
      ctx.fillStyle = '#bec08b'; ctx.fillRect(left, height - 15, span, 2);
    }
  });
  map.anisotropy = 4;

  const center = t => new THREE.Vector3(
    t * 5.4,
    Math.sin(t * Math.PI) * 1.75 - t * t * 1.92,
    Math.sin(t * Math.PI * 1.4) * 0.055,
  );

  function frond(pairs, folded, stemSegments) {
    const positions = [], uvs = [], colors = [], indices = [];
    const add = (point, u, v, shade = 1, weather = 0) => {
      const index = positions.length / 3;
      positions.push(point.x, point.y, point.z);
      uvs.push(u, v);
      colors.push(shade * (1 + weather * 0.38), shade * (1 - weather * 0.13), shade * (0.96 - weather * 0.2));
      return index;
    };
    // A triangular tapered rachis has actual volume, including in side view.
    for (let segment = 0; segment <= stemSegments; segment++) {
      const t = segment / stemSegments;
      const p = center(t);
      const tangent = center(Math.min(1, t + 0.01)).sub(center(Math.max(0, t - 0.01))).normalize();
      const up = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const radius = 0.037 * Math.pow(1 - t, 0.85) + 0.003;
      for (let side = 0; side < 3; side++) {
        const angle = side * Math.PI * 2 / 3;
        const point = p.clone().addScaledVector(up, Math.cos(angle) * radius);
        point.z += Math.sin(angle) * radius;
        add(point, 0.79 + t * 0.18, 0.025, 0.9 + t * 0.1);
      }
      if (segment) for (let side = 0; side < 3; side++) {
        const a = (segment - 1) * 3 + side;
        const b = (segment - 1) * 3 + (side + 1) % 3;
        const c = segment * 3 + side;
        const d = segment * 3 + (side + 1) % 3;
        indices.push(a, c, b, b, c, d);
      }
    }
    for (let pair = 0; pair < pairs; pair++) {
      const q = (pair + 0.35) / pairs;
      // Leaflet roots alternate; asymmetric spacing prevents a comb silhouette.
      for (const side of [-1, 1]) {
        const t = 0.115 + q * 0.84 + side * 0.008 + range(-0.006, 0.006);
        const root = center(t);
        const reach = (Math.pow(Math.sin(q * Math.PI), 0.66) * 1.37 + 0.06) * range(0.86, 1.13);
        const sweep = 0.12 + reach * (0.42 + q * 0.31) + range(-0.055, 0.055);
        const droop = 0.11 + reach * 0.2 + q * q * 0.35 + range(-0.045, 0.1);
        const tip = root.clone().add(new THREE.Vector3(sweep, -droop, side * reach));
        const middle = root.clone().add(new THREE.Vector3(sweep * 0.39, 0.045 - droop * 0.22, side * reach * 0.48));
        const across = new THREE.Vector3(side * reach, 0, -sweep).normalize();
        // Each low-detail blade represents a tight botanical leaflet cluster.
        // Preserve projected leaf area at street distance instead of modeling
        // subpixel needles that disappear and sparkle in a moving camera.
        const width = (0.065 + reach * 0.105) * range(0.92, 1.14) * (folded ? 0.65 : 1.75);
        const twist = range(-0.018, 0.018);
        const left = middle.clone().addScaledVector(across, width); left.y += twist;
        const right = middle.clone().addScaledVector(across, -width); right.y -= twist;
        const tile = (pair + (side === 1 ? 1 : 0)) % 4;
        const u0 = tile * 0.25 + 0.015, u1 = tile * 0.25 + 0.235;
        const shade = range(0.83, 1.13);
        const weather = pair % 9 === 3 ? range(0.35, 0.8) : 0;
        const base = add(root, u0, 0.52, shade * 0.87);
        const l = add(left, u0 + 0.09, 0.88, shade);
        const r = add(right, u0 + 0.09, 0.13, shade * 0.93);
        const end = add(tip, u1, 0.52, shade * 1.03, weather);
        if (folded) {
          middle.y += width * 0.68;
          const ridge = add(middle, u0 + 0.09, 0.52, shade * 1.08);
          indices.push(base, l, ridge, base, ridge, r, l, end, ridge, ridge, end, r);
        } else indices.push(base, l, end, base, end, r);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.name = `${folded ? 'Folded' : 'Distant'} pinnate palm / ${pairs * 2} geometric leaflets / ${indices.length / 3} triangles`;
    return geometry;
  }

  function trunk(radialSegments, heightSegments) {
    // A shallow taper joins adjacent trunk sections without the old cup-like lips.
    const geometry = new THREE.CylinderGeometry(0.97, 1, 1, radialSegments, heightSegments, true);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i), angle = Math.atan2(position.getZ(i), position.getX(i));
      const band = Math.round((y + 0.5) * heightSegments);
      const fibers = 1 + Math.sin(angle * 5.0 + y * 1.4) * 0.012 + (band % 2 ? 0.008 : -0.004);
      position.setX(i, position.getX(i) * fibers);
      position.setZ(i, position.getZ(i) * fibers);
    }
    geometry.computeVertexNormals();
    geometry.name = 'Fine-ribbed continuous palm trunk section';
    return geometry;
  }

  const near = frond(20, true, 4);
  const far = frond(6, false, 4);
  const trunkNear = trunk(8, 2), trunkFar = trunk(6, 1);
  return {
    map, near, far, trunkNear, trunkFar,
    // The caller can keep its existing material and wind deformation.
    alphaTest: 0,
    stats: {
      nearFrondTriangles: near.index.count / 3,
      farFrondTriangles: far.index.count / 3,
      nearTrunkSectionTriangles: trunkNear.index.count / 3,
      farTrunkSectionTriangles: trunkFar.index.count / 3,
      atlasPixels: 1024 * 256,
    },
  };
}
