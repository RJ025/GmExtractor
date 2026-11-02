/* GmExtractor Pro — Frontend Application Logic */

const state = {
  activeTab: 'extract',
  currentJobId: null,
  eventSource: null,
  liveLeads: [],
  crmLeads: [],
  selectedLeadIds: new Set(),
  campaigns: [],
  filters: {
    search: '',
    campaignId: 'all',
    minRating: '0',
    outreachStatus: 'all',
    sortBy: 'extractedAt',
    sortDir: 'desc',
    hasEmail: false,
    hasPhone: false,
    hasWebsite: false,
    noWebsite: false,
    hasSocials: false,
    starred: false,
    deduplicate: false
  }
};

// ============================================================================
// Utilities
// ============================================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') {
    toast.style.borderLeftColor = '#f43f5e';
  } else if (type === 'info') {
    toast.style.borderLeftColor = '#6366f1';
  }
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3600);
}

function copyToClipboard(text, label = 'Text') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} copied: ${text}`);
  });
}

function formatWhatsAppLink(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^\d]/g, '');
  if (digits.length === 10) {
    digits = `91${digits}`; // Default to India country code for 10-digit local numbers
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  }
  return digits.length >= 10 ? `https://wa.me/${digits}` : '';
}

function renderSocialBadges(socials = {}, website = '') {
  const badges = [];
  if (website) {
    badges.push(
      `<a href="${escapeHtml(website)}" target="_blank" rel="noopener" class="social-pill" title="${escapeHtml(
        website
      )}">🌐 Website</a>`
    );
  }
  if (socials?.instagram) {
    badges.push(
      `<a href="${escapeHtml(socials.instagram)}" target="_blank" rel="noopener" class="social-pill" style="color:#f472b6;">📸 IG</a>`
    );
  }
  if (socials?.facebook) {
    badges.push(
      `<a href="${escapeHtml(socials.facebook)}" target="_blank" rel="noopener" class="social-pill" style="color:#60a5fa;">📘 FB</a>`
    );
  }
  if (socials?.linkedin) {
    badges.push(
      `<a href="${escapeHtml(socials.linkedin)}" target="_blank" rel="noopener" class="social-pill" style="color:#38bdf8;">💼 LI</a>`
    );
  }
  if (socials?.whatsapp) {
    badges.push(
      `<a href="${escapeHtml(socials.whatsapp)}" target="_blank" rel="noopener" class="social-pill" style="color:#34d399;">💬 WA</a>`
    );
  }
  return badges.length > 0
    ? `<div class="social-links">${badges.join('')}</div>`
    : `<span style="color:var(--text-muted);font-size:0.76rem;">No website</span>`;
}

