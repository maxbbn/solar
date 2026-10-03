<img src="assets/icon.svg" width="96" height="96" alt="">

# True Scale Solar System

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

A true-scale solar system simulator with real-time ephemerides, running entirely in the browser (three.js).

- Planet positions: JPL approximate Keplerian elements (most accurate 1800–2050); the Moon: a lunar theory with the main perturbation terms (error ≈ 1–2′)
- Views: orbit in space, or stand on the surface of Earth, the Moon or Mars, with true apparent diameters and telescope zoom
- Time: from real time up to 1 year per second, run backwards, jump to any date, automatically find the next solar or lunar eclipse
- Missions: Earth–Moon transfer (patched conics) and transfers to Mars, Venus and Jupiter (Lambert solver + launch-window Δv porkchop plot), all analytic functions of time, so you can fast-forward or rewind freely
- International Space Station: real TLE orbit (with J2 precession and drag terms), procedural model with sun-tracking solar arrays, follow view, Cupola window view, and visible-pass predictions for "waiting for the ISS" from the ground
- Speed of light demo: send a beam of light from any body and see how long it takes to reach the other planets
- Interface: by default only the scene, the clock and the time bar are shown; the left navigation opens the Views / Bodies / Missions panels, the right toolbar holds the labels, orbits and constellations toggles, immersive mode (I key, Esc to exit) and settings (language, shortcuts, credits)
- Chinese and English: follows the browser language by default (and switches live when it changes), or pick one manually at the top left; UI strings are written in pairs as `tr(中文, English)` (`tr` is defined in `js/i18n.js`), and switching needs no reload

## Running

Just double-click `index.html`, or:

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

Deep links: `#onEarth` `#onMoon` `#onMars` `#inner` `#outer` `#saturnBack` `#eclipse-solar` `#eclipse-lunar` `#mission-moon` `#mission-mars` `#cockpit-moon` (launch the lunar mission and enter the cockpit view) `#iss` `#cupola`

## Layout

- `js/i18n.js` language detection and switching
- `js/iss.js` ISS orbit, pass predictions and model (to update the orbit, replace `ISS_TLE` at the top of the file; get it from celestrak.org)
- `js/astro.js` ephemerides, body data, eclipse search
- `js/missions.js` orbital mechanics (universal-variable Kepler propagation, Lambert, mission design)
- `js/tiles.js` streams NASA GIBS imagery (Blue Marble, VIIRS night lights, land/water mask) around the camera when it is close to Earth; offline it falls back to the built-in maps
- `js/scene.js` rendering (floating origin + logarithmic depth buffer, for true scale from meters to AU)
- `js/app.js` camera, time, UI
- `assets/` packed textures and star catalog (generated from `tex_src/` by `tools/build_data.py`; the Moon's colour and normal maps come from `tools/build_moon.py`)

Textures © Solar System Scope, CC BY 4.0; Moon colour and relief from the NASA SVS CGI Moon Kit (LRO LROC/LOLA); close-up Earth imagery from NASA GIBS (Blue Marble Next Generation, VIIRS Black Marble) and OpenStreetMap land/water data (© OpenStreetMap contributors, ODbL); star catalog and constellation lines from d3-celestial (BSD-3).
 
