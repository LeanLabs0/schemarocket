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

// Canonical lookup key: strips protocol (incl. typos like "https;//"),
// drops a leading "www.", forces https, and removes trailing slashes.
// leanlabs.com, www.leanlabs.com, http(s)://leanlabs.com all collapse to
// https://leanlabs.com. Must stay in sync with normalizeInputUrl() on client.
function normalizeLookupUrl(urlValue) {
  const cleaned = String(urlValue || '')
    .trim()
    .replace(/^\s*https?\s*[;:]\s*\/\//i, '')
    .replace(/^\/+/, '');
  const withProtocol = `https://${cleaned}`;
  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname || '/';
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return `https://${hostname}${pathname}`;
  } catch (_) {
    const fallback = cleaned
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/+$/, '');
    return `https://${fallback}`;
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

// HubSpot datetime props accept UNIX ms; reads may return ms, seconds, or ISO.
function toHubSpotDatetimeValue(date = new Date()) {
  const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

function parseHubSpotDatetime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function auditDateToIso(value) {
  const ts = parseHubSpotDatetime(value);
  return ts === null ? null : new Date(ts).toISOString();
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

async function getHubSpotRecordByUrl(url, env) {
  const payload = await hubSpotFetch(`/crm/v3/objects/${env.objectType}/search`, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'url',
              operator: 'EQ',
              value: url,
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

async function upsertHubSpotSchemaReport({ reportData, normalizedUrlForLookup, scannedUrl }, env) {
  const overall = reportData?.overall || {};
  const score = overall?.score ?? reportData?.score ?? reportData?.score_value ?? reportData?.total_score ?? '';
  const grade = overall?.grade ?? reportData?.grade ?? '';
  // Always stamp with the actual save time — never trust auditDate from the report payload.
  const auditTimestampMs = toHubSpotDatetimeValue();

  const existing = await getHubSpotRecordByUrl(normalizedUrlForLookup, env);
  const externalReportId = existing?.properties?.external_report_id || randomUUID();
  const properties = {
    url: normalizedUrlForLookup,
    audit_date: auditTimestampMs,
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
    url: normalizedUrlForLookup,
    auditDate: new Date(auditTimestampMs).toISOString(),
  };
}

module.exports = {
  getHubSpotEnv,
  normalizeLookupUrl,
  extractReportData,
  getHubSpotRecordByUrl,
  getHubSpotRecordByJobID,
  upsertHubSpotSchemaReport,
  parseHubSpotDatetime,
  auditDateToIso,
};
