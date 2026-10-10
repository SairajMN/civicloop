const STORAGE_KEY = 'civicloop.reports.v1';
const ALERTS_KEY = 'civicloop.nearby-alerts';
const DEMO_CLIENT_KEY = 'civicloop.demo-client';
const CITY_CENTERS_KEY = 'civicloop.city-centers';
const CITIES = {
  Bengaluru: { center: [12.9718, 77.6412], zoom: 13 },
  Delhi: { center: [28.628, 77.218], zoom: 12 },
  Other: { center: [20.5937, 78.9629], zoom: 5 },
};
try {
  for (const [city, value] of Object.entries(JSON.parse(localStorage.getItem(CITY_CENTERS_KEY) || '{}'))) {
    if (Array.isArray(value.center) && value.center.length === 2 && value.center.every(Number.isFinite)) CITIES[city] = value;
  }
} catch { /* Custom city map centers are optional. */ }
const cloudMode = Boolean(window.CIVICLOOP_CONFIG?.apiBaseUrl && window.CivicAuth?.configured);
const api = async (path, options = {}) => {
  const headers = { 'content-type': 'application/json', ...(window.CivicAuth?.token() ? { authorization: `Bearer ${window.CivicAuth.token()}` } : {}), ...options.headers };
  const response = await fetch(`${window.CIVICLOOP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`, { ...options, headers });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not reach Civicloop.');
  return payload;
};

const starterReports = [
  { id: 'CL-014', city: 'Bengaluru', category: 'Plastic burning', title: 'Plastic burning near the service road', details: 'Smoke was coming from a small roadside pile beside the service road. The exact spot is pinned for follow-up.', place: 'Mahadevapura', lat: 12.9938, lng: 77.6967, status: 'open', checks: 3, fixChecks: 0, age: '1 day ago', ageHours: 28, icon: '♨' },
  { id: 'CL-013', city: 'Bengaluru', category: 'Blocked drain', title: 'Drain blocked after the rain', details: 'Plastic and leaves are blocking the curb drain; water is collecting across the footpath.', place: 'Indiranagar', lat: 12.9784, lng: 77.6408, status: 'progress', checks: 2, fixChecks: 0, age: '3 hours ago', ageHours: 3, icon: '≋' },
  { id: 'CL-012', city: 'Bengaluru', category: 'Water leak', title: 'Public tap still leaking', details: 'Water is running continuously from the public tap beside the park entrance.', place: 'Koramangala', lat: 12.9352, lng: 77.6245, status: 'claimed', checks: 4, fixChecks: 1, age: '2 days ago', ageHours: 48, icon: '◉' },
  { id: 'CL-011', city: 'Bengaluru', category: 'Hazardous battery / e-waste', title: 'Loose batteries left near a bin', details: 'Several small batteries were left on the ground beside the community waste bin.', place: 'HSR Layout', lat: 12.9116, lng: 77.6389, status: 'open', checks: 1, fixChecks: 0, age: '4 hours ago', ageHours: 4, icon: '▣' },
  { id: 'CL-010', city: 'Delhi', category: 'Waste dumping', title: 'Mixed waste dumped beside the park', details: 'A mixed waste pile is growing along the park boundary and narrowing the footpath.', place: 'Lajpat Nagar', lat: 28.5677, lng: 77.2433, status: 'open', checks: 2, fixChecks: 0, age: '1 day ago', ageHours: 27, icon: '♻' },
  { id: 'CL-009', city: 'Delhi', category: 'Blocked drain', title: 'Water pooling at the crossing', details: 'A blocked street drain is holding rainwater at the pedestrian crossing.', place: 'Karol Bagh', lat: 28.6514, lng: 77.1907, status: 'progress', checks: 3, fixChecks: 0, age: '6 hours ago', ageHours: 6, icon: '≋' },
  { id: 'CL-008', city: 'Delhi', category: 'Water leak', title: 'Leak at the public water point', details: 'Water continues to flow around the public water point near the market.', place: 'Patel Nagar', lat: 28.6512, lng: 77.1695, status: 'verified', checks: 5, fixChecks: 2, age: '3 days ago', ageHours: 72, icon: '◉' },
];

