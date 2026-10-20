const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TOPICS = [
  'Drama Kosan & Teman Sekamar (Barang sering hilang misterius, pacar teman nginep tanpa izin, kebiasaan jorok)',
  'Kantor Toxic & Rekan Muka Dua (Ide kerjaan dicuri rekan, bos narsis manipulatif, spill gaji berujung dijauhi)',
  'Kencan Pertama Zonk & Aneh (Diajak makan mewah tapi disuruh bayar semua, tingkah laku red flag tak terduga)',
  'Mertua & Ipar Julid (Perbandingan menantu idaman, campur tangan urusan rumah tangga, drama hajatan keluarga)',
  'Teman Hutang Lebih Galak (Pura-pura miskin pas ditagih tapi liburan mewah, alasan sakit yang ketahuan bohong)',
  'Perantauan & Culture Shock (Kejadian absurd pertama kali ngekos di kota besar, tetangga komplek yang kepo)',
  'Selingkuh Ketahuan dari Hal Sepele (Ketahuan dari playlist Spotify, struk parkir minimarket, atau pantulan kaca)',
  'Kejadian Horor tapi Endingnya Kocak (Kira ada hantu di genteng ternyata maling kejepit atau ulah kucing)',
  'FOMO Gaya Hidup Teman Tongkrongan (Paksain hedon demi gengsi, cicilan paylater menumpuk demi pujian teman)',
  'Drama Jual Beli / COD Absurd (Ketemu pembeli nawar sadis, diajak barter barang aneh, drama kurir nyasar)',
  'Reuni Sekolah Ajang Pamer (Ajang adu nasib dan pamer kekayaan, sindir-sindiran teman masa SMA)',
  'Tetangga Komplek Super Kepo (CCTV berjalan di depan pagar rumah, gosip arisan yang melebar kemana-mana)',
  'Perjodohan Keluarga yang Canggung (Dijodohin sama anak teman ortu yang hobi aneh, pura-pura ga kenal)',
  'Kena Tipu Modus Konyol (Tertipu giveaway abal-abal, drama salah transfer yang bikin panik seharian)',
  'Drama Magang Mahasiswa Baru (Disuruh ngerjain tugas manajer tapi ga dianggap, insiden salah kirim email ke direksi)',
  'Friendzone Akut Menahun (Menemani dari nol sampai sukses tapi malah ditinggal pas dia udah glow-up)',
  'Insiden Transportasi Umum & Commuter Line (Drama rebutan kursi gerbong, drama ojol nyasar ke tempat seram)',
  'Pasangan Pelit Perhitungan Ekstrem (Bensin dibagi dua sampai serupiah, hitung-hitungan makan di warteg)'
];

// Menambahkan sub_id tracking ke link Shopee Affiliate secara aman
function appendSubId(urlStr, subId = 'threads_kisahkomisi') {
  if (!urlStr) return urlStr;
  try {
    const u = new URL(urlStr);
    u.searchParams.set('sub_id1', subId);
    return u.toString();
  } catch (e) {
    const separator = urlStr.includes('?') ? '&' : '?';
    return `${urlStr}${separator}sub_id1=${encodeURIComponent(subId)}`;
  }
}

// Filter untuk membersihkan penomoran pecahan dan emotikon jika AI masih menyelipkannya
function sanitizeText(str) {
  if (!str) return '';
  return str
    // Hapus penomoran seperti [1/8], (1/8), 1/8, [Part 1], Part 1:, Slide 1:, dll di awal kalimat
    .replace(/^(\[|\()?\s*(part|slide|bagian)?\s*\d+\s*[\/\-]\s*\d+\s*(\]|\))?\s*[:\-]?\s*/gi, '')
    .replace(/^(\[|\()?\s*(part|slide|bagian)\s*\d+\s*(\]|\))?\s*[:\-]?\s*/gi, '')
    // Hapus format markdown bold berlebih di awal jika ada (seperti **Part 1**)
    .replace(/^\*\*[^*]+\*\*\s*[:\-]?\s*/g, '')
    // Hapus emoji Unicode agar murni teks curhat netizen
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .trim();
}

/**
 * Memilih latar/suasana cerita yang relevan secara kontekstual dengan produk
 */
function getThematicVibe(category) {
  if (!category) return 'kehidupan perantauan, kampus, kosan, atau kantor anak muda';
  const cat = category.toLowerCase();
  if (cat.includes('elektronik') || cat.includes('gadget')) {
    return 'aktivitas lembur kerja, perjalanan commuter line, dengerin musik malam hari, atau insiden HP baterai habis';
  }
  if (cat.includes('kosan') || cat.includes('rumah')) {
    return 'kehidupan kamar kosan, suasana kamar kontrakan yang sempit, begadang tugas, atau drama barang sekamar';
  }
  if (cat.includes('fashion') || cat.includes('aksesoris')) {
    return 'nongkrong santai bareng temen, outfit pas jalan bareng gebetan, jalan sore, atau insiden salah kostum';
  }
  if (cat.includes('skincare') || cat.includes('body')) {
    return 'persiapan kencan pertama, panas-panasan di jalanan kota, acara hajatan keluarga, atau insecure penampilan';
  }
  return 'kehidupan sehari-hari, kampus, kantor, atau pertemanan anak muda';
}

