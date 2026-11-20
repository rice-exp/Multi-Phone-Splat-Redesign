// Image-space prototype. These matrices are NOT Android sensor-space transforms.
// X-Rite's post-November-2014 Classic Lab reference, as published by Colour:
// ICC D50 Lab -> XYZ -> Bradford D65 -> sRGB, clipped and rounded to 8 bits.
// See docs/COLOR-CALIBRATION.md for the source and conversion conventions.
export const CLASSIC24={id:'calibrite-colorchecker-classic-2014',name:'Calibrite ColorChecker Classic',columns:6,rows:4,
  source:'https://www.xrite.com/service-support/new_color_specifications_for_colorchecker_sg_and_classic_charts',
  patches:[
    [116,79,65],[197,144,127],[91,120,155],[91,108,64],[131,127,175],[95,189,172],
    [224,124,48],[69,90,167],[197,80,95],[93,58,104],[156,187,58],[227,161,39],
    [40,62,145],[61,147,70],[178,54,57],[236,199,15],[191,79,146],[0,133,165],
    [241,242,235],[201,202,201],[161,163,163],[121,121,121],[83,84,85],[50,50,50]
  ]};
export const REFERENCE_SOURCE='https://www.datacolor.com/spyder/downloads/SpyderCheckr_Color_Data_V2.pdf';
// Columns E–H, rows 1–6 in Datacolor's V2 table. Row-major order.
export const SPYDER24={id:'spyder-checkr-24-v2',name:'Spyder Checkr 24',columns:4,rows:6,source:REFERENCE_SOURCE,patches:[
  [249,242,238],[0,127,159],[222,118,32],[98,187,166],
  [202,198,195],[192,75,145],[58,88,159],[126,125,174],
  [161,157,154],[245,205,0],[195,79,95],[82,106,60],
  [122,118,116],[186,26,51],[83,58,106],[87,120,155],
  [80,80,78],[57,146,64],[157,188,54],[197,145,125],
  [43,41,43],[25,55,135],[238,158,25],[112,76,60]
]};
export const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];
export const MIN_USABLE_PATCHES=12;
export const defaultAdjustments=()=>({amount:100,exposure:0,warmth:0,tint:0,saturation:100});
export const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
export const decodeSRGB=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
export const encodeSRGB=v=>v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055;
const multiply=(m,v)=>m.map(row=>row.reduce((s,x,i)=>s+x*v[i],0));

export function validateReference(value) {
  if(!value||value.colorSpace!=='sRGB'||!Number.isInteger(value.columns)||!Number.isInteger(value.rows)||value.columns<2||value.rows<2||value.columns>12||value.rows>12||value.columns*value.rows<12)throw new Error('Use an sRGB reference with 2–12 rows and columns, and at least 12 patches.');
  if(!Array.isArray(value.patches)||value.patches.length!==value.columns*value.rows||value.patches.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||n<0||n>255)))throw new Error('Provide one RGB triplet (0–255) per patch, in row order.');
  return {id:'custom',name:String(value.name||'Custom chart').slice(0,80),columns:value.columns,rows:value.rows,patches:value.patches.map(p=>[...p]),source:String(value.source||'User-supplied reference').slice(0,500)};
}

function solveLinear(a,b) {
  const n=b.length,m=a.map((row,i)=>[...row,b[i]]),scale=Math.max(...a.flat().map(Math.abs));
  for(let c=0;c<n;c++) {
    let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
    if(Math.abs(m[pivot][c])<Math.max(1e-10,scale*1e-8))throw new Error('The samples do not contain enough independent color information. Check chart alignment and lighting.');
    [m[c],m[pivot]]=[m[pivot],m[c]];const d=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=d;
    for(let r=0;r<n;r++)if(r!==c){const f=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=f*m[c][k];}
  }
  return m.map(row=>row[n]);
}

// Four points identify corner PATCH CENTERS, in reference order TL, TR, BR, BL.
export function chartProjection(corners) {
  if(corners.length!==4||corners.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1)))throw new Error('Mark all four corner patch centers inside the photo.');
  const cross=corners.map((p,i)=>{const q=corners[(i+1)%4],r=corners[(i+2)%4];return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});
  const area=Math.abs(corners.reduce((s,p,i)=>s+p[0]*corners[(i+1)%4][1]-p[1]*corners[(i+1)%4][0],0))/2;
  if(area<0.015||!cross.every(n=>n>0.00001))throw new Error('Mark a larger, unmirrored chart clockwise: top left, top right, bottom right, bottom left.');
  const a=[],b=[];
  [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const [x,y]=corners[i];a.push([u,v,1,0,0,0,-x*u,-x*v],[0,0,0,u,v,1,-y*u,-y*v]);b.push(x,y);});
  const h=solveLinear(a,b);
  return (u,v)=>{const d=h[6]*u+h[7]*v+1;return [(h[0]*u+h[1]*v+h[2])/d,(h[3]*u+h[4]*v+h[5])/d];};
}

