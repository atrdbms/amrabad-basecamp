// ------------------------------------------------------------------
// Site settings. Edit this file only; app.js reads everything from here.
// ------------------------------------------------------------------
window.BC_CONFIG = {
  branding: {
    govLine: "Government of Telangana · Telangana Forest Department",
    titleSmall: "Amrabad Tiger Reserve",
    titleMain: "Basecamp Monitoring Database",
    titleSub: "Basecamp Daily Picture Reports (DPR) · Nagarkurnool & Nalgonda Districts",
    logoLeft: "",   // logos are built into index.html; put a path/link here to change them
    logoRight: "",
  },

  // Google Sheet "Basecampdata". The sheet is shared "Anyone with the link – Viewer",
  // so the site reads both tabs live on every page load (press ↻ Sync to reload).
  // You can also use "File → Share → Publish to web → CSV" links here instead.
  sheetId: "1sFS9bRkFnqrS4IPnY9_iSrOwjoUwXeNBJxYrRMW4dCU",
  reportsTab: "BcampsDPR",   // one row per photo report from a basecamp
  campsTab: "Bcampdtls",     // master list: one row per basecamp with its location
  reportsCsvUrl: "",         // optional override for the reports tab
  campsCsvUrl: "",           // optional override for the master tab

  // Boundary layers (KML) shown to everyone. Upload the .kml files to this GitHub repository
  // (e.g. a folder named kml) and list them here, for example:
  //   { name: "ATR boundary", url: "kml/ATR_boundary.kml" },
  //   { name: "Beats", url: "kml/ATR_beats.kml" },
  // Anyone can also upload a KML/KMZ on the GIS Map page (kept in that browser only).
  kmlLayers: [
  ],

  // "Add Report" form: paste the Apps Script web-app URL here after the one-time setup in
  // README → "Add Report form". Leave "" and the form shows the setup steps instead.
  entryApiUrl: "",
  designations: ["Basecamp watcher", "Protection watcher", "Forest Beat Officer", "Forest Section Officer", "Forest Range Officer"],

  mapCenter: [16.35, 78.85],
  mapZoom: 10,

  // Radius (km) drawn around a selected basecamp on the map, and the distance after which
  // a report photo is flagged as taken away from its basecamp.
  selectRadiusKm: 10,
  distanceAlertKm: 0.5,

  // Accepted header names for each field (case, spaces, dots, underscores ignored).
  columns: {
    camp:      ["Basecamp_Name", "Basecamp name", "Base camp", "Basecamp", "Camp name", "Camp"],
    division:  ["Division", "Div"],
    range:     ["Range", "Range Name"],
    section:   ["Section", "Section Name"],
    beat:      ["Beat", "Beat Name"],
    compt:     ["Compt_No", "Compt No", "Compartment"],
    employee:  ["Employee_name", "Employee", "Staff", "Name"],
    designation: ["Designation", "Post"],
    date:      ["Picture_date", "Date", "Report date", "Timestamp"],
    time:      ["Time", "Picture_time"],
    lat:       ["Latitude", "Lat"],
    lon:       ["Longitude", "Long", "Lon", "Lng"],
    photo:     ["Picture_url", "Photo URL", "Photo_URL", "Image URL", "Picture link"],
    photoName: ["Picture", "Photo", "Image"],
    id:        ["ID_No", "ID", "Sl_No"],
    location:  ["Location"],
  },

  // Filters in the filter bar, in this order.
  filterOrder: ["year", "month", "division", "range", "section", "beat", "camp"],
  labels: { year: "Year", month: "Month", division: "Division", range: "Range", section: "Section", beat: "Beat", camp: "Basecamp name" },

  // Signature lines printed under reports.
  signs: ["Prepared by", "Verified by<br><small>Field Director, Amrabad Tiger Reserve</small>"],
};
