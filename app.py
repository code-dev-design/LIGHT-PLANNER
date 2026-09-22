from __future__ import annotations
import gzip,hashlib,json,mimetypes,os,re,threading,time,uuid,webbrowser
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote,urlparse
try:
 import pymupdf as fitz
except ImportError:
 import fitz  # type: ignore
from poc01_geometry import extract_editable_geometry

BASE_DIR=Path(__file__).resolve().parent; STATIC_DIR=BASE_DIR/'static'; ASSET_DIR=STATIC_DIR/'assets'; RUNTIME_DIR=BASE_DIR/'runtime'; UPLOAD_DIR=RUNTIME_DIR/'uploads'; CACHE_DIR=RUNTIME_DIR/'cache'
for d in (UPLOAD_DIR,CACHE_DIR): d.mkdir(parents=True,exist_ok=True)
IS_CLOUD=os.environ.get('RENDER','').lower()=='true' or bool(os.environ.get('RENDER_EXTERNAL_HOSTNAME')); HOST=os.environ.get('HOST','0.0.0.0' if IS_CLOUD else '127.0.0.1'); PORT=int(os.environ.get('PORT','8765')); MAX_UPLOAD=120*1024*1024
PROJECTS:dict[str,dict[str,Any]]={}; PROJECT_LOCK=threading.Lock(); CACHE_LOCK_GUARD=threading.Lock(); CACHE_LOCKS:dict[str,threading.Lock]={}; ANALYSIS_VERSION=3

PAGE_SIZES={'a4':(595.276,841.890),'a3':(841.890,1190.551)}  # points, portrait
def svg_to_pdf(svg,page_size='native'):
 src=fitz.open(stream=svg.encode(),filetype='svg'); native=src.convert_to_pdf()
 key=str(page_size or 'native').lower()
 if key not in PAGE_SIZES: return native
 src_pdf=fitz.open('pdf',native); sp=src_pdf[0].rect
 pw,ph=PAGE_SIZES[key]
 if sp.width>=sp.height: pw,ph=max(pw,ph),min(pw,ph)   # landscape to match wide plans
 else: pw,ph=min(pw,ph),max(pw,ph)                      # portrait
 out=fitz.open(); page=out.new_page(width=pw,height=ph)
 margin=28.35  # ~1cm printable margin
 aw,ah=max(1.0,pw-2*margin),max(1.0,ph-2*margin)
 scale=min(aw/max(sp.width,1e-6),ah/max(sp.height,1e-6))
 tw,th=sp.width*scale,sp.height*scale; x0=(pw-tw)/2; y0=(ph-th)/2
 page.show_pdf_page(fitz.Rect(x0,y0,x0+tw,y0+th),src_pdf,0)
 return out.tobytes()
def safe_name(name):
 name=Path(name or 'drawing.pdf').name; name=re.sub(r'[^A-Za-z0-9._() -]+','_',name).strip(); return (name or 'drawing.pdf')[:160]
def detect_scale(text):
 m=re.search(r'(?:scale\s*[:=]?\s*|مقياس\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})',text,re.I); return re.sub(r'\s+','',m.group(1)).replace('/',':') if m else None
