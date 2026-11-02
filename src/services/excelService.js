const ExcelJS = require('exceljs');

/**
 * Generate a rich multi-sheet Excel (.xlsx) buffer from leads array
 */
async function generateLeadsExcelBuffer(leads = [], meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GmExtractor - Google Maps Lead Extractor';
  workbook.created = new Date();

  // =========================================================================
  // SHEET 1: Leads Directory
  // =========================================================================
  const sheet = workbook.addWorksheet('Leads Directory', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet.columns = [
    { header: 'S.No', key: 'sno', width: 7 },
    { header: 'Business Name', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Primary Email', key: 'primaryEmail', width: 30 },
    { header: 'All Emails', key: 'allEmails', width: 36 },
    { header: 'Phone Number', key: 'phone', width: 20 },
    { header: 'Website', key: 'website', width: 32 },
    { header: 'Full Address', key: 'address', width: 42 },
    { header: 'Search Query / Area', key: 'searchQuery', width: 26 },
    { header: 'Rating', key: 'rating', width: 10 },
    { header: 'Reviews', key: 'reviewsCount', width: 12 },
    { header: 'Price Level', key: 'priceLevel', width: 12 },
    { header: 'Instagram', key: 'instagram', width: 28 },
    { header: 'Facebook', key: 'facebook', width: 28 },
    { header: 'LinkedIn', key: 'linkedin', width: 28 },
    { header: 'WhatsApp', key: 'whatsapp', width: 24 },
    { header: 'Opening Hours', key: 'openingHours', width: 28 },
    { header: 'Outreach Status', key: 'outreachStatus', width: 18 },
    { header: 'Marketing Notes', key: 'notes', width: 34 },
    { header: 'Plus Code', key: 'plusCode', width: 18 },
    { header: 'Latitude', key: 'latitude', width: 14 },
    { header: 'Longitude', key: 'longitude', width: 14 },
    { header: 'Google Maps Link', key: 'mapsUrl', width: 28 },
    { header: 'Extracted At', key: 'extractedAt', width: 22 }
  ];

  // Style Header Row
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E1B4B' } // Deep Indigo
    };
    cell.font = {
      name: 'Segoe UI',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF4F46E5' } }
    };
  });

  // Enable AutoFilter on all columns
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length }
  };

  // Populate Data Rows
  leads.forEach((lead, idx) => {
    const allEmailsStr = Array.isArray(lead.emails) ? lead.emails.join(', ') : lead.primaryEmail || '';
    const primaryEmail = lead.primaryEmail || (Array.isArray(lead.emails) && lead.emails[0]) || '';

    const row = sheet.addRow({
      sno: idx + 1,
      name: lead.name || '',
      category: lead.category || '',
      primaryEmail,
      allEmails: allEmailsStr,
      phone: lead.phone || '',
      website: lead.website || '',
      address: lead.address || '',
      searchQuery: lead.searchQuery || '',
      rating: lead.rating !== null && lead.rating !== undefined ? Number(lead.rating) : '',
      reviewsCount: lead.reviewsCount !== null && lead.reviewsCount !== undefined ? Number(lead.reviewsCount) : '',
      priceLevel: lead.priceLevel || '',
      instagram: lead.socials?.instagram || '',
      facebook: lead.socials?.facebook || '',
      linkedin: lead.socials?.linkedin || '',
      whatsapp: lead.socials?.whatsapp || lead.whatsapp || '',
      openingHours: lead.openingHours || '',
      outreachStatus: lead.outreachStatus || 'New',
      notes: lead.notes || '',
      plusCode: lead.plusCode || '',
      latitude: lead.latitude ?? '',
      longitude: lead.longitude ?? '',
      mapsUrl: lead.mapsUrl || '',
      extractedAt: lead.extractedAt ? new Date(lead.extractedAt).toLocaleString() : ''
    });

    row.height = 22;
    const isEven = idx % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });

    // Bold business name
    row.getCell('name').font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };

    // Highlight Primary Email if found
    if (primaryEmail) {
      const emailCell = row.getCell('primaryEmail');
      emailCell.value = {
        text: primaryEmail,
        hyperlink: `mailto:${primaryEmail}`
      };
      emailCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF059669' }, underline: true };
    }

    // Format Website as clickable link
    if (lead.website && /^https?:\/\//i.test(lead.website)) {
      const webCell = row.getCell('website');
      webCell.value = {
        text: lead.website,
        hyperlink: lead.website
      };
      webCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF2563EB' }, underline: true };
    }

    // Format Google Maps Link
    if (lead.mapsUrl && /^https?:\/\//i.test(lead.mapsUrl)) {
      const mapCell = row.getCell('mapsUrl');
      mapCell.value = {
        text: 'Open in Google Maps',
        hyperlink: lead.mapsUrl
      };
      mapCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4F46E5' }, underline: true };
    }

    // Format Social Links
    ['instagram', 'facebook', 'linkedin'].forEach((socialKey) => {
      const val = lead.socials?.[socialKey];
      if (val && /^https?:\/\//i.test(val)) {
        const sCell = row.getCell(socialKey);
        sCell.value = { text: val, hyperlink: val };
        sCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF2563EB' }, underline: true };
      }
    });
  });

  // =========================================================================
  // SHEET 2: Summary & Outreach Analytics
  // =========================================================================
  const summarySheet = workbook.addWorksheet('Summary & Analytics');
  summarySheet.columns = [
    { header: 'Metric / Segment', key: 'metric', width: 38 },
    { header: 'Count', key: 'count', width: 16 },
    { header: 'Share (%)', key: 'percentage', width: 16 },
    { header: 'Marketing / Outreach Use Case', key: 'note', width: 52 }
  ];

  const sumHeader = summarySheet.getRow(1);
  sumHeader.height = 26;
  sumHeader.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  const total = leads.length;
  const pct = (n) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0.0%');

  const withPhone = leads.filter((l) => Boolean(l.phone)).length;
  const withEmail = leads.filter((l) => Boolean(l.primaryEmail || (l.emails && l.emails.length > 0))).length;
  const withWebsite = leads.filter((l) => Boolean(l.website)).length;
  const noWebsite = total - withWebsite;
  const withSocials = leads.filter((l) => {
    const s = l.socials || {};
    return Boolean(s.instagram || s.facebook || s.linkedin || s.twitter || s.youtube || s.whatsapp);
  }).length;

  const summaryRows = [
    {
      metric: 'Total Extracted Businesses',
      count: total,
      percentage: '100%',
      note: meta.title || 'All extracted Google Maps businesses in this export'
    },
    {
      metric: 'Businesses with Phone Number',
      count: withPhone,
      percentage: pct(withPhone),
      note: 'Ready for cold calling, SMS, or WhatsApp outreach'
    },
    {
      metric: 'Businesses with Email ID',
      count: withEmail,
      percentage: pct(withEmail),
      note: 'Ready for cold email marketing campaigns & newsletters'
    },
    {
      metric: 'Businesses with Website',
      count: withWebsite,
      percentage: pct(withWebsite),
      note: 'Established online presence; pitch SEO, ads, B2B supplies, or SaaS'
    },
    {
      metric: 'Businesses WITHOUT Website',
      count: noWebsite,
      percentage: pct(noWebsite),
      note: 'High-priority prospects for web development & digital marketing agencies'
    },
    {
      metric: 'Businesses with Social Media (IG/FB/LI)',
      count: withSocials,
      percentage: pct(withSocials),
      note: 'Ready for Instagram DM / Facebook / LinkedIn outreach'
    }
  ];

  summaryRows.forEach((r) => {
    const row = summarySheet.addRow(r);
    row.height = 22;
    row.getCell('metric').font = { name: 'Segoe UI', size: 10, bold: true };
  });

  // Area / Query breakdown
  summarySheet.addRow({});
  const areaTitleRow = summarySheet.addRow({
    metric: 'Breakdown by Search Query / Area',
    count: 'Leads',
    percentage: 'Share',
    note: ''
  });
  areaTitleRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF1E1B4B' } };

  const byQuery = leads.reduce((acc, l) => {
    const q = l.searchQuery || 'Direct Search';
    acc[q] = (acc[q] || 0) + 1;
    return acc;
  }, {});

  Object.entries(byQuery).forEach(([q, count]) => {
    summarySheet.addRow({
      metric: q,
      count,
      percentage: pct(count),
      note: ''
    });
  });

  return workbook.xlsx.writeBuffer();
}

