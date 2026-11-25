"""Author cotton jersey and repair the exposed original cuff skin boundaries.

Run after character_clothing_textures.py and before the Blender garment build:
  python3 art/blender/character_shirt_textures.py /tmp/astra-clothing-stage/textures

Requires only NumPy and Pillow. The source GLB is read to prove that the reserved
544px atlas rectangle intersects no original UV triangle. A second, explicit
exception repairs the fifty skin-side upper-arm triangles beside the old cuffs:
the source painted a narrow clothing band across those otherwise skin faces.
Pure source shirt-mask texels also receive the matching fabric surface; all
other texels and all alpha remain exact. The allocation includes guarded
jersey and broad upper-arm skin islands. Geometry and replacement UV authoring
are performed separately by character_shirt.py and character_sleeve_skin.py.
"""
from argparse import ArgumentParser
from pathlib import Path
import hashlib
import json
import struct

import numpy as np
from PIL import Image, ImageDraw
from character_clothing_boundaries import Source


ROOT = Path(__file__).resolve().parents[2]
ATLAS_SIZE = 2048
ALLOCATION = (1488, 1472, 2032, 2016)
CONTENT = (1504, 1488, 1872, 2000)
SKIN_CONTENT = {"Left": (1920, 1504, 2016, 1728), "Right": (1920, 1760, 2016, 1984)}
CORE_SIZE = 512
GUTTER = 16
MAP_NAMES = ("male-diffuse.png", "male-normal.png", "male-roughness.png")
from character_sleeve_skin import CUFF_SKIN_FACES

CUFF_SOURCE_SHA256 = "b9fd3b7fed3ee5f87bd22b6dea7d3dfb479a79f1a7200889cd4f18f3e6711618"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def triangle_pixels(uv):
    """Return exact pixel-center coverage and barycentrics for a UV triangle."""
    p = uv.astype(np.float64) * ATLAS_SIZE
    low = np.maximum(np.floor(p.min(axis=0)).astype(int), 0)
    high = np.minimum(np.ceil(p.max(axis=0)).astype(int), ATLAS_SIZE - 1)
    if np.any(high < low):
        return None
    a, b, c = p
    det = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(det) < 1e-12:
        return None
    yy, xx = np.mgrid[low[1]:high[1]+1, low[0]:high[0]+1]
    x, y = xx + 0.5, yy + 0.5
    w0 = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
    w1 = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det
    bary = np.stack((w0, w1, 1-w0-w1), axis=-1)
    inside = np.all(bary >= -1e-9, axis=-1)
    return yy[inside], xx[inside], bary[inside]