let reports = loadReports();
let activeCity = 'Bengaluru';
let map;
let markerLayer;
let currentLocation = null;
let selectedReportId = null;
let photoPreviewUrls = [];
let selectedEvidenceFiles = [];
let previewIndex = 0;
let cameraStream = null;
const OWN_REPORTS_KEY = 'civicloop.own-reports';
let pendingDraftId = null;
let reportLocationReady = false;
let reportPhase = 'capture';
let reportVersion = 0;
let reviewRevealTimer;
let authorityLinkContext = null;
let locationWatchId = null;
let lastNearbyRefreshAt = 0;
const notifiedNearby = new Set();
let showingAll = false;
let toastTimer;
const demoClientId = localStorage.getItem(DEMO_CLIENT_KEY) || (() => {
  const id = globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}`;
  localStorage.setItem(DEMO_CLIENT_KEY, id);
  return id;
})();

const byId = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const statusLabels = { open: 'Needs a check', progress: 'Sent to area desk', claimed: 'Fix reported · verify', verified: 'Community verified' };

function updateCaptureReady() {
  const hasEvidence = Boolean(selectedEvidenceFiles.length);
  const ready = hasEvidence && reportLocationReady;
  byId('analyze-report-button').hidden = reportPhase !== 'capture' || !ready;
  byId('capture-hint').textContent = ready ? 'Evidence and location are ready. Civicloop can analyze the issue now.' : hasEvidence ? 'Now enable your location to continue.' : reportLocationReady ? 'Now add a photo or short video to continue.' : 'Add evidence and enable location to continue.';
}

function setReportPhase(phase) {
  reportPhase = phase;
  byId('report-capture').hidden = phase !== 'capture';
  byId('report-workflow').hidden = phase !== 'workflow';
  byId('report-review').hidden = phase !== 'review';
  byId('submit-report-button').hidden = true;
  byId('report-form').setAttribute('aria-busy', phase === 'workflow' ? 'true' : 'false');
  updateCaptureReady();
}

function setWorkflowStep(active) {
  document.querySelectorAll('.workflow-step').forEach((step, index) => {
    step.classList.toggle('is-complete', index < active);
    step.classList.toggle('is-active', index === active);
  });
}

function loadReports() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return [...saved, ...starterReports.filter((seed) => !saved.some((item) => item.id === seed.id))];
  } catch { /* Start with the sample reports when local storage is unavailable. */ }
  return starterReports.map((report) => ({ ...report }));
}

function persist() {
  if (cloudMode) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); }
  catch { showToast('Browser storage is full. This change may not survive a refresh.'); }
}

function cityReports() { return reports.filter((report) => report.city === activeCity); }
function rememberCity(city, center) {
  if (!city) return;
  const select = byId('city-select');
  if (![...select.options].some((option) => option.value === city)) select.add(new Option(city, city));
  if (!CITIES[city] && center) {
    CITIES[city] = { center, zoom: 12 };
    const custom = Object.fromEntries(Object.entries(CITIES).filter(([name]) => !['Bengaluru', 'Delhi', 'Other'].includes(name)));
    try { localStorage.setItem(CITY_CENTERS_KEY, JSON.stringify(custom)); } catch { /* Reports still work if browser storage is unavailable. */ }
  }
}
function statusClass(status) { return status === 'progress' ? 'progress' : status === 'claimed' ? 'claimed' : status === 'verified' ? 'verified' : ''; }
function reportStatusLabel(report) {
  if (report.authorityEmailedAt && report.authorityRecipientType === 'demo') return 'Sent to demo inbox';
  if (report.authorityEmailedAt && report.authorityRecipientType === 'authority') return 'Sent to area desk';
  return statusLabels[report.status] || statusLabels.open;
}
function nearbyItems() { return cityReports().filter((report) => report.status !== 'verified'); }

function render() {
  const items = cityReports();
  const open = items.filter((report) => report.status === 'open' || report.status === 'progress').length;
  const checks = items.reduce((sum, report) => sum + (Number(report.checks) || 0), 0);
  const fixed = items.filter((report) => report.status === 'verified').length;
  byId('open-count').textContent = open;
  byId('check-count').textContent = checks;
  byId('fixed-count').textContent = fixed;
  byId('report-count').textContent = items.length;
  byId('neighbor-count').textContent = `${checks} neighbors`;
  renderReportList(items);
  renderMap(items);
  byId('alerts-state').textContent = localStorage.getItem(ALERTS_KEY) === 'on' ? 'on' : 'off';
  byId('auth-label').innerHTML = cloudMode ? `<span></span> ${window.CivicAuth.email() ? esc(window.CivicAuth.email()) : 'Sign in to report'}` : '<span></span> Demo mode';
  byId('auth-button').textContent = window.CivicAuth?.token() ? 'Sign out' : 'Sign in';
  byId('auth-button').hidden = !cloudMode;
  byId('ward-button').hidden = cloudMode && !window.CivicAuth.isWard();
}

async function refreshReports() {
  if (!cloudMode) return;
  const result = await api(`/reports?city=${encodeURIComponent(activeCity)}`);
  reports = result.reports.map((report) => ({ ...report, age: ageLabel(report.createdAt), ageHours: (Date.now() - Date.parse(report.createdAt)) / 3600000, icon: iconForCategory(report.category) }));
  render();
}

async function handleAuthorityConfirmationLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const reportId = params.get('confirmReport');
  const token = params.get('authorityToken');
  if (!reportId || !token) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  try {
    const { report } = await api(`/reports/${encodeURIComponent(reportId)}`);
    activeCity = report.city;
    byId('city-select').value = activeCity;
    authorityLinkContext = { reportId, token };
    openAuthorityProofForm(report);
  } catch (error) {
    showToast(error.message || 'This confirmation link could not be used.');
  }
}

function openAuthorityProofForm(report) {
  byId('authority-proof-content').innerHTML = `<div class="dialog-head"><div><span class="section-kicker">AUTHORITY FIX UPDATE</span><h2 class="dialog-section-title">Show what was repaired</h2><p class="dialog-section-copy">${esc(report.id)} · ${esc(report.wardName ? `Ward ${report.wardNumber} ${report.wardName}` : report.place || report.city)}. Add a fix photo and enable location at the repair site. Neighbors will verify the update.</p></div><button class="icon-button close-authority-proof" type="button" aria-label="Close">×</button></div><form id="authority-proof-form"><label class="field-label" for="authority-proof-file">Fix photo</label><input class="form-control" id="authority-proof-file" type="file" accept="image/*" capture="environment" required><p class="privacy-note">Location must be within 500 metres of the original report.</p><div class="dialog-actions"><button class="button button-quiet close-authority-proof" type="button">Cancel</button><button class="button button-primary" type="submit">Send fix for review <span aria-hidden="true">→</span></button></div></form>`;
  byId('authority-proof-dialog').showModal();
}

function getLivePoint() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is not available in this browser.')); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }), () => reject(new Error('Allow location access at the repair site, then try again.')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}

async function submitAuthorityProof(event) {
  event.preventDefault();
  if (!authorityLinkContext) return;
  const file = byId('authority-proof-file').files[0];
  if (!file || !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { showToast('Choose a fix photo under 10 MB.'); return; }
  try {
    showToast('Getting repair location…');
    const point = await getLivePoint();
    const path = `/reports/${encodeURIComponent(authorityLinkContext.reportId)}`;
    const upload = await api(`${path}/authority-upload`, { method: 'POST', body: JSON.stringify({ token: authorityLinkContext.token, fileName: file.name, contentType: file.type, size: file.size }) });
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!response.ok) throw new Error('The fix photo could not be uploaded. Try again.');
    const result = await api(`${path}/authority-confirm`, { method: 'POST', body: JSON.stringify({ token: authorityLinkContext.token, evidenceKey: upload.evidenceKey, ...point }) });
    authorityLinkContext = null;
    byId('authority-proof-dialog').close();
    if (cloudMode) await refreshReports();
    showToast(result.message);
  } catch (error) { showToast(error.message || 'Could not submit the fix evidence.'); }
}

function ageLabel(createdAt) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 3600000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function requireSignIn() {
  if (!cloudMode || window.CivicAuth.token()) return true;
  showToast('Sign in to contribute to shared reports.');
  window.CivicAuth.signIn();
  return false;
}

function renderReportList(items) {
  const visible = showingAll ? items : items.filter((report) => report.status !== 'verified').slice(0, 4);
  byId('report-list').innerHTML = visible.length ? visible.map((report) => `
    <button class="report-card" type="button" data-report-id="${esc(report.id)}" aria-label="Open report ${esc(report.title)}">
      <span class="report-illustration ${categoryStyle(report.category)}" aria-hidden="true">${esc(report.icon || '•')}</span>
      <span class="report-info"><span class="report-title">${esc(report.title)}</span><span class="report-meta"><span>${esc(report.place || report.city)}</span><i class="meta-dot"></i><span>${esc(report.age || 'just now')}</span></span><span class="status-badge ${statusClass(report.status)}">${esc(reportStatusLabel(report))}</span></span>
      <span class="report-checks"><strong>${Number(report.checks) || 0}</strong>checks</span>
    </button>`).join('') : '<div class="ward-empty">No reports here yet. Be the first to add one.</div>';
  byId('all-reports-button').innerHTML = showingAll ? 'Show reports needing a check <span aria-hidden="true">↑</span>' : `View all ${items.length} reports <span aria-hidden="true">→</span>`;
}

function categoryStyle(category = '') {
  const text = category.toLowerCase();
  if (text.includes('water') || text.includes('tap')) return 'water';
  if (text.includes('drain')) return 'drain';
  if (text.includes('battery') || text.includes('e-waste')) return 'battery';
  return '';
}

function renderMap(items) {
  const hasLocation = currentLocation?.city === activeCity;
  const center = hasLocation ? [currentLocation.lat, currentLocation.lng] : (CITIES[activeCity] || CITIES.Other).center;
  if (!window.L) return;
  if (!map) {
    document.querySelector('.map-fallback')?.remove();
    map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView(center, hasLocation ? 14 : (CITIES[activeCity] || CITIES.Other).zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on('click', async (event) => {
      const nearest = Object.entries(CITIES).filter(([city]) => city !== 'Other').sort((a, b) => distanceKm(event.latlng.lat, event.latlng.lng, ...a[1].center) - distanceKm(event.latlng.lat, event.latlng.lng, ...b[1].center))[0];
      const city = nearest && distanceKm(event.latlng.lat, event.latlng.lng, ...nearest[1].center) < 60 ? nearest[0] : 'Other';
      const changedCity = city !== activeCity;
      activeCity = city;
      currentLocation = { lat: event.latlng.lat, lng: event.latlng.lng, city: activeCity };
      byId('city-select').value = activeCity;
      updateLocationLabel();
      if (changedCity && cloudMode) {
        try { await refreshReports(); } catch (error) { render(); showToast(error.message); }
      } else render();
      showToast('Report pin placed. Open “Report issue” to use it.');
    });
    setTimeout(() => map.invalidateSize(), 100);
  } else {
    map.setView(center, hasLocation ? 14 : (CITIES[activeCity] || CITIES.Other).zoom, { animate: false });
  }
  markerLayer.clearLayers();
  items.forEach((report) => {
    const marker = L.marker([report.lat, report.lng], { icon: L.divIcon({ className: '', html: `<span class="report-marker ${statusClass(report.status) || 'open'}"><span></span></span>`, iconSize: [30, 30], iconAnchor: [15, 28] }) });
    marker.addTo(markerLayer).bindTooltip(esc(report.title), { direction: 'top', offset: [0, -15] }).on('click', () => openDetails(report.id));
  });
  if (currentLocation && currentLocation.city === activeCity) {
    L.circleMarker([currentLocation.lat, currentLocation.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#367db0', fillOpacity: 1 }).addTo(markerLayer).bindTooltip('Your location');
  }
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function openDetails(id) {
  const report = reports.find((item) => item.id === id);
  if (!report) return;
  selectedReportId = id;
  let ownReport = false;
  try { ownReport = JSON.parse(localStorage.getItem(OWN_REPORTS_KEY) || '[]').includes(id); } catch { /* Ownership is still enforced by the API. */ }
  const dialog = byId('detail-dialog');
  byId('detail-content').innerHTML = `
    <div class="detail-top"><div><span class="detail-category">${esc(report.category)}</span><h2 class="detail-title">${esc(report.title)}</h2><p class="detail-sub">${esc(report.place || report.city)} · ${esc(report.age || 'just now')} · ${esc(report.id)}</p></div><button class="icon-button close-detail" type="button" aria-label="Close">×</button></div>
    <div class="detail-status-row"><span class="status-badge ${statusClass(report.status)}">${esc(reportStatusLabel(report))}</span></div>
    <p class="detail-description">${esc(report.details || report.summary || 'A community report has been added for this location.')}</p>
    ${report.summary ? `<p class="detail-description"><strong>Reviewed report draft:</strong> ${esc(report.summary)}</p>` : ''}
    <p class="detail-location">⌖ ${Number(report.lat).toFixed(4)}, ${Number(report.lng).toFixed(4)} · approximate report location${report.wardNumber ? `<br>Ward ${esc(report.wardNumber)} · ${esc(report.wardName)} · ${esc(report.corporation || '')}` : ''}</p>
    ${report.photoName ? `<p class="detail-location">▧ Evidence ${cloudMode ? 'uploaded privately' : 'selected'}: ${esc(report.photoName)} <span class="draft-row">${cloudMode ? 'Evidence is available through signed links.' : 'Session preview only; media is not uploaded or saved.'}</span>${cloudMode ? `<button class="text-button" type="button" data-evidence="${esc(report.id)}">View evidence</button><span class="evidence-links" data-evidence-links="${esc(report.id)}"></span>` : ''}</p>` : ''}
    ${report.hasAuthorityProof && cloudMode ? `<p class="detail-location">▧ Authority fix photo <button class="text-button" type="button" data-fix-evidence="${esc(report.id)}">View repair evidence</button><span class="evidence-links" data-fix-evidence-link="${esc(report.id)}"></span></p>` : ''}
    ${report.instagramStatus === 'published' ? `<p class="detail-location">Instagram follow-up published.${report.instagramPermalink?.startsWith('https://www.instagram.com/') ? ` <a href="${esc(report.instagramPermalink)}" target="_blank" rel="noopener">View post</a>` : ''}</p>` : report.allowInstagram && !report.instagramStatus ? `<p class="detail-location">Public Instagram follow-up is scheduled only if this remains unresolved after 7 days and a neighbor confirms it. <button class="text-button" type="button" data-instagram-opt-out="${esc(report.id)}">Cancel public follow-up</button></p>` : ''}
    <div class="detail-counts"><span><strong>${Number(report.checks) || 0}</strong> community checks</span><span><strong>${Number(report.fixChecks) || 0}</strong> fix confirmations</span></div>
    <div class="checkin-box"><strong>Passing by? Add a quick check</strong><p>Your check updates this report; it won't create a duplicate ticket.</p><div class="checkin-actions"><button class="button button-outline" type="button" data-check="still">Still there</button><button class="button button-outline" type="button" data-check="fixed">Looks fixed</button><button class="button button-quiet" type="button" data-check="unsure">Can't verify</button></div></div>
    <div class="detail-actions"><button class="button button-quiet share-trigger" type="button">Share update</button>${ownReport ? `<button class="button button-quiet" type="button" data-cancel-report="${esc(id)}">Cancel report</button>` : ''}<button class="button button-primary" type="button" data-close-detail>Done</button></div>`;
  if (!dialog.open) dialog.showModal();
  if (cloudMode && report.photoName) byId('detail-content').querySelector('[data-evidence]')?.click();
}

async function applyCheck(kind) {
  const report = reports.find((item) => item.id === selectedReportId);
  if (!report) return;
  if (kind === 'unsure') { showToast('Thanks for checking. No change was made to the report.'); byId('detail-dialog').close(); return; }
  if (cloudMode) {
    if (!requireSignIn()) return;
    try {
      await api(`/reports/${encodeURIComponent(report.id)}/check`, { method: 'POST', body: JSON.stringify({ kind }) });
      await refreshReports();
      openDetails(report.id);
      showToast(kind === 'fixed' ? 'Fix noted. Two distinct neighbor checks verify it.' : 'Added to the shared report. Thanks for checking in.');
    } catch (error) { showToast(error.message); }
    return;
  }
  report.checkins ||= {};
  const previous = report.checkins[demoClientId];
  if (!previous) report.checks = (Number(report.checks) || 0) + 1;
  if (previous === 'fixed' && kind === 'still') report.fixChecks = Math.max(0, (Number(report.fixChecks) || 0) - 1);
  if (previous !== 'fixed' && kind === 'fixed') report.fixChecks = (Number(report.fixChecks) || 0) + 1;
  report.checkins[demoClientId] = kind;
  report.status = report.fixChecks >= 2 ? 'verified' : kind === 'fixed' ? 'claimed' : report.status === 'claimed' || report.status === 'verified' ? 'progress' : report.status;
  persist(); render(); openDetails(selectedReportId);
  showToast(kind === 'still' ? previous ? 'Your check-in was updated.' : 'Added to this report. Thanks for checking in.' : report.status === 'verified' ? 'Community verification complete.' : previous ? 'Your check-in was updated.' : 'Fix noted. One more neighbor check can verify it.');
}

function locateUser({ notify = false, forReport = false } = {}) {
  if (!navigator.geolocation) { showToast('Location is not available in this browser.'); return; }
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition(async (position) => {
    const { latitude: lat, longitude: lng } = position.coords;
    const nearest = Object.entries(CITIES).filter(([city]) => city !== 'Other').sort((a, b) => distanceKm(lat, lng, ...a[1].center) - distanceKm(lat, lng, ...b[1].center))[0];
    const city = nearest && distanceKm(lat, lng, ...nearest[1].center) < 60 ? nearest[0] : 'Other';
    const changedCity = city !== activeCity;
    currentLocation = { lat, lng, city };
    if (forReport) reportLocationReady = true;
    if (changedCity) { activeCity = city; byId('city-select').value = city; }
    if (map) map.setView([lat, lng], 14);
    updateLocationLabel();
    if (forReport) updateCaptureReady();
    if (changedCity && cloudMode) { try { await refreshReports(); } catch (error) { render(); showToast(error.message); } }
    else render();
    if (byId('issue-city').value === 'Other') byId('issue-city').value = '';
    if (city !== 'Other') byId('issue-city').value = city;
    const close = nearbyItems().map((report) => ({ report, distance: distanceKm(lat, lng, report.lat, report.lng) })).filter((item) => item.distance <= 1.5).sort((a, b) => a.distance - b.distance);
    if (close.length) {
      showToast(`${close.length} open report${close.length === 1 ? '' : 's'} within 1.5 km. Tap a pin or card to check.`);
    } else showToast('No open reports found within 1.5 km.');
    if (notify) notifyPassingReports(lat, lng);
  }, () => {
    if (forReport) { reportLocationReady = false; updateCaptureReady(); }
    showToast(forReport ? 'Location permission was unavailable. Enable it to analyze this report.' : 'Location permission was unavailable. You can still browse the map.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function updateLocationLabel() {
  if (!currentLocation) return;
  byId('location-label').textContent = 'Location added';
  byId('location-coords').textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`;
}