def bytes_fingerprint(payload):return hashlib.sha256(payload).hexdigest()
def file_fingerprint(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as src:
  for chunk in iter(lambda:src.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def thumbnail_path(fingerprint,page_index):return CACHE_DIR/f'{fingerprint}-thumb-{page_index}.png'
def underlay_path(fingerprint,page_index):return CACHE_DIR/f'{fingerprint}-underlay-v1-{page_index}.png'
def cache_lock(key):
 with CACHE_LOCK_GUARD:return CACHE_LOCKS.setdefault(key,threading.Lock())
def page_stats(page):
 images=len(page.get_images(full=True));fonts=len(page.get_fonts(full=True));streams=len(page.get_contents() or [])
 cls='Raster PDF - opens as image underlay' if images and not fonts else ('Mixed PDF - exact vectors checked on import' if images else ('Vector PDF - exact vectors checked on import' if streams else 'Empty PDF page'))
 return {'lines':None,'curves':None,'rects':None,'quads':None,'vector_entities':None,'paths':None,'text_spans':None,'images':images,'fonts':fonts,'classification':cls,'scale':None,'rotation':int(page.rotation)}
def create_thumbnail_from_page(page,output):
 if output.exists():return
 z=min(360/max(page.rect.width,page.rect.height),.6); pix=page.get_pixmap(matrix=fitz.Matrix(z,z),alpha=False); pix.save(output)
def create_thumbnail(pdf_path,page_index,output):
 if output.exists():return
 with fitz.open(pdf_path) as doc:create_thumbnail_from_page(doc[page_index],output)
def create_underlay(pdf_path,page_index,output):
 if output.exists():return
 with fitz.open(pdf_path) as doc:
  page=doc[page_index];scale=min(2.0,2600/max(page.rect.width,page.rect.height));page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).save(output)
def analysis_blueprint(pdf_path,fingerprint):
 cache=CACHE_DIR/f'{fingerprint}-analysis-v{ANALYSIS_VERSION}.json'
 with cache_lock(f'analysis:{fingerprint}'):
  if cache.exists():
   try:return json.loads(cache.read_text(encoding='utf-8')),True
   except (OSError,ValueError):pass
  started=time.perf_counter();pages=[]
  with fitz.open(pdf_path) as doc:
   for i,p in enumerate(doc):
    st=page_stats(p);pages.append({'index':i,'number':i+1,'width':round(float(p.rect.width),2),'height':round(float(p.rect.height),2),**st})
  blueprint={'page_count':len(pages),'size_mb':round(Path(pdf_path).stat().st_size/1024/1024,2),'pages':pages,'analysis_seconds':round(time.perf_counter()-started,3)}
  tmp=cache.with_suffix('.tmp');tmp.write_text(json.dumps(blueprint,ensure_ascii=False,separators=(',',':')),encoding='utf-8');tmp.replace(cache)
  return blueprint,False
def analyze_pdf(pdf_path,filename,project_id,fingerprint=None):
 fingerprint=fingerprint or file_fingerprint(pdf_path);blueprint,cache_hit=analysis_blueprint(pdf_path,fingerprint);pages=[{**p,'thumbnail':f'/api/project/{project_id}/thumb/{p["index"]}'} for p in blueprint['pages']]
 return {'project_id':project_id,'filename':filename,'fingerprint':fingerprint,'cache_hit':cache_hit,'page_count':blueprint['page_count'],'size_mb':blueprint['size_mb'],'analysis_seconds':0 if cache_hit else blueprint.get('analysis_seconds',0),'pages':pages}
def project_from_sample():
 src=ASSET_DIR/'sample_floor_plan.pdf'; pid='sample'
 if not src.exists(): raise FileNotFoundError('sample_floor_plan.pdf missing')
 fingerprint=file_fingerprint(src)
 with PROJECT_LOCK: PROJECTS[pid]={'path':src,'filename':'A2Z Sample - Ground Floor.pdf','fingerprint':fingerprint}
 return analyze_pdf(src,'A2Z Sample - Ground Floor.pdf',pid,fingerprint)
def parse_multipart(body,ctype):
 m=re.search(r'boundary=(?:"([^"]+)"|([^;]+))',ctype)
 if not m:raise ValueError('Missing multipart boundary')
 marker=b'--'+(m.group(1) or m.group(2)).encode()
 for part in body.split(marker):
  if b'Content-Disposition:' not in part:continue
  head,sep,payload=part.partition(b'\r\n\r\n')
  if not sep:continue
  fm=re.search(r'filename="([^"]*)"',head.decode('utf-8','replace'))
  if fm:return payload.rstrip(b'\r\n-'),safe_name(fm.group(1))
 raise ValueError('No file part found')
def cached_vector_payload(pdf_path,fingerprint,page_index):
 cache=CACHE_DIR/f'{fingerprint}-vectors-v9-{page_index}.json.gz'
 with cache_lock(f'vectors:{fingerprint}:{page_index}'):
  if cache.exists():return cache.read_bytes()
  data=extract_editable_geometry(Path(pdf_path),page_index);packed=gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),1);cache.write_bytes(packed);return packed

