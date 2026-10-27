const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { getAutoTopicTag } = require('./aiStory');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Blacklist isu kriminal berat & pelanggaran berat Meta TOS (SARA, pornografi, terorisme, bunuh diri)
const UNSAFE_KEYWORDS = [
  'tewas', 'meninggal', 'pembunuhan', 'jenazah', 'bunuh diri',
  'perkosa', 'pelecehan', 'cabul', 'teroris', 'bom', 'sara'
];

/**
 * Memindai isu atau topik kehidupan sehari-hari, demo, politik, atau tren viral yang SEDANG RAMAI di Indonesia
 * Menggunakan Gemini 2.5 Flash dengan Google Search Grounding real-time.
 */
async function scanThreadsViralTrends(forceFresh = false) {
  // Cek cache di settings (valid 3 jam agar tetap segar)
  if (!forceFresh) {
    const cached = db.getSetting('THREADS_TRENDING_RADAR');
    const cachedAt = db.getSetting('THREADS_TRENDING_RADAR_AT');
    if (cached && cachedAt) {
      const ageHours = (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours < 3) {
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
Lakukan pencarian Google real-time untuk topik hangat, isu politik/kebijakan publik, demo, keluhan, curhatan, atau drama viral yang SEDANG RAMAI dibahas warganet Indonesia hari ini / minggu ini.

Kategori yang sangat potensial memicu keterlibatan (engagement wave):
1. Isu sosial & politik warganet (demo mahasiswa/buruh, kebijakan absurd, pajak/PPN, aturan kerja/tapera, fenomena "indonesia cemas/gelap")
2. Dunia kerja & korporat (kantor toxic, lembur, gaji, bos narsis, drama resign)
3. Kehidupan anak kos / kontrakan (biaya hidup, token listrik, teman kos)
4. Relasi & asmara (kencan zonk, split bill, red flag)
5. KRL & transportasi publik (macet jalanan, demo bundaran HI, commuter Sudirman)

SUDUT PANDANG KIKI:
Bukan buzzer politik kaku, melainkan anak muda korporat Jaksel yang adaptif, ceplas-ceplos, dan empatik.
Contoh saat ada demo: "denger denger ada demo yaa, semangat kawan kawan mahasiswa, biar kuterjang macet ini asal aspirasi tersampaikan dengan baik, stay safe kawan kawan".

ATURAN KETAT:
- HANYA hindari konten pornografi, SARA ekstrem, atau glorifikasi kekerasan berat/pembunuhan.
- Isu politik berani, kritik sosial, atau polemik publik SANGAT DIPERBOLEHKAN karena merupakan wave keterlibatan terbaik.
- Keluarkan TEPAT 3 sampai 5 topik dalam format JSON persis seperti ini:

[
  {
    "title": "Judul Singkat Menarik",
    "topic": "Penjelasan detail situasi/konflik 1-2 kalimat konkret",
    "topic_tag": "duniakerja|anakkos|krl|rumahtangga|finansial|curhat",
    "vibe": "kantor|kosan|politik|sosial|transportasi"
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
        const rawTag = item.topic_tag || getAutoTopicTag(item.topic);
        const cleanTag = String(rawTag).split(/[|,/]/)[0].trim().replace(/[^a-zA-Z0-9_]/g, '');
        sanitizedTrends.push({
          title: item.title || 'Isu Hangat Warganet',
          topic: item.topic,
          topic_tag: cleanTag || 'threads',
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