// ============================================================================
// Navigation & Global KPI Stats
// ============================================================================
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${tabName}`);
  });

  if (tabName === 'leads') {
    loadCampaignsDropdown().then(() => loadCrmLeads());
  } else if (tabName === 'campaigns') {
    loadCampaignsView();
  } else if (tabName === 'settings') {
    loadSettingsView();
  }
}

async function loadGlobalStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    const total = stats.totalLeads || 0;
    const pct = (n) => (total > 0 ? `${Math.round((n / total) * 100)}% of total` : '0% of total');

    document.getElementById('kpi-total').textContent = total.toLocaleString();
    document.getElementById('kpi-campaigns-sub').textContent = `Across ${stats.totalCampaigns || 0} search campaigns`;
    document.getElementById('kpi-phone').textContent = (stats.withPhone || 0).toLocaleString();
    document.getElementById('kpi-phone-pct').textContent = pct(stats.withPhone || 0);
    document.getElementById('kpi-email').textContent = (stats.withEmail || 0).toLocaleString();
    document.getElementById('kpi-email-pct').textContent = pct(stats.withEmail || 0);
    document.getElementById('kpi-website').textContent = (stats.withWebsite || 0).toLocaleString();
    document.getElementById('kpi-website-pct').textContent = pct(stats.withWebsite || 0);
    document.getElementById('kpi-nowebsite').textContent = (stats.noWebsite || 0).toLocaleString();
    document.getElementById('kpi-socials').textContent = (stats.withSocials || 0).toLocaleString();

    document.getElementById('nav-leads-count').textContent = total;
    document.getElementById('nav-campaigns-count').textContent = stats.totalCampaigns || 0;
  } catch (err) {
    console.error('Error loading global stats:', err);
  }
}

// ============================================================================
// Extraction & Live Stream (SSE)
// ============================================================================
function appendTerminalLog(entry) {
  const term = document.getElementById('live-log-terminal');
  const div = document.createElement('div');
  div.className = 'log-line';
  const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  div.innerHTML = `<span class="log-time">[${escapeHtml(timeStr)}]</span> ${escapeHtml(entry.message)}`;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}

function updateLiveStatsUI(stats = {}) {
  document.getElementById('live-stat-total').textContent = stats.totalLeads || state.liveLeads.length || 0;
  document.getElementById('live-stat-phone').textContent = stats.withPhone || 0;
  document.getElementById('live-stat-email').textContent = stats.withEmail || 0;
  document.getElementById('live-stat-web').textContent = stats.withWebsite || 0;
  document.getElementById('live-stat-socials').textContent = stats.withSocials || 0;
}

function renderLiveTable() {
  const tbody = document.getElementById('live-leads-tbody');
  if (!state.liveLeads || state.liveLeads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Waiting for first business listing to be extracted...</td></tr>`;
    return;
  }

  tbody.innerHTML = state.liveLeads
    .map((lead, idx) => {
      const email = lead.primaryEmail || (lead.emails && lead.emails[0]) || '';
      const emailHtml = email
        ? `<a href="mailto:${escapeHtml(email)}" class="email-badge">✉️ ${escapeHtml(email)}</a>`
        : `<span style="color:var(--text-muted);font-size:0.76rem;">—</span>`;

      const phoneHtml = lead.phone
        ? `<span class="phone-badge">📞 ${escapeHtml(lead.phone)}</span>`
        : `<span style="color:var(--text-muted);font-size:0.76rem;">—</span>`;

      const ratingHtml = lead.rating
        ? `<span class="rating-badge">★ ${lead.rating} <small style="color:var(--text-secondary);font-weight:400;">(${
            lead.reviewsCount || 0
          })</small></span>`
        : `<span style="color:var(--text-muted);">—</span>`;

      return `
        <tr>
          <td style="color:var(--text-muted);font-weight:600;">${idx + 1}</td>
          <td>
            <div class="biz-name">
              <a href="${escapeHtml(lead.mapsUrl || '#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">
                ${escapeHtml(lead.name)}
              </a>
            </div>
            ${lead.category ? `<span class="biz-category">${escapeHtml(lead.category)}</span>` : ''}
          </td>
          <td>${phoneHtml}</td>
          <td>${emailHtml}</td>
          <td>${renderSocialBadges(lead.socials, lead.website)}</td>
          <td style="max-width:250px;font-size:0.78rem;color:var(--text-secondary);">${escapeHtml(lead.address || '—')}</td>
          <td>${ratingHtml}</td>
        </tr>
      `;
    })
    .join('');
}

function connectToJobStream(jobId) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.currentJobId = jobId;
  state.liveLeads = [];

  const btnStart = document.getElementById('btn-start-extract');
  const btnStop = document.getElementById('btn-stop-job');
  const btnExcel = document.getElementById('btn-download-live-excel');
  const btnCrm = document.getElementById('btn-view-in-crm');
  const statusBadge = document.getElementById('live-status-badge');

  btnStart.disabled = true;
  btnStart.textContent = '⏳ Extracting from Google Maps...';
  btnStop.style.display = 'inline-flex';
  btnExcel.disabled = false;
  btnCrm.disabled = false;
  statusBadge.style.display = 'inline-block';
  statusBadge.className = 'status-pill running';
  statusBadge.textContent = 'Running';

  const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
  state.eventSource = es;

  es.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    state.liveLeads = data.leads || [];
    renderLiveTable();
    updateLiveStatsUI(data.stats || {});

    const term = document.getElementById('live-log-terminal');
    term.innerHTML = '';
    (data.logs || []).forEach((l) => appendTerminalLog(l));

    if (data.progress) {
      updateProgressUI(data.progress);
    }
    if (data.status && data.status !== 'running') {
      finishJobUI(data.status, data.stats);
      es.close();
    }
  });

  es.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    appendTerminalLog(entry);
  });

  es.addEventListener('progress', (e) => {
    const prog = JSON.parse(e.data);
    updateProgressUI(prog);
  });

  es.addEventListener('lead', (e) => {
    const { lead, stats } = JSON.parse(e.data);
    const existingIdx = state.liveLeads.findIndex((l) => l.id === lead.id);
    if (existingIdx !== -1) {
      state.liveLeads[existingIdx] = lead;
    } else {
      state.liveLeads.push(lead);
    }
    renderLiveTable();
    updateLiveStatsUI(stats);
    loadGlobalStats();
  });

  es.addEventListener('done', (e) => {
    const payload = JSON.parse(e.data);
    finishJobUI(payload.status, payload.stats);
    loadGlobalStats();
    showToast(`Extraction finished! ${payload.stats?.totalLeads || 0} leads saved.`);
    es.close();
  });

  es.addEventListener('error_event', (e) => {
    const payload = JSON.parse(e.data);
    finishJobUI('failed');
    showToast(`Extraction error: ${payload.message}`, 'error');
    es.close();
  });
}

