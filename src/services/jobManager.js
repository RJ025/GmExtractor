const EventEmitter = require('events');
const storage = require('./storageService');
const { scrapeQueryWithPlaywright } = require('../scrapers/playwrightScraper');
const { scrapeQueryWithPlacesApi } = require('../scrapers/placesApiScraper');

const activeJobs = new Map();

class ExtractionJob extends EventEmitter {
  constructor({ campaign, queries, mode, maxResultsPerQuery, enrichWebsites, headless, apiKey, websiteTimeoutMs }) {
    super();
    this.id = campaign.id;
    this.campaign = campaign;
    this.queries = queries;
    this.mode = mode;
    this.maxResultsPerQuery = maxResultsPerQuery;
    this.enrichWebsites = enrichWebsites;
    this.headless = headless;
    this.apiKey = apiKey;
    this.websiteTimeoutMs = websiteTimeoutMs || 9000;

    this.status = 'running'; // 'running' | 'completed' | 'stopped' | 'failed'
    this.stopRequested = false;
    this.logs = [];
    this.leads = [];
    this.progress = {
      currentQueryIndex: 0,
      totalQueries: queries.length,
      currentQuery: queries[0] || '',
      stage: 'initializing',
      current: 0,
      total: maxResultsPerQuery,
      percent: 0
    };
  }

  log(message) {
    const entry = {
      timestamp: new Date().toISOString(),
      message
    };
    this.logs.push(entry);
    if (this.logs.length > 300) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  updateProgress(partial) {
    this.progress = {
      ...this.progress,
      ...partial
    };

    // Compute overall percentage across all queries in the batch
    const totalQ = Math.max(1, this.progress.totalQueries);
    const qIdx = this.progress.currentQueryIndex;
    let queryFraction = 0;

    if (this.progress.stage === 'scrolling') {
      const disc = this.progress.discoveredCount || 0;
      const targ = Math.max(1, this.progress.targetCount || this.maxResultsPerQuery);
      queryFraction = Math.min(0.25, (disc / targ) * 0.25);
    } else if (this.progress.stage === 'extracting') {
      const cur = this.progress.current || 0;
      const tot = Math.max(1, this.progress.total || 1);
      queryFraction = 0.25 + (cur / tot) * 0.75;
    }

    this.progress.percent = Math.min(
      99,
      Math.round(((qIdx + queryFraction) / totalQ) * 100)
    );

    this.emit('progress', this.progress);
  }

  stop() {
    this.stopRequested = true;
    this.log('Stop requested by user. Finishing current item and saving leads...');
  }

  async run() {
    try {
      this.log(
        `Starting extraction campaign "${this.campaign.name}" (${this.queries.length} ${
          this.queries.length === 1 ? 'query' : 'queries'
        }, mode: ${this.mode === 'places_api' ? 'Google Places API' : 'Playwright Browser Scraper'})`
      );

      for (let qIndex = 0; qIndex < this.queries.length; qIndex++) {
        if (this.stopRequested) break;

        const query = this.queries[qIndex];
        this.updateProgress({
          currentQueryIndex: qIndex,
          currentQuery: query,
          stage: 'scrolling',
          current: 0,
          total: this.maxResultsPerQuery
        });

        this.log(`--- Query [${qIndex + 1}/${this.queries.length}]: "${query}" ---`);

        const handleLead = async (rawLead) => {
          const savedLead = storage.upsertLead({
            ...rawLead,
            campaignId: this.campaign.id,
            searchQuery: query,
            sourceMode: this.mode
          });

          const existingIdx = this.leads.findIndex((l) => l.id === savedLead.id);
          if (existingIdx !== -1) {
            this.leads[existingIdx] = savedLead;
          } else {
            this.leads.push(savedLead);
          }

          const stats = storage.computeCampaignStats(this.campaign.id);
          this.campaign.stats = stats;

          this.emit('lead', {
            lead: savedLead,
            stats
          });
        };

        if (this.mode === 'places_api') {
          await scrapeQueryWithPlacesApi({
            query,
            apiKey: this.apiKey,
            maxResults: this.maxResultsPerQuery,
            enrichWebsites: this.enrichWebsites,
            websiteTimeoutMs: this.websiteTimeoutMs,
            shouldStop: () => this.stopRequested,
            onLog: (msg) => this.log(msg),
            onProgress: (p) => this.updateProgress(p),
            onLead: handleLead
          });
        } else {
          await scrapeQueryWithPlaywright({
            query,
            maxResults: this.maxResultsPerQuery,
            enrichWebsites: this.enrichWebsites,
            headless: this.headless,
            websiteTimeoutMs: this.websiteTimeoutMs,
            shouldStop: () => this.stopRequested,
            onLog: (msg) => this.log(msg),
            onProgress: (p) => this.updateProgress(p),
            onLead: handleLead
          });
        }
      }

      const finalStats = storage.computeCampaignStats(this.campaign.id);
      this.status = this.stopRequested ? 'stopped' : 'completed';
      this.progress.percent = 100;
      this.progress.stage = this.status;

      storage.updateCampaign(this.campaign.id, {
        status: this.status,
        stats: finalStats,
        completedAt: new Date().toISOString()
      });

      this.log(
        `Campaign ${this.status}! Extracted ${finalStats.totalLeads} businesses (${finalStats.withPhone} with phone, ${finalStats.withEmail} with email).`
      );

      this.emit('done', {
        status: this.status,
        stats: finalStats,
        campaignId: this.campaign.id
      });
    } catch (err) {
      this.status = 'failed';
      const finalStats = storage.computeCampaignStats(this.campaign.id);
      storage.updateCampaign(this.campaign.id, {
        status: 'failed',
        stats: finalStats,
        completedAt: new Date().toISOString()
      });
      this.log(`Error: ${err.message}`);
      this.emit('error_event', { message: err.message });
    } finally {
      setTimeout(() => {
        activeJobs.delete(this.id);
      }, 1000 * 60 * 15); // Keep job state in memory for 15 mins for reconnects
    }
  }
}

function startExtractionJob(params) {
  const settings = storage.getSettings();
  const queries = Array.isArray(params.queries)
    ? params.queries.map((q) => String(q).trim()).filter(Boolean)
    : String(params.query || '')
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean);

