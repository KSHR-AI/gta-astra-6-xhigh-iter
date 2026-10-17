"""Extend exposed male upper-arm skin beneath a shorter authored sleeve.

Uses only NumPy and the original Source attributes/triangles. Coordinates passed
as ``target_points_world`` and ``bind`` use the male source's centimetres. The
original source file is never edited; the caller can supply the explicitly
refitted upper-arm boundary from fit_upper_arm_boundary. Each old cuff edge borrows its own adjacent
skin triangle's UVs, so unrelated atlas islands cannot be joined by a new face.
"""
import collections
import numpy as np

CUFF_SKIN_FACES = {
    # Skin-side faces sharing the original ordered cuff edges. Source indices
    # are guarded by the source SHA below, not inferred from painted color.
    "left": (145, 178, 312, 663, 731, 788, 1150, 1179, 1518, 1554, 1571, 2253,
             2265, 2541, 2642, 2663, 3143, 3310, 5258, 7166, 7869, 7986, 8257, 8604),
    "right": (199, 415, 667, 688, 1419, 1472, 1476, 1663, 1678, 2063, 2735, 3123,
              3130, 3187, 3707, 3894, 3918, 4242, 4247, 4537, 4737, 5096, 7414,
              8053, 8086, 8570),
}


def fit_upper_arm_boundary(source, contours, replaced_faces):
    """Remove the source cuff's cloth-shaped ripples from newly exposed skin.

    Only the upper-arm band above the elbow changes. Original forearm/hand
    vertices, skin weights and UVs remain exact. Return the source face IDs
    which must be replaced by these authored samples in the final assembly.
    """
    before = source.world_positions.copy()
    world = before.copy()
    joints, weights = source.attributes['JOINTS_0'], source.attributes['WEIGHTS_0']
    affected = np.zeros(len(world), dtype=bool)
    for data in contours:
        shoulder, axis, front, lateral, center, cuff_t, ids, arm, forearm, lower_ring = data
        rel = before-shoulder
        t = rel@axis
        radial = rel-t[:, None]*axis-center
        theta = np.arctan2(radial@front, radial@lateral)
        arm_weight = (weights*(joints == arm)).sum(axis=1)
        forearm_weight = (weights*(joints == forearm)).sum(axis=1)
        band = (t > cuff_t-3.1)&(t < cuff_t+4.0)&(arm_weight > .65)&(forearm_weight < .35)
        blend = np.clip((cuff_t+4.0-t)/3.5, 0, 1)
        blend = blend*blend*(3-2*blend)
        target = shoulder+t[:, None]*axis+center+np.cos(theta)[:, None]*lateral*4.95+np.sin(theta)[:, None]*front*5.10
        world[band] += (target[band]-world[band])*blend[band, None]
        ring_alias = np.isin(source.welded, source.welded[ids])
        # The painted source cuff follows a zigzag rather than an anatomical
        # section. Smooth only that boundary; lower sections retain their t.
        for source_id,point in zip(ids,lower_ring):
            world[source.welded==source.welded[source_id]]=point
        affected |= band|ring_alias
    changed = np.linalg.norm(world-before, axis=1) > 1e-6
    cloth = np.zeros(len(source.triangles), dtype=bool)
    cloth[np.asarray(replaced_faces, dtype=int)] = True
    faces = np.flatnonzero(changed[source.triangles].any(axis=1)&~cloth)
    # Smooth skin normals across UV aliases. Removed old fabric must not
    # influence these normals at the newly exposed cuff boundary.
    sums = np.zeros((len(source.representative), 3))
    for face, tri in enumerate(source.triangles):
        if cloth[face]:
            continue
        n = np.cross(world[tri[1]]-world[tri[0]], world[tri[2]]-world[tri[0]])
        np.add.at(sums, source.welded[tri], n)
    normal_ids = np.flatnonzero(changed)
    normals = sums[source.welded[normal_ids]]
    normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
    normals = normals@source.bind[:3, :3]
    normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
    source.attributes['NORMAL'][normal_ids] = normals
    inverse = np.linalg.inv(source.bind)
    source.attributes['POSITION'][changed] = (world[changed]-source.bind[:3, 3])@inverse[:3, :3].T
    source.positions = source.attributes['POSITION']
    source.world_positions = world
    return faces, {
        'sourceVertexIds': np.flatnonzero(changed).tolist(),
        'sourceFaceIds': faces.tolist(),
        'maximumDisplacementCm': float(np.linalg.norm(world-before, axis=1).max()),
        'scope': 'Upper-arm cuff band only; original forearm, hands, UVs and skin influences unchanged',
    }


