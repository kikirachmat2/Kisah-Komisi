const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Kategori Topik Nyata Berbobot (Berdasarkan Pola Viral Threads Indonesia)
const TOPICS_CORPORATE = [
  'Eksploitasi Anak Magang (Magang 3 bulan diperpanjang lagi 3 bulan, ngadep manajer minta kepastian officer vs resign)',
  'Lembur 48 Jam Seminggu Tanpa Bayaran (Manajer bilang jam kerja Senin-Sabtu sudah termasuk gaji, dibantah PP 35/2021)',
  'Trik Licik HRD Nahan Kenaikan Gaji (Dikasih tanggung jawab manajerial tapi status staf dan gaji tetap UMR)',
  'Bos Narsis & Playing Victim (Kesalahan manajer tapi tim bawah yang disuruh nanggung di depan direksi)',
  'Cuti Tahunan Ditolak Alasan Kekeluargaan (Hak cuti dihanguskan sepihak dengan dalih loyalitas perusahaan)',
  'Spill Gaji Karyawan Berujung Dikucilkan (Karyawan baru gaji lebih tinggi dari senior yang loyal 4 tahun)'
];

const TOPICS_INTIMATE_MENFESS = [
  'Kegalauan Ranjang Pasutri Muda (Istri selalu yang mulai inisiatif HB, suami anteng dan jadwalnya kayak mau ketemu menteri)',
  'Nafkah & Uang Dapur Timpang (Suami pelit jatah belanja istri tapi royal ke keluarga/teman tongkrongannya)',
  'Mertua Ikut Campur Privasi Kamar (Mertua suka masuk kamar tanpa ketuk dan mengomentari cara ngurus rumah)',
  'Pasangan Perhitungan Ekstrem (Bensin dihitung bagi dua sampai serupiah, hitung-hitungan makan di warteg)',
  'Hubungan Menggantung Bertahun-tahun (Pacaran 6 tahun menemani dari nol tapi pas ditanya nikah selalu ngeles nunggu mapan)'
];

const TOPICS_SOCIAL_DILEMMA = [
  'Tetangga Parkir Mobil Depan Pagar (Garasi dijadikan gudang, mobil parkir nutupin akses jalan warga komplek)',
  'Teman Pinjam Uang Pura-pura Amnesia (Ditagih beralasan lagi susah tapi update story liburan dan makan enak)',
  'Drama Kamar Kosan & Teman Sekamar (Bawa pacar nginep tanpa izin, kasur dipakai saat pemilik lagi lembur)',
  'Drama Token Listrik Jebol di Kontrakan (Teman sekamar nyalain AC 24 jam tapi maunya patungan listrik rata)'
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

// Filter teks manusiawi: membersihkan label bot di awal tapi menjaga tag penomoran alami di akhir (1/5)
function sanitizeText(str) {
  if (!str) return '';
  return str
    // Hapus penomoran di awal kalimat seperti [Part 1], Part 1:, Slide 1:
    .replace(/^(\[|\()?\s*(part|slide|bagian)\s*\d+\s*(\]|\))?\s*[:\-]?\s*/gi, '')
    .replace(/^\*\*[^*]+\*\*\s*[:\-]?\s*/g, '')
    // Pertahankan emoji warganet yang pasrah/relatable (🫠, 🙃, 😭, 💀) tapi bersihkan emoji spam beruntun
    .replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]){3,}/gu, '$1')
    .trim();
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
 * Generate postingan Threads viral "Orang Banget"
 * Mendukung 2 mode:
 * 1. Thread Utas Tajam 4-5 Part (Career / Labor Rights / Social Reality + Rekomendasi Solusi)
 * 2. Single Menfess Curhat 1 Part (Intimate / Marriage Reality, 100% Zero Ad, Viral Magnet)
 */
