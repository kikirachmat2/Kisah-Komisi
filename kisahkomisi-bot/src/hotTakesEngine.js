const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { publishTextPost, getActiveAccessToken, fetchPostPermalink } = require('./threads');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Topik cadangan jika RSS offline
const EVERGREEN_TOPICS = [
  'Biaya hidup & inflasi harga makanan sehari-hari dibanding gaji yang stagnan',
  'Syarat loker zaman sekarang yang minta fresh graduate pengalaman 5 tahun',
  'Ironi beli kopi 30 ribu santai tapi ongkir marketplace 8 ribu mikir 3 hari',
  'Potongan slip gaji bertambah terus tapi fasilitas publik ga membaik',
  'Makin dewasa lingkaran pertemanan mengecil karena sama-sama capek dan ga ada duit',
  'Fenomena FOMO konser dan cicilan paylater demi validasi di media sosial',
  'Kelakuan rekan kantor yang pura-pura sibuk tapi lempar kerjaan ke orang lain',
  'Riset stres kerja: bos yang chat urusan kerjaan pas weekend dan hari libur',
  'Nonton orang flexing miliaran di medsos pas kita lagi nimbang odol digulung'
];

/**
 * Fetch headline/tren viral terkini tanpa guardrail pembatas topik.
 * Prioritaskan gelombang aktif dari SocialRadar, lalu RSS Google Trends ID, Detik News/Hot/Finance.
 */
async function fetchTrendingHeadline() {
  try {
    const { getActiveViralWaves } = require('./socialRadar');
    const waves = getActiveViralWaves ? getActiveViralWaves() : [];
    if (Array.isArray(waves) && waves.length > 0 && waves[0].source !== 'Evergreen Retention Radar') {
      const picked = waves[Math.floor(Math.random() * waves.length)];
      return {
        source: picked.source || 'Threads Live Wave',
        headline: `${picked.headline || picked.title} — ${picked.topic || ''}`.trim()
      };
    }
  } catch (e) {}

  const sources = [
    { url: 'https://trends.google.com/trending/rss?geo=ID', name: 'Google Trends ID' },
    { url: 'https://news.detik.com/rss', name: 'Detik News' },
    { url: 'https://hot.detik.com/rss', name: 'Detik Hot' },
    { url: 'https://finance.detik.com/rss', name: 'Detik Finance' },
    { url: 'https://www.cnbcindonesia.com/market/rss', name: 'CNBC Indonesia' },
    { url: 'https://www.antaranews.com/rss/terkini.xml', name: 'Antara News' }
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const xml = await res.text();

      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const titles = [];
      for (const it of items) {
        const m = it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || it.match(/<title>(.*?)<\/title>/i);
        if (m && m[1]) {
          const t = m[1].replace(/&amp;/g, '&').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          const lower = t.toLowerCase();
          if (t.length >= 4 && lower !== 'daily search trends' && !lower.includes('rss')) {
            titles.push(t);
          }
        }
      }

      if (titles.length > 0) {
        const chosen = titles[Math.floor(Math.random() * Math.min(titles.length, 5))];
        return {
          source: src.name,
          headline: chosen
        };
      }
    } catch (e) {
      console.warn(`[HotTakes] Gagal mengambil RSS dari ${src.name}:`, e.message);
    }
  }

  const randomEvergreen = EVERGREEN_TOPICS[Math.floor(Math.random() * EVERGREEN_TOPICS.length)];
  return {
    source: 'Evergreen Social Observation',
    headline: randomEvergreen
  };
}

