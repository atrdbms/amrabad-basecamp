# Amrabad Tiger Reserve – Basecamp Monitoring Database

A static website (no server, no database) that reads the **Basecampdata** Google Sheet live
every time the page opens, so new basecamp reports appear automatically (press **↻ Sync** to reload).

## Files
- `index.html` – the page (ATR and Government of Telangana logos are built in)
- `config.js` – **the only file you normally edit**: titles, sheet ID and tab names, column names, map start point
- `app.js` – filters, charts, map, reports and export logic
- `style.css` – shared look (same as the Tiger Monitoring site), `basecamp.css` – basecamp additions

## Data
The site reads two tabs of the sheet:
- **BcampsDPR** – one row per daily picture report (ID_No, Basecamp_Name, Division, Range, Section, Beat,
  Compt_No, Employee_name, Designation, Picture_date, Time, Latitude, Longitude, Picture, Picture_url).
- **Bcampdtls** – the master list of basecamps with their location. It is used to show basecamps that
  have *not* reported, and to measure how far each photo was taken from its basecamp.

The sheet must stay shared as **Anyone with the link – Viewer**. Report photos (Picture_url) are shown
only if the photo files in Drive are also shared as "Anyone with the link"; otherwise an "Open photo" link is shown.
Basecamp names in BcampsDPR must match the names in Bcampdtls (case and spaces are ignored);
the site shows a warning listing any name it cannot match.

## Pages
- **Dashboard** – KPIs (basecamps, reporting / not reporting, reports, staff, average compliance, photos taken away
  from camp), day-wise trend, reporting status, designation, month-wise, range-wise and basecamp-wise charts,
  satellite overview map and latest reports.
- **GIS Map** – Google Satellite (with labels) basemap plus Google Satellite, Terrain, Esri imagery and OSM.
  Green basecamp pins = reported in the period, red = no report. Orange dots = where each photo was taken
  (red ring = more than 0.5 km from the basecamp). Click for details and photos.
- **Selecting a basecamp** (Basecamp name filter, clicking its pin, or the 🛰 Map button on its card) highlights it and draws a
  10 km radius circle around it, ringing the other basecamps inside the circle (radius set in `config.js` → `selectRadiusKm`).
- **Boundary layers (KML)** (top-left of the GIS map): *Upload KML / KMZ* overlays reserve, division, range, beat or
  compartment boundaries on the satellite image. Each layer can be switched on/off, zoomed to (⌖) or removed (✕);
  click a boundary to see its name and attributes. Uploaded layers are remembered in that browser only.
  To show boundaries to **everyone**, upload the .kml files to this repository (e.g. a `kml` folder) and list them
  in `config.js` → `kmlLayers`, e.g. `{ name: "Beats", url: "kml/ATR_beats.kml" }`.
- **Basecamps** – one card per basecamp with latest photo, reports, days reported, compliance and last report.
- **Reports** – Abstract reports (basecamp-wise status, division / range / section / beat-wise abstracts,
  month-wise, employee-wise, non-reporting basecamps, photos taken away from camp, full report list),
  a **daily attendance register** (basecamp × day for a month) and a **pivot** (any two fields).
  Print / Save as PDF on letterhead, Excel (one sheet per table) and CSV.
- **Records** – all report rows, sortable; click a row to see it on the map.

## Filters
Year, Month, Division, Range, Section, Beat, Basecamp name, plus Date from / Date to, With / Without photo and
search. Choose values and press **Apply**. Each list only shows values that exist for the other choices.
*Compliance* = days with at least one report ÷ days in the period (the date range, else the month/year chosen,
else first to last report date).

After changing app.js, config.js or the CSS files, raise the `?v=` number on their lines in `index.html`
so browsers load the new copy instead of an old cached one.

## Publishing (free) on GitHub Pages
1. Upload these files to a GitHub repository.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. The site appears at `https://<username>.github.io/<repository>/`.

Note: Google's satellite tiles are used directly, which is fine for internal use; the Esri World Imagery layer
is a ready alternative in the layer switcher.
