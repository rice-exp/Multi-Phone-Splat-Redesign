import test from 'node:test';
import assert from 'node:assert/strict';
import {CLASSIC24,SPYDER24,IDENTITY,decodeSRGB,encodeSRGB,chartProjection,sampleChart,patchQualitySummary,fitColor,correctLinear,correctedPixels,defaultAdjustments,validateReference} from '../public/js/color-calibration.js';

const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const cast=v=>[0.79*v[0]+0.045*v[1]+0.01*v[2],0.01*v[0]+0.68*v[1]+0.01*v[2],0.015*v[0]+0.02*v[1]+0.55*v[2]];
const samples=(chart=CLASSIC24)=>chart.patches.map((rgb,index)=>{const target=rgb.map(n=>decodeSRGB(n/255));return {index,target,measured:cast(target),usable:true};});

test('linear sRGB fit recovers a known color cast, including independent colors',()=>{
  const fit=fitColor(samples());
  assert.equal(fit.accepted,24);assert.ok(fit.before>10);assert.ok(fit.after<0.00001);
  assert.equal(fit.model,'linear');assert.ok(fit.validation.after<0.00001);
  for(const target of [[0.13,0.36,0.6],[0.2,0.2,0.2],[0.8,0.6,0.3]]) {
    correctLinear(cast(target),fit.matrix).forEach((v,i)=>close(v,target[i]));
  }
});

test('new calibrations use only the standard CCM, even when shadows have an additive cast',()=>{
  const lift=[0.045,0.02,0.065],filtered=samples().map(s=>({...s,measured:s.measured.map((v,k)=>v+lift[k])}));
  const fit=fitColor(filtered);
  assert.equal(fit.model,'linear');assert.equal(fit.offset,undefined);
  assert.ok(fit.validation.after>5);
  assert.deepEqual(correctLinear([0,0,0],fit.matrix),[0,0,0]);
});

test('standard CCM handles quantized color casts and rejects invalid measurements',()=>{
  const quantized=samples().map(s=>({...s,measured:s.measured.map(v=>decodeSRGB(Math.round(255*encodeSRGB(v))/255))}));
  const fit=fitColor(quantized);
  assert.equal(fit.model,'linear');assert.ok(fit.validation.after<1);
  const invalid=samples();invalid[0].measured[0]=NaN;
  assert.throws(()=>fitColor(invalid),/finite linear RGB/);
});

test('withheld-patch validation exposes a misleading fit dominated by an influential patch',()=>{
  const weak=samples().map((s,i)=>({...s,measured:[s.measured[0],s.measured[1],s.measured[0]*.4+s.measured[1]*.6+(i===0?.3:0)],target:[s.measured[0],s.measured[1],s.measured[0]*.4+s.measured[1]*.6]}));
  const fit=fitColor(weak);
  assert.ok(fit.after<1e-6);
  assert.equal(fit.validation.after,null); // Removing the influential patch reveals lost rank.
});

test('unusable patches are excluded and poorly constrained fits fail',()=>{
  const s=samples();s[0].measured=[1,1,1];s[0].usable=false;
  assert.ok(fitColor(s).after<0.00001);assert.equal(fitColor(s).accepted,23);
  assert.throws(()=>fitColor(s.slice(0,12)),/at least 12/);
  assert.throws(()=>fitColor(Array.from({length:24},()=>({measured:[0.2,0.2,0.2],target:[0.2,0.3,0.4],usable:true}))),/independent color/);
});

test('projective alignment maps all four corners and rejects crossed, mirrored and tiny charts',()=>{
  const corners=[[0.1,0.2],[0.9,0.1],[0.8,0.9],[0.2,0.8]],project=chartProjection(corners);
  [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>project(u,v).forEach((n,k)=>close(n,corners[i][k])));
  assert.throws(()=>chartProjection([corners[0],corners[2],corners[1],corners[3]]),/clockwise/);
  assert.throws(()=>chartProjection(corners.slice().reverse()),/unmirrored/);
  assert.throws(()=>chartProjection([[0.1,0.1],[0.11,0.1],[0.11,0.11],[0.1,0.11]]),/larger/);
  assert.throws(()=>chartProjection([[NaN,0],...corners.slice(1)]),/four corner/);
});

function chartImage() {
  const width=300,height=420,data=new Uint8ClampedArray(width*height*4),cell=60,margin=30;
  data.fill(255);
  samples(SPYDER24).forEach((s,i)=>{
    const x0=margin+i%4*cell,y0=margin+Math.floor(i/4)*cell,rgb=s.measured.map(v=>Math.round(255*encodeSRGB(v)));
    for(let y=y0;y<y0+cell;y++)for(let x=x0;x<x0+cell;x++)data.set([...rgb,255],(y*width+x)*4);
  });
  return {width,height,data};
}
const corners=[[60/300,60/420],[240/300,60/420],[240/300,360/420],[60/300,360/420]];