// Measured in patch-center spacings; the overlay uses the same footprint.
export const PATCH_HALF_WIDTH = 0.26;
const clippedPixel = pixel => pixel.some(value => value <= 2 || value >= 253);
const medianByte = values => values.sort((a,b) => a-b)[Math.floor(values.length / 2)];

function measurePatch(pixels) {
  const count = pixels.length;
  const median = [0,1,2].map(channel => medianByte(pixels.map(pixel => pixel[channel])) ?? 0);
  const clipped = pixels.filter(clippedPixel);
  // Require a coherent majority in all three channels at the same pixel.
  // This discards a reflection or a speck without mixing incompatible colors.
  const clean = pixels.filter(pixel => !clippedPixel(pixel) &&
    pixel.every((value, channel) => Math.abs(value - median[channel]) <= 18));
  const measured = [0,1,2].map(channel => clean.length
    ? clean.reduce((sum,pixel) => sum + decodeSRGB(pixel[channel]/255), 0) / clean.length
    : decodeSRGB(median[channel]/255));
  const clippedFraction = clipped.length / Math.max(1,count);
  const reason = clippedFraction > 0.25 ? 'Clipped' : clean.length < 0.75 * count ? 'Uneven patch' : '';
  const clippedChannels = ['R','G','B'].filter((_,k) => clipped.some(pixel => pixel[k] <= 2 || pixel[k] >= 253));
  return {measured, reason, quality:{pixelCount:count, retainedCount:clean.length, clippedFraction, clippedChannels}};
}

export function sampleChart(image, chart, corners, matchedIndices) {
  const matched = matchedIndices && new Set(matchedIndices);
  const project = chartProjection(corners), {width,height,data} = image;
  const du = PATCH_HALF_WIDTH/(chart.columns-1), dv = PATCH_HALF_WIDTH/(chart.rows-1);
  return chart.patches.map((target,index) => {
    const u = (index%chart.columns)/(chart.columns-1), v = Math.floor(index/chart.columns)/(chart.rows-1);
    const left = project(u-du,v), right = project(u+du,v), top = project(u,v-dv), bottom = project(u,v+dv);
    const span = (p,q) => Math.hypot((p[0]-q[0])*width, (p[1]-q[1])*height);
    const pixels = [], seen = new Set();
    let outside = false;
    for (let dy=-5; dy<=5; dy++) for (let dx=-5; dx<=5; dx++) {
      const [x,y] = project(u+dx*du/5, v+dy*dv/5);
      if (x<0 || y<0 || x>=1 || y>=1) { outside=true; continue; }
      const offset = (Math.floor(y*height)*width + Math.floor(x*width))*4;
      if (seen.has(offset)) continue;
      seen.add(offset);
      if (data[offset+3]<250) { outside=true; continue; }
      pixels.push([data[offset],data[offset+1],data[offset+2]]);
    }
    const tiny = Math.min(span(left,right),span(top,bottom)) < 8 || pixels.length < 25;
    const {measured,quality,reason:pixelReason} = measurePatch(pixels);
    const reason = matched && !matched.has(index) ? 'Unconfirmed position' : outside ? 'Outside image' : tiny ? 'Too small' : pixelReason;
    return {index, measured, target:target.map(n=>decodeSRGB(n/255)), usable:!reason, reason, quality};
  });
}

// Compare red/green and blue/green with each patch's own reference in linear RGB.
// Ratios remove overall exposure. The median limits the effect of one uneven patch.
export function neutralBalance(samples, chart) {
  const ratios = [];
  for (const sample of samples) {
    const ref = chart.patches[sample.index];
    if (!sample.usable || Math.max(...ref) - Math.min(...ref) > 12 || Math.min(...ref) < 32) continue;
    const [r, g, b] = sample.measured, [tr, tg, tb] = sample.target;
    if (g > 0 && tr > 0 && tb > 0) ratios.push([r * tg / (g * tr), b * tg / (g * tb)]);
  }
  if (ratios.length < 2) return null;
  const bias = channel => {
    const values = ratios.map(r => r[channel]).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return (median - 1) * 100;
  };
  return {count:ratios.length, red:bias(0), blue:bias(1)};
}

