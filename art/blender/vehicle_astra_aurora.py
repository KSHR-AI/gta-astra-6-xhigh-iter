"""Astra Aurora: original two-seat grand touring roadster, in metre-scale geometry.

blender --background --factory-startup --threads 4 --python art/blender/vehicle_astra_aurora.py
Add -- --render to render the saved source studio view to /tmp/astra-aurora-studio.png.
No external meshes, photos, fonts, or textures. Uses the project's own primitive
and batching helpers; silhouette, body topology, cockpit, wheels and trim are
new artwork. Design coordinates are X right, Y up, Z forward.
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))
sys.dont_write_bytecode = True
from vehicle_meridian import xyz, empty, mesh, box, tube, cylinder, ring, surface, patch, material, batch
ROOT = SOURCE.parents[1]
OUT = ROOT / 'public/models'
TAU = math.tau

# Continuous cubic longitudinal profile: (forward, halfwidth, central deck Y).
PROFILE = [(-2.24,.83,.77), (-2.13,.96,.83), (-1.8,1.002,.87),
           (-1.38,1.01,.86), (-.95,.962,.84), (-.60,.926,.835),
           (0,.916,.84), (.64,.947,.85), (1.05,.979,.83),
           (1.36,.986,.795), (1.76,.94,.75), (2.08,.858,.69), (2.25,.735,.64)]

def profile(z):
    for i in range(1,len(PROFILE)):
        a,b=PROFILE[i-1],PROFILE[i]
        if z<=b[0]: break
    t=max(0,min(1,(z-a[0])/(b[0]-a[0])))
    before,after=PROFILE[max(0,i-2)],PROFILE[min(len(PROFILE)-1,i+1)]
    result=[]
    for k in (1,2):
        ma=(b[k]-before[k])/(b[0]-before[0])*(b[0]-a[0])
        mb=(after[k]-a[k])/(after[0]-a[0])*(b[0]-a[0])
        result.append((2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*ma+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*mb)
    return result

def top_y(x,z):
    w,h=profile(z); q=abs(x)/w
    bulge=.112*math.exp(-((z-1.36)/.59)**2)+.104*math.exp(-((z+1.38)/.63)**2)
    return h+.026*(1-q*q)+bulge*q**2-.027*q**10

def nose_z(x,rear=False):
    # Rounded corners flow continuously into the longitudinal surface.
    return (-2.24+.09*(abs(x)/.83)**3) if rear else (2.25-.18*(abs(x)/.735)**3)

def arch_bottom(z):
    for c in (-1.38,1.36):
        d=abs(z-c)
        if d<.405:
            return .348+math.sqrt(.405**2-d*d)
    return .235

def side_point(side,z,v,low=None):
    w,_=profile(z); low=arch_bottom(z) if low is None else low
    top=top_y(w,z)
    # Tucked sill, convex shoulder and a long scallop below the belt.
    dx=-.065*(1-v)**2-.028*math.sin(v*math.pi)**2+.016*math.sin(v*math.pi)
    return (side*(w+dx),low+(top-low)*v,z)

def pal():
    m={
      'body':material('body',(.018,.21,.245),.25,.68),
      'upper':material('upper',(.018,.21,.245),.23,.68),
      'dark':material('dark',(.007,.011,.014),.43,.18),
      'rubber':material('rubber',(.012,.014,.016),.86,0),
      'metal':material('metal',(.19,.23,.27),.27,.9),
      'chrome':material('chrome',(.55,.62,.68),.19,.95),
      'leather':material('leather',(.48,.24,.105),.78,0),
      'stitch':material('stitch',(.72,.53,.31),.77,0),
      'glass':material('glass',(.16,.27,.3),.1,.1,.25),
      'lamp_lens':material('lamp_lens',(.16,.22,.27),.11,.3),
      'headlight_left':material('headlight_left',(.86,.94,1),.17,.1,emission=1.3),
      'headlight_right':material('headlight_right',(.86,.94,1),.17,.1,emission=1.3),
      'taillight_left':material('taillight_left',(.68,.008,.008),.2,.1,emission=.7),
      'taillight_right':material('taillight_right',(.68,.008,.008),.2,.1,emission=.7),
      'screen':material('screen',(.03,.12,.18),.21,.1,emission=.5),
      'brake':material('brake',(.74,.30,.06),.35,.45),
    }
    for k in ('body','upper'):
        p=m[k].node_tree.nodes.get('Principled BSDF')
        p.inputs['Coat Weight'].default_value=.85
        p.inputs['Coat Roughness'].default_value=.15
    return m

def hood_point(z,x):
    # Bring the very front corners back to produce a rounded front cap.
    adjust=max(0,min(1,(z-1.9)/.35))
    adjust=adjust*adjust*(3-2*adjust)
    return (x,top_y(x,z),z-.18*adjust*(abs(x)/profile(z)[0])**3)

def body(m,chassis,door,detail):
    ns=112 if detail else 64
    for side in (-1,1):
        for za,zb in ((-2.24,-.765),(.705,2.25)):
            def pt(u,v,za=za,zb=zb,side=side):
                z=za+(zb-za)*u; x,y,z=side_point(side,z,v)
                if z>1.9:
                    q=(z-1.9)/.35; z-=.18*(q*q*(3-2*q))
                if z< -2.0:
                    q=(-z-2)/.24; z+=.09*(q*q*(3-2*q))
                return x,y,z
            surface('flowing_quarter_skin',pt,max(18,int(ns*(zb-za)/4.49)),9 if detail else 5,m['body'],chassis,flip=side>0)
        target=door if side<0 else chassis
        surface('sculpted_door_skin',lambda u,v,side=side:side_point(side,-.758+1.456*u,v,.26),36 if detail else 20,9 if detail else 5,m['body'],target,flip=side>0)
        # Shoulder skin over the wheel houses; cockpit is a true open boundary.
        for za,zb,owner,segments in ((-.84,-.758,chassis,3),(-.758,.698,target,36 if detail else 20),(.698,.72,chassis,2)):
            def shoulder(u,v,side=side,za=za,zb=zb):
                z=za+(zb-za)*u; w,_=profile(z); x=side*(.775+(w-.775)*v)
                return x,top_y(x,z),z
            surface('cockpit_shoulder',shoulder,segments,5,m['upper'],owner,flip=side<0)
        # Rolled lower edge, sill crease and body-color fender lips.
        tube('sculpted_sill',[(side*(profile(z)[0]-.04),.254,z) for z in [-.91,-.73,-.45,0,.42,.71,.94]],.032,m['body'],chassis,7)
        tube('sill_shadow_line',[(side*(profile(z)[0]-.012),.285,z) for z in [-.84,-.65,-.3,0,.35,.65,.83]],.005,m['dark'],chassis,4)
        for cz in (-1.38,1.36):
            points=[]
            for i in range(49 if detail else 29):
                a=math.pi*i/(48 if detail else 28); z=cz+math.cos(a)*.405
                points.append((side*(profile(z)[0]-.027),.348+math.sin(a)*.405,z))
            tube('rolled_wheel_arch',points,.015,m['body'],chassis,6)
            surface('wheel_well_liner',lambda u,v,cz=cz,side=side:(side*(profile(cz+.405*math.cos(u*math.pi))[0]-.04-.25*v),.348+.405*math.sin(u*math.pi),cz+.405*math.cos(u*math.pi)),48 if detail else 28,2,m['dark'],chassis,flip=side<0)
        # A separate solid door shell, with visible seals when articulated.
        for z in (-.758,.698):
            pts=[side_point(side,z,v,.26) for v in (0,.2,.5,.8,1)]
            tube('door_panel_gap',[(x+side*.0015,y,z) for x,y,z in pts],.0035,m['dark'],target,4)
            patch('door_end_thickness',[(side*.83,.28,z),(side*(profile(z)[0]-.065),.28,z),(side*profile(z)[0],top_y(profile(z)[0],z),z),(side*.79,.82,z)],m['dark'],target,2,5,flip=side<0)
        # Flush handle in body, sculpted arm rest and a slim belt trim.
        box('handle_pocket',(side*(profile(-.54)[0]+.002),.772,-.54),(.016,.037,.19),m['dark'],target,.012,3)
        box('flush_handle',(side*(profile(-.54)[0]+.010),.779,-.54),(.018,.018,.16),m['chrome'],target,.006,2)
        tube('cockpit_edge_seal',[(side*.776,.862,z) for z in [-.76,-.45,-.1,.3,.65]],.014,m['dark'],target,6)
        # Side scallop/intake has recessed lattice fins and bright leading edge.
        def scoop(u,v,side=side):
            z=-.87-.29*u; y=.43+.27*v+.04*u
            x=side*(profile(z)[0]-.016)
            return x,y,z
        surface('rear_quarter_air_scoop',scoop,8,5,m['dark'],chassis,flip=side<0)
        for j in range(3):
            z=-.93-.075*j
            tube('scoop_blade',[(side*(profile(z)[0]-.007),y,z) for y in [.47,.53,.61,.69]],.007,m['metal'],chassis,5)
        tube('sculpted_haunch_crease',[(side*(profile(z)[0]-.006),.735+.05*(z+1.15),z) for z in [-1.15,-.97,-.8]],.004,m['body'],chassis,4)
    # Bonnet and rear deck: no slab passes through the open passenger compartment.
    for za,zb,label in ((.72,2.25,'long_sculpted_bonnet'),(-2.24,-.84,'rear_tonneau')):
        def top(u,v,za=za,zb=zb):
            z=za+(zb-za)*u; x=(v*2-1)*profile(z)[0]
            if z>0:return hood_point(z,x)
            p=(x,top_y(x,z),z)
            if z< -2:
                q=(-z-2)/.24
                return p[0],p[1],z+.09*(q*q*(3-2*q))*(abs(x)/profile(z)[0])**3
            return p
        surface(label,top,44 if detail else 24,30 if detail else 16,m['upper'],chassis)
    box('undertray',(0,.222,0),(1.7,.045,3.91),m['dark'],chassis,.04,2)
    # Subtle hood shut lines follow the crown and end in a transverse shut line.
    for side in (-1,1):
        points=[]
        for i in range(27):
            z=.79+1.31*i/26; x=side*(.63-.16*i/26)
            x,y,z=hood_point(z,x); points.append((x,y+.003,z))
        tube('bonnet_shut_line',points,.0027,m['dark'],chassis,4)
        # Four machined heat extraction slots across each bonnet shoulder.
        for j in range(4):
            z=.86+j*.066
            points=[]
            for k in range(9):
                x=side*(.52+.19*k/8); points.append((x,top_y(x,z)+.006,z))
            tube('hood_heat_extractor',points,.008,m['dark'],chassis,5)
    points=[]
    for i in range(25):
        x=-.47+.94*i/24; x,y,z=hood_point(2.10,x); points.append((x,y+.003,z))
    tube('bonnet_front_shutline',points,.0027,m['dark'],chassis,4)


def fascia(m,chassis,detail):
    # Deep front grille: the paint is formed around the aperture, not across it.
    def endcap(u,v,rear=False,lift=0):
        q=u*2-1;w=.83 if rear else .735;z=-2.24 if rear else 2.25
        tuck=-.065*(1-v)**2-.028*math.sin(v*math.pi)**2+.016*math.sin(v*math.pi)
        direction=-1 if rear else 1
        return q*(w+tuck),.235+(top_y(q*w,z)-.235)*v,nose_z(q*w,rear)+direction*(.014*math.sin(v*math.pi)*(1-q*q)+lift)
    def front(u,v):
        return endcap(u,v)
    surface('front_black_intake_back',front,36,6,m['dark'],chassis)
    for za,zb in ((.235,.295),(.565,.64)):
        surface('front_bumper_bridge',lambda u,v,za=za,zb=zb:endcap(u,((za-.235)+(zb-za)*v)/.405,lift=.005),36,4,m['body'],chassis)
    for side in (-1,1):
        # Body-colored corners separate the central and secondary intake.
        patch('front_intake_buttress',[(side*.43,.282,nose_z(side*.43)+.026),(side*.49,.282,nose_z(side*.49)+.026),(side*.53,.588,nose_z(side*.53)+.026),(side*.47,.588,nose_z(side*.47)+.026)],m['body'],chassis,2,6,flip=side<0)
        for j in range(5):
            x=side*(.555+.032*j)
            tube('side_intake_vertical_fin',[(x,.335,nose_z(x)+.02),(x,.47,nose_z(x)+.02),(x,.53,nose_z(x)+.02)],.005,m['metal'],chassis,4)
    for j in range(5):
        y=.333+.043*j
        tube('grille_horizontal_vane',[(x,y,nose_z(x)+.018) for x in [i*.045 for i in range(-9,10)]],.0045,m['metal'],chassis,4)
    # Thin inset honeycomb uprights, deep enough to retain parallax in close views.
    for j in range(-10,11):
        x=j*.041
        tube('grille_rear_vane',[(x,.31,nose_z(x)+.004),(x,.54,nose_z(x)+.004)],.003,m['metal'],chassis,4)
    tube('front_splitter',[(x,.235,nose_z(x)+.035) for x in [j*.0735 for j in range(-10,11)]],.022,m['dark'],chassis,8)
    for side in (-1,1):
        head=m['headlight_left' if side<0 else 'headlight_right']
        tail=m['taillight_left' if side<0 else 'taillight_right']
        # Sculpted lamp assemblies lie in the descending bonnet surface.
        def lamp(u,v,side=side,lift=.005):
            x=side*(.47+.35*u)
            z=1.99+.13*v-.09*u
            px,py,pz=hood_point(z,x)
            return px,py+lift,pz
        surface('headlamp_black_housing',lambda u,v:lamp(u,v),18,6,m['dark'],chassis,flip=side>0)
        for row in (0,1):
            points=[]
            for k in range(20):
                u=.045+.91*k/19; x,y,z=lamp(u,.22+.59*row,lift=.012)
                points.append((x,y,z))
            tube('blade_headlamp',points,.008,head,chassis,6)
        # Internal projector elements give the lamps depth behind the signature.
        for q in (.22,.50,.78):
            x,y,z=lamp(q,.5,.012)
            box('lamp_optic_cell',(x,y,z),(.053,.014,.04),m['lamp_lens'],chassis,.006,2)
        tube('front_corner_air_curtain',[(side*x,y,z) for x,y,z in [(.78,.34,2.06),(.80,.42,2.04),(.82,.49,2.01)]],.012,m['dark'],chassis,6)
    # Rounded rear fascia with a single clean floating light graphic.
    surface('rear_fascia',lambda u,v:endcap(u,v,True),36,8,m['body'],chassis,flip=True)
    surface('rear_light_recess',lambda u,v:((u*2-1)*.78,.655+.105*v,nose_z((u*2-1)*.78,True)-.012),32,3,m['dark'],chassis,flip=True)
    for side in (-1,1):
        tail=m['taillight_left' if side<0 else 'taillight_right']
        for yy in (.687,.727):
            tube('rear_light_blade',[(side*x,yy,nose_z(side*x,True)-.023) for x in [.09,.19,.30,.43,.57,.68,.76]],.008,tail,chassis,6)
        tube('rear_blade_turnaround',[(side*.76,yy,nose_z(side*.76,True)-.023) for yy in [.687,.70,.714,.727]],.008,tail,chassis,6)
        cylinder('exhaust_chrome_outer',(side*.61,.29,-2.23),.052,.18,m['chrome'],chassis,'z',32 if detail else 20)
        cylinder('exhaust_dark_bore',(side*.61,.29,-2.324),.042,.008,m['dark'],chassis,'z',32 if detail else 20)
        tube('rear_reflector',[(side*x,.43,nose_z(side*x,True)-.012) for x in [.62,.68,.74]],.009,tail,chassis,5)
    # Deep diffuser trough and real parallel strakes.
    box('rear_diffuser',(0,.286,-2.17),(1.12,.13,.28),m['dark'],chassis,.044,3)
    for x in [-.43,-.22,0,.22,.43]:
        box('diffuser_fin',(x,.235,-2.19),(.018,.094,.28),m['dark'],chassis,.009,2)
    box('license_plate_recess',(0,.52,-2.245),(.49,.19,.018),m['dark'],chassis,.025,3)
    box('license_plate',(0,.52,-2.257),(.429,.166,.006),m['chrome'],chassis,.009,2)
    # Original upright star emblem, independent from any real manufacturer logo.
    for rear in (False,True):
        z=-2.264 if rear else 2.27; cy=.716 if rear else .598
        verts=[(0,cy,z)]
        for i in range(8):
            a=TAU*i/8; r=.025 if i%2==0 else .009
            verts.append((r*math.sin(a),cy+r*math.cos(a),z))
        faces=[(0,i+1,(i+1)%8+1) for i in range(8)]
        if rear:faces=[tuple(reversed(f)) for f in faces]
        mesh('astra_star_emblem',verts,faces,m['chrome'],chassis,False)
    # Minimal proud rear lip follows the actual deck, avoiding a detached wing.
    tube('integrated_tail_lip',[(x,top_y(x,-2.10)+.018,-2.10+.055*(abs(x)/.84)**3) for x in [i*.084 for i in range(-10,11)]],.022,m['body'],chassis,8)


def cockpit(m,chassis,door,detail):
    def glass(u,v):
        x=u*2-1
        return (x*(.82-.09*v),.88+.41*v+.025*(1-x*x),.72-.57*v+.04*(1-x*x))
    surface('curved_windscreen',glass,28 if detail else 16,10 if detail else 6,m['glass'],chassis)
    for v in (0,1):
        tube('windshield_frit',[glass(i/32,v) for i in range(33)],.012,m['dark'],chassis,6)
        tube('polished_windscreen_surround',[glass(i/32,v) for i in range(33)],.021 if v else .018,m['metal'],chassis,8)
    for side in (-1,1):
        target=door if side<0 else chassis
        tube('raked_a_pillar',[glass(0 if side<0 else 1,i/12) for i in range(13)],.028,m['body'],chassis,8)
        # Door cap and mirrors move together with the real door hinge.
        box('door_inner_panel',(side*.813,.585,-.045),(.058,.43,1.37),m['dark'],target,.04,3)
        box('door_saddle_insert',(side*.773,.685,-.13),(.025,.18,.91),m['leather'],target,.04,3)
        box('interior_armrest',(side*.742,.579,-.10),(.12,.06,.6),m['dark'],target,.022,3)
        box('interior_door_pull',(side*.74,.732,.26),(.015,.023,.15),m['chrome'],target,.006,2)
        cylinder('door_speaker',(side*.777,.465,.43),.075,.012,m['metal'],target,'x',24)
        for i in range(4):
            tube('speaker_grille',[(side*.766,.425+i*.024,.375),(side*.766,.425+i*.024,.485)],.003,m['dark'],target,4)
        tube('mirror_arm',[(side*.90,.883,.51),(side*1.025,.90,.47)],.018,m['dark'],target,6)
        box('sculpted_mirror_housing',(side*1.062,.917,.431),(.184,.074,.245),m['body'],target,.034,4)
        box('mirror_reflective_glass',(side*1.061,.919,.309),(.147,.048,.006),m['chrome'],target,.018,3)
        tube('mirror_turn_indicator',[(side*x,.922,.551) for x in [.995,1.04,1.095]],.0038,m['headlight_left' if side<0 else 'headlight_right'],target,5)
        box('exposed_door_sill',(side*.79,.259,-.02),(.18,.055,1.47),m['dark'],chassis,.014,3)
        box('sill_metal_insert',(side*.803,.289,-.16),(.08,.008,.62),m['metal'],chassis,.008,2)
    box('cockpit_carpet',(0,.265,-.05),(1.57,.035,1.67),m['dark'],chassis,.04,2)
    box('rear_bulkhead',(0,.592,-.815),(1.56,.62,.065),m['dark'],chassis,.035,3)
    box('cockpit_dashboard',(0,.833,.55),(1.54,.23,.39),m['dark'],chassis,.078,4)
    # Saddle-colored upper dashboard trim emphasizes the visible open cockpit.
    box('stitched_dashboard_pad',(0,.95,.55),(1.45,.035,.27),m['leather'],chassis,.016,3)
    tube('dashboard_trim',[(x,.88,.345) for x in [-.71,-.5,-.3,0,.3,.5,.71]],.008,m['chrome'],chassis,6)
    box('instrument_cowl',(-.43,.975,.335),(.385,.135,.19),m['dark'],chassis,.048,4)
    box('instrument_screen',(-.43,.985,.237),(.30,.068,.007),m['screen'],chassis,.013,3)
    # Two quiet analog arcs and needles, visible at close range without text UI.
    for x in (-.508,-.352):
        pts=[(x+.026*math.cos(math.pi*.15+math.pi*1.7*i/20),.985+.026*math.sin(math.pi*.15+math.pi*1.7*i/20),.231) for i in range(21)]
        tube('gauge_arc',pts,.0018,m['stitch'],chassis,4)
        tube('gauge_needle',[(x,.985,.228),(x+.013,1.005,.228)],.0018,m['headlight_left'],chassis,4)
    for x in (-.68,-.19,.24,.66):
        box('dash_vent',(x,.86,.344),(.10,.047,.012),m['metal'],chassis,.01,3)
        for j in range(3):box('vent_blade',(x,.846+.014*j,.334),(.082,.003,.008),m['dark'],chassis,0)
    box('center_display_surround',(.12,.944,.312),(.28,.157,.026),m['dark'],chassis,.014,3)
    box('center_display',(.12,.949,.297),(.239,.118,.006),m['screen'],chassis,.008,2)
    # A small map stroke is modeled to remain readable without an image texture.
    for j in range(3):
        tube('display_road',[(.02+j*.06,.92,.292),(.06+j*.06,.95,.292),(.04+j*.06,.985,.292)],.0015,m['metal'],chassis,4)
    box('center_tunnel',(0,.46,-.1),(.245,.37,1.20),m['dark'],chassis,.055,4)
    box('console_machined_inlay',(0,.658,.06),(.18,.022,.51),m['metal'],chassis,.016,3)
    box('short_gear_selector',(0,.714,.19),(.05,.09,.075),m['leather'],chassis,.022,3)
    box('center_armrest',(0,.66,-.40),(.22,.075,.31),m['leather'],chassis,.034,4)
    for z in (-.19,-.055):
        ring('cup_holder',(0,.678,z),.045,.007,m['dark'],chassis,'z',24,6)
    # Purposeful bucket seats with curved upholstered inserts and high bolsters.
    for side in (-1,1):
        x=side*.43
        box('seat_shell',(x,.587,-.624),(.49,.58,.16),m['dark'],chassis,.066,4,rotation=-.15)
        box('seat_cushion',(x,.374,-.32),(.435,.117,.51),m['leather'],chassis,.052,4)
        box('seat_back',(x,.715,-.577),(.409,.513,.13),m['leather'],chassis,.055,4,rotation=-.15)
        box('seat_integral_headrest',(x,1.006,-.635),(.261,.22,.13),m['leather'],chassis,.05,4,rotation=-.10)
        for edge in (-1,1):
            box('thigh_bolster',(x+edge*.181,.431,-.32),(.08,.11,.445),m['leather'],chassis,.036,4)
            box('torso_bolster',(x+edge*.175,.723,-.504),(.083,.39,.107),m['leather'],chassis,.036,4,rotation=-.15)
            tube('seat_back_piping',[(x+edge*.142,y,-.495-.15*(y-.70)) for y in [.50,.61,.74,.87,.93]],.0024,m['stitch'],chassis,4)
            tube('seat_cushion_piping',[(x+edge*.137,.435,z) for z in [-.48,-.38,-.27,-.16]],.0024,m['stitch'],chassis,4)
        # Diamond quilting follows the upholstery rather than floating above it.
        if detail:
            for j in range(-3,4):
                for sign in (-1,1):
                    points=[]
                    for k in range(18):
                        y=.54+.345*k/17
                        xx=x+j*.075+sign*(y-.71)*.72
                        if abs(xx-x)<=.126:points.append((xx,y,-.502-.15*(y-.70)))
                    if len(points)>1:tube('seat_diamond_stitch',points,.0014,m['stitch'],chassis,3)
        box('seat_belt_latch',(x-side*.24,.45,-.45),(.035,.064,.045),m['dark'],chassis,.008,2)
        box('belt_release',(x-side*.24,.485,-.45),(.024,.008,.029),m['taillight_left'],chassis,.003,2)
        # A low aerodynamic fairing and polished rollover protection behind head.
        def fairing(u,v,side=side):
            z=-.83-.57*u; q=v*2-1
            width=.22*(1-.65*u)
            return side*.43+q*width,top_y(side*.43+q*width,z)+.20*math.sin(math.pi*(1-u)*.7)*(1-q*q),z
        surface('rear_seat_fairing',fairing,18,14,m['body'],chassis,flip=True)
        pts=[]
        for k in range(25):
            a=math.pi*k/24
            pts.append((x+.174*math.cos(a),.957+.205*math.sin(a),-.755))
        tube('rollover_hoop',pts,.025,m['chrome'],chassis,8)
        tube('belt_webbing',[(x+side*.205,.93,-.74),(x+side*.21,.70,-.71),(x+side*.215,.47,-.68)],.009,m['dark'],chassis,5)
    steering=empty('steering_wheel',chassis)
    ring('steering_rim',(-.43,.85,.13),.15,.017,m['dark'],steering,'z',40 if detail else 24,8)
    cylinder('steering_center',(-.43,.85,.13),.047,.036,m['dark'],steering,'z',24)
    for a in (0,math.pi,math.pi*1.5):
        tube('steering_spoke',[(-.43,.85,.13),(-.43+.131*math.cos(a),.85+.131*math.sin(a),.13)],.012,m['metal'],steering,6)
    for x in (-.54,-.32):box('shift_paddle',(x,.85,.158),(.025,.09,.009),m['metal'],steering,.01,3)
    steer_pivot=Vector(xyz((-.43,.85,.13)))
    for obj in steering.children:
        for vert in obj.data.vertices:vert.co-=steer_pivot
    steering.location=steer_pivot
    tube('steering_column',[(-.43,.85,.15),(-.43,.86,.38)],.026,m['dark'],chassis,8)
    box('rearview_mirror',(0,1.212,.245),(.23,.06,.03),m['dark'],chassis,.018,3)
    for side in (-1,1):
        tube('windscreen_wiper',[(side*.12,.91,.744),(side*.61,.899,.73)],.006,m['dark'],chassis,5)


def wheel(name,center,side,m,detail):
    parent=empty(name,location=center)
    spin=empty(name+'_spin',parent)
    segments=64 if detail else 32
    def lathe(label,contour,mat):
        verts=[]; faces=[]
        for axial,r in contour:
            for i in range(segments):
                a=TAU*i/segments;verts.append((side*axial,r*math.cos(a),r*math.sin(a)))
        for row in range(len(contour)):
            row2=(row+1)%len(contour)
            for i in range(segments):
                j=(i+1)%segments
                f=(row*segments+i,row*segments+j,row2*segments+j,row2*segments+i)
                faces.append(tuple(reversed(f)) if side<0 else f)
        return mesh(label,verts,faces,mat,spin)
    lathe('performance_tire',[(-.13,.254),(-.137,.283),(-.127,.315),(-.094,.341),(-.055,.35),(0,.352),(.055,.35),(.094,.341),(.127,.315),(.137,.283),(.13,.254),(.09,.245),(-.09,.245)],m['rubber'])
    lathe('forged_alloy_barrel',[(-.107,.247),(-.107,.257),(.135,.257),(.143,.248),(.135,.239),(.115,.237)],m['metal'])
    ring('machined_outer_rim',(side*.140,0,0),.249,.006,m['chrome'],spin,'x',segments,5)
    # Ten swept sculpted spokes, each with a split shoulder and darker inner side.
    for j in range(5):
        a=TAU*j/5
        for split in (-1,1):
            points=[]
            for k in range(5):
                t=k/4;r=.05+.194*t;ang=a+split*(.06+.18*t)+.08*math.sin(t*math.pi)
                points.append((side*(.105+.033*t),r*math.cos(ang),r*math.sin(ang)))
            verts=[]
            for k,p in enumerate(points):
                t=k/4;w=.0105-.003*t;ang=a+split*(.06+.18*t)
                for depth,edge in ((0,-1),(0,1),(-.016,-1),(-.016,1)):
                    verts.append((p[0]+side*depth,p[1]-math.sin(ang)*w*edge,p[2]+math.cos(ang)*w*edge))
            faces=[]
            for k in range(4):
                s=k*4;n=(k+1)*4
                faces += [(s,n,n+1,s+1),(s+2,s+3,n+3,n+2),(s,s+2,n+2,n),(s+1,n+1,n+3,s+3)]
            faces += [(0,1,3,2),(16,18,19,17)]
            if side<0:faces=[tuple(reversed(f)) for f in faces]
            mesh('swept_split_spoke',verts,faces,m['chrome'],spin)
        cylinder('lug_bolt',(side*.146,.044*math.cos(a),.044*math.sin(a)),.007,.012,m['dark'],spin,'x',8)
    cylinder('forged_hub',(side*.113,0,0),.063,.025,m['metal'],spin,'x',32)
    cylinder('hub_medallion',(side*.132,0,0),.023,.008,m['dark'],spin,'x',24)
    cylinder('ventilated_rotor',(side*.057,0,0),.212,.018,m['metal'],spin,'x',48 if detail else 24)
    ring('rotor_swept_face',(side*.069,0,0),.187,.015,m['chrome'],spin,'x',segments,3)
    if detail:
        for row in (0,1):
            for j in range(16):
                a=TAU*(j+row*.32)/16;r=.167+row*.027
                cylinder('cross_drilled_rotor',(side*.073,r*math.cos(a),r*math.sin(a)),.005,.002,m['dark'],spin,'x',6)
    # Tread bands and actual diagonal cuts add parallax at low camera angles.
    for axial in (-.063,0,.063):ring('longitudinal_tread',(axial,0,0),.351,.0025,m['dark'],spin,'x',segments,3)
    if detail:
        for j in range(40):
            a=TAU*j/40
            for sideband in (-1,1):
                pts=[]
                for k in range(4):
                    t=k/3;ax=sideband*(.074+.036*t);theta=a+.045*t
                    rr=.348-.012*t
                    pts.append((ax,rr*math.cos(theta),rr*math.sin(theta)))
                tube('tread_sipe',pts,.0018,m['dark'],spin,3)
        for r in (.294,.318):ring('sidewall_mold_line',(side*.129,0,0),r,.0012,m['dark'],spin,'x',segments,3)
    box('fixed_brake_caliper',(side*.078,.015,-.176),(.085,.19,.077),m['brake'],parent,.025,4)
    for yy in (-.04,.04):box('caliper_casting_rib',(side*.127,yy,-.175),(.007,.032,.065),m['metal'],parent,.003,2)
    return parent


def build(detail=True):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
    m=pal();root=empty('AstraAurora');chassis=empty('body_group',root);door=empty('driver_door',root)
    body(m,chassis,door,detail);fascia(m,chassis,detail);cockpit(m,chassis,door,detail)
    wheels=[]
    for z,axle in ((1.36,'f'),(-1.38,'r')):
        for side,lr in ((-1,'l'),(1,'r')):
            o=wheel('wheel_'+axle+lr,(side*(.91 if axle=='f' else .96),.352,z),side,m,detail);o.parent=root;wheels.append(o)
    hinge=Vector(xyz((-.94,.76,.70)))
    for obj in door.children:
        if obj.type=='MESH':
            for vert in obj.data.vertices:vert.co-=hinge
    door.location=hinge
    for name,p in [('driver_seat',(-.43,.50,-.34)),('passenger_seat',(.43,.50,-.34)),('steering_anchor',(-.43,.85,.13)),('door_entry',(-1.65,0,-.15)),('engine_anchor',(0,.63,1.25)),('exhaust_left',(-.61,.29,-2.33)),('exhaust_right',(.61,.29,-2.33))]:
        empty(name,root,p)
    batch(root)
    if not detail:
        for obj in list(bpy.context.scene.objects):
            if obj.type!='MESH' or len(obj.data.polygons)<120:continue
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new('Far silhouette simplification','DECIMATE');mod.ratio=.26;mod.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            obj.data.validate(clean_customdata=True);obj.data.update()
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    triangles=sum(len(o.data.polygons) for o in meshes)
    root['asset']='Astra Aurora — original grand touring roadster'
    root['provenance']='Original project-authored geometry and materials; no third-party source assets.'
    root['coordinates']='Metres, X right, Y up, +Z forward in glTF'
    root['triangles']=triangles;root['lod']='near' if detail else 'far'
    bpy.context.scene['asset']='Astra Aurora'
    bpy.context.scene['authoring']='Rebuild with vehicle_astra_aurora.py; root anchors are attachment contract.'
    print(f'AURORA {root["lod"]}: {triangles} triangles; {len(meshes)} material batches')
    OUT.mkdir(exist_ok=True,parents=True)
    if detail:
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'vehicle_astra_aurora.blend'))
    if detail:
        # The editable source keeps full surfaces. Export retains silhouette and
        # rounded edges while pruning sub-pixel tread/stitch and planar detail.
        ratios={'dark':.32,'metal':.45,'chrome':.60,'body':.60,'upper':.60,'rubber':.68,'leather':.60,'stitch':.38}
        for obj in meshes:
            if len(obj.data.polygons)<160:continue
            ratio=ratios.get(obj.data.materials[0].name,.78)
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new('Presentation mesh optimization','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            obj.data.validate(clean_customdata=True);obj.data.update()
        root['triangles']=sum(len(o.data.polygons) for o in meshes)
        print(f'AURORA optimized near: {root["triangles"]} triangles')
    bpy.ops.export_scene.gltf(filepath=str(OUT/('AstraAurora.glb' if detail else 'AstraAurora-lod.glb')),export_format='GLB',export_yup=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_texcoords=False,export_normals=True,export_materials='EXPORT')


def studio_render():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'vehicle_astra_aurora.blend'))
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=1400;scene.render.resolution_y=950;scene.render.resolution_percentage=100
    scene.world.color=(.16,.16,.16)
    scene.view_settings.view_transform='AgX'
    floor=material('studio_floor',(.09,.105,.12),.3,.2)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008));bpy.context.object.data.materials.append(floor)
    def area(name,location,power,size,color):
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=xyz(location);o.rotation_euler=(Vector(xyz((0,.4,0)))-o.location).to_track_quat('-Z','Y').to_euler()
    area('large_softbox',(-4,7,4),1800,6,(.8,.91,1))
    area('warm_edge',(4,4,-3),2200,5,(1,.86,.69))
    area('hood_strip',(1,6,6),1300,5,(.88,.94,1))
    camera=bpy.data.cameras.new('studio_camera');obj=bpy.data.objects.new('studio_camera',camera);scene.collection.objects.link(obj);scene.camera=obj
    obj.location=xyz((-5.4,3.3,6.6));obj.rotation_euler=(Vector(xyz((0,.55,0)))-obj.location).to_track_quat('-Z','Y').to_euler();camera.lens=53
    scene.render.filepath='/tmp/astra-aurora-studio.png'
    if '--door-only' not in sys.argv:bpy.ops.render.render(write_still=True)
    obj.location=xyz((5.4,3.0,-6.8));obj.rotation_euler=(Vector(xyz((0,.55,0)))-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath='/tmp/astra-aurora-rear.png'
    if '--door-only' not in sys.argv:bpy.ops.render.render(write_still=True)
    # Explicit articulated source check in the same pose used by the runtime.
    bpy.data.objects['driver_door'].rotation_euler.z=1.05
    obj.location=xyz((-4.8,4.3,4.6));obj.rotation_euler=(Vector(xyz((-.2,.5,0)))-obj.location).to_track_quat('-Z','Y').to_euler();camera.lens=58
    scene.render.filepath='/tmp/astra-aurora-door.png';bpy.ops.render.render(write_still=True)

if __name__=='__main__':
    if '--render-only' not in sys.argv:
        build(True);build(False)
    if '--render' in sys.argv or '--render-only' in sys.argv:studio_render()