def repair_cuff_skin(originals, authored):
    """Repair only semantic skin-side cuff faces, sampling that same arm.

    The nearest pure skin sample is chosen in bind-world surface coordinates,
    never by proximity to unrelated packed UV islands. Donors are within five
    mesh-edge steps of the affected faces and remain on the same upper arm.
    """
    source_path = ROOT / "public/models/CivilianMale.glb"
    if sha256(source_path.read_bytes()) != CUFF_SOURCE_SHA256:
        raise ValueError("Original male source changed; re-audit cuff skin triangle IDs")
    source = Source(source_path)
    triangles, uv = source.triangles, source.attributes['TEXCOORD_0']
    world = source.world_positions
    centers = world[triangles].mean(axis=1)
    packed = originals[2]
    allowed = np.zeros((ATLAS_SIZE, ATLAS_SIZE), dtype=bool)
    reports = {}
    all_faces = set(face for faces in CUFF_SKIN_FACES.values() for face in faces)
    for side, selected in CUFF_SKIN_FACES.items():
        side_mask = np.zeros_like(allowed)
        positions = np.zeros((ATLAS_SIZE, ATLAS_SIZE, 3), dtype=np.float32)
        sign = 1 if side == "left" else -1
        selected_points = world[np.unique(triangles[list(selected)])]
        if not (np.all(selected_points[:, 0] * sign > 23)
                and np.all(selected_points[:, 0] * sign < 36)
                and selected_points[:, 1].min() > 38
                and selected_points[:, 1].max() < 46):
            raise ValueError(f"Cuff {side} footprint left its audited upper-arm bounds")
        for face in selected:
            hit = triangle_pixels(uv[triangles[face]])
            if hit is not None:
                y, x, bary = hit
                side_mask[y, x] = True
                positions[y, x] = bary @ world[triangles[face]]
        allowed |= side_mask
        # The original painted cuff also occupies texels already classified
        # as skin. Repair the entire audited skin-side face footprint so a
        # gray sawtooth band cannot survive behind a correct semantic mask.
        bad = side_mask
        # Use connected, same-arm skin only; neither hands nor torso/neck can
        # enter this donor set even if their atlas islands are adjacent.
        visited, frontier = set(selected), set(selected)
        for _ in range(5):
            following = set()
            for face in frontier:
                a, b, c = source.faces[face]
                for edge in ((a,b), (b,c), (c,a)):
                    for neighbor in source.edge_faces[tuple(sorted(map(int, edge)))]:
                        point = centers[neighbor]
                        if (neighbor not in visited and 20 < point[0]*sign < 39
                                and 28 < point[1] < 48):
                            following.add(neighbor)
            visited |= following
            frontier = following
        donor_pixels, donor_positions, donor_faces = [], [], []
        for face in sorted(visited - all_faces):
            hit = triangle_pixels(uv[triangles[face]])
            if hit is None:
                continue
            y, x, bary = hit
            sample = packed[y, x]
            pure = (sample[:, 0] == 0) & (sample[:, 2] == 255)
            rgb = originals[0][y,x,:3].astype(float)
            pure &= (rgb[:,0]>rgb[:,1]*1.15)&(rgb[:,0]>rgb[:,2]*1.15)
            if pure.any():
                donor_pixels.extend(zip(y[pure].tolist(), x[pure].tolist()))
                donor_positions.extend((bary[pure] @ world[triangles[face]]).tolist())
                donor_faces.append(face)
        if not donor_pixels:
            raise ValueError(f"No neighboring pure skin donor on {side} upper arm")
        donor_pixels = np.asarray(donor_pixels, dtype=int)
        donor_positions = np.asarray(donor_positions, dtype=np.float32)
        by, bx = np.where(bad)
        distances = []
        for start in range(0, len(by), 128):
            ty, tx = by[start:start+128], bx[start:start+128]
            d2 = ((positions[ty, tx, None] - donor_positions[None]) ** 2).sum(axis=2)
            nearest = np.argmin(d2, axis=1)
            distances.extend(np.sqrt(d2[np.arange(len(nearest)), nearest]).tolist())
            sy, sx = donor_pixels[nearest].T
            for index in (0, 1):
                authored[index][ty, tx, :3] = originals[index][sy, sx, :3]
        authored[2][side_mask, :3] = (0, round(0.64*255), 255)
        reports[side] = {
            "source_triangle_ids": list(selected), "triangles": len(selected),
            "footprint_pixels": int(side_mask.sum()), "repaired_color_normal_pixels": int(bad.sum()),
            "shirt_mask_pixels_before": int((side_mask & (packed[..., 0] > 0)).sum()),
            "missing_skin_mask_pixels_before": int((side_mask & (packed[..., 2] < 128)).sum()),
            "shirt_mask_pixels_after": int((side_mask & (authored[2][..., 0] > 0)).sum()),
            "missing_skin_mask_pixels_after": int((side_mask & (authored[2][..., 2] < 128)).sum()),
            "donor_triangle_ids": donor_faces, "pure_skin_donor_pixels": len(donor_pixels),
            "maximum_donor_surface_distance_cm": max(distances, default=0),
            "world_bounds_cm": [selected_points.min(axis=0).tolist(), selected_points.max(axis=0).tolist()],
        }
    # Check every other source face against the actual repair pixels. Shared
    # UV edges may touch a center numerically, but unrelated body regions must
    # never share an authored pixel with these upper-arm footprints.
    overlap = []
    protected_overlap = []
    for face, ids in enumerate(triangles):
        if face in all_faces:
            continue
        hit = triangle_pixels(uv[ids])
        if hit is None:
            continue
        y, x, _ = hit
        count = int(allowed[y, x].sum())
        if count:
            overlap.append({"source_triangle": face, "pixels": count})
            point = centers[face]
            if not (20 < abs(point[0]) < 39 and 28 < point[1] < 48):
                protected_overlap.append(face)
    if protected_overlap:
        raise ValueError(f"Cuff UV footprints overlap unrelated body faces: {protected_overlap}")
    return allowed, {
        "authored": True, "method": "Exact retained skin-side cuff triangle raster; nearest pure skin in same-arm connected mesh neighbors",
        "roughness": round(0.64*255)/255, "source_geometry_uv_weights_unchanged": True,
        "sides": reports, "footprint_pixels": int(allowed.sum()),
        "other_source_triangle_pixel_overlaps": overlap,
        "protected_hand_neck_footwear_overlap_triangles": protected_overlap,
    }


