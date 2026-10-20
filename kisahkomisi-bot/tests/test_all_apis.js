require('dotenv').config();

async function testGemini() {
  const start = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { name: 'Google Gemini', status: 'FAILED', error: 'No GEMINI_API_KEY' };
  
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = 'Halo Gemini, buatkan 1 kalimat hook pembuka menfess Threads tentang teman kosan jorok.';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9 }
      })
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      return { name: 'Google Gemini', model, status: 'FAILED', latency: `${ms}ms`, error: err };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '(kosong)';
    return { name: 'Google Gemini', model, status: 'SUCCESS', latency: `${ms}ms`, response: text };
  } catch (err) {
    return { name: 'Google Gemini', model, status: 'ERROR', error: err.message };
  }
}

async function testGroq() {
  const start = Date.now();
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { name: 'Groq Cloud', status: 'FAILED', error: 'No GROQ_API_KEY' };

  const model = 'openai/gpt-oss-120b';
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Halo Groq, berikan penilaian singkat (1 kalimat) tentang apa yang membuat hook cerita viral di Threads.' }]
      })
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      return { name: 'Groq Cloud', model, status: 'FAILED', latency: `${ms}ms`, error: err };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '(kosong)';
    return { name: 'Groq Cloud', model, status: 'SUCCESS', latency: `${ms}ms`, response: text };
  } catch (err) {
    return { name: 'Groq Cloud', model, status: 'ERROR', error: err.message };
  }
}

async function testOpenRouter() {
  const start = Date.now();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { name: 'OpenRouter', status: 'FAILED', error: 'No OPENROUTER_API_KEY' };

  const models = ['nvidia/nemotron-3.5-lightning:free', 'minimax/minimax-m3.1-flash:free'];
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  for (const model of models) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Halo OpenRouter, tuliskan 1 kalimat motivasi pendek.' }]
        })
      });
      const ms = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim() || '(kosong)';
        return { name: 'OpenRouter', model, status: 'SUCCESS', latency: `${ms}ms`, response: text };
      }
    } catch (err) {
      // coba model berikutnya
    }
  }
  return { name: 'OpenRouter', status: 'FAILED', error: 'Semua model free OpenRouter sedang sibuk' };
}

async function run() {
  console.log('='.repeat(60));
  console.log('🚀 TESTING ALL 3 FREE AI PROVIDERS (Gemini, Groq, OpenRouter)');
  console.log('='.repeat(60));

  const results = await Promise.all([testGemini(), testGroq(), testOpenRouter()]);

  results.forEach((r, idx) => {
    console.log(`\n[${idx + 1}] ${r.name} (${r.model || 'N/A'})`);
    console.log(`    Status  : ${r.status === 'SUCCESS' ? '✅ SUCCESS' : '❌ ' + r.status}`);
    if (r.latency) console.log(`    Latency : ${r.latency}`);
    if (r.response) console.log(`    Output  : "${r.response.replace(/\n/g, ' ')}"`);
    if (r.error) console.log(`    Error   : ${r.error}`);
  });

  console.log('\n' + '='.repeat(60));
  const allPass = results.every(r => r.status === 'SUCCESS');
  console.log(allPass ? '🎉 SEMUA 3 API BERHASIL TERVERIFIKASI & SIAP DIGUNAKAN!' : '⚠️ ADA API YANG GAGAL');
  console.log('='.repeat(60));
}

run();
