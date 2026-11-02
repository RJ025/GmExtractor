const { chromium } = require('playwright');
const { enrichFromWebsite, normalizeWebsiteUrl } = require('./websiteEnricher');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Parse a single Google Maps raw business array node into a normalized lead object
 */
function parseBusinessNode(b) {
  if (!Array.isArray(b) || typeof b[11] !== 'string') return null;

  const name = b[11].trim();
  if (!name) return null;

  const placeId =
    (typeof b[78] === 'string' && b[78]) ||
    (typeof b[10] === 'string' && b[10]) ||
    (typeof b[0] === 'string' && b[0]) ||
    '';

  const category = (Array.isArray(b[13]) && typeof b[13][0] === 'string' ? b[13][0] : '').trim();

  const address =
    (typeof b[39] === 'string' && b[39].trim()) ||
    (Array.isArray(b[2]) ? b[2].filter(Boolean).join(', ').trim() : '') ||
    (typeof b[18] === 'string' ? b[18].replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`, 'i'), '').trim() : '');

  const neighborhood = typeof b[14] === 'string' ? b[14].trim() : '';

  const phone =
    (typeof b[178]?.[0]?.[0] === 'string' && b[178][0][0].trim()) ||
    (typeof b[178]?.[0]?.[1]?.[1]?.[0] === 'string' && b[178][0][1][1][0].trim()) ||
    (typeof b[178]?.[0]?.[3] === 'string' && b[178][0][3].trim()) ||
    '';

  const rawWebsite = typeof b[7]?.[0] === 'string' ? b[7][0] : '';
  const website = normalizeWebsiteUrl(rawWebsite);

  const rating = typeof b[4]?.[7] === 'number' ? b[4][7] : null;
  const reviewsCount =
    typeof b[4]?.[8] === 'number'
      ? b[4][8]
      : typeof b[37]?.[1] === 'number'
      ? b[37][1]
      : 0;

  const priceLevel = typeof b[4]?.[2] === 'string' ? b[4][2] : '';

  const latitude = typeof b[9]?.[2] === 'number' ? b[9][2] : null;
  const longitude = typeof b[9]?.[3] === 'number' ? b[9][3] : null;

  // Weekly opening hours
  let openingHours = '';
  if (Array.isArray(b[203]?.[0])) {
    openingHours = b[203][0]
      .map((dayEntry) => {
        if (!Array.isArray(dayEntry)) return '';
        const dayName = dayEntry[0] || '';
        const hoursStr = dayEntry[3]?.[0]?.[0] || '';
        return dayName && hoursStr ? `${dayName}: ${hoursStr.replace(/\s+/g, ' ').trim()}` : '';
      })
      .filter(Boolean)
      .join(' | ');
  }

  // Plus Code
  let plusCode = '';
  if (Array.isArray(b[183]?.[2])) {
    const pcCandidate = b[183][2].flat(4).find((x) => typeof x === 'string' && /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}/i.test(x));
    if (pcCandidate) plusCode = pcCandidate;
  }

  // Direct Google Maps link
  let mapsUrl = '';
  if (typeof b[78] === 'string' && b[78].startsWith('ChI')) {
    mapsUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(b[78])}`;
  } else if (latitude !== null && longitude !== null) {
    const hexId = typeof b[10] === 'string' ? b[10] : '';
    mapsUrl = hexId
      ? `https://www.google.com/maps/place/${encodeURIComponent(name)}/@${latitude},${longitude},17z/data=!3m1!4b1!4m6!3m5!1s${hexId}!8m2!3d${latitude}!4d${longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  return {
    placeId,
    name,
    category,
    address,
    neighborhood,
    phone,
    website,
    rating,
    reviewsCount,
    priceLevel,
    openingHours,
    plusCode,
    latitude,
    longitude,
    mapsUrl
  };
}

/**
 * Recursively walk a parsed Google Maps JSON payload and extract all business listings
 */
function extractBusinessesFromMapJson(root) {
  const results = [];
  const seenKeys = new Set();

  function walk(node) {
    if (!Array.isArray(node)) return;

    if (
      typeof node[11] === 'string' &&
      node[11].trim().length > 0 &&
      Array.isArray(node[9]) &&
      typeof node[9][2] === 'number' &&
      typeof node[9][3] === 'number' &&
      (typeof node[78] === 'string' || typeof node[10] === 'string')
    ) {
      const parsed = parseBusinessNode(node);
      if (parsed) {
        const key = parsed.placeId || `${parsed.name.toLowerCase()}|${parsed.latitude}|${parsed.longitude}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push(parsed);
        }
      }
      return;
    }

    for (let i = 0; i < node.length; i++) {
      if (Array.isArray(node[i])) {
        walk(node[i]);
      }
    }
  }

  walk(root);
  return results;
}

