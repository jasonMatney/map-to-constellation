/* Map-to-Constellation — projection, geometry, validation, and export.
 * No DOM or third-party dependencies. Shared unchanged by map and exporter.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConstellationCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_LAT = 85.0511287798066;
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon'];
  const LIMIT = 2000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (v, n) => ((v % n) + n) % n;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function finite(v, field) { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} must be a finite number.`); return v; }
  function ranged(v, a, b, field) { finite(v, field); if (v < a || v > b) throw new Error(`${field} must be between ${a} and ${b}.`); return v; }
  function normalizeLongitude(lng) { return mod(lng + 180, 360) - 180; }
  function worldSize(zoom) { return 256 * 2 ** zoom; }
  /** Unwrapped x is intentional: never relocate individual points at the dateline. */
  function project(lat, lng, zoom, world = 0) {
    finite(lat, 'Latitude'); finite(lng, 'Longitude'); finite(zoom, 'Zoom');
    const s = worldSize(zoom), phi = clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180;
    return {x: (lng + 360 * world + 180) / 360 * s,
      y: (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * s};
  }
  function unproject(x, y, zoom) {
    const s = worldSize(zoom);
    return {lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / s))) * 180 / Math.PI, lng: x / s * 360 - 180};
  }
  /** Keep canonical longitude + a separately persisted world-copy index. */
  function coordinateAt(lat, unwrappedLng) {
    ranged(lat, -MAX_LAT, MAX_LAT, 'Latitude'); finite(unwrappedLng, 'Longitude');
    const lng = normalizeLongitude(unwrappedLng);
    const world = Math.round((unwrappedLng - lng) / 360);
    if (Math.abs(world) > 1024) throw new Error('This world copy is outside the supported map range.');
    return {lat, lng, world};
  }
  function nearestCoordinate(lat, lng, referenceLng) {
    ranged(lng, -180, 180, 'Longitude');
    return coordinateAt(lat, lng + 360 * Math.round((referenceLng - lng) / 360));
  }
  function geometry(shape, size) {
    if (!SHAPES.includes(shape)) throw new Error('Unknown shape.');
    finite(size, 'Size'); if (size <= 0) throw new Error('Size must be positive.');
    const r = size / 2;
    if (shape === 'circle') return {type:'circle', r, minX:-r, minY:-r, maxX:r, maxY:r};
    let vertices;
    if (shape === 'square') vertices = [[-r,-r],[r,-r],[r,r],[-r,r]];
    if (shape === 'triangle') { const h = size * Math.sqrt(3) / 2; vertices = [[0,-h * 2/3],[r,h/3],[-r,h/3]]; }
    if (shape === 'diamond') vertices = [[0,-r],[r,0],[0,r],[-r,0]];
    if (shape === 'star' || shape === 'hexagon') {
      const n = shape === 'star' ? 10 : 6;
      vertices = Array.from({length:n}, (_, i) => { const a = -Math.PI/2 + i * Math.PI*2/n, rad = shape==='star' && i%2 ? r*.44 : r; return [Math.cos(a)*rad, Math.sin(a)*rad]; });
    }
    return {type:'polygon', vertices, minX:Math.min(...vertices.map(p=>p[0])), maxX:Math.max(...vertices.map(p=>p[0])), minY:Math.min(...vertices.map(p=>p[1])), maxY:Math.max(...vertices.map(p=>p[1]))};
  }
  // 9 decimal places retains subpixel layout precision without enormous XML strings.
  const number = n => Number(n.toFixed(9)).toString();
  function shapeMarkup(point) {
    if (!/^#[0-9a-f]{6}$/i.test(point.color)) throw new Error('Invalid point color.');
    const g = geometry(point.shape, point.size);
    if (g.type === 'circle') return `<circle cx="0" cy="0" r="${number(g.r)}" fill="${point.color}"/>`;
    return `<polygon points="${g.vertices.map(p=>p.map(number).join(',')).join(' ')}" fill="${point.color}"/>`;
  }
  function projectPoints(points, zoom) { return points.map(p => ({...p, ...project(p.lat, p.lng, zoom, p.world || 0)})); }
  /** A translation ONLY. No per-point rounding, fitting, recentering, or rescaling. */
  function cropScene(projected, padding = 1) {
    if (!projected.length) return null;
    ranged(padding, 0, 100, 'Padding');
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of projected) {
      finite(p.x,'Point x'); finite(p.y,'Point y');
      const g = geometry(p.shape,p.size);
      minX=Math.min(minX,p.x+g.minX); minY=Math.min(minY,p.y+g.minY);
      maxX=Math.max(maxX,p.x+g.maxX); maxY=Math.max(maxY,p.y+g.maxY);
    }
    const left = Math.floor(minX)-padding, top = Math.floor(minY)-padding;
    const right = Math.ceil(maxX)+padding, bottom = Math.ceil(maxY)+padding;
    return {left,top,width:right-left,height:bottom-top,
      points:projected.map(p=>({...p,x:p.x-left,y:p.y-top})),
      originalBounds:{minX,minY,maxX,maxY}};
  }
  function buildScene(points, zoom) { return cropScene(projectPoints(points, zoom)); }
  function toSVG(scene) {
    if (!scene || !scene.points.length) throw new Error('Add at least one point before exporting.');
    // Intentionally omit original coordinates, names, map tiles, labels, and metadata.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" preserveAspectRatio="xMidYMid meet">\n${scene.points.map(p=>`  <g transform="translate(${number(p.x)} ${number(p.y)})">${shapeMarkup(p)}</g>`).join('\n')}\n</svg>`;
  }
  function pngAllowed(scene) { return !!scene && scene.width <= 8192 && scene.height <= 8192 && scene.width * scene.height <= 16777216; }
  function validateStyle(s) {
    if (!s || typeof s !== 'object' || !SHAPES.includes(s.shape)) throw new Error('Unsupported icon shape.');
    if (typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error('Color must be a six-digit hex color.');
    return {shape:s.shape,color:s.color.toUpperCase(),size:ranged(s.size,6,80,'Icon size')};
  }
  function validateProject(data) {
    if (!data || data.app !== 'map-to-constellation' || data.version !== 1) throw new Error('This is not a supported Map-to-Constellation project.');
    if (typeof data.name !== 'string' || data.name.length > 80) throw new Error('Project name must be 80 characters or fewer.');
    if (!Array.isArray(data.points) || data.points.length > LIMIT) throw new Error(`Projects support up to ${LIMIT} points.`);
    const ids = new Set();
    const points = data.points.map((p,i)=> {
      if (!p || typeof p !== 'object') throw new Error(`Point ${i+1} is invalid.`);
      if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)) throw new Error(`Point ${i+1} needs a unique valid ID.`);
      ids.add(p.id);
      if (typeof p.name !== 'string' || p.name.length>80) throw new Error(`Point ${i+1} name is too long.`);
      const world=p.world===undefined?0:p.world;
      if (!Number.isInteger(world) || Math.abs(world)>1024) throw new Error('Invalid world-copy index.');
      return {id:p.id,name:p.name,lat:ranged(p.lat,-MAX_LAT,MAX_LAT,'Latitude'),lng:ranged(p.lng,-180,180,'Longitude'),world,...validateStyle(p)};
    });
    if (!data.view || !data.view.center) throw new Error('Project map view is missing.');
    const view={center:{lat:ranged(data.view.center.lat,-MAX_LAT,MAX_LAT,'Map latitude'),lng:ranged(data.view.center.lng,-368820,368820,'Map longitude')},zoom:ranged(data.view.zoom,2,19,'Zoom'),locked:data.view.locked===true};
    return {app:'map-to-constellation',version:1,name:data.name||'Untitled constellation',points,view,defaults:validateStyle(data.defaults)};
  }
  function emptyProject() { return {app:'map-to-constellation',version:1,name:'Untitled constellation',points:[],view:{center:{lat:38.8977,lng:-77.0365},zoom:13,locked:false},defaults:{shape:'circle',color:'#C2714F',size:20}}; }
  return {MAX_LAT,SHAPES,LIMIT,clamp,mod,escape,worldSize,normalizeLongitude,project,unproject,coordinateAt,nearestCoordinate,geometry,number,shapeMarkup,projectPoints,cropScene,buildScene,toSVG,pngAllowed,validateProject,emptyProject};
});
