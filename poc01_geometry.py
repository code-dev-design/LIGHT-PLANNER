from __future__ import annotations
import math, re, time
from pathlib import Path
from typing import Any
try:
    import pymupdf as fitz
except ImportError:
    import fitz  # type: ignore

EPS=0.04

WALL_LAYER_RE=re.compile(r'(^|[^A-Z])(WALLS?|MASONRY|BLOCK ?WORK|PARTITIONS?|MUR)([^A-Z]|$)',re.I)
WALL_LAYER_EXCLUDE_RE=re.compile(r'(HATCH|RIZ|FINISH|TILE|TEXT|DIM|NOTE|SYMBOL)',re.I)

def is_wall_layer(name):
    """Identify architectural wall geometry without treating wall hatches/notes as walls."""
    value=str(name or '').strip()
    return bool(value and WALL_LAYER_RE.search(value) and not WALL_LAYER_EXCLUDE_RE.search(value))

def xy(v):
    return (float(v.x),float(v.y)) if hasattr(v,'x') else (float(v[0]),float(v[1]))

def tx(v,m):
    x,y=xy(v)
    # Manual affine transform is ~10x faster than allocating fitz.Point for 250k+ points.
    return [round(x*m.a + y*m.c + m.e,3), round(x*m.b + y*m.d + m.f,3)]

def near(a,b,e=EPS): return abs(a[0]-b[0])<=e and abs(a[1]-b[1])<=e

def bbox(points):
    xs=[p[0] for p in points]; ys=[p[1] for p in points]
    return [round(min(xs),3),round(min(ys),3),round(max(xs),3),round(max(ys),3)]

def bbox_union(bs): return [min(b[0] for b in bs),min(b[1] for b in bs),max(b[2] for b in bs),max(b[3] for b in bs)]

def gap(a,b):
    dx=max(0,max(a[0],b[0])-min(a[2],b[2])); dy=max(0,max(a[1],b[1])-min(a[3],b[3]))
    return math.hypot(dx,dy)

def cpoint(cmd,t):
    _,p0,p1,p2,p3=cmd; q=1-t
    return [q**3*p0[0]+3*q*q*t*p1[0]+3*q*t*t*p2[0]+t**3*p3[0], q**3*p0[1]+3*q*q*t*p1[1]+3*q*t*t*p2[1]+t**3*p3[1]]

def chain_points(cmds,steps=12):
    out=[]
    for c in cmds:
        if c[0]=='l':
            if not out: out.append(c[1])
            out.append(c[2])
        else:
            if not out: out.append(c[1])
            out += [cpoint(c,i/steps) for i in range(1,steps+1)]
    return out

def split_path(path,m):
    out=[]; cur=[]
    def flush():
        nonlocal cur
        if cur:
            end=cur[-1][2] if cur[-1][0]=='l' else cur[-1][4]
            out.append({'commands':cur,'closed':near(cur[0][1],end,0.08)}); cur=[]
    for it in path.get('items',[]):
        k=it[0]
        if k in ('l','c'):
            c=['l',tx(it[1],m),tx(it[2],m)] if k=='l' else ['c',tx(it[1],m),tx(it[2],m),tx(it[3],m),tx(it[4],m)]
            if cur:
                prev=cur[-1][2] if cur[-1][0]=='l' else cur[-1][4]
                if not near(prev,c[1]): flush()
            cur.append(c)
        elif k in ('re','qu'):
            flush()
            if k=='re':
                r=it[1] if hasattr(it[1],'x0') else fitz.Rect(it[1]); pts=[tx((r.x0,r.y0),m),tx((r.x1,r.y0),m),tx((r.x1,r.y1),m),tx((r.x0,r.y1),m)]
            else:
                q=[tx(v,m) for v in it[1]]; pts=[q[0],q[1],q[3],q[2]]
            out.append({'commands':[['l',pts[i],pts[(i+1)%4]] for i in range(4)],'closed':True,'source_kind':k})
    flush(); return out