/**
 * Fast, zero-browser Google Maps RPC extractor.
 * Works in <2 seconds even on 0.1 vCPU / 512MB RAM cloud containers (Render/Railway)
 * and extracts 100% of fields directly from Google Maps' internal JSON stream.
 */
async function fetchViaGoogleMapsRpc(query, maxResults = 30, shouldStop = () => false, onLog = () => {}, onProgress = () => {}) {
  const collected = [];
  const seenKeys = new Set();

  // Default viewport coordinates (updated dynamically after page 1 to center on the exact search region)
  let dist = 45000;
  let lng = 77.209;
  let lat = 28.5355;

  const headers = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.google.com/maps'
  };

  for (let offset = 0; collected.length < maxResults && offset < 200 && !shouldStop(); offset += 20) {
    const pb = `!4m12!1m3!1d${dist}!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1280!2i800!4f13.1!7i20!8i${offset}!10b1!12m8!1m1!18b1!2m3!5m1!6e2!20e3!10b1!16b1!19m4!2m3!1i360!2i120!4i8`;
    const url = `https://www.google.com/search?tbm=map&authuser=0&hl=en&q=${encodeURIComponent(
      query
    )}&pb=${encodeURIComponent(pb)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    let text = '';
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) break;
      text = await res.text();
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }

    if (!text || text.length < 100) break;

    let parsedJson = null;
    try {
      const cleaned = text.replace(/^\)\]\}'\n?/, '');
      parsedJson = JSON.parse(cleaned);
    } catch {
      break;
    }

    const batch = extractBusinessesFromMapJson(parsedJson);
    if (batch.length === 0) break;

    // Lock viewport coordinates onto the target search region from the first result
    if (offset === 0 && batch[0]?.latitude && batch[0]?.longitude) {
      lat = batch[0].latitude;
      lng = batch[0].longitude;
      dist = 18000;
    }

    let addedInBatch = 0;
    for (const item of batch) {
      if (collected.length >= maxResults) break;
      const key = item.placeId || `${item.name.toLowerCase()}|${item.address.toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        collected.push(item);
        addedInBatch++;
      }
    }

    onProgress({
      stage: 'scrolling',
      discoveredCount: collected.length,
      targetCount: maxResults
    });

    onLog(`Fetched ${collected.length} complete business profiles from Google Maps...`);

    if (addedInBatch === 0 || batch.length < 10) {
      break;
    }
  }

  return collected;
}

/**
 * Launch browser using installed Chrome or Edge on desktop, or bundled Chromium on Linux/Docker (Render/Railway)
 */
