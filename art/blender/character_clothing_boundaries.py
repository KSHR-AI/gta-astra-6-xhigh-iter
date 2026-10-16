#!/usr/bin/env python3
"""Extract reproducible shirt trim guides from the original civilian GLBs.

Requires NumPy and Pillow. Run from any directory:
    python3 art/blender/character_clothing_boundaries.py [output_directory]

Default output: /tmp/astra-clothing-stage. Source assets are read-only.
Each ordered anchor preserves its exact source position, normal, UV and four
skin influences. ``position`` is mesh-local; ``bindWorldPosition`` uses the
documented per-model bind-world units. These are surface/color seam guides,
not open garment holes in the position-welded body.
"""

import collections
import io
import json
from pathlib import Path
import struct
import sys

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DTYPES = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quaternion_matrix(values):
    x, y, z, w = np.asarray(values, dtype=float) / np.linalg.norm(values)
    return np.array([
        [1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
        [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
        [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)],
    ])


class Source:
    def __init__(self, path):
        self.path = Path(path)
        raw = self.path.read_bytes()
        if raw[:4] != b'glTF':
            raise ValueError(f'Not a GLB: {path}')
        json_length = struct.unpack_from('<I', raw, 12)[0]
        self.json = json.loads(raw[20:20 + json_length])
        self.binary = raw[28 + json_length:]
        self.node_index = next(i for i, node in enumerate(self.json['nodes']) if 'skin' in node)
        self.node = self.json['nodes'][self.node_index]
        self.skin = self.json['skins'][self.node['skin']]
        primitives = self.json['meshes'][self.node['mesh']]['primitives']
        if len(primitives) != 1:
            raise ValueError('Expected the original single-material civilian body')
        self.primitive = primitives[0]
        self.attributes = {name: self.accessor(index) for name, index in self.primitive['attributes'].items()}
        self.positions = self.attributes['POSITION']
        self.triangles = (self.accessor(self.primitive['indices']).reshape(-1, 3)
                          if 'indices' in self.primitive else np.arange(len(self.positions)).reshape(-1, 3))
        self.bone_names = [self.json['nodes'][index]['name'] for index in self.skin['joints']]
        parents = {child: parent for parent, node in enumerate(self.json['nodes']) for child in node.get('children', [])}
        worlds = {}

        def world(index):
            if index in worlds:
                return worlds[index]
            node = self.json['nodes'][index]
            if 'matrix' in node:
                local = np.asarray(node['matrix']).reshape(4, 4, order='F')
            else:
                local = np.eye(4)
                local[:3, :3] = quaternion_matrix(node.get('rotation', [0, 0, 0, 1])) @ np.diag(node.get('scale', [1, 1, 1]))
                local[:3, 3] = node.get('translation', [0, 0, 0])
            worlds[index] = world(parents[index]) @ local if index in parents else local
            return worlds[index]

        inverse_bind = self.accessor(self.skin['inverseBindMatrices'])[0].reshape(4, 4, order='F')
        self.bind = world(self.skin['joints'][0]) @ inverse_bind
        self.world_positions = self.positions @ self.bind[:3, :3].T + self.bind[:3, 3]
        _, self.representative, self.welded = np.unique(
            np.round(self.positions / 1e-6).astype('i8'), axis=0, return_index=True, return_inverse=True)
        self.points = self.world_positions[self.representative]
        self.faces = self.welded[self.triangles]
        self.edge_faces = collections.defaultdict(list)
        for face_id, (a, b, c) in enumerate(self.faces):
            for aa, bb in ((a, b), (b, c), (c, a)):
                if aa != bb:
                    self.edge_faces[tuple(sorted((int(aa), int(bb))))].append(face_id)

    def accessor(self, index):
        accessor = self.json['accessors'][index]
        view = self.json['bufferViews'][accessor['bufferView']]
        dtype = np.dtype(DTYPES[accessor['componentType']])
        width = WIDTHS[accessor['type']]
        array = np.ndarray((accessor['count'], width), dtype=dtype, buffer=self.binary,
                           offset=view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                           strides=(view.get('byteStride', dtype.itemsize * width), dtype.itemsize)).copy()
        if accessor.get('normalized') and dtype.kind in 'iu':
            array = array.astype(float) / np.iinfo(dtype).max
            if dtype.kind == 'i':
                array = np.maximum(array, -1)
        return array

    def face_colors(self, bilinear=True):
        material = self.json['materials'][self.primitive['material']]
        texture_index = material['pbrMetallicRoughness']['baseColorTexture']['index']
        image_index = self.json['textures'][texture_index]['source']
        view = self.json['bufferViews'][self.json['images'][image_index]['bufferView']]
        start = view.get('byteOffset', 0)
        image = np.asarray(Image.open(io.BytesIO(self.binary[start:start + view['byteLength']])).convert('RGB'))
        uv = self.attributes['TEXCOORD_0'][self.triangles].mean(axis=1)
        if not bilinear:
            x = np.minimum((uv[:, 0] % 1 * image.shape[1]).astype(int), image.shape[1] - 1)
            y = np.minimum((uv[:, 1] % 1 * image.shape[0]).astype(int), image.shape[0] - 1)
            return image[y, x]
        x = np.clip(uv[:, 0] * image.shape[1] - .5, 0, image.shape[1] - 1)
        y = np.clip(uv[:, 1] * image.shape[0] - .5, 0, image.shape[0] - 1)
        ix, iy = x.astype(int), y.astype(int)
        fx, fy = (x - ix)[:, None], (y - iy)[:, None]
        nx, ny = np.minimum(ix + 1, image.shape[1] - 1), np.minimum(iy + 1, image.shape[0] - 1)
        return ((image[iy, ix] * (1 - fx) + image[iy, nx] * fx) * (1 - fy)
                + (image[ny, ix] * (1 - fx) + image[ny, nx] * fx) * fy)

    def seam_components(self, clothing, region=lambda _points: True):
        cloth_vertex = {}
        for face_id in np.flatnonzero(clothing):
            for local, vertex in enumerate(self.faces[face_id]):
                cloth_vertex[int(vertex)] = int(self.triangles[face_id, local])
        adjacent = collections.defaultdict(set)
        open_edges = 0
        for (a, b), face_ids in self.edge_faces.items():
            if not region(self.points[[a, b]]):
                continue
            if len(face_ids) == 1:
                open_edges += 1
            if len(face_ids) == 2 and clothing[face_ids[0]] != clothing[face_ids[1]]:
                adjacent[a].add(b)
                adjacent[b].add(a)
        visited, components = set(), []
        for seed in sorted(adjacent):
            if seed in visited:
                continue
            pending, group = [seed], []
            while pending:
                vertex = pending.pop()
                if vertex in visited:
                    continue
                visited.add(vertex)
                group.append(vertex)
                pending.extend(sorted(adjacent[vertex] - visited, reverse=True))
            closed = all(len(adjacent[vertex]) == 2 for vertex in group)
            if closed:
                order, previous, current = [], None, min(group)
                while current not in order:
                    order.append(current)
                    following = next(vertex for vertex in sorted(adjacent[current]) if vertex != previous)
                    previous, current = current, following
                if current != order[0] or len(order) != len(group):
                    raise ValueError('Unexpected non-simple seam loop')
                group = order
            components.append((group, closed))
        return components, cloth_vertex, open_edges

    def loop_record(self, vertices, closed, cloth_vertex, meters_per_unit):
        points = self.points[vertices]
        anchors = []
        for vertex in vertices:
            index = cloth_vertex[vertex]
            anchors.append({
                'sourceVertexIndex': index,
                'position': self.positions[index].tolist(),
                'bindWorldPosition': self.world_positions[index].tolist(),
                'normal': self.attributes['NORMAL'][index].tolist(),
                'uv': self.attributes['TEXCOORD_0'][index].tolist(),
                'skinIndices': self.attributes['JOINTS_0'][index].tolist(),
                'skinWeights': self.attributes['WEIGHTS_0'][index].tolist(),
            })
        result = {'closed': closed, 'vertexCount': len(vertices), 'min': points.min(axis=0).tolist(),
                  'max': points.max(axis=0).tolist(), 'center': points.mean(axis=0).tolist(), 'anchors': anchors}
        if closed:
            result['lengthM'] = float(np.linalg.norm(points - np.roll(points, 1, axis=0), axis=1).sum() * meters_per_unit)
        means = collections.defaultdict(float)
        for anchor in anchors:
            for joint, weight in zip(anchor['skinIndices'], anchor['skinWeights']):
                if weight > .001:
                    means[self.bone_names[joint]] += weight / len(anchors)
        result['meanBoneWeights'] = dict(means)
        return result

    def summary(self, units):
        return {'source': str(self.path.relative_to(ROOT)), 'bindWorldUnits': units,
                'positionSpace': 'mesh-local; use bindWorldPosition for the documented bind-world units',
                'up': '+Y', 'front': '+Z', 'characterLeft': '+X',
                'bindWorldFromMeshColumnMajor': self.bind.flatten(order='F').tolist(),
                'sourceVertexCount': len(self.positions), 'sourceTriangleCount': len(self.triangles),
                'weldedVertexCount': len(self.representative),
                'weldedOpenBoundaryEdges': sum(len(faces) == 1 for faces in self.edge_faces.values()),
                'boneNamesBySkinIndex': self.bone_names, 'loops': {}}


def extract_male():
    source = Source(ROOT / 'public/models/CivilianMale.glb')
    colors = source.face_colors(bilinear=False)
    centers = source.world_positions[source.triangles].mean(axis=1)
    saturation = (colors.max(axis=1) - colors.min(axis=1)) / np.maximum(colors.max(axis=1), 1)
    clothing = (saturation < .16) & (colors.mean(axis=1) > 45) & (centers[:, 1] > 0) & (centers[:, 1] < 80)
    components, anchors, _ = source.seam_components(clothing)
    result = source.summary('centimeters')
    result['hemCandidates'] = []
    for vertices, closed in components:
        loop = source.loop_record(vertices, closed, anchors, .01)
        center = loop['center']
        if center[1] < 30:
            result['hemCandidates'].append(loop)
            continue
        name = 'collar' if center[1] > 60 else 'leftCuff' if center[0] > 0 else 'rightCuff'
        if not closed or name in result['loops']:
            raise ValueError(f'Male {name} no longer forms a simple closed guide')
        result['loops'][name] = loop
    if set(result['loops']) != {'collar', 'leftCuff', 'rightCuff'}:
        raise ValueError('Expected male collar and two short-sleeve cuffs')
    if result['weldedOpenBoundaryEdges'] != 0:
        raise ValueError('Original male body was expected to be a closed manifold')
    result['notes'] = [
        'Ordered loops follow mesh edges separating sampled gray shirt faces from adjacent skin; they are construction guides, not pixel-exact texture contours.',
        'The male body is closed after position welding. There are no detachable/open shirt boundaries.',
        'Hem candidates include branches and tiny painted islands. They are deliberately not advertised as an ordered trim loop.',
        'Original collar reaches bind-world y73.09 cm; the natural-head graft cuts at y70 cm. Bound authored collar geometry below the graft cut.',
        'Preserve the per-anchor skin mixture; collar weights span Spine2, Neck, Head and shoulders.',
    ]
    return result


def extract_female():
    source = Source(ROOT / 'public/models/Michelle-crowd.glb')
    colors = source.face_colors()
    # Gray/cyan fabric has a much larger B/R ratio than neighboring brown skin.
    clothing = colors[:, 2] > .65 * colors[:, 0]
    region = lambda points: points[:, 1].min() >= 1.075 and points[:, 1].max() <= 1.335 and np.abs(points[:, 0]).max() <= .15
    components, anchors, torso_open_edges = source.seam_components(clothing, region)
    result = source.summary('meters')
    result['weldedTorsoOpenBoundaryEdges'] = torso_open_edges
    for vertices, closed in components:
        loop = source.loop_record(vertices, closed, anchors, 1)
        center = loop['center']
        name = 'hem' if center[1] < 1.2 else 'collar' if abs(center[0]) < .02 else 'rightArmhole' if center[0] < 0 else 'leftArmhole'
        if not closed or name in result['loops']:
            raise ValueError(f'Female {name} no longer forms a simple closed guide')
        result['loops'][name] = loop
    if set(result['loops']) != {'collar', 'leftArmhole', 'rightArmhole', 'hem'}:
        raise ValueError('Expected four female shirt openings')
    if torso_open_edges:
        raise ValueError('Expected no open edges in the position-welded female torso')
    result['notes'] = [
        'The garment is sleeveless: use armhole trim, not short-sleeve cuffs.',
        'These are exact coincident-position UV/normal/color seam loops within a continuous welded body surface.',
        'Source POSITION and visible skinned bind-world coordinates coincide within approximately 0.7 micrometers.',
        'Skin weights agree across coincident seam vertices, but normals split sharply. Copy clothing-side influences and construct new trim normals.',
    ]
    return result


def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/astra-clothing-stage').resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'male': extract_male(), 'female': extract_female()}
    for name, model in result.items():
        labels = {'leftCuff': 'left-cuff', 'rightCuff': 'right-cuff',
                  'leftArmhole': 'left-armhole', 'rightArmhole': 'right-armhole'}
        # Stable input contract for character_clothing.py, while retaining the
        # full source-space measurements and exact clothing-side attributes.
        model['shirtBoundaryLoops'] = [{
            **loop, 'label': labels.get(label, label), 'vertices': loop['vertexCount'],
            'originalVertexIndices': [anchor['sourceVertexIndex'] for anchor in loop['anchors']],
            'clothSideAnchors': loop['anchors'],
        } for label, loop in model['loops'].items()]
        if name == 'female':
            model['namedClothingLoops'] = {
                label: {**loop, 'clothSideAnchors': loop['anchors']}
                for label, loop in model['loops'].items()
            }
        (output / f'{name}-clothing-boundaries.json').write_text(json.dumps(model, indent=2) + '\n')
        (output / f'{name}-clothing-boundary-report.json').write_text(json.dumps(model, indent=2) + '\n')
    (output / 'clothing-boundary-report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'outputDirectory': str(output), 'loops': {
        name: {key: value['vertexCount'] for key, value in model['loops'].items()}
        for name, model in result.items()
    }}, indent=2))


if __name__ == '__main__':
    main()
