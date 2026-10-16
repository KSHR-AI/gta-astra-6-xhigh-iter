"""Original, deterministic rest-mesh tailoring for the civilian apparel.

The imported rig, UVs and skin influences remain authoritative. This pass edits
only garment positions and their normals: it reduces the source female trouser
volume and adds modest fabric ease/creased hems to the male clothes. All masks
come from the same authored UV classification used by the texture generator.
"""
import heapq
import numpy as np


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def sample_mask(mask, uv):
    h, w = mask.shape
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return mask[y, x] > .5


def shape_garments(attributes, triangles, bind, inverse_binds, joint_names,
                   sex, shirt_mask, trouser_mask, boundaries):
    """Return edited arrays and auditable source-vertex selections.

    All dimensional parameters below are in bind-world metres, including the
    centimetre source male. Garment boundary positions are pinned before the
    deformation; position-duplicate vertices share one displacement so UV or
    normal seams cannot open into cracks.
    """
    result = {k: v.copy() for k, v in attributes.items()}
    male = sex == 'male'
    unit = 100.0 if male else 1.0
    matrix = np.asarray(bind, dtype=float)
    original = np.asarray(attributes['POSITION'], dtype=float)
    world = (original @ matrix[:3, :3].T + matrix[:3, 3]) / unit
    normals_world = attributes['NORMAL'] @ np.linalg.inv(matrix[:3, :3])
    normals_world /= np.maximum(np.linalg.norm(normals_world, axis=1)[:, None], 1e-12)
    _, representative, group = np.unique(np.round(world / 1e-7).astype('i8'), axis=0,
                                         return_index=True, return_inverse=True)
    points = world[representative]
    faces = group[triangles]
    adjacency = [set() for _ in points]
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            if u != v:
                adjacency[u].add(v)
                adjacency[v].add(u)
    vertex_shirt = sample_mask(shirt_mask, attributes['TEXCOORD_0'])
    vertex_trouser = sample_mask(trouser_mask, attributes['TEXCOORD_0'])
    shirt = np.zeros(len(points), bool)
    trousers = np.zeros(len(points), bool)
    np.logical_or.at(shirt, group, vertex_shirt)
    np.logical_or.at(trousers, group, vertex_trouser)
    # UV island edges often land between occupied texels. Classify triangle
    # interiors as well, so one empty edge texel cannot pin a stray point and
    # leave a spike in an otherwise continuous tailored silhouette.
    face_uv = attributes['TEXCOORD_0'][triangles].mean(axis=1)
    shirt[faces[sample_mask(shirt_mask, face_uv)].reshape(-1)] = True
    trousers[faces[sample_mask(trouser_mask, face_uv)].reshape(-1)] = True
    # Explicit spatial guards keep masked UV gutters away from heads, hands,
    # ankles and shoes. Original cloth/skin contact rings remain fixed below.
    if male:
        shirt &= (points[:, 1] > .22) & (points[:, 1] < .72)
        trousers &= (points[:, 1] > -.88) & (points[:, 1] < .22)
    else:
        shirt &= (points[:, 1] > 1.105) & (points[:, 1] < 1.322)
        trousers &= (points[:, 1] > .2094) & (points[:, 1] < 1.041)

    def boundary_fade(selection, width, extra_seeds=()):
        seeds = set(extra_seeds)
        for i in np.flatnonzero(selection):
            if any(not selection[n] for n in adjacency[i]):
                seeds.add(int(i))
        distance = np.full(len(points), np.inf)
        queue = []
        for i in seeds:
            distance[i] = 0
            heapq.heappush(queue, (0, i))
        while queue:
            d, i = heapq.heappop(queue)
            if d != distance[i] or d > width:
                continue
            for n in adjacency[i]:
                candidate = d + np.linalg.norm(points[n] - points[i])
                if candidate < distance[n]:
                    distance[n] = candidate
                    heapq.heappush(queue, (candidate, n))
        return selection * smoothstep(0, width, distance)

    shirt_seeds = {int(group[i]) for loop in boundaries.get('shirtBoundaryLoops', [])
                   for i in loop['originalVertexIndices']}
    shirt_fade = boundary_fade(shirt, .025, shirt_seeds)
    pants_fade = boundary_fade(trousers, .022)
    changed = points.copy()

    def bone_position(name):
        index = next(i for i, label in enumerate(joint_names) if label.endswith(name))
        inverse = np.asarray(inverse_binds[index]).reshape((4, 4), order='F')
        return (matrix @ np.linalg.inv(inverse))[:3, 3] / unit

    # Calibrated per-leg axes prevent the taper from dragging both legs toward
    # the pelvis or changing the skinning joint centres.
    for side, sign in [('Left', 1), ('Right', -1)]:
        hip, knee, ankle = [bone_position(side + bone) for bone in ('UpLeg', 'Leg', 'Foot')]
        selected = trousers & (points[:, 0] * sign > 0)
        ids = np.flatnonzero(selected)
        p = points[ids]
        if not len(ids):
            continue
        y = p[:, 1]
        axes = np.array([np.interp(y, [ankle[1], knee[1], hip[1]],
                                  [ankle[k], knee[k], hip[k]]) for k in (0, 2)]).T
        radial = p[:, [0, 2]] - axes
        theta = np.arctan2(radial[:, 1], radial[:, 0])
        if male:
            # Existing jeans gain a little ease and low-amplitude compression
            # at knee/hem, rather than looking vacuum-formed around the calves.
            radius = np.maximum(np.linalg.norm(radial, axis=1), 1e-5)
            ease = .0045 + .0025 * np.exp(-((y - knee[1]) / .14) ** 2)
            hem = np.exp(-((y - (ankle[1] + .12)) / .075) ** 2)
            wrinkles = .0028 * np.sin((y - ankle[1]) * 128 + theta * 1.3) * hem
            whisker = .002 * np.sin((y - hip[1]) * 56 + theta * 2.1) * np.exp(-((y - hip[1] + .10) / .11) ** 2)
            # The opposing inside-thigh surfaces converge at the crotch.
            # Preserve that narrow join rather than offsetting both sides into
            # one another; outer legs retain the full fabric-ease change.
            crotch_clearance = 1 - (1 - smoothstep(.025, .075, np.abs(p[:, 0]))) * smoothstep(-.18, -.08, y)
            delta = radial / radius[:, None] * ((ease + wrinkles + whisker) * crotch_clearance)[:, None]
        else:
            # The source was a balloon-cut jogger. Keep its exact cuff and
            # waistband joins, but tailor continuous tapered denim between them.
            profile_y = [.215, .245, .283, .35, .45, .58, .70, .82, .92, 1.04]
            scale_x = np.interp(y, profile_y, [1, 1, .60, .54, .66, .76, .85, .95, 1, 1])
            scale_z = np.interp(y, profile_y, [1, 1, .62, .57, .69, .79, .87, .95, 1, 1])
            target = radial * np.column_stack([scale_x, scale_z])
            radius = np.maximum(np.linalg.norm(target, axis=1), 1e-5)
            knee_fold = .0018 * np.sin((y - knee[1]) * 62 + theta * 1.4) * np.exp(-((y - knee[1]) / .10) ** 2)
            hem_fold = .0014 * np.sin((y - .25) * 150 + theta * 1.8) * np.exp(-((y - .29) / .045) ** 2)
            target += target / radius[:, None] * (knee_fold + hem_fold)[:, None]
            delta = target - radial
        changed[ids[:, None], [0, 2]] += delta * pants_fade[ids, None]

    # Stand-away fabric on torso and upper sleeves. A low, asymmetric hem fold
    # breaks the body-conforming surface without inflating the chest or neck.
    ns = normals_world[representative]
    y = points[:, 1]
    if male:
        torso = 1 - smoothstep(.17, .29, np.abs(points[:, 0] + .007))
        ease = .004 + .0055 * torso * (1 - smoothstep(.42, .65, y))
        folds = .0022 * np.sin(48 * y + 13 * points[:, 0]) * np.exp(-((y - .29) / .075) ** 2) * torso
        # The source underarm crease is a very tight folded surface. Leave its
        # contact zone fitted, then blend outward to the torso/sleeve ease.
        underarm_radius = np.sqrt(((np.abs(points[:, 0] + .007) - .18) / .07) ** 2 + ((y - .51) / .10) ** 2)
        underarm_clearance = smoothstep(.8, 1.6, underarm_radius)
        ease *= underarm_clearance
        folds *= underarm_clearance
    else:
        torso = 1 - smoothstep(.075, .125, np.abs(points[:, 0]))
        ease = .0025 + .0015 * torso
        folds = .0012 * np.sin(70 * y + 16 * points[:, 0]) * np.exp(-((y - 1.135) / .035) ** 2) * torso
    changed += ns * ((ease + folds) * shirt_fade)[:, None]

    # Keep added male garment ease subtle relative to the densely folded source
    # mesh; five millimetres reads as fabric without crossing narrow creases.
    if male:
        changed = points + (changed - points) * .45

    displacement = changed - points
    moved_groups = np.linalg.norm(displacement, axis=1) > 1e-10
    moved = moved_groups[group]
    edited_world = world + displacement[group]
    inverse_matrix = np.linalg.inv(matrix)
    edited = (edited_world * unit - matrix[:3, 3]) @ inverse_matrix[:3, :3].T
    result['POSITION'][moved] = edited[moved]

    # Rotate each authored normal by its local surface change. This retains
    # source hard/smooth shading differences and leaves every unedited normal
    # bit-exact, instead of smoothing the entire body through a generic export.
    def surface_normals(vertices):
        accum = np.zeros_like(vertices)
        cross = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]],
                         vertices[faces[:, 2]] - vertices[faces[:, 0]])
        for k in range(3):
            np.add.at(accum, faces[:, k], cross)
        return accum / np.maximum(np.linalg.norm(accum, axis=1)[:, None], 1e-12)

    before_n, after_n = surface_normals(points), surface_normals(changed)
    axis = np.cross(before_n, after_n)
    cosine = np.clip(np.sum(before_n * after_n, axis=1), -1, 1)
    n = normals_world
    cross = np.cross(axis[group], n)
    rotated = n + cross + np.cross(axis[group], cross) / np.maximum(1 + cosine[group, None], 1e-8)
    local_normals = rotated @ matrix[:3, :3]
    local_normals /= np.maximum(np.linalg.norm(local_normals, axis=1)[:, None], 1e-12)
    result['NORMAL'][moved] = local_normals[moved]

    assert np.array_equal(result['JOINTS_0'], attributes['JOINTS_0'])
    assert np.array_equal(result['WEIGHTS_0'], attributes['WEIGHTS_0'])
    assert np.array_equal(result['TEXCOORD_0'], attributes['TEXCOORD_0'])
    assert np.array_equal(result['POSITION'][~moved], attributes['POSITION'][~moved])
    assert np.array_equal(result['NORMAL'][~moved], attributes['NORMAL'][~moved])
    lengths = np.linalg.norm(displacement[group], axis=1)
    report = {'authored': True, 'operation': 'Original garment rest-mesh tailoring; source skin influences and UVs preserved',
              'editedSourceVertexIds': np.flatnonzero(moved).tolist(),
              'sourceVertexCount': len(original), 'editedSourceVertices': int(moved.sum()),
              'maximumWorldDisplacementMetres': float(lengths.max()),
              'shirtVertices': int(shirt[group].sum()), 'trouserVertices': int(trousers[group].sum()),
              'pinnedShirtBoundaryVertices': sorted(int(i) for loop in boundaries.get('shirtBoundaryLoops', []) for i in loop['originalVertexIndices']),
              'sourceSkinInfluencesAndUVsExact': True, 'unselectedPositionsAndNormalsExact': True,
              'originalTriangles': len(triangles), 'addedTriangles': 0}
    assert not any(moved[i] for i in report['pinnedShirtBoundaryVertices']), 'A neck/cuff/hem anchor moved'
    return result, report