export function neutralBalanceLabel(samples, chart) {
  const balance = neutralBalance(samples, chart);
  if (!balance) return 'Fewer than two usable neutral patches. Check the mat, lighting and angle.';
  const percent = n => (Math.round(n) > 0 ? '+' : '') + Math.round(n) + '%';
  return `${balance.count} neutral patches · red/green ${percent(balance.red)} · blue/green ${percent(balance.blue)} against the reference`;
}

export function patchQualitySummary(samples) {
  const rejected=new Map();let usable=0;
  for(const sample of samples) {
    if(sample.usable)usable++;
    else {const reason=sample.reason||'Rejected';rejected.set(reason,(rejected.get(reason)||0)+1);}
  }
  return {usable,total:samples.length,rejected:[...rejected].map(([reason,count])=>({reason,count}))};
}

// Householder QR solves the original sample system rather than squaring its
// condition number through normal equations. Each output channel is a RHS.
function regressColor(samples) {
  const terms=3;
  const rows=samples.map(s=>[...s.measured,...s.target]);
  const scale=Math.max(...rows.flatMap(row=>row.slice(0,terms).map(Math.abs)));
  for(let col=0;col<terms;col++) {
    const norm=Math.hypot(...rows.slice(col).map(row=>row[col]));
    if(norm<Math.max(1e-10,scale*1e-7))throw new Error('The samples do not contain enough independent color information. Check chart alignment and lighting.');
    const vector=rows.slice(col).map(row=>row[col]);vector[0]+=(vector[0]>=0?1:-1)*norm;
    const length=Math.hypot(...vector);for(let i=0;i<vector.length;i++)vector[i]/=length;
    for(let k=col;k<terms+3;k++) {
      const dot=vector.reduce((sum,v,i)=>sum+v*rows[col+i][k],0);
      for(let i=0;i<vector.length;i++)rows[col+i][k]-=2*vector[i]*dot;
    }
  }
  const coefficients=[0,1,2].map(channel=>{
    const result=Array(terms).fill(0);
    for(let row=terms-1;row>=0;row--)result[row]=(rows[row][terms+channel]-result.reduce((sum,v,k)=>sum+(k>row?rows[row][k]*v:0),0))/rows[row][row];
    return result;
  });
  if(coefficients.flat().some(n=>!Number.isFinite(n)))throw new Error('The chart did not produce a finite correction.');
  return {matrix:coefficients.map((row,channel)=>refineChannel(samples,channel,row))};
}

// Refine the same linear CCM against the displayed sRGB error. A linear-RGB
// least-squares fit otherwise gives the brightest patches much more weight.
function refineChannel(samples,channel,initial) {
  let row=initial.map(n=>clamp(n,-8,8));
  const target=samples.map(s=>encodeSRGB(s.target[channel]));
  const predicted=(r,s)=>r.reduce((sum,v,k)=>sum+v*s.measured[k],0);
  const loss=r=>samples.reduce((sum,s,i)=>sum+(encodeSRGB(clamp(predicted(r,s)))-target[i])**2,0);
  let error=loss(row);
  for(let iteration=0;iteration<12&&error>1e-12;iteration++){
    const normal=[[0,0,0],[0,0,0],[0,0,0]],rhs=[0,0,0];
    samples.forEach((s,i)=>{
      const value=predicted(row,s);
      const slope=value<=.0031308?12.92:(1.055/2.4)*value**(1/2.4-1);
      const derivative=s.measured.map(v=>v*slope);
      const residual=target[i]-encodeSRGB(value);
      for(let k=0;k<3;k++){
        rhs[k]+=derivative[k]*residual;
        for(let j=0;j<3;j++)normal[k][j]+=derivative[k]*derivative[j];
      }
    });
    // QR has already checked independence. Retain its solution when the
    // weighted refinement is ill-conditioned or can't lower displayed error.
    let step;
    try {step=solveLinear(normal,rhs);} catch {break;}
    let better=false;
    for(let scale=1;scale>=1/32;scale/=2){
      const next=row.map((v,k)=>clamp(v+step[k]*scale,-8,8));
      const nextError=loss(next);
      if(nextError<error-1e-12){row=next;error=nextError;better=true;break;}
    }
    if(!better)break;
  }
  return row;
}

