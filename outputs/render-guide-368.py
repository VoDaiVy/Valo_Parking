import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).parent
groups = json.loads((root / 'guide-368-data.json').read_text(encoding='utf-8'))
fonts = Path('C:/Windows/Fonts')
normal = ImageFont.truetype(str(fonts/'arial.ttf'), 18)
bold = ImageFont.truetype(str(fonts/'arialbd.ttf'), 21)
small = ImageFont.truetype(str(fonts/'arial.ttf'), 15)
lanes = iter(['ASSAA','ASSAA','ASAASS','ASSAA','AASSAS','AASAAS','AAASSA','AASAA',
              'ASSAA','AASSAS','ASSSA','AASSAS','AASSA','ASASA','AAASSA'])

def wrap(draw, text, font, width):
    lines = ['']
    for word in text.split():
        candidate = (lines[-1]+' '+word).strip()
        if lines[-1] and draw.textlength(candidate,font=font)>width:
            lines.append(word)
        else:
            lines[-1]=candidate
    return '\n'.join(lines)

def arrow(draw, points):
    draw.line(points, fill='#181818', width=2)
    ax,ay=points[-2]
    bx,by=points[-1]
    dx=(bx>ax)-(bx<ax)
    dy=(by>ay)-(by<ay)
    draw.polygon([(bx,by),(bx-dx*9-dy*5,by-dy*9+dx*5),(bx-dx*9+dy*5,by-dy*9-dx*5)],fill='#181818')

for section, _, _, items in groups:
    for index, (title,actor,pipe,error,steps) in enumerate(items,1):
        actions=pipe.split('|')
        lane=next(lanes)
        assert len(lane)==len(actions), title
        height=132+82*len(actions)
        im=Image.new('RGB',(820,height),'white')
        d=ImageDraw.Draw(im)
        d.rectangle((1,1,818,height-2),outline='#181818',width=2)
        d.rectangle((2,2,327,41),fill='#e91e63')
        d.rectangle((328,2,817,41),fill='#e91e63')
        d.line((328,1,328,height-2),fill='#181818',width=2)
        d.text((164,21),actor,anchor='mm',font=bold,fill='white')
        d.text((573,21),'System',anchor='mm',font=bold,fill='white')
        d.ellipse((154,54,174,74),fill='#181818')
        prev=(164,74)
        num=0
        for i,(name,where) in enumerate(zip(actions,lane)):
            x=164 if where=='A' else 479
            y=109+i*82
            x0,x1=x-132,x+132
            y0,y1=y-25,y+25
            decision=name.endswith('?')
            if x==prev[0]:
                points=[prev,(x,y0)]
            else:
                mid=(prev[1]+y0)//2
                points=[prev,(prev[0],mid),(x,mid),(x,y0)]
            arrow(d,points)
            if decision:
                d.polygon([(x,y0-3),(x1,y),(x,y1+3),(x0,y)],fill='white',outline='#181818',width=2)
                d.multiline_text((x,y),wrap(d,name,small,168),font=small,anchor='mm',align='center',fill='black',spacing=1)
                d.text((x+8,y1+8),'Yes',font=small,fill='black')
                arrow(d,[(x1,y),(632,y)])
                d.text((617,y-12),'No',font=small,fill='black',anchor='mm')
                e=wrap(d,error,small,160)
                lines=e.count('\n')+1
                half=max(24,lines*8+6)
                d.rounded_rectangle((633,y-half,809,y+half),radius=8,outline='#181818',width=2)
                d.multiline_text((721,y),e,font=small,anchor='mm',align='center',fill='black',spacing=1)
            else:
                num+=1
                d.rounded_rectangle((x0,y0,x1,y1),radius=9,outline='#181818',width=2)
                d.multiline_text((x,y),wrap(d,f'{num}. {name}',normal,249),font=normal,anchor='mm',align='center',fill='black',spacing=1)
            prev=(x,y1+(3 if decision else 0))
        end_y=height-22
        arrow(d,[prev,(prev[0],end_y-10)])
        d.ellipse((prev[0]-10,end_y-10,prev[0]+10,end_y+10),outline='#181818',width=2)
        d.ellipse((prev[0]-6,end_y-6,prev[0]+6,end_y+6),fill='#181818')
        im.save(root/f'guide-{section}.{index}.png')
