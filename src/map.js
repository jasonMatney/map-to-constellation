/* Small, dependency-free Web Mercator map. One unwrapped coordinate frame. */
(function () {
  'use strict';
  const C=window.ConstellationCore;
  class ConstellationMap {
    constructor(el,options) {
      this.el=el; this.options=options; this.zoom=options.view.zoom; this.center={...options.view.center}; this.locked=options.view.locked;
      this.mode='plot';this.pointers=new Map();this.tiles=new Map();this.gesture=null;this.frame=0;this.lastWheel=0;this.tileTimer=0;
      this.tileRoot=el.querySelector('.tile-layer');this.svg=el.querySelector('.point-layer');this.tileFailures=0;this.tileSuccess=0;
      this.networkAllowed=/^https?:$/.test(location.protocol);this.width=el.clientWidth;this.height=el.clientHeight;
      this.observer=new ResizeObserver(()=>{this.width=el.clientWidth;this.height=el.clientHeight;this.scheduleRender();});this.observer.observe(el);
      el.addEventListener('pointerdown',e=>this.pointerDown(e));el.addEventListener('pointermove',e=>this.pointerMove(e));
      el.addEventListener('pointerup',e=>this.pointerEnd(e));el.addEventListener('pointercancel',e=>this.pointerEnd(e,true));
      el.addEventListener('wheel',e=>this.wheel(e),{passive:false});
      el.addEventListener('keydown',e=>this.keydown(e));
      this.render();
      if(!this.networkAllowed)options.onTileStatus('local');
    }
    location(e){const r=this.el.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    getView(){return{center:{...this.center},zoom:this.zoom,locked:this.locked};}
    centerPixel(){return C.project(this.center.lat,this.center.lng,this.zoom);}
    screenToCoord(x,y){const p=this.centerPixel();return C.unproject(p.x+x-this.width/2,p.y+y-this.height/2,this.zoom);}
    toScreen(p){const c=this.centerPixel(),v=C.project(p.lat,p.lng,this.zoom,p.world||0);return{x:v.x-c.x+this.width/2,y:v.y-c.y+this.height/2};}
    setMode(mode){this.mode=mode;this.el.dataset.mode=mode;}
    setView(center,zoom=this.zoom,force=false){this.center={lat:C.clamp(center.lat,-C.MAX_LAT,C.MAX_LAT),lng:C.clamp(center.lng,-368820,368820)};if(!this.locked||force)this.zoom=C.clamp(zoom,2,19);this.scheduleRender();this.options.onViewChange(this.getView());}
    setLocked(locked){this.locked=locked;this.options.onViewChange(this.getView());}
    zoomBy(delta,anchor={x:this.width/2,y:this.height/2}){if(this.locked)return;this.zoomAt(C.clamp(this.zoom+delta,2,19),anchor);this.options.onViewChange(this.getView());}
    zoomAt(next,anchor){const ll=this.screenToCoord(anchor.x,anchor.y);this.zoom=next;const p=C.project(ll.lat,ll.lng,next);this.center=C.unproject(p.x-anchor.x+this.width/2,p.y-anchor.y+this.height/2,next);this.center.lat=C.clamp(this.center.lat,-C.MAX_LAT,C.MAX_LAT);this.scheduleRender();}
    fit(points){
      if(!points.length)return;
      const projected=C.projectPoints(points,0);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const p of projected){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
      const pad=110, dx=maxX-minX,dy=maxY-minY;
      const z=dx+dy<1e-12?16:Math.floor(Math.log2(Math.min(Math.max(40,this.width-pad)/Math.max(dx,1e-12),Math.max(40,this.height-pad)/Math.max(dy,1e-12))));
      this.setView(C.unproject((minX+maxX)/2,(minY+maxY)/2,0),C.clamp(z,2,19));
    }
    pointerDown(e){
      if(e.button!==0 || e.target.closest('[data-map-control]'))return;
      const p=this.location(e);this.pointers.set(e.pointerId,p);this.el.setPointerCapture(e.pointerId);
      if(this.pointers.size===1){this.gesture={start:p,center:this.centerPixel(),moved:false,point:e.target.closest('[data-point-id]')?.dataset.pointId||null};}
      else if(this.pointers.size===2){const [a,b]=[...this.pointers.values()];this.gesture={pinch:true,moved:true,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:this.zoom,anchor:this.screenToCoord((a.x+b.x)/2,(a.y+b.y)/2),startCenter:this.centerPixel(),startMid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};}
      this.el.classList.add('interacting');
    }
    pointerMove(e){
      const p=this.location(e);this.options.onPointer(this.screenToCoord(p.x,p.y));
      if(!this.pointers.has(e.pointerId)||!this.gesture)return;
      this.pointers.set(e.pointerId,p);
      if(this.pointers.size===2&&this.gesture.pinch){
        const [a,b]=[...this.pointers.values()],g=this.gesture,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        if(!this.locked)this.zoom=C.clamp(g.zoom+Math.log2(Math.hypot(a.x-b.x,a.y-b.y)/g.distance),2,19);
        const world=C.project(g.anchor.lat,g.anchor.lng,this.zoom);
        this.center=C.unproject(world.x-mid.x+this.width/2,world.y-mid.y+this.height/2,this.zoom);
      }else if(this.pointers.size===1&&!this.gesture.pinch){
        const g=this.gesture,dx=p.x-g.start.x,dy=p.y-g.start.y;
        if(Math.hypot(dx,dy)>4)g.moved=true;
        if(g.moved)this.center=C.unproject(g.center.x-dx,g.center.y-dy,this.zoom);
      }
      this.center.lat=C.clamp(this.center.lat,-C.MAX_LAT,C.MAX_LAT);this.center.lng=C.clamp(this.center.lng,-368820,368820);this.scheduleRender();
    }
    pointerEnd(e,cancel=false){
      if(!this.pointers.has(e.pointerId))return;
      const p=this.location(e),g=this.gesture;this.pointers.delete(e.pointerId);
      if(this.el.hasPointerCapture(e.pointerId))this.el.releasePointerCapture(e.pointerId);
      if(!cancel&&g&&!g.moved&&!g.pinch){if(g.point)this.options.onSelect(g.point);else if(this.mode==='plot')this.options.onAdd(this.screenToCoord(p.x,p.y));else this.options.onSelect(null);}
      if(this.pointers.size===1){const remaining=[...this.pointers.values()][0];this.gesture={start:remaining,center:this.centerPixel(),moved:true};}
      else if(!this.pointers.size){this.gesture=null;this.el.classList.remove('interacting');this.options.onViewChange(this.getView());this.scheduleRender();}
    }
    wheel(e){if(e.target.closest('[data-map-control]'))return;e.preventDefault();if(this.locked)return;const now=performance.now();if(now-this.lastWheel<150)return;this.lastWheel=now;this.zoomBy(e.deltaY<0?1:-1,this.location(e));}
    keydown(e){if(e.target!==this.el)return;const step=e.shiftKey?160:60,c=this.centerPixel();let moved=true;
      if(e.key==='ArrowLeft')c.x-=step;else if(e.key==='ArrowRight')c.x+=step;else if(e.key==='ArrowUp')c.y-=step;else if(e.key==='ArrowDown')c.y+=step;
      else if(e.key==='+'||e.key==='='){this.zoomBy(1);e.preventDefault();return;}else if(e.key==='-'){this.zoomBy(-1);e.preventDefault();return;}
      else if(e.key==='Enter'&&this.mode==='plot'){this.options.onAdd({...this.center});e.preventDefault();return;}else moved=false;
      if(moved){e.preventDefault();this.setView(C.unproject(c.x,c.y,this.zoom));}}
    scheduleRender(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
    render(){
      this.width=this.el.clientWidth;this.height=this.el.clientHeight;
      const cp=this.centerPixel();this.origin={x:cp.x-this.width/2,y:cp.y-this.height/2};
      this.svg.setAttribute('viewBox',`0 0 ${this.width} ${this.height}`);
      // Apply an identical common translation to the canonical projected positions.
      this.options.onRender(this);
      this.positionExistingTiles();clearTimeout(this.tileTimer);
      this.tileTimer=setTimeout(()=>this.renderTiles(),this.pointers.size?100:30);
    }
    positionExistingTiles(){
      const z=Math.floor(this.zoom),scale=2**(this.zoom-z);
      for(const entry of this.tiles.values()){
        if(entry.z!==z){entry.el.style.visibility='hidden';continue;}entry.el.style.visibility='visible';
        entry.el.style.transform=`translate(${entry.x*256*scale-this.origin.x}px,${entry.y*256*scale-this.origin.y}px)`;
        entry.el.style.width=`${256*scale+.1}px`;entry.el.style.height=`${256*scale+.1}px`;
      }
    }
    renderTiles(){
      if(!this.networkAllowed)return;
      const z=Math.floor(this.zoom),scale=2**(this.zoom-z),tileSize=256*scale,n=2**z;
      const x0=Math.floor(this.origin.x/tileSize),x1=Math.floor((this.origin.x+this.width-1)/tileSize);
      const y0=Math.max(0,Math.floor(this.origin.y/tileSize)),y1=Math.min(n-1,Math.floor((this.origin.y+this.height-1)/tileSize));
      const needed=new Set();
      // Only currently visible tiles; no prefetch, offline cache, or cache bypass.
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=`${z}/${x}/${y}`;needed.add(key);
        if(!this.tiles.has(key)){
          const img=document.createElement('img');img.alt='';img.draggable=false;img.decoding='async';img.referrerPolicy='strict-origin-when-cross-origin';
          img.addEventListener('load',()=>{this.tileSuccess++;this.options.onTileStatus('ready');});
          img.addEventListener('error',()=>{this.tileFailures++;img.classList.add('tile-failed');if(this.tileFailures>2)this.options.onTileStatus('error');});
          img.src=`https://tile.openstreetmap.org/${z}/${C.mod(x,n)}/${y}.png`;
          this.tileRoot.append(img);this.tiles.set(key,{el:img,x,y,z});
        }
      }
      for(const [key,entry] of this.tiles)if(!needed.has(key)){entry.el.remove();this.tiles.delete(key);}
      this.positionExistingTiles();
    }
    retryTiles(){for(const t of this.tiles.values())t.el.remove();this.tiles.clear();this.tileFailures=0;this.scheduleRender();}
  }
  window.ConstellationMap=ConstellationMap;
})();