class Handler(BaseHTTPRequestHandler):
 server_version='A2ZVectorCAD/3.1-POC01'
 def log_message(self,fmt,*args): print(f'[{self.log_date_time_string()}] {fmt%args}')
 def send_json(self,data,status=200,compress=True):
  raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(); use=compress and 'gzip' in self.headers.get('Accept-Encoding','') and len(raw)>2048; payload=gzip.compress(raw,3) if use else raw
  self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(payload)));
  if use:self.send_header('Content-Encoding','gzip')
  self.end_headers(); self.wfile.write(payload)
 def send_bytes(self,payload,mime,filename=None,status=200):
  self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));
  if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
  self.end_headers();self.wfile.write(payload)
 def serve_file(self,path):
  try:
   r=path.resolve()
   if STATIC_DIR.resolve() not in r.parents and r!=STATIC_DIR.resolve():return self.send_error(403)
   payload=r.read_bytes()
  except FileNotFoundError:return self.send_error(404)
  mime=mimetypes.guess_type(str(r))[0] or 'application/octet-stream'; self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-cache');self.end_headers();self.wfile.write(payload)
 def do_GET(self):
  path=unquote(urlparse(self.path).path)
  try:
   if path=='/':return self.serve_file(STATIC_DIR/'index.html')
   if path.startswith('/static/'):return self.serve_file(STATIC_DIR/path[8:])
   if path=='/api/health':return self.send_json({'status':'ok','engine':f"PyMuPDF {getattr(fitz,'__version__','')}",'mode':'poc01-normalized-vector-pdf-import','schema':9})
   if path=='/api/sample':return self.send_json(project_from_sample())
   m=re.fullmatch(r'/api/project/([A-Za-z0-9_-]+)/thumb/(\d+)',path)
   if m:
    pid,ps=m.groups(); pr=PROJECTS.get(pid)
    if not pr:return self.send_json({'detail':'Project not found'},404)
    out=thumbnail_path(pr.get('fingerprint',pid),int(ps));create_thumbnail(Path(pr['path']),int(ps),out);return self.send_bytes(out.read_bytes(),'image/png')
   m=re.fullmatch(r'/api/project/([A-Za-z0-9_-]+)/underlay/(\d+)',path)
   if m:
    pid,ps=m.groups();pr=PROJECTS.get(pid)
    if not pr:return self.send_json({'detail':'Project not found'},404)
    out=underlay_path(pr.get('fingerprint',pid),int(ps));create_underlay(Path(pr['path']),int(ps),out);return self.send_bytes(out.read_bytes(),'image/png')
   m=re.fullmatch(r'/api/project/([A-Za-z0-9_-]+)/vectors/(\d+)',path)
   if m:
    pid,ps=m.groups();pr=PROJECTS.get(pid)
    if not pr:return self.send_json({'detail':'Project not found'},404)
    pi=int(ps);payload=cached_vector_payload(pr['path'],pr.get('fingerprint',pid),pi);self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(payload);return
   self.send_error(404)
  except Exception as exc:self.send_json({'detail':f'Server error: {exc}'},500)
 def do_POST(self):
  path=urlparse(self.path).path
  try:
   length=int(self.headers.get('Content-Length','0'))
   if length<=0:return self.send_json({'detail':'Empty request'},400)
   if length>MAX_UPLOAD:return self.send_json({'detail':'File exceeds 120 MB demo limit'},413)
   body=self.rfile.read(length)
   if path=='/api/analyze':
    payload,filename=parse_multipart(body,self.headers.get('Content-Type',''))
    if not payload.startswith(b'%PDF'):return self.send_json({'detail':'This POC imports PDF only.'},415)
    pid=uuid.uuid4().hex[:12];fingerprint=bytes_fingerprint(payload);stored=UPLOAD_DIR/f'{fingerprint}.pdf'
    with cache_lock(f'upload:{fingerprint}'):
     if not stored.exists():stored.write_bytes(payload)
    result=analyze_pdf(stored,filename,pid,fingerprint)
    with PROJECT_LOCK:PROJECTS[pid]={'path':stored,'filename':filename,'fingerprint':fingerprint}
    return self.send_json(result)
   if path=='/api/svg-to-pdf':
    data=json.loads(body.decode());svg=data.get('svg','');page_size=data.get('page_size','native')
    if not svg or len(svg)>30_000_000:return self.send_json({'detail':'Invalid SVG'},400)
    suffix='' if str(page_size).lower() not in PAGE_SIZES else '-'+str(page_size).upper()
    return self.send_bytes(svg_to_pdf(svg,page_size),'application/pdf',f'A2Z-Lighting-Plan{suffix}.pdf')
   self.send_error(404)
  except ValueError as exc:self.send_json({'detail':str(exc)},400)
  except Exception as exc:self.send_json({'detail':f'Server error: {exc}'},500)

def main():
 try:project_from_sample()
 except Exception as e:print('Sample warning:',e)
 server=ThreadingHTTPServer((HOST,PORT),Handler);print(f'A2Z POC-01 closeout server: http://{HOST}:{PORT}')
 if not IS_CLOUD and os.environ.get('A2Z_NO_BROWSER')!='1':webbrowser.open(f'http://{HOST}:{PORT}')
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close()
if __name__=='__main__':main()