function updateProgressUI(prog) {
  const pct = prog.percent || 0;
  document.getElementById('live-progress-bar').style.width = `${pct}%`;
  document.getElementById('live-progress-pct').textContent = `${pct}%`;

  const qPrefix =
    prog.totalQueries > 1 ? `[Query ${(prog.currentQueryIndex || 0) + 1}/${prog.totalQueries}: ${prog.currentQuery}] ` : '';

  if (prog.stage === 'scrolling') {
    document.getElementById('live-progress-text').textContent = `${qPrefix}Scrolling Google Maps feed (${
      prog.discoveredCount || 0
    }/${prog.targetCount || ''} found)...`;
  } else if (prog.stage === 'extracting') {
    document.getElementById('live-progress-text').textContent = `${qPrefix}Extracting [${prog.current || 0}/${
      prog.total || 0
    }]: ${prog.currentBusiness || ''}`;
  }
}

function finishJobUI(status, stats) {
  const btnStart = document.getElementById('btn-start-extract');
  const btnStop = document.getElementById('btn-stop-job');
  const statusBadge = document.getElementById('live-status-badge');

  btnStart.disabled = false;
  btnStart.textContent = '🚀 Start Extracting Google Maps Data';
  btnStop.style.display = 'none';

  statusBadge.className = `status-pill ${status === 'completed' ? 'completed' : 'stopped'}`;
  statusBadge.textContent = status.toUpperCase();

  document.getElementById('live-progress-bar').style.width = '100%';
  document.getElementById('live-progress-pct').textContent = '100%';
  document.getElementById('live-progress-text').textContent =
    status === 'completed' ? 'Extraction completed! Ready to export to Excel (.xlsx).' : `Job ${status}.`;

  if (stats) updateLiveStatsUI(stats);
}

