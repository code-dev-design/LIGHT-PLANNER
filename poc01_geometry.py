from __future__ import annotations
import math, time
from pathlib import Path
from typing import Any
try:
    import pymupdf as fitz
except ImportError:
    import fitz  # type: ignore

EPS=0.04

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

def serialize_text(page,m):
    out=[]; tid=0; data=page.get_text('dict',flags=fitz.TEXTFLAGS_TEXT)
    for b in data.get('blocks',[]):
        if b.get('type')!=0: continue
        for ln in b.get('lines',[]):
            d=ln.get('dir',(1,0))
            for s in ln.get('spans',[]):
                text=s.get('text','')
                if not text.strip():continue
                o=s.get('origin',(s['bbox'][0],s['bbox'][3])); p0=fitz.Point(*o)*m; p1=fitz.Point(o[0]+d[0],o[1]+d[1])*m
                r=fitz.Rect(s['bbox']); cs=[fitz.Point(r.x0,r.y0)*m,fitz.Point(r.x1,r.y0)*m,fitz.Point(r.x1,r.y1)*m,fitz.Point(r.x0,r.y1)*m]
                try: rgb=fitz.sRGB_to_rgb(int(s.get('color',0))); color=f'#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'
                except: color='#111111'
                out.append({'id':f't{tid}','t':'text','text':text,'x':round(float(p0.x),3),'y':round(float(p0.y),3),'size':round(float(s.get('size',10)),3),'font':s.get('font','Arial'),'color':color,'angle':round(math.degrees(math.atan2(p1.y-p0.y,p1.x-p0.x)),3),'bbox':bbox([[c.x,c.y] for c in cs]),'layer':'PDF_Text','seq':tid}); tid+=1
    return out

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
                e=classify(sub); e.update({'id':f'e{len(es)}','s':sidx,'path':pn,'subpath':sn,'layer':layer,'seq':seq}); es.append(e)
        pre=len(es); es=group_outlined_text(es,styles); es=group_ring_symbols(es,styles); texts=serialize_text(page,m)
        st={'source_items':source_items,'entities':len(es),'pre_group_entities':pre,'lines':sum(e['t']=='line' for e in es),'polylines':sum(e['t']=='polyline' for e in es),'paths':sum(e['t']=='path' for e in es),'circles':sum(e['t']=='circle' for e in es),'ellipses':sum(e['t']=='ellipse' for e in es),'rectangles':sum(e['t']=='rect' for e in es),'texts':len(texts),'seconds':round(time.perf_counter()-started,3)}
        return {'page':page_index,'width':round(float(page.rect.width),3),'height':round(float(page.rect.height),3),'rotation':int(page.rotation),'styles':styles,'entities':es,'texts':texts,'stats':st}
