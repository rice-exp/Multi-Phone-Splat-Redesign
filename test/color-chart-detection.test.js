import test from 'node:test';
import assert from 'node:assert/strict';
import {detectColorChart} from '../public/js/color-chart-detection.js';
import {CLASSIC24,SPYDER24,chartProjection,decodeSRGB,encodeSRGB,sampleChart,fitColor,validateReference} from '../public/js/color-calibration.js';

const baseline=[[.18,.12],[.54,.12],[.54,.72],[.18,.72]];
function fixture(corners=baseline,{noise=0,shuffle=false,extra=null,chart=SPYDER24}={}) {
  const width=420,height=420,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set([23,28,24,255],i);
  const draw=points=>{
    const project=chartProjection(points);
    chart.patches.forEach((_,index)=>{
      const rgb=chart.patches[shuffle?(index*7+5)%24:index].map(n=>decodeSRGB(n/255));
      const cast=[.79*rgb[0]+.045*rgb[1]+.01*rgb[2],.01*rgb[0]+.68*rgb[1]+.01*rgb[2],.015*rgb[0]+.02*rgb[1]+.55*rgb[2]].map(n=>255*encodeSRGB(n));
      const u=(index%chart.columns)/(chart.columns-1),v=Math.floor(index/chart.columns)/(chart.rows-1),du=.38/(chart.columns-1),dv=.38/(chart.rows-1);
      const quad=[[-du,-dv],[du,-dv],[du,dv],[-du,dv]].map(([dx,dy])=>project(u+dx,v+dy).map(n=>n*420));
      const minX=Math.max(0,Math.floor(Math.min(...quad.map(p=>p[0])))),maxX=Math.min(width-1,Math.ceil(Math.max(...quad.map(p=>p[0]))));
      const minY=Math.max(0,Math.floor(Math.min(...quad.map(p=>p[1])))),maxY=Math.min(height-1,Math.ceil(Math.max(...quad.map(p=>p[1]))));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
        if(!quad.every((p,i)=>{const q=quad[(i+1)%4];return (q[0]-p[0])*(y+.5-p[1])-(q[1]-p[1])*(x+.5-p[0])>=0;}))continue;
        const jitter=noise*(Math.sin(x*37+y*13)+.4*(y/height-.5));
        data.set([...cast.map(n=>n+jitter),255],(y*width+x)*4);
      }
    });
  };
  if(corners)draw(corners);if(extra)draw(extra);
  return {width,height,data};
}

test('finds patch centers without supplied coordinates, under a cast and noise',()=>{
  const result=detectColorChart(fixture(baseline,{noise:2}),SPYDER24);
  assert.ok(result.matched>=20);
  result.corners.forEach((p,i)=>p.forEach((n,k)=>assert.ok(Math.abs(n-baseline[i][k])<.015)));
});

test('Classic 6 by 4 chart detects, orients and calibrates with the standard CCM',()=>{
  const normal=[[.15,.2],[.75,.2],[.75,.56],[.15,.56]],perspective=[[.16,.18],[.78,.21],[.73,.59],[.14,.54]];
  for(const corners of [normal,normal.map(([x,y])=>[1-y,x]),perspective]) {
    const image=fixture(corners,{chart:CLASSIC24,noise:1}),result=detectColorChart(image,CLASSIC24);
    result.corners.forEach((p,i)=>p.forEach((n,k)=>assert.ok(Math.abs(n-corners[i][k])<.02)));
    const fit=fitColor(sampleChart(image,CLASSIC24,result.corners));
    assert.equal(fit.accepted,24);assert.equal(fit.model,'linear');
    assert.ok(fit.after<1);assert.ok(fit.validation.after<1);
  }
  assert.throws(()=>detectColorChart(fixture(normal,{chart:CLASSIC24,shuffle:true}),CLASSIC24),/not confidently found/);
  assert.throws(()=>detectColorChart(fixture(normal,{chart:CLASSIC24}),SPYDER24),/not confidently found/);
});

test('an uploaded custom reference retains its layout and supports detection and fitting',()=>{
  const chart=validateReference({...CLASSIC24,name:'Measured custom chart',colorSpace:'sRGB'});
  const corners=[[.15,.2],[.75,.2],[.75,.56],[.15,.56]],image=fixture(corners,{chart,noise:1});
  const result=detectColorChart(image,chart),fit=fitColor(sampleChart(image,chart,result.corners));
  assert.equal(chart.id,'custom');assert.equal(fit.accepted,24);assert.ok(fit.after<1);
});

test('recognizes the reference orientation under rotation and moderate perspective',()=>{
  for(const corners of [baseline.map(([x,y])=>[1-y,x]),baseline.map(([x,y])=>[1-x,1-y]),[[.2,.15],[.59,.2],[.54,.8],[.17,.7]]]) {
    const result=detectColorChart(fixture(corners,{noise:1}),SPYDER24);
    result.corners.forEach((p,i)=>p.forEach((n,k)=>assert.ok(Math.abs(n-corners[i][k])<.02,JSON.stringify(result.corners))));
  }
});

test('rejects absent, unrelated and ambiguous charts instead of inventing corners',()=>{
  assert.throws(()=>detectColorChart(fixture(null),SPYDER24),/not confidently found/);
  assert.throws(()=>detectColorChart(fixture(baseline,{shuffle:true}),SPYDER24),/not confidently found/);
  const first=[[.12,.2],[.34,.2],[.34,.8],[.12,.8]],second=first.map(([x,y])=>[x+.5,y]);
  assert.throws(()=>detectColorChart(fixture(first,{extra:second}),SPYDER24),/More than one/);
});
