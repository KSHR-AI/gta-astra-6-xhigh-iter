"""Original charcoal suede/leather footwear on the existing male body UVs.

The source is EmoPreben's CC0 CivilianMale body, already credited in ASSETS.md.
No downloaded texture, random noise, geometry edit, or skin-weight edit is used.
Source sole/toe/vamp components are independent UV islands. Side/heel borders
are artist-painted across shared triangles; the inspected face IDs below and a
narrow source-color boundary rule preserve the adjacent blue-black trousers.
The normal output keeps this source's DirectX green convention.

Called by character_clothing_textures.py; stage the complete maps with:
python3 art/blender/character_clothing_textures.py /tmp/astra-finish-clothing-textures
"""
import hashlib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

CORE_TRIANGLES = np.array([
    19, 49, 50, 51, 53, 54, 57, 58, 60, 61, 62, 64, 65, 66, 68, 70, 72, 73,
    75, 76, 146, 186, 197, 206, 238, 352, 353, 357, 361, 363, 364, 365, 367, 368, 372, 384,
    411, 465, 467, 477, 478, 521, 547, 583, 602, 615, 665, 670, 692, 694, 723, 740, 757, 772,
    794, 795, 821, 822, 824, 826, 827, 828, 829, 830, 833, 836, 838, 841, 843, 844, 917, 922,
    971, 972, 986, 1007, 1010, 1017, 1026, 1028, 1059, 1068, 1104, 1106, 1111, 1112, 1113, 1119, 1124, 1133,
    1140, 1152, 1184, 1210, 1213, 1220, 1350, 1373, 1379, 1381, 1389, 1410, 1482, 1530, 1544, 1622, 1623, 1624,
    1625, 1626, 1627, 1628, 1630, 1631, 1633, 1634, 1638, 1639, 1640, 1642, 1643, 1644, 1645, 1647, 1650, 1680,
    1708, 1723, 1730, 1817, 1820, 1861, 1949, 1953, 1955, 1956, 1958, 1961, 1963, 1965, 1972, 1973, 1975, 2042,
    2047, 2048, 2049, 2055, 2056, 2057, 2059, 2060, 2071, 2106, 2148, 2153, 2194, 2219, 2282, 2298, 2315, 2335,
    2350, 2355, 2391, 2392, 2395, 2396, 2397, 2399, 2401, 2404, 2405, 2406, 2408, 2409, 2410, 2411, 2412, 2413,
    2414, 2418, 2422, 2423, 2424, 2425, 2426, 2595, 2598, 2599, 2600, 2601, 2602, 2626, 2679, 2682, 2683, 2684,
    2685, 2690, 2693, 2696, 2706, 2714, 2717, 2718, 2789, 2790, 2842, 2908, 2948, 2969, 2974, 2975, 3008, 3020,
    3021, 3139, 3141, 3146, 3160, 3171, 3173, 3175, 3189, 3230, 3237, 3250, 3256, 3261, 3267, 3276, 3295, 3296,
    3305, 3308, 3330, 3332, 3344, 3348, 3351, 3354, 3360, 3377, 3384, 3391, 3410, 3414, 3439, 3442, 3458, 3460,
    3466, 3472, 3505, 3507, 3513, 3518, 3522, 3523, 3528, 3540, 3543, 3545, 3546, 3553, 3554, 3577, 3582, 3585,
    3597, 3601, 3612, 3624, 3632, 3647, 3650, 3683, 3689, 3706, 3718, 3741, 3742, 3777, 3788, 3799, 3814, 3815,
    3836, 3839, 3843, 3852, 3853, 3854, 3868, 3879, 3881, 3898, 3901, 3927, 3937, 3938, 3942, 3944, 3963, 3964,
    3972, 3976, 3984, 4001, 4014, 4033, 4037, 4044, 4054, 4064, 4083, 4092, 4113, 4118, 4119, 4126, 4130, 4134,
    4138, 4159, 4175, 4183, 4196, 4221, 4243, 4255, 4261, 4274, 4300, 4312, 4322, 4329, 4333, 4338, 4348, 4351,
    4356, 4365, 4372, 4374, 4379, 4417, 4418, 4420, 4437, 4441, 4466, 4482, 4550, 4571, 4585, 4595, 4604, 4618,
    4627, 4630, 4631, 4641, 4660, 4685, 4688, 4693, 4704, 4709, 4716, 4726, 4734, 4744, 4757, 4758, 4787, 4808,
    4809, 4813, 4820, 4830, 4831, 4832, 4841, 4845, 4847, 4860, 4873, 4907, 4913, 4914, 4920, 4922, 4932, 4966,
    4971, 5005, 5015, 5019, 5020, 5025, 5027, 5077, 5086, 5095, 5098, 5111, 5114, 5119, 5122, 5128, 5144, 5150,
    5155, 5185, 5222, 5235, 5240, 5263, 5288, 5291, 5303, 5350, 5370, 5385, 5396, 5420, 5422, 5426, 5431, 5444,
    5480, 5485, 5487, 5491, 5494, 5496, 5497, 5510, 5558, 5583, 5592, 5598, 5602, 5604, 5616, 5628, 5636, 5644,
    5671, 5672, 5674, 5707, 5718, 5734, 5739, 5745, 5749, 5754, 5769, 5780, 5787, 5791, 5799, 5802, 5819, 5826,
    5836, 5839, 5848, 5851, 5876, 5878, 5884, 5888, 5892, 5895, 5906, 5910, 5913, 5921, 5923, 5927, 5932, 5936,
    5937, 5940, 5949, 5953, 5965, 5966, 5973, 5974, 5975, 5981, 5995, 5997, 6002, 6005, 6022, 6025, 6031, 6033,
    6047, 6050, 6055, 6082, 6092, 6101, 6120, 6122, 6125, 6133, 6135, 6137, 6143, 6146, 6171, 6172, 6178, 6181,
    6204, 6212, 6213, 6223, 6225, 6261, 6264, 6265, 6266, 6283, 6288, 6290, 6291, 6296, 6300, 6336, 6349, 6357,
    6383, 6384, 6389, 6397, 6400, 6476, 6486, 6493, 6500, 6522, 6526, 6528, 6529, 6532, 6561, 6569, 6571, 6574,
    6577, 6584, 6612, 6622, 6640, 6644, 6648, 6661, 6662, 6664, 6665, 6666, 6669, 6692, 6703, 6714, 6722, 6726,
    6731, 6738, 6766, 6791, 6797, 6798, 6847, 6872, 6902, 6910, 6915, 6920, 6939, 6942, 6948, 6963, 6980, 6983,
    7040, 7056, 7057, 7086, 7087, 7097, 7102, 7124, 7125, 7129, 7163, 7168, 7180, 7185, 7187, 7192, 7193, 7207,
    7208, 7212, 7223, 7242, 7245, 7257, 7270, 7282, 7295, 7298, 7320, 7367, 7383, 7393, 7407, 7442, 7443, 7446,
    7460, 7467, 7473, 7475, 7476, 7496, 7510, 7545, 7552, 7565, 7566, 7570, 7579, 7581, 7590, 7595, 7596, 7618,
    7619, 7629, 7638, 7648, 7667, 7669, 7675, 7679, 7684, 7715, 7724, 7753, 7754, 7755, 7756, 7759, 7770, 7771,
    7820, 7821, 7886, 7946, 7961, 7962, 7979, 7980, 8000, 8025, 8026, 8031, 8038, 8043, 8061, 8075, 8108, 8150,
    8152, 8159, 8176, 8178, 8193, 8200, 8215, 8220, 8223, 8238, 8239, 8254, 8260, 8261, 8281, 8282, 8289, 8298,
    8307, 8312, 8336, 8384, 8397, 8398, 8417, 8430, 8432, 8444, 8498, 8518, 8558, 8624, 8632, 8648, 8668, 8682,
    8684, 8703, 8712, 8714, 8721, 8743, 8773,
], dtype=np.int32)

