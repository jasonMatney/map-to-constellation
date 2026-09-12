#!/usr/bin/env python3
"""Browser acceptance checks. Requires playwright and Pillow for developer QA only.
External tile and geocoder responses are deterministic test doubles, never live data.
The application itself has no Python or npm package dependencies.
"""
from __future__ import annotations
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'artifacts'
OUT.mkdir(exist_ok=True)
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

TEST_TILE='''<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0e6"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" fill="none" stroke="#dce2d3"/><text x="12" y="245" fill="#a4b29a" font-family="sans-serif" font-size="9">OFFLINE TEST TILE</text></svg>'''
results=[]
IN_MEMORY=os.environ.get('CONSTELLATION_IN_MEMORY')=='1'

def boot(page,base,storage=None,single=False):
    if not IN_MEMORY:
        page.goto((ROOT/'Map-to-Constellation.html').as_uri() if single else base,wait_until='networkidle')
        return
    page.goto('about:blank')
    page.evaluate('''seed => {
      const values = new Map(Object.entries(seed || {}));
      Object.defineProperty(window, 'localStorage', {configurable:true, value:{
        getItem(k){return values.has(String(k)) ? values.get(String(k)) : null},
        setItem(k,v){values.set(String(k),String(v))},
        removeItem(k){values.delete(String(k))},
        clear(){values.clear()},
        key(i){return [...values.keys()][i] || null},
        get length(){return values.size}
      }});
    }''',storage or {})
    page.set_content((ROOT/'Map-to-Constellation.html').read_text(),wait_until='load')
    page.wait_for_timeout(150)


def passed(name):
    results.append({'test':name,'result':'PASS'})
    print('PASS',name,flush=True)

