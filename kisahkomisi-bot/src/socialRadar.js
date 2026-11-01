const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { getAutoTopicTag } = require('./aiStory');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Mengambil semua headline & tren yang lagi rame di Indonesia TANPA filter/guardrail pembatas topik.
 * Menggabungkan Google Trends ID, Berita Utama, Pop/Hiburan, Ekonomi, dan Nasional secara seimbang.
 */
async function fetchLiveTrendHeadlines() {
  const sources = [
    { name: 'Google Trends ID', url: 'https://trends.google.com/trending/rss?geo=ID', maxPerSource: 4 },
    { name: 'Detik News', url: 'https://news.detik.com/rss', maxPerSource: 3 },
    { name: 'Detik Hot', url: 'https://hot.detik.com/rss', maxPerSource: 3 },
    { name: 'Detik Finance', url: 'https://finance.detik.com/rss', maxPerSource: 3 },
    { name: 'CNN Indonesia', url: 'https://www.cnnindonesia.com/nasional/rss', maxPerSource: 3 },
    { name: 'Antara News', url: 'https://www.antaranews.com/rss/terkini.xml', maxPerSource: 2 }
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const collectedHeadlines = [];
  const seenTitles = new Set();

  const results = await Promise.allSettled(
    sources.map(async (src) => {
      const res = await fetch(src.url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { src, items: [] };
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      return { src, items };
    })
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { src, items } = r.value;
    let countForSource = 0;

    for (const it of items) {
      if (countForSource >= (src.maxPerSource || 3)) break;
      const titleMatch = it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || it.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const rawTitle = titleMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        const lower = rawTitle.toLowerCase();

        if (rawTitle.length < 4 || lower === 'daily search trends' || lower.includes('rss feed')) continue;
        if (seenTitles.has(lower)) continue;
        seenTitles.add(lower);

        collectedHeadlines.push({ title: rawTitle, source: src.name });
        countForSource++;
      }
    }
  }

  return collectedHeadlines.slice(0, 14);
}

/**
 * Mengubah SEMUA tren/isu/berita yang lagi rame menjadi Skenario Gelombang Viral Threads (Wave-Chaser)
 * Tanpa guardrail topik — apapun yang rame langsung dihajar dengan gaya manusia asli (bukan bot berita).
 */
async function synthesizeViralWaves(rawHeadlines = [], netizenComments = []) {
  if (rawHeadlines.length === 0 && netizenComments.length === 0) {
    return getFallbackTrends();
  }

  const prompt = `
Kamu adalah warga aktif Threads Indonesia (@kikipunyacerita, anak muda Jakarta umur 26 thn, luwes, up-to-date sama semua drama sosmed, berita viral, bola, gosip, kebijakan pemerintah, sampe urusan kerjaan/dompet).
Tugasmu: Pilih 4 s/d 5 ISU PALING RAME & SEKSI dari daftar tren hari ini, lalu ubah menjadi bahan postingan Threads yang BIKIN ORANG GATEL PENGEN KOMEN / DEBAT / QUOTE.

DAFTAR TREN & BERITA REAL-TIME HARI INI:
${rawHeadlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n') || '- Belum ada berita baru'}

KOMENTAR NETIZEN YANG MASUK:
${netizenComments.slice(0, 4).map((c, i) => `- @${c.author_username}: "${c.comment_text}"`).join('\n') || '- Belum ada komentar'}

ATURAN KUNCI BIAR VIRAL & GAK KELIHATAN BOT AI:
1. BEBAS TANPA GUARDRAIL TOPIK & BAHASA: Apapun yang lagi rame (kebijakan pemerintah, kasus viral, seleb/gosip, sepakbola, konser, drama kerjaan, harga naik, kelakuan absurd), HAJAR AJA!
2. EKSPRESIF, CEPLAS-CEPLOS & BERANI: Jangan jaim, jangan sok bijak! Boleh ngedumel pedes, emosional, gregetan, sarkas, atau nyindir kelakuan pemerintah/korporat/atasan yang ngaco layaknya warga Threads yang lagi muak. Kalimatnya harus tegas, berani, dan kebaca jelas emosinya.
3. JANGAN NULIS KAYAK BOT RANGKUMAN BERITA ATAU KALKULATOR:
   - SALAH (Gaya AI Bot): "Harga avtur naik ke Rp12.500/liter membuat gaji pilot turun 50% dari Rp25jt menjadi Rp12,5jt dan 200 orang di-PHK dalam 48 jam." (Terlalu kaku kayak laporan koran!).
   - BENAR (Gaya Manusia Threads): "rame maskapai phk ratusan orang gara-gara avtur bengkak. jujur tahun ini ngeri bgt liat gelombang layoff dimana-mana, tempat kalian masih aman gak sih?"
4. PILIH FORMAT SESUAI JENIS ISUNYA:
   - Jika isu drama/kebijakan/fenomena/hiburan/kasus viral -> pilih "hot_take" (celetukan nyelekit/jujur) atau "menfess_spill" (pancingan debat/cerita warganet) atau "anonymous_curhat_story" (cerita sudut pandang orang sekitar soal isu itu).
   - Jika isu menyangkut biaya hidup/gaji/harga -> boleh pilih "financial_breakdown" (bedah rincian gaji) atau "single_life_update".
5. GAYA KETIKAN MANUSIA ASLI: Huruf kecil semua (lowercase), bahasa ngobrol santai sehari-hari, tanpa hashtag, tanpa penomoran kaku.

Keluarkan HANYA JSON array valid:
[
  {
    "title": "Judul Singkat Isu (Maksimal 6 kata)",
    "headline": "Headline asli yang ditunggangi",
    "topic": "Sudut pandang obrolan / keresahan manusiawi soal isu ini (jangan kaku seperti berita)",
    "topic_tag": "radar_viral|curhat|duniakerja|finansial|rumahtangga|anakkos",
    "suggested_format": "hot_take|menfess_spill|single_life_update|anonymous_curhat_story|financial_breakdown",
    "suggested_hook": "1 kalimat pembuka ketikan manusia asli (huruf kecil semua, nyelekit/relatable, tanpa kesan AI)"
  }
]
`;

  // 1. Coba Groq LPU (openai/gpt-oss-120b)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.6
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const list = Array.isArray(parsed) ? parsed : (parsed.waves || parsed.topics || Object.values(parsed)[0]);
          if (Array.isArray(list) && list.length > 0) {
            return list.map(item => ({
              title: item.title || item.headline || 'Tren Hangat Hari Ini',
              headline: item.headline || item.title || '',
              topic: item.topic || item.scenario || '',
              topic_tag: item.topic_tag || 'finansial',
              suggested_format: item.suggested_format || 'financial_breakdown',
              suggested_hook: item.suggested_hook || item.hook || '',
              source: 'Threads Real-time Algorithmic Wave'
            }));
          }
        }
      }
    } catch (e) {
      console.warn('[SocialRadar] Groq wave synthesis error:', e.message);
    }
  }

  // 2. Fallback OpenRouter
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt + '\n\nBalas HANYA JSON array string murni.' }],
          temperature: 0.6
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const clean = content.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(clean);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn('[SocialRadar] OpenRouter wave synthesis error:', e.message);
    }
  }

  return getFallbackTrends();
}