BOUNDARY_TRIANGLES = np.array([
    171, 329, 1090, 1129, 1141, 1799, 2054, 2128, 2654, 3662, 3871, 3895, 4067, 4286, 4299, 4323, 5006, 5115,
    5445, 5545, 5845, 6077, 6078, 7533, 7743, 7907, 8361,
], dtype=np.int32)

SOLE_TRIANGLES = np.array([
    186, 197, 411, 547, 665, 740, 824, 841, 843, 1026, 1111, 1112, 1381, 1544, 1708, 2148, 2350, 2391,
    2392, 2397, 2406, 2411, 2414, 2418, 2598, 2682, 2683, 2684, 2685, 2690, 2714, 2908, 3020, 3141, 3230, 3250,
    3256, 3276, 3295, 3439, 3442, 3522, 3543, 3545, 3585, 3597, 3612, 3683, 3689, 3852, 3937, 3964, 3972, 4037,
    4064, 4126, 4130, 4351, 4379, 4716, 4820, 4914, 4966, 4971, 5015, 5098, 5122, 5150, 5155, 5420, 5431, 5491,
    5718, 5839, 5921, 5981, 6225, 6291, 6384, 6500, 6640, 6726, 6766, 6902, 7086, 7097, 7180, 7245, 7270, 7295,
    7407, 7446, 7475, 7476, 7570, 7638, 7715, 7886, 7979, 8220, 8558, 8714, 61, 65, 68, 70, 73, 75,
    352, 361, 363, 365, 367, 772, 794, 795, 917, 1104, 1350, 1389, 1642, 1647, 1680, 1949, 1953, 1956,
    1961, 1963, 2056, 2057, 2355, 2790, 2975, 3146, 3189, 3267, 3305, 3308, 3330, 3354, 3507, 3518, 3546, 3577,
    3601, 3706, 3799, 3815, 3868, 3879, 3944, 3963, 4274, 4372, 4482, 4734, 4808, 4831, 4922, 4932, 5086, 5128,
    5240, 5598, 5602, 5628, 5644, 5674, 5754, 5895, 5913, 5937, 5974, 6005, 6133, 6143, 6476, 6529, 6561, 6569,
    6584, 6872, 6963, 7207, 7208, 7223, 7242, 7579, 7629, 7946, 8000, 8031, 8038, 8223, 8261, 8298, 8312,
], dtype=np.int32)

