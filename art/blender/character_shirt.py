"""Original fitted crew shirt, derived from the CC0 civilian garment topology.

Called by character_clothing.py inside Blender. The original source triangles
remain a *reference* for the head graft; its assembler drops their IDs and merges
this authored garment into the same material batch. The exposed upper-arm cuff region is deliberately refitted; original hands,
forearms, sole support and rig remain unchanged. All dimensions are source bind-world centimetres.
"""
from pathlib import Path
import collections
import hashlib
import json
import heapq
import math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
from character_clothing_boundaries import Source

ROOT = Path(__file__).resolve().parents[2]


def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def crew_shirt(attrs, triangles, bind, joint_names, stage):
    source = Source(ROOT/'public/models/CivilianMale.glb')
    material=source.json['materials'][source.primitive['material']]
    image_index=source.json['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    view=source.json['bufferViews'][source.json['images'][image_index]['bufferView']]
    image_path=Path(stage,'male-shirt-source-sampling.png')
    start=view.get('byteOffset',0);image_path.write_bytes(source.binary[start:start+view['byteLength']])
    image=bpy.data.images.load(str(image_path),check_existing=False);image.colorspace_settings.name='Non-Color'
    pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32);image.pixels.foreach_get(pixels)
    pixels=pixels.reshape((image.size[1],image.size[0],4))[::-1]
    uv=source.attributes['TEXCOORD_0'][source.triangles].mean(axis=1)
    xx=np.minimum((uv[:,0]%1*image.size[0]).astype(int),image.size[0]-1);yy=np.minimum((uv[:,1]%1*image.size[1]).astype(int),image.size[1]-1)
    color=pixels[yy,xx,:3]*255
    center = source.world_positions[source.triangles].mean(axis=1)
    chroma = np.ptp(color, axis=1)/np.maximum(color.max(axis=1), 1)
    selected = (chroma < .18) & (color.mean(axis=1)>45) & (center[:,1]>22) & (center[:,1]<75)
    reference_faces = np.flatnonzero(selected)
    # Source shirt includes neutral-grey axilla triangles missed by the old UV
    # mask. Semantic topology selection covers those small islands explicitly.
    world = source.world_positions.copy()
    source_ids = np.unique(triangles[selected])
    _, representative, aliases = np.unique(np.round(world[source_ids]/1e-6).astype('i8'),axis=0,return_index=True,return_inverse=True)
    refs = source_ids[representative]
    reverse = np.full(len(world),-1); reverse[source_ids]=aliases
    faces = reverse[triangles[selected]].tolist()
    points = world[refs].copy()
    influences=[]
    for i in refs:
        influences.append({int(j):float(w) for j,w in zip(attrs['JOINTS_0'][i],attrs['WEIGHTS_0'][i]) if w>0})
    edge_count=collections.Counter(tuple(sorted((a,b))) for tri in faces for a,b in zip(tri,tri[1:]+tri[:1]))
    adjacency=collections.defaultdict(set)
    for a,b in edge_count:adjacency[a].add(b);adjacency[b].add(a)
    boundary=collections.defaultdict(set)
    for (a,b),n in edge_count.items():
        if n==1:boundary[a].add(b);boundary[b].add(a)
    loops=[];seen=set()
    for seed in boundary:
        if seed in seen:continue
        loop=[];previous=None;at=seed
        while at not in loop:
            loop.append(at);seen.add(at)
            following=next(i for i in boundary[at] if i!=previous)
            previous,at=at,following
        assert at==seed and all(len(boundary[i])==2 for i in loop)
        loops.append(loop)
    assert len(loops)==4, f'Expected neckline, two cuffs and hem; found {len(loops)}'
    collar=max(loops,key=lambda loop:points[loop,1].mean())
    cuffs=[loop for loop in loops if abs(points[loop,0].mean())>20]
    hem=min(loops,key=lambda loop:points[loop,1].mean())
    assert len(cuffs)==2

    # The grafted skin is a fitting reference, not a source of garment geometry.
    # Its lower-neck geometry is unchanged by hair, eyes or this garment pass.
    head=Source(ROOT/'public/models/CivilianMaleNatural.glb')
    neck_triangles=[];neck_weights=[]
    for mesh in head.json['meshes'][1:]:
        for primitive in mesh['primitives']:
            a=primitive['attributes']
            if '_SKIN_MASK' not in a:continue
            skin=head.accessor(a['_SKIN_MASK']).ravel();p=head.accessor(a['POSITION'])
            p=p@head.bind[:3,:3].T+head.bind[:3,3]
            ix=head.accessor(primitive['indices']).reshape(-1,3) if 'indices'in primitive else np.arange(len(p)).reshape(-1,3)
            js=head.accessor(a['JOINTS_0']);ws=head.accessor(a['WEIGHTS_0'])
            for tri in ix:
                if skin[tri].min()>.5 and p[tri,1].min()<77 and p[tri,1].max()>70:
                    neck_triangles.append(p[tri]);neck_weights.append([(js[i],ws[i]) for i in tri])
    neck=np.array(neck_triangles)
    original_skin=source.world_positions[source.triangles[~selected]]
    original_skin=original_skin[(original_skin[:,:,1].max(axis=1)>63)&(original_skin[:,:,1].min(axis=1)<70.01)]
    covered_neck=np.concatenate([neck,original_skin])
    def surface_radius(theta,h,surface):
        radial=np.array([math.cos(theta),0,math.sin(theta)])
        candidates=[]
        for v in surface[(surface[:,:,1].min(axis=1)<=h)&(surface[:,:,1].max(axis=1)>=h)]:
            section=[]
            for aa,bb in ((0,1),(1,2),(2,0)):
                if (v[aa,1]<h)!=(v[bb,1]<h):section.append(v[aa]+(v[bb]-v[aa])*((h-v[aa,1])/(v[bb,1]-v[aa,1])))
            if len(section)!=2:continue
            a,b=section;delta=b-a
            matrix=np.array([[radial[0],-delta[0]],[radial[2],-delta[2]]])
            if abs(np.linalg.det(matrix))<1e-9:continue
            r,t=np.linalg.solve(matrix,(a-neck_center)[[0,2]])
            if r>0 and -.00001<=t<=1.00001:candidates.append(r)
        return max(candidates) if candidates else None
    neck_center=np.array([-.70831424,0,3.05])
    def fit_neck(theta):
        # Fit above the source neck's broad lower flange. A raised, measured
        # opening gives a conventional crew rather than a wide boat neckline.
        h=74.5-1.0*max(0,math.sin(theta))+.3*max(0,-math.sin(theta))
        radial=np.array([math.cos(theta),0,math.sin(theta)])
        candidates=[]
        for v in neck:
            section=[]
            for aa,bb in ((0,1),(1,2),(2,0)):
                if (v[aa,1]<h)!=(v[bb,1]<h):section.append(v[aa]+(v[bb]-v[aa])*((h-v[aa,1])/(v[bb,1]-v[aa,1])))
            if len(section)!=2:continue
            a,b=section;delta=b-a
            # Ray/segment intersection in the horizontal plane.
            matrix=np.array([[radial[0],-delta[0]],[radial[2],-delta[2]]])
            if abs(np.linalg.det(matrix))<1e-9:continue
            r,t=np.linalg.solve(matrix,(a-neck_center)[[0,2]])
            if r>0 and -.00001<=t<=1.00001:candidates.append(r)
        assert candidates, f'Neck fitting ray missed at {theta}'
        return neck_center+radial*(max(candidates)+.28)+np.array([0,h,0])

    collar_old=points[collar].copy()
    collar_targets=[]
    for point in collar_old:
        theta=math.atan2(point[2]-neck_center[2],point[0]-neck_center[0])
        collar_targets.append(fit_neck(theta))
    collar_targets=np.array(collar_targets)
    # A geodesic weighted displacement spreads the new crew opening into the
    # upper panel. No hidden skin is moved to force a garment fit.
    distances=np.full((len(collar),len(points)),np.inf)
    for k,seed in enumerate(collar):
        queue=[(0,seed)];distances[k,seed]=0
        while queue:
            distance,i=heapq.heappop(queue)
            if distance!=distances[k,i] or distance>15:continue
            for j in adjacency[i]:
                d=distance+np.linalg.norm(points[j]-points[i])
                if d<distances[k,j]:distances[k,j]=d;heapq.heappush(queue,(d,j))
    weight=np.exp(-(distances/4.2)**2);weight[:,np.array(collar)]=0
    move=weight.T@(collar_targets-collar_old)/np.maximum(weight.sum(axis=0)[:,None],1e-12)
    fade=1-smooth(2,13,distances.min(axis=0))
    authored=points+move*fade[:,None]
    authored[collar]=collar_targets
    # The new opening is higher than the old V-neck. Transfer its supporting
    # neck skin weights, then blend those influences into the adjacent fabric;
    # retaining weights from the old cut lets a turning neck leave the collar.
    neck_tree=BVHTree.FromPolygons([Vector(p) for p in neck.reshape(-1,3)],
        np.arange(neck.size//3).reshape(-1,3).tolist(),all_triangles=True)
    collar_influences=[]
    for point in collar_targets:
        hit,_,face,_=neck_tree.find_nearest(Vector(point))
        bary=barycentric_transform(hit,*(Vector(p) for p in neck[face]),
            Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
        values=collections.defaultdict(float)
        for k,(js,ws) in enumerate(neck_weights[face]):
            for joint,value in zip(js,ws):values[int(joint)]+=float(value)*max(0,bary[k])
        total=sum(values.values());collar_influences.append({j:w/total for j,w in values.items()})
    for i in range(len(influences)):
        f=float(1-smooth(0,8,distances[:,i].min()))
        if f<=0:continue
        weights=np.exp(-(distances[:,i]/4.2)**2);weights/=weights.sum()
        values=collections.defaultdict(float)
        for joint,value in influences[i].items():values[joint]+=value*(1-f)
        for k,source_influence in enumerate(collar_influences):
            for joint,value in source_influence.items():values[joint]+=value*float(weights[k])*f
        influences[i]=dict(values)
    for i,values in zip(collar,collar_influences):influences[i]=values

    # Tailor the chest and the deltoid volume around the unchanged arm axes.
    # This is a textile shell, not an anatomical torso/body rescale.
    x=points[:,0]+.70831424;y=points[:,1];z=points[:,2]
    torso=(1-smooth(13,21,np.abs(x)))*smooth(25,38,y)*(1-smooth(61,69,y))
    authored[:,2]-=2.0*torso*smooth(8,19,z)
    authored[:,0]-=np.sign(x)*.8*torso*smooth(10,18,np.abs(x))
    arm_ids={side:next(i for i,n in enumerate(joint_names) if n.endswith(side+'Arm')) for side in ['Left','Right']}
    forearm_ids={side:next(i for i,n in enumerate(joint_names) if n.endswith(side+'ForeArm')) for side in ['Left','Right']}
    ib=source.accessor(source.skin['inverseBindMatrices'])
    def joint_point(index):return (source.bind@np.linalg.inv(ib[index].reshape(4,4,order='F')))[:3,3]
    cuff_targets={};upper_arm_contours=[]
    for side,sign in [('Left',1),('Right',-1)]:
        shoulder=joint_point(arm_ids[side]);elbow=joint_point(forearm_ids[side]);axis=elbow-shoulder;length=np.linalg.norm(axis);axis/=length
        relative=points-shoulder;t=relative@axis;radial=relative-t[:,None]*axis
        outward=radial[:,0]*sign
        # Keep the underarm junction and bare-skin cuff fixed; greatest change
        # is the excessive upper/outer deltoid, not torso-to-arm coverage.
        zone=smooth(10,18,np.abs(x))*(1-smooth(12,20,t))*smooth(-7,-1,t)
        radial_scale=.30*zone*smooth(-2,4,outward)
        authored-=radial*radial_scale[:,None]
        arm_weight=np.array([influence.get(arm_ids[side],0)+influence.get(forearm_ids[side],0) for influence in influences])
        fitted_relative=authored-shoulder;fitted_t=fitted_relative@axis;fitted_radial=fitted_relative-fitted_t[:,None]*axis
        radius=np.linalg.norm(fitted_radial,axis=1)
        sleeve_minimum=6.15-.35*smooth(4,19,t)
        allowance=np.maximum(sleeve_minimum-radius,0)*smooth(.3,.75,arm_weight)*smooth(2,7,t)*(1-smooth(15,20,t))
        authored+=fitted_radial/np.maximum(radius[:,None],1e-8)*allowance[:,None]
        # Move the sleeve opening to mid-bicep. An original skin extension
        # bridges it to the unchanged old exposed-arm boundary below.
        authored-=axis*(6.0*smooth(3,19,t)*smooth(.20,.70,arm_weight))[:,None]
        loop=next(loop for loop in cuffs if points[loop,0].mean()*sign>0)
        old=points[loop];old_t=(old-shoulder)@axis;old_radial=old-shoulder-old_t[:,None]*axis
        # A clean sewn opening is an oval normal to the upper-arm axis, not
        # the source's irregular painted cuff polyline translated upward.
        front=np.array([0.,0.,1.]);front-=axis*(front@axis);front/=np.linalg.norm(front)
        lateral=np.cross(axis,front);lateral/=np.linalg.norm(lateral)
        theta=np.arctan2(old_radial@front,old_radial@lateral)
        phase=np.unwrap(theta);direction=1 if np.median(np.diff(phase))>0 else -1
        # Source cuff zigzags occasionally reverse its angular order. Once
        # flattened into an anatomical section those reversals fold faces.
        theta=np.sort(phase)[::direction]
        radial_center=old_radial.mean(axis=0)
        cuff_center=shoulder+axis*(old_t.mean()-6.0)+radial_center
        skin_target=cuff_center+np.cos(theta)[:,None]*lateral*4.95+np.sin(theta)[:,None]*front*5.10
        outward=skin_target-cuff_center;outward/=np.linalg.norm(outward,axis=1)[:,None]
        cuff_targets[side]=(loop,skin_target,skin_target+outward*.22)
        lower_ring=shoulder+axis*old_t.mean()+radial_center+np.cos(theta)[:,None]*lateral*4.95+np.sin(theta)[:,None]*front*5.10
        upper_arm_contours.append((shoulder,axis,front,lateral,radial_center,old_t.mean(),
                                   np.array([int(refs[i]) for i in loop]),arm_ids[side],forearm_ids[side],lower_ring))
        # A fitted set-in sleeve is one gently tapered panel, not the original
        # long sleeve compressed into a bulging ring. Blend onto the measured
        # cuff axis while retaining the shoulder/axilla transition.
        current=authored-shoulder
        longitudinal=current@axis
        cross=current-longitudinal[:,None]*axis-radial_center
        angle=np.arctan2(cross@front,cross@lateral)
        progress=np.clip((longitudinal-1.0)/(old_t.mean()-7.0),0,1)
        side_radius=6.05+(5.17-6.05)*progress
        front_radius=6.20+(5.32-6.20)*progress
        target=shoulder+longitudinal[:,None]*axis+radial_center+np.cos(angle)[:,None]*lateral*side_radius[:,None]+np.sin(angle)[:,None]*front*front_radius[:,None]
        blend=smooth(1,6,t)*smooth(.25,.68,arm_weight)
        authored+=(target-authored)*blend[:,None]

    # Keep the lower hem on the original contact contour.
    fixed=set(hem)
    fixed_distance=np.full(len(points),np.inf);queue=[]
    for i in fixed:fixed_distance[i]=0;heapq.heappush(queue,(0,i))
    while queue:
        d,i=heapq.heappop(queue)
        if d!=fixed_distance[i] or d>6:continue
        for j in adjacency[i]:
            candidate=d+np.linalg.norm(points[j]-points[i])
            if candidate<fixed_distance[j]:fixed_distance[j]=candidate;heapq.heappush(queue,(candidate,j))
    authored=points+(authored-points)*smooth(0,5,fixed_distance)[:,None]
    authored[list(fixed)]=points[list(fixed)]
    for loop,skin_target,cloth_target in cuff_targets.values():authored[loop]=cloth_target

    # One midpoint subdivision gives clean, editable panel topology without
    # changing cuff/hem anchors or multiplying independent material batches.
    vertices=authored.tolist();source_vertices=points.tolist();new_influences=list(influences);edge_mid={}
    def midpoint(a,b):
        key=tuple(sorted((a,b)))
        if key in edge_mid:return edge_mid[key]
        i=len(vertices);edge_mid[key]=i;vertices.append(((authored[a]+authored[b])*.5).tolist());source_vertices.append(((points[a]+points[b])*.5).tolist())
        weights=collections.defaultdict(float)
        for old in [a,b]:
            for joint,value in influences[old].items():weights[joint]+=value*.5
        new_influences.append(dict(weights));return i
    new_faces=[]
    for a,b,c in faces:
        ab=midpoint(a,b);bc=midpoint(b,c);ca=midpoint(c,a)
        new_faces.extend([(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)])
    new_loops=[]
    for loop in loops:new_loops.append([v for k,a in enumerate(loop) for v in (a,edge_mid[tuple(sorted((a,loop[(k+1)%len(loop)])))] )])
    collar_index=loops.index(collar);collar=new_loops[collar_index]
    vertices=np.array(vertices);reference=np.array(source_vertices)
    # Reproject newly split collar points onto the smooth measured neck ring.
    for i in collar:vertices[i]=fit_neck(math.atan2(vertices[i,2]-neck_center[2],vertices[i,0]-neck_center[0]))
    neighbors=[set() for _ in vertices]
    for tri in new_faces:
        for a,b in zip(tri,tri[1:]+tri[:1]):neighbors[a].add(b);neighbors[b].add(a)
    boundary_ids={i for loop in new_loops for i in loop}
    # Small constrained Laplacian relaxation removes source faceting while
    # keeping panel volume; Taubin's negative pass counters shrinkage.
    for _ in range(4):
        for amount in [.32,-.33]:
            delta=np.array([vertices[list(n)].mean(0)-vertices[i] for i,n in enumerate(neighbors)])
            delta[list(boundary_ids)]=0;vertices+=delta*amount
    # Cover the unchanged original V-neck skin beneath the new crew opening.
    # This is a measured outer-shell constraint, not removal/sculpting of skin.
    for i,p in enumerate(vertices):
        if 58<p[1]<76 and abs(p[0]+.708)<17:
            theta=math.atan2(p[2]-neck_center[2],p[0]-neck_center[0])
            skin_radius=surface_radius(theta,p[1],covered_neck)
            radius=np.linalg.norm((p-neck_center)[[0,2]])
            if skin_radius is not None and radius<skin_radius+.60:
                vertices[i,[0,2]]=neck_center[[0,2]]+np.array([math.cos(theta),math.sin(theta)])*(skin_radius+.60)
    # Deliberate low-amplitude cloth compression at the side/hem, not a global
    # sine/noise displacement over a muscle-shaped source.
    normals=np.zeros_like(vertices)
    for a,b,c in new_faces:
        n=np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a])
        for i in [a,b,c]:normals[i]+=n
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
    fold=.14*np.sin((vertices[:,1]-25)*1.25+(vertices[:,0]+.708)*.19)*np.exp(-((vertices[:,1]-29)/5)**2)*smooth(0,4,np.array([min(np.linalg.norm(vertices[i]-vertices[j]) for j in boundary_ids) for i in range(len(vertices))]))
    vertices+=normals*fold[:,None]

    # Collar facing is a genuine folded rib edge connected to the upper panel.
    # It stays continuous around the neck, with no detached bridge across skin.
    base_count=len(vertices);rim_vertices=[];rim_influences=[];rim_faces=[]
    for i in collar:
        radial=vertices[i]-np.array([neck_center[0],vertices[i,1],neck_center[2]]);radial/=np.linalg.norm(radial)
        for outward,drop in [(.06,0),(.22,.10),(.72,.45),(.88,.62)]:
            rim_vertices.append(vertices[i]+radial*outward-np.array([0,drop,0]));rim_influences.append(new_influences[i])
    for k in range(len(collar)):
        nxt=(k+1)%len(collar)
        for row in range(3):
            a=base_count+k*4+row;b=base_count+nxt*4+row
            rim_faces.extend([(a,b,a+1),(a+1,b,b+1)])
    vertices=np.concatenate([vertices,np.array(rim_vertices)]);new_influences+=rim_influences
    # Triangle winding is verified against the adjacent body's outward direction.
    for k,tri in enumerate(rim_faces):
        a,b,c=tri;normal=np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a]);outward=vertices[a]-np.array([neck_center[0],vertices[a,1]-8,neck_center[2]])
        if normal@outward<0:rim_faces[k]=(a,c,b)
    new_faces+=rim_faces
    # The set-in sleeve join is a narrow seam following each actual upper-arm
    # surface section. It supplies a construction break without a shoulder pad.
    seam_vertices=[];seam_influences=[];seam_faces=[]
    def blend_weight(a,b,f):
        out=collections.defaultdict(float)
        for index,scale in [(a,1-f),(b,f)]:
            for joint,w in new_influences[index].items():out[joint]+=w*scale
        return dict(out)
    for side,sign in [('Left',1),('Right',-1)]:
        shoulder=joint_point(arm_ids[side]);axis=joint_point(forearm_ids[side])-shoulder;axis/=np.linalg.norm(axis)
        for triangle in new_faces[:len(faces)*4]:
            coords=vertices[list(triangle)];t=(coords-shoulder)@axis-2.5
            if coords[:,0].mean()*sign<13 or not(t.min()<0<t.max()):continue
            hits=[]
            for aa,bb in ((0,1),(1,2),(2,0)):
                if (t[aa]<0)!=(t[bb]<0):
                    f=-t[aa]/(t[bb]-t[aa]);a=triangle[aa];b=triangle[bb]
                    hits.append((vertices[a]+(vertices[b]-vertices[a])*f,blend_weight(a,b,f)))
            if len(hits)!=2:continue
            a,b=[hit[0] for hit in hits];n=np.cross(coords[1]-coords[0],coords[2]-coords[0]);n/=np.linalg.norm(n)
            if np.linalg.norm(b-a)<1e-5:continue
            across=np.cross(b-a,n);across/=np.linalg.norm(across)
            start=len(vertices)+len(seam_vertices)
            for point,influence in hits:
                for side_offset in [-.20,.20]:seam_vertices.append(point+across*side_offset+n*.055);seam_influences.append(influence)
            pair=[(start,start+2,start+1),(start+1,start+2,start+3)]
            if np.cross(seam_vertices[-2]-seam_vertices[-4],seam_vertices[-3]-seam_vertices[-4])@n<0:pair=[(a,c,b) for a,b,c in pair]
            seam_faces+=pair
    vertices=np.concatenate([vertices,np.array(seam_vertices)])
    new_influences+=seam_influences;new_faces+=seam_faces
    normals=np.zeros_like(vertices)
    for a,b,c in new_faces:
        n=np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a])
        for i in [a,b,c]:normals[i]+=n
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
    joints=[];weights=[]
    for influence in new_influences:
        pairs=sorted(influence.items(),key=lambda a:a[1],reverse=True)[:4];pairs += [(0,0)]*(4-len(pairs));total=sum(v for _,v in pairs)
        joints.append([j for j,_ in pairs]);weights.append([w/total for _,w in pairs])
    inverse=np.linalg.inv(np.array(bind));local=(vertices-np.array(bind)[:3,3])@inverse[:3,:3].T
    local_normal=normals@np.array(bind)[:3,:3];local_normal/=np.linalg.norm(local_normal,axis=1)[:,None]
    # UV placeholder: caller packs this procedural woven textile into a verified
    # unused atlas tile, retaining all skin/denim/shoe UVs and texture pixels.
    uv=np.column_stack([(vertices[:,0]+42)/84,(vertices[:,1]-18)/58])
    uv=np.clip(uv,.02,.98)
    result={'POSITION':local,'NORMAL':local_normal,'TEXCOORD_0':uv,'JOINTS_0':np.array(joints),'WEIGHTS_0':np.array(weights),'COLOR_0':np.ones((len(vertices),4))}
    report={'authored':True,'source':'CC0 EmoPreben male shirt surface, original crew construction and fit',
        'replacedSourceTriangles':reference_faces.tolist(),'replacementTriangles':len(new_faces),'replacementVertices':len(vertices),
        'hemSourceAnchorsExact':True,'originalExposedSkinUnchanged':False,'sleeveShorteningCm':6.0,'neckOpeningBindWorldCm':vertices[collar].tolist(),
        'collarVertices':collar,'referenceNeckSha256':hashlib.sha256(neck.astype('<f4').tobytes()).hexdigest(),
        'shirtMainVertexCount':base_count,'collarFacingVertexCount':len(rim_vertices),'armholeSeamTriangles':len(seam_faces),
        'sourceBoundaryLoops':[[int(refs[i]) for i in loop] for loop in loops],
        'replacementBoundaryLoops':new_loops,'worldUnits':'centimetres',
        'maximumOriginalGarmentDisplacementCm':float(np.linalg.norm(authored-points,axis=1).max())}
    result['_GARMENT_MASK']=np.ones((len(vertices),1),dtype=np.float32)
    # Preserve actual exposed upper-arm skin rather than leaving a hollow short
    # sleeve. This helper derives its samples from the original skin-side seam.
    from character_sleeve_skin import extend_sleeve_skin, fit_upper_arm_boundary
    upper_arm_faces,upper_arm_report=fit_upper_arm_boundary(source,upper_arm_contours,reference_faces)
    # Include the complete original cuff-side footprint, including one face
    # whose vertices needed no shape change but whose UVs still touch cloth.
    from character_sleeve_skin import CUFF_SKIN_FACES
    upper_arm_faces=np.unique(np.concatenate([upper_arm_faces,*[np.asarray(v) for v in CUFF_SKIN_FACES.values()]]))
    # Replace the malformed old cuff skin rather than retaining a cloth-shaped
    # ridge under the shortened sleeve. All original rig/UV values are copied.
    skin_ids=source.triangles[upper_arm_faces].reshape(-1)
    skin_uv=source.attributes['TEXCOORD_0'][skin_ids].copy()
    for data,side in zip(upper_arm_contours,['Left','Right']):
        shoulder,axis,front,lateral,radial_center,cuff_t,_,_,_,_=data
        points_skin=source.world_positions[skin_ids];choose=points_skin[:,0]>0 if side=='Left' else points_skin[:,0]<0
        relative=points_skin-shoulder;t=relative@axis
        radial=relative-t[:,None]*axis-radial_center
        angle=np.arctan2(radial@front,radial@lateral)
        bounds=np.asarray([1921,1505,2015,1727] if side=='Left' else [1921,1761,2015,1983])/2048
        uv=np.column_stack([.08+.84*(angle+math.pi)/(2*math.pi),.08+.84*np.clip((t-16)/14,0,1)])
        skin_uv[choose]=(bounds[:2]+uv*(bounds[2:]-bounds[:2]))[choose]
    start=len(result['POSITION'])
    new_faces.extend((np.arange(len(skin_ids)).reshape(-1,3)+start).tolist())
    for key in result:
        extra=(np.zeros((len(skin_ids),1)) if key=='_GARMENT_MASK' else
               np.ones((len(skin_ids),4)) if key=='COLOR_0' else skin_uv if key=='TEXCOORD_0' else source.attributes[key][skin_ids])
        result[key]=np.concatenate([result[key],np.asarray(extra,dtype=result[key].dtype)])
    report['upperArmRefit']=upper_arm_report
    hem_faces=np.array([],dtype=int)
    report['retainedHemTextileSourceFaceIds']=[]
    # The old low V-neck left a separate strip of exposed chest below the new
    # crew opening. It is entirely covered now; discard these hidden source
    # faces after the graft has measured their original cut contour, avoiding
    # a second animated skin surface poking through during head turns.
    original_tri=world[source.triangles]
    hidden_neck=np.flatnonzero((np.abs(original_tri[:,:,0]+.708).max(axis=1)<17)&
        (original_tri[:,:,1].min(axis=1)>58)&(original_tri[:,:,1].max(axis=1)<76)&~selected)
    report['hiddenNeckSourceFaceIds']=hidden_neck.tolist()
    report['replacedSourceTriangles']=np.unique(np.concatenate([reference_faces,upper_arm_faces,hidden_neck,hem_faces])).tolist()
    report['originalExposedSkinUnchanged']=False
    packed_image=bpy.data.images.load(str(Path(stage,'textures/male-roughness.png')),check_existing=False);packed_image.colorspace_settings.name='Non-Color'
    packed_pixels=np.empty(packed_image.size[0]*packed_image.size[1]*4,dtype=np.float32);packed_image.pixels.foreach_get(packed_pixels)
    skin_uv_mask=packed_pixels.reshape((packed_image.size[1],packed_image.size[0],4))[::-1]
    skin_reports=[]
    for side,(loop,skin_target,_) in cuff_targets.items():
        bounds=([1921,1505,2015,1727] if side=='Left' else [1921,1761,2015,1983])
        extension,extension_faces,skin_report=extend_sleeve_skin(source,[int(refs[i]) for i in loop],skin_target,bind,replaced_face_ids=reference_faces,skin_uv_mask=skin_uv_mask,skin_uv_bounds=(np.asarray(bounds)/2048).tolist())
        start=len(result['POSITION']);new_faces.extend((np.asarray(extension_faces)+start).tolist())
        for key in result:result[key]=np.concatenate([result[key],np.asarray(extension[key],dtype=result[key].dtype)])
        skin_reports.append({'side':side,**skin_report})
    report['skinExtensions']=skin_reports;report['replacementTriangles']=len(new_faces);report['replacementVertices']=len(result['POSITION'])
    Path(stage,'male-crew-shirt.json').write_text(json.dumps(report,indent=2))
    return result,np.array(new_faces,dtype='i8'),report
