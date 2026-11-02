const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  settings: {
    googlePlacesApiKey: '',
    defaultMode: 'playwright', // 'playwright' | 'places_api'
    defaultMaxResults: 30,
    enrichWebsites: true,
    headless: true,
    websiteConcurrency: 4,
    websiteTimeoutMs: 10000
  },
  campaigns: [],
  leads: []
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

let memoryCache = null;

function readDb() {
  ensureDb();
  if (memoryCache) return memoryCache;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    memoryCache = {
      settings: { ...DEFAULT_DB.settings, ...(parsed.settings || {}) },
      campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : []
    };
    return memoryCache;
  } catch (err) {
    console.error('Error reading db.json, resetting to default:', err.message);
    memoryCache = JSON.parse(JSON.stringify(DEFAULT_DB));
    return memoryCache;
  }
}

function saveDb() {
  ensureDb();
  if (!memoryCache) return;
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(memoryCache, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeString(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

/**
 * Upsert a lead into the database, avoiding duplicates within the same campaign
 * and merging enriched fields if the same business already exists.
 */
function upsertLead(leadData) {
  const db = readDb();
  const normName = normalizeString(leadData.name);
  const normPhone = normalizePhone(leadData.phone);
  const normAddress = normalizeString(leadData.address);

  // Check if lead already exists (match by placeId, or exact mapsUrl without query params, or name + phone/address)
  const existingIdx = db.leads.findIndex((item) => {
    if (leadData.placeId && item.placeId && leadData.placeId === item.placeId) {
      return item.campaignId === leadData.campaignId;
    }
    if (normName && normalizeString(item.name) === normName) {
      if (normPhone && normalizePhone(item.phone) === normPhone && item.campaignId === leadData.campaignId) {
        return true;
      }
      if (normAddress && normalizeString(item.address) === normAddress && item.campaignId === leadData.campaignId) {
        return true;
      }
    }
    return false;
  });

  const now = new Date().toISOString();

  if (existingIdx !== -1) {
    const existing = db.leads[existingIdx];
    const mergedEmails = Array.from(
      new Set([...(existing.emails || []), ...(leadData.emails || [])].filter(Boolean))
    );
    const updated = {
      ...existing,
      ...leadData,
      id: existing.id,
      emails: mergedEmails,
      primaryEmail: leadData.primaryEmail || existing.primaryEmail || mergedEmails[0] || '',
      phone: leadData.phone || existing.phone || '',
      website: leadData.website || existing.website || '',
      address: leadData.address || existing.address || '',
      socials: {
        ...(existing.socials || {}),
        ...(leadData.socials || {})
      },
      outreachStatus: existing.outreachStatus || leadData.outreachStatus || 'New',
      notes: existing.notes !== undefined ? existing.notes : (leadData.notes || ''),
      starred: existing.starred !== undefined ? existing.starred : Boolean(leadData.starred),
      updatedAt: now
    };
    db.leads[existingIdx] = updated;
    saveDb();
    return updated;
  }

  const emails = Array.from(new Set((leadData.emails || []).filter(Boolean)));
  const newLead = {
    id: leadData.id || generateId('lead'),
    campaignId: leadData.campaignId || 'default',
    searchQuery: leadData.searchQuery || '',
    placeId: leadData.placeId || '',
    name: leadData.name || 'Unknown Business',
    category: leadData.category || '',
    primaryEmail: leadData.primaryEmail || emails[0] || '',
    emails,
    phone: leadData.phone || '',
    whatsapp: leadData.whatsapp || '',
    website: leadData.website || '',
    address: leadData.address || '',
    neighborhood: leadData.neighborhood || '',
    rating: leadData.rating !== undefined && leadData.rating !== null ? Number(leadData.rating) : null,
    reviewsCount: leadData.reviewsCount !== undefined && leadData.reviewsCount !== null ? Number(leadData.reviewsCount) : 0,
    priceLevel: leadData.priceLevel || '',
    openingHours: leadData.openingHours || '',
    plusCode: leadData.plusCode || '',
    latitude: leadData.latitude || null,
    longitude: leadData.longitude || null,
    mapsUrl: leadData.mapsUrl || '',
    socials: {
      instagram: leadData.socials?.instagram || '',
      facebook: leadData.socials?.facebook || '',
      linkedin: leadData.socials?.linkedin || '',
      twitter: leadData.socials?.twitter || '',
      youtube: leadData.socials?.youtube || '',
      whatsapp: leadData.socials?.whatsapp || ''
    },
    outreachStatus: leadData.outreachStatus || 'New',
    notes: leadData.notes || '',
    starred: Boolean(leadData.starred),
    sourceMode: leadData.sourceMode || 'playwright',
    extractedAt: leadData.extractedAt || now,
    updatedAt: now
  };

  db.leads.unshift(newLead);
  saveDb();
  return newLead;
}

function updateLead(id, updates) {
  const db = readDb();
  const idx = db.leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const existing = db.leads[idx];
  const updated = {
    ...existing,
    ...updates,
    id: existing.id,
    socials: {
      ...(existing.socials || {}),
      ...(updates.socials || {})
    },
    updatedAt: new Date().toISOString()
  };

  if (Array.isArray(updates.emails)) {
    updated.emails = Array.from(new Set(updates.emails.filter(Boolean)));
    if (!updated.primaryEmail && updated.emails.length > 0) {
      updated.primaryEmail = updated.emails[0];
    }
  }

  db.leads[idx] = updated;
  saveDb();
  return updated;
}

function bulkUpdateLeads(ids, updates) {
  const db = readDb();
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  let count = 0;

  db.leads = db.leads.map((lead) => {
    if (!idSet.has(lead.id)) return lead;
    count++;
    return {
      ...lead,
      ...updates,
      id: lead.id,
      updatedAt: now
    };
  });

  saveDb();
  return count;
}

function deleteLeads(ids) {
  const db = readDb();
  const idSet = new Set(ids);
  const before = db.leads.length;
  db.leads = db.leads.filter((l) => !idSet.has(l.id));
  saveDb();
  return before - db.leads.length;
}

function filterLeads(filters = {}) {
  const db = readDb();
  let list = [...db.leads];

  if (filters.campaignId && filters.campaignId !== 'all') {
    list = list.filter((l) => l.campaignId === filters.campaignId);
  }

  if (filters.ids && Array.isArray(filters.ids) && filters.ids.length > 0) {
    const idSet = new Set(filters.ids);
    list = list.filter((l) => idSet.has(l.id));
  }

  if (filters.search) {
    const q = normalizeString(filters.search);
    list = list.filter((l) => {
      return (
        normalizeString(l.name).includes(q) ||
        normalizeString(l.category).includes(q) ||
        normalizeString(l.address).includes(q) ||
        normalizeString(l.primaryEmail).includes(q) ||
        (l.emails || []).some((e) => normalizeString(e).includes(q)) ||
        normalizeString(l.phone).includes(q) ||
        normalizeString(l.searchQuery).includes(q) ||
        normalizeString(l.notes).includes(q)
      );
    });
  }

  if (filters.hasEmail === 'true' || filters.hasEmail === true) {
    list = list.filter((l) => Boolean(l.primaryEmail || (l.emails && l.emails.length > 0)));
  }

  if (filters.hasPhone === 'true' || filters.hasPhone === true) {
    list = list.filter((l) => Boolean(l.phone && l.phone.trim().length > 0));
  }

  if (filters.hasWebsite === 'true' || filters.hasWebsite === true) {
    list = list.filter((l) => Boolean(l.website && l.website.trim().length > 0));
  }

  if (filters.noWebsite === 'true' || filters.noWebsite === true) {
    list = list.filter((l) => !l.website || l.website.trim().length === 0);
  }

  if (filters.hasSocials === 'true' || filters.hasSocials === true) {
    list = list.filter((l) => {
      const s = l.socials || {};
      return Boolean(s.instagram || s.facebook || s.linkedin || s.twitter || s.youtube || s.whatsapp);
    });
  }

  if (filters.starred === 'true' || filters.starred === true) {
    list = list.filter((l) => Boolean(l.starred));
  }

  if (filters.minRating && Number(filters.minRating) > 0) {
    const minR = Number(filters.minRating);
    list = list.filter((l) => l.rating !== null && Number(l.rating) >= minR);
  }

  if (filters.outreachStatus && filters.outreachStatus !== 'all') {
    list = list.filter((l) => (l.outreachStatus || 'New') === filters.outreachStatus);
  }

  // Deduplicate view option
  if (filters.deduplicate === 'true' || filters.deduplicate === true) {
    const seen = new Set();
    list = list.filter((l) => {
      const key = `${normalizeString(l.name)}|${normalizePhone(l.phone) || normalizeString(l.address)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Sorting
  const sortBy = filters.sortBy || 'extractedAt';
  const sortDir = filters.sortDir === 'asc' ? 1 : -1;

  list.sort((a, b) => {
    if (sortBy === 'rating') {
      return ((a.rating || 0) - (b.rating || 0)) * sortDir;
    }
    if (sortBy === 'reviewsCount') {
      return ((a.reviewsCount || 0) - (b.reviewsCount || 0)) * sortDir;
    }
    if (sortBy === 'name') {
      return String(a.name || '').localeCompare(String(b.name || '')) * sortDir;
    }
    return (new Date(a.extractedAt || 0).getTime() - new Date(b.extractedAt || 0).getTime()) * sortDir;
  });

  return list;
}

function createCampaign(campaignData) {
  const db = readDb();
  const now = new Date().toISOString();
  const campaign = {
    id: campaignData.id || generateId('camp'),
    name: campaignData.name || (campaignData.queries || [])[0] || 'Untitled Extraction',
    queries: campaignData.queries || [],
    mode: campaignData.mode || 'playwright',
    maxResultsPerQuery: Number(campaignData.maxResultsPerQuery) || 30,
    enrichWebsites: campaignData.enrichWebsites !== false,
    status: campaignData.status || 'running', // 'running' | 'completed' | 'stopped' | 'failed'
    stats: {
      totalLeads: 0,
      withPhone: 0,
      withEmail: 0,
      withWebsite: 0,
      withSocials: 0
    },
    createdAt: now,
    completedAt: null
  };

  db.campaigns.unshift(campaign);
  saveDb();
  return campaign;
}

function computeCampaignStats(campaignId) {
  const db = readDb();
  const campaignLeads = db.leads.filter((l) => l.campaignId === campaignId);
  const stats = {
    totalLeads: campaignLeads.length,
    withPhone: campaignLeads.filter((l) => Boolean(l.phone)).length,
    withEmail: campaignLeads.filter((l) => Boolean(l.primaryEmail || (l.emails && l.emails.length > 0))).length,
    withWebsite: campaignLeads.filter((l) => Boolean(l.website)).length,
    withSocials: campaignLeads.filter((l) => {
      const s = l.socials || {};
      return Boolean(s.instagram || s.facebook || s.linkedin || s.twitter || s.youtube || s.whatsapp);
    }).length
  };

  const idx = db.campaigns.findIndex((c) => c.id === campaignId);
  if (idx !== -1) {
    db.campaigns[idx].stats = stats;
    saveDb();
  }
  return stats;
}

function updateCampaign(campaignId, updates) {
  const db = readDb();
  const idx = db.campaigns.findIndex((c) => c.id === campaignId);
  if (idx === -1) return null;

  db.campaigns[idx] = {
    ...db.campaigns[idx],
    ...updates
  };
  saveDb();
  return db.campaigns[idx];
}

function deleteCampaign(campaignId, deleteAssociatedLeads = true) {
  const db = readDb();
  db.campaigns = db.campaigns.filter((c) => c.id !== campaignId);
  if (deleteAssociatedLeads) {
    db.leads = db.leads.filter((l) => l.campaignId !== campaignId);
  }
  saveDb();
  return true;
}

function getCampaigns() {
  const db = readDb();
  return db.campaigns.map((c) => {
    const stats = computeCampaignStats(c.id);
    return { ...c, stats };
  });
}

function getSettings() {
  const db = readDb();
  return db.settings;
}

function updateSettings(newSettings) {
  const db = readDb();
  db.settings = {
    ...db.settings,
    ...newSettings
  };
  saveDb();
  return db.settings;
}

function getGlobalStats() {
  const db = readDb();
  const leads = db.leads;
  return {
    totalCampaigns: db.campaigns.length,
    totalLeads: leads.length,
    withPhone: leads.filter((l) => Boolean(l.phone)).length,
    withEmail: leads.filter((l) => Boolean(l.primaryEmail || (l.emails && l.emails.length > 0))).length,
    withWebsite: leads.filter((l) => Boolean(l.website)).length,
    noWebsite: leads.filter((l) => !l.website).length,
    withSocials: leads.filter((l) => {
      const s = l.socials || {};
      return Boolean(s.instagram || s.facebook || s.linkedin || s.twitter || s.youtube || s.whatsapp);
    }).length,
    byStatus: leads.reduce((acc, l) => {
      const st = l.outreachStatus || 'New';
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = {
  readDb,
  saveDb,
  generateId,
  upsertLead,
  updateLead,
  bulkUpdateLeads,
  deleteLeads,
  filterLeads,
  createCampaign,
  updateCampaign,
  computeCampaignStats,
  deleteCampaign,
  getCampaigns,
  getSettings,
  updateSettings,
  getGlobalStats
};
