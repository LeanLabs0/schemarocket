const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { randomUUID } = require('node:crypto');

dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5500;
const API_URL = process.env.SCHEMA_API_URL;
const API_KEY = process.env.SCHEMA_API_KEY;
const AGENT_NAME = process.env.SCHEMA_AGENT || 'schema-score-experience';
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HUBSPOT_SCHEMA_OBJECT_TYPE = process.env.HUBSPOT_SCHEMA_OBJECT_TYPE || '2-62805467';
const HUBSPOT_BASE_URL = 'https://api.hubapi.com';
const HUBSPOT_STATUS_AI_READY = process.env.HUBSPOT_STATUS_AI_READY || 'AI Ready';
const HUBSPOT_STATUS_NEEDS_ENRICHMENT = process.env.HUBSPOT_STATUS_NEEDS_ENRICHMENT || 'Needs Enrichment';
const HUBSPOT_STATUS_AT_RISK = process.env.HUBSPOT_STATUS_AT_RISK || 'At Risk';

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/score', async (req, res) => {
  try {
    if (!API_URL || !API_KEY) {
      return res.status(500).json({
        error: 'Missing SCHEMA_API_URL or SCHEMA_API_KEY in .env.local',
      });
    }

    const rawUrl = String(req.body?.url || '').trim();
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
    if (HUBSPOT_TOKEN && reportData) {
      try {
        const hubspot = await upsertHubSpotSchemaReport({
          reportData,
          normalizedDomain,
          scannedUrl: normalizedUrl,
        });
        responseBody.hubspot = hubspot;
      } catch (hubspotError) {
        responseBody.hubspotError = hubspotError.message || 'Failed to persist report to HubSpot';
      }
    }

    return res.json(responseBody);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to call schema API',
      details: error.message || 'Unknown error',
    });
  }
});

app.get('/api/report', async (req, res) => {
  try {
    if (!HUBSPOT_TOKEN) {
      return res.status(500).json({ error: 'Missing HUBSPOT_TOKEN in environment.' });
    }
    const jobID = String(req.query.jobID || '').trim();
    if (!jobID) {
      return res.status(400).json({ error: 'jobID query parameter is required.' });
    }

    const record = await getHubSpotRecordByJobID(jobID);
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

    return res.json({
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
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function normalizeDomain(urlValue) {
  try {
    return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return String(urlValue).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function extractReportData(payload) {
  if (!payload) return null;
  if (payload.overall || payload.dimensions || payload.gaps || payload.fixPlan) return payload;
  const raw = payload.result || payload.data?.result;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  return extractJSON(raw);
}

function extractJSON(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, '');
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (_) { /* continue */ }
  }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) { /* continue */ }
  }
  return null;
}

function mapStatusLabel(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return HUBSPOT_STATUS_NEEDS_ENRICHMENT;
  if (numericScore >= 80) return HUBSPOT_STATUS_AI_READY;
  if (numericScore >= 55) return HUBSPOT_STATUS_NEEDS_ENRICHMENT;
  return HUBSPOT_STATUS_AT_RISK;
}

async function hubSpotFetch(endpoint, options = {}) {
  const resp = await fetch(`${HUBSPOT_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`HubSpot API ${resp.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  }
  return payload;
}

async function getHubSpotRecordByDomain(domain) {
  const payload = await hubSpotFetch(`/crm/v3/objects/${HUBSPOT_SCHEMA_OBJECT_TYPE}/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'url',
              operator: 'EQ',
              value: domain,
            },
          ],
        },
      ],
      properties: ['url', 'external_report_id', 'audit_date'],
      limit: 1,
    }),
  });
  return payload.results?.[0] || null;
}

async function getHubSpotRecordByJobID(jobID) {
  const payload = await hubSpotFetch(`/crm/v3/objects/${HUBSPOT_SCHEMA_OBJECT_TYPE}/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'external_report_id',
              operator: 'EQ',
              value: jobID,
            },
          ],
        },
      ],
      properties: ['url', 'report_json', 'audit_date', 'external_report_id'],
      limit: 1,
    }),
  });
  return payload.results?.[0] || null;
}

async function upsertHubSpotSchemaReport({ reportData, normalizedDomain, scannedUrl }) {
  const overall = reportData?.overall || {};
  const score = overall?.score ?? reportData?.score ?? reportData?.score_value ?? reportData?.total_score ?? '';
  const grade = overall?.grade ?? reportData?.grade ?? '';
  const auditDate = reportData?.auditDate || new Date().toISOString();

  const existing = await getHubSpotRecordByDomain(normalizedDomain);
  const externalReportId = existing?.properties?.external_report_id || randomUUID();
  const properties = {
    url: normalizedDomain,
    audit_date: String(auditDate),
    overall_score: String(score),
    overall_grade: String(grade),
    status: mapStatusLabel(score),
    report_json: JSON.stringify({
      ...reportData,
      url: reportData?.url || scannedUrl,
    }),
    external_report_id: externalReportId,
  };

  let saved;
  if (existing?.id) {
    saved = await hubSpotFetch(`/crm/v3/objects/${HUBSPOT_SCHEMA_OBJECT_TYPE}/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  } else {
    saved = await hubSpotFetch(`/crm/v3/objects/${HUBSPOT_SCHEMA_OBJECT_TYPE}`, {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });
  }

  return {
    recordId: saved.id,
    external_report_id: externalReportId,
    url: normalizedDomain,
  };
}

app.listen(PORT, () => {
  console.log(`SchemaRocket dev server running at http://localhost:${PORT}`);
});
