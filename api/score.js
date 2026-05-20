const {
  getHubSpotEnv,
  normalizeDomain,
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
    const API_URL = process.env.SCHEMA_API_URL;
    const API_KEY = process.env.SCHEMA_API_KEY;
    const AGENT_NAME = process.env.SCHEMA_AGENT || 'schema-score-experience';
    const hubspotEnv = getHubSpotEnv();

    if (!API_URL || !API_KEY) {
      return res.status(500).json({
        error: 'Missing SCHEMA_API_URL or SCHEMA_API_KEY in environment.',
      });
    }

    const body = parseBody(req);
    const rawUrl = String(body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'A URL is required.' });
    }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const normalizedDomain = normalizeDomain(normalizedUrl);

    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({
        prompt: `Score this URL: ${normalizedUrl}`,
        agent: AGENT_NAME,
      }),
    });

    const text = await upstream.text();
    let payload = text;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      // Keep raw text payload if upstream is not JSON.
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'Upstream schema API request failed',
        details: typeof payload === 'string' ? payload.slice(0, 500) : payload,
      });
    }

    const responseBody = typeof payload === 'string' ? { result: payload } : payload;
    const reportData = extractReportData(responseBody);
    if (hubspotEnv.token && reportData) {
      try {
        const hubspot = await upsertHubSpotSchemaReport({
          reportData,
          normalizedDomain,
          scannedUrl: normalizedUrl,
        }, hubspotEnv);
        responseBody.hubspot = hubspot;
      } catch (hubspotError) {
        responseBody.hubspotError = hubspotError.message || 'Failed to persist report to HubSpot';
      }
    }

    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to call schema API',
      details: error.message || 'Unknown error',
    });
  }
};