def _unit(vector):
    length = np.linalg.norm(vector)
    if length < 1e-12:
        raise ValueError('Sleeve extension requires a nonzero direction')
    return vector / length


def _blend_influences(joints_a, weights_a, joints_b, weights_b, amount):
    if amount == 0:
        return joints_a.copy(), weights_a.copy()
    if amount == 1:
        return joints_b.copy(), weights_b.copy()
    combined = collections.defaultdict(float)
    for joints, weights, factor in ((joints_a, weights_a, 1-amount),
                                    (joints_b, weights_b, amount)):
        for joint, weight in zip(joints, weights):
            combined[int(joint)] += max(0., float(weight)) * factor
    selected = sorted(combined.items(), key=lambda item: (-item[1], item[0]))[:4]
    selected += [(0, 0.)] * (4-len(selected))
    joints = np.array([joint for joint, _ in selected], dtype=joints_a.dtype)
    weights = np.array([weight for _, weight in selected], dtype=np.float64)
    weights /= weights.sum()
    return joints, weights


def _skin_uv_patch(uv, mask):
    """Largest square of actual skin texels inside one original UV triangle."""
    height, width = mask.shape[:2]
    triangle = uv * [width, height]
    lower = np.maximum(0, np.floor(triangle.min(axis=0)).astype(int))
    upper = np.minimum([width-1, height-1], np.ceil(triangle.max(axis=0)).astype(int))
    if (upper < lower).any():
        return None
    xx, yy = np.meshgrid(np.arange(lower[0], upper[0]+1)+.5,
                         np.arange(lower[1], upper[1]+1)+.5)
    a, b = triangle[1]-triangle[0], triangle[2]-triangle[0]
    orientation = a[0]*b[1]-a[1]*b[0]
    if abs(orientation) < 1e-12:
        return None
    inside = np.ones(xx.shape, dtype=bool)
    for i in range(3):
        p, q = triangle[i], triangle[(i+1) % 3]
        inside &= ((q[0]-p[0])*(yy-p[1])-(q[1]-p[1])*(xx-p[0]))*np.sign(orientation) > 1e-7
    pixels = mask[lower[1]:upper[1]+1, lower[0]:upper[0]+1]
    factor = 255. if np.max(pixels) > 1. else 1.
    safe = inside & (pixels[:,:,0] < .01*factor) & (pixels[:,:,2] > .99*factor)
    # A square gives a continuous UV domain whose bilinear taps all stay on
    # real skin. Reserve 0.75 texel inside its center bounds on every side.
    dp = np.zeros((safe.shape[0]+1, safe.shape[1]+1), dtype=np.int32)
    best = (0, 0, 0)
    for row, column in zip(*np.where(safe)):
        value = 1+min(dp[row,column], dp[row,column+1], dp[row+1,column])
        dp[row+1,column+1] = value
        if value > best[0]:
            best = (int(value), int(row), int(column))
    size, row, column = best
    if size < 3:
        return None
    start = lower + [column-size+1, row-size+1]
    return (start+1.25)/[width,height], (start+size-1.25)/[width,height], size


