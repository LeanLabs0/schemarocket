const {
  getHubSpotEnv,
  normalizeLookupUrl,
  extractReportData,
  upsertHubSpotSchemaReport,
} = require('./_hubspot');

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return req.body;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hubspotEnv = getHubSpotEnv();
    if (!hubspotEnv.token) {
      return res.status(500).json({ error: 'Missing HUBSPOT_TOKEN in environment.' });
    }

    const body = parseBody(req);
    const rawUrl = String(body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'A URL is required.' });
    }

    const reportInput = body?.report;
    const reportData = extractReportData(reportInput) || (reportInput && typeof reportInput === 'object' ? reportInput : null);
    if (!reportData || typeof reportData !== 'object') {
      return res.status(400).json({ error: 'Valid report data is required.' });
    }

    // Strip transient client-side metadata before persisting.
    const cleanReport = { ...reportData };
    delete cleanReport.hubspot;
    delete cleanReport.hubspotError;

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const normalizedUrlForLookup = normalizeLookupUrl(normalizedUrl);

    const hubspot = await upsertHubSpotSchemaReport({
      reportData: cleanReport,
      normalizedUrlForLookup,
      scannedUrl: normalizedUrl,
    }, hubspotEnv);

    return res.status(200).json({ hubspot });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to save schema report to HubSpot.',
      details: error.message || 'Unknown error',
    });
  }
};
