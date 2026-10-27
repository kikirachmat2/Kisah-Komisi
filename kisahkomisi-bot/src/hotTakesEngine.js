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
 * Fetch dan filter headline berita terkini dari RSS Antara News & Google Trends
 */
async function fetchTrendingHeadline() {
  const sources = [
    { url: 'https://www.antaranews.com/rss/terkini.xml', name: 'Antara News' },
    { url: 'https://trends.google.com/trending/rss?geo=ID', name: 'Google Trends ID' }
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const xml = await res.text();

      const titles = (xml.match(/<title>([^<]+)<\/title>/g) || [])
        .map(t => t.replace(/<\/?title>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '').trim())
        .filter(t => t.length > 10 && !t.toLowerCase().includes('antara') && !t.toLowerCase().includes('google trends'));

      for (const title of titles) {
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
  // Dilarang kata fiksi atau AI
  if (/fiksi|fiktif|buatan ai|as an ai/i.test(clean)) return false;
  return true;
}

/**
 * Generate 1 Hot Take pendek dengan persona Gen Z Kiki Rachmat (@ceritakikiii)
 */
async function generateHotTakePost(headlineInfo, slotType = 'PAGI') {
  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii).
Bio akun Threads kamu: "In this economy mau nulis cerita orang-orang aja lah".
Kamu adalah representasi anak muda / Gen Z / pekerja kelas menengah Indonesia yang lelah, realistis, sinis terhadap keadaan hidup, tapi membungkus keresahan dengan humor tongkrongan yang cerdas dan sangat relate (The Exhausted Gen Z Voice of Reason).

ISU / BERITA / FENOMENA HARI INI:
"${headlineInfo.headline}" (Sumber: ${headlineInfo.source})
Waktu Posting: Slot ${slotType}

TUGAS:
Tuliskan SATU (1) POSTINGAN PENDEK MANDIRI (2-3 kalimat lengkap, panjang 100 - 200 karakter) untuk mengomentari fenomena/isu tersebut.

PRINSIP "THE MICRO-IMPACT LENS" (SANGAT KETAT):
1. JANGAN sebut nama politisi, menteri, atau partai politik tertentu (menghindari sensor algoritma Meta & UU ITE).
2. BELOKKAN isu/kemarahan warganet ke realitas sehari-hari: dompet rakyat biasa, mahalnya hidup ("In this economy..."), gaji stagnan, cicilan, kelakuan kantor, atau lelahnya cari nafkah.
3. Gaya bahasa: Gaul santai Indonesia, self-deprecating (menertawakan nasib sendiri), tajam, bikin audiens langsung pengen me-repost/quote.
4. DILARANG KERAS hanya membalas satu kata, judul berita, atau label kategori (seperti "Kesehatan" atau "Ekonomi"). WAJIB kalimat lengkap bercerita/mengeluh dengan opini personal.
5. DILARANG menyisipkan link promosi atau produk apapun.
6. Output HANYA teks postingan langsung tanpa tanda kutip.
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
            temperature: 0.8,
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

  // 2. Fallback ke Groq LPU
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
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 250,
          temperature: 0.8
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
      permalink: permalink || `https://www.threads.net/@ceritakikiii`
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