function cityForPoint(lat, lng) {
  const nearest = Object.entries(CITIES).filter(([city]) => city !== 'Other').sort((a, b) => distanceKm(lat, lng, ...a[1].center) - distanceKm(lat, lng, ...b[1].center))[0];
  return nearest && distanceKm(lat, lng, ...nearest[1].center) < 60 ? nearest[0] : 'Other';
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function notifyPassingReports(lat, lng) {
  if (localStorage.getItem(ALERTS_KEY) !== 'on') return;
  const close = cityReports().filter((report) => report.status !== 'verified' && Number.isFinite(Number(report.lat)) && distanceKm(lat, lng, Number(report.lat), Number(report.lng)) <= 0.3);
  for (const report of close) {
    if (notifiedNearby.has(report.id)) continue;
    notifiedNearby.add(report.id);
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('Civicloop · issue nearby', { body: `${report.title} · can you check whether it is still there?`, tag: `civicloop-${report.id}` });
      notification.onclick = () => { window.focus(); openDetails(report.id); notification.close(); };
    } else showToast(`Nearby report: ${report.title}. Tap its pin to check it.`);
  }
}

function startNearbyWatch() {
  if (!navigator.geolocation || locationWatchId !== null) return;
  locationWatchId = navigator.geolocation.watchPosition(async ({ coords }) => {
    const { latitude: lat, longitude: lng } = coords;
    const nearest = Object.entries(CITIES).filter(([city]) => city !== 'Other').map(([city, value]) => ({ city, distance: distanceKm(lat, lng, ...value.center) })).sort((a, b) => a.distance - b.distance)[0];
    const city = nearest && nearest.distance < 60 ? nearest.city : 'Other';
    const changedCity = city !== activeCity;
    currentLocation = { lat, lng, city };
    if (changedCity) {
      activeCity = city;
      byId('city-select').value = city;
      if (cloudMode) { lastNearbyRefreshAt = Date.now(); try { await refreshReports(); } catch { render(); } }
      else render();
    }
    if (cloudMode && Date.now() - lastNearbyRefreshAt > 60000) {
      lastNearbyRefreshAt = Date.now();
      try { await refreshReports(); } catch { /* Nearby checks continue with the last loaded report list. */ }
    }
    notifyPassingReports(lat, lng);
  }, () => showToast('Nearby reminders need location access while Civicloop is open.'), { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 });
}