// ============================================================================
// Leads CRM & Filter Explorer
// ============================================================================
async function loadCampaignsDropdown() {
  try {
    const res = await fetch('/api/campaigns');
    const campaigns = await res.json();
    state.campaigns = campaigns;

    const select = document.getElementById('crm-campaign-filter');
    const currentVal = state.filters.campaignId;
    select.innerHTML = `<option value="all">All Search Campaigns (${campaigns.length})</option>`;
    campaigns.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.stats?.totalLeads || 0} leads)`;
      select.appendChild(opt);
    });
    select.value = currentVal;
  } catch (err) {
    console.error('Failed to load campaigns dropdown:', err);
  }
}

function buildFilterQueryParams() {
  const params = new URLSearchParams();
  const f = state.filters;
  if (f.search) params.set('search', f.search);
  if (f.campaignId && f.campaignId !== 'all') params.set('campaignId', f.campaignId);
  if (f.minRating && Number(f.minRating) > 0) params.set('minRating', f.minRating);
  if (f.outreachStatus && f.outreachStatus !== 'all') params.set('outreachStatus', f.outreachStatus);
  if (f.sortBy) params.set('sortBy', f.sortBy);
  if (f.sortDir) params.set('sortDir', f.sortDir);
  if (f.hasEmail) params.set('hasEmail', 'true');
  if (f.hasPhone) params.set('hasPhone', 'true');
  if (f.hasWebsite) params.set('hasWebsite', 'true');
  if (f.noWebsite) params.set('noWebsite', 'true');
  if (f.hasSocials) params.set('hasSocials', 'true');
  if (f.starred) params.set('starred', 'true');
  if (f.deduplicate) params.set('deduplicate', 'true');
  return params;
}

async function loadCrmLeads() {
  try {
    const params = buildFilterQueryParams();
    const res = await fetch(`/api/leads?${params.toString()}`);
    const data = await res.json();
    state.crmLeads = data.leads || [];
    document.getElementById('crm-showing-count').textContent = `Showing ${state.crmLeads.length} leads`;
    renderCrmTable();
  } catch (err) {
    console.error('Error loading CRM leads:', err);
  }
}

function updateBulkSelectionUI() {
  const count = state.selectedLeadIds.size;
  document.getElementById('selected-count').textContent = count;
  document.getElementById('bulk-status-select').style.display = count > 0 ? 'inline-block' : 'none';
  document.getElementById('btn-export-selected').style.display = count > 0 ? 'inline-flex' : 'none';
  document.getElementById('btn-delete-selected').style.display = count > 0 ? 'inline-flex' : 'none';
}

function renderCrmTable() {
  const tbody = document.getElementById('crm-leads-tbody');
  if (state.crmLeads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          <h3>No matching leads found</h3>
          <p>Try clearing your filters or run a new Google Maps search in the "Extract Leads" tab.</p>
        </td>
      </tr>
    `;
    return;
  }

  const statuses = ['New', 'Contacted', 'Interested', 'Follow-Up', 'Meeting Booked', 'Closed', 'Not Interested'];

  tbody.innerHTML = state.crmLeads
    .map((lead) => {
      const checked = state.selectedLeadIds.has(lead.id) ? 'checked' : '';
      const starredClass = lead.starred ? 'starred' : '';
      const email = lead.primaryEmail || (lead.emails && lead.emails[0]) || '';
      const extraEmailCount = (lead.emails || []).length > 1 ? `+${lead.emails.length - 1}` : '';
      const waLink = lead.socials?.whatsapp || formatWhatsAppLink(lead.phone);

      const phoneBlock = lead.phone
        ? `
          <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
            <a href="tel:${escapeHtml(lead.phone)}" class="phone-badge" style="text-decoration:none;">📞 ${escapeHtml(
            lead.phone
          )}</a>
            <button class="copy-mini-btn" onclick="copyToClipboard('${escapeHtml(lead.phone)}', 'Phone')">Copy</button>
            ${
              waLink
                ? `<a href="${escapeHtml(
                    waLink
                  )}" target="_blank" rel="noopener" class="copy-mini-btn" style="color:#34d399;text-decoration:none;" title="Chat on WhatsApp">WA</a>`
                : ''
            }
          </div>
        `
        : `<span style="color:var(--text-muted);font-size:0.78rem;">No phone</span>`;

      let emailBlock = '';
      if (email) {
        emailBlock = `
          <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
            <a href="mailto:${escapeHtml(email)}" class="email-badge" title="${escapeHtml(
          (lead.emails || []).join(', ')
        )}">✉️ ${escapeHtml(email)} ${extraEmailCount ? `<small>(${extraEmailCount})</small>` : ''}</a>
            <button class="copy-mini-btn" onclick="copyToClipboard('${escapeHtml(email)}', 'Email')">Copy</button>
          </div>
        `;
      } else if (lead.website) {
        emailBlock = `
          <button class="copy-mini-btn" onclick="rescanLeadWebsite('${escapeHtml(
            lead.id
          )}', this)" title="Crawl website for email address">
            🔄 Scan Website for Email
          </button>
        `;
      } else {
        emailBlock = `<span style="color:var(--text-muted);font-size:0.76rem;">No email</span>`;
      }

      const statusOptions = statuses
        .map(
          (st) => `<option value="${st}" ${(lead.outreachStatus || 'New') === st ? 'selected' : ''}>${st}</option>`
        )
        .join('');

      return `
        <tr data-id="${escapeHtml(lead.id)}">
          <td>
            <input type="checkbox" class="lead-row-chk" data-id="${escapeHtml(lead.id)}" ${checked} />
          </td>
          <td>
            <button class="star-btn ${starredClass}" onclick="toggleLeadStar('${escapeHtml(lead.id)}', ${!lead.starred})">
              ★
            </button>
          </td>
          <td>
            <div class="biz-name">
              <a href="${escapeHtml(lead.mapsUrl || '#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">
                ${escapeHtml(lead.name)}
              </a>
            </div>
            ${lead.category ? `<span class="biz-category">${escapeHtml(lead.category)}</span>` : ''}
          </td>
          <td>${phoneBlock}</td>
          <td>${emailBlock}</td>
          <td>${renderSocialBadges(lead.socials, lead.website)}</td>
          <td style="max-width:240px;">
            <div style="font-size:0.78rem;color:var(--text-primary);">${escapeHtml(lead.address || '—')}</div>
            ${
              lead.searchQuery
                ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.15rem;">📍 ${escapeHtml(
                    lead.searchQuery
                  )}</div>`
                : ''
            }
          </td>
          <td>
            ${
              lead.rating
                ? `<span class="rating-badge">★ ${lead.rating}</span> <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:0.15rem;">${(
                    lead.reviewsCount || 0
                  ).toLocaleString()} reviews</div>`
                : '<span style="color:var(--text-muted);">—</span>'
            }
          </td>
          <td>
            <select class="status-select" onchange="updateLeadStatus('${escapeHtml(lead.id)}', this.value)">
              ${statusOptions}
            </select>
          </td>
          <td>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" onclick="openEditLeadModal('${escapeHtml(lead.id)}')">
                📝 ${lead.notes ? 'Notes ✓' : 'Edit / Notes'}
              </button>
              <a href="${escapeHtml(
                lead.mapsUrl || '#'
              )}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="Open on Google Maps">
                🗺️
              </a>
            </div>
            ${
              lead.notes
                ? `<div style="font-size:0.72rem;color:#a5b4fc;margin-top:0.3rem;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(
                    lead.notes
                  )}">💬 ${escapeHtml(lead.notes)}</div>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');

  // Bind row checkboxes
  document.querySelectorAll('.lead-row-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        state.selectedLeadIds.add(id);
      } else {
        state.selectedLeadIds.delete(id);
      }
      updateBulkSelectionUI();
    });
  });
}

