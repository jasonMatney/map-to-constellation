/* Build the self-contained HTML edition. No downloads or build dependencies. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="src/styles.css">',()=>'<style>\n'+fs.readFileSync(path.join(__dirname,'src/styles.css'),'utf8')+'\n</style>');
for(const name of ['core','map','app'])html=html.replace(`<script src="src/${name}.js"></script>`,()=>'<script>\n'+fs.readFileSync(path.join(__dirname,`src/${name}.js`),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>');
fs.writeFileSync(path.join(__dirname,'Map-to-Constellation.html'),html);
const output=path.join(__dirname,'dist');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'index.html'),html);
console.log('Built Map-to-Constellation.html ('+Buffer.byteLength(html).toLocaleString()+' bytes)');