def source_uv_clearance():
    """Clip every original UV triangle against the complete write rectangle.

    A pixel mask alone can miss a thin triangle or subpixel boundary. Polygon
    intersection also protects those cases and does not assume head removal.
    """
    source = ROOT / "public/models/CivilianMale.glb"
    raw = source.read_bytes()
    json_length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    binary = raw[28 + json_length:]
    types = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
    widths = {"SCALAR": 1, "VEC2": 2}

    def accessor(index):
        attribute = document["accessors"][index]
        view = document["bufferViews"][attribute["bufferView"]]
        dtype = np.dtype(types[attribute["componentType"]])
        width = widths[attribute["type"]]
        return np.ndarray(
            (attribute["count"], width), dtype=dtype, buffer=binary,
            offset=view.get("byteOffset", 0) + attribute.get("byteOffset", 0),
            strides=(view.get("byteStride", width * dtype.itemsize), dtype.itemsize),
        )

    def intersection_area(triangle):
        polygon = list(triangle)
        for axis, level, sign in (
            (0, ALLOCATION[0], 1), (0, ALLOCATION[2], -1),
            (1, ALLOCATION[1], 1), (1, ALLOCATION[3], -1),
        ):
            clipped = []
            for i, a in enumerate(polygon):
                b = polygon[(i + 1) % len(polygon)]
                da, db = (a[axis] - level) * sign, (b[axis] - level) * sign
                if da >= 0:
                    clipped.append(a)
                if (da >= 0) != (db >= 0):
                    clipped.append(a + (b - a) * da / (da - db))
            polygon = clipped
            if len(polygon) < 3:
                return 0.0
        polygon = np.asarray(polygon)
        return float(abs(
            np.dot(polygon[:, 0], np.roll(polygon[:, 1], -1))
            - np.dot(polygon[:, 1], np.roll(polygon[:, 0], -1))
        ) * 0.5)

    triangles_checked = 0
    overlaps = []
    for mesh_index, mesh in enumerate(document["meshes"]):
        for primitive_index, primitive in enumerate(mesh["primitives"]):
            if primitive.get("mode", 4) != 4:
                raise ValueError("The UV safety check requires triangle primitives")
            uv = accessor(primitive["attributes"]["TEXCOORD_0"]).astype(np.float64)
            indices = (accessor(primitive["indices"]).reshape(-1, 3)
                       if "indices" in primitive else np.arange(len(uv)).reshape(-1, 3))
            pixels = uv * ATLAS_SIZE
            for triangle_index, ids in enumerate(indices):
                triangle = pixels[ids]
                triangles_checked += 1
                if (triangle[:, 0].max() < ALLOCATION[0]
                        or triangle[:, 0].min() > ALLOCATION[2]
                        or triangle[:, 1].max() < ALLOCATION[1]
                        or triangle[:, 1].min() > ALLOCATION[3]):
                    continue
                area = intersection_area(triangle)
                if area > 1e-7:
                    overlaps.append([mesh_index, primitive_index, triangle_index, area])
    if overlaps:
        raise ValueError(f"Reserved textile tile overlaps source UV triangles: {overlaps[:8]}")
    return {
        "source": str(source.relative_to(ROOT)), "source_sha256": sha256(raw),
        "triangles_checked": triangles_checked, "intersection_count": len(overlaps),
        "method": "Exact triangle/rectangle polygon clipping, including original head and shirt",
    }


