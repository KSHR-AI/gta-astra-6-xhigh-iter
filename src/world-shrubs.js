import * as THREE from 'three';

// A coastal pittosporum: woody shoots and individually cupped, leathery leaves.
// Geometry is shared by every shrub; dimensions describe its centred full bounds.
export function createShrubBuilder({ instance, canvasTexture, random, range }) {
  // Building the asset must not advance the city's layout random sequence.
  let seed = 0x41e89a;
  const leafRandom = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const between = (a, b) => a + (b - a) * leafRandom();
  const texture = canvasTexture(512, 512, (ctx, width, height) => {
    const palettes = [
      ['#425b32', '#73834b', '#879659'],
      ['#3c5936', '#627c48', '#83965c'],
      ['#4a6136', '#819250', '#a1a76b'],
      ['#3f5f3b', '#6b864f', '#8d9d64'],
    ];
    for (let tile = 0; tile < 4; tile++) {
      ctx.save();
      ctx.translate((tile % 2) * width / 2, Math.floor(tile / 2) * height / 2);
      const [dark, mid, light] = palettes[tile];
      const shade = ctx.createLinearGradient(15, 180, 246, 62);
      shade.addColorStop(0, dark); shade.addColorStop(0.48, mid);
      shade.addColorStop(0.52, light); shade.addColorStop(1, mid);
      ctx.fillStyle = shade; ctx.fillRect(0, 0, 256, 256);
      // Low-contrast mottling and fine veins survive close inspection without
      // giving a whole plant the soft silhouette of a cutout branch card.
      for (let spot = 0; spot < 65; spot++) {
        ctx.fillStyle = spot % 2 ? 'rgba(206,208,145,.055)' : 'rgba(25,43,25,.04)';
        ctx.beginPath(); ctx.ellipse(between(8, 248), between(8, 248), between(2, 8), between(3, 11), 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(177,187,121,.38)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(128, 246); ctx.quadraticCurveTo(126, 130, 128, 10); ctx.stroke();
      ctx.strokeStyle = 'rgba(176,187,120,.17)'; ctx.lineWidth = 0.8;
      for (let vein = 0; vein < 8; vein++) {
        const y = 224 - vein * 25;
        const breadth = Math.sin((246 - y) / 246 * Math.PI) * 88;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(128, y);
          ctx.quadraticCurveTo(128 + side * breadth * 0.64, y - 12, 128 + side * breadth, y - 34); ctx.stroke();
        }
      }
      ctx.restore();
    }
    // Opaque bark swatch, sampled only by the stems. No alpha blending/cards.
    ctx.fillStyle = '#80765a'; ctx.fillRect(0, 0, 12, 12);
  });
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: '#ffffff',
    roughness: 0.78,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    vertexColors: true,
  });
  material.name = 'Pittosporum broadleaf and woody shoots';

  function plantGeometry(distant = false) {
    const positions = [], uvs = [], colors = [], indices = [];
    const up = new THREE.Vector3(0, 1, 0);
    function vertex(point, u, v, brightness) {
      const index = positions.length / 3;
      positions.push(point.x, point.y, point.z); uvs.push(u, v);
      colors.push(brightness * 0.97, brightness, brightness * 0.94);
      return index;
    }
    function stem(points, radius) {
      // Three-sided tapered wood keeps the small branches inexpensive.
      let previous;
      for (let ring = 0; ring < points.length; ring++) {
        const direction = points[Math.min(ring + 1, points.length - 1)].clone()
          .sub(points[Math.max(0, ring - 1)]).normalize();
        const side = new THREE.Vector3().crossVectors(direction, up).normalize();
        if (side.lengthSq() < 0.01) side.set(1, 0, 0);
        const normal = new THREE.Vector3().crossVectors(side, direction).normalize();
        const thickness = radius * (1 - ring / (points.length - 1) * 0.82);
        const current = [];
        for (let edge = 0; edge < 3; edge++) {
          const angle = edge * Math.PI * 2 / 3;
          const point = points[ring].clone().addScaledVector(side, Math.cos(angle) * thickness)
            .addScaledVector(normal, Math.sin(angle) * thickness);
          current.push(vertex(point, 0.01, 0.99, 0.68 + ring / points.length * 0.27));
        }
        if (previous) for (let edge = 0; edge < 3; edge++) {
          const next = (edge + 1) % 3;
          indices.push(previous[edge], previous[next], current[edge], previous[next], current[next], current[edge]);
        }
        previous = current;
      }
    }
    function leaf(base, direction, length, breadth, tile, brightness) {
      const forward = direction.clone().normalize();
      const side = new THREE.Vector3().crossVectors(forward, up).normalize();
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      // Different rolls expose leaf tops, undersides and thin silhouettes.
      side.applyAxisAngle(forward, between(-0.65, 0.65));
      const normal = new THREE.Vector3().crossVectors(side, forward).normalize();
      const x = (tile % 2) * 0.5, y = 0.5 - Math.floor(tile / 2) * 0.5;
      const point = (t, across, edgeWidth) => {
        const p = base.clone().addScaledVector(forward, length * t)
          .addScaledVector(side, across * breadth * edgeWidth)
          .addScaledVector(normal, length * (Math.sin(t * Math.PI) * 0.12 - t * t * 0.09)
            - Math.abs(across) * breadth * 0.12);
        return vertex(p, x + 0.035 + (0.5 + across * edgeWidth) * 0.43,
          y + 0.025 + t * 0.45, brightness * (across < 0 ? 0.96 : 1));
      };
      // One raised midrib and four triangles retain a real folded silhouette.
      const baseIndex = point(0, 0, 0);
      const middle = [point(0.58, -1, 0.5), point(0.58, 0, 0), point(0.58, 1, 0.5)];
      const tip = point(1, 0, 0);
      indices.push(baseIndex, middle[0], middle[1], baseIndex, middle[1], middle[2]);
      indices.push(middle[0], tip, middle[1], middle[1], tip, middle[2]);
    }
    function foliage(start, end, phase, count, lengthScale = 1) {
      const axis = end.clone().sub(start).normalize();
      const radial = new THREE.Vector3(Math.cos(phase), 0, Math.sin(phase));
      const around = new THREE.Vector3().crossVectors(axis, radial).normalize();
      for (let node = 0; node < count; node++) {
        const t = 0.18 + node / (count - 1) * 0.82;
        const angle = phase + node * 2.399963 + between(-0.23, 0.23);
        const outward = radial.clone().multiplyScalar(Math.cos(angle))
          .addScaledVector(around, Math.sin(angle)).normalize();
        const direction = outward.multiplyScalar(0.92).addScaledVector(axis, between(0.2, 0.65));
        const length = between(0.115, 0.165) * lengthScale * (node === count - 1 ? 0.76 : 1);
        const base = start.clone().lerp(end, t);
        const tipGrowth = node >= count - 2;
        leaf(base, direction, length, length * between(0.43, 0.57), tipGrowth ? 2 : node % 2,
          between(0.79, 1) * (0.87 + t * 0.13));
      }
    }

    for (let shoot = 0; shoot < (distant ? 4 : 6); shoot++) {
      const inner = shoot >= (distant ? 3 : 4);
      const angle = shoot * 2.399963 + between(-0.13, 0.13);
      const radius = inner ? between(0.08, 0.16) : between(0.24, 0.3);
      const top = inner ? between(0.34, 0.43) : between(0.12, 0.24);
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const start = direction.clone().multiplyScalar(0.035).setY(-0.48);
      const end = direction.clone().multiplyScalar(radius).setY(top);
      const middle = start.clone().lerp(end, 0.48).addScaledVector(direction, -0.025);
      stem([start, middle, end], between(0.01, 0.014));
      foliage(middle, end, angle, distant ? 2 : 4, distant ? 1.7 : 1.35);
      for (let twig = 0; twig < 2; twig++) {
        const origin = start.clone().lerp(end, twig ? 0.69 : 0.48);
        const forkAngle = angle + (twig ? -1 : 1) * between(0.55, 1.1);
        const tip = origin.clone().add(new THREE.Vector3(Math.cos(forkAngle) * 0.15,
          between(0.17, 0.24), Math.sin(forkAngle) * 0.15));
        stem([origin, tip], 0.0055);
        foliage(origin, tip, forkAngle, distant ? 2 : 3, distant ? 1.7 : twig ? 1.3 : 1.4);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    const size = new THREE.Vector3(), center = new THREE.Vector3();
    geometry.boundingBox.getSize(size); geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = `Coastal shrub / ${distant ? 24 : 60} folded leaves / ${indices.length / 3} triangles`;
    return geometry;
  }
  const groundGeometry = plantGeometry();
  const rooftopGeometry = plantGeometry(true);
  return function shrub(x, y, z, w = 1, h = 0.7, d = 1) {
    const yaw = typeof range === 'function' ? range(0, Math.PI * 2) : (random?.() ?? 0) * Math.PI * 2;
    // Raised roof beds stay far from the street camera; use their cheaper mesh.
    const geometry = y > 4 ? rooftopGeometry : groundGeometry;
    instance(geometry, material, [x, y, z], [w, h, d], [0, yaw, 0], true);
  };
}
