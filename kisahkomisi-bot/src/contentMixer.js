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
          generationConfig: {
            maxOutputTokens: 800,
            temperature,
            thinkingConfig: { thinkingBudget: 0 }
          }
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
 * Format nominal rupiah ke string singkat (cth: 1.8 -> '1,8 jt', 0.5 -> '500 rb')
 */
function formatRupiahJt(jt) {
  if (jt <= 0) return '0 rupiah';
  if (jt < 1) {
    const rb = Math.round(jt * 1000);
    return `${rb} rb`;
  }
  const formatted = jt % 1 === 0 ? jt.toFixed(0) : jt.toString().replace('.', ',');
  return `${formatted} jt`;
}

/**
 * Merakit teks postingan financial breakdown dengan kalkulasi matematika 100% presisi.
 * Menghitung Total Pengeluaran dan Sisa Tabungan dalam kode JavaScript (Zero Hallucination).
 */
function buildFinancialBreakdownText({ incomeJt, location, items, punchline }) {
  const totalExpense = Number(items.reduce((sum, it) => sum + it.amountJt, 0).toFixed(2));
  const sisaJt = Number((incomeJt - totalExpense).toFixed(2));

  let sisaLine;
  if (sisaJt > 0) {
    sisaLine = `Sisa ${formatRupiahJt(sisaJt)} buat tabungan darurat.`;
  } else if (sisaJt === 0) {
    sisaLine = `Sisa 0 rupiah alias pas-pasan banget.`;
  } else {
    sisaLine = `Defisit ${formatRupiahJt(Math.abs(sisaJt))} alias minus ditambal paylater.`;
  }

  const lines = [
    `Gaji ${formatRupiahJt(incomeJt)} di ${location}:`,
    ...items.map(it => `• ${it.label}: ${formatRupiahJt(it.amountJt)}`),
    sisaLine,
    punchline
  ];

  return lines.join('\n');
}

/**
 * Bank template anggaran riil tervalidasi 100% akurat secara matematis
 */
const VERIFIED_BUDGETS = [
  {
    incomeJt: 6.0,
    location: 'Jakarta',
    items: [
      { label: 'Kos (listrik + air)', amountJt: 1.8 },
      { label: 'Makan sehari-hari', amountJt: 1.5 },
      { label: 'KRL & ojol', amountJt: 0.5 },
      { label: 'Kirim ortu', amountJt: 1.0 },
      { label: 'Kuota & langganan', amountJt: 0.2 }
    ],
    punchline: 'Terus ada yang ngajak nongkrong di Senopati? Mending gue pura-pura pingsan.'
  },
  {
    incomeJt: 5.5,
    location: 'Jaksel',
    items: [
      { label: 'Kos sepetak', amountJt: 1.6 },
      { label: 'Makan warteg siang-malam', amountJt: 1.4 },
      { label: 'MRT & transport', amountJt: 0.5 },
      { label: 'Kirim adik sekolah', amountJt: 0.8 },
      { label: 'Tagihan paylater belanja', amountJt: 0.7 },
      { label: 'Kuota & pulsa', amountJt: 0.2 }
    ],
    punchline: 'Beli kopi susu 40rb berani, pas kena ongkir 9rb mikirnya 3 hari.'
  },
  {
    incomeJt: 7.0,
    location: 'Jakarta',
    items: [
      { label: 'Kos AC + parkir', amountJt: 2.0 },
      { label: 'Makan & ngopi kantor', amountJt: 1.8 },
      { label: 'Kirim ortu kampung', amountJt: 1.5 },
      { label: 'Cicilan motor', amountJt: 0.8 },
      { label: 'Transport & bensin', amountJt: 0.4 },
      { label: 'Kuota & laundry', amountJt: 0.3 }
    ],
    punchline: 'Sandwich generation: gaji cuma numpang lewat 5 menit di M-Banking.'
  },
  {
    incomeJt: 5.2,
    location: 'Jakarta Barat',
    items: [
      { label: 'Sewa kamar kos', amountJt: 1.4 },
      { label: 'Makan hemat + masak', amountJt: 1.3 },
      { label: 'Ongkos KRL & angkot', amountJt: 0.4 },
      { label: 'Kirim keluarga', amountJt: 1.0 },
      { label: 'Keperluan mandi & kos', amountJt: 0.3 },
      { label: 'Paket data', amountJt: 0.15 }
    ],
    punchline: 'Mau healing ke Bali tapi saldo tabungan cuma cukup buat beli cilok di depan gang.'
  },
  {
    incomeJt: 6.5,
    location: 'Tangerang / BSD',
    items: [
      { label: 'Sewa studio kos', amountJt: 1.9 },
      { label: 'Makan & jajan pantry', amountJt: 1.6 },
      { label: 'Bensin & tol', amountJt: 0.8 },
      { label: 'Kirim ortu', amountJt: 1.0 },
      { label: 'Cicilan HP', amountJt: 0.6 },
      { label: 'Kuota & Netflix', amountJt: 0.2 }
    ],
    punchline: 'Tiap tanggal muda ngerasa sultan, tanggal 20 udah makan mie instan dibagi dua.'
  },
  {
    incomeJt: 7.5,
    location: 'Jakarta Pusat',
    items: [
      { label: 'Kos jalan kaki ke kantor', amountJt: 2.2 },
      { label: 'Makan siang & malam', amountJt: 1.7 },
      { label: 'Kirim orang tua', amountJt: 1.5 },
      { label: 'Nabung rencana nikah', amountJt: 1.2 },
      { label: 'Gym & kuota', amountJt: 0.3 }
    ],
    punchline: 'Simulasi nikah mewah di hotel, pas liat tabungan langsung kepikiran nikah di KUA aja deh.'
  }
];

