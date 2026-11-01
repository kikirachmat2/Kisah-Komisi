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
Kamu adalah Social Radar Specialist untuk audiens Threads Indonesia (@kikipunyacerita).
Lakukan pencarian Google real-time untuk topik hangat, isu biaya hidup, dunia kerja, gaji, kosan, komuter, atau pengeluaran harian yang SEDANG RAMAI diperdebatkan atau dikeluhkan warganet Indonesia hari ini / minggu ini.

Kategori yang sangat potensial memicu keterlibatan (engagement wave):
1. Finansial & Realita Gaji: Gaji fresh grad/UMR vs biaya kosan/makan, potongan BPJS/PPh 21, sandwich generation kirim ortu, dana darurat, cicilan paylater/motor.
2. Dunia Kerja & Korporat: Lembur tak dibayar, reimburse kantor nunggak, manajer nolak cuti, diskriminasi gaji senior vs orang baru, drama resign, meeting tanpa arah.
3. Kehidupan Anak Kos & Kontrakan: Token listrik jebol, biaya sewa naik, kelakuan teman sekamar, split bill dapur, air galon/laundry.
4. Komuter & Transportasi Publik: Drama KRL Manggarai jam 7 pagi, ojol vs jalan kaki, tarif parkir liar tanpa karcis, macet rute protokol.
5. Asmara & Relasi Urban: Split bill pas kencan pertama, patungan kado nikahan teman kantor, pasangan perhitungan serupiah.

ATURAN KETAT:
- DILARANG isu politik partai, demo jalanan, pilkada/pemilu, atau orasi aktivis (data membuktikan topik politik/demo mendapat engagement terendah).
- HANYA topik yang menyentuh DOMPET, KERJAAN, dan KESEHARIAN orang biasa.
- WAJIB sertakan minimal 1 angka konkret (nominal rupiah, jam, atau durasi) di bagian penjelasan topic.
- Keluarkan TEPAT 3 sampai 5 topik dalam format JSON persis seperti ini:

[
  {
    "title": "Judul Singkat Menarik (Maksimal 6 kata)",
    "topic": "Penjelasan detail situasi/konflik 1-2 kalimat konkret dengan angka rupiah/jam nyata",
    "topic_tag": "finansial|duniakerja|anakkos|krl|rumahtangga|relasi",
    "vibe": "finansial|kantor|kosan|transportasi|relasi"
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