// The absolute target is for automatic activation. An improvement on both
// the training patches and the leave-one-out check can be reviewed explicitly.
export function fitDisposition(fit) {
  if(fit?.model==='manual')return 'manual';
  const valid=n=>Number.isFinite(n)&&n>=0;
  if(!valid(fit?.after))return 'blocked';
  const v=fit.validation;
  if(v===undefined)return fit.after<=12?'automatic':'blocked'; // legacy presets
  if(!valid(v?.before)||!valid(v?.after)||v.after>v.before+0.5)return 'blocked';
  if(fit.after<=12&&v.after<=12)return 'automatic';
  return Number.isInteger(fit.accepted)&&fit.accepted>=MIN_USABLE_PATCHES&&valid(fit.before)&&v.before===fit.before&&
    fit.after<fit.before&&v.after<v.before?'review':'blocked';
}

const transformed=(fit,rgb)=>multiply(fit.matrix,rgb).map((n,k)=>n+(fit.offset?.[k]??0));
const squaredColorError=(sample,fit)=>transformed(fit,sample.measured).reduce((sum,v,k)=>sum+(255*(encodeSRGB(clamp(v))-encodeSRGB(sample.target[k])))**2,0);
const colorError=(samples,fit)=>Math.sqrt(samples.reduce((sum,s)=>sum+squaredColorError(s,fit),0)/(samples.length*3));
function withheldError(samples) {
  // Leave one patch out, predict it using the others, and repeat for every patch.
  // This checks generalisation across this chart, not across independent photos.
  let sum=0;
  for(let i=0;i<samples.length;i++)sum+=squaredColorError(samples[i],regressColor(samples.filter((_,k)=>k!==i)));
  return Math.sqrt(sum/(samples.length*3));
}

export function fitColor(samples) {
  const accepted=samples.filter(s=>s.usable);
  if(accepted.length<MIN_USABLE_PATCHES) {
    const reasons=patchQualitySummary(samples).rejected.map(({reason,count})=>`${count} ${reason.toLowerCase()}`).join(', ');
    throw new Error(`Only ${accepted.length} usable patches. Need at least ${MIN_USABLE_PATCHES}.${reasons?` Rejected: ${reasons}.`:''} See the patch checks below the alignment image.`);
  }
  if(accepted.some(s=>![s.measured,s.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=1))))throw new Error('Patch measurements must be finite linear RGB values from 0 to 1.');
  const fit=regressColor(accepted);let validation=null;
  try{validation=withheldError(accepted);}catch{/* Missing color diversity is reported and blocks shared preset replacement. */}
  const before=colorError(accepted,{matrix:IDENTITY}),after=colorError(accepted,fit);
  if(after>before+0.5)throw new Error('The fit did not improve chart matching. Check the reference and corner positions.');
  return {matrix:fit.matrix,model:'linear',before,after,accepted:accepted.length,total:samples.length,
    validation:{method:'leave-one-patch-out',before,after:validation}};
}

// Optional offsets remain readable only for profiles saved by older versions.
export function correctLinear(rgb,matrix=IDENTITY,adjustments=defaultAdjustments(),offset=[0,0,0]) {
  const a=adjustments,corrected=transformed({matrix,offset},rgb),amount=a.amount/100;
  let v=rgb.map((n,k)=>n*(1-amount)+corrected[k]*amount);
  const gains=[2**(a.warmth/200),2**(-a.tint/200),2**(-a.warmth/200)];
  v=v.map((n,k)=>n*gains[k]*2**a.exposure);
  if(a.saturation===100)return v;
  const gray=v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
  return v.map(n=>gray+(n-gray)*a.saturation/100);
}

const decodeTable=Array.from({length:256},(_,n)=>decodeSRGB(n/255));
export function correctedPixels(image,matrix,adjustments,offset=[0,0,0]) {
  const output=new Uint8ClampedArray(image.data.length);
  const black=correctLinear([0,0,0],matrix,adjustments,offset);
  const basis=IDENTITY.map(v=>correctLinear(v,matrix,adjustments,offset).map((n,k)=>n-black[k]));
  for(let i=0;i<output.length;i+=4) {
    const r=decodeTable[image.data[i]],g=decodeTable[image.data[i+1]],b=decodeTable[image.data[i+2]];
    for(let k=0;k<3;k++)output[i+k]=255*encodeSRGB(clamp(black[k]+r*basis[0][k]+g*basis[1][k]+b*basis[2][k]));
    output[i+3]=image.data[i+3];
  }
  return output;
}