async function toggleLeadStar(id, starred) {
  await fetch(`/api/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred })
  });
  loadCrmLeads();
}

async function updateLeadStatus(id, outreachStatus) {
  await fetch(`/api/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outreachStatus })
  });
  showToast(`Status updated to "${outreachStatus}"`);
}

async function rescanLeadWebsite(id, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Scanning...';
  }
  try {
    const res = await fetch(`/api/leads/${encodeURIComponent(id)}/enrich`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to scan website');
    if (data.primaryEmail) {
      showToast(`Found email: ${data.primaryEmail}`);
    } else {
      showToast('Scanned website, no public email address listed on pages.', 'info');
    }
    loadCrmLeads();
    loadGlobalStats();
  } catch (err) {
    showToast(err.message, 'error');
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '🔄 Scan Website';
    }
  }
}

function openEditLeadModal(id) {
  const lead = state.crmLeads.find((l) => l.id === id);
  if (!lead) return;
  document.getElementById('edit-lead-id').value = lead.id;
  document.getElementById('edit-lead-title').textContent = `Edit: ${lead.name}`;
  document.getElementById('edit-lead-email').value = lead.primaryEmail || '';
  document.getElementById('edit-lead-phone').value = lead.phone || '';
  document.getElementById('edit-lead-website').value = lead.website || '';
  document.getElementById('edit-lead-status').value = lead.outreachStatus || 'New';
  document.getElementById('edit-lead-notes').value = lead.notes || '';
  document.getElementById('modal-lead-edit').classList.add('open');
}

