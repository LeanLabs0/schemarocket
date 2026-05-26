const {
  getHubSpotEnv,
  normalizeLookupUrl,
  getHubSpotRecordByUrl,
} = require('./_hubspot');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hubspotEnv = getHubSpotEnv();
    if (!hubspotEnv.token) {
      return res.status(500).json({ error: 'Missing HUBSPOT_TOKEN in environment.' });
    }

    const rawUrl = String(req.query?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'url query parameter is required.' });
    }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const normalizedUrlForLookup = normalizeLookupUrl(normalizedUrl);
    const record = await getHubSpotRecordByUrl(normalizedUrlForLookup, hubspotEnv);

    if (!record) {
      return res.status(200).json({ found: false, normalizedUrl: normalizedUrlForLookup });
    }

    const reportJsonRaw = record.properties?.report_json || '{}';
    let report;
    try {
      report = JSON.parse(reportJsonRaw);
    } catch (_) {
      report = {};
    }

    return res.status(200).json({
      found: true,
      jobID: record.properties?.external_report_id || '',
      recordId: record.id,
      url: record.properties?.url || normalizedUrlForLookup,
      auditDate: record.properties?.audit_date || '',
      report,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to resolve URL from HubSpot.',
      details: error.message || 'Unknown error',
    });
  }
};
