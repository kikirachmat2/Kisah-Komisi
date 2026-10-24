const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { getAutoTopicTag } = require('./aiStory');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Blacklist isu berbahaya/sensitif untuk menjaga keamanan akun Meta & UU ITE
const UNSAFE_KEYWORDS = [
  'tewas', 'meninggal', 'pembunuhan', 'jenazah', 'bunuh diri',
  'perkosa', 'pelecehan', 'cabul', 'teroris', 'bom', 'sara', 'agama',
  'partai', 'pilpres', 'pilkada', 'pemilu', 'menteri', 'presiden'
];

/**
 * Memindai isu atau topik kehidupan sehari-hari yang sedang ramai dibahas di Threads Indonesia
 * Menggunakan Gemini 2.5 Flash dengan Google Search Grounding real-time.
 */
async function scanThreadsViralTrends(forceFresh = false) {
  // Cek cache di settings (valid 6 jam)
  if (!forceFresh) {
    const cached = db.getSetting('THREADS_TRENDING_RADAR');
    const cachedAt = db.getSetting('THREADS_TRENDING_RADAR_AT');
    if (cached && cachedAt) {
      const ageHours = (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours < 6) {
        try {
          return JSON.parse(cached);
        } catch (e) {}
      }
    }
  }

  if (!GEMINI_API_KEY) {
    console.warn('[SocialRadar] GEMINI_API_KEY tidak tersedia untuk Google Search Grounding.');
    return getFallbackTrends();
  }

  const prompt = `
Kamu adalah Social Radar Specialist untuk audiens Threads Indonesia (@ceritakikiii).
Lakukan pencarian Google real-time untuk topik, keluhan, curhatan, atau drama viral yang SEDANG RAMAI dibahas warganet Indonesia di platform Threads hari ini / minggu ini.

Fokuskan pada kategori kehidupan nyata yang relatable:
1. Dunia kerja (kantor toxic, lembur, gaji, bos narsis, teman cari muka, drama resign)
2. Kehidupan anak kos / kontrakan (teman jorok, bawa pacar nginep, kulkas kosan, token listrik jebol)
3. Relasi & asmara (kencan pertama zonk, friendzone, split bill ekstrem, ghosting)
4. Kehidupan bertetangga / rumah tangga (parkir depan pagar, arisan macet, mertua)
5. KRL / transportasi publik (rebutan kursi, drama ojol)

ATURAN KETAT:
- DILARANG isu politik praktis (menteri, capres, partai), kekerasan, atau berita duka.
- Wajib isu yang memicu perdebatan / obrolan / curhat sesama warganet di Threads.
- Keluarkan TEPAT 3 sampai 5 topik dalam format JSON persis seperti ini:

[
  {
    "title": "Judul Singkat Menarik",
    "topic": "Penjelasan detail situasi/konflik 1-2 kalimat konkret",
    "topic_tag": "duniakerja|anakkos|krl|rumahtangga|finansial|curhat",
    "vibe": "kantor|kosan|kencan|tetangga|keuangan"
  }
]

Balas HANYA string JSON murni tanpa pembuka atau markdown lainnya.
`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }]
      })
    });

    if (!res.ok) {
      throw new Error(`Gemini API error HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n');

    if (!rawText) {
      throw new Error('Respons Gemini kosong');
    }

    // Bersihkan format markdown jika ada
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    // Cari array JSON
    const match = cleanJson.match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error('Format JSON array tidak ditemukan dalam respon Gemini');
    }

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Hasil parse bukan array atau kosong');
    }

    // Filter keamanan & lengkapi topic_tag
    const sanitizedTrends = [];
    for (const item of parsed) {
      const fullText = `${item.title || ''} ${item.topic || ''}`.toLowerCase();
      const isUnsafe = UNSAFE_KEYWORDS.some(kw => fullText.includes(kw));
      if (!isUnsafe && item.topic) {
        sanitizedTrends.push({
          title: item.title || 'Isu Hangat Warganet',
          topic: item.topic,
          topic_tag: item.topic_tag || getAutoTopicTag(item.topic),
          vibe: item.vibe || 'kantor',
          source: 'Threads Real-time Radar (Gemini Live Search)'
        });
      }
    }

    if (sanitizedTrends.length > 0) {
      db.setSetting('THREADS_TRENDING_RADAR', JSON.stringify(sanitizedTrends));
      db.setSetting('THREADS_TRENDING_RADAR_AT', new Date().toISOString());
      console.log(`[SocialRadar] Berhasil mendeteksi ${sanitizedTrends.length} tren real-time Threads Indonesia.`);
      return sanitizedTrends;
    }
  } catch (err) {
    console.warn('[SocialRadar] Gagal scan tren real-time via Gemini Grounding:', err.message);
  }

  return getFallbackTrends();
}

/**
 * Topik cadangan evergreen yang terbukti menghasilkan views tinggi di Threads Indonesia
 */
function getFallbackTrends() {
  return [
    {
      title: 'Drama Teman Sekamar Kos Bawa Pacar Nginep',
      topic: 'Teman sekamar kos bawa pacar nginep berhari-hari tanpa izin, kasur dipakai saat kita lagi lembur kerja sampai malam',
      topic_tag: 'anakkos',
      vibe: 'kosan',
      source: 'Evergreen Retention Radar'
    },
    {
      title: 'Bos Chat WA Tugas Jam 10 Malam di Luar Jam Kerja',
      topic: 'Atasan hobi kirim chat WhatsApp jam 10 malam minta data dadakan buat besok pagi tanpa ada uang lembur',
      topic_tag: 'duniakerja',
      vibe: 'kantor',
      source: 'Evergreen Retention Radar'
    },
    {
      title: 'Tetangga Parkir Mobil Makan Separuh Jalan Komplek',
      topic: 'Garasi tetangga dijadikan gudang sementara mobilnya diparkir persis di depan gerbang dan bikin macet jalan komplek',
      topic_tag: 'rumahtangga',
      vibe: 'tetangga',
      source: 'Evergreen Retention Radar'
    }
  ];
}

module.exports = {
  scanThreadsViralTrends,
  getFallbackTrends
};
