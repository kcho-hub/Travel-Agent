// Vercel serverless function — proxies to Anthropic or OpenAI from Vercel's servers.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, x-provider');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey   = req.headers['x-api-key'];
  const provider = req.headers['x-provider'] || 'claude';

  if (!apiKey) return res.status(401).json({ error: { message: 'Missing x-api-key header' } });

  try {
    let upstream, upstreamHeaders;

    if (provider === 'openai') {
      upstream = 'https://api.openai.com/v1/chat/completions';
      upstreamHeaders = {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
    } else {
      upstream = 'https://api.anthropic.com/v1/messages';
      upstreamHeaders = {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      };
    }

    const response = await fetch(upstream, {
      method:  'POST',
      headers: upstreamHeaders,
      body:    JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(502).json({ error: { message: err.message } });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '2mb' } } };
