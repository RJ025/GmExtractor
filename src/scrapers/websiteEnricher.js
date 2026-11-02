const cheerio = require('cheerio');

const JUNK_EMAIL_DOMAINS = new Set([
  'example.com',
  'domain.com',
  'yourdomain.com',
  'email.com',
  'test.com',
  'sentry.io',
  'sentry.wixpress.com',
  'sentry-next.wixpress.com',
  'wixpress.com',
  'wix.com',
  'wordpress.org',
  'w3.org',
  'schema.org',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'facebook.com',
  'instagram.com',
  'cloudflare.com'
]);

const JUNK_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.css',
  '.js',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.pdf'
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Decode Cloudflare data-cfemail hex string
 */
function decodeCfEmail(encodedString) {
  try {
    let email = '';
    const r = parseInt(encodedString.substr(0, 2), 16);
    for (let n = 2; n < encodedString.length; n += 2) {
      const charCode = parseInt(encodedString.substr(n, 2), 16) ^ r;
      email += String.fromCharCode(charCode);
    }
    return email;
  } catch {
    return '';
  }
}

/**
 * Clean and normalize a raw URL from Google Maps
 */
function normalizeWebsiteUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();

  // Unwrap Google redirect URL if present
  if (url.includes('google.com/url?') || url.includes('/url?q=')) {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://www.google.com${url}`);
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (q) url = q;
    } catch {
      // ignore
    }
  }

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    // Avoid scraping google internal links
    if (parsed.hostname.includes('google.com') || parsed.hostname.includes('goo.gl')) {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Validate and clean a candidate email address
 */
function cleanAndValidateEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw
    .trim()
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .split('#')[0]
    .replace(/^[<("'`\s]+|[>)"'`,;:\s]+$/g, '')
    .replace(/\\u003e|\\u003c|%20/gi, '')
    .toLowerCase();

  try {
    cleaned = decodeURIComponent(cleaned).trim();
  } catch {
    // ignore malformed URI component
  }

  // Must match standard email pattern
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,15}$/i;
  if (!emailRegex.test(cleaned)) return null;

  const [localPart, domainPart] = cleaned.split('@');
  if (!localPart || !domainPart) return null;
  if (localPart.length > 64 || localPart.length < 2) return null;

  // Reject image/asset filenames mistaken for emails (e.g., logo@2x.png)
  if (JUNK_EXTENSIONS.some((ext) => cleaned.endsWith(ext))) return null;
  if (/^\d+x$/.test(domainPart.split('.')[0])) return null;

  // Reject junk domains
  if (JUNK_EMAIL_DOMAINS.has(domainPart)) return null;
  for (const junk of JUNK_EMAIL_DOMAINS) {
    if (domainPart.endsWith(`.${junk}`)) return null;
  }

  // Reject placeholder emails
  if (
    localPart === 'yourname' ||
    localPart === 'name' ||
    localPart === 'user' ||
    localPart === 'example' ||
    localPart === 'email' ||
    localPart === 'firstname.lastname' ||
    localPart.includes('noreply') ||
    localPart.includes('no-reply')
  ) {
    return null;
  }

  return cleaned;
}

/**
 * Extract emails & social profiles from HTML string
 */
function extractFromHtml(html, baseUrl) {
  const emails = new Set();
  const socials = {
    instagram: '',
    facebook: '',
    linkedin: '',
    twitter: '',
    youtube: '',
    whatsapp: ''
  };
  const candidateSubpages = new Set();

  if (!html) return { emails: [], socials, subpages: [] };

  const $ = cheerio.load(html);

  // 1. Cloudflare protected emails
  $('[data-cfemail]').each((_, el) => {
    const hex = $(el).attr('data-cfemail');
    if (hex) {
      const decoded = cleanAndValidateEmail(decodeCfEmail(hex));
      if (decoded) emails.add(decoded);
    }
  });

  // 2. JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.email) {
          const valid = cleanAndValidateEmail(String(item.email));
          if (valid) emails.add(valid);
        }
        if (Array.isArray(item.sameAs)) {
          for (const link of item.sameAs) {
            classifySocialLink(String(link), socials);
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });

  // 3. Anchor tags (mailto:, tel:, social links, contact page links)
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;

    if (href.toLowerCase().startsWith('mailto:')) {
      const valid = cleanAndValidateEmail(href);
      if (valid) emails.add(valid);
      return;
    }

    if (href.includes('/cdn-cgi/l/email-protection#')) {
      const hash = href.split('#')[1];
      if (hash) {
        const decoded = cleanAndValidateEmail(decodeCfEmail(hash));
        if (decoded) emails.add(decoded);
      }
      return;
    }

    classifySocialLink(href, socials);

    // Check if internal link to contact/about page
    if (baseUrl) {
      try {
        const resolved = new URL(href, baseUrl);
        const baseParsed = new URL(baseUrl);
        if (resolved.hostname === baseParsed.hostname) {
          const pathLower = resolved.pathname.toLowerCase();
          const textLower = $(el).text().toLowerCase();
          if (
            /\/(contact|contact-us|contactus|about|about-us|aboutus|reach-us|connect|get-in-touch|locations|find-us|support|impressum)\b/.test(
              pathLower
            ) ||
            /\b(contact|reach us|get in touch|about us)\b/.test(textLower)
          ) {
            resolved.hash = '';
            candidateSubpages.add(resolved.href);
          }
        }
      } catch {
        // ignore invalid relative URLs
      }
    }
  });

  // 4. Plain text / HTML regex for emails
  const rawMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/g) || [];
  for (const m of rawMatches) {
    const valid = cleanAndValidateEmail(m);
    if (valid) emails.add(valid);
  }

  // 5. De-obfuscate "info [at] domain [dot] com"
  const textBody = $('body').text() || '';
  const obfuscatedRegex =
    /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*([a-zA-Z]{2,10})/gi;
  let match;
  while ((match = obfuscatedRegex.exec(textBody)) !== null) {
    const reconstructed = `${match[1]}@${match[2]}.${match[3]}`;
    const valid = cleanAndValidateEmail(reconstructed);
    if (valid) emails.add(valid);
  }

  return {
    emails: Array.from(emails),
    socials,
    subpages: Array.from(candidateSubpages).slice(0, 3)
  };
}

