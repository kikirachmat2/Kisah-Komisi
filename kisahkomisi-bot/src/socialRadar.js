const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { getAutoTopicTag } = require('./aiStory');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Blacklist isu terlarang Meta TOS & kriminalitas berat
const UNSAFE_KEYWORDS = [
  'tewas', 'meninggal', 'pembunuhan', 'jenazah', 'bunuh diri',
  'perkosa', 'pelecehan', 'cabul', 'teroris', 'bom', 'sara',
  'khilafah', 'penistaan', 'erotis', 'bokep', 'judi', 'slot'
];

// Kata kunci kurasi finansial, kerjaan, dan realita hidup urban Indonesia
const VIRAL_RELEVANCE_REGEX = /gaji|bsu|uang|biaya|kerja|kantor|harga|beras|kos|ojol|krl|pajak|ppn|phk|karyawan|cuti|reimburse|inflasi|pangan|listrik|cicilan|tabungan|fresh grad|loker|rekrutmen|tagihan|sewa|warteg/i;

/**
 * Mengambil headline terkini dari feed berita finansial & tren Indonesia
 */
async function fetchLiveTrendHeadlines() {
  const sources = [
    { name: 'Detik Finance', url: 'https://finance.detik.com/rss' },
    { name: 'Google Trends ID', url: 'https://trends.google.com/trending/rss?geo=ID' },
    { name: 'Antara News', url: 'https://www.antaranews.com/rss/terkini.xml' }
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const collectedHeadlines = [];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { headers, signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const xml = await res.text();

      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const it of items) {
        const titleMatch = it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || it.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          const rawTitle = titleMatch[1].replace(/&amp;/g, '&').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          const lower = rawTitle.toLowerCase();

          // Abaikan judul pendek atau nama media
          if (rawTitle.length < 12 || lower.includes('detik') || lower.includes('antara') || lower.includes('google trends')) continue;

          // Cek keamanan
          if (UNSAFE_KEYWORDS.some(k => lower.includes(k))) continue;

          // Utamakan yang menyentuh finansial, kerjaan, atau biaya hidup
          if (VIRAL_RELEVANCE_REGEX.test(rawTitle)) {
            collectedHeadlines.push({ title: rawTitle, source: src.name, priority: true });
          } else if (collectedHeadlines.length < 15) {
            collectedHeadlines.push({ title: rawTitle, source: src.name, priority: false });
          }
        }
      }
    } catch (e) {
      console.warn(`[SocialRadar] Gagal mengambil feed ${src.name}:`, e.message);
    }
  }

  // Sort: prioritas finansial & kerjaan di atas
  collectedHeadlines.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  return collectedHeadlines.slice(0, 8);
}

/**
 * Mengubah headline berita riil & keluhan netizen menjadi Skenario Gelombang Viral Threads (Wave-Chaser)
 * Menggunakan Groq 120B (ultra-fast reasoning).
 */
async function synthesizeViralWaves(rawHeadlines = [], netizenComments = []) {
  if (rawHeadlines.length === 0 && netizenComments.length === 0) {
    return getFallbackTrends();
  }

  const prompt = `
Kamu adalah Algorithmic Wave-Chaser & Chief Social Strategist untuk akun Threads Indonesia @kikipunyacerita.
Tugasmu adalah MENGINTAI apa yang sedang ramai diperbincangkan warganet Indonesia hari ini, lalu mengubahnya menjadi 3 s/d 4 SKENARIO KONTEN THREADS YANG SIAP MELEDAKKAN ALGORITMA FOR YOU (FYP).

BERITA / ISU REAL-TIME TERKINI:
${rawHeadlines.slice(0, 6).map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n') || '- Belum ada berita baru'}

KOMENTAR ASLI NETIZEN YANG MASUK DI AKUN:
${netizenComments.slice(0, 4).map((c, i) => `- @${c.author_username}: "${c.comment_text}"`).join('\n') || '- Belum ada komentar'}

PRINSIP VIRAL THREADS (DATA EMPIRIS POST 73RB VIEWS):
1. Algoritma Threads sangat menyukai KONTROVERSI ANGKANYA: Jangan tulis keluhan abstrak! Sertakan nominal rupiah konkret (cth: "Rp4.800.000", "Rp1.600.000", "900 ribu"), jam kejadian ("07:15 WIB"), atau rincian biaya hidup.
2. Belokkan isu nasional/kebijakan ke DOMPET KELAS MENENGAH & PEKERJA BIASA: Hubungkan kenaikan harga, PHK, subsidi, atau aturan kantor ke nasib anak kos, komuter KRL, fresh graduate, atau generasi sandwich.
3. Gaya: Deadpan, datar, sinis-realistis, tanpa kata slang beruntun ("boncamatan", "ngelap dosa dompet" DILARANG), tanpa memanggil diri sendiri "Ki".
4. Format:
   - financial_breakdown: Rincian hitungan biaya hidup / sisa gaji pas-pasan
   - hot_take: 1-liner observasi tajam tanpa basa-basi
   - menfess_spill: Pancingan debat agar netizen bercerita di komentar
   - anonymous_curhat_story: Utas curhat relatable 3 part

Keluarkan HANYA JSON array valid:
[
  {
    "title": "Judul Tren Singkat (Maksimal 6 kata)",
    "headline": "Isu Nyata yang Ditunggangi",
    "topic": "Skenario konkret lengkap dengan angka rupiah/jam dan dilema nyata",
    "topic_tag": "finansial|duniakerja|anakkos|krl|rumahtangga",
    "suggested_format": "financial_breakdown|hot_take|menfess_spill|anonymous_curhat_story",
    "suggested_hook": "Kalimat pembuka hook kuat langsung ke inti angka/kejadian"
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