def classify(sub):
    cs=sub['commands']; pts=chain_points(cs); b=bbox(pts); closed=sub['closed']
    if len(cs)==1 and cs[0][0]=='l':
        a,z=cs[0][1],cs[0][2]; return {'t':'line','p':a+z,'len':round(math.hypot(z[0]-a[0],z[1]-a[1]),3),'bbox':b}
    p0=pts[:-1] if near(pts[0],pts[-1],0.1) else pts
    if len(p0)==4 and all(abs(p0[i][0]-p0[(i+1)%4][0])<.11 or abs(p0[i][1]-p0[(i+1)%4][1])<.11 for i in range(4)):
        return {'t':'rect','x':b[0],'y':b[1],'w':b[2]-b[0],'h':b[3]-b[1],'bbox':b}
    if closed and len(p0)>=8:
        cx=(b[0]+b[2])/2; cy=(b[1]+b[3])/2; rx=(b[2]-b[0])/2; ry=(b[3]-b[1])/2
        if rx>.4 and ry>.4:
            errs=[abs(math.sqrt(((x-cx)/rx)**2+((y-cy)/ry)**2)-1) for x,y in p0]
            rms=math.sqrt(sum(e*e for e in errs)/len(errs))
            if rms<.035:
                if abs(rx-ry)<=max(.12,max(rx,ry)*.015): return {'t':'circle','cx':round(cx,3),'cy':round(cy,3),'r':round((rx+ry)/2,3),'bbox':b}
                return {'t':'ellipse','cx':round(cx,3),'cy':round(cy,3),'rx':round(rx,3),'ry':round(ry,3),'bbox':b}
    if all(c[0]=='l' for c in cs):
        p=cs[0][1][:]
        for c in cs: p+=c[2]
        return {'t':'polyline','p':p,'closed':closed,'bbox':b}
    return {'t':'path','subpaths':[sub],'bbox':b}

def style_key(path):
    def col(c,f):
        if c is None:return f
        try: r,g,b=c; return f'#{round(r*255):02x}{round(g*255):02x}{round(b*255):02x}'
        except:return f
    return (col(path.get('color'),None),col(path.get('fill'),None),round(float(path.get('width') or .28),3),round(float(path.get('stroke_opacity') if path.get('stroke_opacity') is not None else 1),3),round(float(path.get('fill_opacity') if path.get('fill_opacity') is not None else 1),3),str(path.get('dashes') or ''))

def group_outlined_text(es,styles):
    cand=[i for i,e in enumerate(es) if styles[e['s']]['fill'] and styles[e['s']]['stroke'] and styles[e['s']]['width']<=0.20 and e['t'] in ('path','polyline','rect') and max(e['bbox'][2]-e['bbox'][0],e['bbox'][3]-e['bbox'][1])<=18 and (e['bbox'][2]-e['bbox'][0])*(e['bbox'][3]-e['bbox'][1])<=140]
    parent={i:i for i in cand}
    def find(i):
        while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
        return i
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b: parent[b]=a
    order=sorted(cand,key=lambda i:es[i]['bbox'][0])
    for n,i in enumerate(order):
        a=es[i]
        for j in order[n+1:]:
            b=es[j]
            if b['bbox'][0]-a['bbox'][2]>2.0: break
            if a['s']!=b['s'] or gap(a['bbox'],b['bbox'])>1.05: continue
            u=bbox_union([a['bbox'],b['bbox']])
            if u[2]-u[0]<=20 and u[3]-u[1]<=20: union(i,j)
    groups={}
    for i in cand: groups.setdefault(find(i),[]).append(i)
    merged={i for g in groups.values() if len(g)>1 for i in g}; out=[e for i,e in enumerate(es) if i not in merged]
    for g in groups.values():
        if len(g)<2: continue
        ms=[es[i] for i in g]; subs=[]
        for e in ms:
            if e['t']=='path': subs+=e['subpaths']
            elif e['t']=='polyline':
                pts=[[e['p'][k],e['p'][k+1]] for k in range(0,len(e['p']),2)]; cs=[['l',pts[k],pts[k+1]] for k in range(len(pts)-1)]
                if e.get('closed'): cs.append(['l',pts[-1],pts[0]])
                subs.append({'commands':cs,'closed':bool(e.get('closed'))})
            else:
                x,y,w,h=e['x'],e['y'],e['w'],e['h']; pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; subs.append({'commands':[['l',pts[k],pts[(k+1)%4]] for k in range(4)],'closed':True})
        out.append({'id':'tmp','t':'path','subpaths':subs,'bbox':bbox_union([e['bbox'] for e in ms]),'s':ms[0]['s'],'path':ms[0]['path'],'layer':ms[0]['layer'],'seq':min(e['seq'] for e in ms),'role':'outlined_text','source_ids':[e['id'] for e in ms]})
    out.sort(key=lambda e:(e.get('seq',0),e.get('path',0)))
    for i,e in enumerate(out):e['id']=f'e{i}'
    return out

