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
  FINANCIAL_BREAKDOWN: 'financial_breakdown',
  RECEH_DAILY: 'receh_daily',
  RANDOM_HOBBIES: 'random_hobbies',
  SERIALIZED_STORY: 'serialized_story',
  SINGLE_LIFE_UPDATE: 'single_life_update',
  ANONYMOUS_CURHAT_STORY: 'anonymous_curhat_story'
};

// Bank tema Menfess Spill (Crowdsourcing reply bait - Obrolan Komunitas)
const MENFESS_SPILL_THEMES = [
  'Kelakuan paling di luar nalar dari mantan teman sekamar kosan',
  'Aturan gak tertulis di kantor yang kalau dilanggar bakal dijauhin satu divisi',
  'Pengalaman barang atau makanan di kulkas kantor/kosan raib tanpa jejak',
  'Momen disuruh ngerjain tugas di luar jobdesk oleh atasan tapi pas sukses gak dimention',
  'Hal paling zonk pas kencan pertama pas giliran split bill makanan',
  'Kelakuan rekan kerja satu tim yang hobi lempar revisian pas udah jam 5 sore',
  'Alasan paling gak masuk akal pas atasan nolak pengajuan cuti tahunan',
  'Momen dititipin oleh-oleh pas liburan sama temen kantor tapi duitnya gak pernah diganti',
  'Pengalaman diajak temen lama reuni taunya diprospek jualan asuransi atau MLM',
  'Kelakuan tetangga komplek/kontrakan paling bikin ngelus dada soal parkir mobil',
  'Hari ini di kantor atau kerjaan lu ada drama apa lagi? Drop ceritanya di reply',
  'Sebutin 1 pengeluaran paling boncos minggu ini yang sebenernya gak penting tapi tetep lu beli',
  'Momen paling bikin lu pengen langsung logout laptop dan pura-pura amnesia pas jam kerja',
  'Sebutin 1 kebohongan paling sering lu ucapin ke atasan pas lagi WFH atau izin kerja',
  'Rekor lembur paling gak masuk akal yang pernah lu jalanin demi gaji yang gak seberapa'
];

// Bank tema Hal Receh Sehari-hari (Absurditas & Kerecehan Urban)
const RECEH_DAILY_THEMES = [
  'Drama ditarik parkir 2 ribu pas cuma beli permen di minimarket tanpa karcis',
  'Shower kosan mendadak mati pas kepala udah berbusa sampo',
  'Headset mati sebelah pas naik KRL jam pulang kerja di stasiun Manggarai',
  'Sandal jepit putus pas lagi nyebrang jalan protokol Sudirman-Kuningan',
  'Laptop freeze pas revisi dokumen seharian belum sempat di-save',
  'Charger laptop ketinggalan di kosan padahal baterai sisa 11 persen pas meeting',
  'Momen pasrah pesen ojol motor pas mendadak hujan badai tanpa jas hujan cadangan',
  'Beli kopi estetik 45 ribu tanpa mikir tapi ongkir makanan 10 ribu dipikirin 20 menit'
];

// Bank tema Hobi Random & Adulting Dilemmas
const RANDOM_HOBBIES_THEMES = [
  'FOMO main padel atau running GBK beli jersey 2 juta larinya cuma 400 meter',
  'Tiba-tiba pengen melihara tanaman hias monstera estetik seminggu kemudian layu',
  'Ritual nyeduh kopi V60 pake timbangan digital 20 menit tiap pagi padahal telat finger print',
  'Ngerakit lego atau gundam di umur 26 tahun demi nyembuhin inner child tapi boncos',
  'Thrift shop pasar senen niat hemat dapet baju vintage bau apek dan ongkos cuci lebih mahal',
  'Beli buku self-improvement di pameran tebal 400 halaman yang dibaca cuma bab 1 doang'
];

// Bank tema Cerita Berseri (Obrolan Sana-Sini Multi-Slide)
const SERIALIZED_STORY_THEMES = [
  'Denger dari obrolan sana-sini soal audit dadakan divisi sebelah yang bikin manajer panik',
  'Obrolan warung kopi soal temen satu kosan yang paketnya numpuk tapi gak pernah keluar kamar',
  'Cerita dari obrolan kantor soal rekan kerja yang mendadak resign tanpa pamit pas dapet proyek gede',
  'Denger obrolan tongkrongan soal drama pembagian warisan keluarga yang awalnya adem ayem'
];