VAMP_TRIANGLES = np.array([
    353, 372, 384, 602, 723, 922, 1627, 1645, 1730, 2282, 2315, 2335, 2693, 2718, 3624, 3927, 3976, 4054,
    4113, 4118, 4159, 4183, 4300, 4312, 4757, 4758, 4787, 4847, 4907, 5291, 5303, 5444, 6135, 6703, 6714, 6915,
    6980, 7257, 7473, 7496, 7552, 7753, 8075, 8703, 8743, 206, 583, 615, 670, 826, 830, 1210, 1482, 1973,
    2413, 3173, 3344, 3348, 3938, 4175, 4365, 4841, 5020, 5370, 5396, 5426, 5671, 5780, 5819, 5888, 5906, 5910,
    5927, 6137, 6171, 6266, 6644, 6692, 6910, 6983, 7087, 7129, 7442, 8150, 8215,
], dtype=np.int32)

TOE_TRIANGLES = np.array([
    57, 58, 60, 62, 64, 66, 1628, 1630, 1631, 1633, 1634, 1638, 1639, 1640, 4255, 4356, 4595, 4618,
    5799, 6283, 6389, 7282, 7648, 827, 828, 829, 833, 836, 838, 2395, 2396, 2401, 2404, 2405, 2408, 2409,
    2410, 2412, 4221, 5095, 6939, 7187, 7192, 7193, 7669, 7980, 8336,
], dtype=np.int32)