def group_ring_symbols(es,styles):
    cand=[]
    for i,e in enumerate(es):
        if e['t']!='polyline' or e.get('closed'): continue
        b=e['bbox']; w=b[2]-b[0]; h=b[3]-b[1]
        if not (6<=w<=20 and 6<=h<=20 and 0.82<=w/h<=1.22): continue
        if len(e.get('p',[]))<22 or styles[e['s']].get('fill'): continue
        cand.append(i)
    used=set(); replacements=[]
    for i in cand:
        if i in used: continue
        a=es[i]; ab=a['bbox']; ac=((ab[0]+ab[2])/2,(ab[1]+ab[3])/2); aw=ab[2]-ab[0]; ah=ab[3]-ab[1]
        best=None
        for j in cand:
            if j==i or j in used: continue
            b=es[j]; bb=b['bbox']; bc=((bb[0]+bb[2])/2,(bb[1]+bb[3])/2); bw=bb[2]-bb[0]; bh=bb[3]-bb[1]
            cd=math.hypot(ac[0]-bc[0],ac[1]-bc[1]); ratio=max(bw/aw,bh/ah) if aw and ah else 9
            if bw>=aw or bh>=ah or not (0.72<=ratio<=0.94) or cd>0.45: continue
            score=cd+abs(ratio-.85)
            if best is None or score<best[0]: best=(score,j)
        if best:
            j=best[1]; used|={i,j}; a,b=es[i],es[j]
            def sub(e):
                pts=[[e['p'][k],e['p'][k+1]] for k in range(0,len(e['p']),2)]
                return {'commands':[['l',pts[k],pts[k+1]] for k in range(len(pts)-1)],'closed':False,'s':e['s']}
            replacements.append((min(i,j),{'id':'tmp','t':'path','subpaths':[sub(a),sub(b)],'bbox':bbox_union([a['bbox'],b['bbox']]),'s':a['s'],'path':a.get('path',-1),'layer':a.get('layer','PDF_Geometry'),'seq':min(a.get('seq',0),b.get('seq',0)),'role':'ring_symbol','source_ids':[a['id'],b['id']]}))
    out=[e for i,e in enumerate(es) if i not in used]+[e for _,e in replacements]
    out.sort(key=lambda e:(e.get('seq',0),e.get('path',0)))
    for i,e in enumerate(out): e['id']=f'e{i}'
    return out