// ============================================================================
// Saved Searches / Campaigns View
// ============================================================================
async function loadCampaignsView() {
  const container = document.getElementById('campaigns-container');
  try {
    const res = await fetch('/api/campaigns');
    const campaigns = await res.json();
    state.campaigns = campaigns;

    if (campaigns.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>No saved search campaigns yet</h3>
          <p>Run your first extraction in the "Extract Leads" tab to save campaigns here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = campaigns
      .map((c) => {
        const s = c.stats || {};
        const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
        const queriesPreview = (c.queries || []).slice(0, 3).join(' • ');
        const moreCount = (c.queries || []).length > 3 ? ` (+${c.queries.length - 3} more)` : '';

        return `
          <div class="campaign-card">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem;">
                <h3 style="font-size:1rem;font-weight:700;color:var(--text-primary);">${escapeHtml(c.name)}</h3>
                <span class="status-pill ${escapeHtml(c.status || 'completed')}">${escapeHtml(
          c.status || 'completed'
        )}</span>
              </div>
              <div style="font-size:0.76rem;color:var(--text-secondary);margin-bottom:0.85rem;">
                🕒 ${escapeHtml(dateStr)} &bull; Engine: ${
          c.mode === 'places_api' ? 'Google Places API' : 'Playwright Scraper'
        }
              </div>
              <div style="font-size:0.78rem;color:#cbd5e1;background:var(--bg-input);padding:0.55rem 0.75rem;border-radius:6px;margin-bottom:0.9rem;">
                🔍 ${escapeHtml(queriesPreview)}${escapeHtml(moreCount)}
              </div>

              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;text-align:center;background:var(--bg-input);padding:0.65rem;border-radius:8px;">
                <div>
                  <div style="font-size:1.1rem;font-weight:800;color:#fff;">${s.totalLeads || 0}</div>
                  <div style="font-size:0.68rem;color:var(--text-secondary);">Total</div>
                </div>
                <div>
                  <div style="font-size:1.1rem;font-weight:800;color:#38bdf8;">${s.withPhone || 0}</div>
                  <div style="font-size:0.68rem;color:var(--text-secondary);">Phones</div>
                </div>
                <div>
                  <div style="font-size:1.1rem;font-weight:800;color:#34d399;">${s.withEmail || 0}</div>
                  <div style="font-size:0.68rem;color:var(--text-secondary);">Emails</div>
                </div>
                <div>
                  <div style="font-size:1.1rem;font-weight:800;color:#a5b4fc;">${s.withWebsite || 0}</div>
                  <div style="font-size:0.68rem;color:var(--text-secondary);">Websites</div>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.5rem;border-top:1px solid var(--border-subtle);">
              <a href="/api/export/excel?campaignId=${encodeURIComponent(
                c.id
              )}" class="btn btn-emerald btn-sm" style="flex:1;">
                📥 Excel (.xlsx)
              </a>
              <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openCampaignInCrm('${escapeHtml(c.id)}')">
                🔎 View Leads
              </button>
              <button class="btn btn-secondary btn-sm" onclick="rerunCampaign('${escapeHtml(c.id)}')" title="Load queries into Extractor">
                🔄 Re-run
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteCampaignById('${escapeHtml(c.id)}')" title="Delete Campaign">
                🗑
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Error loading campaigns:', err);
  }
}

function openCampaignInCrm(campaignId) {
  state.filters.campaignId = campaignId;
  switchTab('leads');
}

function rerunCampaign(campaignId) {
  const camp = state.campaigns.find((c) => c.id === campaignId);
  if (!camp) return;
  document.getElementById('input-queries').value = (camp.queries || []).join('\n');
  document.getElementById('input-campaign-name').value = `${camp.name} (Re-run)`;
  switchTab('extract');
  showToast('Queries loaded into Extractor! Click Start to run.');
}

async function deleteCampaignById(campaignId) {
  if (!confirm('Delete this campaign and its associated leads?')) return;
  await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
  showToast('Campaign deleted');
  loadCampaignsView();
  loadGlobalStats();
}

// ============================================================================
// Settings View
// ============================================================================
async function loadSettingsView() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    document.getElementById('settings-api-key').value = s.googlePlacesApiKey || '';
    document.getElementById('settings-default-mode').value = s.defaultMode || 'playwright';
    document.getElementById('settings-default-max').value = s.defaultMaxResults || 30;
    document.getElementById('settings-timeout').value = s.websiteTimeoutMs || 9000;
    document.getElementById('settings-headless').value = String(s.headless !== false);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Preset query chips
  document.querySelectorAll('.preset-query').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.getElementById('input-queries').value = chip.dataset.queries;
    });
  });

  // Extraction form submit
  document.getElementById('extraction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawQueries = document.getElementById('input-queries').value;
    const queries = rawQueries
      .split('\n')
      .map((q) => q.trim())
      .filter(Boolean);

    if (queries.length === 0) {
      return showToast('Please enter at least one search query', 'error');
    }

    const payload = {
      queries,
      campaignName: document.getElementById('input-campaign-name').value.trim(),
      mode: document.getElementById('select-mode').value,
      maxResultsPerQuery: Number(document.getElementById('select-max-results').value),
      enrichWebsites: document.getElementById('chk-enrich-websites').checked,
      headless: document.getElementById('chk-headless').checked
    };

    try {
      const res = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start extraction');

      showToast(`Started extraction: ${data.campaign.name}`, 'info');
      connectToJobStream(data.jobId);
      loadGlobalStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Stop active job button
  document.getElementById('btn-stop-job').addEventListener('click', async () => {
    if (!state.currentJobId) return;
    await fetch(`/api/jobs/${encodeURIComponent(state.currentJobId)}/stop`, { method: 'POST' });
    showToast('Stopping job gracefully and saving extracted leads...', 'info');
  });

  // Live Excel download & View in CRM buttons
  document.getElementById('btn-download-live-excel').addEventListener('click', () => {
    const campParam = state.currentJobId ? `?campaignId=${encodeURIComponent(state.currentJobId)}` : '';
    window.location.href = `/api/export/excel${campParam}`;
  });

  document.getElementById('btn-view-in-crm').addEventListener('click', () => {
    if (state.currentJobId) {
      state.filters.campaignId = state.currentJobId;
    }
    switchTab('leads');
  });

  // Global Export All to Excel button
  document.getElementById('btn-export-all-excel').addEventListener('click', () => {
    window.location.href = '/api/export/excel';
  });

  // Smart Sub-Area Expander modal
  const expanderModal = document.getElementById('modal-expander');
  document.getElementById('btn-open-expander').addEventListener('click', () => {
    expanderModal.classList.add('open');
  });
  document.getElementById('btn-close-expander').addEventListener('click', () => {
    expanderModal.classList.remove('open');
  });
  document.getElementById('btn-cancel-expander').addEventListener('click', () => {
    expanderModal.classList.remove('open');
  });

  document.querySelectorAll('.exp-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('exp-region').value = btn.dataset.region;
      document.getElementById('exp-areas').value = btn.dataset.areas;
    });
  });

  document.getElementById('btn-apply-expander').addEventListener('click', () => {
    const keyword = document.getElementById('exp-keyword').value.trim() || 'cafes';
    const region = document.getElementById('exp-region').value.trim() || 'South Delhi';
    const areas = document
      .getElementById('exp-areas')
      .value.split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const queries = areas.map((area) => `${keyword} in ${area}, ${region}`);
    document.getElementById('input-queries').value = queries.join('\n');
    document.getElementById('input-campaign-name').value = `${keyword} in ${region} (${queries.length} Areas)`;
    expanderModal.classList.remove('open');
    showToast(`Generated ${queries.length} neighborhood search queries!`);
  });

  // CRM Filter Controls
  let searchDebounce;
  document.getElementById('crm-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      loadCrmLeads();
    }, 250);
  });

  document.getElementById('crm-campaign-filter').addEventListener('change', (e) => {
    state.filters.campaignId = e.target.value;
    loadCrmLeads();
  });

  document.getElementById('crm-rating-filter').addEventListener('change', (e) => {
    state.filters.minRating = e.target.value;
    loadCrmLeads();
  });

  document.getElementById('crm-status-filter').addEventListener('change', (e) => {
    state.filters.outreachStatus = e.target.value;
    loadCrmLeads();
  });

  document.getElementById('crm-sort').addEventListener('change', (e) => {
    const [sortBy, sortDir] = e.target.value.split(':');
    state.filters.sortBy = sortBy;
    state.filters.sortDir = sortDir;
    loadCrmLeads();
  });

  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const key = pill.dataset.filter;
      state.filters[key] = !state.filters[key];
      // Mutually exclusive hasWebsite vs noWebsite
      if (key === 'hasWebsite' && state.filters.hasWebsite) state.filters.noWebsite = false;
      if (key === 'noWebsite' && state.filters.noWebsite) state.filters.hasWebsite = false;

      document.querySelectorAll('.filter-pill').forEach((p) => {
        p.classList.toggle('active', Boolean(state.filters[p.dataset.filter]));
      });
      loadCrmLeads();
    });
  });

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    state.filters = {
      search: '',
      campaignId: 'all',
      minRating: '0',
      outreachStatus: 'all',
      sortBy: 'extractedAt',
      sortDir: 'desc',
      hasEmail: false,
      hasPhone: false,
      hasWebsite: false,
      noWebsite: false,
      hasSocials: false,
      starred: false,
      deduplicate: false
    };
    document.getElementById('crm-search').value = '';
    document.getElementById('crm-campaign-filter').value = 'all';
    document.getElementById('crm-rating-filter').value = '0';
    document.getElementById('crm-status-filter').value = 'all';
    document.getElementById('crm-sort').value = 'extractedAt:desc';
    document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
    loadCrmLeads();
  });

  // Export Filtered Excel & CSV
  document.getElementById('btn-export-filtered-excel').addEventListener('click', () => {
    const params = buildFilterQueryParams();
    window.location.href = `/api/export/excel?${params.toString()}`;
  });

  document.getElementById('btn-export-filtered-csv').addEventListener('click', () => {
    const params = buildFilterQueryParams();
    window.location.href = `/api/export/csv?${params.toString()}`;
  });

  // Select All Checkbox in CRM
  document.getElementById('chk-select-all').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.crmLeads.forEach((l) => state.selectedLeadIds.add(l.id));
    } else {
      state.selectedLeadIds.clear();
    }
    renderCrmTable();
    updateBulkSelectionUI();
  });

  // Bulk Actions
  document.getElementById('bulk-status-select').addEventListener('change', async (e) => {
    const status = e.target.value;
    if (!status) return;
    const ids = Array.from(state.selectedLeadIds);
    await fetch('/api/leads/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, updates: { outreachStatus: status } })
    });
    e.target.value = '';
    showToast(`Updated ${ids.length} leads to "${status}"`);
    loadCrmLeads();
  });

  document.getElementById('btn-export-selected').addEventListener('click', () => {
    const ids = Array.from(state.selectedLeadIds).join(',');
    window.location.href = `/api/export/excel?ids=${encodeURIComponent(ids)}`;
  });

  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    const ids = Array.from(state.selectedLeadIds);
    if (!confirm(`Delete ${ids.length} selected leads?`)) return;
    await fetch('/api/leads/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    state.selectedLeadIds.clear();
    updateBulkSelectionUI();
    loadCrmLeads();
    loadGlobalStats();
    showToast(`Deleted ${ids.length} leads`);
  });

  // Edit Lead Modal
  const editLeadModal = document.getElementById('modal-lead-edit');
  document.getElementById('btn-close-lead-modal').addEventListener('click', () => {
    editLeadModal.classList.remove('open');
  });
  document.getElementById('btn-cancel-lead-modal').addEventListener('click', () => {
    editLeadModal.classList.remove('open');
  });

  document.getElementById('form-lead-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-lead-id').value;
    const updates = {
      primaryEmail: document.getElementById('edit-lead-email').value.trim(),
      phone: document.getElementById('edit-lead-phone').value.trim(),
      website: document.getElementById('edit-lead-website').value.trim(),
      outreachStatus: document.getElementById('edit-lead-status').value,
      notes: document.getElementById('edit-lead-notes').value.trim()
    };

    await fetch(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    editLeadModal.classList.remove('open');
    showToast('Lead updated!');
    loadCrmLeads();
    loadGlobalStats();
  });

  // Settings Form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      googlePlacesApiKey: document.getElementById('settings-api-key').value.trim(),
      defaultMode: document.getElementById('settings-default-mode').value,
      defaultMaxResults: Number(document.getElementById('settings-default-max').value) || 30,
      websiteTimeoutMs: Number(document.getElementById('settings-timeout').value) || 9000,
      headless: document.getElementById('settings-headless').value === 'true'
    };

    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    document.getElementById('select-mode').value = payload.defaultMode;
    document.getElementById('chk-headless').checked = payload.headless;
    showToast('Settings saved successfully!');
  });

  document.getElementById('btn-test-api-key').addEventListener('click', async () => {
    const apiKey = document.getElementById('settings-api-key').value.trim();
    const hint = document.getElementById('api-key-test-result');
    hint.textContent = 'Testing Google Places API key...';
    hint.style.color = '#94a3b8';

    try {
      const res = await fetch('/api/settings/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      const data = await res.json();
      hint.textContent = data.message;
      hint.style.color = data.valid ? '#34d399' : '#f43f5e';
    } catch (err) {
      hint.textContent = `Error: ${err.message}`;
      hint.style.color = '#f43f5e';
    }
  });

  // Initial Load
  await loadGlobalStats();

  // Reconnect if a job is currently running
  try {
    const activeRes = await fetch('/api/jobs/active');
    const activeJobs = await activeRes.json();
    if (activeJobs.length > 0) {
      connectToJobStream(activeJobs[0].id);
    }
  } catch {
    // ignore
  }
});