def _smoothstep(a, b, value):
    t = np.clip((value-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def _boundary_samples(positions, indices, triangle_ids):
    """Sample actual physical panel borders, joining aliases across UV seams."""
    _, welded = np.unique(np.round(positions*1e6).astype(np.int64), axis=0, return_inverse=True)
    edges = {}
    for triangle in indices[triangle_ids]:
        for a, b in zip(triangle, np.roll(triangle, -1)):
            key = tuple(sorted((int(welded[a]), int(welded[b]))))
            if key in edges:
                edges[key] = None
            else:
                edges[key] = (positions[a], positions[b])
    samples = []
    for edge in edges.values():
        if edge is None:
            continue
        a, b = edge
        count = max(2, int(np.ceil(np.linalg.norm(b-a)/.0012))+1)
        samples.extend(a+(b-a)*t for t in np.linspace(0, 1, count))
    assert samples, 'Shoe panel topology has no border'
    return np.asarray(samples)


def _color_stats(values):
    rgb = np.asarray(values, np.float64)
    luminance = rgb@np.array([.2126, .7152, .0722])
    return {'median_srgb':np.median(rgb, axis=0).tolist(),
            'srgb_luminance_p05_p50_p95':np.quantile(luminance,[.05,.5,.95]).tolist()}


def author_male_shoes(positions, uv, indices, points, valid, source, protected, rasterize,
                      gutter_distance, gutter_nearest):
    """Return physical/padded masks and sparse authored color/normal/roughness."""
    assert len(positions)==26352 and len(indices)==8784, 'Shoe source topology changed'
    assert hashlib.sha256(positions.tobytes()+uv.tobytes()+indices.tobytes()).hexdigest()=='a38f6fbcbf3fa340f037b144c67a333d6519eb93cc0cea3de59b8296596f254c', 'Reinspect footwear face selections after source geometry/UV changes'
    height = float(np.ptp(positions[:,1])); floor = float(positions[:,1].min())
    size = (valid.shape[1], valid.shape[0])
    def coverage(ids):
        return rasterize(positions, uv, indices[ids], size)[1]
    core = coverage(CORE_TRIANGLES)
    boundary = coverage(BOUNDARY_TRIANGLES)
    sole = coverage(SOLE_TRIANGLES)
    toe = coverage(TOE_TRIANGLES)
    y = (points[:,:,1]-floor)/height
    # The source paints a shoe/cuff boundary through 27 triangles. Warm or
    # neutral shoe texels include the pale former pattern; blue-black trousers
    # are left intact. Selection is confined to the inspected boundary faces.
    shoe_color = (source[:,:,2]-source[:,:,0] <= 1/255+1e-6)|(source.mean(axis=2)>60/255)
    boundary_region = boundary&valid&(y<.065)&~protected
    extra = boundary_region&shoe_color
    # Close only enclosed one/two-pixel pattern holes, never open cuff borders.
    filled = ndimage.binary_fill_holes(extra)
    holes, _ = ndimage.label(filled&~extra)
    hole_sizes = np.bincount(holes.ravel())
    extra |= (holes>0)&(hole_sizes[holes]<=24)&boundary_region
    physical = core|extra
    assert np.all(valid[physical]), 'Shoe coverage leaves actual source triangles'
    assert not np.any(physical&protected), 'Shoe authoring overlaps skin or existing apparel'
    assert float(y[physical].max())<.065, 'Footwear selection reaches beyond inspected cuff'
    padding = (~valid)&(gutter_distance<=8)&physical[gutter_nearest[0],gutter_nearest[1]]
    authored = physical|padding

    # Art direction follows the actual +Z toe / -Z heel and each foot's splay.
    p = points[physical]; z=p[:,2]; local_y=p[:,1]-floor
    right = p[:,0]>0
    center_x = np.where(right, .198212+.256711*z, .196682+.260639*z)
    cross = (np.abs(p[:,0])-center_x)/.055
    along = np.clip((z+.1403)/.2516,0,1)
    rubber = (sole|toe)[physical]
    upper = ~rubber
    sole_tree = cKDTree(_boundary_samples(positions,indices,np.r_[SOLE_TRIANGLES,TOE_TRIANGLES]))
    sole_distance = sole_tree.query(p)[0]
    # A smooth apron is laid over the foot in 3D. Source UV island borders are
    # packing cuts, not a garment pattern: following them would paint angular
    # triangular panels onto an otherwise rounded upper.
    apron_radius=(np.abs(cross/.76)**6+np.abs((along-.68)/.40)**6)**(1/6)
    panel_signed=(apron_radius-1)*.042
    panel_distance=np.abs(panel_signed)
    suede=(1-_smoothstep(-.0018,.0018,panel_signed))*upper
    welt = np.exp(-((sole_distance-.0028)/.0012)**2)*upper
    sole_rim = np.exp(-((sole_distance-.0018)/.0014)**2)*rubber
    apron = np.exp(-((panel_distance-.0016)/.0011)**2)*upper
    panel_shadow = np.exp(-(panel_distance/.0022)**2)*upper
    # Heel counter and two soft flex creases are construction details, not
    # photographed spots or broad diffuse lighting.
    heel_line = z+.071-.006*np.cos(cross*2.4)
    heel_seam = np.exp(-(heel_line/.0016)**2)*upper*(1-_smoothstep(.052,.085,local_y))
    heel_counter = (1-_smoothstep(-.075,-.067,z))*upper
    flex = np.zeros(len(p),np.float32)
    for origin,amplitude in [(.019,.65),(.039,.36)]:
        flex += amplitude*np.exp(-((z-origin-.004*np.cos(cross*2.3))/.0023)**2)*suede
    polar = np.arctan2((z+.014)/.127,(np.abs(p[:,0])-center_x)/.055)
    thread = (.5+.5*np.cos(polar*142))**8
    stitches = np.minimum(welt+.7*apron+.35*heel_seam,1.5)*thread
    # Small coherent nap affects surface response, with no high-contrast dots.
    nap = .5*np.sin(z*540+.6*np.sin(np.abs(p[:,0])*370))+.5*np.sin(np.abs(p[:,0])*680+z*210)
    toe_wear = np.exp(-((along-.82)/.26)**2)*np.exp(-(cross/.9)**4)*upper
    leather = np.array([.112,.123,.130],np.float32)
    suede_color = np.array([.150,.162,.166],np.float32)
    rubber_color = np.array([.048,.054,.058],np.float32)
    color = np.broadcast_to(leather,(len(p),3)).copy()
    color += (suede_color-leather)[None,:]*suede[:,None]
    color[rubber]=rubber_color
    tone = 1+.055*toe_wear-.065*heel_counter-.055*panel_shadow-.036*flex
    color *= tone[:,None]
    color += (welt*.012+sole_rim*.007+stitches*.035)[:,None]
    color = np.clip(color,0,1)
    # A shallow repeating chevron is restricted to the outsole, not its upper.
    bottom = rubber&(local_y<.012)
    tread = np.exp(-(np.sin((z*61+np.abs(cross)*.72)*np.pi)/.17)**2)*bottom
    color -= tread[:,None]*.006
    roughness = np.full(len(p),.765,np.float32)
    roughness+=suede*.09
    roughness[rubber]=.90
    roughness += nap*.012 - toe_wear*.025 - stitches*.018
    roughness = np.clip(roughness,.72,.93)

    relief = np.zeros(valid.shape,np.float32)
    relief[physical] = .62*welt+.55*apron+.24*heel_seam+.20*stitches-.36*panel_shadow-.28*flex-.22*tread+.018*nap*upper
    # Extend the scalar field before differentiating to prevent fake bumps at
    # UV island edges. Padding is limited to unused texels owned by this shoe.
    relief[padding]=relief[gutter_nearest[0][padding],gutter_nearest[1][padding]]
    relief=ndimage.gaussian_filter(relief,.48)
    dy,dx=np.gradient(relief)
    normal=np.stack((-dx[physical],dy[physical],np.ones(len(p))),axis=1)
    normal/=np.linalg.norm(normal,axis=1)[:,None]
    normal=(normal*.5+.5).astype(np.float32)
    light_source = valid&(y<.06)&(source.mean(axis=2)>60/255)
    missing = light_source&~physical
    assert not np.any(missing), 'Original pale shoe pixels survive the replacement'
    report={'authored':True,'design':'Charcoal suede vamp, dark leather quarters and heel counter, rubber outsole/toe bumper, welt/apron stitching and shallow flex creases; original deterministic artwork',
        'source':'CivilianMale.glb / EmoPreben CC0 body; no additional external imagery',
        'core_triangles':len(CORE_TRIANGLES),'painted_boundary_triangles':len(BOUNDARY_TRIANGLES),
        'source_triangle_ids':np.unique(np.r_[CORE_TRIANGLES,BOUNDARY_TRIANGLES]).tolist(),
        'selection':'Six complete sole/toe/vamp UV components, inspected side/heel faces, and source-neutral/warm portions of 27 painted cuff-boundary triangles; never a whole-body height or color replacement',
        'physical_uv_pixels':int(physical.sum()),'empty_gutter_pixels':int(padding.sum()),'gutter_radius_pixels':8,
        'source_pale_shoe_pixels':int(light_source.sum()),'unreplaced_pale_shoe_pixels':int(missing.sum()),
        'protected_skin_apparel_overlap_pixels':int((physical&protected).sum()),
        'normalized_y_bounds':[float(y[physical].min()),float(y[physical].max())],
        'source_color':_color_stats(source[physical]),'authored_color':_color_stats(color),
        'sole_roughness_bounds':[float(roughness[rubber].min()),float(roughness[rubber].max())],
        'upper_roughness_bounds':[float(roughness[upper].min()),float(roughness[upper].max())],
        'geometry_policy':'No position, UV, index, normal attribute, joint or weight array is modified; original calibrated soles are invariant',
        'source_geometry_sha256':hashlib.sha256(positions.tobytes()+uv.tobytes()+indices.tobytes()).hexdigest(),
        'normal_convention':'Original source DirectX convention: authored +dHeight/dImageY in green; runtime normalScale.y remains negative'}
    return physical,padding,color,normal,roughness,report


def write_shoe_preview(path, positions, uv, indices, before, after):
    """Small CPU diffuse study of unchanged shoe geometry, not a game render."""
    floor=float(positions[:,1].min());height=float(np.ptp(positions[:,1]))
    y=(positions[:,1]-floor)/height
    faces=indices[(y[indices].max(axis=1)<.095)&(positions[indices,0].min(axis=1)>0)]
    vertices=np.unique(faces)
    center=positions[vertices].mean(axis=0)
    # Smooth geometric normals share position aliases; no source normal image
    # is baked into the preview's illumination.
    _,aliases=np.unique(np.round(positions*1e6).astype(np.int64),axis=0,return_inverse=True)
    normals=np.zeros((int(aliases.max())+1,3),np.float64)
    for tri in faces:
        n=np.cross(positions[tri[1]]-positions[tri[0]],positions[tri[2]]-positions[tri[0]])
        for vertex in tri:normals[aliases[vertex]]+=n
    normals/=np.maximum(np.linalg.norm(normals,axis=1),1e-9)[:,None]
    normals=normals[aliases]
    def render(texture,eye):
        width,height=560,330
        eye=np.asarray(eye,np.float64);eye/=np.linalg.norm(eye)
        right=np.cross([0,1,0],eye);right/=np.linalg.norm(right);up=np.cross(eye,right)
        q=positions-center
        xy=np.stack((q@right,-q@up),axis=1)
        extent=np.ptp(xy[vertices],axis=0)
        scale=min((width-80)/extent[0],(height-55)/extent[1])
        xy=(xy-(xy[vertices].max(axis=0)+xy[vertices].min(axis=0))/2)*scale+[width/2,height/2]
        depth=q@eye
        canvas=np.full((height,width,3),[.115,.135,.15],np.float32);zbuffer=np.full((height,width),-np.inf)
        light=np.asarray([.45,.85,.4]);light/=np.linalg.norm(light)
        for tri in faces:
            pts=xy[tri];lo=np.maximum(np.floor(pts.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(pts.max(axis=0)).astype(int),[width-1,height-1])
            if np.any(hi<lo):continue
            a,b,c=pts;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-9:continue
            yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];x=xx+.5;yyf=yy+.5
            w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(yyf-c[1]))/den
            w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(yyf-c[1]))/den;w2=1-w0-w1
            z=w0*depth[tri[0]]+w1*depth[tri[1]]+w2*depth[tri[2]]
            local_z=zbuffer[lo[1]:hi[1]+1,lo[0]:hi[0]+1];hit=(w0>=0)&(w1>=0)&(w2>=0)&(z>local_z)
            if not np.any(hit):continue
            weights=np.stack((w0[hit],w1[hit],w2[hit]),axis=1)
            samples=weights@uv[tri]
            col=np.column_stack([ndimage.map_coordinates(texture[:,:,channel],[samples[:,1]*texture.shape[0]-.5,samples[:,0]*texture.shape[1]-.5],order=1,mode='nearest') for channel in range(3)])
            normal=weights@normals[tri];normal/=np.maximum(np.linalg.norm(normal,axis=1),1e-8)[:,None]
            illumination=.67+.33*np.maximum(normal@light,0)
            canvas[lo[1]:hi[1]+1,lo[0]:hi[0]+1][hit]=col*illumination[:,None]
            local_z[hit]=z[hit]
        return Image.fromarray(np.rint(np.clip(canvas,0,1)*255).astype(np.uint8))
    preview=Image.new('RGB',(1120,742),(23,28,32));draw=ImageDraw.Draw(preview)
    draw.text((18,12),'MALE FOOTWEAR / neutral diffuse study on unchanged source geometry',fill=(228,234,238))
    draw.text((18,34),'Original patterned upper',fill=(190,199,207))
    draw.text((578,34),'Authored charcoal suede, leather quarters and rubber outsole',fill=(190,199,207))
    for row,eye in enumerate(([1,.75,1.1],[1,.25,-.12])):
        for column,texture in enumerate((before,after)):
            preview.paste(render(texture,eye),(column*560,55+row*330))
    draw.text((18,723),'CPU inspection only. No pose, sole geometry, UV, or rig changes; final game lighting review still required.',fill=(174,188,198))
    preview.save(path)