def entity_subpaths(e):
    """Convert a small logical component to path subpaths without flattening it."""
    if e['t']=='path': return e.get('subpaths',[])
    if e['t']=='line':
        return [{'commands':[['l',e['p'][:2],e['p'][2:4]]],'closed':False}]
    if e['t']=='polyline':
        pts=[[e['p'][k],e['p'][k+1]] for k in range(0,len(e['p']),2)]
        cs=[['l',pts[k],pts[k+1]] for k in range(len(pts)-1)]
        if e.get('closed') and len(pts)>2: cs.append(['l',pts[-1],pts[0]])
        return [{'commands':cs,'closed':bool(e.get('closed'))}]
    if e['t']=='rect':
        x,y,w,h=e['x'],e['y'],e['w'],e['h']; pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
        return [{'commands':[['l',pts[k],pts[(k+1)%4]] for k in range(4)],'closed':True}]
    return []

def merged_component(ms,role):
    subs=[]; source=[]
    for e in ms:
        subs+=entity_subpaths(e)
        source+=e.get('source_ids') or [e['id']]
    first=min(ms,key=lambda e:e.get('seq',0))
    return {'id':'tmp','t':'path','subpaths':subs,'bbox':bbox_union([e['bbox'] for e in ms]),
            's':first['s'],'path':first.get('path',-1),'layer':first.get('layer','PDF_Geometry'),
            'seq':min(e.get('seq',0) for e in ms),'role':role,'source_ids':source}

def group_ring_contents(es,styles):
    """Normalize a dimension bubble to ring + glyph + marker logical entities.

    CAD PDFs commonly expand one numeral and its small leader marker into many
    independent vector fragments.  The double ring stays independent from the
    numeral and marker, while each of those visual parts becomes one selectable
    entity.  This prevents one bubble from reporting 7-10 selected primitives.
    """
    used=set(); replacements=[]; cell=24.0; buckets={}
    for i,e in enumerate(es):
        eb=e['bbox']; key=(math.floor(((eb[0]+eb[2])/2)/cell),math.floor(((eb[1]+eb[3])/2)/cell))
        buckets.setdefault(key,[]).append(i)
    rings=[(i,e) for i,e in enumerate(es) if e.get('role')=='ring_symbol']
    for ri,ring in rings:
        b=ring['bbox']; w=b[2]-b[0]; h=b[3]-b[1]
        if w<=0 or h<=0: continue
        cx=(b[0]+b[2])/2; cy=(b[1]+b[3])/2
        glyph=[]; marker=[]; reach=max(w,h)*1.25
        x0=math.floor((cx-reach)/cell); x1=math.floor((cx+reach)/cell)
        y0=math.floor((cy-reach)/cell); y1=math.floor((cy+reach)/cell)
        nearby={i for gx in range(x0,x1+1) for gy in range(y0,y1+1) for i in buckets.get((gx,gy),())}
        for i in nearby:
            e=es[i]
            if i==ri or i in used or e.get('role')=='ring_symbol': continue
            eb=e['bbox']; ew=eb[2]-eb[0]; eh=eb[3]-eb[1]
            ecx=(eb[0]+eb[2])/2; ecy=(eb[1]+eb[3])/2
            central=abs(ecx-cx)<=w*.30 and abs(ecy-cy)<=h*.34
            small=ew<=w*.72 and eh<=h*.72 and e['t'] in ('line','polyline','path','rect')
            if central and small:
                glyph.append((i,e)); continue
            adjacent=eb[0]<=b[2]+w*.22 and eb[2]>=b[0]-w*.22 and eb[1]<=b[3]+h*.22 and eb[3]>=b[1]-h*.22
            tiny=max(ew,eh)<=max(w,h)*.36 and min(ew,eh)<=max(w,h)*.24
            if adjacent and tiny and e['t'] in ('line','polyline','path','rect'):
                marker.append((i,e))
        if glyph:
            ids=[i for i,_ in glyph]; ms=[e for _,e in glyph]
            used.update(ids); replacements.append((min(ids),merged_component(ms,'outlined_text')))
        if len(marker)>=2:
            ids=[i for i,_ in marker]; ms=[e for _,e in marker]
            u=bbox_union([e['bbox'] for e in ms])
            if u[2]-u[0]<=w*.65 and u[3]-u[1]<=h*.65:
                used.update(ids); replacements.append((min(ids),merged_component(ms,'symbol_marker')))
    out=[e for i,e in enumerate(es) if i not in used]+[e for _,e in replacements]
    out.sort(key=lambda e:(e.get('seq',0),e.get('path',0),e.get('role','')))
    for i,e in enumerate(out): e['id']=f'e{i}'
    return out

