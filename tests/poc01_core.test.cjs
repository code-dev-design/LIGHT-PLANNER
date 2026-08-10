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
let T=C.createJunction({t:'line',p:[0,5,10,5],bbox:[0,5,10,5]},{t:'line',p:[5,0,5,5.3],bbox:[5,0,5,5.3]},{tolerance:1});assert(T&&T.junction.type==='T');
let X=C.createJunction({t:'line',p:[0,0,10,10],bbox:[0,0,10,10]},{t:'line',p:[0,10,10,0],bbox:[0,0,10,10]},{tolerance:.5});assert(X&&X.junction.type==='X');
assert.equal(C.preblendColor('#000000',.5,'#ffffff'),'rgb(128,128,128)');
const big=[];for(let i=0;i<120000;i++){const x=(i%600)*3,y=Math.floor(i/600)*3;big.push({id:'e'+i,t:'line',p:[x,y,x+1,y],bbox:[x,y,x+1,y],s:0,seq:i});}
const t0=performance.now(),bi=new C.SpatialIndex(12).build(big),build=performance.now()-t0,map=new Map(big.map(e=>[e.id,e]));let q0=performance.now(),hits=0;for(let i=0;i<1000;i++)hits+=C.hitCandidates({x:(i%600)*3+.5,y:Math.floor(i/600)*3},1,bi,k=>map.get(k),styles,{tolerancePx:3}).length;const query=performance.now()-q0;
console.log(JSON.stringify({ok:true,build_ms:+build.toFixed(2),query_1000_ms:+query.toFixed(2),hits,index_cells:bi.cells.size,overflow:bi.overflow.size}));
