# Map-to-Constellation

A single-user browser app for turning geographic locations into a tightly cropped constellation of colored shapes. The PNG and SVG exports contain only the plotted icons—not the basemap, labels, selection outlines, or original geographic coordinates.

## Start the app

Unzip the project before launching it. Keep the extracted files together. When running from source, run `npm ci` and `npm run build` once to install MapLibre. The bundled HTML edition needs no installation.

**Windows:** double-click `Start.bat`.

**macOS:** run `Start.command`. If macOS will not open the script directly, open Terminal in this folder and use the Python command below.

**Linux, or any terminal:**

```bash
python3 start.py
```

On Windows, the equivalent Python command is:

```powershell
py -3 start.py
```

The launcher uses Python's standard library, starts a local server, and opens the app in your browser. No Python packages are required. The normal address is `http://localhost:8787`; the launcher selects another port if that port is busy. Keep the terminal open while using the app. Press Ctrl+C to stop the server.

**Node.js alternative:**

```bash
npm start
```

Then open `http://localhost:8787`. Node.js 18 or newer is supported. For the source checkout, run `npm ci` and `npm run build` once to install the pinned MapLibre basemap renderer. The generated single-file edition bundles it.

The launchers require **Python 3 or Node.js** to already be installed. Sites hosting is configured for a private hosted edition; local launchers remain available.

### Single-file edition

`Map-to-Constellation.html` bundles the complete application into one file. It can also be served from any ordinary static web host without a build step.

Opening this file directly from your filesystem enables point editing, coordinate navigation, project import/export, and PNG/SVG export. **Live map tiles and place-name search are deliberately disabled on `file:` pages**, because public map services expect normal HTTP referrers. Use the local launcher for the full live-map workflow. Browser support for saving local data on `file:` pages varies; export a JSON backup.

## Using it

1. **Navigate.** Drag to pan; scroll, pinch, or use + / − to zoom. Search for a place or enter `latitude, longitude`. The location button asks for permission before centering on your current location; it does not add a point automatically.
2. **Plot.** Choose a circle, square, triangle, diamond, star, or hexagon. Pick any hex color or use the full color picker. In Plot mode, click or tap the map. “Add an exact location” accepts numeric coordinates.
3. **Customize individually.** Select a map icon or an entry in Your points. Changes apply to that point alone. Adjust its name, shape, color, and size. Apply coordinates explicitly to move it. Points themselves cannot accidentally be dragged. “Done editing” returns the palette to the new-point style; plotting while a point is selected copies its style to the new point.
4. **Choose a basemap.** Map uses OpenFreeMap cartography; Satellite uses Esri World Imagery. Imagery dates and resolution vary by location; it is not a live feed. Switching basemaps does not change coordinates, zoom, or exports.
5. **Check the arrangement.** Pattern hides the basemap in the main workspace without changing coordinates. The export preview is uniformly fitted to its card, not shown at native pixel size. Its checkerboard/white/dark backgrounds are viewing aids only; every export remains transparent.
6. **Export.** PNG and SVG include **all points**, even those outside the current map viewport. Export uses the current map scale and crops around the full outer boundaries of the icons. It never fits points to an arbitrary output size.

Project → Load example pattern offers an editable seven-point example. `examples/favorite-places.constellation.json` is also included.

## The spacing guarantee

Both the map overlay and exporter call the same `project()` function in `src/core.js`, using the same Web Mercator projection, map zoom, and persisted world-copy index.

For a projected point `P_i`, the map displays:

```text
map_i = P_i - map_origin
```

The export displays:

```text
export_i = P_i - crop_origin
```

Therefore, for every pair of points:

```text
export_i - export_j = P_i - P_j = map_i - map_j
```

Cropping is a **common translation only**. It does not move points independently, round individual point centers to integer pixels, normalize axes, cluster, stretch, reproject to a different coordinate system, or rescale the pattern.

The crop includes each icon's actual geometric bounds, including the tips of triangles and stars. Integer canvas bounds are rounded outward, then a one-pixel transparent safety margin is added. This means the edge space is one pixel plus less than one extra pixel of outward rounding. No user-defined padding is added.

SVG and PNG use identical intrinsic dimensions. PNG is **1×: one CSS map pixel equals one image pixel**, independently of screen pixel density. SVG is vector artwork with the same initial dimensions and aspect ratio. PNG is rasterized from that same SVG, not from a screenshot of the map.

Panning does not change exports. Zooming intentionally changes map spacing; **the zoom lock prevents wheel, pinch, button, and search operations from changing the current scale**. The Fit button can only recenter while the zoom is locked. Restoring a project or undo history restores its saved view and lock state.

### Projection and the date line

This preserves the map's **screen-space geometry**, not true ground-distance ratios. Web Mercator already distorts ground distances at different latitudes, and this app does not attempt to undo that distortion on export. Its latitude range is ±85.0511287798066°.

Longitudes are stored canonically, with a separate integer `world` field for the world copy where each point was plotted. For example, points on opposite sides of the date line can remain adjacent. Export does not independently wrap points or choose a new shortest-path layout. Deliberately placing points in different world copies leaves them in those copies.