async function canvasJpeg(source, width, height) {
  const scale = Math.min(1, 900 / width, 900 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.62, 0.48, 0.34]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 220000) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return btoa(binary);
    }
  }
  throw new Error('A preview was too large to analyze. Choose a smaller photo or shorter video.');
}

async function imagePreviewBase64(file) {
  const bitmap = await createImageBitmap(file);
  try { return await canvasJpeg(bitmap, bitmap.width, bitmap.height); }
  finally { bitmap.close?.(); }
}

async function videoPreviewFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Could not read this video. Use an MP4 or MOV video.'));
    });
    if (!Number.isFinite(video.duration) || video.duration > 15) throw new Error('Videos must be 15 seconds or shorter.');
    const times = [...new Set([Math.min(0.3, video.duration / 3), video.duration / 2, Math.max(0, video.duration - 0.15)])];
    const frames = [];
    for (const time of times) {
      video.currentTime = time;
      await new Promise((resolve) => { video.onseeked = resolve; });
      frames.push(await canvasJpeg(video, video.videoWidth, video.videoHeight));
    }
    return frames;
  } finally {
    video.src = '';
    URL.revokeObjectURL(url);
  }
}

function showReportReview(inspected, version) {
  const { draft, location: place } = inspected;
  const instagramReady = Boolean(window.CIVICLOOP_CONFIG?.instagramEnabled);
  const supportedEvidence = selectedEvidenceFiles.some((file) => ['image/jpeg', 'image/png', 'video/mp4'].includes(file.type));
  byId('allow-instagram').disabled = !instagramReady || !supportedEvidence;
  byId('instagram-help').textContent = !instagramReady ? 'Instagram publishing will be available after Civicloop connects its professional account.' : !supportedEvidence ? 'Automatic posting requires a JPEG/PNG photo or MP4 video.' : 'If this issue remains unresolved after 7 days and someone confirms it is still there, Civicloop may automatically post one photo or video and a factual caption to its professional Instagram account. Anyone may see and reshare it. Only choose this if the evidence contains no faces, license plates, or private details.';
  byId('issue-category').value = draft.category;
  byId('issue-title').value = draft.title;
  byId('issue-details').value = draft.details;
  byId('issue-summary').value = draft.summary;
  byId('issue-city').value = place.city;
  byId('issue-place').value = place.place;
  currentLocation = { lat: place.lat, lng: place.lng, city: place.city };
  activeCity = place.city;
  rememberCity(place.city, [place.lat, place.lng]);
  byId('city-select').value = place.city;
  updateLocationLabel();
  const ward = place.ward ? `Ward ${place.ward.number} · ${place.ward.name} · ${place.ward.corporation}` : `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
  const fields = [
    ['Issue type', draft.category],
    ['Title', draft.title],
    ['What Civicloop saw', draft.details],
    ['Location', `${place.place}, ${place.city} · ${ward}`],
    ['Report summary', draft.summary],
  ];
  byId('draft-fields').innerHTML = fields.map(([label, value], index) => `<div class="draft-field" style="--field-order:${index}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  byId('review-evidence').innerHTML = `<strong>${selectedEvidenceFiles.length} evidence file${selectedEvidenceFiles.length === 1 ? '' : 's'} ready</strong><div>${selectedEvidenceFiles.map((file, index) => `<button class="text-button" type="button" data-preview-index="${index}">View ${index + 1}</button>`).join(' ')}</div><div id="review-media"></div>`;
  showReviewMedia();
  byId('vision-note').textContent = draft.visualDraftBy === 'bedrock' ? 'The vision agent filled these details from your evidence. Check them before creating.' : 'Vision analysis was unavailable. This cautious draft asks for an inspection; use different evidence if it misses the issue.';
  setReportPhase('review');
  clearTimeout(reviewRevealTimer);
  reviewRevealTimer = setTimeout(() => {
    if (version === reportVersion && byId('report-dialog').open) byId('submit-report-button').hidden = false;
  }, 1100);
}

