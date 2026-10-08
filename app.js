const STORAGE_KEY = 'civicloop.reports.v1';
const ALERTS_KEY = 'civicloop.nearby-alerts';
const DEMO_CLIENT_KEY = 'civicloop.demo-client';
const CITIES = {
  Bengaluru: { center: [12.9718, 77.6412], zoom: 13 },
  Delhi: { center: [28.628, 77.218], zoom: 12 },
};
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
let photoPreviewUrl = null;
let showingAll = false;
let toastTimer;
const demoClientId = localStorage.getItem(DEMO_CLIENT_KEY) || (() => {
  const id = globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}`;
  localStorage.setItem(DEMO_CLIENT_KEY, id);
  return id;
})();

const byId = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const statusLabels = { open: 'Needs a check', progress: 'Sent to ward desk', claimed: 'Fix reported · verify', verified: 'Community verified' };

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
function statusClass(status) { return status === 'progress' ? 'progress' : status === 'claimed' ? 'claimed' : status === 'verified' ? 'verified' : ''; }
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
      <span class="report-info"><span class="report-title">${esc(report.title)}</span><span class="report-meta"><span>${esc(report.place || report.city)}</span><i class="meta-dot"></i><span>${esc(report.age || 'just now')}</span></span><span class="status-badge ${statusClass(report.status)}">${esc(statusLabels[report.status] || statusLabels.open)}</span></span>
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
  const center = hasLocation ? [currentLocation.lat, currentLocation.lng] : CITIES[activeCity].center;
  if (!window.L) return;
  if (!map) {
    document.querySelector('.map-fallback')?.remove();
    map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView(center, hasLocation ? 14 : CITIES[activeCity].zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on('click', (event) => {
      currentLocation = { lat: event.latlng.lat, lng: event.latlng.lng, city: activeCity };
      updateLocationLabel();
      renderMap(cityReports());
      showToast('Report pin placed. Open “Report issue” to use it.');
    });
    setTimeout(() => map.invalidateSize(), 100);
  } else {
    map.setView(center, hasLocation ? 14 : CITIES[activeCity].zoom, { animate: false });
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
  const dialog = byId('detail-dialog');
  byId('detail-content').innerHTML = `
    <div class="detail-top"><div><span class="detail-category">${esc(report.category)}</span><h2 class="detail-title">${esc(report.title)}</h2><p class="detail-sub">${esc(report.place || report.city)} · ${esc(report.age || 'just now')} · ${esc(report.id)}</p></div><button class="icon-button close-detail" type="button" aria-label="Close">×</button></div>
    <div class="detail-status-row"><span class="status-badge ${statusClass(report.status)}">${esc(statusLabels[report.status] || statusLabels.open)}</span></div>
    <p class="detail-description">${esc(report.details || report.summary || 'A community report has been added for this location.')}</p>
    ${report.summary ? `<p class="detail-description"><strong>Reviewed report draft:</strong> ${esc(report.summary)}</p>` : ''}
    <p class="detail-location">⌖ ${Number(report.lat).toFixed(4)}, ${Number(report.lng).toFixed(4)} · approximate report location</p>
    ${report.photoName ? `<p class="detail-location">▧ Evidence ${cloudMode ? 'uploaded privately' : 'selected'}: ${esc(report.photoName)} <span class="draft-row">${cloudMode ? 'A signed-in neighbor can open the private file.' : 'Session preview only; media is not uploaded or saved.'}</span>${cloudMode ? `<button class="text-button" type="button" data-evidence="${esc(report.id)}">View evidence</button>` : ''}</p>` : ''}
    <div class="detail-counts"><span><strong>${Number(report.checks) || 0}</strong> community checks</span><span><strong>${Number(report.fixChecks) || 0}</strong> fix confirmations</span></div>
    <div class="checkin-box"><strong>Passing by? Add a quick check</strong><p>Your check updates this report; it won't create a duplicate ticket.</p><div class="checkin-actions"><button class="button button-outline" type="button" data-check="still">Still there</button><button class="button button-outline" type="button" data-check="fixed">Looks fixed</button><button class="button button-quiet" type="button" data-check="unsure">Can't verify</button></div></div>
    <div class="detail-actions"><button class="button button-quiet share-trigger" type="button">Share update</button><button class="button button-primary" type="button" data-close-detail>Done</button></div>`;
  if (!dialog.open) dialog.showModal();
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

function locateUser({ notify = false } = {}) {
  if (!navigator.geolocation) { showToast('Location is not available in this browser.'); return; }
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude: lat, longitude: lng } = position.coords;
    const nearest = Object.entries(CITIES).sort((a, b) => distanceKm(lat, lng, ...a[1].center) - distanceKm(lat, lng, ...b[1].center))[0];
    if (distanceKm(lat, lng, ...nearest[1].center) > 60) { showToast('This demo only has sample locations in Bengaluru and Delhi. Place a map pin in either city to try it.'); return; }
    const city = nearest[0];
    currentLocation = { lat, lng, city };
    if (city !== activeCity) { activeCity = city; byId('city-select').value = city; }
    if (map) map.setView([lat, lng], 14);
    updateLocationLabel();
    render();
    const close = nearbyItems().map((report) => ({ report, distance: distanceKm(lat, lng, report.lat, report.lng) })).filter((item) => item.distance <= 1.5).sort((a, b) => a.distance - b.distance);
    if (close.length) {
      showToast(`${close.length} open report${close.length === 1 ? '' : 's'} within 1.5 km. Tap a pin or card to check.`);
      const followUp = close.find(({ report }) => report.status !== 'verified' && (Date.now() - (report.createdAt || Date.now() - (report.ageHours || 0) * 3600000)) >= 86400000);
      if (notify && followUp && 'Notification' in window && localStorage.getItem(ALERTS_KEY) === 'on' && Notification.permission === 'granted') new Notification('Civicloop · follow-up nearby', { body: `${followUp.report.title} · is it still there?` });
    } else showToast('No open reports found within 1.5 km.');
  }, () => showToast('Location permission was unavailable. You can still browse the map.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function updateLocationLabel() {
  if (!currentLocation) return;
  byId('location-label').textContent = 'Location added';
  byId('location-coords').textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function draftSummary() {
  const category = byId('issue-category').value || 'Environmental issue';
  const title = byId('issue-title').value.trim();
  const details = byId('issue-details').value.trim();
  if (!title && !details) { showToast('Add a title or a few details first.'); return; }
  if (cloudMode) {
    if (!requireSignIn()) return;
    if (!currentLocation) { showToast('Set a map pin or use your location before asking the agent.'); return; }
    try {
      const { draft } = await api('/agent/triage', { method: 'POST', body: JSON.stringify({ city: currentLocation.city, category, title: title || details.slice(0, 72), details, lat: currentLocation.lat, lng: currentLocation.lng }) });
      byId('issue-summary').value = draft.summary || `${category}: ${title || details}`;
      const matches = (draft.duplicateCandidates || []).slice(0, 2).map((item) => `${item.id}: ${item.title}`).join('; ');
      showToast(matches ? `Draft ready. Possible nearby reports: ${matches}` : `${draft.department || 'Triage'} draft ready. Review before submitting.`);
    } catch (error) { showToast(error.message); }
    return;
  }
  byId('issue-summary').value = `${category}: ${title || details}${details && title ? `. ${details}` : ''}`;
  showToast('Draft ready to review. This local demo does not call an AI model.');
}

async function createReport(event) {
  event.preventDefault();
  const title = byId('issue-title').value.trim();
  const details = byId('issue-details').value.trim();
  if (!currentLocation) { showToast('Set a map pin or use your location before submitting.'); return; }
  const city = currentLocation.city;
  const [lat, lng] = [currentLocation.lat, currentLocation.lng];
  if (cloudMode) {
    if (!requireSignIn()) return;
    const file = byId('issue-photo').files[0];
    try {
      const result = await api('/reports', { method: 'POST', body: JSON.stringify({ city, category: byId('issue-category').value, title, details, summary: byId('issue-summary').value.trim(), lat, lng, photoName: file?.name || '' }) });
      const report = result.report;
      reports.unshift({ ...report, age: 'just now', ageHours: 0, icon: iconForCategory(report.category) });
      let note = '';
      if (file) {
        try {
          if (file.size > 25 * 1024 * 1024) throw new Error('Evidence must be under 25 MB.');
          const upload = await api(`/reports/${encodeURIComponent(report.id)}/upload`, { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }) });
          const uploaded = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
          if (!uploaded.ok) throw new Error('The upload was rejected.');
          await api(`/reports/${encodeURIComponent(report.id)}/evidence`, { method: 'POST', body: JSON.stringify({ evidenceKey: upload.evidenceKey, fileName: file.name }) });
        } catch (error) { note = `Report saved; evidence upload failed: ${error.message}`; }
      }
      try { await refreshReports(); } catch { render(); note ||= 'Report saved. Refresh to load the latest shared neighborhood feed.'; }
      byId('report-dialog').close(); byId('report-form').reset(); resetPhotoPreview();
      showToast(note || 'Report shared with the neighborhood.');
      openDetails(report.id);
    } catch (error) { showToast(error.message); }
    return;
  }
  const report = {
    id: `CL-${String(Date.now()).slice(-6)}`, city, category: byId('issue-category').value, title, details, createdAt: Date.now(),
    summary: byId('issue-summary').value.trim(), place: 'Pinned location',
    lat, lng, status: 'open', checks: 0, fixChecks: 0, age: 'just now', icon: iconForCategory(byId('issue-category').value), photoName: byId('issue-photo').files[0]?.name || '',
  };
  reports.unshift(report); persist(); render(); byId('report-dialog').close(); byId('report-form').reset(); resetPhotoPreview();
  showToast('Report added to this browser demo.');
  openDetails(report.id);
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
  byId('ward-content').innerHTML = `<div class="dialog-head"><div><span class="section-kicker">${cloudMode ? 'ASSIGNED AUTHORITY INBOX' : 'SIMULATED AUTHORITY INBOX'}</span><h2 class="dialog-section-title">Ward desk</h2><p class="dialog-section-copy">${cloudMode ? 'Email and status updates require an assigned WardDesk sign-in.' : 'Demo only · changes stay in this browser.'}</p></div><button class="icon-button close-ward" type="button" aria-label="Close">×</button></div><div class="ward-list">${list.length ? list.map((report) => `<div class="ward-row"><span class="report-illustration ${categoryStyle(report.category)}" aria-hidden="true">${esc(report.icon || '•')}</span><div><strong>${esc(report.title)}</strong><small>${esc(report.place || report.city)} · ${esc(report.id)} · ${esc(statusLabels[report.status] || 'Open')}</small></div><button class="button button-outline" type="button" data-ack="${esc(report.id)}">${report.status === 'open' ? 'Acknowledge' : 'Mark fix'}</button>${cloudMode ? `<button class="button button-quiet" type="button" data-dispatch="${esc(report.id)}">Email authority</button>` : ''}</div>`).join('') : '<div class="ward-empty">Everything in this area is community verified.</div>'}</div>`;
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
    const route = await api(`/authority?city=${encodeURIComponent(report.city)}`);
    if (!route.canSend) { showToast('Configure a verified SES sender and recipient before sending email.'); return; }
    const summary = report.summary || report.details;
    const recipientType = route.testRecipient ? 'TEST INBOX' : route.department;
    const confirmed = window.confirm(`Send this report email to ${route.email} (${recipientType})?\n\n${report.title}\n${summary}\nLocation: ${report.lat}, ${report.lng}\nEvidence: ${report.photoName || 'None'}${report.photoName ? ' (private link expires in 24 hours)' : ''}\n\nThis will send a message from Civicloop. Continue?`);
    if (!confirmed) return;
    await api(`/reports/${encodeURIComponent(id)}/dispatch`, { method: 'POST', body: '{}' });
    await refreshReports();
    showWardDesk();
    showToast(`Email sent to ${route.email}.`);
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
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
  byId('photo-preview').replaceChildren();
  byId('photo-preview').hidden = true;
  byId('photo-name').textContent = 'Optional · session preview only';
}

function handlePhoto() {
  const file = byId('issue-photo').files[0];
  resetPhotoPreview();
  if (!file) return;
  byId('photo-name').textContent = `${file.name} · preview only`;
  photoPreviewUrl = URL.createObjectURL(file);
  const preview = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
  preview.src = photoPreviewUrl;
  if (preview.tagName === 'VIDEO') { preview.controls = true; preview.muted = true; }
  preview.alt = file.type.startsWith('video/') ? '' : 'Selected evidence preview';
  byId('photo-preview').replaceChildren(preview);
  byId('photo-preview').hidden = false;
}

async function toggleNearbyAlerts() {
  const enabled = localStorage.getItem(ALERTS_KEY) === 'on';
  if (enabled) {
    localStorage.setItem(ALERTS_KEY, 'off'); render(); showToast('Nearby alerts turned off.'); return;
  }
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  localStorage.setItem(ALERTS_KEY, 'on'); render();
  showToast('Nearby reminders are on while this demo is open.');
  if (currentLocation) locateUser({ notify: true });
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

document.querySelectorAll('[data-open-report]').forEach((button) => button.addEventListener('click', () => byId('report-dialog').showModal()));
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => byId('report-dialog').close()));
byId('report-form').addEventListener('submit', createReport);
byId('auth-button').addEventListener('click', () => window.CivicAuth.token() ? window.CivicAuth.signOut() : window.CivicAuth.signIn());
byId('draft-button').addEventListener('click', draftSummary);
byId('issue-photo').addEventListener('change', handlePhoto);
byId('form-location-button').addEventListener('click', () => locateUser());
byId('locate-button').addEventListener('click', () => locateUser());
byId('bottom-check-button').addEventListener('click', () => locateUser({ notify: true }));
byId('nearby-alerts-button').addEventListener('click', toggleNearbyAlerts);
byId('city-select').addEventListener('change', async (event) => { activeCity = event.target.value; currentLocation = null; byId('location-label').textContent = 'Add location'; byId('location-coords').textContent = 'Choose to use GPS'; render(); if (cloudMode) { try { await refreshReports(); } catch (error) { showToast(error.message); } } });
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
  if (event.target.closest('.close-detail, [data-close-detail]')) byId('detail-dialog').close();
  const check = event.target.closest('[data-check]'); if (check) applyCheck(check.dataset.check);
  if (event.target.closest('.share-trigger')) showShareDialog();
  const evidence = event.target.closest('[data-evidence]'); if (evidence) api(`/reports/${encodeURIComponent(evidence.dataset.evidence)}/evidence`).then(({ url }) => location.assign(url)).catch((error) => showToast(error.message));
});
byId('share-dialog').addEventListener('click', (event) => {
  if (event.target.closest('.close-share')) byId('share-dialog').close();
  if (event.target.closest('.copy-share')) {
    navigator.clipboard?.writeText(byId('share-text').value).then(() => { byId('share-dialog').close(); showToast('Update copied. Choose where you want to share it.'); }).catch(() => showToast('Clipboard is unavailable in this browser.'));
  }
  if (event.target.closest('.system-share')) shareUpdate();
});
byId('report-dialog').addEventListener('click', (event) => { if (event.target === byId('report-dialog')) byId('report-dialog').close(); });
byId('detail-dialog').addEventListener('close', () => { selectedReportId = null; });

render();
window.CIVICLOOP_AUTH_READY?.then(async () => {
  render();
  if (cloudMode) { try { await refreshReports(); } catch (error) { showToast(error.message); } }
});
