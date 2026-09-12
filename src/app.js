(function () {
  'use strict';
  const C=window.ConstellationCore, $=id=>document.getElementById(id);
  const STORAGE_KEY='map-to-constellation.project.v1';
  const PALETTE=['#C2714F','#D4AC60','#839776','#6D95A8','#A296B6','#465C52'];
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const clone=value=>JSON.parse(JSON.stringify(value));
  let storageBlocked=false,storageMessage='',state=loadLocal(),selected=null,map=null;
  let undoStack=[],redoStack=[],currentScene=null,cachedProjected=[],sceneDirty=true,lastSceneZoom=null;
  let saveTimer=0,toastTimer=0,busyPNG=false,styleBefore=null,pendingConfirm=null,lastSearch=0;
  let searchController=null,searchGeneration=0,lastNetworkStatus='loading';

  function loadLocal(){
    try {const raw=localStorage.getItem(STORAGE_KEY);if(raw)return C.validateProject(JSON.parse(raw));}
    catch(error){storageBlocked=true;storageMessage='Local saving is unavailable, or the saved project could not be read. Existing data has not been overwritten. Save a JSON backup of your work. Open a valid backup or start a new project to retry local saving.';}
    return C.emptyProject();
  }
  function toast(message,error=false){clearTimeout(toastTimer);$('toast-container').innerHTML=`<div class="toast${error?' error':''}">${C.escape(message)}</div>`;toastTimer=setTimeout(()=>{$('toast-container').replaceChildren();},error?7500:4000);}
  function saveStatus(text,warning=false){$('save-status').classList.toggle('unsaved',warning);$('save-status').innerHTML=`<span></span>${C.escape(text)}`;}
  function showStorageNotice(){ $('storage-notice').hidden=!storageBlocked;$('storage-notice').textContent=storageMessage; }
  function persistNow(){
    clearTimeout(saveTimer);if(map)state.view=map.getView();
    if(storageBlocked){saveStatus('Backup recommended',true);return;}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));saveStatus('Saved on this device');}
    catch(error){storageBlocked=true;storageMessage='This browser could not save the project. Your current points are still here. Use Project → Save project backup to keep them.';showStorageNotice();saveStatus('Not saved — export backup',true);}
  }
  function persist(){clearTimeout(saveTimer);if(!storageBlocked)saveStatus('Saving…');saveTimer=setTimeout(persistNow,220);}
  function snapshot(){if(map)state.view=map.getView();return JSON.stringify(state);}
  function commitBefore(before){if(before!==snapshot()){undoStack.push(before);if(undoStack.length>60)undoStack.shift();redoStack=[];}sceneDirty=true;renderAll();persist();}
  function change(fn){finishStyleGesture();const before=snapshot();fn();commitBefore(before);}
  function finishStyleGesture(){if(styleBefore!==null){const before=styleBefore;styleBefore=null;commitBefore(before);}}
  function currentPoint(){return state.points.find(p=>p.id===selected)||null;}
  function currentStyle(){return currentPoint()||state.defaults;}
  function styleOnly(p){return {shape:p.shape,color:p.color,size:p.size};}
  function setStyle(key,value){change(()=>{currentStyle()[key]=value;});}
  function previewStyle(key,value){if(styleBefore===null)styleBefore=snapshot();currentStyle()[key]=value;sceneDirty=true;renderAll();persist();}
  function setIfInactive(id,value){if(document.activeElement!==$(id))$(id).value=value;}
  function id(){return 'p_'+(globalThis.crypto?.randomUUID?crypto.randomUUID().replace(/-/g,''):Date.now().toString(36)+Math.random().toString(36).slice(2));}
  function addPoint(ll){
    try {
      if(state.points.length>=C.LIMIT)throw new Error(`This project has reached the ${C.LIMIT.toLocaleString()} point limit.`);
      const coords=C.coordinateAt(ll.lat,ll.lng),style=styleOnly(currentStyle()),newId=id();
      change(()=>{state.defaults=style;state.points.push({id:newId,name:`Point ${nextNumber()}`,...coords,...style});selected=newId;});
    } catch(error){toast(error.message,true);}
  }
  function nextNumber(){let n=state.points.length+1;const names=new Set(state.points.map(p=>p.name));while(names.has(`Point ${n}`))n++;return n;}
  function selectPoint(pointId){finishStyleGesture();selected=pointId;renderAll();}
  function deleteSelected(){if(!selected)return;change(()=>{state.points=state.points.filter(p=>p.id!==selected);selected=null;});toast('Point removed. Undo brings it back.');}
  function setMode(mode){map.setMode(mode);for(const key of ['plot','pan']){$(`mode-${key}`).classList.toggle('active',key===mode);$(`mode-${key}`).setAttribute('aria-pressed',String(key===mode));} }

  function renderStyle(){
    const style=currentStyle(),point=currentPoint();
    $('editing-caption').textContent=point?`Editing ${point.name||'this point'}`:'Style for new points';
    $('editing-caption').parentElement.classList.toggle('is-editing',!!point);$('deselect').hidden=!point;
    for(const b of document.querySelectorAll('[data-shape]')){const active=b.dataset.shape===style.shape;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
    for(const b of document.querySelectorAll('[data-color]')){const active=b.dataset.color===style.color.toUpperCase();b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
    setIfInactive('color-picker',style.color);setIfInactive('hex-color',style.color.toUpperCase());setIfInactive('icon-size',style.size);$('size-output').textContent=`${style.size} px`;
    $('selected-editor').hidden=!point;
    if(point){setIfInactive('point-name',point.name);setIfInactive('edit-lat',String(point.lat));setIfInactive('edit-lng',String(point.lng));}
  }
  function renderList(){
    const focusedId=$('point-list').contains(document.activeElement)?document.activeElement.dataset.listId:null;
    $('point-count').textContent=state.points.length;$('empty-list').hidden=state.points.length>0;$('clear-points').disabled=!state.points.length;$('fit-points').disabled=!state.points.length;
    $('point-list').innerHTML=state.points.map((p,i)=>`<button class="point-row${p.id===selected?' selected':''}" data-list-id="${C.escape(p.id)}" aria-pressed="${p.id===selected}" title="Select ${C.escape(p.name)}"><svg aria-hidden="true" viewBox="-14 -14 28 28">${C.shapeMarkup({...p,size:14})}</svg><span><strong>${C.escape(p.name||'Unnamed point')}</strong><small>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</small></span><span class="row-index">${String(i+1).padStart(2,'0')}</span></button>`).join('');
    $('empty-map-hint').hidden=state.points.length>0;$('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
    if(focusedId){const row=[...$('point-list').children].find(el=>el.dataset.listId===focusedId);if(row)row.focus({preventScroll:true});else $('map').focus({preventScroll:true});}
  }
  function renderMapPoints(m){
    if(sceneDirty||lastSceneZoom!==m.zoom){cachedProjected=C.projectPoints(state.points,m.zoom);currentScene=C.cropScene(cachedProjected);lastSceneZoom=m.zoom;sceneDirty=false;renderPreview();}
    let visible=0;const markup=[];
    for(const p of cachedProjected){const x=p.x-m.origin.x,y=p.y-m.origin.y,r=Math.max(p.size,20);
      if(x+r<0||y+r<0||x-r>m.width||y-r>m.height)continue;visible++;
      markup.push(`<g class="point-group" data-point-id="${C.escape(p.id)}" transform="translate(${C.number(x)} ${C.number(y)})" role="button" tabindex="0" aria-label="Select ${C.escape(p.name)}"><title>${C.escape(p.name)}</title><circle class="point-hit" r="${Math.max(13,p.size*.75)}"/>${selected===p.id?`<circle class="selection-ring" r="${p.size*.72+5}"/>`:''}<g class="point-art">${C.shapeMarkup(p)}</g></g>`);
    }
    const focusedId=m.svg.contains(document.activeElement)?document.activeElement.dataset.pointId:null;
    m.svg.innerHTML=markup.join('');
    if(focusedId){const point=[...m.svg.children].find(el=>el.dataset.pointId===focusedId);(point||m.el).focus({preventScroll:true});}
    const hidden=state.points.length-visible;renderExportWarning(hidden);renderZoom(m);
  }
  function renderPreview(){
    $('preview-empty').hidden=!!currentScene;
    if(currentScene){$('preview-art').innerHTML=C.toSVG(currentScene);const svg=$('preview-art').querySelector('svg');svg.setAttribute('style','width:100%;height:100%');svg.setAttribute('aria-label','Constellation export preview');
      $('export-count').textContent=String(state.points.length);$('export-dimensions').textContent=`${currentScene.width.toLocaleString()} × ${currentScene.height.toLocaleString()} px`;
    }else{$('preview-art').replaceChildren();$('export-count').textContent='—';$('export-dimensions').textContent='—';}
    $('export-svg').disabled=!currentScene;$('export-png').disabled=!C.pngAllowed(currentScene)||busyPNG;
    $('export-png').title=currentScene&&!C.pngAllowed(currentScene)?'This pattern exceeds the safe PNG canvas limit. Export SVG instead.':'Export at the current map spacing';
  }
  function renderExportWarning(offscreen){
    let text='';
    if(currentScene&&!C.pngAllowed(currentScene))text='This pattern exceeds the safe PNG limit. SVG is still available at the exact same spacing. No automatic resizing has been applied.';
    else if(offscreen>0)text=`${offscreen} point${offscreen===1?' is':'s are'} outside the visible map. Exports include all ${state.points.length} points, at the current scale.`;
    $('export-warning').hidden=!text;$('export-warning').textContent=text;
  }
  function renderZoom(m){$('zoom-label').textContent=`Zoom ${Number(m.zoom.toFixed(2))} · ${m.locked?'Scale locked':'Scale unlocked'}`;$('zoom-in').disabled=m.locked||m.zoom>=19;$('zoom-out').disabled=m.locked||m.zoom<=2;$('lock-zoom').classList.toggle('active',m.locked);$('lock-zoom').setAttribute('aria-pressed',String(m.locked));$('lock-zoom').setAttribute('aria-label',m.locked?'Unlock map zoom':'Lock map zoom');$('lock-zoom').title=m.locked?'Unlock map zoom':'Lock map zoom to hold spacing';$('lock-zoom').innerHTML=icon(m.locked?'lock':'unlock');}
  function renderAll(){renderStyle();renderList();setIfInactive('project-name',state.name);if(map)map.scheduleRender();}

  function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function filename(){return state.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'constellation';}
  function exportSVG(){try{const scene=C.buildScene(state.points,map.zoom);download(new Blob([C.toSVG(scene)],{type:'image/svg+xml;charset=utf-8'}),`${filename()}.svg`);toast('SVG exported. Spacing preserved; map left behind.');}catch(error){toast(error.message,true);}}
  async function exportPNG(){
    if(busyPNG)return;let imageURL=null;
    try{
      finishStyleGesture();const scene=C.buildScene(state.points,map.zoom);if(!scene)throw new Error('Add a point first.');if(!C.pngAllowed(scene))throw new Error('The pattern is too large for a safe PNG. Export SVG at the same spacing.');
      const file=filename();busyPNG=true;$('export-png').disabled=true;$('export-png').querySelector('span').textContent='Preparing PNG…';
      imageURL=URL.createObjectURL(new Blob([C.toSVG(scene)],{type:'image/svg+xml;charset=utf-8'}));
      const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The browser could not render this SVG for PNG export.'));img.src=imageURL;});
      const canvas=document.createElement('canvas');canvas.width=scene.width;canvas.height=scene.height;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This browser could not allocate an image canvas. Export SVG instead.');
      // No map screenshot, devicePixelRatio, background, fitting, or scale transform.
      ctx.drawImage(image,0,0);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG creation failed. Try the SVG export instead.')),'image/png'));
      download(blob,`${file}.png`);canvas.width=canvas.height=1;toast(`PNG exported at ${scene.width} × ${scene.height} px. Transparent and precisely spaced.`);
    }catch(error){toast(error.message,true);}finally{if(imageURL)URL.revokeObjectURL(imageURL);busyPNG=false;$('export-png').querySelector('span').textContent='Export PNG';renderPreview();}
  }
  function saveBackup(){finishStyleGesture();if(map)state.view=map.getView();download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),`${filename()}.constellation.json`);toast('Editable project saved, including coordinates and map scale.');}
  function closeMenu(){ $('project-menu').hidden=true;$('project-button').setAttribute('aria-expanded','false'); }
  function ask(title,message,action,button='Continue'){$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-ok').textContent=button;pendingConfirm=action;$('confirm-dialog').showModal();$('confirm-cancel').focus();}
  function confirmReplacement(action,title='Replace this constellation?'){if(state.points.length)ask(title,'Save a project backup first to keep this version. This will replace the current project; Undo is also available.',action,'Replace project');else action();}
  function replaceProject(project){
    finishStyleGesture();const before=snapshot();state=C.validateProject(project);selected=null;storageBlocked=false;storageMessage='';showStorageNotice();$('search-input').value='';$('search-results').hidden=true;
    const v=clone(state.view);map.setView(v.center,v.zoom,true);map.setLocked(v.locked);setMode('plot');
    commitBefore(before);persistNow();
  }
  function demoProject(){
    const d=C.emptyProject();d.name='A few favorite places';d.view={center:{lat:38.9015,lng:-77.0395},zoom:14,locked:false};
    const places=[['Morning walk',38.9148,-77.0572,'circle','#C2714F',20],['A favorite corner',38.9193,-77.0381,'star','#D4AC60',25],['Somewhere special',38.9025,-77.0441,'diamond','#A296B6',22],['A good memory',38.8977,-77.0325,'circle','#6D95A8',17],['By the water',38.8894,-77.0496,'triangle','#839776',24],['Meet me here',38.8908,-77.0212,'square','#C2714F',16],['A little detour',38.8829,-77.0353,'hexagon','#465C52',22]];
    d.points=places.map((p,i)=>({id:`example_${i+1}`,name:p[0],lat:p[1],lng:p[2],world:0,shape:p[3],color:p[4],size:p[5]}));return d;
  }
  function loadDemo(){confirmReplacement(()=>{replaceProject(demoProject());map.fit(state.points);toast('An example pattern to explore. Every point is editable.');});}
  function undo(){finishStyleGesture();if(!undoStack.length)return;redoStack.push(snapshot());restoreHistory(undoStack.pop());}
  function redo(){finishStyleGesture();if(!redoStack.length)return;undoStack.push(snapshot());restoreHistory(redoStack.pop());}
  function restoreHistory(raw){state=C.validateProject(JSON.parse(raw));if(!state.points.some(p=>p.id===selected))selected=null;const v=clone(state.view);map.setView(v.center,v.zoom,true);map.setLocked(v.locked);sceneDirty=true;renderAll();persist();}
  async function openFile(file){
    if(!file)return;
    try{if(file.size>2*1024*1024)throw new Error('Project files must be smaller than 2 MB.');const clean=C.validateProject(JSON.parse(await file.text()));confirmReplacement(()=>{replaceProject(clean);toast(`Opened “${clean.name}”.`);});}
    catch(error){toast(`Could not open project: ${error.message}`,true);}finally{$('file-input').value='';}
  }

  function tileStatus(status){
    lastNetworkStatus=status;const el=$('map-status');
    if(status==='ready'){el.hidden=true;return;}
    if(status==='loading'){el.textContent='Loading basemap…';el.hidden=false;return;}
    if(status==='local'){el.textContent='Local file mode: plotting, editing, and exports work. To load the live map and place search, run Start.command, Start.bat, or start.py from the app folder.';el.hidden=false;return;}
    el.innerHTML=`${status==='slow'?'The map is taking longer to load.':'Map tiles could not load.'} Your points and exports still work. Check your internet connection.<button id="retry-map">Retry</button>`;el.hidden=false;
    $('retry-map').onclick=()=>{el.hidden=true;map.retryTiles();};
  }
  function searchMessage(text){$('search-results').hidden=false;$('search-results').innerHTML=`<p>${C.escape(text)}</p>`;}
  async function search(event){
    event.preventDefault();const query=$('search-input').value.trim();if(!query)return;
    const coords=query.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
    if(coords){try{const ll=C.nearestCoordinate(Number(coords[1]),Number(coords[2]),map.center.lng);map.setView({lat:ll.lat,lng:ll.lng+360*ll.world},Math.max(14,map.zoom));$('search-results').hidden=true;toast('Map centered. Click to plot, or use exact coordinate entry.');}catch(error){searchMessage(error.message);}return;}
    if(!map.networkAllowed){searchMessage('Place search needs the app opened through localhost or HTTPS. Coordinate searches still work in local file mode.');return;}
    if(Date.now()-lastSearch<1100){searchMessage('Please wait a moment before submitting another search.');return;}
    lastSearch=Date.now();if(searchController)searchController.abort();searchController=new AbortController();const token=++searchGeneration;
    const timer=setTimeout(()=>searchController?.abort(),12000);$('search-submit').disabled=true;searchMessage('Looking for that place…');
    try{
      const url=new URL('https://nominatim.openstreetmap.org/search');url.searchParams.set('q',query);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');
      const response=await fetch(url,{signal:searchController.signal,headers:{Accept:'application/json'},referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok)throw new Error(response.status===429?'Place search is temporarily rate-limited. Try coordinates or try again later.':'Place search is unavailable right now. You can still navigate the map or enter coordinates.');
      const results=await response.json();if(token!==searchGeneration)return;
      if(!Array.isArray(results)||!results.length){searchMessage('No places found. Try a city, a more specific address, or latitude, longitude.');return;}
      const clean=results.filter(r=>Number.isFinite(Number(r.lat))&&Number.isFinite(Number(r.lon))&&Math.abs(Number(r.lat))<=C.MAX_LAT&&Math.abs(Number(r.lon))<=180);
      $('search-results').replaceChildren();$('search-results').hidden=false;
      for(const r of clean){const button=document.createElement('button');button.type='button';button.textContent=r.display_name||'Unnamed place';button.onclick=()=>{const ll=C.nearestCoordinate(Number(r.lat),Number(r.lon),map.center.lng);map.setView({lat:ll.lat,lng:ll.lng+360*ll.world},14);$('search-input').value=String(r.display_name||query).slice(0,180);$('search-results').hidden=true;};$('search-results').append(button);}
      const credit=document.createElement('p');credit.className='search-credit';credit.textContent='Search by Nominatim · © OpenStreetMap contributors';$('search-results').append(credit);
    }catch(error){if(token===searchGeneration)searchMessage(error.name==='AbortError'?'Place search timed out. Try again, or navigate with coordinates.':error.message);}
    finally{clearTimeout(timer);if(token===searchGeneration)$('search-submit').disabled=false;}
  }

  // Build controls from the same shape definitions as both renderers.
  $('shape-options').innerHTML=C.SHAPES.map(shape=>`<button type="button" class="shape-option" data-shape="${shape}" aria-pressed="false" aria-label="${shape[0].toUpperCase()+shape.slice(1)} icon"><svg aria-hidden="true" viewBox="-12 -12 24 24">${C.shapeMarkup({shape,size:17,color:'#6D7E65'}).replace(/fill="#[A-Fa-f0-9]{6}"/,'fill="currentColor"')}</svg><span>${shape[0].toUpperCase()+shape.slice(1)}</span></button>`).join('');
  $('swatches').innerHTML=PALETTE.map(color=>`<button type="button" class="swatch" data-color="${color}" style="background:${color};color:${color}" aria-pressed="false" aria-label="Set color ${color}" title="${color}"></button>`).join('');
  showStorageNotice();
  map=new window.ConstellationMap($('map'),{
    view:state.view,onAdd:addPoint,onSelect:selectPoint,onRender:renderMapPoints,onTileStatus:tileStatus,
    onViewChange:view=>{state.view=view;persist();},
    onPointer:ll=>{$('cursor-coordinates').textContent=`${ll.lat.toFixed(5)}, ${C.normalizeLongitude(ll.lng).toFixed(5)}`;}
  });
  setTimeout(()=>{if(lastNetworkStatus==='loading')tileStatus('slow');},9000);
  setMode('plot');renderAll();persist();

  $('shape-options').addEventListener('click',e=>{const button=e.target.closest('[data-shape]');if(button)setStyle('shape',button.dataset.shape);});
  $('swatches').addEventListener('click',e=>{const button=e.target.closest('[data-color]');if(button)setStyle('color',button.dataset.color);});
  $('color-picker').addEventListener('input',e=>previewStyle('color',e.target.value.toUpperCase()));$('color-picker').addEventListener('change',finishStyleGesture);
  $('hex-color').addEventListener('change',e=>{const color=e.target.value.trim().toUpperCase();if(!/^#[0-9A-F]{6}$/.test(color)){e.target.setAttribute('aria-invalid','true');toast('Use a six-digit color such as #C2714F.',true);return;}e.target.removeAttribute('aria-invalid');setStyle('color',color);});
  $('icon-size').addEventListener('input',e=>previewStyle('size',Number(e.target.value)));$('icon-size').addEventListener('change',finishStyleGesture);
  $('deselect').onclick=()=>selectPoint(null);
  $('point-name').addEventListener('change',e=>{if(currentPoint())change(()=>{currentPoint().name=e.target.value.trim().slice(0,80)||'Unnamed point';});});
  $('project-name').addEventListener('change',e=>change(()=>{state.name=e.target.value.trim().slice(0,80)||'Untitled constellation';}));
  $('delete-point').onclick=deleteSelected;
  $('apply-coordinates').onclick=()=>{
    const p=currentPoint();if(!p)return;
    try{if(!$('edit-lat').value.trim()||!$('edit-lng').value.trim())throw new Error('Enter both latitude and longitude.');const ll=C.nearestCoordinate(Number($('edit-lat').value),Number($('edit-lng').value),p.lng+360*p.world);change(()=>Object.assign(p,ll));toast('Point location updated.');}catch(error){toast(error.message,true);}
  };
  $('coordinate-form').onsubmit=e=>{e.preventDefault();try{const ll=C.nearestCoordinate(Number($('add-lat').value),Number($('add-lng').value),map.center.lng);addPoint({lat:ll.lat,lng:ll.lng+360*ll.world});map.setView({lat:ll.lat,lng:ll.lng+360*ll.world});}catch(error){toast(error.message,true);}};
  $('point-list').onclick=e=>{const b=e.target.closest('[data-list-id]');if(b)selectPoint(b.dataset.listId);};
  $('map').querySelector('.point-layer').addEventListener('keydown',e=>{const g=e.target.closest('[data-point-id]');if(g&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();selectPoint(g.dataset.pointId);}});
  $('mode-plot').onclick=()=>setMode('plot');$('mode-pan').onclick=()=>setMode('pan');
  $('zoom-in').onclick=()=>map.zoomBy(1);$('zoom-out').onclick=()=>map.zoomBy(-1);
  $('fit-points').onclick=()=>{map.fit(state.points);if(map.locked)toast('Centered on your points. Zoom stays locked.');};
  $('lock-zoom').onclick=()=>{map.setLocked(!map.locked);renderZoom(map);toast(map.locked?'Map scale locked. Pan freely; spacing will not change.':'Map scale unlocked. Zoom changes point spacing on the map.');};
  for(const kind of ['map','satellite','pattern'])$(`view-${kind}`).onclick=()=>{
    $('map').classList.toggle('pattern-mode',kind==='pattern');
    if(kind!=='pattern')map.setBasemap(kind);
    $('map-attribution-vector').hidden=map.basemapKind==='satellite';
    $('map-attribution-satellite').hidden=map.basemapKind!=='satellite';
    for(const k of ['map','satellite','pattern']){$(`view-${k}`).classList.toggle('active',k===kind);$(`view-${k}`).setAttribute('aria-pressed',String(k===kind));}
  };
  $('undo').onclick=undo;$('redo').onclick=redo;
  $('clear-points').onclick=()=>ask('Clear all points?',`Remove all ${state.points.length} points from this project? Undo can restore them.`,()=>{change(()=>{state.points=[];selected=null;});},'Clear points');
  $('try-example').onclick=loadDemo;$('demo-project').onclick=()=>{closeMenu();loadDemo();};
  $('export-svg').onclick=exportSVG;$('export-png').onclick=exportPNG;
  for(const b of document.querySelectorAll('[data-preview]'))b.onclick=()=>{$('preview-stage').className=`preview-stage ${b.dataset.preview}`;for(const btn of document.querySelectorAll('[data-preview]')){btn.classList.toggle('active',btn===b);btn.setAttribute('aria-pressed',String(btn===b));}};
  $('project-button').onclick=()=>{const open=$('project-menu').hidden;$('project-menu').hidden=!open;$('project-button').setAttribute('aria-expanded',String(open));if(open)$('project-menu').querySelector('button').focus();};
  $('save-project').onclick=()=>{closeMenu();saveBackup();};$('save-backup-secondary').onclick=saveBackup;
  $('load-project').onclick=()=>{closeMenu();$('file-input').click();};$('file-input').onchange=e=>openFile(e.target.files[0]);
  $('new-project').onclick=()=>{closeMenu();confirmReplacement(()=>{replaceProject(C.emptyProject());toast('A fresh canvas for new places.');},'Start a new constellation?');};
  $('help-button').onclick=()=>{$('help-dialog').showModal();};for(const b of document.querySelectorAll('[data-close-dialog]'))b.onclick=()=>$('help-dialog').close();
  $('confirm-cancel').onclick=()=>{pendingConfirm=null;$('confirm-dialog').close();};$('confirm-dialog').addEventListener('cancel',()=>{pendingConfirm=null;});
  $('confirm-ok').onclick=()=>{const action=pendingConfirm;pendingConfirm=null;$('confirm-dialog').close();action?.();};
  $('search-form').onsubmit=search;
  $('locate-button').onclick=()=>{
    if(!navigator.geolocation){toast('Location is not available in this browser. Search or enter coordinates instead.',true);return;}
    toast('Requesting your location…');navigator.geolocation.getCurrentPosition(pos=>{try{const ll=C.nearestCoordinate(pos.coords.latitude,pos.coords.longitude,map.center.lng);map.setView({lat:ll.lat,lng:ll.lng+360*ll.world},15);toast('Map centered on your location. No point was added automatically.');}catch(error){toast(error.message,true);}},()=>toast('Location access was unavailable or declined. Search or enter coordinates instead.',true),{timeout:12000,maximumAge:60000});
  };
  document.addEventListener('click',e=>{if(!e.target.closest('#project-menu,#project-button'))closeMenu();if(!e.target.closest('.map-search'))$('search-results').hidden=true;});
  document.addEventListener('keydown',e=>{
    const input=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable;
    if(e.key==='Escape'){closeMenu();$('search-results').hidden=true;if(!document.querySelector('dialog[open]')&&!input)selectPoint(null);return;}
    if(input||document.querySelector('dialog[open]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='p')setMode('plot');if(e.key.toLowerCase()==='v')setMode('pan');
    if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();deleteSelected();}
  });
  window.addEventListener('beforeunload',persistNow);
  window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY&&e.newValue!==JSON.stringify(state)){storageBlocked=true;storageMessage='This project changed in another tab. Automatic saving is paused to avoid overwriting it. Save a backup of this tab, then reload to use the other version, or open your backup to keep this version.';showStorageNotice();saveStatus('Another tab changed this project',true);}});
  // Read-only diagnostics for reproducibility and automated geometry verification.
  window.MapToConstellation=Object.freeze({getProject:()=>clone({...state,view:map.getView()}),getExportScene:()=>clone(C.buildScene(state.points,map.zoom)),getScreenPoints:()=>state.points.map(p=>({id:p.id,...map.toScreen(p)}))});
})();
