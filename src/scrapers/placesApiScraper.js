const { enrichFromWebsite, normalizeWebsiteUrl } = require('./websiteEnricher');

/**
 * Scrape Google Maps places using official Google Places API (New v1 with fallback to Legacy Text Search + Place Details)
 */
async function scrapeQueryWithPlacesApi({
  query,
  apiKey,
  maxResults = 30,
  enrichWebsites = true,
  websiteTimeoutMs = 9000,
  shouldStop = () => false,
  onLog = () => {},
  onProgress = () => {},
  onLead = async () => {}
}) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Google Places API Key is required for API mode. Please add it in Settings or switch to Playwright Scraper mode.');
  }

  const cleanKey = apiKey.trim();
  onLog(`Querying Google Places API for: "${query}"...`);

  let rawPlaces = [];

  // Try Places API (New v1) first
  try {
    rawPlaces = await fetchPlacesV1(query, cleanKey, maxResults, shouldStop, onLog);
  } catch (v1Err) {
    onLog(`Places API v1 note (${v1Err.message}), attempting Legacy Places TextSearch API...`);
    rawPlaces = await fetchPlacesLegacy(query, cleanKey, maxResults, shouldStop, onLog);
  }

  onLog(`Retrieved ${rawPlaces.length} places from Google Places API.`);
  const results = [];

  for (let i = 0; i < rawPlaces.length; i++) {
    if (shouldStop()) break;
    const item = rawPlaces[i];

    onProgress({
      stage: 'extracting',
      current: i + 1,
      total: rawPlaces.length,
      currentBusiness: item.name
    });

    if (enrichWebsites && item.website) {
      onLog(`[${i + 1}/${rawPlaces.length}] Scanning website for email & socials: ${item.website}`);
      try {
        const enriched = await enrichFromWebsite(item.website, { timeoutMs: websiteTimeoutMs });
        item.website = enriched.website || item.website;
        item.primaryEmail = enriched.primaryEmail || '';
        item.emails = enriched.emails || [];
        item.socials = enriched.socials || {};
        item.whatsapp = enriched.socials?.whatsapp || '';
        if (item.primaryEmail) {
          onLog(`   ✓ Found email for ${item.name}: ${item.primaryEmail}`);
        }
      } catch (err) {
        onLog(`   ! Website scan failed for ${item.name}: ${err.message}`);
      }
    }

    results.push(item);
    await onLead(item);
  }

  return results;
}

async function fetchPlacesV1(query, apiKey, maxResults, shouldStop, onLog) {
  const collected = [];
  let pageToken = null;

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.primaryTypeDisplayName',
    'places.formattedAddress',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber',
    'places.websiteUri',
    'places.googleMapsUri',
    'places.rating',
    'places.userRatingCount',
    'places.priceLevel',
    'places.regularOpeningHours',
    'places.location',
    'places.plusCode',
    'nextPageToken'
  ].join(',');

  while (collected.length < maxResults && !shouldStop()) {
    const body = {
      textQuery: query,
      pageSize: Math.min(20, maxResults - collected.length)
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    const places = data.places || [];
    for (const p of places) {
      if (collected.length >= maxResults) break;
      collected.push({
        placeId: p.id || '',
        name: p.displayName?.text || 'Unknown Business',
        category: p.primaryTypeDisplayName?.text || '',
        address: p.formattedAddress || '',
        phone: p.internationalPhoneNumber || p.nationalPhoneNumber || '',
        website: normalizeWebsiteUrl(p.websiteUri || ''),
        rating: p.rating ?? null,
        reviewsCount: p.userRatingCount || 0,
        priceLevel: p.priceLevel || '',
        openingHours: (p.regularOpeningHours?.weekdayDescriptions || []).join(' | '),
        plusCode: p.plusCode?.globalCode || '',
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        mapsUrl: p.googleMapsUri || ''
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken || places.length === 0) break;
    onLog(`Loaded ${collected.length} places from API, fetching next page...`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  return collected;
}

async function fetchPlacesLegacy(query, apiKey, maxResults, shouldStop, onLog) {
  const collected = [];
  let nextPageToken = null;

  while (collected.length < maxResults && !shouldStop()) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    url.searchParams.set('key', apiKey);
    if (nextPageToken) url.searchParams.set('pagetoken', nextPageToken);

    const res = await fetch(url.href);
    const data = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message || `Places API status: ${data.status}`);
    }

    const results = data.results || [];
    for (const r of results) {
      if (collected.length >= maxResults || shouldStop()) break;

      // Fetch place details for phone & website
      const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      detailsUrl.searchParams.set('place_id', r.place_id);
      detailsUrl.searchParams.set(
        'fields',
        'name,formatted_address,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,price_level,opening_hours,plus_code,geometry,types'
      );
      detailsUrl.searchParams.set('key', apiKey);

      let det = {};
      try {
        const detRes = await fetch(detailsUrl.href);
        const detJson = await detRes.json();
        det = detJson.result || {};
      } catch {
        // ignore detail failure
      }

      collected.push({
        placeId: r.place_id || '',
        name: det.name || r.name || 'Unknown Business',
        category: ((det.types || r.types || [])[0] || '').replace(/_/g, ' '),
        address: det.formatted_address || r.formatted_address || '',
        phone: det.international_phone_number || det.formatted_phone_number || '',
        website: normalizeWebsiteUrl(det.website || ''),
        rating: det.rating ?? r.rating ?? null,
        reviewsCount: det.user_ratings_total || r.user_ratings_total || 0,
        priceLevel: det.price_level ? '₹'.repeat(det.price_level) : '',
        openingHours: (det.opening_hours?.weekday_text || []).join(' | '),
        plusCode: det.plus_code?.global_code || r.plus_code?.global_code || '',
        latitude: det.geometry?.location?.lat ?? r.geometry?.location?.lat ?? null,
        longitude: det.geometry?.location?.lng ?? r.geometry?.location?.lng ?? null,
        mapsUrl: det.url || `https://www.google.com/maps/place/?q=place_id:${r.place_id}`
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken || results.length === 0) break;
    onLog(`Loaded ${collected.length} places from Legacy API, waiting for next page token...`);
    await new Promise((r) => setTimeout(r, 2200));
  }

  return collected;
}

module.exports = {
  scrapeQueryWithPlacesApi
};