/**
 * Generate CSV string from leads array
 */
function generateLeadsCsv(leads = []) {
  const headers = [
    'S.No',
    'Business Name',
    'Category',
    'Primary Email',
    'All Emails',
    'Phone Number',
    'Website',
    'Full Address',
    'Search Query',
    'Rating',
    'Reviews Count',
    'Price Level',
    'Instagram',
    'Facebook',
    'LinkedIn',
    'WhatsApp',
    'Opening Hours',
    'Outreach Status',
    'Notes',
    'Latitude',
    'Longitude',
    'Google Maps Link',
    'Extracted At'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    if (/[",\n\r]/.test(str)) return `"${str}"`;
    return str;
  };

  const rows = leads.map((lead, idx) => {
    const allEmails = Array.isArray(lead.emails) ? lead.emails.join('; ') : lead.primaryEmail || '';
    const primaryEmail = lead.primaryEmail || (Array.isArray(lead.emails) && lead.emails[0]) || '';
    return [
      idx + 1,
      lead.name || '',
      lead.category || '',
      primaryEmail,
      allEmails,
      lead.phone || '',
      lead.website || '',
      lead.address || '',
      lead.searchQuery || '',
      lead.rating ?? '',
      lead.reviewsCount ?? '',
      lead.priceLevel || '',
      lead.socials?.instagram || '',
      lead.socials?.facebook || '',
      lead.socials?.linkedin || '',
      lead.socials?.whatsapp || lead.whatsapp || '',
      lead.openingHours || '',
      lead.outreachStatus || 'New',
      lead.notes || '',
      lead.latitude ?? '',
      lead.longitude ?? '',
      lead.mapsUrl || '',
      lead.extractedAt || ''
    ]
      .map(escapeCsv)
      .join(',');
  });

  // Add UTF-8 BOM so Excel opens CSV with symbols (like ₹) properly
  return '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
}

module.exports = {
  generateLeadsExcelBuffer,
  generateLeadsCsv
};
