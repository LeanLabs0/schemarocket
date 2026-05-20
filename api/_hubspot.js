const { randomUUID } = require('node:crypto');

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

function getHubSpotEnv() {
  return {
    token: process.env.HUBSPOT_TOKEN || '',
    objectType: process.env.HUBSPOT_SCHEMA_OBJECT_TYPE || '2-62805467',
    statusAiReady: process.env.HUBSPOT_STATUS_AI_READY || 'AI Ready',
    statusNeedsEnrichment: process.env.HUBSPOT_STATUS_NEEDS_ENRICHMENT || 'Needs Enrichment',
    statusAtRisk: process.env.HUBSPOT_STATUS_AT_RISK || 'At Risk',
  };
}

function normalizeDomain(urlValue) {
  try {
    return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return String(urlValue)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  }
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

function extractReportData(payload) {
  if (!payload) return null;
  if (payload.overall || payload.dimensions || payload.gaps || payload.fixPlan) return payload;
  const raw = payload.result || payload.data?.result;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  return extractJSON(raw);
}

function mapStatusLabel(score, env) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return env.statusNeedsEnrichment;
  if (numericScore >= 80) return env.statusAiReady;
  if (numericScore >= 55) return env.statusNeedsEnrichment;
  return env.statusAtRisk;
}

async function hubSpotFetch(endpoint, options = {}, env) {
  const resp = await fetch(`${HUBSPOT_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.token}`,
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

async function getHubSpotRecordByDomain(domain, env) {
  const payload = await hubSpotFetch(`/crm/v3/objects/${env.objectType}/search`, {
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
      properties: [
        'url',
        'report_json',
        'audit_date',
        'external_report_id',
        'overall_score',
        'overall_grade',
        'status',
      ],
      limit: 1,
    }),
  }, env);
  return payload.results?.[0] || null;
}

async function getHubSpotRecordByJobID(jobID, env) {
  const payload = await hubSpotFetch(`/crm/v3/objects/${env.objectType}/search`, {
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
  }, env);
  return payload.results?.[0] || null;
}

async function upsertHubSpotSchemaReport({ reportData, normalizedDomain, scannedUrl }, env) {
  const overall = reportData?.overall || {};
  const score = overall?.score ?? reportData?.score ?? reportData?.score_value ?? reportData?.total_score ?? '';
  const grade = overall?.grade ?? reportData?.grade ?? '';
  const auditDate = reportData?.auditDate || new Date().toISOString();

  const existing = await getHubSpotRecordByDomain(normalizedDomain, env);
  const externalReportId = existing?.properties?.external_report_id || randomUUID();
  const properties = {
    url: normalizedDomain,
    audit_date: String(auditDate),
    overall_score: String(score),
    overall_grade: String(grade),
    status: mapStatusLabel(score, env),
    report_json: JSON.stringify({
      ...reportData,
      url: reportData?.url || scannedUrl,
    }),
    external_report_id: externalReportId,
  };

  let saved;
  if (existing?.id) {
    saved = await hubSpotFetch(`/crm/v3/objects/${env.objectType}/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    }, env);
  } else {
    saved = await hubSpotFetch(`/crm/v3/objects/${env.objectType}`, {
      method: 'POST',
      body: JSON.stringify({ properties }),
    }, env);
  }

  return {
    recordId: saved.id,
    external_report_id: externalReportId,
    url: normalizedDomain,
  };
}

module.exports = {
  getHubSpotEnv,
  normalizeDomain,
  extractReportData,
  getHubSpotRecordByDomain,
  getHubSpotRecordByJobID,
  upsertHubSpotSchemaReport,
};