  if (queries.length === 0) {
    throw new Error('Please provide at least one search query (e.g., "cafes in South Delhi").');
  }

  const mode = params.mode || settings.defaultMode || 'playwright';
  const maxResultsPerQuery = Math.min(200, Math.max(1, Number(params.maxResultsPerQuery) || settings.defaultMaxResults || 30));
  const enrichWebsites = params.enrichWebsites !== undefined ? Boolean(params.enrichWebsites) : settings.enrichWebsites;
  const headless = params.headless !== undefined ? Boolean(params.headless) : settings.headless;
  const apiKey = params.apiKey || settings.googlePlacesApiKey || '';

  const campaignName =
    params.campaignName?.trim() ||
    (queries.length === 1 ? queries[0] : `${queries[0]} (+${queries.length - 1} more areas)`);

  const campaign = storage.createCampaign({
    name: campaignName,
    queries,
    mode,
    maxResultsPerQuery,
    enrichWebsites,
    status: 'running'
  });

  const job = new ExtractionJob({
    campaign,
    queries,
    mode,
    maxResultsPerQuery,
    enrichWebsites,
    headless,
    apiKey,
    websiteTimeoutMs: settings.websiteTimeoutMs || 9000
  });

  activeJobs.set(job.id, job);

  // Start asynchronously
  setImmediate(() => {
    job.run();
  });

  return job;
}

function getJob(jobId) {
  return activeJobs.get(jobId) || null;
}

function getAllActiveJobs() {
  return Array.from(activeJobs.values()).filter((j) => j.status === 'running');
}

module.exports = {
  startExtractionJob,
  getJob,
  getAllActiveJobs
};
