const express = require('express');
const cors = require('cors');
const path = require('path');
const storage = require('./src/services/storageService');
const jobManager = require('./src/services/jobManager');
const { generateLeadsExcelBuffer, generateLeadsCsv } = require('./src/services/excelService');
const { enrichFromWebsite } = require('./src/scrapers/websiteEnricher');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// Health Check & Dashboard Global Stats
// ============================================================================
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/stats', (req, res) => {
  res.json(storage.getGlobalStats());
});

// ============================================================================
// Campaigns (Search History)
// ============================================================================
app.get('/api/campaigns', (req, res) => {
  res.json(storage.getCampaigns());
});

app.delete('/api/campaigns/:id', (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (job && job.status === 'running') {
    job.stop();
  }
  storage.deleteCampaign(req.params.id, true);
  res.json({ success: true });
});

// ============================================================================
// Extraction Jobs & Real-Time SSE Stream
// ============================================================================
app.post('/api/jobs/start', (req, res) => {
  try {
    const job = jobManager.startExtractionJob(req.body || {});
    res.json({
      success: true,
      jobId: job.id,
      campaign: job.campaign
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/jobs/active', (req, res) => {
  const active = jobManager.getAllActiveJobs().map((j) => ({
    id: j.id,
    campaign: j.campaign,
    status: j.status,
    progress: j.progress,
    leadCount: j.leads.length
  }));
  res.json(active);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) {
    const leads = storage.filterLeads({ campaignId: req.params.id });
    const campaigns = storage.getCampaigns();
    const campaign = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Job not found' });
    return res.json({
      id: campaign.id,
      campaign,
      status: campaign.status,
      progress: { percent: 100, stage: campaign.status },
      logs: [],
      leads
    });
  }

  res.json({
    id: job.id,
    campaign: job.campaign,
    status: job.status,
    progress: job.progress,
    logs: job.logs,
    leads: job.leads
  });
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobManager.getJob(req.params.id);
  if (!job) {
    storage.updateCampaign(req.params.id, { status: 'stopped' });
    return res.json({ success: true, status: 'stopped' });
  }
  job.stop();
  res.json({ success: true, status: 'stopping' });
});

app.get('/api/jobs/:id/stream', (req, res) => {
  const job = jobManager.getJob(req.params.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (!job) {
    const leads = storage.filterLeads({ campaignId: req.params.id });
    const campaign = storage.getCampaigns().find((c) => c.id === req.params.id);
    sendEvent('init', {
      status: campaign ? campaign.status : 'completed',
      progress: { percent: 100, stage: 'completed' },
      logs: [],
      leads,
      stats: campaign?.stats || { totalLeads: leads.length }
    });
    return res.end();
  }

  // Send initial snapshot
  sendEvent('init', {
    status: job.status,
    campaign: job.campaign,
    progress: job.progress,
    logs: job.logs,
    leads: job.leads,
    stats: job.campaign.stats
  });

  const onLog = (entry) => sendEvent('log', entry);
  const onProgress = (prog) => sendEvent('progress', prog);
  const onLead = (payload) => sendEvent('lead', payload);
  const onDone = (payload) => {
    sendEvent('done', payload);
    cleanup();
    res.end();
  };
  const onError = (payload) => {
    sendEvent('error_event', payload);
    cleanup();
    res.end();
  };

  job.on('log', onLog);
  job.on('progress', onProgress);
  job.on('lead', onLead);
  job.on('done', onDone);
  job.on('error_event', onError);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  function cleanup() {
    clearInterval(heartbeat);
    job.off('log', onLog);
    job.off('progress', onProgress);
    job.off('lead', onLead);
    job.off('done', onDone);
    job.off('error_event', onError);
  }

  req.on('close', cleanup);
});

// ============================================================================
// Leads Management & CRM
// ============================================================================
app.get('/api/leads', (req, res) => {
  const leads = storage.filterLeads(req.query);
  res.json({
    total: leads.length,
    leads
  });
});

app.patch('/api/leads/:id', (req, res) => {
  const updated = storage.updateLead(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Lead not found' });
  res.json(updated);
});

app.post('/api/leads/:id/enrich', async (req, res) => {
  try {
    const leads = storage.filterLeads({ ids: [req.params.id] });
    const lead = leads[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const websiteUrl = req.body?.website || lead.website;
    if (!websiteUrl) {
      return res.status(400).json({ error: 'This business does not have a website URL to scan.' });
    }

    const enriched = await enrichFromWebsite(websiteUrl, { timeoutMs: 12000 });
    const updated = storage.updateLead(lead.id, {
      website: enriched.website || websiteUrl,
      primaryEmail: enriched.primaryEmail || lead.primaryEmail,
      emails: [...(lead.emails || []), ...(enriched.emails || [])],
      socials: { ...(lead.socials || {}), ...(enriched.socials || {}) },
      whatsapp: enriched.socials?.whatsapp || lead.whatsapp || ''
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/bulk-update', (req, res) => {
  const { ids, updates } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No leads selected' });
  }
  const count = storage.bulkUpdateLeads(ids, updates || {});
  res.json({ success: true, updatedCount: count });
});

app.post('/api/leads/bulk-delete', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No leads selected' });
  }
  const count = storage.deleteLeads(ids);
  res.json({ success: true, deletedCount: count });
});

// ============================================================================
// Excel (.xlsx) & CSV Export
// ============================================================================
app.get('/api/export/excel', async (req, res) => {
  try {
    const filters = { ...req.query };
    if (typeof filters.ids === 'string' && filters.ids.trim()) {
      filters.ids = filters.ids.split(',').filter(Boolean);
    }
    const leads = storage.filterLeads(filters);

    let filenameSlug = 'google-maps-leads';
    if (filters.campaignId && filters.campaignId !== 'all') {
      const camp = storage.getCampaigns().find((c) => c.id === filters.campaignId);
      if (camp && camp.name) {
        filenameSlug = camp.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50);
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${filenameSlug}-${dateStr}.xlsx`;

    const buffer = await generateLeadsExcelBuffer(leads, {
      title: `Exported ${leads.length} leads on ${new Date().toLocaleString()}`
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: `Failed to generate Excel sheet: ${err.message}` });
  }
});

app.get('/api/export/csv', (req, res) => {
  try {
    const filters = { ...req.query };
    if (typeof filters.ids === 'string' && filters.ids.trim()) {
      filters.ids = filters.ids.split(',').filter(Boolean);
    }
    const leads = storage.filterLeads(filters);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `google-maps-leads-${dateStr}.csv`;
    const csv = generateLeadsCsv(leads);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: `Failed to generate CSV: ${err.message}` });
  }
});

// ============================================================================
// Settings & API Key Configuration
// ============================================================================
app.get('/api/settings', (req, res) => {
  res.json(storage.getSettings());
});

app.put('/api/settings', (req, res) => {
  const updated = storage.updateSettings(req.body || {});
  res.json(updated);
});

app.post('/api/settings/test-api-key', async (req, res) => {
  const apiKey = (req.body?.apiKey || storage.getSettings().googlePlacesApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ valid: false, message: 'Please enter a Google Places API Key first.' });
  }

  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName'
      },
      body: JSON.stringify({ textQuery: 'Cafe in South Delhi', pageSize: 1 })
    });
    const data = await r.json();
    if (r.ok && data.places) {
      return res.json({
        valid: true,
        message: `Success! Places API (New v1) is active. Sample match: "${data.places[0]?.displayName?.text || 'OK'}"`
      });
    }

    // Fallback test on Legacy API
    const legRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=Cafe+in+South+Delhi&key=${encodeURIComponent(
        apiKey
      )}`
    );
    const legData = await legRes.json();
    if (legData.status === 'OK') {
      return res.json({
        valid: true,
        message: `Success! Legacy Places API is active. Sample match: "${legData.results?.[0]?.name || 'OK'}"`
      });
    }

    return res.status(400).json({
      valid: false,
      message: data?.error?.message || legData?.error_message || `API returned status: ${legData.status || r.status}`
    });
  } catch (err) {
    return res.status(500).json({ valid: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=============================================================`);
  console.log(`  GmExtractor — Google Maps Lead & Outreach Suite`);
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`=============================================================\n`);
});
