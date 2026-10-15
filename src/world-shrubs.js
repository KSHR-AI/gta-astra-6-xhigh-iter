import * as THREE from 'three';

// Eight curved leafy branches share a single mesh and alpha-tested atlas.
// The returned helper uses centre coordinates and full width/height/depth.
export function createShrubBuilder({ instance, canvasTexture, random, range }) {
  const texture = canvasTexture(1024, 1024, (ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const palettes = [
      ['#81965a', '#526f3e', '#a1ad70'],
      ['#78965a', '#466b40', '#a4b87c'],
      ['#8b9d62', '#5b773f', '#b0b77b'],
      ['#739064', '#456e48', '#9caf79'],
    ];
    for (let tile = 0; tile < 4; tile++) {
      ctx.save(); ctx.translate((tile % 2) * 512, Math.floor(tile / 2) * 512);
      const colors = palettes[tile];
      const leaf = (x, y, length, breadth, angle, shade = 1) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
        const fill = ctx.createLinearGradient(0, -breadth * 0.45, length * 0.85, breadth * 0.5);
        fill.addColorStop(0, colors[1]); fill.addColorStop(0.48, colors[0]); fill.addColorStop(1, colors[2]);
        ctx.globalAlpha = shade; ctx.fillStyle = fill;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(length * 0.28, -breadth * 0.62, length * 0.72, -breadth * 0.45, length, 0);
        ctx.bezierCurveTo(length * 0.64, breadth * 0.53, length * 0.2, breadth * 0.5, 0, 0); ctx.fill();
        ctx.strokeStyle = colors[1]; ctx.lineWidth = 0.65; ctx.stroke();
        ctx.strokeStyle = colors[2]; ctx.globalAlpha *= 0.48; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(length * 0.5, -1, length * 0.94, 0); ctx.stroke();
        ctx.globalAlpha *= 0.58; ctx.lineWidth = 0.6;
        for (let vein = 1; vein <= 4; vein++) {
          const px = length * (0.13 + vein * 0.14), reach = Math.sin((px / length) * Math.PI) * breadth * 0.32;
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px + length * 0.14, -reach);
          ctx.moveTo(px, 0); ctx.lineTo(px + length * 0.12, reach); ctx.stroke();
        }
        ctx.restore();
      };
      ctx.strokeStyle = '#79815a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(251, 489); ctx.bezierCurveTo(242, 325, 272, 194, 254, 50); ctx.stroke();
      // Alternating side stems, each carrying paired broad coastal leaves.
      for (let tier = 0; tier < 5; tier++) {
        for (const side of [-1, 1]) {
          const sy = 408 - tier * 69 + side * 10;
          const reach = [141, 166, 166, 129, 85][tier];
          const ex = 255 + side * reach, ey = sy - 52 - (tile % 2) * 8;
          ctx.strokeStyle = '#7b8457'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(253, sy + 12); ctx.quadraticCurveTo(253 + side * reach * 0.5, sy - 5, ex, ey); ctx.stroke();
          for (let n = 1; n <= 3; n++) {
            const t = n / 3.6, x = 253 + side * reach * t, y = sy + 9 - (sy + 9 - ey) * t;
            const baseAngle = Math.atan2(ey - sy, side * reach);
            const size = 49 + (3 - tier) * 2 + ((n + tile) % 3) * 4;
            leaf(x, y, size, size * 0.53, baseAngle - side * 0.85);
            leaf(x + side * 3, y - 7, size * 0.91, size * 0.48, baseAngle + side * 0.72);
          }
          leaf(ex - side * 8, ey + 3, 49 - tier * 2, 27, Math.atan2(-30, side * 42));
        }
      }
      leaf(254, 84, 57, 32, -Math.PI / 2 + 0.14);
      ctx.restore();
    }
    // Solid texel area for the tiny shaded centre, hidden under the branches.
    ctx.fillStyle = '#637e47'; ctx.fillRect(0, 0, 14, 14);
  });
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: '#ffffff',
    roughness: 0.94,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    vertexColors: true,
  });
  material.name = 'Coastal broadleaf shrub';

  const positions = [], uvs = [], colors = [];
  const push = (p, uv, brightness) => {
    positions.push(...p); uvs.push(...uv);
    colors.push(brightness * 0.95, brightness, brightness * 0.91);
  };
  for (let branch = 0; branch < 8; branch++) {
    const angle = branch * Math.PI * 0.25 + (branch % 2) * 0.18;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const tile = branch % 4, atlasX = (tile % 2) * 0.5, atlasY = 0.5 - Math.floor(tile / 2) * 0.5;
    const branchHeight = branch % 2 ? 0.91 : 1;
    const vertex = (column, row) => {
      const u = column / 2, v = row / 3;
      const lateral = (u - 0.5) * (branch % 2 ? 0.69 : 0.74);
      // Stem rises from a compact centre, bending outward through its canopy.
      const outward = 0.01 + Math.sin(v * Math.PI * 0.6) * 0.2 + lateral * lateral * 0.62;
      const y = -0.47 + v * branchHeight - lateral * lateral * 0.27;
      return [
        [lateral * cos + outward * sin, y, -lateral * sin + outward * cos],
        [atlasX + 0.015 + u * 0.47, atlasY + 0.015 + v * 0.47],
        0.87 + v * 0.13 - (branch % 3) * 0.025,
      ];
    };
    for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++) {
      const a = vertex(column, row), b = vertex(column + 1, row), c = vertex(column, row + 1), d = vertex(column + 1, row + 1);
      for (const point of [a, b, c, b, d, c]) push(...point);
    }
  }
  const core = new THREE.IcosahedronGeometry(1, 0);
  const corePositions = core.attributes.position;
  for (let i = 0; i < corePositions.count; i++) {
    push([corePositions.getX(i) * 0.22, corePositions.getY(i) * 0.22 - 0.06, corePositions.getZ(i) * 0.22], [0.006, 0.994], 0.93);
  }
  core.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  // Normalize the organic mesh once so dimensions mean the actual bush bounds.
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  geometry.boundingBox.getSize(size); geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeBoundingSphere();
  geometry.name = 'Eight curved broadleaf branches / 116 triangles';
  return function shrub(x, y, z, w = 1, h = 0.7, d = 1) {
    const yaw = typeof range === 'function' ? range(0, Math.PI * 2) : (random?.() ?? 0) * Math.PI * 2;
    instance(geometry, material, [x, y, z], [w, h, d], [0, yaw, 0], true);
  };
}