/**
 * Memindai tren real-time, mensintesis gelombang baru, dan menyimpannya ke database
 */
async function scanThreadsViralTrends(forceFresh = false) {
  if (!forceFresh) {
    const cached = db.getSetting('ACTIVE_VIRAL_WAVES');
    const cachedAt = db.getSetting('ACTIVE_VIRAL_WAVES_AT');
    if (cached && cachedAt) {
      const ageHours = (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours < 3) {
        try {
          return JSON.parse(cached);
        } catch (e) {}
      }
    }
  }

  console.log('[SocialRadar] 🌊 Mengintai radar isu real-time Indonesia (Detik Finance, Trends, Comments)...');
  const headlines = await fetchLiveTrendHeadlines();
  const netizenComments = db.getRecentNetizenCommentsForIdeation ? db.getRecentNetizenCommentsForIdeation(6) : [];

  const waves = await synthesizeViralWaves(headlines, netizenComments);

  if (waves && waves.length > 0) {
    db.setSetting('ACTIVE_VIRAL_WAVES', JSON.stringify(waves));
    db.setSetting('ACTIVE_VIRAL_WAVES_AT', new Date().toISOString());
    console.log(`[SocialRadar] 🚀 Berhasil menangkap ${waves.length} gelombang tren siap tunggangi di Threads!`);
    return waves;
  }

  return getFallbackTrends();
}

/**
 * Mengambil gelombang aktif saat ini untuk disuapkan ke slot tayang berikutnya
 */
function getActiveViralWaves() {
  try {
    const raw = db.getSetting('ACTIVE_VIRAL_WAVES');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return getFallbackTrends();
}

/**
 * Topik cadangan evergreen yang tervalidasi retensi tinggi
 */
function getFallbackTrends() {
  return [
    {
      title: 'Realita Gaji UMR di Era Beras & Listrik Naik',
      headline: 'Kenaikan Harga Pangan Pokok & Tagihan Listrik Rumah Tangga',
      topic: 'Gaji Rp4.900.000 di Jakarta dengan harga beras Rp15.500 per kg dan listrik naik 25%. Sisa tabungan bulanan tergerus sisa Rp250.000.',
      topic_tag: 'finansial',
      suggested_format: 'financial_breakdown',
      suggested_hook: 'Gaji 4.9 juta pas beras sama listrik naik:',
      source: 'Evergreen Retention Radar'
    },
    {
      title: 'Drama Lembur 48 Jam Seminggu Tanpa Bayaran',
      headline: 'Isu Lembur Tak Dibayar & Jam Kerja Tak Terbatas di Sektor Swasta',
      topic: 'Atasan minta standby revisi hari Sabtu jam 10 malam tanpa hitungan uang lembur dengan dalih komitmen dan loyalitas kerja.',
      topic_tag: 'duniakerja',
      suggested_format: 'hot_take',
      suggested_hook: 'disuruh standby revisi sabtu jam 10 malam tanpa uang lembur itu bukan loyal, tapi eksploitasi.',
      source: 'Evergreen Retention Radar'
    },
    {
      title: 'Dilema Token Listrik Jebol di Kontrakan Bersama',
      headline: 'Biaya Hidup Anak Kos & Patungan Listrik Kamar',
      topic: 'Teman satu kontrakan nyalain AC 24 jam tapi maunya patungan listrik Rp400.000 dibagi rata berdua.',
      topic_tag: 'anakkos',
      suggested_format: 'menfess_spill',
      suggested_hook: 'spill kelakuan temen kos lu pas giliran patungan token listrik yang AC-nya nyala 24 jam.',
      source: 'Evergreen Retention Radar'
    }
  ];
}

module.exports = {
  fetchLiveTrendHeadlines,
  synthesizeViralWaves,
  scanThreadsViralTrends,
  getActiveViralWaves,
  getFallbackTrends
};
