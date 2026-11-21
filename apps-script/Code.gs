/**
 * Amrabad Tiger Reserve – Basecamp Monitoring Database
 * Entry service: lets basecamp watchers / officers add their daily picture report (DPR)
 * from the website. Each report becomes a new row in the BcampsDPR tab and the photo is
 * saved in the Drive folder "BcampsDPR_Images".
 *
 * ONE-TIME SETUP (sheet owner, about 5 minutes):
 *   1. Go to https://script.google.com → New project. Name it "ATR Basecamp Entry Service".
 *   2. Delete the empty function shown there and paste this whole file.
 *   3. Change ENTRY_PIN below to your own PIN and share it only with basecamp staff.
 *   4. Deploy → New deployment → gear icon → "Web app"
 *        Execute as: Me      Who has access: Anyone
 *      → Deploy → Authorize access (allow Sheets + Drive) → copy the Web app URL (ends in /exec).
 *   5. Paste that URL into config.js → entryApiUrl on the website, and commit config.js to GitHub.
 * After changing this code later: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
 */

const ENTRY_PIN = 'change-this-pin';             // <-- CHANGE THIS
const SPREADSHEET_ID = '1sFS9bRkFnqrS4IPnY9_iSrOwjoUwXeNBJxYrRMW4dCU'; // Basecampdata
const SHEET_NAME = 'BcampsDPR';                  // reports tab
const MASTER_SHEET = 'Bcampdtls';                // basecamp master list
const PHOTO_FOLDER = 'BcampsDPR_Images';         // Drive folder for photos
const TZ = 'Asia/Kolkata';
const DESIGNATIONS = ['Basecamp watcher', 'Animal Tracker', 'Protection watcher'];

function doGet() {
  return json_({ ok: true, message: 'ATR Basecamp entry service is running.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const req = JSON.parse(e.postData.contents);
    if (String(req.pin || '') !== ENTRY_PIN) return json_({ ok: false, error: 'Wrong PIN.' });
    if (req.action === 'ping') return json_({ ok: true });
    if (req.action !== 'add') return json_({ ok: false, error: 'Unknown action.' });

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) return json_({ ok: false, error: 'Sheet "' + SHEET_NAME + '" not found.' });
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    const col = function (name) { return headers.indexOf(name); };
    const v = req.values || {};
    const camp = String(v.Basecamp_Name || '').trim();
    if (!camp) return json_({ ok: false, error: 'Basecamp name is missing.' });
    if (!String(v.Employee_name || '').trim()) return json_({ ok: false, error: 'Employee name is missing.' });
    if (DESIGNATIONS.indexOf(String(v.Designation || '').trim()) < 0) return json_({ ok: false, error: 'Designation must be one of: ' + DESIGNATIONS.join(', ') + '.' });
    if (!req.photo || !req.photo.data) return json_({ ok: false, error: 'Photo is missing.' });

    // Division / Range / Section / Beat / Compt_No always come from the master list.
    const m = ss.getSheetByName(MASTER_SHEET);
    if (m) {
      const mv = m.getDataRange().getDisplayValues(), mh = mv[0].map(function (h) { return String(h).trim().toLowerCase(); });
      const ni = mh.indexOf('basecamp_name');
      const row = mv.slice(1).filter(function (r) { return norm_(r[ni]) === norm_(camp); })[0];
      if (!row) return json_({ ok: false, error: 'Basecamp "' + camp + '" is not in the ' + MASTER_SHEET + ' tab.' });
      ['Division', 'Range', 'Section', 'Beat', 'Compt_No'].forEach(function (k) {
        const i = mh.indexOf(k.toLowerCase()); if (i >= 0 && String(row[i]).trim()) v[k] = row[i];
      });
      v.Basecamp_Name = row[ni];
    }

    // Date and time are set by the server (today, India time), not by the phone.
    const now = new Date();
    v.Picture_date = Utilities.formatDate(now, TZ, 'dd/MM/yyyy');
    v.Time = Utilities.formatDate(now, TZ, 'HH:mm:ss');

    // Next ID number
    const lastRow = sh.getLastRow(), idc = col('ID_No');
    let id = 1001;
    if (idc >= 0 && lastRow > 1) {
      const ids = sh.getRange(2, idc + 1, lastRow - 1, 1).getValues();
      id = ids.reduce(function (mx, r) { return Math.max(mx, Number(r[0]) || 0); }, 1000) + 1;
    }
    v.ID_No = id;

    // Photo → Drive
    const name = id + '.Picture.' + Utilities.formatDate(now, TZ, 'HHmmss') + '.jpg';
    const file = folder_().createFile(Utilities.newBlob(Utilities.base64Decode(req.photo.data), 'image/jpeg', name));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* domain policy may block */ }
    v.Picture = PHOTO_FOLDER + '/' + name;
    v.Picture_url = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    const out = headers.map(function (h) { return Object.prototype.hasOwnProperty.call(v, h) ? v[h] : ''; });
    sh.appendRow(out);
    const r = sh.getLastRow();
    // Store date and time as real sheet dates/times, like the existing rows (sheet locale is dd/mm/yyyy).
    if (col('Picture_date') >= 0) sh.getRange(r, col('Picture_date') + 1).setValue(v.Picture_date).setNumberFormat('dd/mm/yyyy');
    if (col('Time') >= 0) sh.getRange(r, col('Time') + 1).setValue(v.Time).setNumberFormat('hh:mm:ss');
    ['Latitude', 'Longitude', 'ID_No', 'Compt_No'].forEach(function (k) {
      const c = col(k); if (c >= 0 && /^-?\d+(\.\d+)?$/.test(String(v[k]))) sh.getRange(r, c + 1).setValue(Number(v[k]));
    });
    return json_({ ok: true, id: id, row: r, values: v });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function norm_(s) { return String(s || '').toLowerCase().replace(/[\s._\-()\/]+/g, ''); }
function folder_() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