def serialize_text(page,m):
    """Serialize PDF text with its real baseline and per-glyph positions.

    The editor UI is RTL, so relying on Canvas' inherited ``text-align:start``
    moves Latin text to the left of its PDF origin.  Font substitution can then
    accumulate another large error across a label.  Text-trace origins keep
    every glyph anchored to the location authored in the PDF.  They also expose
    glyph IDs, which let us recover printable ASCII from CAD subset fonts whose
    broken ToUnicode map otherwise turns ``RISER = 16 cm`` into cipher text.
    """
    def decode(code,gid):
        if code!=0xfffd:
            try:return chr(code)
            except ValueError:return '\ufffd'
        # Standard TrueType glyph order: gid 3 is space, 4..97 are !..~.
        # Only use this fallback when the PDF explicitly reports a missing
        # Unicode value, so valid symbol / non-Latin fonts remain untouched.
        return chr(gid+29) if 3<=gid<=97 else '\ufffd'

    out=[]; tid=0
    for s in page.get_texttrace():
        raw=s.get('chars',()); chars=[decode(int(ch[0]),int(ch[1])) for ch in raw]
        text=''.join(chars)
        if not text.strip():continue
        d=s.get('dir',(1,0)); o=raw[0][2] if raw else (s['bbox'][0],s['bbox'][3])
        p0=tx(o,m); p1=tx((o[0]+d[0],o[1]+d[1]),m)
        angle=math.atan2(p1[1]-p0[1],p1[0]-p0[0]); ca=math.cos(angle); sa=math.sin(angle)
        r=fitz.Rect(s['bbox']); corners=[tx((r.x0,r.y0),m),tx((r.x1,r.y0),m),tx((r.x1,r.y1),m),tx((r.x0,r.y1),m)]
        glyphs=[]
        for ch,c in zip(raw,chars):
            co=tx(ch[2],m); vx=co[0]-p0[0]; vy=co[1]-p0[1]
            cr=fitz.Rect(ch[3]); cc=[tx((cr.x0,cr.y0),m),tx((cr.x1,cr.y0),m),tx((cr.x1,cr.y1),m),tx((cr.x0,cr.y1),m)]
            projected=[(q[0]-co[0])*ca+(q[1]-co[1])*sa for q in cc]
            glyphs.append({'c':c,'dx':round(vx*ca+vy*sa,3),'dy':round(-vx*sa+vy*ca,3),'width':round(max(projected)-min(projected),3)})
        raw_color=s.get('color',(0,0,0))
        if isinstance(raw_color,(tuple,list)) and len(raw_color)>=3:
            rgb=[max(0,min(255,round(float(v)*255))) for v in raw_color[:3]]
            color=f'#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'
        else: color='#111111'
        font=str(s.get('font','Arial')); flags=int(s.get('flags',0) or 0)
        weight=700 if re.search(r'(bold|black|demi|semibold)',font,re.I) or flags&16 else 400
        italic=bool(re.search(r'(italic|oblique)',font,re.I) or flags&2)
        out.append({'id':f't{tid}','t':'text','text':text,'x':p0[0],'y':p0[1],
                    'size':round(float(s.get('size',10)),3),'font':font,'weight':weight,'italic':italic,
                    'color':color,'angle':round(math.degrees(angle),3),'bbox':bbox(corners),
                    'chars':glyphs,'rtl':bool(re.search(r'[\u0590-\u08ff]',text)),
                    'layer':str(s.get('layer') or 'PDF_Text'),'seq':int(s.get('seqno',tid))}); tid+=1
    return out