const TONES = [
  'Drama Emosional & Menyesakkan Dada (bikin pembaca gregetan dan simpati)',
  'Kocak, Absurd, & Bikin Geleng-geleng Kepala (humor khas tongkrongan Indonesia)',
  'Tegang Penuh Kecurigaan & Plot Twist Tak Terduga (bikin penasaran per slide)',
  'Sarkasme Halus & Realitas Sosial (menyindir kelakuan orang jorok/pelit/narsis)'
];

const PERSPECTIVES = [
  'POV Orang Pertama ("aku/gw") sebagai korban langsung kejadian',
  'POV Orang Pertama ("gw") sebagai saksi mata yang menyaksikan drama teman/tetangga',
  'POV Orang Pertama ("aku") yang awalnya ga sengaja ikut terseret masalah orang lain'
];

/**
 * Generate serial thread cerita viral gaya Threads Indonesia (murni cerita seru)
 * Tanpa emotikon berlebihan, mengalir murni selayaknya ketikan curhat orang biasa.
 */
async function generateStory(forcedTopic = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY belum diset di .env');
  }

  // Pilih produk affiliate aktif terlebih dahulu agar suasana cerita bisa diselaraskan
  const product = db.getRandomProduct();
  const themeHint = product ? getThematicVibe(product.category) : 'kehidupan sehari-hari anak muda';

  // Pilih topik (Adaptasi Cerdas: 60% prioritaskan topik dengan performa tertinggi dari AI Strategist)
  let topic = forcedTopic;
  if (!topic) {
    const priorityJson = db.getSetting('PRIORITY_TOPICS');
    if (priorityJson && Math.random() < 0.6) {
      try {
        const priorities = JSON.parse(priorityJson);
        if (Array.isArray(priorities) && priorities.length > 0) {
          const chosenPriority = priorities[Math.floor(Math.random() * priorities.length)];
          const matched = TOPICS.find(t => t.toLowerCase().includes(chosenPriority.toLowerCase()));
          topic = matched || chosenPriority;
        }
      } catch (e) {}
    }
    if (!topic) {
      topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    }
  }

  const tone = TONES[Math.floor(Math.random() * TONES.length)];
  const perspective = PERSPECTIVES[Math.floor(Math.random() * PERSPECTIVES.length)];

  const prompt = `
Kamu adalah jurnalis naratif & kreator konten anonim nomor 1 di Threads Indonesia (sekelas akun viral @nobondandrise).
Tulislah SATU KISAH NYATA / CURHATAN MENFESS yang sangat mencengkeram, manusiawi, mengaduk emosi, dan mustahil dilewati tanpa dibaca sampai tuntas.

TOPIK SPESIFIK:
${topic}

LATAR / NUANSA KEHIDUPAN:
Relate erat dengan ${themeHint}.

GAYA TONE & PERSPEKTIF:
- Nuansa Cerita: ${tone}
- Sudut Pandang: ${perspective}

STANDAR JURNALISME NARATIF & BAHASA MANUSIA (SANGAT KETAT):
1. KAIDAH HOOK "IN MEDIA RES" (Part 1):
   - Detik pertama WAJIB langsung menabrak klimaks / momen paling memalukan / pengakuan mengejutkan dalam 10 kata pertama.
   - Contoh hook jurnalistik: "Udah 3 tahun gue nyimpen rahasia kotor bos gue, tapi kemarin malam semua meledak di depan istrinya.", "Ternyata firasat aneh gue bener pas nemu struk hotel di kantong jaket temen sekamar gue."
   - DILARANG KERAS pembuka basi: "Halo guys", "Kenalin nama gue", "Jadi gini ceritanya", "Mau numpang curhat". Langsung hantam ke inti kejadian!
2. PRINSIP "SHOW, DON'T TELL" (Gunakan Detail Sensorik & Nyata):
   - JANGAN tulis "Temen sekamar gue pelit banget".
   - TULIS detail nyatanya: "Dia nagih uang bensin 3.500 perak lewat QRIS dan mi instan gue di lemari ditandain spidol satu-satu biar ga dimakan."
   - Gunakan nama samaran orang Indonesia (Rian, Cici, Mas Bayu, Mbak Tyas, Pak RT).
3. HILANGKAN 100% "BAU ROBOT / KLISE AI":
   - DILARANG menggunakan kata-kata terjemahan AI kaku seperti: "tidak disangka-sangka", "pada akhirnya saya menyadari", "peristiwa tersebut", "merupakan hal yang", "sangat disayangkan", "pelajaran hidup yang berharga".
   - TULIS DENGAN KETIKAN MANUSIAWI ASLI: Gunakan gaya ngobrol tongkrongan (lu-gue/aku-kamu, kesel, speechless, zonk, gak habis fikri, nyesek, elus dada, red flag, gemeteran).
   - JANGAN PAKAI EMOTIKON APAPUN! 100% teks murni natural.
   - JANGAN TULIS PENOMORAN SEPERTI "[1/6]" atau "Part 1:".
4. INTEGRASI AFFILIATE BERSIH:
   - JANGAN sebut nama produk atau jualan di dalam alur cerita. Karakter murni bercerita tentang kehidupannya.
5. POLARISASI KOMENTAR (Part 6):
   - Algoritma Threads menyukai diskusi panas. Akhiri part 6 dengan DILEMA MORAL 2 KUBU yang memaksa netizen terpecah dan berdebat di kolom reply (contoh: "Menurut kalian gue yang terlalu baperan, atau tindakan dia emang udah kelewat batas?", "Kalau kalian di posisi gue, mending diem demi jaga hubungan kerja, apa labrak langsung di depan umum?").

PANJANG TIAP PART:
- Masing-masing part terdiri dari 250 - 360 karakter.
- WAJIB diakhiri tanda titik (.) atau tanda tanya (?). Jangan menggantung di tengah kalimat.

Format output WAJIB HANYA berupa JSON murni tanpa markdown:
{
  "title": "Judul Menfess Tajam & Provokatif (Maksimal 6-8 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Part 1: Hook In Media Res mengejutkan...",
    "Part 2: Kronologi awal kenapa hal itu bisa terjadi...",
    "Part 3: Tanda-tanda aneh / kecurigaan makin memuncak...",
    "Part 4: Puncak konfrontasi / insiden paling syok...",
    "Part 5: Situasi pasca kejadian & akibatnya...",
    "Part 6: Resolusi + Pertanyaan Polarisasi Debat Netizen..."
  ]
}
`;

  const models = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
  let data = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.95
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

  // Fallback ke Groq LPU jika semua model Gemini sedang 429/500/timeout
  if (!rawText && process.env.GROQ_API_KEY) {
    const groqModels = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
    for (const gModel of groqModels) {
      try {
        console.log(`[AI] Menggunakan Groq LPU (${gModel}) sebagai fallback generator cerita...`);
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
            temperature: 0.8
          })
        });
        if (groqRes.ok) {
          const groqJson = await groqRes.json();
          rawText = groqJson.choices?.[0]?.message?.content;
          if (rawText) break;
        } else {
          const errText = await groqRes.text();
          console.warn(`[AI] Groq ${gModel} respon HTTP ${groqRes.status}:`, errText);
        }
      } catch (e) {
        console.warn(`[AI] Fallback Groq ${gModel} gagal:`, e.message);
      }
    }
  }

  // Fallback ke OpenRouter jika Groq juga sibuk
  if (!rawText && process.env.OPENROUTER_API_KEY) {
    try {
      console.log('[AI] Menggunakan OpenRouter sebagai fallback generator cerita...');
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: 'nvidia/nemotron-3.5-lightning:free',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
          temperature: 0.9
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

  const cleanParts = parsed.story_parts.map(p => sanitizeText(p));

  // Sisipkan iklan intermezzo natural di tengah thread (setelah Part 3) HANYA jika ada produk
  const fullThreadParts = [
    cleanParts[0],
    cleanParts[1],
    cleanParts[2]
  ];

  let trackedProductUrl = null;
  if (product && product.affiliate_url) {
    trackedProductUrl = appendSubId(product.affiliate_url, 'threads_kisahkomisi');
    const adIntermezzo = `Btw selingan bentar ya, kemarin banyak yang nanya rekomendasi ${product.name} belinya di mana, aku belinya di toko ini mumpung lagi diskon:\n${trackedProductUrl}\n\nLanjut ceritanya ke bawah...`;
    fullThreadParts.push(adIntermezzo);
  }

  // Penutup murni cerita dan pancingan debat tanpa watermark bot yang merusak ilusi
  const finalEnding = cleanParts[5];

  fullThreadParts.push(cleanParts[3], cleanParts[4], finalEnding);

  return {
    title: sanitizeText(parsed.title),
    topic: parsed.topic,
    product_name: product ? product.name : null,
    product_url: trackedProductUrl,
    slides: fullThreadParts
  };
}

module.exports = {
  generateStory,
  appendSubId,
  getThematicVibe,
  TOPICS
};
