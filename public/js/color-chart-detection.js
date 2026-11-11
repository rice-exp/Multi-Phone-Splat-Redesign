import {chartProjection,sampleChart,fitColor,encodeSRGB,clamp} from './color-calibration.js';

// Conservative detector for a separated rectangular grid of near-uniform patches.
// Geometry proposes a grid; reference-color agreement validates its identity/order.
// No pre-supplied coordinates, external services, or chart-specific corner markers.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function downsample(image) {
  const scale=Math.min(1,480/Math.max(image.width,image.height)),width=Math.round(image.width*scale),height=Math.round(image.height*scale);
  const data=new Uint8ClampedArray(width*height*4),sx=image.width/width,sy=image.height/height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const px=Math.floor((x+.5)*sx),py=Math.floor((y+.5)*sy),out=(y*width+x)*4;
    // Local averaging suppresses compression noise without joining patch borders.
    let n=0;const sum=[0,0,0,0];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
      const xx=clamp(px+dx,0,image.width-1),yy=clamp(py+dy,0,image.height-1),i=(yy*image.width+xx)*4;
      for(let k=0;k<4;k++)sum[k]+=image.data[i+k];n++;
    }
    for(let k=0;k<4;k++)data[out+k]=sum[k]/n;
  }
  return {width,height,data};
}

function patches(image) {
  const {width,height,data}=image,total=width*height,seen=new Uint8Array(total),queue=new Int32Array(total),found=[];
  const similar=(a,b)=>Math.abs(data[a]-data[b])+Math.abs(data[a+1]-data[b+1])+Math.abs(data[a+2]-data[b+2])<32;
  for(let start=0;start<total;start++) {
    if(seen[start]||data[start*4+3]<250)continue;
    let head=0,tail=1,count=0,xsum=0,ysum=0,x2=0,y2=0,xy=0,minX=width,minY=height,maxX=0,maxY=0;
    queue[0]=start;seen[start]=1;
    while(head<tail) {
      const p=queue[head++],x=p%width,y=Math.floor(p/width);
      count++;xsum+=x;ysum+=y;x2+=x*x;y2+=y*y;xy+=x*y;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const next of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1]) {
        if(next<0||seen[next]||data[next*4+3]<250||!similar(next*4,p*4)||!similar(next*4,start*4))continue;
        seen[next]=1;queue[tail++]=next;
      }
    }
    const bw=maxX-minX+1,bh=maxY-minY+1,fill=count/(bw*bh),x=xsum/count,y=ysum/count;
    const vx=x2/count-x*x,vy=y2/count-y*y,cov=xy/count-x*y,delta=Math.sqrt((vx-vy)**2+4*cov*cov),ratio=(vx+vy+delta)/Math.max(.01,vx+vy-delta);
    if(count<35||count>total*.1||bw<6||bh<6||fill<.42||ratio>5||minX===0||minY===0||maxX===width-1||maxY===height-1)continue;
    found.push({x,y,area:count,fill});
  }
  return found.sort((a,b)=>b.area-a.area).slice(0,120);
}

function linearSolve(a,b) {
  const n=b.length,m=a.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++) {
    let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
    if(Math.abs(m[pivot][c])<1e-10)throw new Error('Degenerate patch geometry');
    [m[c],m[pivot]]=[m[pivot],m[c]];const d=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=d;
    for(let r=0;r<n;r++)if(r!==c){const f=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=f*m[c][k];}
  }
  return m.map(row=>row[n]);
}

