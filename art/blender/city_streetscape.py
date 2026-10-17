"""Rebuild original street furniture: blender -b -t 2 --python this_file.py.

No downloaded meshes or textures. Models are authored in metres, joined by
material, and exported as a single glTF library with three named asset roots.
"""
import bpy, math, json, subprocess, shutil
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/city'
OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([shutil.which('python3'),str(Path(__file__).with_name('city_textures.py'))],check=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def rgb(hexcode):
    rgb=[int(hexcode[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(((v+.055)/1.055)**2.4 if v>.04045 else v/12.92 for v in rgb)

def material(name,color,rough=.65,metal=0,alpha=1):
    m=bpy.data.materials.new(name);m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF')
    s.inputs['Base Color'].default_value=(*rgb(color),alpha)
    s.inputs['Roughness'].default_value=rough;s.inputs['Metallic'].default_value=metal
    s.inputs['Alpha'].default_value=alpha
    if alpha<1:m.surface_render_method='DITHERED'
    return m

M={
 'Steel':material('City / graphite powdercoat','#303d3b',.46,.65),
 'Bronze':material('City / brushed bronze','#a78a60',.35,.7),
 'Wood':material('City / oiled teak','#92724b',.76),
 'Ivory':material('City / warm enamel','#d9d0b9',.38,.16),
 'Rust':material('City / burnt sienna fabric','#ba704e',.94),
 'Teal':material('City / petrol enamel','#41655c',.47,.25),
 'Cream':material('City / woven linen','#e2d4af',.96),
 'Dark':material('City / shadow and rubber','#242c28',.91),
 'Glass':material('City / smoked safety glass','#a1b8ad',.15,.12,.24),
}
atlas=bpy.data.images.load(str(OUT/'city-atlas.png'));atlas.pack()
M['Print']=material('City / original printed graphics','#ffffff',.84)
tex=M['Print'].node_tree.nodes.new('ShaderNodeTexImage');tex.image=atlas
M['Print'].node_tree.links.new(tex.outputs['Color'],M['Print'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def p(x,y,z):return (x,-z,y)
def finish(obj,name,mat):
    obj.name=name;obj.data.materials.append(M[mat]);return obj
def box(name,loc,size,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(*loc));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=bevel;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mat)
def rod(name,a,b,r,mat,vertices=10):
    a,b=Vector(p(*a)),Vector(p(*b));v=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=v.length,location=(a+b)*.5)
    o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=v.to_track_quat('Z','Y')
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return finish(o,name,mat)
def disc(name,x,y,z,r,h,mat,vertices=20):return rod(name,(x,y-h/2,z),(x,y+h/2,z),r,mat,vertices)
def mesh(name,vertices,faces,mat):
    data=bpy.data.meshes.new(name);data.from_pydata([p(*v) for v in vertices],[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);return finish(obj,name,mat)
def graphic(name,x,y,z,w,h,tile=0,strip=None,angle=0):
    # Front normal faces +Z in game coordinates. Rotation uses game yaw.
    verts=[]
    for dx,dy in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]:verts.append((x+dx*math.cos(angle),y+dy,z-dx*math.sin(angle)))
    o=mesh(name,verts,[(0,1,2,3)],'Print');uv=o.data.uv_layers.new()
    if strip is None:
        u0=(tile%2)*.5;v0=.5 if tile<2 else 0;u1=u0+.5;v1=v0+.5
    else:u0=.5;u1=1;v1=.5-strip/16;v0=v1-1/16
    for loop,xy in zip(o.data.polygons[0].loop_indices,[(u0,v0),(u1,v0),(u1,v1),(u0,v1)]):uv.data[loop].uv=xy
    return o
def bent_tube(name,points,r,mat):
    for i in range(len(points)-1):rod(name,points[i],points[i+1],r,mat,8)

ASSETS={}
def start():return set(bpy.data.objects)
def end(name,before,display_x):
    objects=[o for o in bpy.data.objects if o not in before]
    root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
    groups={}
    for obj in objects:groups.setdefault(obj.active_material.name,[]).append(obj)
    for mat,parts in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in parts:obj.select_set(True)
        bpy.context.view_layer.objects.active=parts[0]
        if len(parts)>1:bpy.ops.object.join()
        obj=bpy.context.object;obj.name=f'{name} / {mat}';obj.parent=root
    root.location.x=display_x
    ASSETS[name]=root

# Bus shelter: cantilever canopy, glass, inset advertising cabinet and teak bench.
before=start()
for x in [-2.55,2.55]:
    for z in [-.85,.85]:
        box('Bolted foot',(x,.065,z),(.23,.12,.23),'Steel',.025)
        rod('Structural upright',(x,.12,z),(x,2.75,z),.055,'Steel')
        for dx in [-.075,.075]:disc('Anchor bolt',x+dx,.13,z,.024,.025,'Bronze',8)
for z in [-.93,.93]:box('Roof edge rail',(0,2.78,z),(5.66,.17,.11),'Bronze',.025)
for x in [-2.77,2.77]:box('Roof side rail',(x,2.78,0),(.1,.17,2),'Bronze',.025)
verts=[];faces=[]
for i in range(13):
    z=-1.03+i*2.06/12;y=2.79+.2*math.cos(z/1.03*math.pi/2)
    verts.extend([(-2.84,y,z),(2.84,y,z)])
for i in range(12):faces.append((i*2,i*2+1,i*2+3,i*2+2))
roof=mesh('Rolled canopy',verts,faces,'Ivory');mod=roof.modifiers.new('Roof thickness','SOLIDIFY');mod.thickness=.065;bpy.context.view_layer.objects.active=roof;bpy.ops.object.modifier_apply(modifier=mod.name)
for x in [-2.5,0,2.5]:
    bent_tube('Canopy ribs',[(x,2.72,-.9),(x,2.91,0),(x,2.72,.9)],.026,'Steel')
for x in [-1.7,-.35,.99]:
    box('Back safety glazing',(x,1.44,-.85),(1.28,2.3,.022),'Glass')
    for y in [.33,2.54]:box('Glazing channel',(x,y,-.85),(1.29,.035,.045),'Steel')
    for offset in [-.52,.52]:disc('Glass fixing',x+offset,1.25,-.85,.018,.035,'Bronze',8)
box('End glazing',(-2.55,1.44,0),(.025,2.3,1.65),'Glass')
for i in range(7):box('Seat teak slat',(-.56,.55,-.34+i*.085),(3.65,.085,.066),'Wood',.013)
for i in range(4):box('Backrest teak slat',(-.56,.79+i*.095,-.48),(3.65,.071,.055),'Wood',.012)
for x in [-1.95,.85]:
    bent_tube('Bench support',[(x,.08,-.51),(x,.5,-.51),(x,.5,.3),(x,.08,.3)],.045,'Steel')
for x in [-2.3,-.3,1.2]:bent_tube('Bench armrest',[(x,.53,-.32),(x,.82,-.32),(x,.82,.2),(x,.53,.2)],.024,'Bronze')
box('Ad cabinet',(2.18,1.38,0),(.28,2.48,1.52),'Steel',.04)
box('Ad bronze surround',(2.015,1.45,0),(.055,2.15,1.38),'Bronze',.025)
graphic('Coastal travel poster',1.976,1.45,0,1.25,1.99,0,angle=-math.pi/2)
graphic('Transit route map',2.33,1.45,0,1.25,1.99,1,angle=math.pi/2)
box('Route header',(0,2.65,1.01),(4.65,.29,.075),'Teal',.02)
graphic('Route label',0,2.65,1.053,4.35,.25,strip=5)
end('BusShelter',before,-8)

# Newsstand: rounded enamel housing, ribbed shutter, magazines and inset cabinet.
before=start()
box('Kiosk plinth',(0,.1,0),(2.38,.2,1.68),'Steel',.055)
box('Enamel kiosk',(0,1.05,0),(2.22,1.9,1.5),'Teal',.08)
box('Kiosk canopy',(0,2.27,.12),(2.62,.24,2.06),'Cream',.06)
box('Bronze roof trim',(0,2.39,.12),(2.67,.06,2.1),'Bronze',.025)
box('Inset serving window',(0,1.3,.766),(1.86,1.15,.045),'Dark',.022)
box('Counter ledge',(0,.81,.92),(2.05,.12,.47),'Wood',.035)
for x in [-.97,.97]:box('Window jamb',(x,1.35,.825),(.07,1.23,.08),'Bronze',.018)
for y in [.75,1.94]:box('Window surround',(0,y,.825),(2.02,.065,.08),'Bronze',.015)
for i in range(7):box('Retracted shutter',(0,1.91+i*.039,.826),(1.85,.025,.036),'Steel')
box('Kiosk header',(0,2.1,1.08),(2.43,.29,.05),'Teal',.02)
graphic('News header',0,2.1,1.112,2.34,.25,strip=0)
graphic('Opening hours',0,.42,.763,1.82,.2,strip=1)
for x in [-.65,0,.65]:
    box('Display cubby',(x,1.29,.805),(.6,.74,.07),'Wood',.012)
    graphic('Newspaper display',x,1.3,.85,.54,.67,2)
    box('Display retaining lip',(x,.97,.9),(.59,.06,.15),'Bronze',.01)
for x in [-.5,.1,.68]:
    box('Paper bundle',(x,.94,.97),(.47,.12,.31),'Cream',.012)
    graphic('Counter newspaper',x,1.008,.97,.44,.29,2) # A display cover on the angled front.
for side in [-1,1]:
    graphic('Side travel poster',side*1.12,1.2,0,.97,1.35,0,angle=side*math.pi/2)
    for z in [-.58,.58]:box('Side border',(side*1.135,1.2,z),(.035,1.55,.055),'Bronze',.008)
    for y in [.43,1.97]:box('Side border',(side*1.135,y,0),(.035,.055,1.2),'Bronze',.008)
box('Delivery hatch',(0,.55,-.77),(1.5,.75,.07),'Steel',.025)
for i in range(8):box('Ventilation slot',(.45,.35+i*.04,-.812),(.55,.012,.012),'Dark')
end('NewsKiosk',before,0)

# Café set: manufactured bistro furniture, canvas seams, tension ribs and ceramic cups.
before=start()
disc('Table top',0,.79,0,.61,.065,'Cream',32)
disc('Table rim',0,.755,0,.625,.035,'Bronze',32)
rod('Table pedestal',(0,.08,0),(0,.73,0),.047,'Steel',12)
for angle in [0,math.pi/2,math.pi,math.pi*1.5]:
    rod('Table foot',(0,.11,0),(.45*math.cos(angle),.055,.45*math.sin(angle)),.032,'Steel')
disc('Parasol base',0,.08,0,.36,.14,'Ivory',20)
rod('Parasol pole',(0,.1,0),(0,2.72,0),.025,'Bronze',12)
for n in range(12):
    a=n*math.pi/6;b=(n+1)*math.pi/6
    vertices=[(0,2.75,0),(.78*math.cos(a),2.58,.78*math.sin(a)),(1.48*math.cos(a),2.28,1.48*math.sin(a)),(1.48*math.cos(b),2.28,1.48*math.sin(b)),(.78*math.cos(b),2.58,.78*math.sin(b))]
    mesh('Stitched canvas panel',vertices,[(0,1,4),(1,2,3,4)],'Cream' if n%2 else 'Rust')
    rod('Umbrella rib',(0,2.68,0),(1.46*math.cos(a),2.27,1.46*math.sin(a)),.012,'Bronze',6)
    mesh('Canvas valance',[(1.48*math.cos(a),2.28,1.48*math.sin(a)),(1.48*math.cos(a),2.12,1.48*math.sin(a)),(1.48*math.cos(b),2.12,1.48*math.sin(b)),(1.48*math.cos(b),2.28,1.48*math.sin(b))],[(0,1,2,3)],'Cream' if n%2 else 'Rust')
disc('Canopy finial',0,2.78,0,.055,.13,'Bronze',12)
for sx in [-1,1]:
    cx=sx*.98
    def q(x,y,z):return (cx+sx*x,y,z)
    for z in [-.23,.23]:
        bent_tube('Chair continuous frame',[q(.22,.055,z),q(.19,.47,z),q(-.2,.47,z),q(-.27,.055,z)],.023,'Steel')
    for z in [-.245,.245]:bent_tube('Chair back uprights',[q(.23,.43,z),q(.28,.83,z),q(.21,1.03,z)],.021,'Bronze')
    for i in range(5):box('Chair teak seat',(cx,.48,-.23+i*.115),(.5,.045,.085),'Wood',.009)
    for y in [.7,.81,.92]:box('Chair backrest',(cx+sx*.27,y,0),(.045,.065,.52),'Wood',.01)
for x,z in [(-.32,.1),(.27,-.17)]:
    disc('Coffee saucer',x,.834,z,.095,.018,'Ivory',16)
    disc('Coffee cup',x,.895,z,.061,.11,'Ivory',16)
    disc('Dark roast',x,.954,z,.049,.002,'Dark',16)
    bpy.ops.mesh.primitive_torus_add(major_segments=12,minor_segments=6,location=p(x+.069,.905,z),major_radius=.034,minor_radius=.01)
    o=bpy.context.object;o.rotation_euler=(math.pi/2,0,0);finish(o,'Cup handle','Ivory')
end('CafeSet',before,8)

# Save editable source and the small material-batched runtime library.
bpy.context.scene.world.color=(.18,.18,.18)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/city_streetscape.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'city-streetscape.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
stats={}
for name,root in ASSETS.items():
    meshes=[o for o in root.children if o.type=='MESH'];triangles=0
    for obj in meshes:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    stats[name]={'triangles':triangles,'meshes':len(meshes),'materials':len({m.name for o in meshes for m in o.data.materials})}
(OUT/'city-manifest.json').write_text(json.dumps({'generator':'art/blender/city_streetscape.py','blender':bpy.app.version_string,'assets':stats},indent=2)+'\n')
print('CITY_ASSET_STATS',json.dumps(stats))
