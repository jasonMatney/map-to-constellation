# Map-to-Constellation — test report

## Apple UI redesign — September 12, 2026

Replaced the presentation layer with system typography, semantic light/dark colors, a desktop sidebar and export inspector, touch layouts, and reduced-transparency/motion fallbacks. All 31 core tests and the build passed. Static checks confirm that all app control IDs are preserved and unique. No browser interaction or visual QA was performed for this redesign.

## Publication checks — September 12, 2026

All 31 core tests passed. JavaScript syntax checks and the Sites static build passed; the local HTTP preview returned 200. In the Codex in-app browser, the example loaded, keyboard selection retained focus in both the point list and map overlay, and PNG export reported success at 230 × 299 pixels with no captured browser errors. The downloaded PNG bytes were not inspected in this run.

The full Python browser acceptance suite was not rerun because this Python environment lacks Playwright. The results and limitations below describe the original build's testing, not new publication checks.

## Original build results

**31 unit tests passed. 23 browser acceptance checks passed. Both included local servers passed HTTP checks.**

The browser acceptance checks ran in Chromium 144 with desktop and touch-enabled mobile viewport configurations. Actual SVG, PNG, and JSON files were downloaded through the application's buttons. Exported files were parsed and inspected, including PNG alpha values, dimensions, and point colors.

## Verified

The dependency-free Node test suite checks the shared geometry and validation core: known projection coordinates; 500 coordinate round-trips; integer and fractional zooms; all six icon boundaries; pairwise x/y offsets for 100 randomized points at five zoom levels; distance preservation; pan invariance; explicit zoom scaling; date-line handling; independent world copies; overlapping points; horizontal and vertical patterns; subpixel coordinates; SVG serialization precision; omission of geographic details; matching SVG/PNG dimensions; safe PNG limits; JSON round-trips; malformed imports; duplicate identifiers; oversized projects; and escaping.

The browser checks cover initial rendering, pixel-precise point placement, individual styles, full hex colors, exact coordinate entry, size and coordinate editing, deletion, undo/redo, panning, zoom locking, uniform zoom scaling, actual SVG export offsets, actual on-map SVG transforms, actual transparent PNG exports, project backup and reopen, local-storage API calls, invalid import protection, coordinate navigation, offline search guidance, date-line neighbors, oversized PNG rejection, clipping checks for all shapes, desktop JavaScript errors, narrow mobile layout, touch plotting, mobile-emulated downloads, single-file behavior, and corrupt storage protection.

The Python launcher and Node server were started as separate processes. Real loopback HTTP requests verified their index pages, JavaScript assets, and referrer-policy headers.

## Important environment limitations

This environment blocks browser navigation to network URLs, including localhost. To test the UI without circumventing those restrictions, the browser suite loaded the **unmodified self-contained application** into an in-memory browser document. A small in-memory `localStorage` adapter supplied the storage API for those checks. The geometry, editing code, export code, browser rasterization, actual downloads, and responsive CSS were not replaced.

Consequently, these checks **do not verify live OpenStreetMap tile loading, live Nominatim search, native browser localStorage persistence across real origin-based browser sessions, real geolocation, or deployed hosting**. Offline behavior and the storage serialization/API paths were checked. The application source implements the live integrations and real browser localStorage; the normal browser test mode is available for local HTTP testing in an unrestricted development environment.

The ordinary browser test mode uses deterministic external-service test responses, not live public map data. In-memory mode does not exercise the HTTP-only integration branch. Native Safari, Firefox, real-device iOS downloads, and real-device multi-touch pinch behavior have not been verified. No public hosting deployment was performed.

## Reproduce

Unit tests require Node.js 18 or newer, with no package installation:

```bash
npm test
```

Normal browser acceptance tests, after installing the optional QA packages and a Chromium executable as described in README:

```bash
python3 tests/browser_smoke.py
```

Restricted, in-memory browser QA mode used for this report:

```bash
CONSTELLATION_IN_MEMORY=1 python3 tests/browser_smoke.py
```

Machine-readable browser results are in `tests/browser-report.json`; the complete command outputs are in `tests/unit-test-results.txt` and `tests/browser-test-results.txt`. Local-server checks are recorded in `tests/server-test-results.json`.
