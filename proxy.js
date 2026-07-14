// Vercel serverless function — proxies to Anthropic, OpenAI, or Google Gemini.

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
    // ── Gemini ──────────────────────────────────────────────────────────────
    if (provider === 'gemini') {
      const prompt = req.body.prompt || '';
      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      };
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) }
      );
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: { message: data.error?.message || 'Gemini error' } });
      // Normalize to Claude-style response so the frontend parser works for all providers
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ content: [{ text }] });
    }

    // ── OpenAI ───────────────────────────────────────────────────────────────
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // ── Claude (default) ─────────────────────────────────────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(502).json({ error: { message: err.message } });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '2mb' } } };
