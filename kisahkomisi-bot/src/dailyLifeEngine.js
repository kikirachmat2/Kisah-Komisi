const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { scanThreadsViralTrends } = require('./socialRadar');
const { generateContextualAd, appendSubId, getAutoTopicTag } = require('./aiStory');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Mendapatkan konteks waktu, tanggal, siklus gajian, dan kalender hari ini (WIB)
 */
function getCurrentLifeContext() {
  const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const dayIndex = nowWIB.getDay(); // 0: Minggu, 1: Senin, ..., 6: Sabtu
  const dateNum = nowWIB.getDate();
  const monthNum = nowWIB.getMonth() + 1; // 1 - 12
  const hour = nowWIB.getHours();

  const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthsIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const dayName = daysIndo[dayIndex];
  const monthName = monthsIndo[monthNum];
  const dateFormatted = `${dayName}, ${dateNum} ${monthName}`;

  // 1. Siklus Dompet & Finansial
  let payrollPhase = '';
  let payrollVibe = '';
  if (dateNum >= 25 && dateNum <= 28) {
    payrollPhase = 'Musim Gajian (Fresh Payroll)';
    payrollVibe = 'baru kelar gajian, saldo m-banking masih utuh, wishlist shopee dicheckout, bayar kosan dan transfer ortu';
  } else if (dateNum >= 29 || dateNum <= 4) {
    payrollPhase = 'Awal Bulan';
    payrollVibe = 'awal bulan masih ada sisa nafas, tapi udah mulai overthinking mikirin sisa alokasi sampai tanggal 25 berikutnya';
  } else if (dateNum >= 5 && dateNum <= 14) {
    payrollPhase = 'Minggu Kedua (Fase Stabil)';
    payrollVibe = 'rutinitas kerja normal, godaan nongkrong cafe masih ada tapi udah mulai rem-rem tipis';
  } else if (dateNum >= 15 && dateNum <= 20) {
    payrollPhase = 'Pertengahan Bulan (Warning Menuju Tanggal Tua)';
    payrollVibe = 'pertengahan bulan, makan siang mulai downgrade ke warteg, nolak ajakan nongkrong mahal';
  } else {
    payrollPhase = 'Puncak Tanggal Tua (Survival Mode)';
    payrollVibe = 'krisis akhir bulan, saldo darurat recehan, ngitung hari menuju tanggal 25, makan apa adanya';
  }

  // 2. Vibe Hari
  let dayVibe = '';
  if (dayIndex === 1) {
    dayVibe = 'Senin pagi: Hate Monday, KRL Sudirman/Manggarai rusuh dan padet, meeting evaluasi jam 9 pagi, nyawa belum kekumpul';
  } else if (dayIndex === 2 || dayIndex === 3) {
    dayVibe = 'Selasa-Rabu: Beban kerjaan kantor lagi di puncak, deadline agensi/tech, lembur tipis-tipis';
  } else if (dayIndex === 4) {
    dayVibe = 'Kamis: Menjelang weekend, energi kerja sisa 40%, mulai ada wacana nongkrong jumat malam';
  } else if (dayIndex === 5) {
    dayVibe = 'Jumat (TGIF): Pulang tenggo jam 5 sore, wacana nongkrong malam sabtu atau langsung cabut tidur';
  } else {
    dayVibe = 'Weekend anak kos: Cuci baju numpuk, fomo liat orang lari di GBK atau padel, rebahan seharian atau pacaran hemat';
  }

  // 3. Kalender Hari Besar Nasional (Contoh tanggal penting)
  let nationalEvent = null;
  if (monthNum === 10 && dateNum === 28) nationalEvent = 'Hari Sumpah Pemuda';
  else if (monthNum === 11 && dateNum === 10) nationalEvent = 'Hari Pahlawan';
  else if (monthNum === 12 && dateNum === 25) nationalEvent = 'Hari Natal / Menjelang Libur Akhir Tahun';
  else if (monthNum === 1 && dateNum === 1) nationalEvent = 'Tahun Baru';
  else if (monthNum === 8 && dateNum === 17) nationalEvent = 'HUT Kemerdekaan RI';

  return {
    dateFormatted,
    dayName,
    dateNum,
    monthNum,
    hour,
    payrollPhase,
    payrollVibe,
    dayVibe,
    nationalEvent
  };
}

