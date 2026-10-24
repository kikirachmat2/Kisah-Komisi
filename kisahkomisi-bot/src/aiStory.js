const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Kategori Topik Nyata Berbobot (Berdasarkan Pola Viral Threads Indonesia)
const TOPICS_CORPORATE = [
  'Eksploitasi Anak Magang (Magang 3 bulan diperpanjang lagi 3 bulan, ngadep manajer minta kepastian officer vs resign)',
  'Lembur 48 Jam Seminggu Tanpa Bayaran (Manajer bilang jam kerja Senin-Sabtu sudah termasuk gaji, dibantah PP 35/2021)',
  'Trik Licik HRD Nahan Kenaikan Gaji (Dikasih tanggung jawab manajerial tapi status staf dan gaji tetap UMR)',
  'Bos Narsis & Playing Victim (Kesalahan manajer tapi tim bawah yang disuruh nanggung di depan direksi)',
  'Cuti Tahunan Ditolak Alasan Kekeluargaan (Hak cuti dihanguskan sepihak dengan dalih loyalitas perusahaan)',
  'Spill Gaji Karyawan Berujung Dikucilkan (Karyawan baru gaji lebih tinggi dari senior yang loyal 4 tahun)',
  'Budaya Resign Dianggap Khianat (Karyawan loyal ajukan resign baik-baik tapi surat paklaring dipersulit HRD)',
  'Meeting di Luar Jam Kerja Tanpa Uang Lembur (Bos hobi chat WhatsApp jam 10 malam minta data dadakan buat besok pagi)',
  'Promosi Kosong Tanpa Kenaikan Gaji (Dikasih titel Lead/Supervisor baru tapi pas ditanya slip gaji katanya nunggu evaluasi tahun depan)'
];

const TOPICS_INTIMATE_MENFESS = [
  'Kegalauan Ranjang Pasutri Muda (Istri selalu yang mulai inisiatif HB, suami anteng dan jadwalnya kayak mau ketemu menteri)',
  'Nafkah & Uang Dapur Timpang (Suami pelit jatah belanja istri tapi royal ke keluarga/teman tongkrongannya)',
  'Mertua Ikut Campur Privasi Kamar (Mertua suka masuk kamar tanpa ketuk dan mengomentari cara ngurus rumah)',
  'Pasangan Perhitungan Ekstrem (Bensin dihitung bagi dua sampai serupiah, hitung-hitungan makan di warteg)',
  'Hubungan Menggantung Bertahun-tahun (Pacaran 6 tahun menemani dari nol tapi pas ditanya nikah selalu ngeles nunggu mapan)',
  'Dilema Pasangan Minim Inisiatif (Semua keputusan dari makan apa sampai rencana masa depan harus pihak perempuan yang mikir)',
  'Pasangan Selalu Playing Victim (Tiap ada konflik selalu balik nyalahin pasangan sampai merasa bersalah sendiri)'
];

const TOPICS_SOCIAL_DILEMMA = [
  'Tetangga Parkir Mobil Depan Pagar (Garasi dijadikan gudang, mobil parkir nutupin akses jalan warga komplek)',
  'Teman Pinjam Uang Pura-pura Amnesia (Ditagih beralasan lagi susah tapi update story liburan dan makan enak)',
  'Drama Kamar Kosan & Teman Sekamar (Bawa pacar nginep tanpa izin, kasur dipakai saat pemilik lagi lembur)',
  'Drama Token Listrik Jebol di Kontrakan (Teman sekamar nyalain AC 24 jam tapi maunya patungan listrik rata)',
  'Teman Tongkrongan FOMO Gaya Hidup (Nongkrong di cafe mahal tiap minggu padahal cicilan paylater numpuk)',
  'Arisan Komplek Berujung Renggang (Uang arisan macet di bendahara pas ditagih malah bawa-bawa urusan keluarga)',
  'Teman Kantor Pinjam Barang Ga Balik (Minjem charger dan earphone berminggu-minggu pas diminta balik malah sinis)'
];

const TOPICS = [
  ...TOPICS_CORPORATE,
  ...TOPICS_INTIMATE_MENFESS,
  ...TOPICS_SOCIAL_DILEMMA
];