async function analyzeReport() {
  const files = [...selectedEvidenceFiles];
  const videos = files.filter((file) => file.type.startsWith('video/'));
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!files.length || !reportLocationReady || !currentLocation) { showToast('Add evidence and enable your location first.'); return; }
  if (files.length > 5 || videos.length > 1 || images.length > 4 || (videos.length && images.length) || files.some((file) => file.size > 25 * 1024 * 1024)) { showToast('Choose up to four photos or one video, each under 25 MB.'); return; }
  if (!cloudMode) { showToast('AI analysis needs the live Civicloop app.'); return; }
  if (!requireSignIn()) return;
  const version = ++reportVersion;
  const point = { ...currentLocation };
  const city = point.city || activeCity;
  const place = 'Pinned location';
  let visionTimer;
  setReportPhase('workflow');
  setWorkflowStep(0);
  try {
    const visionImages = [];
    const videoFrames = [];
    for (const file of images) visionImages.push(await imagePreviewBase64(file));
    for (const file of videos) videoFrames.push(...await videoPreviewFrames(file));
    if ([...visionImages, ...videoFrames].reduce((sum, frame) => sum + frame.length, 0) > 1600000) throw new Error('Choose fewer or smaller evidence files for AI review.');
    if (version !== reportVersion) return;
    setWorkflowStep(1);
    const { draftId } = await api('/reports/draft', { method: 'POST', body: JSON.stringify({ city, place, lat: point.lat, lng: point.lng }) });
    if (version !== reportVersion) return;
    pendingDraftId = draftId;
    const evidenceKeys = [];
    for (const file of files) {
      const upload = await api(`/reports/${encodeURIComponent(draftId)}/upload`, { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }) });
      const uploaded = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!uploaded.ok) throw new Error(`Could not upload ${file.name}.`);
      await api(`/reports/${encodeURIComponent(draftId)}/evidence`, { method: 'POST', body: JSON.stringify({ evidenceKey: upload.evidenceKey, fileName: file.name }) });
      evidenceKeys.push(upload.evidenceKey);
    }
    if (version !== reportVersion) return;
    setWorkflowStep(2);
    visionTimer = setTimeout(() => { if (version === reportVersion) setWorkflowStep(3); }, 1200);
    const inspected = await api('/agent/inspect', { method: 'POST', body: JSON.stringify({ draftId, city, place, liveLocation: { lat: point.lat, lng: point.lng }, evidenceKeys, visionImages, videoFrames }) });
    clearTimeout(visionTimer);
    if (version !== reportVersion) return;
    if (!inspected.draft?.category || !inspected.draft?.title || !inspected.draft?.details) throw new Error('Civicloop could not draft this report. Try a clearer photo.');
    setWorkflowStep(3);
    showReportReview(inspected, version);
  } catch (error) {
    clearTimeout(visionTimer);
    if (version !== reportVersion) return;
    pendingDraftId = null;
    setReportPhase('capture');
    showToast(error.message || 'Could not analyze this evidence. Try again.');
  }
}