/**
 * Mencari kandidat postingan lama yang viral (views >= 500) untuk dijadikan bahan CALLBACK / Follow-Up
 */
function getViralCallbackCandidate() {
  try {
    const candidates = db.db.prepare(`
      SELECT s.id, s.title, s.topic, s.slides_json, s.published_at, si.views, si.likes, si.replies
      FROM stories s
      JOIN story_insights si ON s.id = si.story_id
      WHERE s.status = 'published' AND si.views >= 500
      ORDER BY s.published_at DESC
      LIMIT 8
    `).all();

    if (candidates.length === 0) return null;

    // Filter yang belum pernah dijadikan callback dalam 7 hari terakhir
    for (const cand of candidates) {
      const isCallbacked = db.getSetting(`CALLBACK_USED_${cand.id}`);
      if (!isCallbacked) {
        let firstSlide = '';
        try {
          const parsed = JSON.parse(cand.slides_json);
          firstSlide = Array.isArray(parsed) ? parsed[0] : '';
        } catch (e) {
          firstSlide = cand.title;
        }

        return {
          storyId: cand.id,
          title: cand.title,
          topic: cand.topic,
          firstSlide,
          views: cand.views
        };
      }
    }

    return null;
  } catch (err) {
    console.warn('[LifeEngine] Gagal mencari kandidat callback:', err.message);
    return null;
  }
}

/**
 * Menghasilkan 50% Single Post Life Update Kiki (1 Slide, 0% Iklan, Pure Engagement & Relatable)
 * Mampu mengambil sudut pandang:
 * 1. Callback postingan viral masa lalu
 * 2. Isu berita/politik/demo/kebijakan hari ini
 * 3. Update real-time siklus hidup (KRL, kantor, tanggal tua, dll.)
 */