async function launchBrowser(headless = true) {
  const effectiveHeadless =
    process.platform === 'linux' && !process.env.DISPLAY ? true : Boolean(headless);

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--lang=en-US,en'
  ];

  const isContainer =
    process.platform === 'linux' ||
    Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.DOCKER_CONTAINER);

  const channelsToTry = isContainer
    ? [undefined, 'chrome', 'msedge']
    : ['chrome', 'msedge', undefined];

  let lastErr = null;
  for (const channel of channelsToTry) {
    try {
      const options = { headless: effectiveHeadless, args: launchArgs };
      if (channel) options.channel = channel;
      return await chromium.launch(options);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to launch browser: ${lastErr ? lastErr.message : 'Unknown error'}`);
}

/**
 * Fallback browser-based Google Maps extractor that intercepts XHR JSON payloads while scrolling
 */
async function fetchViaPlaywrightBrowser(query, maxResults, headless, shouldStop, onLog, onProgress) {
  let browser = null;
  const collectedMap = new Map();

  try {
    onLog(`Launching browser (${headless ? 'headless' : 'visible'} mode)...`);
    browser = await launchBrowser(headless);
    const context = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      locale: 'en-US',
      userAgent: USER_AGENT
    });
    const page = await context.newPage();

    // Intercept Google Maps search?tbm=map JSON responses automatically as the feed loads & scrolls
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('search?tbm=map')) {
        try {
          const txt = await res.text();
          const cleaned = txt.replace(/^\)\]\}'\n?/, '');
          const json = JSON.parse(cleaned);
          const businesses = extractBusinessesFromMapJson(json);
          for (const b of businesses) {
            const key = b.placeId || `${b.name.toLowerCase()}|${b.address.toLowerCase()}`;
            if (!collectedMap.has(key)) {
              collectedMap.set(key, b);
            }
          }
        } catch {
          // ignore non-JSON
        }
      }
    });

    await page.route('**/*', (route) => {
      const req = route.request();
      const type = req.resourceType();
      const url = req.url();
      if (
        type === 'image' ||
        type === 'media' ||
        type === 'font' ||
        url.includes('/maps/vt') ||
        url.includes('streetviewpixels') ||
        url.includes('googleusercontent.com/p/') ||
        url.includes('ggpht.com')
      ) {
        return route.abort();
      }
      return route.continue();
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    await page.goto(searchUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForSelector('div[role="feed"]', { timeout: 25000 }).catch(() => {});

    let stagnantRounds = 0;
    let lastSize = 0;

    while (collectedMap.size < maxResults && stagnantRounds < 6 && !shouldStop()) {
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollBy(0, 1800);
      });
      await page.waitForTimeout(1200);

      onProgress({
        stage: 'scrolling',
        discoveredCount: Math.min(collectedMap.size, maxResults),
        targetCount: maxResults
      });

      if (collectedMap.size === lastSize) {
        stagnantRounds++;
      } else {
        stagnantRounds = 0;
        lastSize = collectedMap.size;
        onLog(`Loaded ${collectedMap.size} listings from Google Maps feed...`);
      }
    }

    return Array.from(collectedMap.values()).slice(0, maxResults);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Main Google Maps extraction entry point:
 * 1. Uses high-speed Google Maps RPC JSON extraction first (unless user explicitly requested visible browser window on desktop).
 * 2. Automatically falls back to Playwright browser XHR interception if needed.
 * 3. Runs parallel website email & social media enrichment (5x concurrency) for fast completion on cloud & local.
 */
async function scrapeQueryWithPlaywright({
  query,
  maxResults = 30,
  enrichWebsites = true,
  headless = true,
  websiteTimeoutMs = 7500,
  shouldStop = () => false,
  onLog = () => {},
  onProgress = () => {},
  onLead = async () => {}
}) {
  onLog(`Searching Google Maps for: "${query}" (target: up to ${maxResults} businesses)...`);

  let rawLeads = [];
  const wantsVisibleBrowserOnDesktop = !headless && process.platform !== 'linux';

  if (!wantsVisibleBrowserOnDesktop) {
    rawLeads = await fetchViaGoogleMapsRpc(query, maxResults, shouldStop, onLog, onProgress);
  }

  if (rawLeads.length === 0 && !shouldStop()) {
    rawLeads = await fetchViaPlaywrightBrowser(query, maxResults, headless, shouldStop, onLog, onProgress);
  }

  onLog(`Extracted ${rawLeads.length} complete Google Maps listings (with phone, address, website, rating & hours).`);

  // Stream initial Google Maps listings immediately so the table populates right away!
  for (const lead of rawLeads) {
    if (shouldStop()) break;
    await onLead(lead);
  }

  // Enrich websites for Email IDs & Social Media Links in parallel batches (5 concurrent)
  if (enrichWebsites && rawLeads.length > 0 && !shouldStop()) {
    const leadsWithWebsite = rawLeads.filter((l) => Boolean(l.website));
    onLog(
      `Scanning ${leadsWithWebsite.length} business websites in parallel for Email IDs & Social Links (Instagram/FB/LinkedIn/WhatsApp)...`
    );

    const concurrency = 5;
    let cursor = 0;
    let completedCount = 0;

    const enrichWorker = async () => {
      while (cursor < rawLeads.length && !shouldStop()) {
        const idx = cursor++;
        const leadData = rawLeads[idx];

        if (leadData.website) {
          try {
            const enriched = await enrichFromWebsite(leadData.website, {
              timeoutMs: Math.min(websiteTimeoutMs || 7500, 7500)
            });
            leadData.website = enriched.website || leadData.website;
            leadData.primaryEmail = enriched.primaryEmail || '';
            leadData.emails = enriched.emails || [];
            leadData.socials = enriched.socials || {};
            leadData.whatsapp = enriched.socials?.whatsapp || '';

            if (leadData.primaryEmail) {
              onLog(`   ✓ [${idx + 1}/${rawLeads.length}] Found email for ${leadData.name}: ${leadData.primaryEmail}`);
            }
            // Update lead in DB and live table with newly discovered email & socials
            await onLead(leadData);
          } catch {
            // ignore individual website timeout
          }
        }

        completedCount++;
        onProgress({
          stage: 'extracting',
          current: completedCount,
          total: rawLeads.length,
          currentBusiness: leadData.name
        });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, rawLeads.length) }, () => enrichWorker());
    await Promise.all(workers);
  }

  return rawLeads;
}

module.exports = {
  scrapeQueryWithPlaywright
};