// Menambahkan sub_id tracking ke link Shopee Affiliate secara aman dan terperinci
function appendSubId(urlStr, subIdOptions = 'threads_ceritakiki') {
  if (!urlStr) return urlStr;
  
  let params = {};
  if (typeof subIdOptions === 'string') {
    params.sub_id1 = subIdOptions;
  } else if (typeof subIdOptions === 'object' && subIdOptions !== null) {
    params = subIdOptions;
  } else {
    params.sub_id1 = 'threads_ceritakiki';
  }

  try {
    const u = new URL(urlStr);
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch (e) {
    let res = urlStr;
    for (const [k, v] of Object.entries(params)) {
      if (v) {
        const separator = res.includes('?') ? '&' : '?';
        res = `${res}${separator}${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
      }
    }
    return res;
  }
}

// Filter teks manusiawi: membersihkan label bot di awal dan penomoran pecahan duplikat di akhir (1/5)
function sanitizeText(str) {
  if (!str) return '';
  return str
    // Hapus penomoran di awal kalimat seperti [Part 1], Part 1:, Slide 1:, 1.
    .replace(/^(\[|\()?\s*(part|slide|bagian)?\s*\d+\s*(\]|\))?\s*[:\.\-]?\s*/gi, '')
    .replace(/^\*\*[^*]+\*\*\s*[:\-]?\s*/g, '')
    // Hapus penomoran pecahan di akhir atau tengah kalimat seperti 1/5, (1/5), [1/5], 2/5, 3/5
    .replace(/(\(|\s|\[)\d+\/\d+(\)|\s|\]|\.)*$/gi, '')
    .replace(/\s*\b\d+\/\d+\b\.?/gi, '')
    // Pertahankan emoji warganet yang pasrah/relatable (🫠, 🙃, 😭, 💀) tapi bersihkan emoji spam beruntun
    .replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]){3,}/gu, '$1')
    .trim();
}

/**
 * Membersihkan nama produk yang panjang / berantakan dari Shopee menjadi nama ringkas manusiawi
 */
function cleanProductName(rawName) {
  if (!rawName) return 'barang ini';
  return rawName
    .replace(/^(\[.*?\]|\(.*?\))\s*/g, '')
    .replace(/\s*-\s*(Official|Original|Garansi).*$/i, '')
    .replace(/\b(100%|Original|Termurah|Terlaris|Promo|Diskon|Gratis Ongkir|Bisa COD)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 45);
}

/**
 * Menghasilkan copy rekomendasi produk yang organik, realistis, dan relevan dengan konteks kehidupan
 * Mencegah klaim konyol seperti menaruh talenan atau tanah 10kg di meja kantor.
 */
function generateContextualAd(product, trackedUrl) {
  if (!product || !trackedUrl) return '';
  const cat = (product.category || '').toLowerCase();
  const name = cleanProductName(product.name);

  // Kategori: Botol Minum / Tumbler / Gaya Hidup
  if (cat.includes('botol') || cat.includes('tumbler') || name.toLowerCase().includes('tumbler') || name.toLowerCase().includes('termos')) {
    const templates = [
      `Btw di tengah pusingnya lembur kerja dan drama kantor, investasi receh under 50rb yang bikin gue tetep waras itu tumbler air es di meja: ${trackedUrl}. Nahan dingin seharian.`,
      `Btw buat yang seharian di ruangan AC dan gampang lemes, tumbler fungsional harga ramah kantong ini lifesaver banget nemenin ngantor: ${trackedUrl}.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Kategori: Elektronik & Gadget (Charger, Kabel, Kipas)
  if (cat.includes('elektronik') || cat.includes('gadget') || name.toLowerCase().includes('charger') || name.toLowerCase().includes('kabel') || name.toLowerCase().includes('kipas')) {
    const templates = [
      `Btw buat yang seharian mobile atau sering lembur, kepala charger fast charging under 50rb kayak gini lifesaver banget di tas kerja: ${trackedUrl}. Daripada minjem sana-sini pas sekarat.`,
      `Btw daripada pusing kabel kusut pas dikejar deadline kantor, barang printilan receh tapi fungsional ini kepake banget di meja: ${trackedUrl}. Ngecas cepet dan ga ribet.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Kategori: Skincare & Grooming / Perawatan Diri
  if (cat.includes('skincare') || cat.includes('grooming') || cat.includes('perawatan') || name.toLowerCase().includes('wash') || name.toLowerCase().includes('deodorant') || name.toLowerCase().includes('serum')) {
    const templates = [
      `Btw seharian dihajar stres kerjaan sama polusi jalanan komuter, self-care receh gak sampe seharga kopi kekinian tapi muka langsung seger lagi: ${trackedUrl}.`,
      `Btw di tengah capeknya tuntutan kerja, ngerawat diri sendiri itu bentuk self-respect paling realistis. Buat daily wash under 40rb yang ga ribet pas ngantor: ${trackedUrl}.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Kategori: Parfum & Wewangian
  if (cat.includes('parfum') || cat.includes('wewangian')) {
    const templates = [
      `Btw salah satu booster mood kerja paling ampuh pas lagi pusing itu aroma calming. Parfum daily wangi seger under 50rb yang awet buat ngantor: ${trackedUrl}.`,
      `Btw di tengah hecticnya meeting, wangi yang seger tuh ngaruh banget ke rasa percaya diri. Yang ini harganya ramah kantong tapi wanginya mewah: ${trackedUrl}.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Kategori: Camilan & Minuman
  if (cat.includes('camilan') || cat.includes('makanan') || cat.includes('teh') || cat.includes('lemon')) {
    const templates = [
      `Btw buat nemenin fokus di depan laptop atau ngusir ngantuk pas jam rawan siang di kantor, cemilan renyah under 25rb ini lumayan bikin melek: ${trackedUrl}.`,
      `Btw pas lagi mumet ngerjain revisian malam hari, asupan seger-seger harga receh kayak gini lifesaver banget di meja: ${trackedUrl}.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Kategori: Rumah Tangga & Kosan (Tissue, Gantungan, Keset, dll.)
  if (cat.includes('kosan') || cat.includes('rumah')) {
    const templates = [
      `Btw buat anak kos atau kontrakan, barang printilan fungsional under 30rb kayak gini simple tapi kepake banget biar kamar gak berantakan: ${trackedUrl}.`,
      `Btw salah satu investasi kecil under 50rb buat kenyamanan tempat istirahat setelah seharian cape kerja di luar: ${trackedUrl}.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Fallback netral & manusiawi
  return `Btw buat yang lagi cari rekomendasi barang fungsional harga ramah dompet buat nemenin rutinitas harian biar lebih praktis: ${trackedUrl}. Lumayan kepake banget.`;
}

/**
 * Memilih latar/suasana cerita yang relevan secara kontekstual dengan produk
 */
function getThematicVibe(category) {
  if (!category) return 'kehidupan kerja, kantor, kosan, atau rumah tangga';
  const cat = category.toLowerCase();
  if (cat.includes('elektronik') || cat.includes('gadget')) {
    return 'kelelahan lembur kerja, kabel kusut di meja kantor, atau baterai habis saat perjalanan pulang';
  }
  if (cat.includes('kosan') || cat.includes('rumah')) {
    return 'kamar kosan sempit, kontrakan gerah/apek, atau drama perlengkapan dengan teman sekamar';
  }
  if (cat.includes('fashion') || cat.includes('aksesoris') || cat.includes('outfit')) {
    return 'tuntutan berpakaian di kantor, kencan pertama canggung, atau rasa percaya diri saat meeting';
  }
  if (cat.includes('parfum') || cat.includes('wewangian')) {
    return 'aroma ruangan kantor, kencan pertama, atau rasa percaya diri saat bertemu orang banyak';
  }
  if (cat.includes('skincare') || cat.includes('grooming') || cat.includes('perawatan') || cat.includes('body')) {
    return 'kelelahan setelah perjalanan komuter panas terik, menjaga penampilan saat lelah kerja';
  }
  if (cat.includes('olahraga') || cat.includes('kebugaran')) {
    return 'usaha menjaga kesehatan di tengah stres kerjaan, olahraga ringan di kamar sempit';
  }
  if (cat.includes('kesehatan')) {
    return 'leher kaku dan mata lelah akibat menatap layar seharian saat lembur kantor';
  }
  return 'kehidupan sehari-hari pekerja atau pasutri muda di Indonesia';
}

/**
 * Menentukan topic_tag resmi Threads yang relevan dan terbukti aktif dipakai warganet
 */
function getAutoTopicTag(topic) {
  if (!topic) return 'curhat';
  const t = topic.toLowerCase();
  if (t.includes('kantor') || t.includes('kerja') || t.includes('gaji') || t.includes('lembur') || t.includes('bos') || t.includes('hrd') || t.includes('magang') || t.includes('resign') || t.includes('meeting')) {
    return 'duniakerja';
  }
  if (t.includes('kos') || t.includes('kontrakan') || t.includes('kamar') || t.includes('kulkas') || t.includes('token listrik')) {
    return 'anakkos';
  }
  if (t.includes('krl') || t.includes('stasiun') || t.includes('manggarai') || t.includes('gerbong') || t.includes('komuter') || t.includes('kereta')) {
    return 'krl';
  }
  if (t.includes('mertua') || t.includes('suami') || t.includes('istri') || t.includes('pasutri') || t.includes('arisan') || t.includes('tetangga') || t.includes('keluarga') || t.includes('rumah tangga')) {
    return 'rumahtangga';
  }
  if (t.includes('uang') || t.includes('pinjam') || t.includes('bensin') || t.includes('cicilan') || t.includes('finansial') || t.includes('perhitungan') || t.includes('utang')) {
    return 'finansial';
  }
  return 'curhat';
}

/**
 * Generate postingan Threads viral "Orang Banget"
 * Mendukung 2 mode:
 * 1. Single Menfess 1 Part (≤ 280 karakter total, 0% link, viral magnet)
 * 2. Micro-Thread 4-5 Part (Hook adegan konkret + Solusi Shopee Kontekstual + Pertanyaan Terbuka Warganet)
 * Otomatis melampirkan topic_tag resmi Threads (duniakerja, anakkos, krl, rumahtangga, finansial, curhat).
 */
async function generateStory(options = {}) {
  const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!apiKey && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error('Tidak ada AI API KEY (GEMINI, GROQ, atau OPENROUTER) yang diset di .env');
  }

  let forcedTopic = null;
  let variant = 'B';
  let origin = 'fiction';
  let topicTag = null;

  if (typeof options === 'string') {
    forcedTopic = options;
  } else if (typeof options === 'object' && options !== null) {
    forcedTopic = options.topic || options.forcedTopic || null;
    variant = (options.variant || 'B').toUpperCase();
    origin = options.origin || 'fiction';
    topicTag = options.topicTag || null;
  }

  let topic = forcedTopic;
  if (!topic) {
    topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  }

  if (!topicTag) {
    topicTag = getAutoTopicTag(topic);
  }

  const isFormatA = (variant === 'A');
  const withProduct = options.withProduct !== false && !isFormatA;

  let product = null;
  let trackedProductUrl = null;

  if (withProduct) {
    let relevantCategories = [];
    const tLower = (topic || '').toLowerCase();
    if (tLower.includes('kantor') || tLower.includes('kerja') || tLower.includes('gaji') || tLower.includes('lembur') || tLower.includes('bos')) {
      relevantCategories = ['Elektronik & Gadget', 'Gaya Hidup & Botol', 'Kerja & Kantor', 'Camilan & Makanan', 'Parfum & Wewangian'];
    } else if (tLower.includes('kos') || tLower.includes('kontrakan') || tLower.includes('teman') || tLower.includes('kulkas') || tLower.includes('kamar')) {
      relevantCategories = ['Rumah Tangga & Kosan', 'Gaya Hidup & Botol', 'Elektronik & Gadget', 'Perabot & Kosan'];
    } else if (tLower.includes('kencan') || tLower.includes('pacar') || tLower.includes('pasangan') || tLower.includes('suami') || tLower.includes('istri')) {
      relevantCategories = ['Parfum & Wewangian', 'Skincare & Perawatan', 'Skincare Pria', 'Fashion & Outfit'];
    } else if (tLower.includes('krl') || tLower.includes('stasiun') || tLower.includes('jalan') || tLower.includes('komuter')) {
      relevantCategories = ['Gaya Hidup & Botol', 'Elektronik & Gadget', 'Kesehatan', 'Skincare & Perawatan'];
    }

    product = db.getRandomProduct(relevantCategories);
    if (product && product.affiliate_url) {
      const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const currentHour = nowWIB.getHours();
      let slotTag = 'malam';
      if (currentHour < 11) slotTag = 'pagi';
      else if (currentHour < 17) slotTag = 'siang';

      const catSlug = (product.category || 'umum')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 15);

      trackedProductUrl = appendSubId(product.affiliate_url, {
        sub_id1: 'threads_ceritakiki',
        sub_id2: catSlug,
        sub_id3: slotTag,
        sub_id4: product.id ? `p${product.id}` : undefined
      });
    }
  }

  let prompt = '';

  if (isFormatA) {
    // FORMAT A: Single Post Curhat Ringkas + Pertanyaan Pengalaman Terbuka (≤240 karakter teks asli agar pas ≤280 chars dengan header)
    prompt = `
Kamu adalah kurator di Threads @ceritakikiii. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU (1) POSTINGAN CURHAT TUNGGAL (Single Post Menfess, TIDAK BERSAMBUNG, HANYA 1 SLIDE).
Panjang KETAT teks cerita: 140 - 190 karakter (DILARANG lebih dari 190 karakter agar pertanyaan penutup tidak terpotong saat dipasang header!).

ADEGAN/TOPIK NYATA:
${topic}

STRUKTUR DAN ATURAN WAJIB:
1. LANGSUNG KE ADEGAN SPESIFIK: Tampilkan kejadian nyata langsung dengan nama orang konkret (misal: Dimas, Rian, Rendy, Sarah, Bima). DILARANG pakai sebutan generik "si A" atau "si B".
2. AKHIRI DENGAN PERTANYAAN DILEMA 2-KUBU (THREAD WAR BAIT): Wajib ada pertanyaan penutup yang membelah audiens menjadi 2 kubu (Tim A vs Tim B) agar terpicu membalas. Contoh: "Kalau di posisi Rian, kalian tim langsung konfrontasi atau tim pendam cari aman? Kenapa?"
3. Bahasa warganet santai, ringkas, dan emosional (lu-gue/aku-kamu, "bgt", "anteng", "ngelunjak").
4. DILARANG MENULIS HEADER SEPERTI "[Cerita Fiksi]". Header akan ditempel oleh sistem kode.
5. DILARANG iklan/promosi apapun. 100% nol iklan.

Keluarkan HANYA JSON:
{
  "title": "Judul Menfess Singkat (Maksimal 6 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Teks curhat adegan konkret + pertanyaan dilema 2-kubu warganet (160-240 karakter)..."
  ]
}
`;
  } else {
    // FORMAT B: Micro-Thread Tepat 3 Part (Persis 3 slide)
    // Part 1: Hook momen menggantung (100-160 chars)
    // Part 2: Eskalasi kejadian dengan nama spesifik (150-250 chars)
    // Part 3: Pertanyaan dilema 2-kubu warganet (100-180 chars)
    prompt = `
Kamu adalah kurator di Threads @ceritakikiii. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU UTAS MICRO-THREAD TEPAT 3 PART (PERSIS 3 SLIDE).

ADEGAN/TOPIK NYATA:
${topic}

STRUKTUR 3 PART:
1. PART 1 (Hook Kejadian Menggantung):
   - Langsung ke tengah adegan yang memicu rasa penasaran dengan nama tokoh spesifik (misal: Dimas, Rian, Rendy).
   - Panjang KETAT: 100 - 160 karakter (wajib ringkas karena akan ditempel header).
2. PART 2 (Eskalasi Kejadian / Dialog Lanjutan):
   - Reaksi orang bersangkutan atau dialog lanjutan yang bikin gregetan. Gunakan nama spesifik, DILARANG "si A / si B".
   - Panjang: 150 - 250 karakter.
3. PART 3 (Pertanyaan Dilema 2-Kubu / Thread War Bait):
   - Momen perdebatan yang membelah audiens menjadi 2 kubu realistis (Tim A vs Tim B).
   - Panjang: 100 - 180 karakter. Contoh: "Kalau kalian di posisi Rendy, kalian tim 'langsung tolak chat bos jam 10 malam' atau tim 'iyain aja demi cari aman'? Coba jelasin alasan logisnya."

ATURAN KETAT:
- DILARANG MENULIS ANGKA PENOMORAN (seperti "1/3", "Part 1", dll).
- DILARANG MENULIS HEADER SEPERTI "[Cerita Fiksi]". Header akan dipasang otomatis oleh kode.
- DILARANG menyisipkan link promosi atau barang. 100% nol iklan.
- Gunakan bahasa manusia alami dan nama tokoh spesifik.

Keluarkan HANYA JSON:
{
  "title": "Judul Utas (Maksimal 6-8 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Part 1 hook menggantung (100-160 chars)...",
    "Part 2 eskalasi adegan dengan nama spesifik (150-250 chars)...",
    "Part 3 pertanyaan pengalaman terbuka warganet (100-180 chars)..."
  ]
}
`;
  }

  const models = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
  let data = null;

  if (apiKey) {
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.8
            }
          })
        });

        if (response.ok) {
          data = await response.json();
          break;
        }
        console.warn(`[AI] Model ${model} respon ${response.status}, mencoba model alternatif...`);
      } catch (e) {
        console.warn(`[AI] Gagal request model ${model}:`, e.message);
      }
    }
  }

  let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  // Fallback ke Groq LPU jika Gemini limit
  if (!rawText && process.env.GROQ_API_KEY) {
    const groqModels = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
    for (const gModel of groqModels) {
      try {
        console.log(`[AI] Menggunakan Groq LPU (${gModel}) sebagai generator cerita...`);
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: gModel,
            messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
            response_format: { type: 'json_object' },
            temperature: 0.75
          })
        });
        if (groqRes.ok) {
          const groqJson = await groqRes.json();
          rawText = groqJson.choices?.[0]?.message?.content;
          if (rawText) break;
        }
      } catch (e) {
        console.warn(`[AI] Fallback Groq ${gModel} gagal:`, e.message);
      }
    }
  }

  // Fallback ke OpenRouter (Free tier) jika Gemini dan Groq keduanya limit
  if (!rawText && process.env.OPENROUTER_API_KEY) {
    try {
      console.log('[AI] Menggunakan OpenRouter (openrouter/free) sebagai cadangan lapis ke-3 cerita...');
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format tanpa markdown.' }],
          response_format: { type: 'json_object' },
          temperature: 0.75
        })
      });
      if (orRes.ok) {
        const orJson = await orRes.json();
        rawText = orJson.choices?.[0]?.message?.content;
      }
    } catch (e) {
      console.warn('[AI] Fallback OpenRouter gagal:', e.message);
    }
  }

  if (!rawText) {
    throw new Error('Semua AI provider (Gemini, Groq, OpenRouter) sedang sibuk. Silakan coba lagi.');
  }

  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanJson);

  let cleanParts = (parsed.story_parts || []).map(p => sanitizeText(p));

  // Pastikan jumlah slide sesuai format
  if (isFormatA) {
    cleanParts = [cleanParts[0] || ''];
  } else {
    // Format B: Tepat 3 part
    if (cleanParts.length < 3) {
      cleanParts.push('Ada yang pernah ngalamin kejadian kayak gini juga? Gimana akhirnya kalian nyelesaiinnya?');
    }
    cleanParts = cleanParts.slice(0, 3);
  }

  // SEMATKAN REKOMENDASI PRODUK KONTEKSTUAL SHOPEE (Bila withProduct aktif)
  if (product && trackedProductUrl && !isFormatA) {
    const contextualAd = generateContextualAd(product, trackedProductUrl);
    // Masukkan sebelum slide pertanyaan penutup
    if (cleanParts.length >= 3) {
      cleanParts = [
        cleanParts[0],
        cleanParts[1],
        contextualAd,
        cleanParts[2]
      ];
    } else {
      cleanParts.push(contextualAd);
    }
  }

  // SEMATKAN HEADER KETAT DARI KODE (Bukan dari prompt AI)
  const header = (origin === 'submitted') ? '[Kiriman Warganet]\n\n' : '[Cerita Fiksi]\n\n';
  cleanParts[0] = header + cleanParts[0].replace(/^\[(Cerita Fiksi|Kiriman Warganet)\]\s*/i, '').trim();

  // Batasi karakter agar sesuai dengan aturan:
  // Format A: Maksimal 280 karakter total
  if (isFormatA && cleanParts[0].length > 280) {
    cleanParts[0] = cleanParts[0].substring(0, 275) + '...';
  }
  // Format B Part 1: Maksimal 200 karakter total
  if (!isFormatA && cleanParts[0].length > 200) {
    cleanParts[0] = cleanParts[0].substring(0, 195) + '...';
  }

  // Slide selanjutnya dibatasi di bawah batas Threads (480 karakter)
  cleanParts = cleanParts.map((slide, idx) => {
    const s = (slide || '').trim();
    if (s.length > 480) {
      return s.substring(0, 475) + '...';
    }
    return s;
  });

  return {
    title: sanitizeText(parsed.title),
    topic: parsed.topic || topic,
    product_name: product ? product.name : null,
    product_url: trackedProductUrl,
    slides: cleanParts,
    variant: variant,
    origin: origin,
    topicTag: topicTag,
    topic_tag: topicTag,
    is_single_menfess: isFormatA
  };
}

module.exports = {
  generateStory,
  appendSubId,
  getThematicVibe,
  getAutoTopicTag,
  TOPICS,
  TOPICS_CORPORATE,
  TOPICS_INTIMATE_MENFESS,
  TOPICS_SOCIAL_DILEMMA
};
