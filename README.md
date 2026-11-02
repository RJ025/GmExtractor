# GmExtractor Pro — Google Maps Lead Extractor & Outreach Suite

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/RJ025/GmExtractor)

A full-stack web application that extracts business leads from **Google Maps** (e.g., *"cafes in South Delhi"*), crawls each business's website for **email IDs and social media links** (Instagram, Facebook, LinkedIn, WhatsApp), manages outreach status in a built-in CRM, and exports everything into a multi-sheet **Excel (`.xlsx`)** or **CSV** file.

---

## ✨ Key Features

1. **Dual Extraction Engines**:
   - **Playwright Browser Scraper (Default — Free, No API Key Required)**: Uses your installed Chrome/Edge browser to search Google Maps, scroll the results feed, and extract every listing's details.
   - **Google Places Official API Mode**: Optional mode supporting both Places API (New v1) and Legacy Text Search + Place Details using your Google Cloud API key.
2. **Automatic Website Email & Social Media Crawler**:
   - Since Google Maps rarely displays email addresses directly on listings, GmExtractor automatically visits each business's linked website (and its `/contact`, `/contact-us`, `/about` pages) to extract:
     - **Email IDs** (prioritizing business contact emails, decoding Cloudflare `data-cfemail` protection, `mailto:` links, and JSON-LD `schema.org` metadata)
     - **Social Profiles**: Instagram, Facebook, LinkedIn, Twitter/X, YouTube, and WhatsApp links.
3. **Smart Sub-Area / Neighborhood Expander & Bulk Search**:
   - Google Maps caps a single search query feed at ~120 results. Use the **✨ Expand Sub-Areas** tool to split a broad region (e.g., *"cafes in South Delhi"*) into 10–15 neighborhood queries (Hauz Khas, Greater Kailash, Saket, Defence Colony, Vasant Kunj, Green Park, Malviya Nagar, Lajpat Nagar, etc.) and run them in a single automated batch.
4. **Live Extraction Progress & Real-Time Table**:
   - Watch progress percentages, live counters, terminal logs, and newly extracted businesses appear row-by-row via Server-Sent Events (SSE).
5. **Lead Filtering & Outreach CRM Dashboard**:
   - Filter leads by **Has Email**, **Has Phone**, **Has Website**, **No Website** (ideal for pitching web development/marketing services), **Has Social Links**, **Minimum Rating**, or **Outreach Status** (`New`, `Contacted`, `Interested`, `Follow-Up`, `Meeting Booked`, `Closed`, `Not Interested`).
   - Add custom sales notes, star high-priority prospects, and launch 1-click WhatsApp chats or emails.
6. **Formatted Multi-Sheet Excel (`.xlsx`) & CSV Export**:
   - Exports a styled Excel workbook with frozen headers, auto-filters, clickable links, and two worksheets:
     - **Sheet 1 (`Leads Directory`)**: Business Name, Category, Primary Email, All Emails, Phone Number, Website, Full Address, Search Query/Area, Rating, Reviews, Price Level, Instagram, Facebook, LinkedIn, WhatsApp, Opening Hours, Outreach Status, Marketing Notes, Plus Code, Coordinates, and Google Maps Link.
     - **Sheet 2 (`Summary & Analytics`)**: Lead enrichment breakdown and counts by search area.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the web application
npm start
```

Then open **http://localhost:5000** in your browser.
