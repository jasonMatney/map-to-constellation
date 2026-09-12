'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={window:{ConstellationCore:require('../src/core.js')}};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/map.js'),'utf8'),context);
function surface(){
  const map=Object.create(context.window.ConstellationMap.prototype);
  Object.assign(map,{center:{lat:38.9,lng:180.1},zoom:13.5,locked:true,appearance:{matches:false},options:{onTileStatus(){}},basemap:{setStyle(style){map.lastStyle=style;}}});
  return map;
}
test('satellite switching preserves view and zoom lock',()=>{
  const map=surface(),before=JSON.stringify(map.getView());map.setBasemap('satellite');
  assert.equal(JSON.stringify(map.getView()),before);
  assert.equal(map.lastStyle.sources.satellite.tileSize,256);
  assert.match(map.lastStyle.sources.satellite.tiles[0],/tile\/\{z\}\/\{y\}\/\{x\}$/);
  map.setBasemap('map');assert.match(map.lastStyle,/styles\/positron$/);
  assert.equal(JSON.stringify(map.getView()),before);
});
test('satellite imagery stays the same across appearance changes',()=>{
  const map=surface();map.setBasemap('satellite');const before=JSON.stringify(map.basemapStyle());
  map.appearance.matches=true;assert.equal(JSON.stringify(map.basemapStyle()),before);
  map.setBasemap('map');assert.match(map.lastStyle,/styles\/dark$/);
});
