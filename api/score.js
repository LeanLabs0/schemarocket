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

// Append a one-off _cb so the scoring agent fetches a fresh copy of the page.
// The rest of the URL is left as entered. HubSpot lookup/save keys are built
// elsewhere and do not include this parameter.
function withCacheBuster(url) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`;
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}_cb=${token}${hash}`;
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

    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({
        prompt: `Score this URL: ${withCacheBuster(normalizedUrl)}`,
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

    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to call schema API',
      details: error.message || 'Unknown error',
    });
  }
};
