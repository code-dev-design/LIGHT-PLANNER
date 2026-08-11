const assert=require('assert');
const C=require('../static/poc01_core.js');
const styles=[{stroke:'#000000',fill:null,width:0.5,strokeAlpha:.8},{stroke:'#000000',fill:'#000000',width:.12,strokeAlpha:1}];
const ents=[
 {id:'line',t:'line',p:[0,0,100,0],bbox:[0,0,100,0],s:0,seq:1},
 {id:'circle',t:'circle',cx:30,cy:30,r:10,bbox:[20,20,40,40],s:0,seq:2},
 {id:'ellipse',t:'ellipse',cx:70,cy:30,rx:15,ry:8,bbox:[55,22,85,38],s:0,seq:3},
 {id:'rect',t:'rect',x:10,y:50,w:20,h:10,bbox:[10,50,30,60],s:0,seq:4},
 {id:'text',t:'text',text:'12',bbox:[40,50,52,60],s:1,seq:5},
 {id:'poly',t:'polyline',p:[60,50,70,50,70,60],bbox:[60,50,70,60],s:0,seq:6},
 {id:'path',t:'path',subpaths:[{commands:[['l',[80,50],[90,50]],['l',[90,50],[90,60]]]}],bbox:[80,50,90,60],s:0,seq:7},
];
const idx=new C.SpatialIndex(12).build(ents),lookup=k=>ents.find(e=>e.id===k);
assert.equal(C.hitCandidates({x:30,y:20},1,idx,lookup,styles)[0].key,'circle');
assert.equal(C.hitCandidates({x:46,y:55},1,idx,lookup,styles)[0].key,'text');
assert(C.hitCandidates({x:70,y:22},.5,idx,lookup,styles).some(x=>x.key==='ellipse'));
let win=C.boxSelect([8,48,54,62],'window',idx,lookup,styles);assert(win.includes('rect')&&win.includes('text'));
let cross=C.boxSelect([25,25,35,55],'crossing',idx,lookup,styles);assert(cross.includes('circle')&&cross.includes('rect'));
let L=C.createJunction({t:'line',p:[0,0,10,0],bbox:[0,0,10,0]},{t:'line',p:[10.4,.3,10.4,10],bbox:[10.4,.3,10.4,10]},{tolerance:1});
assert(L&&L.junction.type==='L');assert.notStrictEqual(L.a,L.b);
assert.deepStrictEqual(L.a.p.slice(2),[10.4,0]);assert.deepStrictEqual(L.b.p.slice(0,2),[10.4,0]);
const lPatch=C.junctionPatch(L.a,L.b,4,8,L.junction.point);
assert(lPatch&&lPatch.length===4);
const lBox=[Math.min(...lPatch.map(p=>p.x)),Math.min(...lPatch.map(p=>p.y)),Math.max(...lPatch.map(p=>p.x)),Math.max(...lPatch.map(p=>p.y))];
assert.deepStrictEqual(lBox.map(n=>+n.toFixed(6)),[6.4,-2,14.4,2]);
assert(C.pointInPolygon({x:12,y:-1},lPatch),'L outside quadrant must be filled by the junction patch');
assert(!C.pointInPolygon({x:14.5,y:-1},lPatch),'junction patch must not protrude past the wider stroke face');
let T=C.createJunction({t:'line',p:[0,5,10,5],bbox:[0,5,10,5]},{t:'line',p:[5,0,5,5.3],bbox:[5,0,5,5.3]},{tolerance:1});assert(T&&T.junction.type==='T');
let X=C.createJunction({t:'line',p:[0,0,10,10],bbox:[0,0,10,10]},{t:'line',p:[0,10,10,0],bbox:[0,0,10,10]},{tolerance:.5});assert(X&&X.junction.type==='X');
for(const j of [T,X]){const patch=C.junctionPatch(j.a,j.b,3,7,j.junction.point);assert(patch&&patch.length===4);assert(C.pointInPolygon(j.junction.point,patch));}
assert.equal(C.junctionPatch({t:'line',p:[0,0,10,0]},{t:'line',p:[0,1,10,1]},4,4),null,'parallel lines cannot create a patch');
const detached=C.detachJunctions([{id:'j1',a:'a',b:'b',active:true},{id:'j2',a:'c',b:'a',active:true},{id:'j3',a:'c',b:'d',active:true}],['a']);
assert.equal(detached[0].active,false);assert.equal(detached[0].detachedReason,'member-deleted');assert.equal(detached[1].active,false);assert.equal(detached[2].active,true);
const upserted=C.upsertJunction([{id:'old',a:'a',b:'b'},{id:'other-end',a:'a',b:'c'}],{id:'new',a:'b',b:'a'});
assert.deepStrictEqual(upserted.map(j=>j.id),['other-end','new'],'rejoining one pair must preserve a junction at the other endpoint');
const autoL=C.buildWallJunctions([
 {key:'wall-a',entity:{t:'line',p:[0,0,10,0],bbox:[0,0,10,0],s:0,wall:true}},
 {key:'wall-b',entity:{t:'line',p:[10.6,.4,10.6,10],bbox:[10.6,.4,10.6,10],s:0,wall:true}},
 {key:'annotation',entity:{t:'line',p:[10.6,-5,10.6,5],bbox:[10.6,-5,10.6,5],s:0}}
],styles,{tolerance:1,maxCos:.1});
assert.equal(autoL.length,1);assert.equal(autoL[0].type,'L');assert(Math.abs(autoL[0].aLine.p[2]-10.6)<1e-9&&Math.abs(autoL[0].aLine.p[3])<1e-9);assert(Math.abs(autoL[0].bLine.p[0]-10.6)<1e-9&&Math.abs(autoL[0].bLine.p[1])<1e-9);
const autoT=C.buildWallJunctions([
 {key:'wall-a',entity:{t:'line',p:[0,5,10,5],bbox:[0,5,10,5],s:0,wall:true}},
 {key:'wall-b',entity:{t:'line',p:[5,0,5,5.5],bbox:[5,0,5,5.5],s:0,wall:true}}
],styles,{tolerance:1,maxCos:.1});assert.equal(autoT.length,1);assert.equal(autoT[0].type,'T');
const autoX=C.buildWallJunctions([
 {key:'wall-a',entity:{t:'line',p:[0,5,10,5],bbox:[0,5,10,5],s:0,wall:true}},
 {key:'wall-b',entity:{t:'line',p:[5,0,5,10],bbox:[5,0,5,10],s:0,wall:true}}
],styles,{tolerance:.5,maxCos:.1});assert.equal(autoX.length,1);assert.equal(autoX[0].type,'X');
const tooFar=C.buildWallJunctions([
 {key:'wall-a',entity:{t:'line',p:[0,0,10,0],bbox:[0,0,10,0],s:0,wall:true}},
 {key:'wall-b',entity:{t:'line',p:[13,1,13,10],bbox:[13,1,13,10],s:0,wall:true}}
],styles,{tolerance:1,maxCos:.1});assert.equal(tooFar.length,0,'automatic wall cleaning must not bridge a large drafting gap');
assert.equal(C.preblendColor('#000000',.5,'#ffffff'),'rgb(128,128,128)');
assert.deepStrictEqual(C.resizeBoxFromHandle([0,0,10,10],'se',{x:20,y:15}),[0,0,20,15]);
const resizedRect=C.resizeEntity({t:'rect',x:0,y:0,w:10,h:5,bbox:[0,0,10,5]},[0,0,10,5],[0,0,20,15]);
assert.deepStrictEqual([resizedRect.x,resizedRect.y,resizedRect.w,resizedRect.h,resizedRect.bbox],[0,0,20,15,[0,0,20,15]]);
const resizedLine=C.resizeEntity({t:'line',p:[0,0,10,5],bbox:[0,0,10,5]},[0,0,10,5],[5,7,25,22]);
assert.deepStrictEqual(resizedLine.p,[5,7,25,22]);
const resizedCircle=C.resizeEntity({t:'circle',cx:5,cy:5,r:5,bbox:[0,0,10,10]},[0,0,10,10],[0,0,20,10]);
assert.equal(resizedCircle.t,'ellipse');assert.equal(resizedCircle.rx,10);assert.equal(resizedCircle.ry,5);
const resizedText=C.resizeEntity({type:'text',t:'text',text:'A',x:0,y:10,size:10,bbox:[0,0,10,10]},[0,0,10,10],[0,0,20,15]);
assert.equal(resizedText.size,15);assert(Math.abs(resizedText.scaleX-4/3)<1e-9);assert.deepStrictEqual(resizedText.bbox,[0,0,20,15]);
assert.deepStrictEqual(C.distributionPoints({x:0,y:0},{x:10,y:0},3,4),[{x:0,y:0},{x:4,y:0},{x:8,y:0}]);
assert.deepStrictEqual(C.distributionPoints({x:0,y:0},{x:10,y:0},3),[{x:0,y:0},{x:5,y:0},{x:10,y:0}]);
assert.equal(C.convertLength(1,'m','cm'),100);assert.equal(C.convertLength(25,'cm','m'),.25);
const big=[];for(let i=0;i<120000;i++){const x=(i%600)*3,y=Math.floor(i/600)*3;big.push({id:'e'+i,t:'line',p:[x,y,x+1,y],bbox:[x,y,x+1,y],s:0,seq:i});}
const t0=performance.now(),bi=new C.SpatialIndex(12).build(big),build=performance.now()-t0,map=new Map(big.map(e=>[e.id,e]));let q0=performance.now(),hits=0;for(let i=0;i<1000;i++)hits+=C.hitCandidates({x:(i%600)*3+.5,y:Math.floor(i/600)*3},1,bi,k=>map.get(k),styles,{tolerancePx:3}).length;const query=performance.now()-q0;
console.log(JSON.stringify({ok:true,build_ms:+build.toFixed(2),query_1000_ms:+query.toFixed(2),hits,index_cells:bi.cells.size,overflow:bi.overflow.size}));
