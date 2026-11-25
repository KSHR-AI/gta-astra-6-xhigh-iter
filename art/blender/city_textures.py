"""Original painted graphics for the Los Pacificos street furniture atlas."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/city'
OUT.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (2048, 2048), '#d9d0b9')
d = ImageDraw.Draw(image)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

def text(x, y, value, size=48, color='#ece4cf', bold=False, anchor=None):
    d.text((x, y), value, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=color, anchor=anchor)

# A travel poster designed for the shelter's backlit cabinet.
d.rectangle((0, 0, 1023, 1023), fill='#164f58')
for y in range(130, 630):
    t = (y - 130) / 500
    d.line((0, y, 1023, y), fill=(int(216-36*t), int(147+18*t), int(95+24*t)))
d.ellipse((572, 214, 873, 515), fill='#f8dab0')
for n in range(5):
    y = 584 + n * 70
    points = [(x, int(y + math.sin(x / 180 + n * .6) * 27)) for x in range(0, 1024, 8)]
    d.polygon(points + [(1024, 1024), (0, 1024)], fill=['#437c7d','#2b6b73','#215963','#174d59','#123b46'][n])
d.line((224, 930, 270, 416, 304, 292), fill='#203d38', width=16)
for n in range(9):
    a = (n - 4) * .48
    points = [(304, 292), (304 + int(math.sin(a) * 156), 292 - int(math.cos(a) * 95)), (304 + int(math.sin(a) * 261), 322 - int(math.cos(a) * 80))]
    d.line(points, fill='#203d38', width=22)
text(70, 46, 'LOS PACIFICOS', 78, bold=True)
text(70, 139, 'A LITTLE CLOSER TO PARADISE', 28)
text(70, 885, 'THE WATER IS CALLING.', 55, bold=True)
text(72, 958, 'PACIFIC COAST TOURISM  /  EST. 1986', 24)

# A genuinely legible transit map, route names, and numbered stops.
d.rectangle((1024, 0, 2047, 1023), fill='#ece8d9')
d.rectangle((1024, 0, 2047, 164), fill='#314c49')
text(1070, 40, 'PACIFIC TRANSIT', 64, bold=True)
text(1074, 112, 'OCEAN DRIVE  /  ROUTE 04', 28)
for x in range(1090, 2030, 70): d.line((x, 190, x, 760), fill='#c7c9b9', width=4)
for y in range(210, 780, 65): d.line((1070, y, 2004, y), fill='#c7c9b9', width=4)
d.polygon([(1070,190),(1270,190),(1190,410),(1230,760),(1070,760)], fill='#98bab7')
route = [(1420,230),(1420,350),(1540,350),(1540,480),(1780,480),(1780,680)]
d.line(route, fill='#bf704a', width=19)
for i, (x, y) in enumerate(route):
    d.ellipse((x-17,y-17,x+17,y+17), fill='#f4e8cb', outline='#3c625b', width=7)
    text(x+26, y-13, ['PALOMA','OCEAN DRIVE','CIVIC CENTER','PALM AVENUE','MARINA','DOWNTOWN'][i], 19, '#344d46', True)
text(1080, 805, 'EVERY 12 MINUTES', 45, '#38544b', True)
text(1080, 875, 'MON–FRI  05:30–23:40', 29, '#38544b')
text(1080, 928, 'TAP. RIDE. GO SOMEWHERE.', 29, '#38544b')

# Original fictional newspaper cover; thin column lines retain close-range detail.
d.rectangle((0,1024,1023,2047), fill='#e4dcc7')
text(45,1064,'THE PACIFIC STANDARD',65,'#273b39',True)
d.line((48,1146,975,1146), fill='#273b39',width=5)
text(50,1165,'THURSDAY  /  LOS PACIFICOS  /  $2.50',24,'#566159')
text(50,1230,'A CITY ON THE RISE',74,'#273b39',True)
d.rectangle((52,1330,973,1670),fill='#70918a')
d.ellipse((715,1354,897,1536),fill='#d1b07b')
for i in range(14):
    x=70+i*63; h=75+((i*83)%190)
    d.rectangle((x,1670-h,x+49,1669),fill=['#3c5756','#4a6562','#587771'][i%3])
    for yy in range(1670-h+15,1650,22):
        for xx in range(x+6,x+43,13): d.rectangle((xx,yy,xx+6,yy+9),fill='#bdd0b7')
for col in range(3):
    for row in range(21):
        x=54+col*316; y=1710+row*12
        d.line((x,y,x+263-((row*19+col*31)%63),y),fill='#727568',width=3)
text(50,1990,'LOCAL STORIES. INDEPENDENT VOICES.',25,'#273b39',True)

# Eight slim signage strips, sampled from one texture by their mesh UVs.
labels = [
    ('PACIFIC NEWS','#224c49','#f0dcc0'),('OPEN DAILY  /  7 AM – 9 PM','#224c49','#d2c39f'),
    ('SUNLINE','#b46343','#f9e3bc'),('COFFEE  •  KITCHEN','#b46343','#f9e3bc'),
    ('OCEAN DRIVE','#3c5b51','#eee3c9'),('PACIFIC TRANSIT','#3c5b51','#eee3c9'),
    ('04  /  DOWNTOWN','#e6dec5','#395c54'),('READ SOMETHING REAL.','#d9cbb1','#3f554d')]
for row,(label,bg,fg) in enumerate(labels):
    y=1024+row*128;d.rectangle((1024,y,2047,y+127),fill=bg)
    text(1536,y+64,label,72 if row in (0,2) else 48,fg,True,anchor='mm')
image.save(OUT / 'city-atlas.png', optimize=True)
print('Created original city-atlas.png')
