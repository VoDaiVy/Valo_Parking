import html, json, math, re
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).parent
ink = '#171717'
def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/' + ('arialbd.ttf' if bold else 'arial.ttf'), max(7, int(size)))

def clean(value):
    value = html.unescape(value or '')
    value = re.sub(r'<br\s*/?>|</div>|</p>', '\n', value, flags=re.I)
    return re.sub(r'<[^>]*>', '', value).strip()

def centered(draw, point, value, size, width, color=ink, bold=False):
    f = font(size, bold)
    lines = []
    for paragraph in value.splitlines():
        line = ''
        for word in paragraph.split():
            candidate = (line + ' ' + word).strip()
            if line and draw.textlength(candidate, font=f) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    draw.multiline_text(point, '\n'.join(lines), fill=color, font=f, align='center', anchor='mm', spacing=2)

def render(page):
    model = ET.fromstring(page['xml'])
    cells = {c.get('id'):c for c in model.findall('.//mxCell')}
    styles = {i:dict(p.split('=',1) if '=' in p else (p,'1') for p in c.get('style','').split(';') if p) for i,c in cells.items()}
    boxes = {}
    def box(i):
        if i in boxes: return boxes[i]
        c = cells.get(i)
        g = None if c is None else c.find('mxGeometry')
        if g is None or g.get('relative') == '1' or c.get('edge') == '1': return (0,0,0,0)
        px,py,_,_ = box(c.get('parent'))
        x,y,w,h = [float(g.get(k,0)) for k in ('x','y','width','height')]
        boxes[i] = (px+x,py+y,px+x+w,py+y+h)
        return boxes[i]
    vertices = [i for i,c in cells.items() if c.get('vertex')=='1' and box(i)[2]>box(i)[0]]
    left=min(box(i)[0] for i in vertices)-12
    top=min(box(i)[1] for i in vertices)-12
    width=max(box(i)[2] for i in vertices)-left+12
    height=max(box(i)[3] for i in vertices)-top+12
    im=Image.new('RGB',(math.ceil(width),math.ceil(height)),'white')
    d=ImageDraw.Draw(im)
    def pos(x,y): return (x-left,y-top)
    def rect(i): x,y,u,v=box(i); return (*pos(x,y),*pos(u,v))
    lanes = [i for i in vertices if 'swimlane' in styles[i] or styles[i].get('shape')=='swimlane']
    for i in lanes:
        x,y,u,v=rect(i); h=float(styles[i].get('startSize',30))
        d.rectangle((x,y,u,v),fill='white',outline=ink,width=2)
        d.rectangle((x+1,y+1,u-1,y+h),fill=styles[i].get('fillColor','#e91e63'))
        centered(d,((x+u)/2,y+h/2),clean(cells[i].get('value')),styles[i].get('fontSize',16),u-x-10,'white',True)
    banners = [i for i in vertices if styles[i].get('fillColor') == '#e91e63' and not clean(cells[i].get('value'))]
    for i in banners:
        d.rectangle(rect(i),fill='#e91e63')
    def attach(i,s,side,other):
        x,y,u,v=box(i)
        if side+'X' in s and side+'Y' in s:
            return x+(u-x)*float(s[side+'X']), y+(v-y)*float(s[side+'Y'])
        cx,cy=(x+u)/2,(y+v)/2
        dx,dy=other[0]-cx,other[1]-cy
        if abs(dx)/(max(1,u-x))>abs(dy)/(max(1,v-y)): return (u if dx>0 else x,cy)
        return (cx,v if dy>0 else y)
    labels=[]
    edge_labels = {c.get('parent'):c for c in cells.values() if 'edgeLabel' in c.get('style','') and c.get('value')}
    for i,c in cells.items():
        if c.get('edge')!='1': continue
        s=styles[i]; g=c.find('mxGeometry')
        if g is None: continue
        bx,by,_,_=box(c.get('parent'))
        def xy(p): return (float(p.get('x',0))+bx,float(p.get('y',0))+by)
        via=[xy(p) for p in g.findall('Array/mxPoint')]
        src,tgt=c.get('source'),c.get('target')
        if page['n']==43 and i=='7ZyUZ75sjBf1PuCinvQ_-26':
            tgt=next(k for k in vertices if clean(cells[k].get('value')).startswith('3. Sort'))
        sp,tp=g.find("mxPoint[@as='sourcePoint']"),g.find("mxPoint[@as='targetPoint']")
        if not (src in boxes or sp is not None) or not (tgt in boxes or tp is not None): continue
        sc=((box(src)[0]+box(src)[2])/2,(box(src)[1]+box(src)[3])/2) if src in boxes else xy(sp)
        tc=((box(tgt)[0]+box(tgt)[2])/2,(box(tgt)[1]+box(tgt)[3])/2) if tgt in boxes else xy(tp)
        start=attach(src,s,'exit',via[0] if via else tc) if src in boxes else sc
        end=attach(tgt,s,'entry',via[-1] if via else sc) if tgt in boxes else tc
        raw=[start,*via,end]
        points=[pos(*start)]
        for a,b in zip(raw,raw[1:]):
            if a==b: continue
            if a[0]!=b[0] and a[1]!=b[1]:
                if len(raw)==2 and abs(b[1]-a[1])>=22:
                    m=(a[1]+b[1])/2
                    points.extend([pos(a[0],m),pos(b[0],m)])
                else: points.append(pos(b[0],a[1]))
            points.append(pos(*b))
        if len(points)<2: continue
        for a,b in zip(points,points[1:]):
            length=math.dist(a,b)
            if length<1: continue
            if s.get('dashed')=='1':
                for k in range(0,int(length),10):
                    d.line([tuple(a[q]+(b[q]-a[q])*f/length for q in (0,1)) for f in (k,min(k+5,length))],fill=ink,width=2)
            else: d.line([a,b],fill=ink,width=2)
        a,b=points[-2:]; length=math.dist(a,b)
        if length and s.get('endArrow')!='none':
            dx,dy=((b[q]-a[q])/length for q in (0,1)); x,y=b
            d.polygon([b,(x-9*dx-4*dy,y-9*dy+4*dx),(x-9*dx+4*dy,y-9*dy-4*dx)],fill=ink)
        relative_label=edge_labels.get(i)
        label=clean(c.get('value') or (relative_label.get('value') if relative_label is not None else ''))
        if label:
            segments=[(a,b,math.dist(a,b)) for a,b in zip(points,points[1:]) if a!=b]
            if segments:
                fraction=(1+float(relative_label.find('mxGeometry').get('x','0')))/2 if relative_label is not None else .5
                distance=sum(length for a,b,length in segments)*max(0,min(1,fraction))
                for a,b,length in segments:
                    if distance<=length:
                        labels.append(((a[0]+(b[0]-a[0])*distance/length+8,a[1]+(b[1]-a[1])*distance/length-9),label))
                        break
                    distance-=length
    for i in vertices:
        if i in lanes or i in banners: continue
        s=styles[i]; x,y,u,v=rect(i); w=u-x; h=v-y; cx,cy=(x+u)/2,(y+v)/2
        value=clean(cells[i].get('value'))
        fill=s.get('fillColor','white'); fill=None if fill=='none' else ('white' if fill=='default' else fill)
        if 'ellipse' in s or s.get('shape') in ('ellipse','doubleEllipse'):
            d.ellipse((x,y,u,v),fill=fill,outline=ink,width=2)
            if s.get('shape')=='doubleEllipse' or 'doubleEllipse' in s:
                d.ellipse((x+5,y+5,u-5,v-5),fill=ink)
        elif 'rhombus' in s or s.get('shape')=='rhombus':
            d.polygon([(cx,y),(u,cy),(cx,v),(x,cy)],fill='white',outline=ink,width=2)
            w*=.66
        elif 'text' not in s and s.get('shape')!='text':
            if not value and s.get('strokeColor')=='none': continue
            if s.get('rounded')=='0':
                d.rectangle((x,y,u,v),fill=fill,outline=ink,width=2)
            else:
                d.rounded_rectangle((x,y,u,v),radius=8,fill=fill,outline=ink,width=2)
        if value:
            centered(d,(cx,cy),value,float(s.get('fontSize',13)),w-8,s.get('fontColor',ink),s.get('fontStyle')=='1')
    for (x,y),label in labels:
        f=font(12); w=d.textlength(label,font=f)/2+2
        d.rectangle((x-w,y-7,x+w,y+7),fill='white')
        d.text((x,y),label,anchor='mm',font=f,fill=ink)
    im.save(root/f"workflow-{page['n']}.png")

