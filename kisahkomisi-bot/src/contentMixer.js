const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { generateStory, getAutoTopicTag } = require('./aiStory');
const { scanThreadsViralTrends } = require('./socialRadar');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Kategori format konten
const FORMAT_TYPES = {
  STORY_AFFILIATE: 'story_affiliate',
  HOT_TAKE: 'hot_take',
  MENFESS_SPILL: 'menfess_spill',
  FINANCIAL_BREAKDOWN: 'financial_breakdown'
};

// Bank tema Menfess Spill (Crowdsourcing reply bait)
const MENFESS_SPILL_THEMES = [
  'Kelakuan paling di luar nalar dari mantan teman sekamar kos',
  'Aturan gak tertulis di kantor yang kalau dilanggar bakal dijauhin satu divisi',
  'Hal paling zonk pas kencan pertama pas giliran bayar tagihan makan',
  'Pengalaman barang di kulkas kosan raib misterius tanpa jejak',
  'Momen disuruh ngerjain tugas di luar jobdesk oleh atasan tapi gak ada apresiasi',
  'Kelakuan tetangga komplek paling bikin ngelus dada soal parkir atau sampah',
  'Momen dipinjemin uang sama temen tapi pas ditagih malah kita yang disemprot',
  'Alasan paling gak masuk akal pas atasan nolak pengajuan cuti tahunan',
  'Momen dititipin oleh-oleh pas liburan sama temen kantor tapi duitnya gak pernah diganti',
  'Hal paling bikin ilfeel pas PDKT pas liat cara dia memperlakukan pelayan resto',
  'Pengalaman diajak temen lama reuni taunya diprospek jualan MLM atau asuransi',
  'Kelakuan rekan kerja satu tim yang paling jago cari muka di depan bos besar'
];

// Bank tema Financial Breakdown (In this economy reality check)
const FINANCIAL_THEMES = [
  'Gaji UMR Jakarta vs realitas biaya kos, makan warteg, dan cicilan motor',
  'Ironi beli kopi susu 40 ribu santai tapi ongkir belanja online 8 ribu mikir keras',
  'Simulasi biaya hidup lajang vs ekspektasi nikah mewah di hotel bintang empat',
  'Potongan slip gaji BPJS dan pajak bertambah tapi fasilitas publik gak berubah',
  'Gaji 7 juta kirim ortu 2 juta sisa tabungan receh buat dana darurat',
  'Fenomena FOMO nongkrong cafe tiap weekend padahal limit paylater udah mepet',
  'Gaji 5.5 juta di Jaksel vs realitas sewa kos sepetak dan makan siang kantor',
  'Simulasi nabung nikah 2 tahun gaji 6 juta vs inflasi harga katering dan sewa gedung',
  'Sandwich generation gaji 7 juta nanggung adik sekolah dan cicilan motor orang tua',
  'Realitas split bill kencan pertama: pesen steak mewah tapi pas bayar minta bagi dua rata'
];

// Bank tema Hot Takes Sarkasme
const HOT_TAKE_THEMES = [
  'Orang yang hobi bales chat kerjaan pas weekend itu bukan loyal tapi gak punya hobi',
  'Normalisasi gak ikut patungan kado nikahan teman kantor yang gak pernah nyapa di pantry',
  'Pekerja loyal 5 tahun gajinya kalah sama karyawan baru yang jago nego pas interview',
  'Istilah loyalitas perusahaan itu cuma mitos pas giliran efisiensi karyawan',
  'Makin dewasa lingkaran pertemanan mengecil bukan karena sombong tapi sama-sama capek dan ga ada duit',
  'Gelar sarjana sekarang cuma syarat administrasi, yang nentuin keterima tetep orang dalem atau hoki',
  'Kerja lembur tiap hari bukan tanda produktif, tapi tanda manajemen kerjaannya berantakan'
];

/**
 * Panggil AI dengan hierarki multi-provider: Gemini -> Groq 120B -> OpenRouter
 */