def jersey_tile():
    """Small knitted loops and coherent yarn tension, never random noise.

    Each eight-pixel wale has two curved yarn legs. Their depth and diffuse
    contrast stay shallow so the fabric does not sparkle or look embossed.
    Periodic derivatives keep the tangent normals continuous at repeat edges.
    """
    yy, xx = np.mgrid[:CORE_SIZE, :CORE_SIZE].astype(np.float64)
    u, v = (xx + 0.5) / 8, (yy + 0.5) / 8
    phase = 2 * np.pi
    across = np.mod(u + 0.5, 1) - 0.5
    leg_center = 0.115 + 0.245 * (0.5 - 0.5 * np.cos(phase * v))
    loop = np.exp(-((np.abs(across) - leg_center) / 0.095) ** 2)
    # A shallow underpass makes each knitted course distinct without painting
    # bright rows. Integral frequencies make the complete 512px core periodic.
    underpass = np.exp(-(np.sin(np.pi * v) / 0.3) ** 2)
    yarn_tension = (
        0.55 * np.sin(phase * (xx + 0.5) * 3 / CORE_SIZE)
        + 0.30 * np.cos(phase * (yy + 0.5) * 5 / CORE_SIZE)
        + 0.15 * np.sin(phase * (xx + yy + 1) * 2 / CORE_SIZE)
    )
    centered_loop = loop - loop.mean()
    centered_underpass = underpass - underpass.mean()
    shade = 1 + 0.023 * centered_loop - 0.008 * centered_underpass + 0.006 * yarn_tension
    base = np.array([0.44, 0.445, 0.44])
    diffuse = np.clip(base * shade[..., None], 0, 1)
    relief = 0.13 * centered_loop - 0.035 * centered_underpass + 0.015 * yarn_tension
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * 0.5
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * 0.5
    # Match the source male bitmap convention. Runtime normalScale.y=-1
    # corrects it; do not pre-flip this new region a second time.
    normal = np.dstack((-dx, dy, np.ones_like(dx)))
    normal /= np.linalg.norm(normal, axis=2)[..., None]
    normal = normal * 0.5 + 0.5
    roughness = np.clip(0.88 - 0.010 * centered_loop + 0.006 * yarn_tension, 0.86, 0.90)
    packed = np.dstack((np.ones_like(roughness), roughness, np.zeros_like(roughness)))
    return [np.rint(image * 255).astype(np.uint8) for image in (diffuse, normal, packed)]