function isValidHotTake(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.replace(/^["']|["']$/g, '').trim();
  if (clean.length < 35) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  if (/^(kesehatan|politik|ekonomi|hiburan|olahraga|hukum|nasional|internasional|berita|ragam)\.?$/i.test(clean)) return false;
  if (/fiksi|fiktif|buatan ai|as an ai|\bki\b/i.test(clean)) return false;
  return true;
}

/**
 * Generate 1 Hot Take pendek dengan gaya ketikan manusia asli warga Threads (@kikipunyacerita)
 */
async function generateHotTakePost(headlineInfo, slotType = 'PAGI') {
  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), anak muda Jakarta umur 26 thn yang aktif banget di Threads.
Tugas: Tulis SATU (1) postingan Threads pendek (1-2 kalimat santai, 80 - 180 karakter) buat nyamber isu/berita yang lagi rame ini.

ISU / TREN YANG LAGI RAME:
"${headlineInfo.headline}" (Sumber: ${headlineInfo.source})

ATURAN BIAR 100% KAYAK KETIKAN MANUSIA ASLI (BUKAN BOT AI):
1. Huruf kecil semua (lowercase), gaya ngomong warga Threads asli yang spontan, berani, ekspresif, jujur, julid, atau nyelekit.
2. BEBAS BEREKSPRESI: Jangan jaim atau sok sopan! Mau nyumpah, ngedumel pedes, misuh, atau nyindir kebijakan/pemerintah/bos yang ngaco, hajar aja layaknya warganet yang lagi gregetan.
3. JANGAN merangkum ulang berita kayak pembaca berita TV, dan JANGAN menjejalkan banyak angka/persentase/jam kayak robot kalkulator!
4. Langsung tulis reaksi/opini tajam lo yang bikin orang di Threads gatel pengen ikut nimbrung dan quote.
5. DILARANG sapaan basi (Guys, Halo), DILARANG memanggil diri sendiri "Ki", DILARANG HASHTAG (#), dan DILARANG link promosi.
6. Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  // 1. Coba Groq LPU (openai/gpt-oss-120b) — cepat & natural
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim().toLowerCase() : '';
        if (isValidHotTake(clean)) return clean;
        console.warn(`[HotTakes] Hasil Groq tidak lolos validasi ("${clean}")`);
      }
    } catch (e) {
      console.warn('[HotTakes] Groq fallback error:', e.message);
    }
  }

  // 2. Fallback ke Gemini 2.5 Flash
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 600,
            temperature: 0.8,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim().toLowerCase() : '';
        if (isValidHotTake(clean)) return clean;
      }
    } catch (e) {}
  }

  // 3. Fallback ke OpenRouter (Free tier)
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim().toLowerCase() : '';
        if (isValidHotTake(clean)) return clean;
        console.warn(`[HotTakes] Hasil OpenRouter tidak lolos validasi ("${clean}")`);
      }
    } catch (e) {
      console.warn('[HotTakes] OpenRouter fallback error:', e.message);
    }
  }

  // Fallback kurasi tinggi yang pasti valid & manusiawi
  const fallbackList = [
    `tiap buka timeline hari ini isinya bikin elus dada semua. antara mau ikutan komen julid atau fokus nyari duit aja biar waras.`,
    `mau sok-sokan cuek sama keadaan tapi pas buka m-banking langsung sadar diri. hidup makin mahal tapi drama di timeline gak pernah libur.`,
    `realitas pekerja zaman sekarang: berangkat gelap pulang gelap, pas buka hp isinya berita yang makin bikin pusing kepala.`
  ];
  return fallbackList[Math.floor(Math.random() * fallbackList.length)];
}

/**
 * Eksekusi Autonomous Hot Take Posting ke Meta Threads
 */
async function executeHotTake(userId, slotLabel = 'PAGI (10:15 WIB)') {
  const token = getActiveAccessToken();
  if (!token || !userId) {
    console.log('[HotTakes] Kredensial Threads belum lengkap, skip.');
    return null;
  }

  console.log(`[HotTakes] Mengambil radar isu/berita untuk slot ${slotLabel}...`);
  const headlineInfo = await fetchTrendingHeadline();
  console.log(`[HotTakes] Isu terpilih (${headlineInfo.source}): "${headlineInfo.headline}"`);

  const slotType = slotLabel.includes('PAGI') ? 'PAGI' : 'SORE';
  const postText = await generateHotTakePost(headlineInfo, slotType);

  console.log(`[HotTakes] Menerbitkan opini organik ke Threads:\n"${postText}"`);

  try {
    const mediaId = await publishTextPost(userId, token, postText);
    const permalink = await fetchPostPermalink(mediaId, token);

    // Simpan ke database
    db.logHotTake({
      topicSource: headlineInfo.source,
      headline: headlineInfo.headline,
      postText,
      threadsMediaId: mediaId,
      slotLabel
    });

    console.log(`[HotTakes] SUKSES! Post Hot Take terbit (Media ID: ${mediaId})`);

    return {
      mediaId,
      headline: headlineInfo.headline,
      source: headlineInfo.source,
      postText,
      slotLabel,
      permalink: permalink || `https://www.threads.net/@${process.env.THREADS_USERNAME || 'kikipunyacerita'}`
    };
  } catch (err) {
    console.error('[HotTakes] Gagal menerbitkan hot take:', err.message);
    return null;
  }
}

module.exports = {
  executeHotTake,
  generateHotTakePost,
  fetchTrendingHeadline
};