// Bank tema Financial Breakdown (In this economy reality check - Variasi Lengkap & Dibatasi)
const FINANCIAL_THEMES = [
  'Realitas gaji fresh grad UMR vs biaya kos sepetak, makan warteg, dan KRL',
  'Breakdown biaya hidup staff 2 tahun di Jakarta: sandwich gen kirim ortu vs tabungan darurat',
  'Simulasi cash flow anak agensi SCBD: lembur marathon, coffee run harian, dan reimburse nombok',
  'Pengeluaran riil remote / tech worker: biaya listrik AC 24 jam, wifi kenceng, dan sewa kosan',
  'Simulasi biaya pasangan muda baru nikah sewa kontrakan vs target nabung DP rumah',
  'Realitas gaji dua digit di Jakarta: potongan PPh 21, BPJS, dan ilusi gaya hidup naik kelas',
  'Biaya komuter harian Bintaro - Sudirman vs pengeluaran makan siang kantor',
  'Simulasi belanja bulanan & dana darurat gaji 7 jutaan di tengah inflasi harga bahan pokok'
];

// Bank tema Hot Takes Sarkasme (Anak Muda Corporate Jaksel)
const HOT_TAKE_THEMES = [
  'Orang yang hobi bales chat kerjaan pas weekend itu bukan loyal tapi gak punya kehidupan pribadi',
  'Normalisasi gak ikut patungan kado nikahan teman kantor yang gak pernah nyapa di pantry',
  'Pekerja loyal 4 tahun gajinya kalah sama karyawan baru yang jago nego pas interview',
  'Istilah loyalitas perusahaan itu cuma dongeng HRD pas giliran efisiensi karyawan',
  'Makin dewasa lingkaran pertemanan mengecil bukan karena sombong tapi sama-sama capek dan gak ada bandwidth',
  'Kerja lembur tiap hari bukan tanda produktif tapi tanda manajemen timeline atasan yang berantakan',
  'Meeting marathon 2 jam bahas hal yang sebenernya bisa selesai di 3 baris pesan Slack'
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
Kamu adalah Kiki Rachmat (@kikipunyacerita), kurator Threads. Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Anak muda korporat Jakarta Selatan (usia 25-27 thn, kerja di agensi/tech/kantor SCBD-Kuningan).
Gaya ngetik: Human typing sejati warganet Threads Indonesia. Huruf kecil santai, kalimat padat (1-2 kalimat, 90-170 karakter), sinis-realistis, self-deprecating (menertawakan nasib sendiri).

TEMA REALITAS:
"${theme}"

ATURAN KETAT ANAK KORPORAT JAKSEL:
1. DILARANG sapaan basi (Guys, Halo, Selamat Pagi).
2. DILARANG HASHTAG (#) apapun.
3. DILARANG bahasa baku kaku atau nasihat motivasi ala LinkedIn.
4. Gunakan istilah korporat & warganet yang natural (burnout, boncos, WFO/WFH, commute, split bill, paylater, reimburse, overhead, bandwidth, wkwk, haha, bgt).
5. Output HANYA teks postingan langsung tanpa tanda kutip. Huruf kecil santai.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `orang yang hobi bales chat kerjaan pas weekend itu bukan loyal, tapi gak punya kehidupan pribadi di luar kantor. in this economy kewarasan emang ada harganya.`;
  }

  // Bersihkan kutip, markdown asterisks, hashtag, dan batasi panjang
  text = text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim();
  if (text.length > 480) text = text.substring(0, 475) + '...';

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
 * Generate 1 Menfess Spill (Crowdsourcing Reply Magnet - Obrolan Komunitas)
 */
async function generateMenfessSpill(options = {}) {
  const theme = options.theme || MENFESS_SPILL_THEMES[Math.floor(Math.random() * MENFESS_SPILL_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), kurator Threads. Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Anak muda korporat Jakarta Selatan.
Tuliskan SATU (1) POSTINGAN CROWDSOURCING / MENFESS SPILL PENDEK (panjang 110-180 karakter) untuk memancing warganet Threads bercerita.

TOPIK PANCINGAN:
"${theme}"

ATURAN KETAT:
1. DILARANG sapaan basi (Guys, Halo, Selamat Pagi).
2. DILARANG HASHTAG (#) apapun.
3. DILARANG konsep asing / halusinasi (seperti koin sen atau budaya barat). Harus 100% realitas urban Indonesia (kantor Jabodetabek, kosan, KRL, warteg, ojol, split bill).
4. Mulai langsung dengan gaya pancingan santai: "spill...", "sebutin 1...", "hal paling absurd...", atau "kelakuan paling zonk...".
5. DILARANG MENGGUNAKAN FRASA "masuk DM", "kiriman DM", atau "DM gue"! Gunakan ajakan reply di kolom komentar (contoh: "coba cerita di bawah, pengen tau seaneh apa.", "ada yang pernah ngalamin juga? coba spill di reply.").
6. Output HANYA teks postingan langsung tanpa tanda kutip. Huruf kecil santai.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `spill kelakuan paling gak masuk akal dari mantan temen sekamar kosan lu yang bikin lu langsung mikir 'gue harus pindah minggu ini juga'. pengen tau se-absurd apa.`;
  }

  // Bersihkan kutip, markdown asterisks, hashtag, dan batasi panjang
  text = text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim();
  if (text.length > 480) text = text.substring(0, 475) + '...';

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
 * Generate 1 Hal Receh Sehari-hari (Absurditas & Kerecehan Kehidupan Urban)
 */
async function generateRecehDaily(options = {}) {
  const theme = options.theme || RECEH_DAILY_THEMES[Math.floor(Math.random() * RECEH_DAILY_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), anak muda korporat Jakarta Selatan (usia 25-27 thn). Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Tuliskan SATU (1) POSTINGAN HAL RECEH SEHARI-HARI (panjang 120-220 karakter) tentang absurditas/kesialan kecil sehari-hari di kota besar.

TOPIK RECEH:
"${theme}"

ATURAN KETAT:
1. DILARANG sapaan basi (Guys, Halo, Selamat Pagi).
2. DILARANG HASHTAG (#) apapun.
3. DILARANG label fiksi atau AI apapun. Tulis murni curhatan manusiawi.
4. Gaya ngetik warganet Threads: Huruf kecil santai, nada pasrah/self-deprecating (wkwk, capek bgt, parah sih, asli).
5. Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `drama beli permen 1500 di minimarket tapi ditarik tukang parkir 2000 tanpa karcis adalah salah satu alasan kenapa gue ngerasa in this economy bertahan hidup itu butuh mental baja wkwk.`;
  }

  text = text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim();
  if (text.length > 480) text = text.substring(0, 475) + '...';

  return {
    title: `Receh: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.RECEH_DAILY,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides: [text],
    variant: 'A',
    origin: 'observation'
  };
}

/**
 * Generate 1 Hobi Random & Adulting Dilemmas
 */
async function generateRandomHobbies(options = {}) {
  const theme = options.theme || RANDOM_HOBBIES_THEMES[Math.floor(Math.random() * RANDOM_HOBBIES_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), anak muda korporat Jakarta Selatan (usia 25-27 thn). Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Tuliskan SATU (1) POSTINGAN HOBI RANDOM / PELARIAN STRES ADULTING (panjang 120-220 karakter).

TOPIK HOBI:
"${theme}"

ATURAN KETAT:
1. DILARANG sapaan basi dan HASHTAG (#).
2. Menertawakan fenomena impulsif diri sendiri / circle sebaya (FOMO olahraga mahal, beli mainan inner child, ngerakit sesuatu pas lagi stres kerjaan).
3. Gaya santai anak Jaksel (boncos, burnout, inner child, wkwk, healing). Huruf kecil santai.
4. Output HANYA teks postingan langsung tanpa tanda kutip.
`;

  let text = await callAiWithFallback(prompt, 0.8);
  if (!text || text.length < 40) {
    text = `umur 26 tahun tiba-tiba beli lego demi nyembuhin inner child, pas liat total checkout di kasir malah inner child gue yang minta maaf ke rekening tabungan wkwk.`;
  }

  text = text.replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim();
  if (text.length > 480) text = text.substring(0, 475) + '...';

  return {
    title: `Hobi: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.RANDOM_HOBBIES,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides: [text],
    variant: 'A',
    origin: 'observation'
  };
}

/**
 * Generate 1 Cerita Berseri (Obrolan Sana-Sini Multi-Slide)
 */
async function generateSerializedStory(options = {}) {
  const theme = options.theme || SERIALIZED_STORY_THEMES[Math.floor(Math.random() * SERIALIZED_STORY_THEMES.length)];
  const topicTag = options.topicTag || getAutoTopicTag(theme);

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), kurator Threads. Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Tuliskan SATU (1) UTAS CERITA BERSERI PENDEK TEPAT 2 SLIDE berdasarkan obrolan nyata warganet / teman kantor.

TOPIK CERITA:
"${theme}"

STRUKTUR 2 SLIDE:
- SLIDE 1 (Hook Awal Menggantung):
  * WAJIB gunakan framing alami obrolan: "denger dari obrolan sana-sini...", "cerita dari tongkrongan kemarin...", atau "lagi di pantry denger obrolan...".
  * DILARANG KERAS menggunakan frasa "masuk DM", "kiriman DM", atau "spill di DM"!
  * DILARANG penomoran "Part 1" atau "[Cerita Fiksi]".
  * Panjang: 120-180 karakter. Huruf kecil santai.
- SLIDE 2 (Eskalasi & Dilema Menggantung):
  * Kelanjutan fakta yang bikin geleng-geleng kepala + celetukan penutup atau pancingan diskusi.
  * Panjang: 140-220 karakter. Huruf kecil santai.

Keluarkan HANYA JSON:
{
  "title": "Judul Cerita Berseri (Maksimal 6 kata)",
  "slides": [
    "Slide 1 hook menggantung obrolan sana-sini...",
    "Slide 2 kelanjutan fakta dan celetukan menggantung..."
  ]
}
`;

  let slides = null;
  const rawResponse = await callAiWithFallback(prompt, 0.8);
  if (rawResponse) {
    try {
      const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/gi, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length >= 2) {
        slides = parsed.slides.slice(0, 2).map(s => String(s).replace(/^["']|["']$/g, '').replace(/[*_~`]/g, '').replace(/#\w+/g, '').trim());
      }
    } catch (e) {}
  }

  if (!slides || slides.length < 2) {
    slides = [
      `denger dari obrolan sana-sini, temen satu kosan gue ada yang paketnya numpuk depan pintu selama 4 hari tapi lampunya selalu nyala dan gak pernah keluar kamar sama sekali.`,
      `pas ditegur bapak kos tadi pagi, taunya doi lagi sprint marathon kerjaan remote 3 klien luar negeri demi kejar setoran nikah. antara salut sama kasihan liat matanya udah kayak panda wkwk.`
    ];
  }

  return {
    title: `Cerita: ${theme.slice(0, 30)}...`,
    topic: theme,
    format_type: FORMAT_TYPES.SERIALIZED_STORY,
    topic_tag: topicTag,
    product_name: null,
    product_url: null,
    slides,
    variant: 'B',
    origin: 'curation'
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
 * Bank celetukan penutup (punchlines) realistis anak muda korporat Jaksel
 * Anti-klise: Dilarang keras formula basi 'ngajak nongkrong senopati mending pura-pura pingsan/tipes'!
 */
const AUTHENTIC_CORPORATE_PUNCHLINES = [
  'reimburse kantor 1.4jt belum cair udah kayak gue yg jadi angel investor perusahaan.',
  'tiap mau checkout kopi mikir dulu: ini setara jam kerja 45 menit di depan laptop.',
  'gaji numpang napas 3 hari di m-banking terus balik mode survival sampe tanggal 25.',
  'pas ditanya resolusi karir: survive satu quarter ke depan tanpa kena mental dulu.',
  'sisa tabungan segitu tipis kesenggol biaya servis laptop dikit langsung wassalam.',
  'potongan pajak sama bpjs naik tiap tahun tapi fasilitas krl tetep dempet-dempetan.',
  'tiap liat kalender tanggal 18 rasanya pengen skip langsung ke tanggal gajian.',
  'mau healing tapi pas liat sisa saldo malah nambah beban pikiran.',
  'kerja keras bagai kuda, pas liat sisa saldo cuma cukup buat beli koyo sama tolak angin.',
  'meeting seharian bahas efisiensi perusahaan, padahal gaji sendiri yang paling efisien.',
  'sisa tabungan receh mau investasi saham rasanya kayak ngasih makan dinosaurus pake biskuit.',
  'nombok belanja keperluan kantor berasa kayak founder startup bakar duit pribadi.'
];

function sanitizePunchline(punchline) {
  let clean = (punchline || '').replace(/#\w+/g, '').replace(/[*_~`]/g, '').trim();
  // Filter klise basi yang dilarang keras
  const bannedCliches = /(ngajak nongkrong.*(senopati|cafe|500rb).*pura-pura|kopi susu 40.*ongkir|mending gue pura-pura (pingsan|tipes|amnesia|mati)|pura-pura (pingsan|tipes))/i;
  if (!clean || bannedCliches.test(clean) || clean.length < 15) {
    clean = AUTHENTIC_CORPORATE_PUNCHLINES[Math.floor(Math.random() * AUTHENTIC_CORPORATE_PUNCHLINES.length)];
  }
  if (clean.length > 150) clean = clean.substring(0, 145) + '...';
  return clean;
}

/**
 * Merakit teks postingan financial breakdown dengan kalkulasi matematika 100% presisi.
 * Menghitung Total Pengeluaran dan Sisa Tabungan dalam kode JavaScript (Zero Hallucination).
 */
function buildFinancialBreakdownText({ incomeJt, location, items, punchline, headerStyle }) {
  const totalExpense = Number(items.reduce((sum, it) => sum + it.amountJt, 0).toFixed(2));
  const sisaJt = Number((incomeJt - totalExpense).toFixed(2));

  let sisaLine;
  if (sisaJt > 0) {
    sisaLine = `sisa ${formatRupiahJt(sisaJt)} buat tabungan darurat.`;
  } else if (sisaJt === 0) {
    sisaLine = `sisa 0 rupiah alias pas-pasan banget.`;
  } else {
    sisaLine = `defisit ${formatRupiahJt(Math.abs(sisaJt))} alias minus ditambal paylater.`;
  }

  const safePunchline = sanitizePunchline(punchline);

  // Gunakan header bergaya kurator obrolan sana-sini (lowercase, organik, bukan aku-akuan)
  const header = headerStyle || `denger dari obrolan sana-sini, ini rincian gaji ${formatRupiahJt(incomeJt)} di ${location}:`;

  const lines = [
    header,
    ...items.map(it => `• ${it.label}: ${formatRupiahJt(it.amountJt)}`),
    sisaLine,
    safePunchline
  ];

  let fullText = lines.join('\n');
  if (fullText.length > 480) {
    fullText = fullText.substring(0, 475) + '...';
  }
  return fullText;
}

/**
 * Bank template anggaran riil tervalidasi 100% akurat secara matematis (Zero Hallucination)
 * Mencakup variasi nominal gaji dan lokasi yang berbeda-beda agar tidak pernah kembar.
 */
const VERIFIED_BUDGETS = [
  {
    incomeJt: 5.2,
    location: 'Kuningan (Jaksel)',
    headerStyle: 'denger dari obrolan sana-sini, ini rincian gaji 5.2jt di kuningan:',
    items: [
      { label: 'Kos sepetak jalan kaki ke kantor', amountJt: 1.5 },
      { label: 'Makan warteg siang & malam', amountJt: 1.4 },
      { label: 'Ongkos ojol pas ujan & darurat', amountJt: 0.4 },
      { label: 'Kirim adik/ortu', amountJt: 0.8 },
      { label: 'Kuota & keperluan mandi', amountJt: 0.3 }
    ],
    punchline: 'reimburse kantor 1.2jt belum cair udah kayak gue yg invest modal di perusahaan.'
  },
  {
    incomeJt: 7.2,
    location: 'Setiabudi (Jaksel)',
    headerStyle: 'obrolan anak kos setiabudi soal survive gaji 7.2jt:',
    items: [
      { label: 'Kos AC + wifi', amountJt: 2.1 },
      { label: 'Makan sehari-hari + kopi kantor', amountJt: 1.8 },
      { label: 'KRL & ojol commute', amountJt: 0.6 },
      { label: 'Kirim ortu kampung', amountJt: 1.2 },
      { label: 'Cicilan motor / paylater', amountJt: 0.6 },
      { label: 'Kuota & streaming', amountJt: 0.2 }
    ],
    punchline: 'tiap mau checkout kopi mikir dulu: ini setara jam kerja 45 menit di depan laptop.'
  },
  {
    incomeJt: 8.5,
    location: 'SCBD / Sudirman',
    headerStyle: 'denger rincian cash flow anak agensi scbd (gaji 8.5jt):',
    items: [
      { label: 'Sewa studio kos Benhil', amountJt: 2.5 },
      { label: 'Makan delivery & coffee run lembur', amountJt: 2.2 },
      { label: 'MRT & transport harian', amountJt: 0.6 },
      { label: 'Kirim keluarga', amountJt: 1.5 },
      { label: 'Laundry & printilan kos', amountJt: 0.4 },
      { label: 'Paket data & cloud storage', amountJt: 0.25 }
    ],
    punchline: 'gaji numpang napas 3 hari di m-banking terus balik mode survival sampe tanggal 25.'
  },
  {
    incomeJt: 6.5,
    location: 'Bintaro - Sudirman',
    headerStyle: 'kemarin denger obrolan komuter bintaro - sudirman (gaji 6.5jt):',
    items: [
      { label: 'Kos / kontrakan Bintaro', amountJt: 1.7 },
      { label: 'Makan hemat + jajan pantry', amountJt: 1.5 },
      { label: 'KRL bulanan + ojol stasiun', amountJt: 0.5 },
      { label: 'Kirim orang tua', amountJt: 1.0 },
      { label: 'Cicilan HP / laptop kerja', amountJt: 0.7 },
      { label: 'Kuota internet', amountJt: 0.2 }
    ],
    punchline: 'pas ditanya resolusi karir: survive satu quarter ke depan tanpa kena mental dulu.'
  },
  {
    incomeJt: 9.8,
    location: 'Tebet (Jaksel)',
    headerStyle: 'obrolan warkop tebet soal pengeluaran riil tech worker gaji 9.8jt:',
    items: [
      { label: 'Sewa apartemen studio / kos eksklusif', amountJt: 2.8 },
      { label: 'Makan + ngopi wfh', amountJt: 2.3 },
      { label: 'Listrik AC & internet kenceng', amountJt: 0.7 },
      { label: 'Kirim keluarga', amountJt: 1.8 },
      { label: 'Asuransi kesehatan mandiri', amountJt: 0.6 },
      { label: 'Gym & lifestyle', amountJt: 0.4 }
    ],
    punchline: 'sisa tabungan segitu tipis kesenggol biaya servis laptop dikit langsung wassalam.'
  },
  {
    incomeJt: 12.0,
    location: 'Jakarta Selatan',
    headerStyle: 'denger obrolan anak jaksel soal realita sisa gaji 12jt:',
    items: [
      { label: 'Kos eksklusif / cicilan KPR', amountJt: 3.5 },
      { label: 'Makan & transport kerja', amountJt: 2.8 },
      { label: 'Kirim keluarga sandwich gen', amountJt: 2.5 },
      { label: 'Tabungan nikah / dana darurat', amountJt: 1.5 },
      { label: 'Investasi & asuransi', amountJt: 0.8 }
    ],
    punchline: 'potongan pajak sama bpjs naik tiap tahun tapi fasilitas krl tetep dempet-dempetan.'
  },
  {
    incomeJt: 4.8,
    location: 'Cilandak (Jaksel)',
    headerStyle: 'obrolan survive anak kos cilandak gaji 4.8jt:',
    items: [
      { label: 'Kos non-AC gang senggol', amountJt: 1.2 },
      { label: 'Makan warteg 2x sehari', amountJt: 1.3 },
      { label: 'Ongkos KRL & jalan kaki', amountJt: 0.35 },
      { label: 'Kirim adik sekolah', amountJt: 0.8 },
      { label: 'Kebutuhan mandi & sabun', amountJt: 0.25 },
      { label: 'Kuota hemat', amountJt: 0.15 }
    ],
    punchline: 'tiap liat kalender tanggal 18 rasanya pengen skip langsung ke tanggal gajian.'
  }
];

function getRandomVerifiedFinancialBudget(excludedIncomes = new Set()) {
  const eligible = VERIFIED_BUDGETS.filter(b => !excludedIncomes.has(b.incomeJt));
  if (eligible.length > 0) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
  return VERIFIED_BUDGETS[Math.floor(Math.random() * VERIFIED_BUDGETS.length)];
}

/**
 * Generate 1 Financial Breakdown ("In this economy" Reality Check)
 * Menjamin 100% akurasi matematis tanpa halusinasi angka.
 * Terintegrasi matriks rotasi dinamis & deduplikasi agar nominal & lokasi tidak pernah kembar.
 */
async function generateFinancialBreakdown(options = {}) {
  const topicTag = 'finansial';

  // 1. Ekstraksi riwayat nominal gaji dan lokasi terakhir dari database (Cegah Duplikasi)
  const recentFinancials = db.getRecentFinancialDetails ? db.getRecentFinancialDetails(14) : [];
  const usedIncomes = new Set(recentFinancials.map(f => f.incomeJt).filter(Boolean));
  const recentLocations = recentFinancials.slice(0, 3).map(f => (f.location || '').toLowerCase());

  // 2. Tentukan nominal gaji yang belum pernah dipakai dalam rolling 14 hari
  const ALL_INCOMES = [4.8, 5.2, 5.8, 6.5, 7.2, 7.8, 8.5, 9.8, 12.0, 14.5];
  let availableIncomes = ALL_INCOMES.filter(inc => !usedIncomes.has(inc));
  if (availableIncomes.length === 0) availableIncomes = ALL_INCOMES;
  const targetIncome = availableIncomes[Math.floor(Math.random() * availableIncomes.length)];

  // 3. Tentukan lokasi kota/area kerja yang fresh
  const ALL_LOCATIONS = [
    'Kuningan (Jaksel)',
    'Setiabudi (Jaksel)',
    'Tebet (Jaksel)',
    'Cilandak (Jaksel)',
    'SCBD / Senopati',
    'Benhil (Jakpus)',
    'Palmerah (Jakpus)',
    'Bintaro (Tangsel)',
    'BSD (Tangerang)',
    'Cikarang (Kawasan Industri)'
  ];
  let availableLocations = ALL_LOCATIONS.filter(loc => !recentLocations.some(rl => rl.includes(loc.split(' ')[0].toLowerCase())));
  if (availableLocations.length === 0) availableLocations = ALL_LOCATIONS;
  const targetLocation = availableLocations[Math.floor(Math.random() * availableLocations.length)];

  // 4. Pilih arketipe pekerja korporat
  const ARCHETYPES = [
    { role: 'Fresh Grad / Junior Staff', focus: 'Survive masa probation, kos sepetak, makan warteg, KRL desak-desakan' },
    { role: 'Staff 2-3 Tahun (Sandwich Gen)', focus: 'Kirim adik/ortu, cicilan motor, sisa tabungan receh' },
    { role: 'Anak Agensi / Start-up Hustler', focus: 'Lembur marathon, taksi ujan, coffee run harian, reimburse nombok' },
    { role: 'Tech / Hybrid Worker', focus: 'Listrik AC 24 jam, wifi kenceng, langganan cloud/tools, lifestyle creep' },
    { role: 'Pasangan Muda Baru Menikah', focus: 'Sewa kontrakan, split bill belanja bulanan, tabungan DP rumah' },
    { role: 'Senior Specialist / Lead', focus: 'Gaji dua digit tapi dipotong pajak PPh 21, BPJS, dan overhead gaya hidup' }
  ];
  const chosenArchetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];

  const theme = options.theme || `Realitas gaji ${targetIncome}jt di ${targetLocation} (${chosenArchetype.role})`;

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), kurator Threads. Panggilan: "Ki". Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Anak muda korporat Jakarta Selatan (usia 25-27 thn, kerja di kantor SCBD/Kuningan/Jaksel).
Tugas: Buat rincian data pengeluaran bulanan yang realistis dan relatable untuk ${chosenArchetype.role} (${chosenArchetype.focus}).

TARGET PARAMETER WAJIB:
- Nominal Gaji: ${targetIncome} juta
- Lokasi: "${targetLocation}"
- Nominal yang SUDAH PERNAH DIPAKAI (DILARANG DIPAKAI LAGI): [${Array.from(usedIncomes).join(', ')}]
- DILARANG menggunakan nominal 6.0 juta (karena baru saja diposting)!

Berikan output HANYA berupa JSON valid persis seperti ini:
{
  "incomeJt": ${targetIncome},
  "location": "${targetLocation}",
  "headerStyle": "realita gaji ${targetIncome}jt di ${targetLocation.toLowerCase()}:",
  "items": [
    { "label": "Kos / Kontrakan", "amountJt": 1.8 },
    { "label": "Makan sehari-hari", "amountJt": 1.5 },
    { "label": "KRL & transport harian", "amountJt": 0.5 },
    { "label": "Kirim ortu / keluarga", "amountJt": 1.0 },
    { "label": "Kuota & keperluan kos", "amountJt": 0.3 }
  ],
  "punchline": "tulis celetukan sinis-realistis khas anak korporat jaksel (lowercase, tanpa hashtag)"
}

ATURAN KETAT ANTI-DUPLIKASI & GAYA ANAK KORPORAT:
1. Total pengeluaran items HARUS lebih kecil dari ${targetIncome} (sisakan 400rb - 1.2jt untuk sisa tabungan).
2. DILARANG menghitung sisa sendiri dalam JSON, sistem kode yang akan menghitung sisa secara eksak.
3. DILARANG PUNCHLINE KLISE BASI seperti: "ngajak nongkrong di senopati... mending pura-pura pingsan/tipes" atau "kopi 40rb vs ongkir 8rb". Buat celetukan segar tentang nasib kerjaan, reimburse kantor, potongan pajak, atau tabungan tipis.
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
        
        // Tolak jika AI halusinasi kembali ke 6.0 padahal 6.0 dilarang
        if (validIncome === 6.0 && targetIncome !== 6.0) {
          validIncome = targetIncome;
        }

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
          location: parsed.location || targetLocation,
          headerStyle: parsed.headerStyle || `realita gaji ${formatRupiahJt(validIncome)} di ${targetLocation}:`,
          items: validItems,
          punchline: sanitizePunchline(parsed.punchline)
        };
      }
    } catch (e) {
      console.warn('[ContentMixer] Gagal parse JSON AI financial breakdown, menggunakan budget terverifikasi:', e.message);
    }
  }

  // Jika AI gagal / parsing error, gunakan template terverifikasi 100% akurat yang belum pernah dipakai
  if (!budgetData) {
    budgetData = getRandomVerifiedFinancialBudget(usedIncomes);
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
    case FORMAT_TYPES.SINGLE_LIFE_UPDATE: {
      const { generateDailyLifeUpdate } = require('./dailyLifeEngine');
      return await generateDailyLifeUpdate(options);
    }
    case FORMAT_TYPES.ANONYMOUS_CURHAT_STORY: {
      const { generateAnonymousCurhatStory } = require('./dailyLifeEngine');
      return await generateAnonymousCurhatStory(options);
    }
    case FORMAT_TYPES.HOT_TAKE:
      return await generateHotTake(options);
    case FORMAT_TYPES.MENFESS_SPILL:
      return await generateMenfessSpill(options);
    case FORMAT_TYPES.RECEH_DAILY:
      return await generateRecehDaily(options);
    case FORMAT_TYPES.RANDOM_HOBBIES:
      return await generateRandomHobbies(options);
    case FORMAT_TYPES.SERIALIZED_STORY:
      return await generateSerializedStory(options);
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
 * Menentukan format ideal untuk setiap dari 6 slot harian (Rundown 50/50 Seimbang):
 * 50% SINGLE POST (Slot 1, 2, 4): Life update Kiki, real-time date/calendar, berita/demo, viral callback (0% Ad).
 * 50% CERITA PANJANG / DM (Slot 3, 5, 6): Utas curhat DM anonim ("hari ini ada dm cerita anonim nih...") + Shopee Affiliate.
 */
function getFormatForSlotNumber(slotNumber) {
  switch (Number(slotNumber)) {
    case 1:
      // Slot 1 (07:15 Pagi Komuter): Life update pagi, KRL, cuaca, atau callback kemarin
      return FORMAT_TYPES.SINGLE_LIFE_UPDATE;
    case 2:
      // Slot 2 (10:00 Coffee Break): Life update, respon isu/berita hari ini, demo, meeting kantor
      return FORMAT_TYPES.SINGLE_LIFE_UPDATE;
    case 3:
      // Slot 3 (12:30 Makan Siang): Curhat DM Anonim + Shopee Affiliate #1
      return FORMAT_TYPES.ANONYMOUS_CURHAT_STORY;
    case 4:
      // Slot 4 (16:30 Sore Pulang): Life update sore, macet jalanan, revisi mendadak, atau callback
      return FORMAT_TYPES.SINGLE_LIFE_UPDATE;
    case 5:
      // Slot 5 (19:30 Malam Santai): Cerita berseri tongkrongan / relasi + Shopee Affiliate #2
      return Math.random() > 0.5 ? FORMAT_TYPES.ANONYMOUS_CURHAT_STORY : FORMAT_TYPES.STORY_AFFILIATE;
    case 6:
      // Slot 6 (21:45 Peak Rebahan): Curhat mendalam warganet anonim + Shopee Affiliate #3
      return FORMAT_TYPES.ANONYMOUS_CURHAT_STORY;
    default:
      return FORMAT_TYPES.SINGLE_LIFE_UPDATE;
  }
}

module.exports = {
  FORMAT_TYPES,
  generateHotTake,
  generateMenfessSpill,
  generateRecehDaily,
  generateRandomHobbies,
  generateSerializedStory,
  generateFinancialBreakdown,
  generateMixedPost,
  getFormatForSlotNumber
};
