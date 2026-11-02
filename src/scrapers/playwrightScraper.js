const { chromium } = require('playwright');
const { enrichFromWebsite, normalizeWebsiteUrl } = require('./websiteEnricher');

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
      const options = {
        headless: effectiveHeadless,
        args: launchArgs
      };
      if (channel) options.channel = channel;
      return await chromium.launch(options);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to launch browser: ${lastErr ? lastErr.message : 'Unknown error'}`
  );
}

/**
 * Parse coordinates from a Google Maps URL
 * Prioritizes !3d<lat>!4d<lng> (exact pin coordinates) over @<lat>,<lng> (viewport center)
 */
function parseCoordinatesFromUrl(url) {
  if (!url) return { latitude: null, longitude: null };

  const pinMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pinMatch) {
    return {
      latitude: parseFloat(pinMatch[1]),
      longitude: parseFloat(pinMatch[2])
    };
  }

  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return {
      latitude: parseFloat(atMatch[1]),
      longitude: parseFloat(atMatch[2])
    };
  }

  return { latitude: null, longitude: null };
}

/**
 * Extract place details from a loaded Google Maps place page or side-panel
 */
async function extractPlaceDetailsFromPage(page, fallbackItem = {}) {
  const details = await page.evaluate(() => {
    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.textContent.trim() : '';
    };

    const allH1s = Array.from(document.querySelectorAll('h1.DUwDvf, h1'));
    let name = '';
    for (const h of allH1s) {
      const t = h.textContent.trim();
      if (t && t.toLowerCase() !== 'results') {
        name = t;
        break;
      }
    }

    const category = getText('button.DkEaL') || getText('span.DkEaL');

    // Rating & Reviews
    let rating = null;
    let reviewsCount = 0;
    let priceLevel = '';

    const ratingSpan = document.querySelector('div.F7nice span[aria-hidden="true"]');
    if (ratingSpan) {
      const parsed = parseFloat(ratingSpan.textContent.trim().replace(',', '.'));
      if (!isNaN(parsed)) rating = parsed;
    }

    const reviewSpan = document.querySelector('div.F7nice span[aria-label*="review"]');
    if (reviewSpan) {
      const aria = reviewSpan.getAttribute('aria-label') || reviewSpan.textContent || '';
      const digits = aria.replace(/[^\d]/g, '');
      if (digits) reviewsCount = parseInt(digits, 10);
    } else {
      const f7 = document.querySelector('div.F7nice');
      if (f7) {
        const match = f7.textContent.match(/\(([\d,]+)\)/);
        if (match) {
          reviewsCount = parseInt(match[1].replace(/,/g, ''), 10) || 0;
        }
      }
    }

    const priceEl = document.querySelector('span[aria-label*="Price:"]');
    if (priceEl) {
      priceLevel = priceEl.textContent.trim();
    }

    // Address
    let address = '';
    const addrBtn =
      document.querySelector('button[data-item-id="address"]') ||
      document.querySelector('[data-item-id="address"]');
    if (addrBtn) {
      const ioText = addrBtn.querySelector('.Io6YTe');
      address = ioText
        ? ioText.textContent.trim()
        : (addrBtn.getAttribute('aria-label') || '').replace(/^Address:\s*/i, '').trim();
    }

    // Phone
    let phone = '';
    const phoneBtn =
      document.querySelector('button[data-item-id^="phone:tel:"]') ||
      document.querySelector('[data-item-id^="phone:tel:"]') ||
      document.querySelector('button[aria-label^="Phone:"]');
    if (phoneBtn) {
      const ioText = phoneBtn.querySelector('.Io6YTe');
      if (ioText && ioText.textContent.trim()) {
        phone = ioText.textContent.trim();
      } else {
        const dataId = phoneBtn.getAttribute('data-item-id') || '';
        if (dataId.startsWith('phone:tel:')) {
          phone = dataId.replace('phone:tel:', '').trim();
        } else {
          phone = (phoneBtn.getAttribute('aria-label') || '').replace(/^Phone:\s*/i, '').trim();
        }
      }
    }

    // Website
    let website = '';
    const webLink =
      document.querySelector('a[data-item-id="authority"]') ||
      document.querySelector('a[aria-label^="Website:"]');
    if (webLink) {
      website = webLink.getAttribute('href') || '';
    }

    // Plus Code
    let plusCode = '';
    const plusBtn = document.querySelector('button[data-item-id="oloc"]');
    if (plusBtn) {
      const ioText = plusBtn.querySelector('.Io6YTe');
      plusCode = ioText
        ? ioText.textContent.trim()
        : (plusBtn.getAttribute('aria-label') || '').replace(/^Plus code:\s*/i, '').trim();
    }

    // Opening Hours
    let openingHours = '';
    const hoursEl =
      document.querySelector('[data-item-id^="oh"] .Io6YTe') ||
      document.querySelector('div.t39EBf.GUrTXd') ||
      document.querySelector('span.ZDu9vd');
    if (hoursEl) {
      openingHours = hoursEl.getAttribute('aria-label') || hoursEl.textContent.trim();
      openingHours = openingHours.replace(/\s+/g, ' ').trim();
    }

    return {
      name,
      category,
      rating,
      reviewsCount,
      priceLevel,
      address,
      phone,
      website,
      plusCode,
      openingHours
    };
  });

  const currentUrl = page.url();
  const coords = parseCoordinatesFromUrl(fallbackItem.mapsUrl || currentUrl);

  return {
    name: details.name || fallbackItem.name || 'Unknown Business',
    category: details.category || fallbackItem.category || '',
    rating: details.rating !== null ? details.rating : fallbackItem.rating ?? null,
    reviewsCount: details.reviewsCount || fallbackItem.reviewsCount || 0,
    priceLevel: details.priceLevel || fallbackItem.priceLevel || '',
    address: details.address || fallbackItem.address || '',
    phone: details.phone || fallbackItem.phone || '',
    website: normalizeWebsiteUrl(details.website || fallbackItem.website || ''),
    plusCode: details.plusCode || '',
    openingHours: details.openingHours || fallbackItem.openingHours || '',
    latitude: coords.latitude,
    longitude: coords.longitude,
    mapsUrl: fallbackItem.mapsUrl || currentUrl
  };
}

/**
 * Scrape Google Maps for a single search query using Playwright
 * Uses fast in-page SPA card clicking first (avoiding costly full-page reloads & timeouts on cloud CPUs),
 * with a lightweight 'commit' navigation fallback if needed.
 */
async function scrapeQueryWithPlaywright({
  query,
  maxResults = 30,
  enrichWebsites = true,
  headless = true,
  websiteTimeoutMs = 9000,
  shouldStop = () => false,
  onLog = () => {},
  onProgress = () => {},
  onLead = async () => {}
}) {
  let browser = null;

  try {
    onLog(`Launching browser (${headless ? 'headless' : 'visible'} mode)...`);
    browser = await launchBrowser(headless);

    const context = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Block heavy images, map vector tiles, streetview photos, media, and fonts so Google Maps runs fast even on 0.1 vCPU
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
    onLog(`Searching Google Maps for: "${query}"...`);
    await page.goto(searchUrl, { waitUntil: 'commit', timeout: 60000 });

    // Wait for initial DOM elements
    await Promise.race([
      page.waitForSelector('div[role="feed"]', { timeout: 25000 }),
      page.waitForSelector('h1.DUwDvf', { timeout: 25000 }),
      page.waitForSelector('form[action*="consent"] button', { timeout: 25000 })
    ]).catch(() => {});

    // Dismiss Google consent dialog if shown
    try {
      const consentBtn = await page.$(
        'form[action*="consent"] button, button[aria-label*="Accept all"], button[aria-label*="Reject all"]'
      );
      if (consentBtn) {
        await consentBtn.click();
        await Promise.race([
          page.waitForSelector('div[role="feed"]', { timeout: 20000 }),
          page.waitForSelector('h1.DUwDvf', { timeout: 20000 })
        ]).catch(() => {});
      }
    } catch {
      // ignore
    }

    // Check if Google Maps opened a single direct place instead of a list
    const hasFeed = await page.$('div[role="feed"]');
    if (!hasFeed) {
      const singleTitle = await page.$('h1.DUwDvf');
      if (singleTitle) {
        onLog(`Found direct business match on Google Maps. Extracting details...`);
        await page.waitForTimeout(800);
        const leadData = await extractPlaceDetailsFromPage(page, { mapsUrl: page.url() });
        if (enrichWebsites && leadData.website) {
          onLog(`Crawling website for email & socials: ${leadData.website}`);
          const enriched = await enrichFromWebsite(leadData.website, { timeoutMs: websiteTimeoutMs });
          leadData.primaryEmail = enriched.primaryEmail;
          leadData.emails = enriched.emails;
          leadData.socials = enriched.socials;
          leadData.whatsapp = enriched.socials?.whatsapp || '';
        }
        await onLead(leadData);
        return [leadData];
      }
    }

    // Scroll the feed to collect listing cards up to maxResults
    onLog(`Scrolling Google Maps results list (target: up to ${maxResults} places)...`);
    let collectedItems = [];
    let stagnantRounds = 0;
    let lastCount = 0;

    while (collectedItems.length < maxResults && stagnantRounds < 7 && !shouldStop()) {
      collectedItems = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('div[role="feed"] a.hfpxzc'));
        const seen = new Set();
        const items = [];

        for (const anchor of cards) {
          const href = anchor.getAttribute('href') || '';
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const container = anchor.closest('div.Nv2PK') || anchor.parentElement;
          const name =
            (anchor.getAttribute('aria-label') || '').trim() ||
            (container?.querySelector('.qBF1Pd')?.textContent || '').trim();

          let rating = null;
          let reviewsCount = 0;
          let website = '';
          let phone = '';
          let category = '';
          let address = '';
          let openingHours = '';

          if (container) {
            const ratingEl = container.querySelector('span.MW4etd');
            if (ratingEl) {
              const r = parseFloat(ratingEl.textContent.trim().replace(',', '.'));
              if (!isNaN(r)) rating = r;
            }
            const revEl = container.querySelector('span.UY7F9');
            if (revEl) {
              const digits = revEl.textContent.replace(/[^\d]/g, '');
              if (digits) reviewsCount = parseInt(digits, 10);
            }
            const webEl = container.querySelector('a.lcr4fd, a[data-value="Website"]');
            if (webEl) {
              website = webEl.getAttribute('href') || '';
            }
            const phoneEl = container.querySelector('.UsdlK');
            if (phoneEl) {
              phone = phoneEl.textContent.trim();
            }

            // Parse fallback category & address snippet from .W4Efsd lines
            const w4Lines = Array.from(container.querySelectorAll('.W4Efsd'))
              .map((el) => el.textContent.trim())
              .filter(Boolean);

            for (const line of w4Lines) {
              if (line.includes('·') && !/^\d\.\d/.test(line) && !/open|closes|closed/i.test(line)) {
                const parts = line
                  .split('·')
                  .map((p) => p.replace(/[^\w\s,/-]/g, '').trim())
                  .filter(Boolean);
                if (parts.length >= 1 && !category) category = parts[0];
                if (parts.length >= 2 && !address) address = parts[parts.length - 1];
              } else if (/open|closes|closed/i.test(line) && !openingHours) {
                openingHours = line.replace(/\s+/g, ' ').trim();
              }
            }
          }

          items.push({
            name,
            mapsUrl: href,
            rating,
            reviewsCount,
            website,
            phone,
            category,
            address,
            openingHours
          });
        }
        return items;
      });

      onProgress({
        stage: 'scrolling',
        discoveredCount: Math.min(collectedItems.length, maxResults),
        targetCount: maxResults
      });

      if (collectedItems.length >= maxResults) {
        break;
      }

      if (collectedItems.length === lastCount) {
        stagnantRounds++;
      } else {
        stagnantRounds = 0;
        lastCount = collectedItems.length;
        onLog(`Loaded ${collectedItems.length} listings from Google Maps feed...`);
      }

      const reachedEnd = await page.evaluate(() => {
        const endEl = document.querySelector('span.HlvSq');
        return Boolean(endEl && /end of the list/i.test(endEl.textContent || ''));
      });

      if (reachedEnd) {
        onLog(`Reached the end of Google Maps results for "${query}" (${collectedItems.length} listings).`);
        break;
      }

      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollBy(0, 1600);
      });

      await page.waitForTimeout(1000);
    }

    const targetItems = collectedItems.slice(0, maxResults);
    onLog(`Found ${targetItems.length} listings. Extracting full contact details...`);

    const results = [];

    for (let idx = 0; idx < targetItems.length; idx++) {
      if (shouldStop()) break;

      const item = targetItems[idx];
      const coords = parseCoordinatesFromUrl(item.mapsUrl);
      let leadData = {
        ...item,
        latitude: coords.latitude,
        longitude: coords.longitude,
        website: normalizeWebsiteUrl(item.website)
      };

      onLog(`[${idx + 1}/${targetItems.length}] Extracting details for: ${item.name || 'Listing'}...`);
      onProgress({
        stage: 'extracting',
        current: idx + 1,
        total: targetItems.length,
        currentBusiness: item.name
      });

      let extractedFromPanel = false;

      // Extract unique place identifier (!1s0x...) from URL so matching works even if Google mutates query params
      const placeKeyMatch = (item.mapsUrl || '').match(/!1s([^!]+)/);
      const placeKey = placeKeyMatch ? placeKeyMatch[1] : '';

      // Strategy 1: Fast In-Page SPA Click (no full page reload, works in ~1s even on 0.1 vCPU)
      try {
        const clicked = await page.evaluate(
          ({ targetHref, targetName, key }) => {
            const anchors = Array.from(document.querySelectorAll('div[role="feed"] a.hfpxzc'));
            const target = anchors.find((a) => {
              const href = a.getAttribute('href') || '';
              const label = (a.getAttribute('aria-label') || '').trim();
              if (key && href.includes(key)) return true;
              if (href === targetHref) return true;
              if (targetName && label.toLowerCase() === targetName.toLowerCase()) return true;
              return false;
            });
            if (target) {
              target.scrollIntoView({ block: 'center' });
              target.click();
              return true;
            }
            return false;
          },
          { targetHref: item.mapsUrl, targetName: item.name, key: placeKey }
        );

        if (clicked) {
          // Wait for the side panel h1.DUwDvf to match the clicked card's name AND contact buttons to hydrate
          await page
            .waitForFunction(
              (expectedName) => {
                const h1s = Array.from(document.querySelectorAll('h1.DUwDvf'));
                const nameMatched = h1s.some((h) => {
                  const txt = h.textContent.trim().toLowerCase();
                  const exp = (expectedName || '').trim().toLowerCase();
                  return txt && txt !== 'results' && (txt === exp || txt.includes(exp.slice(0, 10)));
                });
                if (!nameMatched) return false;
                const hasContactNode = Boolean(
                  document.querySelector('button[data-item-id="address"]') ||
                    document.querySelector('button[data-item-id^="phone:tel:"]') ||
                    document.querySelector('a[data-item-id="authority"]')
                );
                return hasContactNode;
              },
              item.name,
              { timeout: 8000 }
            )
            .catch(() => {});

          await page.waitForTimeout(450);
          leadData = await extractPlaceDetailsFromPage(page, leadData);
          if (leadData.phone || leadData.website || (leadData.address && leadData.address.length > 25)) {
            extractedFromPanel = true;
          }
        }
      } catch {
        // Fallback below if feed click wasn't available
      }

      // Strategy 2: Lightweight 'commit' navigation fallback if SPA click didn't hydrate contact nodes
      if (!extractedFromPanel) {
        try {
          await page.goto(item.mapsUrl, { waitUntil: 'commit', timeout: 45000 });
          await page
            .waitForSelector('button[data-item-id="address"], button[data-item-id^="phone:tel:"], h1.DUwDvf', {
              timeout: 12000
            })
            .catch(() => {});
          await page.waitForTimeout(600);
          leadData = await extractPlaceDetailsFromPage(page, leadData);
        } catch (navErr) {
          onLog(`Note: Using feed card details for "${item.name}"`);
        }
      }

      if (shouldStop()) break;

      // Website Enrichment for Email ID & Social Links
      if (enrichWebsites && leadData.website) {
        onLog(`[${idx + 1}/${targetItems.length}] Scanning website for email & socials: ${leadData.website}`);
        try {
          const enriched = await enrichFromWebsite(leadData.website, { timeoutMs: websiteTimeoutMs });
          leadData.website = enriched.website || leadData.website;
          leadData.primaryEmail = enriched.primaryEmail || '';
          leadData.emails = enriched.emails || [];
          leadData.socials = enriched.socials || {};
          leadData.whatsapp = enriched.socials?.whatsapp || '';
          if (leadData.primaryEmail) {
            onLog(`   ✓ Found email for ${leadData.name}: ${leadData.primaryEmail}`);
          }
        } catch (enrichErr) {
          onLog(`   ! Website scan skipped for ${leadData.name}: ${enrichErr.message}`);
        }
      }

      results.push(leadData);
      await onLead(leadData);
    }

    return results;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  scrapeQueryWithPlaywright
};