def extend_sleeve_skin(source, cuff_source_ids, target_points_world, bind,
                       replaced_face_ids=None, skin_uv_mask=None, skin_uv_bounds=None):
    """Return ``(attributes, faces, report)`` for a new six-ring skin bridge.

    ``cuff_source_ids`` are an ordered closed original cuff contour, without a
    repeated closing vertex. Target points correspond one-for-one to those
    vertices and mark the new skin/cuff contact. The last ring extends another
    0.3 source centimetres toward the shoulder to remain under the new cloth.
    ``replaced_face_ids`` identifies original shirt faces, allowing exact
    skin-side selection. Without it the adjacent face continuing down the arm
    is selected geometrically. No source raster image is decoded. Optional ``skin_uv_mask`` is the
    caller-decoded, top-down packed RGB(A) mask (R=shirt, B=skin); it enables
    a certified pure-skin bilinear UV patch within original source triangles.
    """
    attrs = source.attributes
    positions = np.asarray(attrs['POSITION'])
    triangles = np.asarray(source.triangles, dtype=np.int64).reshape(-1, 3)
    ids = np.asarray(cuff_source_ids, dtype=np.int64)
    target = np.asarray(target_points_world, dtype=np.float64)
    matrix = np.asarray(bind, dtype=np.float64)
    if matrix.shape != (4, 4):
        raise ValueError('bind must be a row-major 4x4 matrix')
    if len(ids) < 3 or len(set(ids.tolist())) != len(ids):
        raise ValueError('Cuff must be an ordered, unique closed contour')
    if target.shape != (len(ids), 3) or not np.isfinite(target).all():
        raise ValueError('Target skin ring must match the cuff source IDs')
    if (ids < 0).any() or (ids >= len(positions)).any():
        raise ValueError('Cuff source vertex is out of bounds')
    world = positions @ matrix[:3, :3].T + matrix[:3, 3]
    lower = world[ids]
    direction = _unit(target.mean(axis=0)-lower.mean(axis=0))
    top = target + direction * .3
    inverse = np.linalg.inv(matrix)
    normal_to_world = np.linalg.inv(matrix[:3, :3])

    # Position aliases include the different UVs/normals on each side of the
    # original cloth/skin boundary. Never guess the skin UV from a cloth alias.
    _, welded = np.unique(np.round(positions / 1e-6).astype(np.int64),
                          axis=0, return_inverse=True)
    welded_triangles = welded[triangles]
    adjacent = collections.defaultdict(list)
    for face, tri in enumerate(welded_triangles):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            adjacent[tuple(sorted((int(a), int(b))))].append(face)
    replaced = None if replaced_face_ids is None else set(map(int, replaced_face_ids))
    if replaced is not None and any(i < 0 or i >= len(triangles) for i in replaced):
        raise ValueError('A replaced shirt face ID is out of bounds')

    values = {key: [] for key in ['POSITION', 'NORMAL', 'TEXCOORD_0',
                                 'JOINTS_0', 'WEIGHTS_0', 'COLOR_0', '_GARMENT_MASK']}
    faces, skin_faces, lower_vertex_ids, source_normal = [], [], [], []
    uv_patch_faces, uv_patch_sizes = [], []
    if skin_uv_mask is not None:
        skin_uv_mask = np.asarray(skin_uv_mask)
        if skin_uv_mask.ndim != 3 or skin_uv_mask.shape[2] < 3:
            raise ValueError("skin_uv_mask must be top-down RGB or RGBA")
    world_vertices, smooth_keys = [], []
    rings = 6
    maximum_source_alias_gap = 0.
    for edge, source_a in enumerate(ids):
        next_edge = (edge+1) % len(ids)
        source_b = ids[next_edge]
        wa, wb = int(welded[source_a]), int(welded[source_b])
        candidates = adjacent.get(tuple(sorted((wa, wb))), [])
        if replaced is not None:
            candidates = [face for face in candidates if face not in replaced]
        if not candidates:
            raise ValueError(f'No original skin-side triangle for cuff edge {edge}')
        midpoint = (lower[edge]+lower[next_edge])*.5
        skin_face = min(candidates, key=lambda face:
                        float((world[triangles[face]].mean(axis=0)-midpoint) @ direction))
        skin_faces.append(int(skin_face))
        tri = triangles[skin_face]
        ia = int(tri[np.flatnonzero(welded[tri] == wa)[0]])
        ib = int(tri[np.flatnonzero(welded[tri] == wb)[0]])
        maximum_source_alias_gap = max(maximum_source_alias_gap,
            float(np.linalg.norm(world[ia]-lower[edge])),
            float(np.linalg.norm(world[ib]-lower[next_edge])))
        uv_a, uv_b = attrs['TEXCOORD_0'][[ia, ib]].astype(np.float64)
        uv_center = attrs['TEXCOORD_0'][tri].mean(axis=0)
        uv_delta, uv_inward = uv_b-uv_a, uv_center-uv_a
        uv_cross = uv_delta[0]*uv_inward[1]-uv_delta[1]*uv_inward[0]
        if abs(float(uv_cross)) < 1e-12:
            raise ValueError(f'Skin triangle {skin_face} has a collapsed UV edge')
        patch = None
        if skin_uv_mask is not None and skin_uv_bounds is None:
            # Some original cuff-adjacent faces straddle the painted cloth/skin
            # transition. Search adjacent non-shirt skin only when that face
            # lacks enough pure skin pixels; geometry/weights still use ia/ib.
            pending, visited = [(skin_face, 0)], set()
            for candidate, depth in pending:
                if candidate in visited:
                    continue
                visited.add(candidate)
                patch = _skin_uv_patch(attrs['TEXCOORD_0'][triangles[candidate]], skin_uv_mask)
                if patch is not None:
                    uv_patch_faces.append(int(candidate))
                    uv_patch_sizes.append(int(patch[2]))
                    break
                if depth >= 5:
                    continue
                ct = welded_triangles[candidate]
                for aa, bb in ((ct[0],ct[1]), (ct[1],ct[2]), (ct[2],ct[0])):
                    for neighbor in adjacent[tuple(sorted((int(aa),int(bb))))]:
                        if neighbor not in visited and (replaced is None or neighbor not in replaced):
                            # Stay on the exposed arm side of the cuff.
                            if (world[triangles[neighbor]].mean(axis=0)-midpoint) @ direction < 1.:
                                pending.append((neighbor, depth+1))
            if patch is None:
                raise ValueError(f'No pure original skin UV patch near cuff edge {edge}')
        base = len(world_vertices)
        for ring in range(rings):
            t = ring/(rings-1)
            for column, u in enumerate((0., .5, 1.)):
                start = lower[edge]*(1-u)+lower[next_edge]*u
                end = top[edge]*(1-u)+top[next_edge]*u
                point = start*(1-t)+end*t
                local = (point-matrix[:3, 3]) @ inverse[:3, :3].T
                if ring == 0:
                    # Exact original endpoints; midpoint lies on the same old
                    # skin edge and matches the garment's edge subdivision.
                    local = positions[ia]*(1-u)+positions[ib]*u
                normal = attrs['NORMAL'][ia]*(1-u)+attrs['NORMAL'][ib]*u
                if u == .5:
                    normal = _unit(normal)
                uv_edge = uv_a*(1-u)+uv_b*u
                # A trapezoid strictly inside the matching skin triangle; all
                # longitudinal rows have different UVs and positive UV area.
                uv = (uv_edge*(1-.70*t)+uv_center*(.70*t) if patch is None
                      else patch[0]+(patch[1]-patch[0])*[u,t])
                if skin_uv_bounds is not None:
                    lower_uv=np.asarray(skin_uv_bounds[:2]);upper_uv=np.asarray(skin_uv_bounds[2:])
                    uv=lower_uv+(upper_uv-lower_uv)*[(edge+u)/len(ids),t]
                joints, weights = _blend_influences(
                    attrs['JOINTS_0'][ia], attrs['WEIGHTS_0'][ia],
                    attrs['JOINTS_0'][ib], attrs['WEIGHTS_0'][ib], u)
                values['POSITION'].append(local)
                values['NORMAL'].append(normal)
                values['TEXCOORD_0'].append(uv)
                values['JOINTS_0'].append(joints)
                values['WEIGHTS_0'].append(weights)
                values['COLOR_0'].append([1., 1., 1., 1.])
                values['_GARMENT_MASK'].append([0.])
                world_vertices.append(point)
                source_normal.append(_unit(normal @ normal_to_world))
                smooth_keys.append((ring, (2*edge+column) % (2*len(ids))))
                if ring == 0:
                    lower_vertex_ids.append(len(world_vertices)-1)
        for ring in range(rings-1):
            for column in range(2):
                a = base+ring*3+column
                b, c, d = a+1, a+3, a+4
                faces.extend([(a, b, c), (b, d, c)])

    world_vertices = np.asarray(world_vertices)
    source_normal = np.asarray(source_normal)
    faces = np.asarray(faces, dtype=np.int64)
    face_normals = np.cross(world_vertices[faces[:,1]]-world_vertices[faces[:,0]],
                            world_vertices[faces[:,2]]-world_vertices[faces[:,0]])
    area = np.linalg.norm(face_normals, axis=1)
    if (area < 1e-9).any():
        raise ValueError('Sleeve skin bridge contains a collapsed triangle')
    flip = np.einsum('ij,ij->i', face_normals, source_normal[faces].mean(axis=1)) < 0
    faces[flip] = faces[flip][:, [0,2,1]]
    face_normals[flip] *= -1
    # Smooth across strip UV duplicates. Preserve all old lower skin normals.
    sums = collections.defaultdict(lambda: np.zeros(3, dtype=np.float64))
    for tri, normal in zip(faces, face_normals):
        for vertex in tri:
            sums[smooth_keys[vertex]] += normal
    for index, (ring, _) in enumerate(smooth_keys):
        if ring:
            world_normal = _unit(sums[smooth_keys[index]])
            values['NORMAL'][index] = _unit(world_normal @ matrix[:3, :3])
    result = {key: np.asarray(value, dtype=attrs['JOINTS_0'].dtype if key == 'JOINTS_0'
                             else np.float32) for key, value in values.items()}
    if not all(np.isfinite(array).all() for array in result.values()):
        raise ValueError('Nonfinite sleeve skin attribute')
    weights = result['WEIGHTS_0']
    if (weights < 0).any() or np.max(abs(weights.sum(axis=1)-1)) > 1e-6:
        raise ValueError('Invalid sleeve skin influences')
    local_world = result['POSITION'] @ matrix[:3, :3].T + matrix[:3, 3]
    lower_error = np.linalg.norm(local_world[lower_vertex_ids]-world_vertices[lower_vertex_ids], axis=1)
    uv = result['TEXCOORD_0'][faces]
    uv_area = abs((uv[:,1,0]-uv[:,0,0])*(uv[:,2,1]-uv[:,0,1])
                  -(uv[:,1,1]-uv[:,0,1])*(uv[:,2,0]-uv[:,0,0]))
    if (uv_area < 1e-12).any():
        raise ValueError('Sleeve skin bridge has degenerate UV triangles')
    report = {
        'authored': True, 'source': 'Original skin influences with an authored upper-arm boundary and padded source-colored skin island',
        'sourceCuffVertices': len(ids), 'longitudinalRings': rings,
        'midpointSplitEdges': True, 'vertices': len(world_vertices), 'triangles': len(faces),
        'skinSourceTriangleIds': skin_faces,
        'skinSideSelection': 'complement of replaced shirt faces' if replaced is not None
                             else 'adjacent triangle continuing down the arm',
        'maximumSourcePositionAliasGapCm': maximum_source_alias_gap,
        'maximumLowerSeamPositionErrorCm': float(lower_error.max()),
        'maximumWeightSumError': float(abs(weights.sum(axis=1)-1).max()),
        'minimumTriangleAreaCm2': float(area.min()*.5),
        'minimumUvTriangleArea': float(uv_area.min()*.5),
        'upperOverlapCm': .3,
        'newCuffCenterShiftCm': float(np.linalg.norm(target.mean(axis=0)-lower.mean(axis=0))),
        'suppliedBoundaryEndpointsAndInfluencesPreserved': True,
        'uvPolicy': ('Broad padded same-arm skin island with continuous circumference UVs' if skin_uv_bounds is not None else
                    'Each strip uses a bilinear-safe square inside an original connected skin triangle'
                     if skin_uv_mask is not None else
                     'Each midpoint-split edge stays within its adjacent original skin triangle'),
        'skinUvBounds':skin_uv_bounds,
        'uvCertifiedByPackedSkinMask': skin_uv_mask is not None,
        'uvSourceTriangleIds': uv_patch_faces,
        'minimumPureSkinPatchPixels': min(uv_patch_sizes) if uv_patch_sizes else None,
        'originalSourceFileModified': False,
    }
    return result, faces, report