async function createReport(event) {
  event.preventDefault();
  if (reportPhase !== 'review' || !pendingDraftId) return;
  if (!requireSignIn()) return;
  const button = byId('submit-report-button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Creating report…';
  try {
    const category = byId('issue-category').value;
    const title = byId('issue-title').value.trim();
    const details = byId('issue-details').value.trim();
    if (!category || !title || !details) throw new Error('The AI draft is incomplete. Use different evidence and try again.');
    const result = await api('/reports', { method: 'POST', body: JSON.stringify({ draftId: pendingDraftId, category, title, details, summary: byId('issue-summary').value.trim(), allowInstagram: byId('allow-instagram').checked }) });
    const report = result.report;
    try { localStorage.setItem(OWN_REPORTS_KEY, JSON.stringify([...new Set([...JSON.parse(localStorage.getItem(OWN_REPORTS_KEY) || '[]'), report.id])])); } catch { /* The server still checks ownership. */ }
    reports.unshift({ ...report, age: 'just now', ageHours: 0, icon: iconForCategory(report.category) });
    let note = 'Report created.';
    try {
      const sent = await api(`/reports/${encodeURIComponent(report.id)}/dispatch`, { method: 'POST', body: JSON.stringify({ confirmed: true, demoOnly: true }) });
      note = `Report emailed to ${sent.recipientLabel}.`;
    } catch (error) { note = `Report created, but email failed: ${error.message}`; }
    pendingDraftId = null;
    try { await refreshReports(); } catch { render(); note ||= 'Report saved. Refresh to load the latest shared neighborhood feed.'; }
    byId('report-dialog').close(); byId('report-form').reset(); resetPhotoPreview();
    showToast(note || 'Report shared with the neighborhood.');
    openDetails(report.id);
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Create report <span aria-hidden="true">→</span>'; }
}

function iconForCategory(category = '') {
  if (category.toLowerCase().includes('water')) return '◉';
  if (category.toLowerCase().includes('drain')) return '≋';
  if (category.toLowerCase().includes('battery')) return '▣';
  if (category.toLowerCase().includes('burn')) return '♨';
  return '♻';
}

function showWardDesk() {
  if (cloudMode && !window.CivicAuth.isWard()) { showToast('This view is for assigned ward desk operators.'); return; }
  const list = cityReports().filter((report) => report.status !== 'verified');
  byId('ward-content').innerHTML = `<div class="dialog-head"><div><span class="section-kicker">${cloudMode ? 'ASSIGNED AUTHORITY INBOX' : 'SIMULATED AUTHORITY INBOX'}</span><h2 class="dialog-section-title">Ward desk</h2><p class="dialog-section-copy">${cloudMode ? 'Email and status updates require an assigned WardDesk sign-in.' : 'Demo only · changes stay in this browser.'}</p></div><button class="icon-button close-ward" type="button" aria-label="Close">×</button></div><div class="ward-list">${list.length ? list.map((report) => `<div class="ward-row"><span class="report-illustration ${categoryStyle(report.category)}" aria-hidden="true">${esc(report.icon || '•')}</span><div><strong>${esc(report.title)}</strong><small>${esc(report.place || report.city)} · ${esc(report.id)} · ${esc(reportStatusLabel(report))}</small></div><button class="button button-outline" type="button" data-ack="${esc(report.id)}">${report.status === 'open' ? 'Acknowledge' : 'Mark fix'}</button>${cloudMode ? `<button class="button button-quiet" type="button" data-dispatch="${esc(report.id)}">Email authority</button>` : ''}</div>`).join('') : '<div class="ward-empty">Everything in this area is community verified.</div>'}</div>`;
  if (!byId('ward-dialog').open) byId('ward-dialog').showModal();
}

async function authorityUpdate(id) {
  const report = reports.find((item) => item.id === id);
  if (!report) return;
  if (cloudMode) {
    try {
      await api(`/reports/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status: report.status === 'open' ? 'progress' : 'claimed' }) });
      await refreshReports();
      showWardDesk();
    } catch (error) { showToast(error.message); }
    return;
  }
  if (report.status === 'open') report.status = 'progress';
  else { report.status = 'claimed'; report.fixChecks = 0; }
  persist(); render(); showWardDesk();
}

async function dispatchAuthorityEmail(id) {
  if (!requireSignIn()) return;
  const report = reports.find((item) => item.id === id);
  if (!report) return;
  try {
    const route = await api(`/authority?city=${encodeURIComponent(report.city)}&place=${encodeURIComponent(report.place || '')}&wardNumber=${encodeURIComponent(report.wardNumber || '')}&corporation=${encodeURIComponent(report.corporation || '')}`);
    if (!route.canSend) { showToast('Configure Yahoo Mail or SES and a recipient before sending email.'); return; }
    const summary = report.summary || report.details;
    const confirmed = window.confirm(`Send this report email to ${route.recipientLabel}?\n\n${report.title}\n${summary}\nArea: ${report.place || report.city}\nLocation: ${report.lat}, ${report.lng}\nEvidence: ${report.photoName || 'None'}\n\nThe email will use the reviewed report draft. Continue?`);
    if (!confirmed) return;
    await api(`/reports/${encodeURIComponent(id)}/dispatch`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
    await refreshReports();
    showWardDesk();
    showToast(`Email sent to ${route.recipientLabel}.`);
  } catch (error) { showToast(error.message); }
}

async function showShareDialog() {
  const report = reports.find((item) => item.id === selectedReportId);
  if (!report) return;
  const createdAt = typeof report.createdAt === 'number' ? report.createdAt : Date.parse(report.createdAt || '');
  const ageHours = Number.isFinite(Number(report.ageHours)) ? Number(report.ageHours) : Number.isFinite(createdAt) ? (Date.now() - createdAt) / 3600000 : 0;
  if (report.status === 'verified' || ageHours < 24) { showToast('Follow-up sharing is available after an unresolved report has been open for 24 hours.'); return; }
  let text = `Community update · ${report.id}\n${report.title}\n${report.place || report.city} · reported ${report.age || 'just now'}\nStatus: ${statusLabels[report.status] || 'Needs attention'}\n${report.checks} community check${report.checks === 1 ? '' : 's'}. Please use the relevant official reporting channel for follow-up.`;
  if (cloudMode) {
    if (!requireSignIn()) return;
    try {
      const { draft } = await api(`/reports/${encodeURIComponent(report.id)}/ai`, { method: 'POST', body: JSON.stringify({ task: 'follow-up' }) });
      text = `${draft.shareDraft || text}\n\nRecommendation: ${draft.recommendation || 'Review the report before sharing.'}`;
    } catch (error) { showToast(error.message); return; }
  }
  byId('share-content').innerHTML = `<div class="dialog-head"><div><span class="section-kicker">USER-REVIEWED UPDATE</span><h2 class="dialog-section-title">Share this report</h2><p class="dialog-section-copy">Review the wording. Civicloop won't post or tag anyone automatically.</p></div><button class="icon-button close-share" type="button" aria-label="Close">×</button></div><textarea class="share-text" id="share-text" maxlength="500" aria-label="Edit share text">${esc(text)}</textarea><div class="share-footer"><button class="button button-quiet close-share" type="button">Cancel</button><button class="button button-outline copy-share" type="button">Copy text</button><button class="button button-primary system-share" type="button">Share update</button></div>`;
  byId('share-dialog').showModal();
}

function resetPhotoPreview() {
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = [];
  selectedEvidenceFiles = [];
  previewIndex = 0;
  byId('photo-preview').replaceChildren();
  byId('photo-preview').hidden = true;
  byId('photo-name').textContent = 'Up to 4 photos or 1 video · max 15 sec';
  pendingDraftId = null;
  clearTimeout(reviewRevealTimer);
  byId('submit-report-button').hidden = true;
}

function handlePhoto() {
  addEvidence(Array.from(byId('issue-photo').files || []));
  byId('issue-photo').value = '';
}

function addEvidence(newFiles) {
  const files = [...selectedEvidenceFiles, ...newFiles];
  const videos = files.filter((file) => file.type.startsWith('video/'));
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (files.length > 5 || videos.length > 1 || images.length > 4 || (videos.length && images.length) || files.some((file) => file.size > 25 * 1024 * 1024)) {
    showToast('Choose up to four photos or one video, each under 25 MB.');
    return;
  }
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = [];
  selectedEvidenceFiles = files;
  previewIndex = Math.max(0, files.length - 1);
  if (!files.length) { updateCaptureReady(); return; }
  byId('photo-name').textContent = `${files.length} file${files.length === 1 ? '' : 's'} selected · up to 4 photos or 1 video`;
  photoPreviewUrls = files.map((file) => URL.createObjectURL(file));
  renderEvidencePreview();
  updateCaptureReady();
}

function renderEvidencePreview() {
  const file = selectedEvidenceFiles[previewIndex];
  if (!file) return;
  const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
  media.src = photoPreviewUrls[previewIndex];
  if (media.tagName === 'VIDEO') { media.controls = true; media.muted = true; }
  else media.alt = `Evidence photo ${previewIndex + 1}`;
  const controls = document.createElement('div');
  controls.className = 'evidence-nav';
  controls.innerHTML = `<button type="button" data-preview-step="-1" aria-label="Previous evidence">←</button><span>${previewIndex + 1} of ${selectedEvidenceFiles.length}</span><button type="button" data-preview-step="1" aria-label="Next evidence">→</button>`;
  byId('photo-preview').replaceChildren(media, controls);
  byId('photo-preview').hidden = false;
}

function showReviewMedia() {
  const target = byId('review-media');
  if (!target || !photoPreviewUrls[previewIndex]) return;
  target.innerHTML = selectedEvidenceFiles[previewIndex].type.startsWith('video/') ? `<video controls muted src="${esc(photoPreviewUrls[previewIndex])}"></video>` : `<img src="${esc(photoPreviewUrls[previewIndex])}" alt="Evidence photo ${previewIndex + 1}">`;
}

function renderDetailGallery(list) {
  const file = list.galleryFiles[list.galleryIndex];
  list.querySelector('.gallery-count').textContent = `${list.galleryIndex + 1} of ${list.galleryFiles.length}`;
  list.querySelector('.detail-gallery-media').innerHTML = `${file.contentType?.startsWith('video/') ? `<video controls src="${esc(file.url)}"></video>` : `<img src="${esc(file.url)}" alt="Report evidence ${list.galleryIndex + 1}">`}<a href="${esc(file.url)}" target="_blank" rel="noopener">Open ${esc(file.fileName || 'evidence')}</a>`;
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  byId('camera-video').srcObject = null;
  byId('camera-panel').hidden = true;
}

async function openCamera() {
  try {
    const point = await getLivePoint();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    stopCamera();
    cameraStream = stream;
    currentLocation = { ...point, city: cityForPoint(point.lat, point.lng) };
    reportLocationReady = true;
    updateLocationLabel();
    byId('camera-video').srcObject = stream;
    byId('camera-coords').textContent = `Live GPS · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    byId('camera-panel').hidden = false;
    updateCaptureReady();
  } catch (error) { stopCamera(); showToast(error.message || 'Allow camera and location access to capture a geotagged photo.'); }
}

async function captureCamera() {
  const video = byId('camera-video');
  if (!cameraStream || !video.videoWidth) { showToast('Camera is still starting. Try again.'); return; }
  try {
    const point = await getLivePoint();
    currentLocation = { ...point, city: cityForPoint(point.lat, point.lng) };
    reportLocationReady = true;
    updateLocationLabel();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0);
    const tag = `${new Date().toISOString()} · GPS ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    context.font = `${Math.max(16, Math.floor(canvas.width / 45))}px sans-serif`;
    const width = context.measureText(tag).width + 24;
    context.fillStyle = 'rgba(0,0,0,.7)'; context.fillRect(0, canvas.height - 48, width, 48);
    context.fillStyle = '#fff'; context.fillText(tag, 12, canvas.height - 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not capture the photo.');
    addEvidence([new File([blob], `civicloop-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
    stopCamera();
  } catch (error) { showToast(error.message || 'Could not capture the photo.'); }
}

async function toggleNearbyAlerts() {
  const enabled = localStorage.getItem(ALERTS_KEY) === 'on';
  if (enabled) {
    localStorage.setItem(ALERTS_KEY, 'off');
    if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    render(); showToast('Nearby alerts turned off.'); return;
  }
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  localStorage.setItem(ALERTS_KEY, 'on'); render();
  startNearbyWatch();
  showToast('Nearby reminders are on while Civicloop is open.');
  if (currentLocation) notifyPassingReports(currentLocation.lat, currentLocation.lng);
}

async function shareUpdate() {
  const text = byId('share-text').value.trim();
  if (navigator.share) {
    try { await navigator.share({ title: 'Civicloop community update', text }); byId('share-dialog').close(); }
    catch (error) { if (error.name !== 'AbortError') showToast('Could not open the share sheet.'); }
    return;
  }
  try { await navigator.clipboard.writeText(text); byId('share-dialog').close(); showToast('Update copied. Choose where you want to share it.'); }
  catch { byId('share-dialog').close(); showToast('Copy the update from the share sheet if your browser supports it.'); }
}

function openReportDialog() {
  reportVersion++;
  stopCamera();
  byId('report-form').reset();
  resetPhotoPreview();
  reportLocationReady = false;
  byId('issue-city').value = activeCity;
  byId('location-label').textContent = 'Enable location';
  byId('location-coords').textContent = 'Use your current GPS';
  setReportPhase('capture');
  if (!byId('report-dialog').open) byId('report-dialog').showModal();
}

document.querySelectorAll('[data-open-report]').forEach((button) => button.addEventListener('click', openReportDialog));
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => byId('report-dialog').close()));
byId('report-dialog').addEventListener('close', () => { reportVersion++; clearTimeout(reviewRevealTimer); stopCamera(); });
byId('report-form').addEventListener('submit', createReport);
byId('auth-button').addEventListener('click', () => window.CivicAuth.token() ? window.CivicAuth.signOut() : window.CivicAuth.signIn());
byId('analyze-report-button').addEventListener('click', analyzeReport);
byId('restart-report').addEventListener('click', openReportDialog);
byId('issue-photo').addEventListener('change', handlePhoto);
byId('open-camera-button').addEventListener('click', openCamera);
byId('close-camera-button').addEventListener('click', stopCamera);
byId('capture-camera-button').addEventListener('click', captureCamera);
byId('photo-preview').addEventListener('click', (event) => { const step = event.target.closest('[data-preview-step]'); if (step) { previewIndex = (previewIndex + Number(step.dataset.previewStep) + selectedEvidenceFiles.length) % selectedEvidenceFiles.length; renderEvidencePreview(); } });
byId('review-evidence').addEventListener('click', (event) => { const button = event.target.closest('[data-preview-index]'); if (button) { previewIndex = Number(button.dataset.previewIndex); showReviewMedia(); } });
byId('form-location-button').addEventListener('click', () => locateUser({ forReport: true }));
byId('locate-button').addEventListener('click', () => locateUser());
byId('bottom-check-button').addEventListener('click', () => locateUser({ notify: true }));
byId('nearby-alerts-button').addEventListener('click', toggleNearbyAlerts);
byId('city-select').addEventListener('change', async (event) => { activeCity = event.target.value; currentLocation = null; byId('location-label').textContent = 'Add location'; byId('location-coords').textContent = 'Choose to use GPS'; render(); if (cloudMode) { try { await refreshReports(); } catch (error) { showToast(error.message); } } });
for (const city of Object.keys(CITIES)) rememberCity(city);
byId('all-reports-button').addEventListener('click', () => { showingAll = !showingAll; render(); });
byId('filter-button').addEventListener('click', () => { showingAll = !showingAll; render(); showToast(showingAll ? 'Showing all reports.' : 'Showing reports that need a check.'); });
byId('report-list').addEventListener('click', (event) => { const card = event.target.closest('[data-report-id]'); if (card) openDetails(card.dataset.reportId); });
byId('ward-button').addEventListener('click', showWardDesk);
byId('ward-dialog').addEventListener('click', (event) => {
  if (event.target.closest('.close-ward')) byId('ward-dialog').close();
  const button = event.target.closest('[data-ack]'); if (button) authorityUpdate(button.dataset.ack);
  const dispatch = event.target.closest('[data-dispatch]'); if (dispatch) dispatchAuthorityEmail(dispatch.dataset.dispatch);
});
byId('detail-dialog').addEventListener('click', (event) => {
  const galleryStep = event.target.closest('[data-gallery-step]'); if (galleryStep) { const list = galleryStep.closest('[data-evidence-links]'); list.galleryIndex = (list.galleryIndex + Number(galleryStep.dataset.galleryStep) + list.galleryFiles.length) % list.galleryFiles.length; renderDetailGallery(list); }
  if (event.target.closest('.close-detail, [data-close-detail]')) byId('detail-dialog').close();
  const check = event.target.closest('[data-check]'); if (check) applyCheck(check.dataset.check);
  const cancel = event.target.closest('[data-cancel-report]'); if (cancel && window.confirm('Cancel this report? It will be removed from the community feed. An email already sent cannot be recalled.')) {
    api(`/reports/${encodeURIComponent(cancel.dataset.cancelReport)}/cancel`, { method: 'POST' }).then(async () => { byId('detail-dialog').close(); await refreshReports(); showToast('Report cancelled.'); }).catch((error) => showToast(error.message));
  }
  if (event.target.closest('.share-trigger')) showShareDialog();
  const optOut = event.target.closest('[data-instagram-opt-out]'); if (optOut) {
    if (!requireSignIn()) return;
    api(`/reports/${encodeURIComponent(optOut.dataset.instagramOptOut)}/instagram-opt-out`, { method: 'POST' }).then(async () => { await refreshReports(); openDetails(optOut.dataset.instagramOptOut); showToast('Public Instagram follow-up cancelled.'); }).catch((error) => showToast(error.message));
  }
  const evidence = event.target.closest('[data-evidence]'); if (evidence) api(`/reports/${encodeURIComponent(evidence.dataset.evidence)}/evidence`).then(({ files }) => {
    const list = byId('detail-content').querySelector(`[data-evidence-links="${CSS.escape(evidence.dataset.evidence)}"]`);
    if (list) { list.innerHTML = `<div class="detail-gallery"><div class="detail-gallery-media"></div><div class="evidence-nav"><button type="button" data-gallery-step="-1">←</button><span class="gallery-count"></span><button type="button" data-gallery-step="1">→</button></div></div>`; list.galleryFiles = files; list.galleryIndex = 0; renderDetailGallery(list); }
  }).catch((error) => showToast(error.message));
  const fixEvidence = event.target.closest('[data-fix-evidence]'); if (fixEvidence) api(`/reports/${encodeURIComponent(fixEvidence.dataset.fixEvidence)}/fix-evidence`).then(({ url }) => {
    const list = byId('detail-content').querySelector(`[data-fix-evidence-link="${CSS.escape(fixEvidence.dataset.fixEvidence)}"]`);
    if (list) list.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">Open repair photo</a>`;
  }).catch((error) => showToast(error.message));
});
byId('share-dialog').addEventListener('click', (event) => {
  if (event.target.closest('.close-share')) byId('share-dialog').close();
  if (event.target.closest('.copy-share')) {
    navigator.clipboard?.writeText(byId('share-text').value).then(() => { byId('share-dialog').close(); showToast('Update copied. Choose where you want to share it.'); }).catch(() => showToast('Clipboard is unavailable in this browser.'));
  }
  if (event.target.closest('.system-share')) shareUpdate();
});
byId('report-dialog').addEventListener('click', (event) => { if (event.target === byId('report-dialog')) byId('report-dialog').close(); });
byId('authority-proof-dialog').addEventListener('click', (event) => { if (event.target.closest('.close-authority-proof')) byId('authority-proof-dialog').close(); });
byId('authority-proof-dialog').addEventListener('submit', submitAuthorityProof);
byId('authority-proof-dialog').addEventListener('close', () => { authorityLinkContext = null; });
byId('detail-dialog').addEventListener('close', () => { selectedReportId = null; });

render();
window.CIVICLOOP_AUTH_READY?.then(async () => {
  render();
  if (cloudMode) { try { await refreshReports(); } catch (error) { showToast(error.message); } }
  if (localStorage.getItem(ALERTS_KEY) === 'on') startNearbyWatch();
  await handleAuthorityConfirmationLink();
});