def detect_dimension_unit(page_text,texts):
    """Return the sheet's written dimension unit and how confidently it was found."""
    lines=[re.sub(r'\s+',' ',line).strip() for line in (page_text or '').splitlines()]
    checks=[
        ('cm',re.compile(r'(?:ALL\s+)?DIM(?:ENSION|ENSIONS|\.)[^\n]{0,45}(?:CENTIMET(?:ER|RE)S?|\bCM\b)',re.I)),
        ('mm',re.compile(r'(?:ALL\s+)?DIM(?:ENSION|ENSIONS|\.)[^\n]{0,45}(?:MILLIMET(?:ER|RE)S?|\bMM\b)',re.I)),
        ('m',re.compile(r'(?:ALL\s+)?DIM(?:ENSION|ENSIONS|\.)[^\n]{0,45}(?:\bMETERS?\b|\bMETRES?\b|\bIN\s+M\.)',re.I)),
    ]
    for unit,pattern in checks:
        for line in lines:
            if pattern.search(line): return {'unit':unit,'confidence':'explicit','evidence':line[:160]}
    values=[]
    for item in texts:
        value=str(item.get('text','')).strip().replace(',','')
        if re.fullmatch(r'\d+(?:\.\d+)?',value):
            try: values.append(float(value))
            except ValueError: pass
    large=sum(80<=v<=2500 and abs(v-round(v))<1e-6 for v in values)
    metres=sum(.1<=v<=40 and not float(v).is_integer() for v in values)
    if large>=8 and large>=metres*1.5:
        return {'unit':'cm','confidence':'inferred','evidence':f'{large} dimension-like integer labels'}
    if metres>=8:
        return {'unit':'m','confidence':'inferred','evidence':f'{metres} decimal dimension labels'}
    return {'unit':None,'confidence':'unknown','evidence':''}

def extract_editable_geometry(pdf_path:Path|str,page_index=0):
    started=time.perf_counter()
    with fitz.open(pdf_path) as doc:
        page=doc[page_index]; m=page.rotation_matrix; drawings=page.get_cdrawings(); styles=[]; smap={}; es=[]; source_items=0
        for pn,path in enumerate(drawings):
            sk=style_key(path)
            if sk not in smap:
                smap[sk]=len(styles); styles.append({'stroke':sk[0],'fill':sk[1],'width':sk[2],'strokeAlpha':sk[3],'fillAlpha':sk[4],'dashes':sk[5]})
            source_items+=len(path.get('items',[])); sidx=smap[sk]; layer=path.get('layer') or 'PDF_Geometry'; seq=int(path.get('seqno') or pn)
            for sn,sub in enumerate(split_path(path,m)):
                e=classify(sub); e.update({'id':f'e{len(es)}','s':sidx,'path':pn,'subpath':sn,'layer':layer,'seq':seq})
                if is_wall_layer(layer): e.update({'wall':True,'role':'wall'})
                es.append(e)
        pre=len(es); es=group_outlined_text(es,styles); es=group_ring_symbols(es,styles); es=group_ring_contents(es,styles); texts=serialize_text(page,m)
        unit=detect_dimension_unit(page.get_text('text') or '',texts)
        st={'source_items':source_items,'entities':len(es),'pre_group_entities':pre,'lines':sum(e['t']=='line' for e in es),'polylines':sum(e['t']=='polyline' for e in es),'paths':sum(e['t']=='path' for e in es),'circles':sum(e['t']=='circle' for e in es),'ellipses':sum(e['t']=='ellipse' for e in es),'rectangles':sum(e['t']=='rect' for e in es),'texts':len(texts),'wall_entities':sum(bool(e.get('wall')) for e in es),'seconds':round(time.perf_counter()-started,3)}
        return {'page':page_index,'width':round(float(page.rect.width),3),'height':round(float(page.rect.height),3),'rotation':int(page.rotation),'styles':styles,'entities':es,'texts':texts,'dimension_unit':unit,'stats':st}
