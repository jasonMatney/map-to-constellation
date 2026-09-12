/* Build the self-contained HTML edition. Bundles the pinned renderer and worker without runtime CDN scripts. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const esbuild=require('esbuild');
const bundle=file=>esbuild.buildSync({entryPoints:[path.join(__dirname,file)],bundle:true,write:false,format:'iife',minify:true,legalComments:'inline',define:{'import.meta.url':JSON.stringify('https://unused.invalid/maplibre.mjs')},...(file.endsWith('maplibre-gl.mjs')?{globalName:'maplibregl'}:{})}).outputFiles[0].text;
const worker=bundle('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
const runtime='/*! '+fs.readFileSync(path.join(__dirname,'node_modules/maplibre-gl/LICENSE.txt'),'utf8')+' */\n'+bundle('node_modules/maplibre-gl/dist/maplibre-gl.mjs')+'\nmaplibregl.setWorkerUrl(URL.createObjectURL(new Blob(['+JSON.stringify(worker)+'],{type:"text/javascript"})));';
fs.writeFileSync(path.join(__dirname,'src/basemap-runtime.js'),runtime);
html=html.replace('<link rel="stylesheet" href="node_modules/maplibre-gl/dist/maplibre-gl.css">',()=>'<style>\n'+fs.readFileSync(path.join(__dirname,'node_modules/maplibre-gl/dist/maplibre-gl.css'),'utf8')+'\n</style>');
html=html.replace('<script src="src/basemap-runtime.js"></script>',()=>'<script>\n'+runtime.replace(/<\/script/gi,'<\\/script')+'\n</script>');
html=html.replace('<link rel="stylesheet" href="src/styles.css">',()=>'<style>\n'+fs.readFileSync(path.join(__dirname,'src/styles.css'),'utf8')+'\n</style>');
for(const name of ['core','map','app'])html=html.replace(`<script src="src/${name}.js"></script>`,()=>'<script>\n'+fs.readFileSync(path.join(__dirname,`src/${name}.js`),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>');
fs.writeFileSync(path.join(__dirname,'Map-to-Constellation.html'),html);
const output=path.join(__dirname,'dist');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),html);
console.log('Built Map-to-Constellation.html ('+Buffer.byteLength(html).toLocaleString()+' bytes)');