function classifySocialLink(href, socials) {
  if (!href || typeof href !== 'string') return;
  const lower = href.toLowerCase();

  if (
    !socials.instagram &&
    (lower.includes('instagram.com/') || lower.includes('instagr.am/')) &&
    !lower.includes('/p/') &&
    !lower.includes('/reel/') &&
    !lower.includes('instagram.com/share')
  ) {
    socials.instagram = cleanSocialUrl(href);
  } else if (
    !socials.facebook &&
    (lower.includes('facebook.com/') || lower.includes('fb.com/')) &&
    !lower.includes('sharer') &&
    !lower.includes('share.php') &&
    !lower.includes('tr?id=')
  ) {
    socials.facebook = cleanSocialUrl(href);
  } else if (!socials.linkedin && lower.includes('linkedin.com/') && !lower.includes('shareArticle')) {
    socials.linkedin = cleanSocialUrl(href);
  } else if (
    !socials.twitter &&
    (lower.includes('twitter.com/') || lower.includes('x.com/')) &&
    !lower.includes('intent/tweet') &&
    !lower.includes('/share')
  ) {
    socials.twitter = cleanSocialUrl(href);
  } else if (!socials.youtube && (lower.includes('youtube.com/@') || lower.includes('youtube.com/channel/') || lower.includes('youtube.com/c/'))) {
    socials.youtube = cleanSocialUrl(href);
  } else if (
    !socials.whatsapp &&
    (lower.includes('wa.me/') || lower.includes('api.whatsapp.com/send') || lower.includes('whatsapp.com/channel/'))
  ) {
    socials.whatsapp = href.trim();
  }
}

function cleanSocialUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url.trim();
  }
}

/**
 * Rank emails so the best contact email for outreach comes first
 */