async function callAiWithFallback(prompt, temperature = 0.7) {
  // 1. Coba Gemini 2.5 Flash
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) return text.trim();
      }
    } catch (e) {
      // lanjut fallback
    }
  }

  // 2. Coba Groq LPU (openai/gpt-oss-120b)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          temperature
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim().length > 0) return text.trim();
      }
    } catch (e) {
      // lanjut fallback
    }
  }

  // 3. Fallback OpenRouter
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          temperature
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim().length > 0) return text.trim();
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Generate 1 Hot Take Sarkasme Realitas (Format 1-Liner untuk Repost & Quotes)
 */
async function generateHotTake(options = {}) {
  const theme = options.theme || HOT_TAKE_THEMES[Math.floor(Math.random() * HOT_TAKE_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), kurator Threads. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU (1) POSTINGAN SARKASME / HOT TAKE PENDEK (1-2 kalimat padat, panjang 90-180 karakter).

TEMA REALITAS:
"${theme}"

ATURAN KETAT:
1. DILARANG sapaan basi (Guys, Halo, Selamat Pagi).
2. DILARANG HASHTAG (#) apapun.
3. Gaya bahasa gaul santai, tajam, menertawakan nasib sendiri (self-deprecating), yang bikin orang langsung pengen me-repost ke profilnya.
4. DILARANG iklan/promosi apapun.
Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `Orang yang hobi bales chat kerjaan pas weekend itu bukan loyal, tapi gak punya kehidupan pribadi di luar kantor. In this economy kewarasan emang ada harganya.`;
  }

  // Bersihkan kutip jika ada
  text = text.replace(/^["']|["']$/g, '').trim();

  return {
    title: `Sarkasme: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.HOT_TAKE,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides: [text],
    variant: 'A',
    origin: 'opinion'
  };
}

/**
 * Generate 1 Menfess Spill (Crowdsourcing Reply Magnet)
 */
async function generateMenfessSpill(options = {}) {
  const theme = options.theme || MENFESS_SPILL_THEMES[Math.floor(Math.random() * MENFESS_SPILL_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), kurator Threads. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU (1) POSTINGAN CROWDSOURCING / MENFESS SPILL PENDEK (panjang 110-180 karakter) untuk memancing ratusan komentar warganet.

TOPIK PANCINGAN:
"${theme}"

ATURAN KETAT:
1. DILARANG sapaan basi (Guys, Halo, Selamat Pagi).
2. DILARANG HASHTAG (#) apapun.
3. LANGSUNG mulai dengan formula pancingan: "Spill..." atau "Sebutin 1..." atau "Hal paling absurd...".
4. Akhiri dengan ajakan curhat yang santai (contoh: "Coba cerita di bawah, pengen tau seaneh apa.", "Kalian ada yang pernah ngalamin lebih parah?").
5. DILARANG iklan/promosi apapun.
Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `Spill kelakuan paling gak masuk akal dari mantan temen sekamar kos lu yang bikin lu langsung mikir 'gue harus pindah minggu ini juga'. Pengen tau se-absurd apa.`;
  }

  text = text.replace(/^["']|["']$/g, '').trim();

  return {
    title: `Spill Warganet: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.MENFESS_SPILL,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides: [text],
    variant: 'A',
    origin: 'crowdsource'
  };
}

/**
 * Generate 1 Financial Breakdown ("In this economy" Reality Check)
 */
async function generateFinancialBreakdown(options = {}) {
  const theme = options.theme || FINANCIAL_THEMES[Math.floor(Math.random() * FINANCIAL_THEMES.length)];
  const topicTag = 'finansial';

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), kurator Threads. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU (1) POSTINGAN FINANCIAL BREAKDOWN realitas gaji vs pengeluaran sehari-hari di kota besar (panjang 160-260 karakter).

TEMA:
"${theme}"

STRUKTUR WAJIB:
- Baris 1: Pemasukan bulanan (misal: "Gaji 6 juta di Jakarta:")
- Baris 2-5: Rincian poin pengeluaran konkret (Kos, makan, KRL, jatah ortu, kuota/internet)
- Baris terakhir: Sisa tabungan receh + celetukan sarkas yang nendang (misal: "Terus ada yang ngajak nongkrong di Senopati? Mending gue pura-pura pingsan.")

ATURAN KETAT:
1. DILARANG sapaan basi dan DILARANG HASHTAG (#).
2. Bahasa santai warganet, relatable, bikin orang menghela napas setuju dan me-repost.
3. DILARANG iklan/promosi apapun.
Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  let text = await callAiWithFallback(prompt, 0.7);
  if (!text || text.length < 50) {
    text = `Gaji 6 juta di Jakarta:\n• Kos: 1.6jt\n• Makan: 1.8jt\n• KRL & ojol: 400rb\n• Kirim ortu: 1jt\n• Kuota & langganan: 200rb\nSisa 1 juta buat tabungan darurat.\nTerus ada yang ngajak nongkrong abis 500rb semalam? Mending gue pura-pura tipes.`;
  }

  text = text.replace(/^["']|["']$/g, '').trim();

  return {
    title: `Finansial: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.FINANCIAL_BREAKDOWN,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides: [text],
    variant: 'A',
    origin: 'opinion'
  };
}

/**
 * Generate postingan berdasarkan format yang diminta
 */
async function generateMixedPost(formatType, options = {}) {
  switch (formatType) {
    case FORMAT_TYPES.HOT_TAKE:
      return await generateHotTake(options);
    case FORMAT_TYPES.MENFESS_SPILL:
      return await generateMenfessSpill(options);
    case FORMAT_TYPES.FINANCIAL_BREAKDOWN:
      return await generateFinancialBreakdown(options);
    case FORMAT_TYPES.STORY_AFFILIATE:
    default:
      // Panggil aiStory dengan afiliasi aktif + price anchoring + 2-kubu dilemma
      const story = await generateStory({ variant: 'B', ...options });
      return {
        ...story,
        format_type: FORMAT_TYPES.STORY_AFFILIATE
      };
  }
}

/**
 * Menentukan format ideal untuk setiap dari 6 slot harian:
 * Slot 1 (07:15 Pagi): HOT_TAKE / SPILL (0% Ad, Pagi komuter, magnet repost)
 * Slot 2 (10:00 Pagi): MENFESS_SPILL (0% Ad, Coffee break, magnet reply)
 * Slot 3 (12:30 Siang): STORY_AFFILIATE (AFFILIATE #1, Jam makan siang kantor)
 * Slot 4 (16:30 Sore): FINANCIAL_BREAKDOWN / HOT_TAKE (0% Ad, Pulang kantor)
 * Slot 5 (19:30 Malam): STORY_AFFILIATE (AFFILIATE #2, Santai sehabis maghrib)
 * Slot 6 (21:45 Malam): STORY_AFFILIATE (AFFILIATE #3, Peak rebahan malam)
 */
function getFormatForSlotNumber(slotNumber) {
  switch (Number(slotNumber)) {
    case 1:
      return Math.random() > 0.4 ? FORMAT_TYPES.HOT_TAKE : FORMAT_TYPES.MENFESS_SPILL;
    case 2:
      return FORMAT_TYPES.MENFESS_SPILL;
    case 3:
      return FORMAT_TYPES.STORY_AFFILIATE; // Wajib Affiliate
    case 4:
      return Math.random() > 0.5 ? FORMAT_TYPES.FINANCIAL_BREAKDOWN : FORMAT_TYPES.HOT_TAKE;
    case 5:
      return FORMAT_TYPES.STORY_AFFILIATE; // Wajib Affiliate
    case 6:
      return FORMAT_TYPES.STORY_AFFILIATE; // Wajib Affiliate
    default:
      return FORMAT_TYPES.STORY_AFFILIATE;
  }
}

module.exports = {
  FORMAT_TYPES,
  generateHotTake,
  generateMenfessSpill,
  generateFinancialBreakdown,
  generateMixedPost,
  getFormatForSlotNumber
};
