// Dependency-free navigation prototype. This draws a procedural point scene,
// not Gaussian data. Keep this interface when substituting a real splat renderer.
export function mountViewer(canvas,{frames=90,fps=30,onFrame=()=>{},onPlay=()=>{}}={}) {
  const ctx=canvas.getContext('2d'),listeners=[],pointers=new Map();
  let width=1,height=1,raf,disposed=false,lastTime=0,frame=0,playing=false,speed=1,pinchDistance=0;
  const view={yaw:-.36,pitch:.13,distance:4.8,x:0,y:.04,z:0};
  const initial={...view};
  const bind=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  let seed=7192;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const points=[];
  function ellipsoid(cx,cy,cz,rx,ry,rz,count,color,part='body') {
    for(let i=0;i<count;i++){
      const a=random()*Math.PI*2,v=random()*2-1,s=Math.sqrt(1-v*v);
      points.push({x:cx+rx*s*Math.cos(a),y:cy+ry*v,z:cz+rz*s*Math.sin(a),part,color,light:.7+random()*.3,radius:1+random()*.8});
    }
  }
  ellipsoid(0,.23,0,.27,.45,.17,1700,[205,194,168]);
  ellipsoid(0,.84,0,.14,.2,.14,670,[198,158,123]);
  ellipsoid(0,.96,-.025,.145,.1,.14,340,[61,68,57]);
  ellipsoid(-.14,-.42,0,.10,.38,.1,680,[118,147,145]);
  ellipsoid(.14,-.42,0,.10,.38,.1,680,[118,147,145]);
  ellipsoid(-.14,-.79,.045,.12,.065,.19,250,[209,207,184]);
  ellipsoid(.14,-.79,.045,.12,.065,.19,250,[209,207,184]);
  ellipsoid(-.33,.18,0,.08,.31,.085,620,[188,176,147],'left');
  ellipsoid(.33,.18,0,.08,.31,.085,620,[188,176,147],'right');
  ellipsoid(-.34,-.14,0,.065,.09,.07,180,[198,158,123],'left');
  ellipsoid(.34,-.14,0,.065,.09,.07,180,[198,158,123],'right');
  for(let i=0;i<850;i++){const a=random()*Math.PI*2,r=.4+random()*1.3;points.push({x:Math.cos(a)*r,y:-.87+random()*.015,z:Math.sin(a)*r,part:'floor',color:[98,128,111],light:.6+random()*.4,radius:.8});}
  const observer=new ResizeObserver(()=>{
    const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;
    const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    if(!playing)draw();
  });observer.observe(canvas);
  function project(x,y,z) {
    x-=view.x;y-=view.y;z-=view.z;
    const cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cp=Math.cos(view.pitch),sp=Math.sin(view.pitch);
    const rx=x*cy-z*sy,rz=x*sy+z*cy,ry=y*cp-rz*sp,depth=view.distance+rz*cp+y*sp;
    if(depth<.15)return null;
    const scale=Math.min(width,height)*1.7/depth;
    return {x:width*.5+rx*scale,y:height*.52-ry*scale,depth,scale};
  }
  function line(a,b,color) {
    const p=project(...a),q=project(...b);if(!p||!q)return;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();
  }
  function draw() {
    if(disposed)return;
    const gradient=ctx.createRadialGradient(width*.5,height*.35,0,width*.5,height*.4,width*.7);
    gradient.addColorStop(0,'#233333');gradient.addColorStop(1,'#111c20');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
    for(let i=-8;i<=8;i++){line([i*.5,-.89,-4],[i*.5,-.89,4],i===0?'#60726740':'#586d6724');line([-4,-.89,i*.5],[4,-.89,i*.5],i===0?'#60726740':'#586d6724');}
    const phase=frames>1?frame/Math.max(1,frames-1)*Math.PI*2:0;
    const projected=[];
    for(const p of points){
      let x=p.x,y=p.y,z=p.z;
      if(p.part==='left'||p.part==='right'){
        const side=p.part==='left'?-1:1,angle=side*(.13+Math.sin(phase)*.23),shoulder=side*.26;
        const ox=x-shoulder,oy=y-.46;x=shoulder+ox*Math.cos(angle)-oy*Math.sin(angle);y=.46+ox*Math.sin(angle)+oy*Math.cos(angle);z+=Math.sin(phase)*.065;
      }
      if(p.part!=='floor')z+=Math.sin(phase)*.016;
      const q=project(x,y,z);if(!q)continue;
      const shade=p.light*(.82+Math.max(-.1,z)*.35),[r,g,b]=p.color;
      projected.push({...q,radius:clamp(p.radius*q.scale/175,.45,3.2),color:`rgba(${Math.round(r*shade)},${Math.round(g*shade)},${Math.round(b*shade)},${p.part==='floor'?.4:.84})`});
    }
    projected.sort((a,b)=>b.depth-a.depth);
    for(const p of projected){ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.fill();}
    // Sparse camera-position markers make orbit and depth changes easy to see.
    for(let i=0;i<8;i++){const angle=i*Math.PI/4,p=project(Math.sin(angle)*1.65,-.84,Math.cos(angle)*1.65);if(!p)continue;ctx.fillStyle='#9fae8777';ctx.fillRect(p.x-2,p.y-2,4,4);}
  }
  const pinch=()=>{const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
  bind(canvas,'pointerdown',event=>{canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});pinchDistance=pinch();canvas.classList.add('dragging');});
  bind(canvas,'pointermove',event=>{
    const previous=pointers.get(event.pointerId);if(!previous)return;
    const dx=event.clientX-previous.x,dy=event.clientY-previous.y;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>1){const distance=pinch();if(pinchDistance&&distance)view.distance=clamp(view.distance*pinchDistance/distance,1.6,12);pinchDistance=distance;}
    else if(event.shiftKey){view.x-=dx*.004*view.distance/5;view.y+=dy*.004*view.distance/5;}
    else{view.yaw+=dx*.007;view.pitch=clamp(view.pitch+dy*.005,-1.1,1.1);}
    if(!playing)draw();
  });
  const release=event=>{pointers.delete(event.pointerId);pinchDistance=pinch();if(!pointers.size)canvas.classList.remove('dragging');};
  bind(canvas,'pointerup',release);bind(canvas,'pointercancel',release);bind(canvas,'lostpointercapture',release);
  bind(canvas,'wheel',event=>{event.preventDefault();view.distance=clamp(view.distance*Math.exp(event.deltaY*.001),1.6,12);if(!playing)draw();},{passive:false});
  bind(canvas,'keydown',event=>{
    const key=event.key.toLowerCase();if(!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','r',' '].includes(key))return;event.preventDefault();
    if(key==='w'||key==='s'){const direction=key==='w'?1:-1;view.z+=Math.cos(view.yaw)*.09*direction;view.x+=Math.sin(view.yaw)*.09*direction;}
    if(key==='a'||key==='d'){const direction=key==='a'?-1:1;view.x+=Math.cos(view.yaw)*.09*direction;view.z-=Math.sin(view.yaw)*.09*direction;}
    if(key==='arrowleft')view.yaw-=.055;if(key==='arrowright')view.yaw+=.055;
    if(key==='arrowup')view.pitch=clamp(view.pitch-.045,-1.1,1.1);if(key==='arrowdown')view.pitch=clamp(view.pitch+.045,-1.1,1.1);
    if(key==='r')Object.assign(view,initial);if(key===' ')api.togglePlay();
    if(!playing)draw();
  });
  function animate(time) {
    if(disposed)return;
    if(playing){frame=(frame+Math.min(.1,(time-lastTime)/1000)*fps*speed)%frames;onFrame(Math.floor(frame));draw();}
    lastTime=time;raf=requestAnimationFrame(animate);
  }
  const api={
    reset(){Object.assign(view,initial);draw();},
    setFrame(value){frame=clamp(value,0,frames-1);onFrame(Math.floor(frame));draw();},
    setSpeed(value){speed=clamp(value,.25,3);},
    togglePlay(){playing=frames>1&&!playing;onPlay(playing);},
    destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();listeners.forEach(remove=>remove());}
  };
  onFrame(0);onPlay(false);raf=requestAnimationFrame(animate);return api;
}