function rankEmails(emails, websiteUrl) {
  let siteDomain = '';
  try {
    siteDomain = new URL(websiteUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    // ignore
  }

  const priorityPrefixes = [
    'info',
    'contact',
    'hello',
    'enquiries',
    'enquiry',
    'inquiry',
    'bookings',
    'booking',
    'reservations',
    'events',
    'marketing',
    'sales',
    'office',
    'admin',
    'care',
    'support',
    'cafe',
    'coffee'
  ];

  return [...emails].sort((a, b) => {
    const score = (email) => {
      let s = 0;
      const [local, domain] = email.split('@');
      if (siteDomain && domain === siteDomain) s += 50;
      const prefixIdx = priorityPrefixes.findIndex((p) => local === p || local.startsWith(p));
      if (prefixIdx !== -1) s += 30 - prefixIdx;
      return s;
    };
    return score(b) - score(a);
  });
}

async function fetchHtmlWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enrich a single business website with emails & social media profiles
 */
async function enrichFromWebsite(rawWebsiteUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 9000;
  const websiteUrl = normalizeWebsiteUrl(rawWebsiteUrl);

  const emptyResult = {
    website: websiteUrl || rawWebsiteUrl || '',
    primaryEmail: '',
    emails: [],
    socials: {
      instagram: '',
      facebook: '',
      linkedin: '',
      twitter: '',
      youtube: '',
      whatsapp: ''
    }
  };

  if (!websiteUrl) return emptyResult;

  // Quick check: if the "website" on Google Maps is actually an Instagram or Facebook page directly
  const directSocials = { ...emptyResult.socials };
  classifySocialLink(websiteUrl, directSocials);
  if (directSocials.instagram || directSocials.facebook || directSocials.whatsapp) {
    return {
      ...emptyResult,
      socials: directSocials
    };
  }

  const allEmails = new Set();
  const mergedSocials = { ...emptyResult.socials };

  // Fetch homepage
  const homeHtml = await fetchHtmlWithTimeout(websiteUrl, timeoutMs);
  let subpagesToVisit = [];

  if (homeHtml) {
    const parsed = extractFromHtml(homeHtml, websiteUrl);
    parsed.emails.forEach((e) => allEmails.add(e));
    Object.keys(mergedSocials).forEach((k) => {
      if (!mergedSocials[k] && parsed.socials[k]) {
        mergedSocials[k] = parsed.socials[k];
      }
    });
    subpagesToVisit = parsed.subpages;
  }

  // If no emails found yet on homepage, also try common contact paths
  if (allEmails.size === 0) {
    try {
      const origin = new URL(websiteUrl).origin;
      const fallbacks = [`${origin}/contact`, `${origin}/contact-us`, `${origin}/about`];
      for (const fb of fallbacks) {
        if (!subpagesToVisit.includes(fb) && subpagesToVisit.length < 3) {
          subpagesToVisit.push(fb);
        }
      }
    } catch {
      // ignore
    }
  }

  // Visit up to 3 contact/about pages concurrently if needed
  if (subpagesToVisit.length > 0 && (allEmails.size === 0 || !mergedSocials.instagram)) {
    const subResults = await Promise.all(
      subpagesToVisit.slice(0, 3).map(async (subUrl) => {
        const html = await fetchHtmlWithTimeout(subUrl, Math.min(timeoutMs, 7000));
        if (!html) return null;
        return extractFromHtml(html, subUrl);
      })
    );

    for (const res of subResults) {
      if (!res) continue;
      res.emails.forEach((e) => allEmails.add(e));
      Object.keys(mergedSocials).forEach((k) => {
        if (!mergedSocials[k] && res.socials[k]) {
          mergedSocials[k] = res.socials[k];
        }
      });
    }
  }

  const ranked = rankEmails(Array.from(allEmails), websiteUrl);

  return {
    website: websiteUrl,
    primaryEmail: ranked[0] || '',
    emails: ranked,
    socials: mergedSocials
  };
}

module.exports = {
  enrichFromWebsite,
  normalizeWebsiteUrl,
  cleanAndValidateEmail
};
