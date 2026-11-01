const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { publishTextPost, getActiveAccessToken, fetchPostPermalink } = require('./threads');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Blacklist ketat untuk berita/isu terlarang
const UNSAFE_NEWS_KEYWORDS = [
  'tewas', 'meninggal', 'pembunuhan', 'jenazah', 'korban jiwa', 'bunuh diri',
  'perkosa', 'pelecehan', 'cabul', 'teroris', 'bom', 'gempa', 'banjir bandang',
  'longsor', 'erupsi', 'tsunami', 'sara', 'penistaan', 'khilafah'
];

// Topik cadangan (Evergreen Gen Z / Sandwich Gen Reality) jika RSS gagal atau offline
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
 * Fetch dan filter headline berita terkini dari RSS Finansial, Kerja & Google Trends
 */
async function fetchTrendingHeadline() {
  const sources = [
    { url: 'https://finance.detik.com/rss', name: 'Detik Finance' },
    { url: 'https://www.cnbcindonesia.com/market/rss', name: 'CNBC Indonesia' },
    { url: 'https://trends.google.com/trending/rss?geo=ID', name: 'Google Trends ID' },
    { url: 'https://www.antaranews.com/rss/terkini.xml', name: 'Antara News' }
  ];

  const preferredKeyword = /gaji|uang|biaya|kerja|kantor|harga|kos|ojol|krl|pajak|ppn|phk|reimburse|inflasi|makan|kopi|utang|pinjol|tabungan|rekening|lifestyle|karyawan|cuti/i;

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const xml = await res.text();

      const titles = (xml.match(/<title>([^<]+)<\/title>/g) || [])
        .map(t => t.replace(/<\/?title>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '').trim())
        .filter(t => t.length > 10 && !t.toLowerCase().includes('antara') && !t.toLowerCase().includes('google trends') && !t.toLowerCase().includes('detik') && !t.toLowerCase().includes('cnbc'));

      // 1. Utamakan headline yang menyentuh finansial / kerjaan / biaya hidup
      const prioritized = titles.filter(t => preferredKeyword.test(t));
      const pool = prioritized.length > 0 ? prioritized : titles;

      for (const title of pool) {
        const lower = title.toLowerCase();
        const isUnsafe = UNSAFE_NEWS_KEYWORDS.some(kw => lower.includes(kw));
        if (!isUnsafe) {
          return {
            source: src.name,
            headline: title
          };
        }
      }
    } catch (e) {
      console.warn(`[HotTakes] Gagal mengambil RSS dari ${src.name}:`, e.message);
    }
  }

  // Fallback ke tema realitas sosial evergreen
  const randomEvergreen = EVERGREEN_TOPICS[Math.floor(Math.random() * EVERGREEN_TOPICS.length)];
  return {
    source: 'Evergreen Social Observation',
    headline: randomEvergreen
  };
}

function isValidHotTake(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.replace(/^["']|["']$/g, '').trim();
  // Wajib minimal 60 karakter dan minimal 8 kata
  if (clean.length < 60) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  // Dilarang keras postingan satu kata atau label kategori
  if (/^(kesehatan|politik|ekonomi|hiburan|olahraga|hukum|nasional|internasional|berita|ragam)\.?$/i.test(clean)) return false;
  // Dilarang kata fiksi, AI, atau memanggil diri sendiri Ki
  if (/fiksi|fiktif|buatan ai|as an ai|\bki\b/i.test(clean)) return false;
  return true;
}

/**
 * Generate 1 Hot Take pendek dengan persona pekerja media Jakarta (@kikipunyacerita)
 */
async function generateHotTakePost(headlineInfo, slotType = 'PAGI') {
  let cognitiveContext = '';
  try {
    const { buildCognitiveTuningContext } = require('./growthEngine');
    if (buildCognitiveTuningContext) cognitiveContext = buildCognitiveTuningContext();
  } catch (e) {}

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pekerja media di Jakarta (usia 26 thn, ngekos di Jakpus, sandwich generation).
${cognitiveContext}
Tugas: Tuliskan SATU (1) POSTINGAN PENDEK DEADPAN (2-3 kalimat lengkap, 110 - 200 karakter) yang mengomentari isu/berita ini dari kacamata dompet dan realita kerjaan.

ISU / BERITA / FENOMENA HARI INI:
"${headlineInfo.headline}" (Sumber: ${headlineInfo.source})
Waktu Posting: Slot ${slotType}

ATURAN KETAT (ANTI-AI & DEADPAN):
1. DILARANG memanggil diri sendiri "Ki" atau "Kiki"!
2. DILARANG sapaan basi (Guys, Halo) dan DILARANG HASHTAG (#) apapun.
3. BELOKKAN isu ke realitas sehari-hari: dompet rakyat biasa, mahalnya hidup, gaji stagnan, potongan slip gaji, atau lelahnya cari nafkah.
4. Sertakan 1 angka konkret (rupiah/jam/durasi) agar observasinya punya bobot nyata.
5. Gaya bahasa: Huruf kecil santai, deadpan (datar), sinis-realistis, tanpa menumpuk kata slang beruntun.
6. DILARANG menyisipkan link promosi atau produk apapun.
7. Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  // 1. Coba Gemini 2.5 Flash
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
            temperature: 0.75,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidHotTake(clean)) return clean;
        console.warn(`[HotTakes] Hasil Gemini tidak lolos validasi ("${clean}"), mencoba Groq...`);
      }
    } catch (e) {
      console.warn('[HotTakes] Gemini rate limit/error, mencoba Groq...');
    }
  }

  // 2. Fallback ke Groq LPU (openai/gpt-oss-120b)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 250,
          temperature: 0.75
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidHotTake(clean)) return clean;
        console.warn(`[HotTakes] Hasil Groq tidak lolos validasi ("${clean}")`);
      }
    } catch (e) {
      console.warn('[HotTakes] Groq fallback error:', e.message);
    }
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
          max_tokens: 300,
          temperature: 0.8
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidHotTake(clean)) return clean;
        console.warn(`[HotTakes] Hasil OpenRouter tidak lolos validasi ("${clean}")`);
      }
    } catch (e) {
      console.warn('[HotTakes] OpenRouter fallback error:', e.message);
    }
  }

  // Fallback kurasi tinggi yang pasti valid & manusiawi
  const fallbackList = [
    `In this economy, denger berita kayak gini cuma bikin elus dada. Gaji bulanan cuma numpang lewat beberapa jam buat bayar cicilan, sisanya bertahan hidup pake doa dan kopi saset.`,
    `Mau sok-sokan cuek sama keadaan tapi pas buka m-banking langsung sadar diri. Hidup makin mahal, tuntutan makin banyak, tapi saldo tabungan jalan di tempat.`,
    `Realitas pekerja zaman sekarang: berangkat gelap pulang gelap, tenaga diperas, tapi giliran nuntut hak malah disuruh bersyukur sama manajemen.`
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
