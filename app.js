const STORAGE_KEY = 'civicloop.reports.v1';
const ALERTS_KEY = 'civicloop.nearby-alerts';
const DEMO_CLIENT_KEY = 'civicloop.demo-client';
const CITIES = {
  Bengaluru: { center: [12.9718, 77.6412], zoom: 13 },
  Delhi: { center: [28.628, 77.218], zoom: 12 },
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
    ${report.photoName ? `<p class="detail-location">▧ Evidence selected: ${esc(report.photoName)} <span class="draft-row">Session preview only; media is not uploaded or saved.</span></p>` : ''}
    <div class="detail-counts"><span><strong>${Number(report.checks) || 0}</strong> community checks</span><span><strong>${Number(report.fixChecks) || 0}</strong> fix confirmations</span></div>
    <div class="checkin-box"><strong>Passing by? Add a quick check</strong><p>Your check updates this report; it won't create a duplicate ticket.</p><div class="checkin-actions"><button class="button button-outline" type="button" data-check="still">Still there</button><button class="button button-outline" type="button" data-check="fixed">Looks fixed</button><button class="button button-quiet" type="button" data-check="unsure">Can't verify</button></div></div>
    <div class="detail-actions"><button class="button button-quiet share-trigger" type="button">Share update</button><button class="button button-primary" type="button" data-close-detail>Done</button></div>`;
  if (!dialog.open) dialog.showModal();
}

function applyCheck(kind) {
  const report = reports.find((item) => item.id === selectedReportId);
  if (!report) return;
  if (kind === 'unsure') { showToast('Thanks for checking. No change was made to the report.'); byId('detail-dialog').close(); return; }
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

function draftSummary() {
  const category = byId('issue-category').value || 'Environmental issue';
  const title = byId('issue-title').value.trim();
  const details = byId('issue-details').value.trim();
  if (!title && !details) { showToast('Add a title or a few details first.'); return; }
  byId('issue-summary').value = `${category}: ${title || details}${details && title ? `. ${details}` : ''}`;
  showToast('Draft ready to review. This local demo does not call an AI model.');
}

function createReport(event) {
  event.preventDefault();
  const title = byId('issue-title').value.trim();
  const details = byId('issue-details').value.trim();
  if (!currentLocation) { showToast('Set a map pin or use your location before submitting.'); return; }
  const city = currentLocation.city;
  const [lat, lng] = [currentLocation.lat, currentLocation.lng];
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
  const list = cityReports().filter((report) => report.status !== 'verified');
  byId('ward-content').innerHTML = `<div class="dialog-head"><div><span class="section-kicker">SIMULATED AUTHORITY INBOX</span><h2 class="dialog-section-title">Ward desk</h2><p class="dialog-section-copy">Demo only · changes stay in this browser.</p></div><button class="icon-button close-ward" type="button" aria-label="Close">×</button></div><div class="ward-list">${list.length ? list.map((report) => `<div class="ward-row"><span class="report-illustration ${categoryStyle(report.category)}" aria-hidden="true">${esc(report.icon || '•')}</span><div><strong>${esc(report.title)}</strong><small>${esc(report.place || report.city)} · ${esc(report.id)} · ${esc(statusLabels[report.status] || 'Open')}</small></div><button class="button button-outline" type="button" data-ack="${esc(report.id)}">${report.status === 'open' ? 'Acknowledge' : 'Mark fix'}</button></div>`).join('') : '<div class="ward-empty">Everything in this area is community verified.</div>'}</div>`;
  if (!byId('ward-dialog').open) byId('ward-dialog').showModal();
}

function authorityUpdate(id) {
  const report = reports.find((item) => item.id === id);
  if (!report) return;
  if (report.status === 'open') report.status = 'progress';
  else { report.status = 'claimed'; report.fixChecks = 0; }
  persist(); render(); showWardDesk();
}

function showShareDialog() {
  const report = reports.find((item) => item.id === selectedReportId);
  if (!report) return;
  const text = `Community update · ${report.id}\n${report.title}\n${report.place || report.city} · reported ${report.age || 'just now'}\nStatus: ${statusLabels[report.status] || 'Needs attention'}\n${report.checks} community check${report.checks === 1 ? '' : 's'}. Please use the relevant official reporting channel for follow-up.`;
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
byId('draft-button').addEventListener('click', draftSummary);
byId('issue-photo').addEventListener('change', handlePhoto);
byId('form-location-button').addEventListener('click', () => locateUser());
byId('locate-button').addEventListener('click', () => locateUser());
byId('bottom-check-button').addEventListener('click', () => locateUser({ notify: true }));
byId('nearby-alerts-button').addEventListener('click', toggleNearbyAlerts);
byId('city-select').addEventListener('change', (event) => { activeCity = event.target.value; currentLocation = null; byId('location-label').textContent = 'Add location'; byId('location-coords').textContent = 'Choose to use GPS'; render(); });
byId('all-reports-button').addEventListener('click', () => { showingAll = !showingAll; render(); });
byId('filter-button').addEventListener('click', () => { showingAll = !showingAll; render(); showToast(showingAll ? 'Showing all reports.' : 'Showing reports that need a check.'); });
byId('report-list').addEventListener('click', (event) => { const card = event.target.closest('[data-report-id]'); if (card) openDetails(card.dataset.reportId); });
byId('ward-button').addEventListener('click', showWardDesk);
byId('ward-dialog').addEventListener('click', (event) => {
  if (event.target.closest('.close-ward')) byId('ward-dialog').close();
  const button = event.target.closest('[data-ack]'); if (button) authorityUpdate(button.dataset.ack);
});
byId('detail-dialog').addEventListener('click', (event) => {
  if (event.target.closest('.close-detail, [data-close-detail]')) byId('detail-dialog').close();
  const check = event.target.closest('[data-check]'); if (check) applyCheck(check.dataset.check);
  if (event.target.closest('.share-trigger')) showShareDialog();
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
