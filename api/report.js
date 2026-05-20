const {
  getHubSpotEnv,
  getHubSpotRecordByJobID,
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

    const jobID = String(req.query?.jobID || '').trim();
    if (!jobID) {
      return res.status(400).json({ error: 'jobID query parameter is required.' });
    }

    const record = await getHubSpotRecordByJobID(jobID, hubspotEnv);
    if (!record) {
      return res.status(404).json({ error: 'No schema report found for this jobID.' });
    }

    const reportJsonRaw = record.properties?.report_json || '{}';
    let report;
    try {
      report = JSON.parse(reportJsonRaw);
    } catch (_) {
      report = {};
    }

    return res.status(200).json({
      jobID,
      recordId: record.id,
      url: record.properties?.url || '',
      auditDate: record.properties?.audit_date || '',
      report,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve schema report from HubSpot.',
      details: error.message || 'Unknown error',
    });
  }
};
