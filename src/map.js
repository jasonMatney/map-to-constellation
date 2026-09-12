/* Web Mercator editing surface with a synchronized vector basemap. */
(function () {
  'use strict';
  const C=window.ConstellationCore;
  class ConstellationMap {
    constructor(el,options) {
      this.el=el; this.options=options; this.zoom=options.view.zoom; this.center={...options.view.center}; this.locked=options.view.locked;
      this.mode='plot';this.pointers=new Map();this.gesture=null;this.frame=0;this.lastWheel=0;
      this.tileRoot=el.querySelector('.tile-layer');this.svg=el.querySelector('.point-layer');
      this.networkAllowed=/^https?:$/.test(location.protocol);this.width=el.clientWidth;this.height=el.clientHeight;
      this.observer=new ResizeObserver(()=>{this.width=el.clientWidth;this.height=el.clientHeight;this.scheduleRender();});this.observer.observe(el);
      el.addEventListener('pointerdown',e=>this.pointerDown(e));el.addEventListener('pointermove',e=>this.pointerMove(e));
      el.addEventListener('pointerup',e=>this.pointerEnd(e));el.addEventListener('pointercancel',e=>this.pointerEnd(e,true));
      el.addEventListener('wheel',e=>this.wheel(e),{passive:false});
      el.addEventListener('keydown',e=>this.keydown(e));
      this.initBasemap();
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
      this.syncBasemap();
    }
    basemapStyle(){return `https://tiles.openfreemap.org/styles/${this.appearance.matches?'dark':'positron'}`;}
    initBasemap(){
      if(!this.networkAllowed)return;
      this.options.onTileStatus('loading');
      if(!this.appearance){
        this.appearance=window.matchMedia('(prefers-color-scheme: dark)');
        this.appearance.addEventListener('change',()=>{if(this.basemap)this.basemap.setStyle(this.basemapStyle());});
      }
      try{
        this.basemap=new window.maplibregl.Map({
          container:this.tileRoot,style:this.basemapStyle(),
          center:[this.center.lng,this.center.lat],zoom:this.zoom-1,
          interactive:false,attributionControl:false,renderWorldCopies:true,
          // Our editor uses 256px worlds, MapLibre uses 512px worlds.
          // Avoid the renderer independently shifting the center near the poles.
          transformConstrain:(lngLat,zoom)=>({center:lngLat,zoom}),
          minZoom:0,maxZoom:22,fadeDuration:0,trackResize:false,
          canvasContextAttributes:{antialias:true}
        });
        this.basemap.on('style.load',()=>{
          if(this.appearance.matches){
            for(const layer of this.basemap.getStyle().layers){
              if(layer.type==='background')this.basemap.setPaintProperty(layer.id,'background-color','#20262d');
              if(layer.type==='symbol'&&layer.layout?.['text-field']){
                this.basemap.setPaintProperty(layer.id,'text-color','#b6c2ce');
                this.basemap.setPaintProperty(layer.id,'text-halo-color','#18212b');
              }
              if(layer.type==='fill'&&layer['source-layer']==='water')this.basemap.setPaintProperty(layer.id,'fill-color','#193344');
              if(layer.type==='fill'&&layer['source-layer']==='park')this.basemap.setPaintProperty(layer.id,'fill-color','#293d35');
            }
          }else{
            for(const [layer,color] of Object.entries({water:'#cfe3ef',park:'#e4eddd',landcover_wood:'#dbe7d4',building:'#e8e6e1'})){
              if(this.basemap.getLayer(layer))this.basemap.setPaintProperty(layer,'fill-color',color);
            }
          }
        });
        this.basemap.on('error',()=>this.options.onTileStatus('error'));
        this.basemap.on('idle',()=>this.options.onTileStatus('ready'));
        this.basemap.getCanvas().setAttribute('tabindex','-1');
      }catch(error){this.options.onTileStatus('error');}
    }
    syncBasemap(){
      if(!this.basemap)return;
      if(this.basemapWidth!==this.width||this.basemapHeight!==this.height){
        this.basemap.resize();this.basemapWidth=this.width;this.basemapHeight=this.height;
      }
      this.basemap.jumpTo({center:[this.center.lng,this.center.lat],zoom:this.zoom-1,bearing:0,pitch:0});
    }
    retryTiles(){
      if(this.basemap){this.basemap.remove();this.basemap=null;}
      this.tileRoot.replaceChildren();this.initBasemap();this.scheduleRender();
    }
  }
  window.ConstellationMap=ConstellationMap;
})();