def preview(path, before, after, core):
    width, height = ALLOCATION[2] - ALLOCATION[0], ALLOCATION[3] - ALLOCATION[1]
    image = Image.new("RGB", (width * 2, height + 220), (25, 28, 32))
    image.paste(Image.fromarray(before[..., :3]), (0, 30))
    image.paste(Image.fromarray(after[..., :3]), (width, 30))
    draw = ImageDraw.Draw(image)
    draw.text((12, 10), "Previously unused atlas pixels", fill=(235, 235, 235))
    draw.text((width + 12, 10), "Original cotton jersey / 512px core + 16px gutter", fill=(235, 235, 235))
    # Magnification shows the low-contrast loop structure; use nearest-neighbor
    # so the preview does not invent higher-frequency fiber detail.
    swatch = Image.fromarray(core[:48, :48]).resize((168, 168), Image.Resampling.NEAREST)
    image.paste(swatch, (12, height + 44))
    draw.text((194, height + 50), "Magnified knit: curved yarn loops, shallow relief, no baked seams", fill=(220, 220, 220))
    draw.text((194, height + 72), "Packed R: shirt dye 1 / G: roughness near .88 / B: skin 0", fill=(220, 220, 220))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def build(directory, preview_path):
    proof = source_uv_clearance()
    cores = jersey_tile()
    updates = []
    validation = {}
    inputs = []
    for name in MAP_NAMES:
        path = directory / name
        original_bytes = path.read_bytes()
        with Image.open(path) as image:
            if image.size != (ATLAS_SIZE, ATLAS_SIZE) or image.mode not in ("RGB", "RGBA"):
                raise ValueError(f"Expected 2048px RGB/RGBA source atlas: {path}")
            inputs.append((path, original_bytes, image.mode, np.array(image)))
    originals = [item[3] for item in inputs]
    authored = [image.copy() for image in originals]
    # Keep the original lower-hem/belt topology and UVs. Match only source
    # texels already owned by the shirt dye mask; a face-level recolor can
    # incorrectly capture triangles spanning the waistband or buckle.
    source_cloth=originals[2][...,0]==255
    authored[0][source_cloth,:3]=np.rint(cores[0].mean(axis=(0,1))).astype('u1')
    authored[1][source_cloth,:3]=(128,128,255)
    authored[2][source_cloth,1]=224
    cuff_allowed, cuff_report = repair_cuff_skin(originals, authored)
    source = Source(ROOT / 'public/models/CivilianMale.glb')
    skin_tiles={}
    skin_proof={}
    for side, bounds in SKIN_CONTENT.items():
        donor_faces=cuff_report['sides'][side.lower()]['donor_triangle_ids']
        samples=[]
        for face in donor_faces:
            hit=triangle_pixels(source.attributes['TEXCOORD_0'][source.triangles[face]])
            if hit is None:continue
            yy,xx,_=hit;packed=originals[2][yy,xx]
            pure=(packed[:,0]==0)&(packed[:,2]==255)
            samples.extend(originals[0][yy[pure],xx[pure],:3].tolist())
        color=np.median(np.asarray(samples),axis=0)
        height,width=bounds[3]-bounds[1],bounds[2]-bounds[0]
        yy,xx=np.mgrid[:height,:width]
        # Authored shallow skin grain uses the source arm's median complexion.
        # This broad island replaces tiny 3px source patches that contaminated
        # skin with shirt colors after mip filtering.
        grain=np.sin(xx*.72+np.sin(yy*.37))*.35+np.sin(yy*.91)*.20
        diffuse=np.clip(color+grain[:,:,None],0,255).round().astype('u1')
        normal=np.broadcast_to(np.array([128,128,255],dtype='u1'),(height,width,3)).copy()
        packed=np.broadcast_to(np.array([0,163,255],dtype='u1'),(height,width,3)).copy()
        skin_tiles[side]=[np.pad(tile,((16,16),(16,16),(0,0)),mode='edge') for tile in [diffuse,normal,packed]]
        skin_proof[side]={'content_xyxy_exclusive':bounds,'gutter':16,'source_skin_samples':len(samples),
            'source_skin_median_rgb':color.tolist(),'normal':'neutral continuous tangent normal',
            'source_donor_triangle_ids':donor_faces}
    x0, y0, x1, y1 = ALLOCATION
    outside = np.ones((ATLAS_SIZE, ATLAS_SIZE), dtype=bool)
    outside[y0:y1, x0:x1] = False
    outside[cuff_allowed] = False
    outside[source_cloth] = False
    for channel,((path, original_bytes, mode, original), after, core) in enumerate(zip(inputs, authored, cores)):
        name = path.name
        tile = np.pad(core, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="wrap")
        after[y0:y1, x0:x1, :3] = tile
        for side,bounds in SKIN_CONTENT.items():
            sx0,sy0,sx1,sy1=bounds
            after[sy0-16:sy1+16,sx0-16:sx1+16,:3]=skin_tiles[side][channel]
        unchanged = np.array_equal(original[outside], after[outside])
        alpha_unchanged = mode != "RGBA" or np.array_equal(original[..., 3], after[..., 3])
        if not unchanged or not alpha_unchanged:
            raise AssertionError(f"Textile authoring changed protected pixels: {name}")
        validation[name] = {
            "mode": mode, "input_file_sha256": sha256(original_bytes),
            "outside_authorized_regions_unchanged": unchanged,
            "outside_changed_pixels": int(np.any(original[outside] != after[outside], axis=1).sum()),
            "outside_pixel_sha256": sha256(after[outside].tobytes()),
            "alpha_unchanged": alpha_unchanged,
            "allocation_changed_pixels": int(np.any(original[y0:y1, x0:x1] != after[y0:y1, x0:x1], axis=2).sum()),
            "cuff_skin_footprint_changed_pixels": int(np.any(original[cuff_allowed] != after[cuff_allowed], axis=1).sum()),
        }
        updates.append((path, mode, original, after))
    # Validate all inputs and in-memory invariants before replacing any map.
    for path, mode, original, after in updates:
        Image.fromarray(after, mode).save(path)
        with Image.open(path) as image:
            saved = np.array(image)
            if image.mode != mode or not np.array_equal(saved, after):
                raise AssertionError(f"PNG roundtrip changed authored pixels: {path.name}")
        validation[path.name]["output_file_sha256"] = sha256(path.read_bytes())
        validation[path.name]["png_roundtrip_exact"] = True
    rgb = cores[0].astype(np.float64) / 255
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    luminance = linear @ [0.2126, 0.7152, 0.0722]
    metadata = {
        "authored": True, "generator": "art/blender/character_shirt_textures.py",
        "description": "Original restrained midgray cotton jersey with curved knitted yarn loops and shallow continuous relief; no photographs, random noise, or painted stitch bands",
        "atlas_size": [ATLAS_SIZE, ATLAS_SIZE],
        "allocation_xyxy_exclusive": list(ALLOCATION),
        "content_xyxy_exclusive": list(CONTENT), "periodic_gutter_pixels": GUTTER,
        "content_gltf_uv_edge_bounds": [x / ATLAS_SIZE for x in CONTENT],
        "content_blender_uv_edge_bounds": [CONTENT[0] / ATLAS_SIZE, 1 - CONTENT[3] / ATLAS_SIZE, CONTENT[2] / ATLAS_SIZE, 1 - CONTENT[1] / ATLAS_SIZE],
        "normal_convention": "Source male tangent RGB: normalize(-dH/dx,+dH/dy,1); runtime normalScale.y=-1",
        "packed_channels": {"R": "shirt dye mask = 255", "G": "linear roughness", "B": "skin mask = 0; material metallic factor remains zero"},
        "roughness_range": [float(cores[2][..., 1].min() / 255), float(cores[2][..., 1].max() / 255)],
        "roughness_mean": float(cores[2][..., 1].mean() / 255),
        "base_color_srgb_mean": rgb.mean(axis=(0, 1)).tolist(),
        "base_color_srgb_min": rgb.min(axis=(0, 1)).tolist(),
        "base_color_srgb_max": rgb.max(axis=(0, 1)).tolist(),
        "shirtDyeLuminance": float(luminance.mean()),
        "normal_rgb_min": cores[1].min(axis=(0, 1)).tolist(),
        "normal_rgb_max": cores[1].max(axis=(0, 1)).tolist(),
        "source_uv_clearance": proof, "cuff_skin_repair": cuff_report, "upper_arm_skin_islands":skin_proof,
        "allowed_change_regions": ["unused textile allocation", "original pure shirt-mask texels", "exact original skin-side cuff triangle footprints"],
        "source_shirt_surface_pixels":int(source_cloth.sum()),
        "validation": validation,
    }
    (directory / "male-crew-textile.json").write_text(json.dumps(metadata, indent=2) + "\n")
    Image.fromarray(cuff_allowed.astype(np.uint8)*255).save(directory / "male-crew-cuff-repair-mask.png")
    preview(preview_path, updates[0][2][y0:y1, x0:x1], updates[0][3][y0:y1, x0:x1], cores[0])
    print(json.dumps({"textures": str(directory), "metadata": str(directory / "male-crew-textile.json"), "preview": str(preview_path), "shirtDyeLuminance": metadata["shirtDyeLuminance"], "roughness_range": metadata["roughness_range"], "source_uv_intersections": proof["intersection_count"], "outside_changed_pixels": {name: value["outside_changed_pixels"] for name, value in validation.items()}}, indent=2))


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("textures", type=Path, help="Existing staged directory containing male texture PNGs")
    parser.add_argument("--preview", type=Path, help="Optional before/after preview PNG path")
    args = parser.parse_args()
    build(args.textures, args.preview or args.textures.parent / "male-crew-textile-preview.png")