function getRandomVerifiedFinancialBudget() {
  return VERIFIED_BUDGETS[Math.floor(Math.random() * VERIFIED_BUDGETS.length)];
}

/**
 * Generate 1 Financial Breakdown ("In this economy" Reality Check)
 * Menjamin 100% akurasi matematis tanpa halusinasi angka.
 */
async function generateFinancialBreakdown(options = {}) {
  const theme = options.theme || FINANCIAL_THEMES[Math.floor(Math.random() * FINANCIAL_THEMES.length)];
  const topicTag = 'finansial';

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), kurator Threads. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Buat rincian data pengeluaran bulanan yang realistis dan relatable untuk pekerja di kota besar Indonesia.

TEMA: "${theme}"

Berikan output HANYA berupa JSON valid persis seperti ini:
{
  "incomeJt": 6.0,
  "location": "Jakarta",
  "items": [
    { "label": "Kos (listrik + air)", "amountJt": 1.8 },
    { "label": "Makan sehari-hari", "amountJt": 1.5 },
    { "label": "KRL & ojol", "amountJt": 0.5 },
    { "label": "Kirim ortu", "amountJt": 1.0 },
    { "label": "Kuota & langganan", "amountJt": 0.2 }
  ],
  "punchline": "Terus ada yang ngajak nongkrong di Senopati? Mending gue pura-pura pingsan."
}

ATURAN KETAT:
1. Total pengeluaran items HARUS lebih kecil dari incomeJt (sisakan 400rb - 1.2jt untuk sisa tabungan).
2. DILARANG menghitung sisa sendiri dalam JSON, sistem kode yang akan menghitung sisa secara eksak.
3. Punchline harus bernada sarkasme santai warganet, relatable, tanpa hashtag (#).
4. Output HANYA JSON murni tanpa markdown, tanpa teks pengantar.
`;

  let budgetData = null;
  const rawResponse = await callAiWithFallback(prompt, 0.7);

  if (rawResponse) {
    try {
      const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && typeof parsed.incomeJt === 'number' && Array.isArray(parsed.items) && parsed.items.length >= 3) {
        let validIncome = Number(Number(parsed.incomeJt).toFixed(1));
        let validItems = parsed.items.map(it => ({
          label: String(it.label || 'Kebutuhan lain').replace(/^[•\-\*]\s*/, '').trim(),
          amountJt: Number(Number(it.amountJt).toFixed(2))
        })).filter(it => it.amountJt > 0);

        const totalExpense = validItems.reduce((acc, it) => acc + it.amountJt, 0);

        if (totalExpense >= validIncome) {
          validIncome = Number((totalExpense + 0.6).toFixed(1));
        }

        budgetData = {
          incomeJt: validIncome,
          location: parsed.location || 'Jakarta',
          items: validItems,
          punchline: parsed.punchline || 'Terus ada yang ngajak nongkrong di Senopati? Mending gue pura-pura pingsan.'
        };
      }
    } catch (e) {
      console.warn('[ContentMixer] Gagal parse JSON AI financial breakdown, menggunakan budget terverifikasi:', e.message);
    }
  }

  // Jika AI gagal / parsing error, gunakan template terverifikasi 100% akurat
  if (!budgetData) {
    budgetData = getRandomVerifiedFinancialBudget();
  }

  // Bangun teks dengan kalkulasi matematika eksak via JavaScript
  const text = buildFinancialBreakdownText(budgetData);

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
