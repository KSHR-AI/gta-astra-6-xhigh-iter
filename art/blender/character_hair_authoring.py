"""Original short swept hairstyle over the credited MakeHuman short04 scalp.

Keep the alpha-feathered scalp component for coverage, remove the source's
square-edged long card plates and author a shaped, smooth short sweep with
sparse narrow silhouette locks. No head,
eye, eyelid, neck or rig coordinates are edited. The original complete hair
mesh stays packed as an unexported source datablock for repeatable authoring.
"""
import math
import random
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _smooth(a,b,x):
    t=max(0.,min(1.,(x-a)/(b-a)))
    return t*t*(3-2*t)


def author_short_hair():
    obj=bpy.data.objects['male_hair_short04']
    source=bpy.data.meshes.get('Astra short04 complete source')
    if source is None:
        source=obj.data.copy();source.name='Astra short04 complete source';source.use_fake_user=True
    original=source.attributes.get('astra_hair_rest')
    assert original is not None,'Original short04 rest coordinates are required'
    positions=[a.vector.copy() for a in original.data]
    adjacency=[set() for _ in positions]
    for polygon in source.polygons:
        for i in polygon.vertices:adjacency[i].update(polygon.vertices)
    visited=set();components=[]
    for i in range(len(positions)):
        if i in visited:continue
        todo=[i];visited.add(i);component=[]
        while todo:
            v=todo.pop();component.append(v)
            for n in adjacency[v]:
                if n not in visited:visited.add(n);todo.append(n)
        components.append(component)
    scalp=set(max(components,key=len));assert len(scalp)==285 and len(components)==22
    ids=sorted(scalp);remap={old:new for new,old in enumerate(ids)}
    kept=[p for p in source.polygons if all(i in scalp for i in p.vertices)]
    points=[]
    for i in ids:
        p=positions[i].copy()
        # Retain the fitted scalp and close nape. Slight asymmetric crown shape
        # supports the swept locks without inflating the sides into a helmet.
        if p.y>.08 and p.z<8.05:
            strength=min(1,(p.y-.08)/.28)*min(1,(8.05-p.z)/.45)
            p.z+=.22*strength;p.y-=.055*strength
        crown=_smooth(8.72,9.25,p.z)
        p.x+=.025*crown
        p.z+=.045*crown*(.55+.45*math.sin(3*p.y+1.4))
        points.append(p)
    mesh=bpy.data.meshes.new('male_hair_short04Mesh')
    mesh.from_pydata(points,[],[[remap[i] for i in p.vertices]for p in kept]);mesh.update()
    layer=mesh.uv_layers.new(name='UVMap')
    for dst,src in zip(mesh.polygons,kept):
        dst.use_smooth=True
        for d,s in zip(dst.loop_indices,src.loop_indices):layer.data[d].uv=source.uv_layers.active.data[s].uv
    for material in source.materials:mesh.materials.append(material)
    center=Vector((0,-.38,8.44));radius=Vector((.76,.99,.93))
    def normal(p):
        return Vector(tuple((p[k]-center[k])/(radius[k]*radius[k])for k in range(3))).normalized()
    old=obj.data;obj.data=mesh
    if old.users==0:bpy.data.meshes.remove(old)
    mesh.name='male_hair_short04Mesh'
    # One applied hair-only subdivision removes the original angular crown.
    # Exporters intentionally omit preview modifiers, so this edit is actual
    # source topology, with interpolated source UVs and the fine alpha hairline.
    obj.hide_set(False);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    refinement=obj.modifiers.new('Authored scalp refinement','SUBSURF')
    refinement.levels=1;refinement.render_levels=1
    bpy.ops.object.modifier_apply(modifier=refinement.name)
    mesh=obj.data;mesh.name='male_hair_short04Mesh'
    # Sculpt a restrained asymmetric short sweep rather than a uniformly round
    # cap. The coherent broad rise and shallow directional ridges are geometry,
    # while the retained CC0 fiber texture supplies close surface detail.
    for v in mesh.vertices:
        p=v.co.copy();crown=_smooth(8.73,9.22,p.z)
        quiff=.095*math.exp(-((p.x+.20)/.42)**2-((p.y+.93)/.46)**2)*crown
        ridge=.009*math.sin(p.x*24+p.y*7)*crown
        v.co=p+normal(p)*(.006+ridge)+Vector((0,0,quiff))
    # The former overlay plates concealed a few source scalp intersections.
    # Fit the retained shell outside the untouched head surface, including the
    # newly smoothed side/crown vertices, rather than leaving skin pinholes.
    head=bpy.data.objects['male_head'].data
    head.calc_loop_triangles()
    head_tree=BVHTree.FromPolygons([v.co for v in head.vertices],[list(t.vertices)for t in head.loop_triangles],all_triangles=True)
    clearance_corrections=0;maximum_clearance_correction=0.
    for _ in range(3):
        for v in mesh.vertices:
            if v.co.z<8.4:continue
            hit,n,_,distance=head_tree.find_nearest(v.co)
            signed=(v.co-hit).dot(n)
            if signed<.015:
                correction=.015-signed
                assert correction<.10,'Unexpected scalp/head fit discrepancy'
                v.co+=n*correction
                clearance_corrections+=1;maximum_clearance_correction=max(maximum_clearance_correction,correction)
    # Vertex clearance alone misses grazing skin bumps inside a hair triangle.
    # Sample actual rendered triangles and lift only the local supporting
    # vertices; this closes tiny pinholes without expanding the whole haircut.
    barycentrics=[(1/3,1/3,1/3),(.6,.2,.2),(.2,.6,.2),(.2,.2,.6)]
    interior_corrections=0
    for _ in range(4):
        mesh.update();mesh.calc_loop_triangles();corrections={}
        for triangle in mesh.loop_triangles:
            ids=list(triangle.vertices);p=[mesh.vertices[i].co for i in ids]
            for weights in barycentrics:
                sample=sum((q*w for q,w in zip(p,weights)),Vector())
                if sample.z<8.4:continue
                hit,n,_,_=head_tree.find_nearest(sample);signed=(sample-hit).dot(n)
                if signed<.009:
                    delta=n*(.012-signed)
                    for i in ids:
                        if i not in corrections or delta.length>corrections[i].length:corrections[i]=delta
        if not corrections:break
        for i,delta in corrections.items():mesh.vertices[i].co+=delta
        interior_corrections+=len(corrections)
    mesh.update()
    # Validate triangle interiors at a finer spacing than the repair samples.
    # Limit this invariant to the exposed scalp above the ears: the retained
    # lower shell intentionally tucks behind the ear surfaces, so a nearest-
    # triangle signed distance there is not an exposed-scalp clearance test.
    mesh.calc_loop_triangles()
    exposed_samples=0;minimum_exposed_clearance=float('inf')
    for triangle in mesh.loop_triangles:
        p=[mesh.vertices[i].co for i in triangle.vertices]
        for a in range(13):
            for b in range(13-a):
                sample=(p[0]*a+p[1]*b+p[2]*(12-a-b))/12
                if sample.z<8.4:continue
                hit,n,_,_=head_tree.find_nearest(sample)
                minimum_exposed_clearance=min(minimum_exposed_clearance,(sample-hit).dot(n))
                exposed_samples+=1
    assert minimum_exposed_clearance>.004,'Exposed scalp needs triangle-interior clearance repair'
    for p in mesh.polygons:p.use_smooth=True
    obj['authorship']='CC0 short04 alpha-feathered scalp retained and refined; original asymmetric crown/nape shape. Twenty-one opaque-edged legacy overlay cards removed.'
    points=[v.co.copy()for v in mesh.vertices]
    tree=BVHTree.FromPolygons(points,[list(p.vertices)for p in mesh.polygons],all_triangles=False)
    vertices=[];faces=[];uvs=[];lock_kinds={};rng=random.Random(73191)

    def lock(start,flow,length,width,lift,kind,segments=7):
        """A convex three-vertex ribbon, tapered geometrically at both ends.

        Coherent locks create visible form. A dense matte center survives
        minification while restrained strand edges soften the physical taper.
        """
        start=Vector(start);flow=Vector(flow).normalized();first=len(vertices)
        phase=rng.uniform(-1,1);path=[]
        for k in range(segments+1):
            t=k/segments
            probe=start+flow*(length*t)+Vector((.045*math.sin(math.pi*t)*phase,0,.025*math.sin(math.pi*t)))
            hit,_,_,_=tree.find_nearest(probe)
            p=hit.copy() if hit is not None else probe
            n=normal(p)
            root_lift=.002
            p+=n*(root_lift+lift*math.sin(math.pi*t)**.85)
            # A small terminal lift breaks the crown outline, without a forest
            # of detached flyaways. Roots stay fitted to the feathered scalp.
            p+=n*(.008*t*t)
            tangent=(flow-n*flow.dot(n)).normalized()
            across=tangent.cross(n).normalized()
            taper=(.10+.90*math.sin(math.pi*t)**.65)*(1-.82*t**5)
            w=width*taper
            for u in (-1,0,1):
                ridge=(1-abs(u))*width*.035*math.sin(math.pi*t)
                vertices.append(tuple(p+across*(w*u)+n*ridge));uvs.append(((u+1)/2,t))
            path.append(p)
        for k in range(segments):
            for q in range(2):
                a=first+k*3+q;faces.append((a,a+1,a+4,a+3))
        lock_kinds[kind]=lock_kinds.get(kind,0)+1

    # Sparse narrow accents only. All roots are buried inside alpha-covered
    # hair, leaving the original fine forehead and temple transition visible.
    # These are 1–2 mm wide and 1–2 cm long after the fitted head's world scale.
    for i in range(12):
        x=-.53+i/11*1.06+rng.uniform(-.02,.02)
        y=-.72+rng.uniform(-.14,.24)
        hit,_,_,_=tree.find_nearest(Vector((x,y,9.8)))
        lock(hit,(.25,.68,-.10),rng.uniform(.11,.20),rng.uniform(.004,.008),rng.uniform(.003,.007),'crown',segments=5)
    for sign in (-1,1):
        for i in range(2):
            root=(sign*.72,-.68+i*.22,8.70+i*.15)
            lock(root,(sign*.04,.55,-.6),rng.uniform(.11,.17),rng.uniform(.004,.007),.003,'side',segments=5)

    old_detail=bpy.data.objects.get('male_hair_strands')
    if old_detail:
        old_mesh=old_detail.data;bpy.data.objects.remove(old_detail,do_unlink=True)
        if old_mesh.users==0:bpy.data.meshes.remove(old_mesh)
    detail_mesh=bpy.data.meshes.new('male_hair_strandsMesh')
    detail_mesh.from_pydata(vertices,[],faces);detail_mesh.update()
    uv_layer=detail_mesh.uv_layers.new(name='UVMap')
    for polygon in detail_mesh.polygons:
        polygon.use_smooth=True
        for loop in polygon.loop_indices:uv_layer.data[loop].uv=uvs[detail_mesh.loops[loop].vertex_index]
    # Adjacent locks share scalp-facing normals, avoiding specular plate bands
    # while their actual raised geometry still controls the silhouette.
    detail_mesh.normals_split_custom_set_from_vertices([normal(v.co)for v in detail_mesh.vertices])
    detail=bpy.data.objects.new('male_hair_strands',detail_mesh)
    bpy.data.collections['MakeHuman_male'].objects.link(detail)
    detail['source']='Original project-authored sparse short silhouette locks with buried roots and geometric root/tip taper; no downloaded hair cards'
    detail['asset_license']='Original repository artwork over credited CC0 short04 scalp'
    image_name='Astra original swept lock color'
    image=bpy.data.images.get(image_name)
    if image:bpy.data.images.remove(image)
    width,height=128,256;image=bpy.data.images.new(image_name,width=width,height=height,alpha=True)
    pixels=[]
    for y in range(height):
        t=y/(height-1)
        for x in range(width):
            u=x/(width-1)
            warp=.010*math.sin(t*6.0)+.006*math.sin(t*13.0)
            fiber=.5+.5*math.sin((u+warp)*math.pi*39+.25*math.sin(t*8))
            fine=.5+.5*math.sin((u+warp)*math.pi*83+t*.6)
            shade=.23+.13*fiber+.035*fine
            # The dense center stays above the final alpha cutoff in normal
            # minification; only the perimeter breaks into irregular fibers.
            edge=_smooth(0,.14,u)*_smooth(0,.14,1-u)
            tip=_smooth(0,.045+.055*fiber,t)*_smooth(0,.08+.13*fine,1-t)
            alpha=edge*tip*(.83+.17*fiber)
            pixels.extend((shade,shade,shade,alpha))
    image.pixels=pixels;image.pack()
    mat=bpy.data.materials.get('male_hair_strand_detail')
    if mat:bpy.data.materials.remove(mat)
    mat=bpy.data.materials.new('male_hair_strand_detail');mat.use_nodes=True
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;shader=nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value=.85;shader.inputs['Specular IOR Level'].default_value=.2
    tex=nodes.new('ShaderNodeTexImage');tex.image=image
    tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=(.32,.22,.14,1)
    links.new(tex.outputs['Color'],tint.inputs[1]);links.new(tint.outputs[0],shader.inputs['Base Color']);links.new(tex.outputs['Alpha'],shader.inputs['Alpha'])
    mat.surface_render_method='DITHERED';mat.use_transparency_overlap=False
    mat.use_backface_culling=False;detail_mesh.materials.append(mat)
    return {'source_components':len(components),'retained_source_scalp_vertices':len(scalp),'refined_scalp_vertices':len(points),'removed_legacy_card_components':len(components)-1,
        'scalp_clearance_corrections':clearance_corrections,'triangle_interior_clearance_corrections':interior_corrections,'maximum_native_clearance_correction':maximum_clearance_correction,
        'exposed_scalp_clearance':{'samples':exposed_samples,'minimum_native_units':minimum_exposed_clearance,'minimum_native_z':8.4},
        'scalp_triangles':sum(len(p.vertices)-2 for p in mesh.polygons),'original_locks':lock_kinds,
        'detail_triangles':len(faces)*2,'texture':[width,height],'lock_alpha':'dense center; feathered strand perimeter plus physical root/tip taper',
        'roughness':.85,'blender_specular':.2,'glTF_specular_intensity':.4}