for page in json.loads((root/'drawio-pages.json').read_text(encoding='utf-8')):
    render(page)

for n,title,role,rows,action,hint in json.loads((root/'screens.json').read_text(encoding='utf-8')):
    entries=rows.split('|')
    height=270+52*len(entries)
    im=Image.new('RGB',(960,height),'#0b1017')
    d=ImageDraw.Draw(im)
    d.rectangle((0,0,960,65),fill='#131b26')
    d.text((30,33),'VALOParking',anchor='lm',font=font(25,True),fill='#e5b962')
    d.text((930,33),role+' Portal' if role!='Guest' else 'Guest',anchor='rm',font=font(18),fill='white')
    d.rounded_rectangle((190,88,770,height-38),radius=16,fill='#151e2a',outline='#323e4d',width=2)
    d.text((222,115),title,font=font(29,True),fill='white')
    for j,value in enumerate(entries):
        y=166+j*52
        d.rounded_rectangle((222,y,738,y+40),radius=7,fill='#0e151e',outline='#49586a')
        d.text((240,y+20),value,anchor='lm',font=font(18),fill='#e8edf5')
    y=176+len(entries)*52
    d.rounded_rectangle((222,y,738,y+38),radius=7,fill='#e5b962')
    d.text((480,y+19),action,anchor='mm',font=font(18,True),fill='#17202a')
    if hint: d.text((480,y+52),hint,anchor='mm',font=font(15),fill='#bec9d6')
    d.text((30,height-19),'ILLUSTRATIVE SCREEN  /  SAMPLE DATA',anchor='lm',font=font(12,True),fill='#bec9d6')
    im.save(root/f"screen-{n}.png")