test('pixel sampling and fitting work end to end and flag clipping/uneven samples',()=>{
  const image=chartImage(),sampled=sampleChart(image,SPYDER24,corners),fit=fitColor(sampled);
  assert.equal(fit.accepted,24);assert.ok(fit.after<1);
  // Damage two corner patches: one saturated, one alternating nonclipped colors.
  for(let y=30;y<90;y++)for(let x=30;x<90;x++)image.data.set([255,255,255,255],(y*300+x)*4);
  for(let y=30;y<90;y++)for(let x=210;x<270;x++)image.data.set(x<240?[20,40,60,255]:[220,210,200,255],(y*300+x)*4);
  const damaged=sampleChart(image,SPYDER24,corners);
  assert.equal(damaged[0].reason,'Clipped');assert.equal(damaged[3].reason,'Uneven patch');
  assert.equal(fitColor(damaged).accepted,22);
  assert.deepEqual(patchQualitySummary(damaged),{usable:22,total:24,rejected:[{reason:'Clipped',count:1},{reason:'Uneven patch',count:1}]});
  assert.equal(damaged[0].quality.clippedFraction,1);
  assert.ok(damaged[3].quality.spread>0.06);
});

test('correct alignment can still leave only ten usable patches, with reasons preserved on failure',()=>{
  const image=chartImage();
  // Channel clipping can destroy a measurement even when the box is well inside its patch.
  for(let i=0;i<14;i++) {
    const x0=30+i%4*60,y0=30+Math.floor(i/4)*60;
    for(let y=y0;y<y0+60;y++)for(let x=x0;x<x0+60;x++)image.data.set([255,160,100,255],(y*300+x)*4);
  }
  const original=image.data.slice(),sampled=sampleChart(image,SPYDER24,corners);
  assert.deepEqual(patchQualitySummary(sampled),{usable:10,total:24,rejected:[{reason:'Clipped',count:14}]});
  assert.throws(()=>fitColor(sampled),/Only 10 usable patches\. Need at least 12\. Rejected: 14 clipped\./);
  assert.equal(sampled[0].quality.pixelCount,49);
  assert.equal(sampled[0].quality.clippedFraction,1);
  assert.equal(sampled[14].usable,true);
  assert.deepEqual(image.data,original);
});

test('preview preserves the original buffer; reset and zero strength recover the right pixels',()=>{
  const image=chartImage(),snapshot=image.data.slice(),fit=fitColor(samples());
  const zero=correctedPixels(image,fit.matrix,{...defaultAdjustments(),amount:0});
  assert.deepEqual(zero,image.data);
  assert.deepEqual(correctedPixels(image,IDENTITY,defaultAdjustments()),image.data);
  const changed=correctedPixels(image,fit.matrix,{...defaultAdjustments(),exposure:0.5,warmth:10,tint:-4,saturation:90});
  assert.notDeepEqual(changed,image.data);assert.deepEqual(image.data,snapshot);
  correctLinear([0.1,0.2,0.3],IDENTITY,{...defaultAdjustments(),exposure:1}).forEach((v,i)=>close(v,[0.2,0.4,0.6][i]));
});

test('legacy saved offsets still render correctly with strength and manual adjustments',()=>{
  const image={width:4,height:1,data:new Uint8ClampedArray([0,0,0,255,50,90,140,127,180,100,60,255,255,255,255,255])};
  const matrix=[[1.2,.02,0],[0,.9,.03],[.01,0,1.1]],offset=[.04,-.01,.02];
  const adjust={...defaultAdjustments(),amount:65,exposure:.25,warmth:12,tint:-8,saturation:85};
  const output=correctedPixels(image,matrix,adjust,offset),expected=new Uint8ClampedArray(image.data.length);
  for(let i=0;i<image.data.length;i+=4) {
    const rgb=Array.from(image.data.slice(i,i+3),v=>decodeSRGB(v/255));
    correctLinear(rgb,matrix,adjust,offset).forEach((v,k)=>expected[i+k]=255*encodeSRGB(Math.max(0,Math.min(1,v))));expected[i+3]=image.data[i+3];
  }
  assert.deepEqual(output,expected);
  assert.deepEqual(correctedPixels(image,matrix,{...defaultAdjustments(),amount:0},offset),image.data);
  assert.deepEqual(Array.from(correctedPixels({width:1,height:1,data:new Uint8ClampedArray([0,0,0,255])},IDENTITY,defaultAdjustments(),[.1,.2,.3])),[89,124,149,255]);
});

test('reference import rejects incompatible color spaces and malformed or oversized grids',()=>{
  const value={...CLASSIC24,colorSpace:'sRGB'};
  const imported=validateReference(value);
  assert.equal(imported.patches.length,24);assert.equal(imported.columns,6);assert.equal(imported.rows,4);
  assert.equal(imported.id,'custom');assert.deepEqual(imported.patches,CLASSIC24.patches);
  assert.throws(()=>validateReference({...value,colorSpace:'Lab'}),/sRGB/);
  assert.throws(()=>validateReference({...value,columns:2.5}),/rows and columns/);
  assert.throws(()=>validateReference({...value,patches:[[256,0,0]]}),/RGB triplet/);
  assert.throws(()=>validateReference({...value,rows:100}),/rows and columns/);
  for(const x of [0,0.001,0.04,0.5,1])close(encodeSRGB(decodeSRGB(x)),x);
});