function refine(matches,chart,width,height) {
  const a=Array.from({length:8},()=>Array(8).fill(0)),b=Array(8).fill(0);
  for(const {col,row,patch} of matches) {
    const u=col/(chart.columns-1),v=row/(chart.rows-1),x=patch.x/width,y=patch.y/height;
    for(const [r,target] of [[[u,v,1,0,0,0,-x*u,-x*v],x],[[0,0,0,u,v,1,-y*u,-y*v],y]]) {
      for(let i=0;i<8;i++){b[i]+=r[i]*target;for(let j=0;j<8;j++)a[i][j]+=r[i]*r[j];}
    }
  }
  const h=linearSolve(a,b);
  return [[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>[(h[0]*u+h[1]*v+h[2])/(h[6]*u+h[7]*v+1),(h[3]*u+h[4]*v+h[5])/(h[6]*u+h[7]*v+1)]);
}

function matchGrid(points,project,chart,width,height,tolerance) {
  const matches=[],used=new Set();
  for(let row=0;row<chart.rows;row++)for(let col=0;col<chart.columns;col++) {
    const [x,y]=project(col/(chart.columns-1),row/(chart.rows-1));
    let best=null,error=tolerance;
    for(const patch of points){if(used.has(patch))continue;const d=Math.hypot(patch.x-x*width,patch.y-y*height);if(d<error){best=patch;error=d;}}
    if(best){used.add(best);matches.push({col,row,patch:best,error});}
  }
  return matches;
}

// Strong color ordering can identify a chart even when the frame is unsuitable
// for a correction. Require opposite channel orderings to rule out gray grids.
function matchesReferenceOrder(samples, chart) {
  const usable = samples.filter(s=>s.usable);
  if (usable.length < Math.max(8,Math.ceil(samples.length/2))) return false;
  const patches = usable.map(s=>({ref:chart.patches[s.index], rgb:s.measured.map(n=>255*encodeSRGB(n))}));
  const pairs = [0,0,0], agreements = [0,0,0];
  for (let i=0; i<patches.length; i++) for (const other of patches.slice(i+1)) {
    const {ref,rgb} = patches[i];
    const delta = ref.map((v,k)=>v-other.ref[k]);
    if (Math.min(...delta)>-30 || Math.max(...delta)<30) continue;
    for (let k=0;k<3;k++) {
      if (Math.abs(delta[k])<30) continue;
      pairs[k]++;
      if ((rgb[k]-other.rgb[k])*Math.sign(delta[k])>5) agreements[k]++;
    }
  }
  const agreement=agreements.reduce((sum,n)=>sum+n,0)/pairs.reduce((sum,n)=>sum+n,0);
  return agreement>=0.86 && pairs.every((count,k)=>count>=8 && agreements[k]/count>=0.75);
}

function validateGrid(image, chart, corners, matchedIndices) {
  const samples=sampleChart(image,chart,corners,matchedIndices);
  if (samples.filter(s=>s.usable).length>=Math.max(12,Math.ceil(samples.length*.65))) {
    try {
      const fit=fitColor(samples);
      if (fit.after<=13 && Number.isFinite(fit.validation.after) && fit.validation.after<=20 &&
          fit.matrix.every((row,i)=>row[i]>=.2 && row[i]>=Math.max(...row.filter((_,k)=>k!==i).map(Math.abs))*1.2)) {
        return {method:'patch-grid-v2',error:fit.after};
      }
    } catch { /* A chart can be located even if its correction cannot be fitted. */ }
  }
  if (matchedIndices.length>=Math.ceil(samples.length*.9) && matchesReferenceOrder(samples,chart)) {
    return {method:'patch-grid-color-order',error:null};
  }
  return null;
}

export function detectColorChart(original,chart) {
  const image=downsample(original),points=patches(image),{width,height}=image,total=chart.columns*chart.rows;
  const fail=()=>{throw new Error('Chart not confidently found. Show the whole matching chart, move it closer, reduce glare, or use manual alignment.');};
  if(points.length<Math.ceil(total*.75))return fail();
  const proposals=[];
  for(const origin of points) {
    const neighbors=points.filter(p=>p!==origin&&p.area/origin.area>.4&&p.area/origin.area<2.5)
      .map(p=>({p,d:distance(p,origin)})).filter(({d})=>d>Math.sqrt(origin.area)*.85&&d<Math.sqrt(origin.area)*2.8).sort((a,b)=>a.d-b.d).slice(0,8);
    for(const {p:right,d:dx} of neighbors)for(const {p:down,d:dy} of neighbors) {
      const ax=right.x-origin.x,ay=right.y-origin.y,bx=down.x-origin.x,by=down.y-origin.y,det=ax*by-ay*bx;
      if(det<=0||dx/dy<.5||dx/dy>2||Math.abs(ax*bx+ay*by)/(dx*dy)>.45)continue;
      const cells=new Map();
      for(const patch of points) {
        if(patch.area/origin.area<.3||patch.area/origin.area>3)continue;
        const x=patch.x-origin.x,y=patch.y-origin.y,u=(x*by-y*bx)/det,v=(ax*y-ay*x)/det,col=Math.round(u),row=Math.round(v),error=Math.hypot(u-col,v-row);
        if(Math.abs(col)>=chart.columns||Math.abs(row)>=chart.rows||error>.38)continue;
        const key=row*(2*chart.columns)+col;if(!cells.has(key)||error<cells.get(key).error)cells.set(key,{col,row,patch,error});
      }
      // The seed may be an interior patch when a corner is dark or obscured.
      const minimum=Math.max(10,Math.ceil(total*.58));
      if(cells.size<minimum)continue;
      const lattice=[...cells.values()],step=Math.min(dx,dy),windows=[];
      for(let top=1-chart.rows;top<=0;top++) {
        const band=lattice.filter(p=>p.row>=top && p.row<top+chart.rows);
        if(band.length<minimum)continue;
        for(let left=1-chart.columns;left<=0;left++) {
          const window=band.filter(p=>p.col>=left && p.col<left+chart.columns);
          if(window.length<minimum)continue;
          windows.push({matches:window,left,top,step, x:origin.x+ax*left+bx*top, y:origin.y+ay*left+by*top,
            angle:Math.atan2(ay,ax),score:window.length-window.reduce((sum,m)=>sum+m.error,0)});
        }
      }
      windows.sort((a,b)=>b.score-a.score);
      proposals.push(...windows.slice(0,4));
    }
  }
  proposals.sort((a,b)=>b.score-a.score);
  const candidates=[];
  const tried=[];
  for(const proposal of proposals)try {
    if(tried.some(p=>Math.hypot(p.x-proposal.x,p.y-proposal.y)<proposal.step*.35 &&
        Math.cos(p.angle-proposal.angle)>.995 && Math.abs(p.step-proposal.step)<proposal.step*.08))continue;
    if(tried.length>=100)break;
    tried.push(proposal);
    let matches=proposal.matches.map(p=>({...p,col:p.col-proposal.left,row:p.row-proposal.top}));
    let corners=refine(matches,chart,width,height);
    for(let n=0;n<2;n++) {
      matches=matchGrid(points,chartProjection(corners),chart,width,height,proposal.step*.23);
      if(matches.length<Math.ceil(total*.8))break;
      corners=refine(matches,chart,width,height);
    }
    if(matches.length<Math.ceil(total*.8))continue;
    chartProjection(corners);
    if(candidates.some(c=>c.corners.every((p,i)=>Math.hypot(p[0]-corners[i][0],p[1]-corners[i][1])<.035)))continue;
    const matchedIndices=matches.map(({row,col})=>row*chart.columns+col);
    const validation=validateGrid(original,chart,corners,matchedIndices);if(!validation)continue;
    candidates.push({corners,matched:matches.length,matchedIndices,total,...validation});
  }catch{/* A failed candidate is not evidence for a chart. */}
  if(!candidates.length)return fail();
  if(candidates.length>1)throw new Error('More than one plausible chart was found. Keep one chart in view or use manual alignment.');
  return candidates[0];
}
