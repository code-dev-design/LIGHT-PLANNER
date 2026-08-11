from __future__ import annotations
import gzip,json,mimetypes,os,re,threading,time,uuid,webbrowser
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
PROJECTS:dict[str,dict[str,Any]]={}; PROJECT_LOCK=threading.Lock()

def safe_name(name):
 name=Path(name or 'drawing.pdf').name; name=re.sub(r'[^A-Za-z0-9._() -]+','_',name).strip(); return (name or 'drawing.pdf')[:160]
def detect_scale(text):
 m=re.search(r'(?:scale\s*[:=]?\s*|مقياس\s*[:=]?\s*)?(1\s*[:/]\s*\d{1,4})',text,re.I); return re.sub(r'\s+','',m.group(1)).replace('/',':') if m else None
def page_stats(page):
 dr=page.get_cdrawings(); c={'lines':0,'curves':0,'rects':0,'quads':0}
 for p in dr:
  for it in p.get('items',()):
   if it[0]=='l':c['lines']+=1
   elif it[0]=='c':c['curves']+=1
   elif it[0]=='re':c['rects']+=1
   elif it[0]=='qu':c['quads']+=1
 spans=sum(len(ln.get('spans',[])) for b in page.get_text('dict',flags=fitz.TEXTFLAGS_TEXT).get('blocks',[]) if b.get('type')==0 for ln in b.get('lines',[])); images=len(page.get_images(full=True)); total=sum(c.values())
 cls='Vector PDF - editable geometry' if total>=100 else ('Mixed PDF - limited vector geometry' if total else ('Raster PDF - image underlay only' if images else 'No editable geometry detected'))
 return {**c,'vector_entities':total,'paths':len(dr),'text_spans':spans,'images':images,'classification':cls,'scale':detect_scale(page.get_text('text') or ''),'rotation':int(page.rotation)}
def create_thumbnail(pdf_path,page_index,output):
 if output.exists():return
 with fitz.open(pdf_path) as doc:
  p=doc[page_index]; z=min(360/max(p.rect.width,p.rect.height),.6); pix=p.get_pixmap(matrix=fitz.Matrix(z,z),alpha=False); pix.save(output)
def analyze_pdf(pdf_path,filename,project_id):
 pages=[]
 with fitz.open(pdf_path) as doc:
  for i,p in enumerate(doc):
   st=page_stats(p); thumb=CACHE_DIR/f'{project_id}-thumb-{i}.png'; create_thumbnail(pdf_path,i,thumb); pages.append({'index':i,'number':i+1,'width':round(float(p.rect.width),2),'height':round(float(p.rect.height),2),'thumbnail':f'/api/project/{project_id}/thumb/{i}',**st})
 return {'project_id':project_id,'filename':filename,'page_count':len(pages),'size_mb':round(pdf_path.stat().st_size/1024/1024,2),'pages':pages}
def project_from_sample():
 src=ASSET_DIR/'sample_floor_plan.pdf'; pid='sample'
 if not src.exists(): raise FileNotFoundError('sample_floor_plan.pdf missing')
 with PROJECT_LOCK: PROJECTS[pid]={'path':src,'filename':'A2Z Sample - Ground Floor.pdf'}
 return analyze_pdf(src,'A2Z Sample - Ground Floor.pdf',pid)
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

class Handler(BaseHTTPRequestHandler):
 server_version='A2ZVectorCAD/3.0-POC01'
 def log_message(self,fmt,*args): print(f'[{self.log_date_time_string()}] {fmt%args}')
 def send_json(self,data,status=200,compress=True):
  raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(); use=compress and 'gzip' in self.headers.get('Accept-Encoding','') and len(raw)>2048; payload=gzip.compress(raw,6) if use else raw
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
   if path=='/api/health':return self.send_json({'status':'ok','engine':f"PyMuPDF {getattr(fitz,'__version__','')}",'mode':'poc01-normalized-vector-pdf-import','schema':4})
   if path=='/api/sample':return self.send_json(project_from_sample())
   m=re.fullmatch(r'/api/project/([A-Za-z0-9_-]+)/thumb/(\d+)',path)
   if m:
    pid,ps=m.groups(); pr=PROJECTS.get(pid)
    if not pr:return self.send_json({'detail':'Project not found'},404)
    out=CACHE_DIR/f'{pid}-thumb-{ps}.png';create_thumbnail(Path(pr['path']),int(ps),out);return self.send_bytes(out.read_bytes(),'image/png')
   m=re.fullmatch(r'/api/project/([A-Za-z0-9_-]+)/vectors/(\d+)',path)
   if m:
    pid,ps=m.groups();pr=PROJECTS.get(pid)
    if not pr:return self.send_json({'detail':'Project not found'},404)
    pi=int(ps);cache=CACHE_DIR/f'{pid}-vectors-v4-{pi}.json.gz'
    if cache.exists():
     payload=cache.read_bytes();self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(payload);return
    data=extract_editable_geometry(Path(pr['path']),pi);packed=gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),6);cache.write_bytes(packed);self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(packed)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(packed);return
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
    pid=uuid.uuid4().hex[:12];stored=UPLOAD_DIR/f'{pid}.pdf';stored.write_bytes(payload)
    try: result=analyze_pdf(stored,filename,pid)
    except Exception: stored.unlink(missing_ok=True);raise
    with PROJECT_LOCK:PROJECTS[pid]={'path':stored,'filename':filename}
    return self.send_json(result)
   if path=='/api/svg-to-pdf':
    data=json.loads(body.decode());svg=data.get('svg','')
    if not svg or len(svg)>30_000_000:return self.send_json({'detail':'Invalid SVG'},400)
    sd=fitz.open(stream=svg.encode(),filetype='svg');return self.send_bytes(sd.convert_to_pdf(),'application/pdf','A2Z-Lighting-Plan.pdf')
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