async function generateStory(forcedTopic = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY belum diset di .env');
  }

  // Tentukan apakah postingan ini Single Menfess (25%) atau Thread Utas Berbobot (75%)
  const isSingleMenfess = !forcedTopic && Math.random() < 0.25;

  let topic = forcedTopic;
  let categoryGroup = 'corporate';

  if (!topic) {
    if (isSingleMenfess) {
      categoryGroup = 'intimate';
      topic = TOPICS_INTIMATE_MENFESS[Math.floor(Math.random() * TOPICS_INTIMATE_MENFESS.length)];
    } else {
      // Prioritas adaptif dari database jika ada
      const priorityJson = db.getSetting('PRIORITY_TOPICS');
      if (priorityJson && Math.random() < 0.6) {
        try {
          const priorities = JSON.parse(priorityJson);
          if (Array.isArray(priorities) && priorities.length > 0) {
            const chosen = priorities[Math.floor(Math.random() * priorities.length)];
            const matched = TOPICS.find(t => t.toLowerCase().includes(chosen.toLowerCase()));
            if (matched) topic = matched;
          }
        } catch (e) {}
      }

      if (!topic) {
        // 60% Corporate Reality, 40% Social Dilemma
        if (Math.random() < 0.6) {
          categoryGroup = 'corporate';
          topic = TOPICS_CORPORATE[Math.floor(Math.random() * TOPICS_CORPORATE.length)];
        } else {
          categoryGroup = 'social';
          topic = TOPICS_SOCIAL_DILEMMA[Math.floor(Math.random() * TOPICS_SOCIAL_DILEMMA.length)];
        }
      }
    }
  }

  const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const currentHour = nowWIB.getHours();
  let slotTag = 'malam';
  if (currentHour < 11) slotTag = 'pagi';
  else if (currentHour < 17) slotTag = 'siang';

  // Pilih produk affiliate HANYA jika bukan Single Menfess
  const product = (!isSingleMenfess) ? db.getRandomProduct() : null;
  const themeHint = product ? getThematicVibe(product.category) : 'realitas hidup pekerja dan anak muda';

  let prompt = '';

  if (isSingleMenfess) {
    // Mode Single Menfess Curhat (Gaya Screenshot 3: @aku.siapa1616)
    prompt = `
Kamu adalah kurator menfess di Threads @ceritakikiii. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU (1) POSTINGAN CURHAT TUNGGAL (Single Post Menfess, TIDAK BERSAMBUNG, HANYA 1 SLIDE).
Panjang: 180 - 280 karakter.

TOPIK:
${topic}

STANDAR GAYA PENULISAN (PERSIS SEPERTI POSTINGAN MANUSIA ASLI VIRAL DI THREADS):
1. Format murni teks curhat polos, jujur, mengeluh tapi ada analogi kocak/sarkasme hidup.
2. Gunakan istilah asli warganet Indonesia (seperti: "HB", "bgt", "anteng-anteng aja", "ga ngajak duluan", "diatur jadwalnya kayak mau ketemu menteri 🫠", "ga habis fikri").
3. Boleh huruf kecil santai di awal kalimat, selayaknya orang mengetik curhat di HP malam hari.
4. Akhiri dengan emoji pasrah yang tepat seperti 🫠 atau analogi menggelitik yang memicu ratusan netizen ingin ikut berkomentar.
5. DILARANG KERAS menyisipkan link promosi atau produk apapun. Ini 100% curhat murni!
6. DILARANG membuat cerita fiktif sinetron (seperti peramal, hantu, atau plot sinetron).

Keluarkan HANYA JSON:
{
  "title": "Judul Menfess Singkat (Maksimal 6 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Teks curhat tunggal 180-280 karakter..."
  ]
}
`;
  } else {
    // Mode Thread Utas Berbobot 4 Part (Gaya Screenshot 1 & 2: @adabangwira & @zialaava)
    prompt = `
Kamu adalah kurator di Threads @ceritakikiii. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Tuliskan SATU UTAS THREAD PENDEK & BERBOBOT (PERSIS 4 PART).

TOPIK SPESIFIK:
${topic}
Konteks Masalah: ${themeHint}

STANDAR GAYA PENULISAN (PERSIS GAYA @adabangwira & @zialaava):
1. PART 1 (Hook Realitas / Dialog Nyata):
   - Tanpa basa-basi! Langsung sajikan dialog tajam bos vs karyawan, atau pengamatan nyata di kantor/lingkungan.
   - Contoh gaya: "Di kantor gue ada anak magang. Udah 3 bulan, diperpanjang lagi 3 bulan. Dia nolak dan minta kepastian: diangkat officer atau resign. 1/5" atau "Manajer: Jam kerja Senin sampai Sabtu, jam 8 sampai 5 ya. Karyawan: Itu 48 jam seminggu, Pak. 1/5"
   - Di ujung kalimat WAJIB tulis nomor "1/5".
2. PART 2 (Realitas / Aturan / Fakta di Balik Kejadian):
   - Bongkar fakta/aturan sebenarnya. Boleh sebut aturan riil seperti PP 35/2021 tentang batas kerja 40 jam atau logika gaji/tanggung jawab yang timpang.
   - Di ujung kalimat WAJIB tulis nomor "2/5".
3. PART 3 (Opini Kritis & Insight Tajam):
   - Penjelasan kenapa tindakan tersebut merugikan atau bagaimana pekerja harus bersikap.
   - Di ujung kalimat WAJIB tulis nomor "3/5".
4. PART 4 (Pertanyaan Dilema Penutup):
   - Pertanyaan yang memancing perdebatan di kolom reply: "Kalau kalian di posisi ini, mending speak-up atau cari aman sambil cari loker lain? 5/5"
   - Di ujung kalimat WAJIB tulis nomor "5/5".

PENTING:
- DILARANG menggunakan kata-kata AI klise seperti "tidak disangka-sangka", "pada akhirnya saya menyadari", "sangat disayangkan".
- Gunakan bahasa manusia yang cerdas, dingin, observatif, dan relatable.

Keluarkan HANYA JSON:
{
  "title": "Judul Utas Tajam (Maksimal 6-8 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Part 1 dengan dialog/kejadian nyata... 1/5",
    "Part 2 dengan aturan/fakta lapangan... 2/5",
    "Part 3 opini tajam & logika... 3/5",
    "Part 4 pertanyaan debat warganet... 5/5"
  ]
}
`;
  }

  const models = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
  let data = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.85
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

  if (!rawText) {
    throw new Error('Semua AI provider sedang sibuk. Silakan coba lagi.');
  }

  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanJson);

  const cleanParts = parsed.story_parts.map(p => sanitizeText(p));

  // Rakit slides akhir
  let finalSlides = [];
  let trackedProductUrl = null;

  if (isSingleMenfess || cleanParts.length === 1) {
    // Mode Single Menfess: Tepat 1 slide, 0% iklan
    finalSlides = [cleanParts[0]];
  } else {
    // Mode Utas Berbobot: Sisipkan produk sebagai solusi penunjang di Part 4/5 jika produk ada
    if (product && product.affiliate_url) {
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

      // Template solusi fungsional (bukan iklan basi)
      const contextualAd = `Btw buat yang sering ngalamin capek lembur atau pusing kerjaan kayak gini, gue selalu sedia ${product.name} ini di meja kantor: ${trackedProductUrl}. Beneran ngebantu biar ga gampang drop. 4/5`;

      // Susun 5 part: Part 1, Part 2, Part 3, Solusi Part 4, Debat Part 5
      finalSlides = [
        cleanParts[0],
        cleanParts[1] || cleanParts[0],
        cleanParts[2] || cleanParts[1],
        contextualAd,
        cleanParts[3] || cleanParts[2] || cleanParts[0]
      ];
    } else {
      finalSlides = cleanParts;
    }
  }

  return {
    title: sanitizeText(parsed.title),
    topic: parsed.topic || topic,
    product_name: product ? product.name : null,
    product_url: trackedProductUrl,
    slides: finalSlides,
    is_single_menfess: isSingleMenfess
  };
}

module.exports = {
  generateStory,
  appendSubId,
  getThematicVibe,
  TOPICS,
  TOPICS_CORPORATE,
  TOPICS_INTIMATE_MENFESS,
  TOPICS_SOCIAL_DILEMMA
};