def state(page): return page.evaluate('MapToConstellation.getProject()')
def scene(page): return page.evaluate('MapToConstellation.getExportScene()')
def wait(page): page.wait_for_timeout(100)
def near(a,b,tol=1e-6): assert abs(a-b)<tol, (a,b)
def upload(page, data):
    page.locator('#file-input').set_input_files({'name':'test.constellation.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
    page.wait_for_timeout(100)
    if page.locator('#confirm-dialog').is_visible(): page.locator('#confirm-ok').click()
    wait(page)

def point(i,lat=38.9,lng=-77.04,**kw):
    return dict(dict(id=f'test_{i}',name=f'Point {i}',lat=lat,lng=lng,world=0,shape='circle',color='#C2714F',size=20),**kw)

def run():
    handler=functools.partial(QuietHandler,directory=str(ROOT))
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f'http://localhost:{server.server_port}'
    try:
      with sync_playwright() as pw:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        opts={'headless':True,'args':['--no-sandbox']}
        if executable: opts['executable_path']=executable
        browser=pw.chromium.launch(**opts)
        context=browser.new_context(viewport={'width':1440,'height':1024},device_scale_factor=1,accept_downloads=True)
        context.route('https://tile.openstreetmap.org/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body=TEST_TILE))
        context.route('https://nominatim.openstreetmap.org/**',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps([{'lat':'40.7128','lon':'-74.0060','display_name':'Example search result <img src=x onerror=alert(1)>'}]),headers={'Access-Control-Allow-Origin':'*'}))
        page=context.new_page();page.set_default_timeout(6000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        boot(page,base)
        assert not errors,errors
        assert page.locator('#export-png').is_disabled() and page.locator('#export-svg').is_disabled()
        assert len(page.locator('[data-shape]').all())==6
        passed('Initial page loads without JavaScript errors; empty exports are disabled')
        page.screenshot(path=str(OUT/'desktop-empty.png'))

        box=page.locator('#map').bounding_box();x,y=230,190
        page.mouse.click(box['x']+x,box['y']+y);wait(page)
        assert len(state(page)['points'])==1
        screen=page.evaluate('MapToConstellation.getScreenPoints()')[0];near(screen['x'],x);near(screen['y'],y)
        passed('Click plotting round-trips to the exact clicked map pixel')
        page.locator('[data-shape="triangle"]').click();page.locator('#hex-color').fill('#17B3A9');page.locator('#hex-color').press('Tab')
        first=state(page)['points'][0];assert first['shape']=='triangle' and first['color']=='#17B3A9'
        page.locator('#point-name').fill('<img src=x onerror=alert(1)>');page.locator('#point-name').press('Tab');wait(page)
        assert page.locator('#point-list img').count()==0
        passed('Individual shape/color edits work; untrusted point names remain plain text')

        page.locator('#coordinate-details summary').click();page.locator('#add-lat').fill('38.908372');page.locator('#add-lng').fill('-77.020319');page.locator('#coordinate-form button').click();wait(page)
        pts=state(page)['points'];assert len(pts)==2;near(pts[1]['lat'],38.908372,1e-12);near(pts[1]['lng'],-77.020319,1e-12)
        page.locator('[data-shape="star"]').click();page.locator('#hex-color').fill('#AE75CC');page.locator('#hex-color').press('Tab')
        assert state(page)['points'][0]['shape']=='triangle' and state(page)['points'][1]['shape']=='star'
        passed('Exact coordinate entry retains precision and point styling is independent')
        page.locator('#icon-size').evaluate("el=>el.value='43'");page.locator('#icon-size').dispatch_event('input');page.locator('#icon-size').dispatch_event('change');wait(page)
        assert state(page)['points'][1]['size']==43
        page.locator('#edit-lat').fill('38.912345678');page.locator('#apply-coordinates').click();wait(page)
        near(state(page)['points'][1]['lat'],38.912345678,1e-12)
        passed('Size and explicit coordinate editing update the selected point')

        page.locator('#delete-point').click();wait(page);assert len(state(page)['points'])==1
        page.locator('#undo').click();wait(page);assert len(state(page)['points'])==2
        page.locator('#redo').click();wait(page);assert len(state(page)['points'])==1
        page.locator('#undo').click();wait(page)
        passed('Delete, undo, and redo restore exact point data')

        
        if page.locator('#deselect').is_visible():page.locator('#deselect').click()
        page.locator('#fit-points').click();wait(page)
        before=scene(page);page.locator('#lock-zoom').click();assert page.locator('#zoom-in').is_disabled()
        box=page.locator('#map').bounding_box()
        page.mouse.move(box['x']+120,box['y']+200);page.mouse.down();page.mouse.move(box['x']+192,box['y']+239,steps=6);page.mouse.up();wait(page)
        assert scene(page)==before
        zoom=state(page)['view']['zoom'];page.mouse.wheel(0,-400);wait(page);assert state(page)['view']['zoom']==zoom
        passed('Panning leaves exports byte-for-byte equivalent; zoom lock blocks wheel zoom')
        page.locator('#lock-zoom').click();a=scene(page);page.locator('#zoom-in').click();wait(page);b=scene(page)
        near(b['points'][1]['x']-b['points'][0]['x'],2*(a['points'][1]['x']-a['points'][0]['x']))
        near(b['points'][1]['y']-b['points'][0]['y'],2*(a['points'][1]['y']-a['points'][0]['y']))
        passed('Explicit zoom changes center spacing uniformly rather than rearranging points')
        page.locator('#fit-points').click();wait(page)

        expected=scene(page)
        with page.expect_download() as d:page.locator('#export-svg').click()
        svg_path=OUT/'browser-export.svg';d.value.save_as(svg_path)
        svg=svg_path.read_text();root=ET.fromstring(svg)
        assert int(root.attrib['width'])==expected['width'] and int(root.attrib['height'])==expected['height']
        assert '<image' not in svg and '<text' not in svg and 'onerror' not in svg and '38.912345678' not in svg
        coords=[[float(v) for v in g.attrib['transform'][10:-1].split()] for g in root]
        screens=page.evaluate('MapToConstellation.getScreenPoints()')
        for i in range(len(screens)):
          for j in range(len(screens)):
            near(coords[i][0]-coords[j][0],screens[i]['x']-screens[j]['x'])
            near(coords[i][1]-coords[j][1],screens[i]['y']-screens[j]['y'])
        passed('Actual SVG download matches every on-map displacement and contains no geographic details')
        dom=page.evaluate("""() => [...document.querySelectorAll('.point-group')].map(g=>({id:g.dataset.pointId,x:g.transform.baseVal.getItem(0).matrix.e,y:g.transform.baseVal.getItem(0).matrix.f}))""")
        assert len(dom)==len(screens)
        for p in dom:
          orig=next(p2 for p2 in screens if p2['id']==p['id']);near(p['x'],orig['x'],1e-4);near(p['y'],orig['y'],1e-4)
        passed('Rendered SVG map transforms match canonical screen positions to subpixel precision')

        page.locator('[data-preview="dark"]').click()
        with page.expect_download() as d:page.locator('#export-png').click()
        png_path=OUT/'browser-export.png';d.value.save_as(png_path)
        image=Image.open(png_path).convert('RGBA')
        assert image.size==(expected['width'],expected['height'])
        alpha=image.getchannel('A');assert alpha.getpixel((0,0))==0
        for edge in [(0,0,image.width,1),(0,image.height-1,image.width,image.height),(0,0,1,image.height),(image.width-1,0,image.width,image.height)]:assert alpha.crop(edge).getextrema()[1]==0
        for p in expected['points']:
          color=tuple(int(p['color'][i:i+2],16) for i in (1,3,5));pixel=image.getpixel((round(p['x']),round(p['y'])));assert pixel[:3]==color and pixel[3]==255,(pixel,color)
        passed('Actual PNG has identical dimensions, transparent edges, and exact point center colors')
        with page.expect_download() as d:page.locator('#save-backup-secondary').click()
        backup_path=OUT/'browser-project.json';d.value.save_as(backup_path);backup=json.loads(backup_path.read_text())
        assert backup==state(page)
        
        if IN_MEMORY:
            boot(page,base,{'map-to-constellation.project.v1':page.evaluate("localStorage.getItem('map-to-constellation.project.v1')")})
        else:page.reload(wait_until='networkidle')
        assert state(page)==backup
        passed('JSON backup and local-storage API round-trip preserve coordinates, styles, and map scale' if IN_MEMORY else 'JSON backup and browser reload preserve coordinates, styles, and map scale')

        invalid=dict(backup,version=999)
        upload(page,invalid);assert state(page)==backup
        passed('Invalid project imports leave the current project untouched')
        page.locator('#project-button').click();page.locator('#new-project').click();page.locator('#confirm-ok').click();wait(page);assert not state(page)['points']
        upload(page,backup);assert state(page)==backup
        passed('A downloaded project can be reopened with identical content')

        page.locator('#search-input').fill('10.123456, 179.95');page.locator('#search-submit').click();wait(page)
        near(state(page)['view']['center']['lat'],10.123456);near((state(page)['view']['center']['lng']+180)%360-180,179.95)
        assert len(state(page)['points'])==2
        passed('Coordinate search navigates without adding or moving any points')
        page.locator('#search-input').fill('Test city');page.locator('#search-submit').click()
        if IN_MEMORY:
            assert 'localhost or HTTPS' in page.locator('#search-results').inner_text()
            passed('Offline place search provides actionable setup guidance')
        else:
            page.locator('#search-results button').first.wait_for();assert page.locator('#search-results img').count()==0
            page.locator('#search-results button').first.click();wait(page);near(state(page)['view']['center']['lat'],40.7128)
            passed('Manual geocoder submission and safe result rendering work with a mocked service')

        dateline=dict(backup,points=[point(1,lat=0,lng=179.8),point(2,lat=0,lng=-179.8,world=1)],view={'center':{'lat':0,'lng':180},'zoom':10,'locked':False})
        upload(page,dateline);ds=scene(page);assert ds['width']<400
        assert len(page.locator('.point-group').all())==2
        passed('Date-line neighbors render and export together without rewrapping')
        huge=dict(backup,points=[point(1,lat=0,lng=0),point(2,lat=0,lng=90)],view={'center':{'lat':0,'lng':45},'zoom':19,'locked':False})
        upload(page,huge);assert page.locator('#export-png').is_disabled();assert page.locator('#export-svg').is_enabled();assert scene(page)['width']>8192
        passed('Oversized PNG is refused without resizing; full-scale SVG remains available')

        # All six shapes are rasterized in one real browser download, with crop checks.
        shapes=['circle','square','triangle','diamond','star','hexagon']
        shape_project=dict(backup,points=[point(i,lat=38.9+(i%2)*.004,lng=-77.06+i*.008,shape=shape,size=31) for i,shape in enumerate(shapes)],view={'center':{'lat':38.902,'lng':-77.04},'zoom':14,'locked':False})
        upload(page,shape_project);sh_scene=scene(page)
        with page.expect_download() as d:page.locator('#export-png').click()
        all_shapes=OUT/'all-shapes.png';d.value.save_as(all_shapes)
        im=Image.open(all_shapes).convert('RGBA');assert im.size==(sh_scene['width'],sh_scene['height'])
        a=im.getchannel('A');bbox=a.getbbox();assert bbox[0]>=1 and bbox[1]>=1 and bbox[2]<im.width and bbox[3]<im.height
        passed('All six icon shapes export without clipping')
        page.locator('#view-pattern').click();wait(page)
        page.screenshot(path=str(OUT/'desktop-pattern.png'))
        example=dict(backup,name='A few favorite places',points=[point(0,lat=38.9148,lng=-77.0572,shape='circle'),point(1,lat=38.9193,lng=-77.0381,shape='star',color='#D4AC60',size=25),point(2,lat=38.9025,lng=-77.0441,shape='diamond',color='#A296B6',size=22),point(3,lat=38.8977,lng=-77.0325,color='#6D95A8',size=17),point(4,lat=38.8894,lng=-77.0496,shape='triangle',color='#839776',size=24),point(5,lat=38.8908,lng=-77.0212,shape='square',size=16),point(6,lat=38.8829,lng=-77.0353,shape='hexagon',color='#465C52',size=22)],view={'center':{'lat':38.9015,'lng':-77.0395},'zoom':14,'locked':False})
        upload(page,example);page.locator('#view-map').click();page.locator('#fit-points').click();wait(page);page.screenshot(path=str(OUT/'desktop-example.png'))
        assert not errors,errors
        passed('Desktop interaction suite produces no uncaught JavaScript errors')

        mobile_context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,accept_downloads=True)
        mobile_context.route('https://tile.openstreetmap.org/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body=TEST_TILE))
        mobile=mobile_context.new_page();mobile_errors=[];mobile.on('pageerror',lambda e:mobile_errors.append(str(e)))
        boot(mobile,base);assert mobile.evaluate('document.documentElement.scrollWidth')<=390
        mb=mobile.locator('#map').bounding_box();mobile.touchscreen.tap(mb['x']+140,mb['y']+250);wait(mobile);assert len(state(mobile)['points'])==1
        mobile.locator('a[href="#export-panel"]').click();mobile.locator('#export-png').scroll_into_view_if_needed()
        with mobile.expect_download() as d:mobile.locator('#export-png').tap()
        d.value.save_as(OUT/'mobile-export.png')
        assert not mobile_errors,mobile_errors
        mobile.screenshot(path=str(OUT/'mobile-export.png.screen.png'),full_page=True)
        passed('Mobile viewport has no horizontal overflow; touch plotting and PNG download work')

        # Self-contained edition must work with all external requests blocked.
        local_context=browser.new_context(viewport={'width':1280,'height':900})
        local_context.route('https://**',lambda r:r.abort())
        local=local_context.new_page();local_errors=[];local.on('pageerror',lambda e:local_errors.append(str(e)))
        boot(local,base,single=True);wait(local)
        assert 'Local file mode' in local.locator('#map-status').inner_text()
        lb=local.locator('#map').bounding_box();local.mouse.click(lb['x']+150,lb['y']+150);wait(local);assert len(state(local)['points'])==1
        with local.expect_download() as d:local.locator('#export-svg').click()
        d.value.save_as(OUT/'offline-export.svg')
        assert not local_errors,local_errors
        passed('Single-file edition supports offline plotting/export and explains live-map setup')

        corrupt=browser.new_context(viewport={'width':1280,'height':900});corrupt.route('https://tile.openstreetmap.org/**',lambda r:r.abort())
        if not IN_MEMORY:corrupt.add_init_script("localStorage.setItem('map-to-constellation.project.v1','{not valid json')")
        cp=corrupt.new_page();boot(cp,base,{'map-to-constellation.project.v1':'{not valid json'});wait(cp)
        assert cp.locator('#storage-notice').is_visible()
        assert cp.evaluate("localStorage.getItem('map-to-constellation.project.v1')")=='{not valid json'
        passed('Corrupt local data is not silently overwritten')
        browser.close()
    finally:
      server.shutdown();server.server_close()
      (OUT/'browser-report.json').write_text(json.dumps({'mode':'In-memory HTML; localStorage adapter; network prohibited by environment' if IN_MEMORY else 'Local HTTP server; real browser localStorage','external_services':'No live tile/geocoder verification; in-memory mode skips HTTP-only integrations','checks':results},indent=2))
    print(f'\n{len(results)} browser checks passed.',flush=True)

if __name__=='__main__': run()
