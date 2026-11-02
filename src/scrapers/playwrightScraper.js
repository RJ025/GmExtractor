const { chromium } = require('playwright');
const { enrichFromWebsite, normalizeWebsiteUrl } = require('./websiteEnricher');

/**
 * Launch browser using installed Chrome or Edge first, with fallback to default Chromium
 */
async function launchBrowser(headless = true) {
  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--lang=en-US,en'
  ];

  const channelsToTry = ['chrome', 'msedge', undefined];
  let lastErr = null;

  for (const channel of channelsToTry) {
    try {
      const options = {
        headless: Boolean(headless),
        args: launchArgs
      };
      if (channel) options.channel = channel;
      return await chromium.launch(options);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to launch browser (tried Chrome, Edge, Chromium): ${lastErr ? lastErr.message : 'Unknown error'}`
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
 * Extract place details from a loaded Google Maps place page
 */
async function extractPlaceDetailsFromPage(page, fallbackItem = {}) {
  const details = await page.evaluate(() => {
    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.textContent.trim() : '';
    };

    const name =
      getText('h1.DUwDvf') ||
      getText('h1') ||
      (document.querySelector('[role="main"]')
        ? document.querySelector('[role="main"]').getAttribute('aria-label') || ''
        : '');

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
      // Fallback: check parentheses text in F7nice
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
  const coords = parseCoordinatesFromUrl(currentUrl || fallbackItem.mapsUrl);

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
    openingHours: details.openingHours || '',
    latitude: coords.latitude,
    longitude: coords.longitude,
    mapsUrl: fallbackItem.mapsUrl || currentUrl
  };
}

/**
 * Scrape Google Maps for a single search query using Playwright
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

    // Block heavy media/fonts to speed up Google Maps navigation
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'media' || type === 'font') {
        return route.abort();
      }
      return route.continue();
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    onLog(`Searching Google Maps for: "${query}"...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Dismiss Google consent dialog if shown
    try {
      const consentBtn = await page.$(
        'form[action*="consent"] button, button[aria-label*="Accept all"], button[aria-label*="Reject all"]'
      );
      if (consentBtn) {
        await consentBtn.click();
        await page.waitForTimeout(1500);
      }
    } catch {
      // ignore
    }

    // Wait for either the results feed or a direct place page
    await Promise.race([
      page.waitForSelector('div[role="feed"]', { timeout: 15000 }),
      page.waitForSelector('h1.DUwDvf', { timeout: 15000 })
    ]).catch(() => {});

    // Check if Google Maps opened a single direct place instead of a list
    const hasFeed = await page.$('div[role="feed"]');
    if (!hasFeed) {
      const singleTitle = await page.$('h1.DUwDvf');
      if (singleTitle) {
        onLog(`Found direct business match on Google Maps. Extracting details...`);
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

          const name = (anchor.getAttribute('aria-label') || '').trim();
          const container = anchor.closest('div.Nv2PK') || anchor.parentElement;
          let rating = null;
          let reviewsCount = 0;
          let website = '';

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
            const webEl = container.querySelector('a[data-value="Website"]');
            if (webEl) {
              website = webEl.getAttribute('href') || '';
            }
          }

          items.push({
            name,
            mapsUrl: href,
            rating,
            reviewsCount,
            website
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

      // Check if reached the end of the list
      const reachedEnd = await page.evaluate(() => {
        const endEl = document.querySelector('span.HlvSq');
        if (endEl && /end of the list/i.test(endEl.textContent || '')) return true;
        return false;
      });

      if (reachedEnd) {
        onLog(`Reached the end of Google Maps results for "${query}" (${collectedItems.length} listings).`);
        break;
      }

      // Scroll the feed container
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          feed.scrollBy(0, 1600);
        }
      });

      await page.waitForTimeout(1100);
    }

    const targetItems = collectedItems.slice(0, maxResults);
    onLog(`Found ${targetItems.length} listings to extract in full detail.`);

    const results = [];

    // Use a worker pool of 2 detail pages for fast extraction without triggering rate limits
    const concurrency = 2;
    let currentIndex = 0;

    const worker = async (workerId) => {
      const detailPage = await context.newPage();
      await detailPage.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'media' || type === 'font') {
          return route.abort();
        }
        return route.continue();
      });

      try {
        while (currentIndex < targetItems.length && !shouldStop()) {
          const idx = currentIndex++;
          const item = targetItems[idx];

          onLog(`[${idx + 1}/${targetItems.length}] Extracting details for: ${item.name || 'Listing'}...`);
          onProgress({
            stage: 'extracting',
            current: idx + 1,
            total: targetItems.length,
            currentBusiness: item.name
          });

          let leadData = { ...item };

          try {
            await detailPage.goto(item.mapsUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await detailPage.waitForSelector('h1.DUwDvf', { timeout: 8000 }).catch(() => {});
            // Brief wait for dynamic info buttons (phone/address/website) to render
            await detailPage.waitForTimeout(650);
            leadData = await extractPlaceDetailsFromPage(detailPage, item);
          } catch (navErr) {
            onLog(`Warning: Partial details for "${item.name}" (${navErr.message})`);
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
      } finally {
        await detailPage.close().catch(() => {});
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, targetItems.length || 1) }, (_, i) =>
      worker(i + 1)
    );
    await Promise.all(workers);

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