async function generateDailyLifeUpdate(options = {}) {
  const context = getCurrentLifeContext();
  let callbackCandidate = null;
  
  // 35% peluang melakukan callback jika ada postingan viral sebelumnya
  if (Math.random() < 0.35) {
    callbackCandidate = getViralCallbackCandidate();
  }

  // Ambil tren berita terkini (termasuk politik, demo, isu nasional)
  let liveTrends = [];
  try {
    liveTrends = await scanThreadsViralTrends(false);
  } catch (e) {}

  const trendHeadline = liveTrends.length > 0 ? liveTrends[0] : null;

  let mode = 'DAILY_LIFE';
  let guidance = '';

  if (callbackCandidate) {
    mode = 'VIRAL_CALLBACK';
    guidance = `
MODE: CALLBACK POSTINGAN LAMA YANG VIRAL (UPDATE ORGANIK)
Kamu beberapa hari lalu mengunggah postingan ini dan tembus ${callbackCandidate.views} views di Threads:
"""
${callbackCandidate.firstSlide}
"""

TUGAS KAMU:
Buat SATU postingan single update baru yang merupakan RESPON / PERKEMBANGAN / KELANJUTAN LANGSUNG dari apa yang kamu ceritakan di atas.

ATURAN WAJIB CALLBACK:
1. Respon WAJIB 100% nyambung dengan topik spesifik postingan di atas (jika kemarin bahas kosan, bahas update kosan; jika kemarin bahas bos/lembur, bahas kelanjutan kantor; jika kemarin bahas sisa gaji, bahas situasi pengeluaran baru).
2. DILARANG MENYALIN TEKS POSTINGAN LAMA. Ini adalah reaksi/curhat baru di hari ini terhadap situasi tersebut.
3. Gunakan nada spontan warganet (misal: "update soal...", "kemarin baru aja ngeluh...", "plot twist kejadian kemarin...", "masih kepikiran...", "heeeeh...").
4. DILARANG menggunakan template kaku. Buat seakan-akan kamu manusia nyata yang mengabarkan update hidupnya ke followers.
`;
  } else if (trendHeadline && Math.random() < 0.5) {
    mode = 'CURRENT_NEWS_REACTION';
    guidance = `
MODE: RESPON BERITA / ISU VIRAL / POLITIK / DEMO HARI INI
Ada isu hangat yang lagi ramai di Indonesia hari ini:
"${trendHeadline.title} - ${trendHeadline.topic}"

TUGAS KAMU: Buat SATU postingan tanggapan santai, ceplas-ceplos, dan empatik dari sudut pandang Kiki anak muda korporat Jaksel yang terdampak macet / kehidupan kota.
Bukan buzzer politik kaku, tapi anak muda sipil yang relate!
Contoh saat ada demo/isu politik: tanggapi dengan santai, support mahasiswa/aspirasi warga, ingatkan stay safe di jalanan macet. DILARANG menyalin kata per kata dari contoh.
`;
  } else {
    mode = 'TEMPORAL_LIFE_UPDATE';
    guidance = `
MODE: REALITA HIDUP HARI INI (${context.dateFormatted})
Konteks Hari Ini:
- Hari & Suasana: ${context.dayVibe}
- Siklus Dompet: ${context.payrollPhase} (${context.payrollVibe})
${context.nationalEvent ? `- Hari Besar: ${context.nationalEvent}` : ''}

TUGAS KAMU: Tuliskan SATU curhatan / celetukan singkat (1 slide) tentang kejadian nyata yang lagi kamu rasakan detik ini di Jakarta (KRL, kantor, kosan, dompet).
`;
  }

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pemilik akun Threads. Panggilan akrab: Kiki / "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Kiki, anak rantau di Jakarta (usia 25-27 thn, kerja di industri media yang serba cepat & lembur mulu, kos di Jakpus, pejuang sandwich generation). Karakter: EXTROVERT MENTOK, social butterfly, ceplas-ceplos, solutif, punya aktivitas banyak & random (commute KRL/ojol, warkop, futsal/gym, kulineran). Temennya bejibun dari zaman sekolah SD-SMA, kuliah dulu, sampe rekan kerja media dan tongkrongan.
Hari ini adalah: ${context.dateFormatted}.

${guidance}

ATURAN KETAT:
1. HANYA SATU (1) SLIDE POSTINGAN TUNGGAL (Single Post, BUKAN THREAD BERSAMBUNG).
2. Panjang teks: 120 - 240 karakter.
3. Gaya bahasa warganet anak muda korporat Jaksel (lu-gue, bgt, wkwk, haha, boncos, burnout, anjir). Huruf kecil santai layaknya ngetik cepat di HP pas jam kantor.
4. DILARANG MENULIS LABEL APAPUN (Dilarang "[Cerita Fiksi]", "[Fiksi]", dll).
5. DILARANG IKLAN/AFFILIATE APAPUN (100% Organik Murni).
6. DILARANG MENJIPLAK TEKS CONTOH! Tulis kalimat orisinal baru yang segar.

Keluarkan HANYA JSON:
{
  "title": "Judul Singkat Update (Maksimal 6 kata)",
  "topic": "Ringkasan Topik",
  "slide_text": "Teks postingan tunggal 120-240 karakter..."
}
`;

  let rawText = null;
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.85 }
        })
      });
      if (res.ok) {
        const d = await res.json();
        rawText = d.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } catch (e) {
      console.warn('[LifeEngine] Gemini error:', e.message);
    }
  }

  if (!rawText && GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
          response_format: { type: 'json_object' },
          temperature: 0.8
        })
      });
      if (res.ok) {
        const d = await res.json();
        rawText = d.choices?.[0]?.message?.content;
      }
    } catch (e) {
      console.warn('[LifeEngine] Groq error:', e.message);
    }
  }

  let parsed = null;
  if (rawText) {
    try {
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {}
  }

  let slideText = parsed?.slide_text;
  if (!slideText) {
    if (callbackCandidate) {
      const cleanTopic = (callbackCandidate.topic || callbackCandidate.title || 'kejadian')
        .replace(/\(.*?\)/g, '')
        .trim()
        .toLowerCase();
      slideText = `update soal ${cleanTopic} kemarin: ternyata kelanjutannya makin bikin geleng-geleng kepala wkwk. in this economy emang hidup di jakarta serba plot twist.`;
    } else {
      slideText = `in this economy energi buat kerja hari ini sisa tipis bgt. baru nyampe meja kantor udah pengen langsung logout laptop wkwk.`;
    }
  }

  // Tandai callback telah digunakan jika ada
  if (callbackCandidate) {
    db.setSetting(`CALLBACK_USED_${callbackCandidate.storyId}`, new Date().toISOString());
  }

  const topicTag = getAutoTopicTag(parsed?.topic || slideText);

  return {
    title: parsed?.title || 'Life Update Kiki',
    topic: parsed?.topic || 'Update Harian',
    slides: [slideText.trim()],
    product_name: null,
    product_url: null,
    variant: 'A',
    origin: 'kiki_life',
    format_type: 'single_life_update',
    topicTag: topicTag,
    topic_tag: topicTag,
    is_single_menfess: true
  };
}

/**
 * Menghasilkan 50% Cerita Panjang / DM Anonim (Add to thread, 3-4 Slide bersambung + Affiliate di ujung)
 * Framing: "hari ini ada dm cerita anonim nih jadi ada yang cerita bla bla bla..."
 */
/**
 * Menghasilkan 50% Cerita Panjang / Curhat Relatable (Add to thread, 3-4 Slide bersambung + Affiliate di ujung)
 * Rotasi Acak 3 Sudut Pandang Cerita:
 * 1. PRIBADI: Pengalaman langsung Kiki ("masih gak habis pikir tadi siang...", "tadi pagi gue ngalamin zonk...")
 * 2. TEMAN: Cerita rekan kantor / tongkrongan ("tadi pas makan siang temen gue cerita...", "kemarin denger curhatan temen...")
 * 3. ANONIM: Curhatan warganet / DM ("ada yang curhat di dm...", "denger dari obrolan sana-sini...")
 */
async function generateAnonymousCurhatStory(options = {}) {
  const context = getCurrentLifeContext();

  const curatedScenarios = [
    // 1. Temen Kantor / Dunia Kerja
    'Senior kantor lempar kesalahan revisi ke junior baru di depan klien pas meeting pitching direksi',
    'Teman satu tim yang hobi lempar revisian pas jam 5 sore alasan buru-buru ada urusan keluarga',
    'Manajer yang nolak pengajuan cuti tahunan dengan alasan tim lagi sibuk padahal dia sendiri liburan 2 minggu',
    'Teman kantor pinjam laptop kerja buat download film taunya kena virus ransomware dan nolak ganti rugi',
    'Rekan kerja yang suka cari muka ke bos pas meeting tapi pas kerja lapangan numpang nama doang',
    'Atasan yang suka chat urusan kerjaan jam 10 malam tapi pas lembur gak pernah mau bayar uang lembur',

    // 2. Temen Zaman Kuliah Dulu / Skripsi / Kosan Lama
    'Temen satu bimbingan skripsi jaman kuliah yang numpang nyontek bab 4 tapi malah lulus duluan dan gak ngucapin makasih',
    'Temen satu kosan jaman kuliah yang barangnya numpuk berantakan tapi pas pindahan ninggalin sampah sekamar',
    'Temen sekelompok KKN / magang kuliah yang kerjanya cuma tidur tapi pas laporan akhir namanya minta paling atas',
    'Mantan gebetan jaman kuliah yang dulu ngilang tanpa kabar tiba-tiba nge-chat nawarin asuransi unit link',

    // 3. Temen Sekolah (SD, SMP, SMA, Reuni)
    'Temen sekelas jaman SMA yang dulu gak pernah nyapa tiba-tiba nge-chat manis cuma buat nagih kado nikahan',
    'Temen nongkrong jaman SMP yang pas diajak reuni sok asik flexing mobil rental padahal bensin minta patungan',
    'Temen sebangku jaman sekolah yang dulu pinjam jaket favorit sampe bertahun-tahun gak dibalikin dan pura-pura lupa',

    // 4. Temen Main / Nongkrong Warkop / Futsal / Hobi Random
    'Temen tongkrongan warkop yang hobi pesen rokok eceran sama mie dobel tapi pas giliran bayar pura-pura ke toilet',
    'Temen main futsal / badminton yang gayanya paling heboh beli raket 3 juta tapi pas bayar sewa lapangan ngilang',
    'Temen sehobi lari / CFD yang FOMO beli jersey mahal cuma buat foto IG story 15 menit terus ngeluh haus',

    // 5. Kehidupan Kosan & Realita Urban
    'Pasutri muda di kosan diribetin mertua yang tiba-tiba dateng tanpa kabar dan ngobrak-abrik isi lemari pakaian',
    'Teman sekamar kosan hobi bawa pacar nginep pas hari kerja dan makai barang printilan orang tanpa izin',
    'Tetangga kosan yang nyetel musik jedag-jedug kencang jam 12 malam pas besoknya ada ujian atau presentasi',
    'Diajak makan di restoran mewah sama temen lama taunya pas giliran bayar dia pura-pura dompet ketinggalan',
    'Dilema split bill pacaran di Jakarta: cowok selalu nanggung tapi cewek gak pernah inisiatif bayar parkir atau minum'
  ];

  const scenario = curatedScenarios[Math.floor(Math.random() * curatedScenarios.length)];

  const STORY_ANGLES = [
    {
      type: 'personal',
      name: 'CERITA PENGALAMAN PRIBADI KIKI (SUDUT PANDANG ORANG PERTAMA)',
      guidance: 'Kiki menceritakan kejadian nyata/nyesek/lucu/zonk yang dialami dirinya sendiri ("gue ngalamin sendiri", "asli gue baru aja...") sebagai anak muda extrovert mentok yang aktif di Jakarta.',
      hookInstruction: 'Gunakan sudut pandang orang pertama ("gue"). Mulai dengan kalimat spontan pengalaman diri sendiri (contoh: "masih gak habis pikir sama kejadian tadi siang di kantor...", "tadi pagi gue baru aja ngalamin hal paling zonk...", "pelajaran hidup hari ini: jangan pernah...", "asli gue baru aja kena apes pas...", "gue kira drama kayak gini cuma mitos..."). DILARANG sebut kata DM atau anonim.',
      credit: null,
      origin: 'kiki_personal'
    },
    {
      type: 'friend',
      name: 'CERITA TEMAN KIKI (KIKI NYERITAIN TEMANNYA DARI BERBAGAI SIRKEL)',
      guidance: 'Kiki adalah anak yang EXTROVERT MENTOK dan circle pertemanannya bejibun luas: ada temen kantor sekarang, temen zaman kuliah dulu (skripsi/kosan), temen sekolah dari SD sampe SMA, temen nongkrong warkop, temen main futsal/gym, atau temen hobi random. Kiki memposisikan diri sebagai pencerita yang ikut kaget/gregetan/ngakak sama kelakuan temannya.',
      hookInstruction: 'Kiki menceritakan temannya dari berbagai sirkel hidupnya. Variasikan sirkel temennya (contoh: "kemarin pas reunian temen SMA gue cerita...", "tadi pas makan siang di kantin, temen kantor gue curhat...", "temen kuliah gue dulu semalem ngabarin...", "temen nongkrong warkop gue kemarin ngomel-ngomel...", "ada temen sekelas gue jaman sekolah dulu yang nasibnya...", "temen main futsal gue kemarin cerita apes bgt..."). DILARANG sebut kata DM atau anonim.',
      credit: null,
      origin: 'friend_circle'
    },
    {
      type: 'anonymous',
      name: 'CURHATAN ANONIM WARGANET / OBROLAN WARGANET',
      guidance: 'Kiki membagikan curhatan anonim yang masuk dari followers / warganet yang relate. WAJIB: JANGAN sebut nama asli orang jika menceritakan karakter di dalamnya! Selalu gunakan sebutan samaran seperti "si fulan", "sebut aja si fulan", atau "si A".',
      hookInstruction: 'Mulai dengan variasi pembuka kurasi warganet (contoh: "ada yang curhat di dm, sebut aja si fulan...", "kemarin sempet baca curhatan seseorang yang relate bgt...", "denger dari obrolan sana-sini, ada yang cerita...", "kemarin ada yang spill kejadian di divisinya..."). DILARANG kaku selalu pakai kata yang sama.',
      credit: '(cerita anonim dari obrolan warganet)',
      origin: 'community_dm'
    }
  ];

  const storyAngle = options.angle ? (STORY_ANGLES.find(a => a.type === options.angle) || STORY_ANGLES[0]) : STORY_ANGLES[Math.floor(Math.random() * STORY_ANGLES.length)];

  // Dapatkan produk kontekstual Shopee
  const product = db.getRandomProduct();
  let trackedUrl = null;
  let adCopy = '';
  if (product && product.affiliate_url) {
    trackedUrl = appendSubId(product.affiliate_url, {
      sub_id1: 'threads_ceritakiki',
      sub_id2: storyAngle.type,
      sub_id3: 'thread'
    });
    adCopy = generateContextualAd(product, trackedUrl);
  }

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pemilik akun Threads. Panggilan akrab: Kiki / "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Kiki, anak rantau di Jakarta (usia 25-27 thn, kerja di industri media yang serba cepat & lembur mulu, kos di Jakpus, pejuang sandwich generation). Karakter: EXTROVERT MENTOK, social butterfly, ceplas-ceplos, punya aktivitas banyak & random. Temennya bejibun dari zaman sekolah SD-SMA, kuliah dulu, sampe rekan kantor media dan tongkrongan. Temen-temen sering manggil dia "Ki".

TUGAS KAMU: Tuliskan SATU UTAS THREAD BERSAMBUNG ("Add to thread") SEBANYAK 3 PART/SLIDE.

SUDUT PANDANG (ANGLE): ${storyAngle.name}
${storyAngle.guidance}

SKENARIO INTI:
"${scenario}"

STRUKTUR WAJIB:
- SLIDE 1 (Opening Hook Menarik):
  Gaya Pembuka: ${storyAngle.hookInstruction}
  Panjang: 140 - 220 karakter.
- SLIDE 2 (Eskalasi Kejadian / Percakapan Nyata & Solutif):
  Ceritakan kelanjutan kronologi atau dialog nyata yang bikin gregetan/relate sesama pejuang hidup. Kiki bisa bertindak sebagai pendengar solutif atau ikut ngitung bareng.
  Contoh gaya natural: pas gue bantu itung, cicilan + bensin + servis tuh hampir 2 juta sebulan. sedangkan dia sekarang cuma abis 600rb buat krl & jalan kaki. dia malah jawab "tapi gue gak bakal bau matahari & mental gue aman gak desek-desekan ki."
  Panjang: 160 - 260 karakter.
- SLIDE TERAKHIR (Dilema Warganet / Pembelah Kubu):
  Pertanyaan terbuka yang membelah audiens menjadi 2 kubu yang kontras (Tim A vs Tim B).
  Formula emas Kiki: "jujur bingung, mending [opsi hemat tapi jompo/tersiksa] atau mending [opsi boncos dikit tapi mental aman/waras]? kalian tim hemat atau tim waras? spill!"
  Contoh lain: "kalian di posisi kayak gini tim langsung speak up atau cari aman dulu? spill coba."
  Panjang: 90 - 180 karakter.

ATURAN KETAT ANTI-REPETISI & PRIVASI:
- DILARANG SELALU MENGGUNAKAN POLA KALIMAT PEMBUKA YANG SAMA! Variasikan kalimat pembuka secara alami dan segar.
- JIKA SUDUT PANDANG ANONIM: DILARANG menyebut nama orang asli! Gunakan sebutan "si fulan" atau "sebut aja si fulan".
- DILARANG nomor urut part ("1/3", "Part 1").
- DILARANG label fiksi "[Cerita Fiksi]" dsb.
- Gaya bahasa manusiawi anak muda korporat Jaksel (lu-gue, bgt, nyesek, boncos, wkwk). Huruf kecil santai.

Keluarkan HANYA JSON:
{
  "title": "Judul Utas Curhat (Maksimal 6 kata)",
  "topic": "Ringkasan Topik",
  "story_parts": [
    "Slide 1 hook pembuka bervariasi...",
    "Slide 2 eskalasi adegan nyata...",
    "Slide terakhir pertanyaan debat warganet..."
  ]
}
`;

  let rawText = null;
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.85 }
        })
      });
      if (res.ok) {
        const d = await res.json();
        rawText = d.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } catch (e) {
      console.warn('[LifeEngine] Gemini error:', e.message);
    }
  }

  if (!rawText && GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
          response_format: { type: 'json_object' },
          temperature: 0.85
        })
      });
      if (res.ok) {
        const d = await res.json();
        rawText = d.choices?.[0]?.message?.content;
      }
    } catch (e) {}
  }

  let parsed = null;
  if (rawText) {
    try {
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {}
  }

  let parts = Array.isArray(parsed?.story_parts) ? parsed.story_parts : null;
  if (!parts || parts.length < 3) {
    if (storyAngle.type === 'personal') {
      parts = [
        `asli gue masih gak habis pikir sama kejadian di kantor tadi siang. kerjaan udah beres sesuai deadline, eh pas sore mendadak di-chat disuruh revisi total tanpa arahan jelas.`,
        `pas gue tanya detailnya apa yang salah, jawabannya cuma 'pokoknya feel-nya belum dapet'. rasanya pengen langsung tutup laptop dan melipir ke warkop wkwk.`,
        `kalian kalau dapet revisi 'kurang dapet feel-nya' tim yang pasrah ngerjain ulang atau tim minta kejelasan tertulis? spill dong.`
      ];
    } else if (storyAngle.type === 'friend') {
      parts = [
        `tadi pas makan siang, temen seruangan gue cerita nasibnya yang apes bgt. laptop kantornya dipinjem rekan divisi sebelah, baliknya malah kena virus dan file meeting ilang semua.`,
        `yang bikin emosi, yang minjem malah lepas tangan bilang 'dari awal udah lemot kok'. padahal jelas-jelas dia pake buat buka link aneh-aneh.`,
        `kalian di posisi kayak gini tim langsung lapor ke atasan atau minta ganti rugi sendiri-sendiri? spill coba.`
      ];
    } else {
      parts = [
        `ada yang curhat di dm, sebut aja si fulan. dia cerita temen sekosannya hobi bawa pacar nginep pas hari kerja dan suka makai barang printilan tanpa izin.`,
        `pas ditegur baik-baik, balesannya malah nyolot bilang 'namanya juga anak kosan bagi-bagi berkah'. nyesek bgt dengernya.`,
        `kalian di posisi kayak gini tim langsung lapor ibu kos atau tim konfrontasi depan muka? spill coba.`
      ];
    }
  }

  // Sisipkan rekomendasi produk kontekstual Shopee sebelum slide terakhir jika ada
  if (adCopy) {
    const lastIdx = parts.length - 1;
    parts.splice(lastIdx, 0, adCopy);
  }

  // Tambahkan credit yang sesuai di slide paling ujung (hanya jika ada credit untuk angle tersebut)
  if (storyAngle.credit) {
    const finalIdx = parts.length - 1;
    if (!parts[finalIdx].includes(storyAngle.credit)) {
      parts[finalIdx] = parts[finalIdx].trim() + `\n\n${storyAngle.credit}`;
    }
  }

  const topicTag = getAutoTopicTag(parsed?.topic || scenario);

  return {
    title: parsed?.title || (storyAngle.type === 'personal' ? 'Cerita Pribadi Kiki' : (storyAngle.type === 'friend' ? 'Cerita Temen Kantor' : 'Curhat Anonim Warganet')),
    topic: parsed?.topic || scenario.slice(0, 50),
    slides: parts,
    product_name: product ? product.name : null,
    product_url: trackedUrl,
    variant: 'B',
    origin: storyAngle.origin,
    format_type: 'story_affiliate',
    story_angle: storyAngle.type,
    topicTag: topicTag,
    topic_tag: topicTag,
    is_single_menfess: false
  };
}

module.exports = {
  getCurrentLifeContext,
  getViralCallbackCandidate,
  generateDailyLifeUpdate,
  generateAnonymousCurhatStory
};