## Saving and privacy

The current project is saved to this browser's local storage, including geographic coordinates, individual styles, map center, zoom, and zoom lock. No account or application database is used.

Use **Project → Save project backup** to download a `.constellation.json` file. This is the editable backup format; PNG and SVG deliberately omit the source geographic coordinates. Open a JSON project to continue on another browser or device. Keep a backup before clearing browser data, changing server ports, switching between localhost and a hosted copy, or moving between file and HTTP editions; these can use different browser storage origins.

Undo/redo keeps up to 60 edit snapshots in the current tab. History does not persist across page reloads. Invalid project imports are rejected before the current project is replaced. If existing browser data is corrupt or cannot be saved, the app shows a notice rather than silently overwriting it. A change from another tab pauses automatic saving in this tab to avoid overwriting that version.

The **application itself does not upload your plotted points**. Ordinary map navigation sends vector-tile, style, and font requests to OpenFreeMap, which reveals the viewed area and normal network information to that service. Satellite view sends imagery tile requests for the viewed area to Esri. Place-name search sends the query you explicitly submit to Nominatim. Search does not autocomplete or run while you type, and requests are throttled. Export generation occurs in your browser and does not request map tiles.

## Limits and failure behavior

- Up to 2,000 points and 2 MB per imported JSON file.
- Icon sizes from 6 to 80 CSS pixels; six-digit RGB hex colors.
- PNG limit: 8,192 pixels per side and 16,777,216 pixels total. A browser can still refuse allocation under memory pressure; the app reports this and leaves SVG available.
- An oversized PNG is disabled, **never silently reduced or resized**. SVG remains at the current scale. Zooming out is an explicit user choice, not an automatic export behavior.
- Live map tiles and place-name search need internet access. If either service is unavailable, existing points, project backups, coordinate editing, and icon exports remain usable.
- Desktop Chromium and a Chromium mobile viewport were exercised. Safari, Firefox, native iOS download behavior, real-device multitouch, and live public-service responses were not verified in this build environment. See `TEST_REPORT.md` for exact coverage.

## Source layout

```text
index.html                    Accessible application UI
src/styles.css                Responsive desktop/tablet/mobile styling
src/core.js                   Shared projection, geometry, crop, SVG, validation
src/map.js                    Pan/zoom/touch and visible-only XYZ tile rendering
src/app.js                    Editing, browser saving, history, previews, exports
Map-to-Constellation.html      Generated self-contained edition
start.py                      Python local launcher (standard library)
server.cjs                    Node local server (built-in modules only)
Start.command / Start.bat     Convenience launchers
build.cjs                     Rebuild the single-file edition
examples/                     Sample editable project and point-only artwork
tests/core.test.cjs            Geometry and validation unit tests
tests/browser_smoke.py         Browser acceptance checks
TEST_REPORT.md                Verified coverage and known test limitations
```

Rebuild the single-file edition and the Sites deployment output (`dist/index.html`) after changing the source:

```bash
npm run build
```

Run the dependency-free unit tests:

```bash
npm test
```

Browser QA is an optional developer workflow. It requires the Python `playwright` and `Pillow` packages plus a Chromium browser, but none of these packages is needed to run the app:

```bash
python3 -m pip install playwright Pillow
python3 -m playwright install chromium
python3 tests/browser_smoke.py
```

Set `CHROMIUM_PATH` to use a system Chromium executable. `CONSTELLATION_IN_MEMORY=1` runs QA in an in-memory browser document for environments that block navigation; that mode supplies an in-memory localStorage adapter and cannot verify HTTP-only integrations.

Browser QA blocks vector basemap requests and supplies deterministic geocoder test responses; it does not verify live map cartography. Production application files contain no mock tiles or test geocoder responses.

## Static hosting

Sites publishes the generated `dist/index.html` using `.openai/hosting.json`. The Site starts private. Source is maintained in [jasonMatney/map-to-constellation](https://github.com/jasonMatney/map-to-constellation); GitHub Actions runs the unit tests, rebuilds the app, and checks that the bundled edition is current.

For another static host, upload `index.html` and the `src/` folder, or publish the self-contained HTML as `index.html`. No server-side application, runtime environment variables, or API secrets are required.

Public map services have usage policies and no guarantee of availability. The basemap uses OpenFreeMap’s Positron (light) and Dark styles, rendered by MapLibre; it follows the system appearance. Light mode adds soft blue water and muted green parks. This app requests tiles for the current view, retains browser caching behavior, displays map attribution, and performs manually submitted place searches. It does not prefetch tiles or make offline tile downloads. Before wider public deployment, review the providers' policies and use an appropriate dedicated provider if your traffic or use case needs one. The tile URL is in `src/map.js`; the geocoder endpoint is in `src/app.js`; map/search attribution text is in `index.html` and `src/app.js`.

## Technical references

The Web Mercator tile convention and public-service policies consulted for this implementation:

```text
OpenStreetMap XYZ/Web Mercator tile convention:
https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

OpenFreeMap basemap setup and attribution:
https://openfreemap.org/quick_start/

Nominatim public geocoding usage policy:
https://operations.osmfoundation.org/policies/nominatim/
```
