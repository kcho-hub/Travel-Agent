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
      // Auto-detect the best available model for this API key
      const modelsResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      const modelsData = await modelsResp.json();
      if (!modelsResp.ok) {
        return res.status(modelsResp.status).json({ error: { message: modelsData.error?.message || 'Could not list Gemini models' } });
      }
      const EXCLUDE = ['tts', 'embedding', 'aqa', 'retrieval', 'vision'];
      const available = (modelsData.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
        .filter(m => !EXCLUDE.some(x => m.toLowerCase().includes(x)));

      if (!available.length) return res.status(400).json({ error: { message: 'No Gemini text models available for this API key.' } });

      // Sort: prefer flash, then pro, then others
      const ranked = [
        ...available.filter(m => m.includes('flash') && !m.includes('tts')),
        ...available.filter(m => m.includes('pro') && !m.includes('flash')),
        ...available.filter(m => !m.includes('flash') && !m.includes('pro')),
      ];

      const prompt = req.body.prompt || '';
      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      };

      // Try each model in order — skip deprecated ones automatically
      let lastError = 'No working Gemini model found.';
      for (const model of ranked) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) }
        );
        const data = await response.json();
        if (response.ok) {
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return res.status(200).json({ content: [{ text }] });
        }
        lastError = data.error?.message || 'Gemini error';
        // Only skip if the model itself is gone — stop on auth/quota errors
        if (!lastError.includes('no longer available') && !lastError.includes('not found')) {
          return res.status(response.status).json({ error: { message: lastError } });
        }
      }
      return res.status(400).json({ error: { message: lastError } });
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
