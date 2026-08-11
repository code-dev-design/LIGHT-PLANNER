(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POC01Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const expand=(b,m)=>[b[0]-m,b[1]-m,b[2]+m,b[3]+m];
  const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  const contains=(outer,inner)=>inner[0]>=outer[0]&&inner[1]>=outer[1]&&inner[2]<=outer[2]&&inner[3]<=outer[3];
  const pointIn=(p,b,m=0)=>p.x>=b[0]-m&&p.x<=b[2]+m&&p.y>=b[1]-m&&p.y<=b[3]+m;
  const distSeg=(p,a,b)=>{const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,c1=vx*wx+vy*wy;if(c1<=0)return Math.hypot(p.x-a.x,p.y-a.y);const c2=vx*vx+vy*vy;if(c2<=c1)return Math.hypot(p.x-b.x,p.y-b.y);const t=c1/c2;return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy));};
  const cubicPoint=(c,t)=>{const q=1-t,p0=c[1],p1=c[2],p2=c[3],p3=c[4];return{x:q*q*q*p0[0]+3*q*q*t*p1[0]+3*q*t*t*p2[0]+t*t*t*p3[0],y:q*q*q*p0[1]+3*q*q*t*p1[1]+3*q*t*t*p2[1]+t*t*t*p3[1]};};
  const pairs=p=>{const out=[];for(let i=0;i<p.length;i+=2)out.push({x:p[i],y:p[i+1]});return out;};
  function subpathSegments(sp, curveSteps=18){const out=[];for(const c of sp.commands||[]){if(c[0]==='l')out.push([{x:c[1][0],y:c[1][1]},{x:c[2][0],y:c[2][1]}]);else if(c[0]==='c'){let a={x:c[1][0],y:c[1][1]};for(let i=1;i<=curveSteps;i++){const b=cubicPoint(c,i/curveSteps);out.push([a,b]);a=b;}}}return out;}
  function entitySegments(e){
    if(e.t==='line') return [[{x:e.p[0],y:e.p[1]},{x:e.p[2],y:e.p[3]}]];
    if(e.t==='polyline'){const ps=pairs(e.p),out=[];for(let i=0;i<ps.length-1;i++)out.push([ps[i],ps[i+1]]);if(e.closed&&ps.length>2)out.push([ps[ps.length-1],ps[0]]);return out;}
    if(e.t==='rect'){const ps=[{x:e.x,y:e.y},{x:e.x+e.w,y:e.y},{x:e.x+e.w,y:e.y+e.h},{x:e.x,y:e.y+e.h}];return ps.map((p,i)=>[p,ps[(i+1)%4]]);}
    if(e.t==='path'){const out=[];for(const sp of e.subpaths||[])out.push(...subpathSegments(sp));return out;}
    if(e.t==='circle'||e.t==='ellipse'){const rx=e.t==='circle'?e.r:e.rx,ry=e.t==='circle'?e.r:e.ry,n=48,out=[];let a={x:e.cx+rx,y:e.cy};for(let i=1;i<=n;i++){const q=i/n*Math.PI*2,b={x:e.cx+Math.cos(q)*rx,y:e.cy+Math.sin(q)*ry};out.push([a,b]);a=b;}return out;}
    return [];
  }
  function styleOf(e,styles){return styles?.[e.s]||{};}
  function strokeHalf(e,styles){return Math.max(0,Number(styleOf(e,styles).width)||0)/2;}
  function distanceToEntity(p,e,styles){
    if(e.t==='text') return pointIn(p,e.bbox)?0:Math.hypot(Math.max(e.bbox[0]-p.x,0,p.x-e.bbox[2]),Math.max(e.bbox[1]-p.y,0,p.y-e.bbox[3]));
    const s=styleOf(e,styles); if(s.fill&&pointIn(p,e.bbox)) {
      if(e.role==='outlined_text'||e.t==='rect'||e.t==='circle'||e.t==='ellipse') return 0;
    }
    let d=Infinity;for(const [a,b] of entitySegments(e))d=Math.min(d,distSeg(p,a,b));return Math.max(0,d-strokeHalf(e,styles));
  }
  function segmentIntersects(a,b,c,d){
    const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    const on=(p,q,r)=>Math.min(p.x,q.x)-1e-9<=r.x&&r.x<=Math.max(p.x,q.x)+1e-9&&Math.min(p.y,q.y)-1e-9<=r.y&&r.y<=Math.max(p.y,q.y)+1e-9;
    const o1=cross(a,b,c),o2=cross(a,b,d),o3=cross(c,d,a),o4=cross(c,d,b);
    if(((o1>0&&o2<0)||(o1<0&&o2>0))&&((o3>0&&o4<0)||(o3<0&&o4>0)))return true;
    return (Math.abs(o1)<1e-9&&on(a,b,c))||(Math.abs(o2)<1e-9&&on(a,b,d))||(Math.abs(o3)<1e-9&&on(c,d,a))||(Math.abs(o4)<1e-9&&on(c,d,b));
  }
  function entityIntersectsBox(e,b,styles){
    const m=strokeHalf(e,styles); if(!intersects(expand(e.bbox||[0,0,0,0],m),b))return false;
    if(e.t==='text'||styleOf(e,styles).fill&&e.role==='outlined_text')return true;
    const edges=[[{x:b[0],y:b[1]},{x:b[2],y:b[1]}],[{x:b[2],y:b[1]},{x:b[2],y:b[3]}],[{x:b[2],y:b[3]},{x:b[0],y:b[3]}],[{x:b[0],y:b[3]},{x:b[0],y:b[1]}]];
    for(const [a,z] of entitySegments(e)){if(pointIn(a,b,m)||pointIn(z,b,m))return true;for(const [c,d] of edges)if(segmentIntersects(a,z,c,d))return true;}
    return false;
  }

  class SpatialIndex {
    constructor(cellSize=18,maxCellsPerItem=64){this.cellSize=Math.max(2,cellSize);this.maxCellsPerItem=maxCellsPerItem;this.cells=new Map();this.boxes=new Map();this.overflow=new Set();}
    _key(x,y){return `${x},${y}`;}
    insert(key,b){this.boxes.set(key,b);const s=this.cellSize,x0=Math.floor(b[0]/s),y0=Math.floor(b[1]/s),x1=Math.floor(b[2]/s),y1=Math.floor(b[3]/s),count=(x1-x0+1)*(y1-y0+1);if(count>this.maxCellsPerItem){this.overflow.add(key);return;}for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=this._key(x,y);let a=this.cells.get(k);if(!a)this.cells.set(k,a=[]);a.push(key);}}
    build(items,getKey=x=>x.id,getBox=x=>x.bbox){this.cells.clear();this.boxes.clear();this.overflow.clear();for(const item of items)this.insert(getKey(item),getBox(item));return this;}
    queryBox(b){const out=new Set(this.overflow),s=this.cellSize,x0=Math.floor(b[0]/s),y0=Math.floor(b[1]/s),x1=Math.floor(b[2]/s),y1=Math.floor(b[3]/s);for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const k of this.cells.get(this._key(x,y))||[])out.add(k);return [...out].filter(k=>intersects(this.boxes.get(k),b));}
    queryPoint(p,r=0){return this.queryBox([p.x-r,p.y-r,p.x+r,p.y+r]);}
  }

  function hitCandidates(p,zoom,index,lookup,styles,opts={}){
    const px=opts.tolerancePx??8,tol=px/Math.max(.0001,zoom),keys=index.queryPoint(p,tol),out=[];
    for(const key of keys){const e=lookup(key);if(!e)continue;const d=distanceToEntity(p,e,styles);if(d<=tol)out.push({key,d,seq:Number(e.seq)||0,locked:!!opts.isLocked?.(e)});}
    out.sort((a,b)=>b.seq-a.seq||a.d-b.d||String(a.key).localeCompare(String(b.key)));return out;
  }
  function boxSelect(box,mode,index,lookup,styles,isLocked){const keys=index.queryBox(box),out=[];for(const k of keys){const e=lookup(k);if(!e||isLocked?.(e))continue;const ok=mode==='window'?contains(box,expand(e.bbox,strokeHalf(e,styles))):entityIntersectsBox(e,box,styles);if(ok)out.push(k);}return out;}

  function lineGeom(e){if(e?.t==='line')return{a:{x:e.p[0],y:e.p[1]},b:{x:e.p[2],y:e.p[3]}};return null;}
  function lineIntersection(a,b){const A=lineGeom(a),B=lineGeom(b);if(!A||!B)return null;const r={x:A.b.x-A.a.x,y:A.b.y-A.a.y},s={x:B.b.x-B.a.x,y:B.b.y-B.a.y},den=r.x*s.y-r.y*s.x;if(Math.abs(den)<1e-10)return null;const qp={x:B.a.x-A.a.x,y:B.a.y-A.a.y},t=(qp.x*s.y-qp.y*s.x)/den,u=(qp.x*r.y-qp.y*r.x)/den;return{x:A.a.x+t*r.x,y:A.a.y+t*r.y,t,u};}
  function endpointState(t,len,tol){const ep=Math.max(.018,tol/Math.max(len,1));if(Math.abs(t)<=ep)return 0;if(Math.abs(t-1)<=ep)return 1;return null;}
  function setEndpoint(e,idx,p){const o=JSON.parse(JSON.stringify(e));o.p[idx*2]=p.x;o.p[idx*2+1]=p.y;o.bbox=[Math.min(o.p[0],o.p[2]),Math.min(o.p[1],o.p[3]),Math.max(o.p[0],o.p[2]),Math.max(o.p[1],o.p[3])];o.len=Math.hypot(o.p[2]-o.p[0],o.p[3]-o.p[1]);return o;}
  function createJunction(a,b,opts={}){const tol=opts.tolerance??4,ix=lineIntersection(a,b);if(!ix)return null;const A=lineGeom(a),B=lineGeom(b),la=Math.hypot(A.b.x-A.a.x,A.b.y-A.a.y),lb=Math.hypot(B.b.x-B.a.x,B.b.y-B.a.y),ea=endpointState(ix.t,la,tol),eb=endpointState(ix.u,lb,tol),relative=opts.relativeExtension??.025,ext=Math.max(tol/Math.max(la,1),tol/Math.max(lb,1),relative);if(ix.t<-ext||ix.t>1+ext||ix.u<-ext||ix.u>1+ext)return null;let type='X';if(ea!==null&&eb!==null)type='L';else if(ea!==null||eb!==null)type='T';let aa=JSON.parse(JSON.stringify(a)),bb=JSON.parse(JSON.stringify(b));if(type==='L'){aa=setEndpoint(aa,ea,ix);bb=setEndpoint(bb,eb,ix);}else if(type==='T'){if(ea!==null)aa=setEndpoint(aa,ea,ix);if(eb!==null)bb=setEndpoint(bb,eb,ix);}return{a:aa,b:bb,junction:{type,point:{x:ix.x,y:ix.y},aEndpoint:ea,bEndpoint:eb}};}
  function refreshJunction(a,b,j,opts={}){const next=createJunction(a,b,opts);if(!next)return{detached:true,a,b,junction:null};const maxMove=opts.maxMove??20;if(Math.hypot(next.junction.point.x-j.point.x,next.junction.point.y-j.point.y)>maxMove)return{detached:true,a,b,junction:null};return{detached:false,...next};}

  // Returns the exact intersection of the two infinite stroke strips. Drawing this
  // polygon over butt-capped members fills the missing L quadrant without the
  // protrusions that square caps create, and also normalizes T/X alpha overlap.
  function junctionPatch(a,b,widthA,widthB,point=null,opts={}){
    const A=lineGeom(a),B=lineGeom(b),ix=point||lineIntersection(a,b);if(!A||!B||!ix)return null;
    const adx=A.b.x-A.a.x,ady=A.b.y-A.a.y,bdx=B.b.x-B.a.x,bdy=B.b.y-B.a.y,al=Math.hypot(adx,ady),bl=Math.hypot(bdx,bdy);if(al<1e-9||bl<1e-9)return null;
    const na={x:-ady/al,y:adx/al},nb={x:-bdy/bl,y:bdx/bl},det=na.x*nb.y-na.y*nb.x,minSin=opts.minSin??.08;if(Math.abs(det)<minSin)return null;
    const ha=Math.max(0,Number(widthA)||0)/2,hb=Math.max(0,Number(widthB)||0)/2;if(ha<=0||hb<=0)return null;
    const solve=(da,db)=>({x:ix.x+(da*nb.y-na.y*db)/det,y:ix.y+(na.x*db-da*nb.x)/det});
    const polygon=[solve(-ha,-hb),solve(ha,-hb),solve(ha,hb),solve(-ha,hb)],limit=(opts.miterLimit??8)*Math.max(ha,hb);
    if(polygon.some(p=>Math.hypot(p.x-ix.x,p.y-ix.y)>limit))return null;
    return polygon;
  }
  function buildWallJunctions(items,styles,opts={}){
    const tolerance=opts.tolerance??1.25,maxCos=opts.maxCos??.18,minLength=opts.minLength??.35,segs=[];
    for(const item of items||[]){const e=item.entity||item.e||item;if(!e?.wall)continue;const key=item.key||e.id;
      entitySegments(e).forEach((pair,i)=>{const [a,b]=pair,len=Math.hypot(b.x-a.x,b.y-a.y);if(len<minLength)return;segs.push({id:`${key}#${i}`,key,index:i,line:{t:'line',p:[a.x,a.y,b.x,b.y],bbox:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)]},bbox:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)],length:len,width:Number(styleOf(e,styles).width)||.3});});
    }
    const index=new SpatialIndex(Math.max(3,tolerance*4),128).build(segs,s=>s.id,s=>expand(s.bbox,tolerance)),byId=new Map(segs.map(s=>[s.id,s])),seen=new Set(),out=[];
    for(const a of segs)for(const id of index.queryBox(expand(a.bbox,tolerance))){const b=byId.get(id);if(!b||a.id===b.id||a.key===b.key)continue;const pair=a.id<b.id?`${a.id}|${b.id}`:`${b.id}|${a.id}`;if(seen.has(pair))continue;seen.add(pair);
      const ax=a.line.p[2]-a.line.p[0],ay=a.line.p[3]-a.line.p[1],bx=b.line.p[2]-b.line.p[0],by=b.line.p[3]-b.line.p[1],cos=Math.abs((ax*bx+ay*by)/(a.length*b.length));if(cos>maxCos)continue;
      const joined=createJunction(a.line,b.line,{tolerance,relativeExtension:0});if(!joined)continue;
      out.push({id:`wall:${out.length}`,a:a.key,b:b.key,aSegment:a.index,bSegment:b.index,originalA:a.line,originalB:b.line,aLine:joined.a,bLine:joined.b,widthA:a.width,widthB:b.width,...joined.junction,automatic:true});
    }
    return out;
  }
  function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j],hit=(a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x;if(hit)inside=!inside;}return inside;}
  function detachJunctions(junctions,removedKeys){const removed=removedKeys instanceof Set?removedKeys:new Set(removedKeys||[]);return(junctions||[]).map(j=>removed.has(j.a)||removed.has(j.b)?{...j,active:false,detachedReason:'member-deleted'}:j);}
  function upsertJunction(junctions,next){const samePair=j=>(j.a===next.a&&j.b===next.b)||(j.a===next.b&&j.b===next.a);return[...(junctions||[]).filter(j=>!samePair(j)),next];}

  function parseHex(c){if(!c)return null;const m=String(c).match(/^#([0-9a-f]{6})$/i);if(!m)return null;const n=parseInt(m[1],16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
  function preblendColor(color,alpha,bg){const c=parseHex(color)||{r:0,g:0,b:0},b=parseHex(bg)||{r:255,g:255,b:255},a=clamp(alpha,0,1),v=x=>Math.round(x);return `rgb(${v(c.r*a+b.r*(1-a))},${v(c.g*a+b.g*(1-a))},${v(c.b*a+b.b*(1-a))})`;}
  function resizeBoxFromHandle(box,handle,p,minSize=.01){let [x0,y0,x1,y1]=box;const min=Math.max(1e-6,minSize);if(handle.includes('w'))x0=Math.min(p.x,x1-min);if(handle.includes('e'))x1=Math.max(p.x,x0+min);if(handle.includes('n'))y0=Math.min(p.y,y1-min);if(handle.includes('s'))y1=Math.max(p.y,y0+min);return[x0,y0,x1,y1];}
  function resizeEntity(entity,from,to){const o=JSON.parse(JSON.stringify(entity)),fw=Math.max(1e-9,from[2]-from[0]),fh=Math.max(1e-9,from[3]-from[1]),tw=to[2]-to[0],th=to[3]-to[1],sx=tw/fw,sy=th/fh,map=(x,y)=>[to[0]+(x-from[0])*sx,to[1]+(y-from[1])*sy];
    if(o.p)for(let i=0;i<o.p.length;i+=2)[o.p[i],o.p[i+1]]=map(o.p[i],o.p[i+1]);
    if(o.t==='path')for(const sp of o.subpaths||[])for(const cmd of sp.commands||[])for(let i=1;i<cmd.length;i++)cmd[i]=map(cmd[i][0],cmd[i][1]);
    if(o.cx!=null)[o.cx,o.cy]=map(o.cx,o.cy);
    if(o.t==='rect'){o.x=to[0];o.y=to[1];o.w=tw;o.h=th;}
    if(o.t==='circle'){const rx=Math.abs((o.r||0)*sx),ry=Math.abs((o.r||0)*sy);if(Math.abs(rx-ry)<=Math.max(rx,ry)*1e-6)o.r=(rx+ry)/2;else{o.t='ellipse';o.rx=rx;o.ry=ry;delete o.r;}}
    else if(o.t==='ellipse'){o.rx=Math.abs((o.rx||0)*sx);o.ry=Math.abs((o.ry||0)*sy);}
    if(o.t==='text'||o.type==='text'){[o.x,o.y]=map(o.x,o.y);o.size=Math.max(.5,(o.size||10)*Math.abs(sy));if(o.chars)for(const ch of o.chars){ch.dx=(ch.dx||0)*sx;ch.dy=(ch.dy||0)*sy;ch.width=(ch.width||0)*Math.abs(sx);}else o.scaleX=Math.max(.05,(o.scaleX||1)*Math.abs(sx)/Math.max(1e-9,Math.abs(sy)));}
    if(o.type==='light'){[o.x,o.y]=map(o.x,o.y);o.scale=Math.max(.1,(o.scale||1)*Math.max(Math.abs(sx),Math.abs(sy)));}
    o.bbox=[...to];if(o.p?.length===4)o.len=Math.hypot(o.p[2]-o.p[0],o.p[3]-o.p[1]);return o;
  }
  function distributionPoints(start,end,count,spacing=null){const n=Math.max(2,Math.floor(Number(count)||2)),dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy);if(len<1e-9)return[];const out=[];if(Number.isFinite(spacing)&&spacing>0){const ux=dx/len,uy=dy/len;for(let i=0;i<n;i++)out.push({x:start.x+ux*spacing*i,y:start.y+uy*spacing*i});}else for(let i=0;i<n;i++){const t=i/(n-1);out.push({x:start.x+dx*t,y:start.y+dy*t});}return out;}
  function convertLength(value,fromUnit,toUnit){const factors={m:1,cm:.01,mm:.001};if(!factors[fromUnit]||!factors[toUnit])return NaN;return Number(value)*factors[fromUnit]/factors[toUnit];}
  return {clamp,expand,intersects,contains,pointIn,distSeg,entitySegments,distanceToEntity,entityIntersectsBox,SpatialIndex,hitCandidates,boxSelect,lineIntersection,createJunction,refreshJunction,junctionPatch,buildWallJunctions,pointInPolygon,detachJunctions,upsertJunction,setEndpoint,preblendColor,resizeBoxFromHandle,resizeEntity,distributionPoints,convertLength};
});
