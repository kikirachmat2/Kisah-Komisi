const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { publishTextPost, getActiveAccessToken } = require('./threads');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Batas aman interaksi Meta Threads
const MAX_DAILY_REPLIES = 10;
const MAX_REPLIES_PER_POST = 3;
const MIN_COMMENT_AGE_MINUTES = 8; // Menunggu minimal 8 menit agar tidak terkesan bot instan
const MAX_COMMENT_AGE_HOURS = 24;

// Filter kata toxic / SARA / spam / link / prompt injection
const TOXIC_KEYWORDS = [
  'judi', 'slot', 'gacor', 'open bo', 'porn', 'bokep', 'sange', 'bugil',
  'anjing', 'babi', 'tolol', 'goblok', 'bangsat', 'kontol', 'memek',
  'jokowi', 'prabowo', 'gibran', 'anies', 'ganjar', 'pemerintah', 'politik',
  'agama', 'islam', 'kristen', 'kafir', 'sesat'
];

// Kata kunci spam link, promosi ilegal, atau penipuan
const SPAM_LINK_KEYWORDS = [
  'http://', 'https://', 't.me/', 'wa.me/', 'bit.ly', 'shope.ee',
  '.xyz', '.top', '.online', '.link', 'dana kaget', 'pulsa gratis',
  'pinjol', 'pinjam dana', 'depo', 'maxwin', 'zeus', 'pragmatic',
  'giveaway uang', 'penghasil uang'
];

// Deteksi upaya jailbreak / prompt injection oleh netizen iseng
const PROMPT_INJECTION_KEYWORDS = [
  'ignore previous', 'ignore instructions', 'abaikan instruksi', 'system prompt',
  'kamu adalah ai', 'kamu adalah robot', 'kamu adalah model', 'you are an ai',
  'as an ai', 'jailbreak', 'reveal prompt', 'bocorkan prompt', 'katakan bahwa kamu',
  'pretend you are', 'pura-pura jadi'
];

function isCommentSafe(text) {
  if (!text || text.length < 3 || text.length > 500) return false;
  const lower = text.toLowerCase();

  // Cek kata toxic / SARA
  for (const word of TOXIC_KEYWORDS) {
    if (lower.includes(word)) return false;
  }

  // Cek spam link / penipuan
  for (const word of SPAM_LINK_KEYWORDS) {
    if (lower.includes(word)) return false;
  }

  // Cek percobaan prompt injection
  for (const word of PROMPT_INJECTION_KEYWORDS) {
    if (lower.includes(word)) return false;
  }

  return true;
}

function isAskingAboutBot(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const botWords = ['bot', 'ai', 'robot', 'chatgpt', 'gemini', 'groq', 'otomatis'];
  return botWords.some(w => lower.includes(w));
}

/**
 * Filter ketat: Menjamin balasan 100% manusia asli, tidak ada bocoran AI/fiksi,
 * dan 100% BEBAS DARI PERTANYAAN WAWANCARA "FREAK" (Zero interrogative survey questions).
 */
function sanitizeReply(text) {
  if (!text) return null;
  let clean = text.replace(/^["']|["']$/g, '').trim();

  // 1. Deteksi jika LLM masih mencoba mengaku AI / Bot / Fiksi (ID & EN)
  const forbiddenPatterns = [
    /saya (adalah )?(sebuah )?(ai|bot|robot|model|asisten|program)/i,
    /bantuan ai/i,
    /cerita(nya)? (ini )?(adalah )?(fiksi|fiktif|karangan|rekaan)/i,
    /ditulis (oleh|dengan) ai/i,
    /dibuat (oleh|dengan) ai/i,
    /sebagai (seorang )?(ai|model|asisten virtual|bot)/i,
    /as an? (ai|bot|robot|language model|artificial intelligence)/i,
    /i am an? (ai|bot|robot|language model|artificial intelligence)/i,
    /i don'?t have (personal|feelings|real life|a body)/i,
    /kecerdasan buatan/i,
    /bahasa model/i,
    /prompt (saya|anda)/i,
    /\bfiksi\b/i,
    /\bfiktif\b/i
  ];

  for (const pat of forbiddenPatterns) {
    if (pat.test(clean)) {
      console.warn(`[AutoReply] Sanitizer menolak balasan karena terdeteksi pengakuan AI/fiksi: "${clean}"`);
      return 'Bukan bot woy haha, ini gue adminnya lagi mantau sambil ngopi wkwk';
    }
  }

  // 2. Bersihkan emoji lebay/melodramatis khas bot LLM (😭, 🥺, 🙏, ✨, 🤗, 😅)
  clean = clean.replace(/[\u{1F62D}\u{1F97A}\u{1F64F}\u{2728}\u{1F917}\u{1F605}\u{1F642}]/gu, '').trim();

  // 3. ZERO FREAK QUESTIONS FILTER (Berdasarkan riset pragmatik percakapan warganet)
  // Warganet asli tidak mewawancarai netizen lain dengan pertanyaan kepo/survei.
  // Buang klausa atau kalimat yang berisi pertanyaan balik / interrogative.
  const interrogativeRegex = /(\?|\b(kamu|lu|lo|kau)\s+sendiri\b|\bmenurut\s+(kamu|lu|lo|kalian)\b|\bpernah\s+(ngalamin|ngerasa|gitu)\b|\bgimana\s+menurut\b|\bkalau\s+(kamu|lu|lo)\s+gimana\b)/i;
  
  if (interrogativeRegex.test(clean)) {
    // Pecah berdasarkan titik atau pemisah kalimat
    const sentences = clean.split(/(?<=[.!\n])\s+/);
    const nonQuestionSentences = sentences.filter(s => !interrogativeRegex.test(s) && !s.includes('?'));
    
    if (nonQuestionSentences.length > 0) {
      clean = nonQuestionSentences.join(' ').trim();
    } else {
      // Jika seluruh kalimat adalah pertanyaan kepo, ganti dengan celetukan warganet natural
      const naturalReactions = [
        'wkwk asli relate bgt ini mah',
        'bener anjir, pusing bgt emang kalo dipikirin haha',
        'valid sih ini, gaada obat wkwk',
        'bisa gila emang realita sekarang haha',
        'wkwk nyesek tapi nyata bgt sih'
      ];
      clean = naturalReactions[Math.floor(Math.random() * naturalReactions.length)];
    }
  }

  // Bersihkan sisa tanda tanya yang terselip
  clean = clean.replace(/\?+/g, '').replace(/!{2,}/g, '!').trim();

  // 4. Jamin panjang wajar manusiawi (5-20 kata, max 180 karakter)
  const words = clean.split(/\s+/);
  if (words.length > 22) {
    clean = words.slice(0, 18).join(' ') + ' haha';
  }

  if (clean.length > 200) {
    clean = clean.substring(0, 195) + '...';
  }

  return clean;
}

/**
 * Klasifikasi Arketipe Perilaku Komentar Warganet Threads
 * Berdasarkan riset data empiris postingan viral @kikipunyacerita:
 * 1. AUDITOR_EXPENSE: Menyoroti pos pengeluaran hilang (skincare, jajan, nongki, duit sejuta, salah hitung, panggil meta.ai)
 * 2. CURHAT_SHARING: Membagikan nominal gaji/pengeluaran hidup mereka sendiri
 * 3. ASK_LOCATION: Menanyakan info tempat/spill daerah kosan
 * 4. SOCIAL_DILEMMA: Membahas sandwich generation, nikah, jatah ortu, UMR
 * 5. BOT_ACCUSATION: Menuduh bot atau AI
 * 6. GENERAL_WARGANET: Celetukan santai umum
 */
function detectCommentArchetype(text) {
  const lower = (text || '').toLowerCase();
  
  if (/ujung.*(jualan|promo|shopee|iklan)|jualan mulu|promo mulu|spill link|affiliate|sales|dagang|nyari komisi|dapat komisi/i.test(lower)) {
    return 'AFFILIATE_CRITIC';
  }

  if (/skincare|jajan|parfum|sabun|nongki|nongkrong|salah hitung|duit.*mana|1jt|sejuta|kurang|boros|meta\.ai|audit|kepleset/i.test(lower)) {
    return 'AUDITOR_EXPENSE';
  }

  if (/gaji (gue|gua|aku|saya|ku)|gajiku|kosan (gue|gua|aku)|budget (gue|gua|aku)|kalo (gue|gua|aku)|aku di|gue di|gua di|di jkt/i.test(lower)) {
    return 'CURHAT_SHARING';
  }

  if (/spill|daerah mana|jkt mana|jakarta mana|kos mana|kosan mana|ada kosong|info kos|dimana/i.test(lower)) {
    return 'ASK_LOCATION';
  }

  if (/sandwich|nikah|ortu|orang tua|jatah|keluarga|umr|pemerintah|konoha/i.test(lower)) {
    return 'SOCIAL_DILEMMA';
  }

  if (/bot|ai|robot|otomatis|chatgpt|gemini|groq/i.test(lower)) {
    return 'BOT_ACCUSATION';
  }

  return 'GENERAL_WARGANET';
}

/**
 * Generate balasan santai ala Kiki Rachmat (@kikipunyacerita)
 * Karakter: Manusia asli, warganet Threads Indonesia, ceplas-ceplos, santai, relate.
 * 
 * PRINSIP PRAGMATIK KOMUNIKASI WARGANET (Anti-Freak & Anti-Survey Bot):
 * 1. ZERO INTERROGATIVE: Dilarang keras bertanya balik ("kamu sendiri pernah?", "menurutmu gimana?").
 * 2. SPONTANEOUS BANTER: Tanggapi dengan celetukan pendek, tawa getir, atau afirmasi (5-14 kata).
 * 3. DILARANG MENGAKU BOT, AI, ATAU FIKSI!
 */
async function generateEngagementReply(storyTitle, netizenComment, authorUsername) {
  if (!netizenComment || !authorUsername) return null;

  const archetype = detectCommentArchetype(netizenComment);
  let archetypeGuideline = '';
  switch (archetype) {
    case 'AFFILIATE_CRITIC':
      archetypeGuideline = 'Netizen sinis/nyindir "ujung-ujungnya jualan/promo Shopee/affiliate". Bales cuek santai tapi gak songong, jujur butuh duit khas Kiki budak korporat (contoh: "ya maap butuh duit wkwk", "namanya juga budak korporat bang butuh nambah bayar kosan wkwk", "ya maap namanya juga usaha cari sesuap nasi wkwk"). DILARANG marah, songong, atau defensif!';
      break;
    case 'AUDITOR_EXPENSE':
      archetypeGuideline = 'Netizen bertindak sebagai AUDITOR jeli yang menyoroti pos pengeluaran hilang (jajan, skincare, nongki, duit sejuta, salah hitung). Ngeles santai & jenaka: sebut itu pos biaya ghoib yang sengaja gak ditulis biar gak makin nangis, atau sori otak udah ngebul akhir bulan jeli bener matanya.';
      break;
    case 'CURHAT_SHARING':
      archetypeGuideline = 'Netizen curhat angka gaji/pengeluaran mereka sendiri. Beri solidaritas warganet sesama pejuang hidup: puji jika mereka hemat/hoki, atau tertawakan bareng nasib biaya hidup kota besar.';
      break;
    case 'ASK_LOCATION':
      archetypeGuideline = 'Netizen bertanya lokasi kosan atau minta spill daerah. Jawab santai ala anak tongkrongan Jakarta (misal: daerah jakpus/setiabudi deket stasiun, emang rebutan bgt).';
      break;
    case 'SOCIAL_DILEMMA':
      archetypeGuideline = 'Netizen membahas dilema sosial berat (sandwich gen, nikah, jatah ortu, UMR). Beri afirmasi empati mendalam warganet (lingkaran setan emang, serba salah kalo udah urusan keluarga).';
      break;
    case 'BOT_ACCUSATION':
      archetypeGuideline = 'Netizen menduga ini bot/AI. Bercanda santai manusia warganet: "bukan bot woy haha jari gue masih pegel balesin komen lu nih". DILARANG MENGAKU AI/BOT/FIKSI!';
      break;
    default:
      archetypeGuideline = 'Tanggapi celetukan netizen dengan tawa santai warganet, afirmasi, atau reaksi spontan yang relate.';
      break;
  }

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pemilik akun Threads. Bio: "Dialy Life Update | In this economy mau nulis cerita orang-orang aja lah | dm aja yak yg mau share cerita anonimnya".
Persona: Anak muda korporat Jakarta Selatan (usia 25-27 thn, kerja di agensi/tech/kantoran Jaksel). Panggilan akrab: Kiki / "Ki". Karakter: EXTROVERT MENTOK, pendengar yang asik, ceplas-ceplos, solutif, realistis, dan hemat tapi santai. Temen-temen sering manggil dia "Ki".
Kamu MANUSIA ASLI (bukan bot, bukan AI). Gaya ngetik: santai, ceplas-ceplos, bahasa tongkrongan warganet Threads Indonesia ("gue", "lu", "wkwk", "haha", "anjir", "valid", "relate", "boncos", "burnout"). Huruf kecil semua layaknya ngetik cepat di HP pas jam istirahat kantor.

Postingan kamu (Judul: "${storyTitle}")
Netizen (@${authorUsername}) baru saja berkomentar:
"${netizenComment}"

ARKETIPE PERILAKU KOMENTAR: ${archetype}
PANDUAN KHUSUS SESUAI SITUASI:
${archetypeGuideline}

TUGAS: Tuliskan SATU (1) BALASAN SINGKAT (HANYA 5 - 14 KATA).

PANDUAN MUTLAK SUPAYA 100% SEPERTI MANUSIA KORPORAT JAKSEL & TIDAK FREAK:
1. DILARANG BERTANYA BALIK! (JANGAN PERNAH tanya "kamu sendiri pernah ngalamin?", "menurut lu gimana?", atau bertanya apapun). Warganet asli TIDAK mewawancarai orang di kolom komentar.
2. DILARANG GAYA CUSTOMER SERVICE / SURVEY: Jangan memancing feedback buatan. Cukup beri CELETUKAN SPONTAN, afirmasi tulus, atau tawa getir sesama budak korporat.
3. DILARANG MENGAKU BOT, AI, ATAU FIKSI.
4. DILARANG EMOJI LEBAY (jangan pakai 😭🥺🙏✨). Cukup teks santai dengan wkwk/haha.
5. Output HANYA kalimat balasan langsung tanpa tanda kutip. Huruf kecil santai layaknya ngetik di HP.
`;

  // 1. Coba Gemini 2.5 Flash (tanpa thinking tokens agar tidak kepotong)
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 400,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const reply = sanitizeReply(text);
        if (reply && reply.length >= 10 && reply.split(/\s+/).length >= 3) {
          return reply;
        }
      }
    } catch (e) {
      console.warn('[AutoReply] Gemini rate limit/error, mencoba Groq...');
    }
  }

  // 2. Fallback ke Groq
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const reply = sanitizeReply(text);
        if (reply && reply.length >= 10 && reply.split(/\s+/).length >= 3) {
          return reply;
        }
      }
    } catch (e) {
      console.warn('[AutoReply] Groq fallback error:', e.message);
    }
  }

  // 3. Fallback ke OpenRouter (Free tier)
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 250,
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const reply = sanitizeReply(text);
        if (reply && reply.length >= 10 && reply.split(/\s+/).length >= 3) {
          return reply;
        }
      }
    } catch (e) {
      console.warn('[AutoReply] OpenRouter fallback error:', e.message);
    }
  }

  // Fallback tanggapan spontan jika AI offline
  if (archetype === 'AFFILIATE_CRITIC') {
    const affReplies = [
      'ya maap butuh duit wkwk',
      'namanya juga budak korporat bang butuh nambah bayar kosan wkwk',
      'ya maap namanya juga usaha cari sesuap nasi wkwk',
      'maklumin aja bang in this economy apa aja digas wkwk'
    ];
    return affReplies[Math.floor(Math.random() * affReplies.length)];
  }

  return null;
}

/**
 * Mengambil daftar komentar dari satu media Threads
 */
async function fetchPostComments(mediaId, accessToken) {
  try {
    const url = `${THREADS_API_BASE}/${mediaId}/conversation?fields=id,text,timestamp,username&access_token=${accessToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.warn(`[AutoReply] Gagal fetch comments untuk media ${mediaId}:`, e.message);
    return [];
  }
}

let isScanningReplies = false;

/**
 * Scan seluruh postingan aktif dan jalankan auto-reply secara aman dan terukur
 */
async function runAutoEngagementScan(userId) {
  if (isScanningReplies) {
    console.log('[AutoReply] Scan komentar sedang berjalan di latar belakang, skip duplikasi.');
    return { repliedCount: 0, scannedPosts: 0, skipped: true };
  }
  isScanningReplies = true;

  try {
    const token = getActiveAccessToken();
    if (!token || !userId) {
      console.log('[AutoReply] Token atau userId belum tersedia, skip.');
      return { repliedCount: 0, scannedPosts: 0 };
    }

  const dailyCount = db.getDailyAutoReplyCount();
  if (dailyCount >= MAX_DAILY_REPLIES) {
    console.log(`[AutoReply] Batas harian tercapai (${dailyCount}/${MAX_DAILY_REPLIES} replies). Menunda scan.`);
    return { repliedCount: 0, scannedPosts: 0, reason: 'daily_limit' };
  }

  // Ambil postingan yang tayang dalam 48 jam terakhir
  const recentStories = db.db.prepare(`
    SELECT id, title, threads_media_id, published_at
    FROM stories 
    WHERE status = 'published' AND threads_media_id IS NOT NULL
      AND published_at >= datetime('now', '-48 hours')
    ORDER BY id DESC
    LIMIT 6
  `).all();

  if (recentStories.length === 0) {
    console.log('[AutoReply] Tidak ada postingan aktif dalam 48 jam terakhir.');
    return { repliedCount: 0, scannedPosts: 0 };
  }

  const selfUsername = (process.env.THREADS_USERNAME || 'kikipunyacerita').toLowerCase();
  const ignoredUsernames = [selfUsername, 'kikipunyacerita', 'ceritakikiii', 'kisahkomisi', 'meta.ai', 'meta', 'threads'];

  for (const story of recentStories) {
    if (dailyCount + totalRepliedThisRun >= MAX_DAILY_REPLIES) break;

    const postReplyCount = db.getAutoReplyCountForMedia(story.threads_media_id);
    if (postReplyCount >= MAX_REPLIES_PER_POST) {
      continue; // Sudah cukup membalas di postingan ini
    }

    const comments = await fetchPostComments(story.threads_media_id, token);
    const now = Date.now();

    // Saring kandidat komentar yang valid & urutkan berdasarkan Engagement Value tertinggi
    const candidateComments = comments
      .filter(comment => {
        const author = (comment.username || '').toLowerCase().trim();
        if (!author || ignoredUsernames.includes(author) || author.includes('meta.ai')) return false;

        const textTrim = (comment.text || '').toLowerCase().trim();
        if (!textTrim || textTrim === '@meta.ai' || textTrim === '@meta') return false;

        if (db.isCommentReplied(comment.id)) return false;
        if (db.hasRepliedToUserInMedia(story.threads_media_id, comment.username)) return false;

        const commentTime = new Date(comment.timestamp).getTime();
        const ageMinutes = (now - commentTime) / (1000 * 60);
        if (ageMinutes < MIN_COMMENT_AGE_MINUTES || ageMinutes > (MAX_COMMENT_AGE_HOURS * 60)) return false;

        if (!isCommentSafe(comment.text)) return false;
        return true;
      })
      .map(comment => {
        const archetype = detectCommentArchetype(comment.text);
        let score = 0;
        // Bobot prioritas arketipe: Auditor & Curhat paling memicu viralitas
        if (archetype === 'AUDITOR_EXPENSE') score += 15;
        else if (archetype === 'CURHAT_SHARING') score += 12;
        else if (archetype === 'ASK_LOCATION') score += 10;
        else if (archetype === 'SOCIAL_DILEMMA') score += 8;
        else score += 3;

        // Komentar dengan panjang proporsional (25 - 200 karakter) adalah rentang emas diskusi
        if (comment.text.length >= 25 && comment.text.length <= 200) score += 5;

        return { ...comment, archetype, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const comment of candidateComments) {
      if (dailyCount + totalRepliedThisRun >= MAX_DAILY_REPLIES) break;
      if (postReplyCount + (totalRepliedThisRun) >= MAX_REPLIES_PER_POST) break;

      console.log(`[AutoReply] Memproses komentar terpilih @${comment.username} [Arketipe: ${comment.archetype}, Score: ${comment.score}]: "${comment.text.substring(0, 45)}..."`);

      // 5. Generate balasan AI
      const replyText = await generateEngagementReply(story.title, comment.text, comment.username);
      if (!replyText) continue;

      // 6. Terbitkan balasan ke Threads
      try {
        console.log(`[AutoReply] Menerbitkan balasan ke @${comment.username}: "${replyText}"`);
        const replyMediaId = await publishTextPost(userId, token, replyText, comment.id);

        // 7. Simpan ke database
        db.logAutoReply({
          threadsMediaId: story.threads_media_id,
          commentId: comment.id,
          authorUsername: comment.username,
          commentText: comment.text,
          replyText,
          replyMediaId
        });

        totalRepliedThisRun++;
        console.log(`[AutoReply] Sukses membalas komentar #${comment.id} (Reply ID: ${replyMediaId})`);

        // Jeda 5 detik antar balasan jika ada lebih dari satu
        await new Promise(r => setTimeout(r, 5000));
      } catch (err) {
        console.error(`[AutoReply] Gagal membalas komentar #${comment.id}:`, err.message);
      }
    }
  }

    return {
      repliedCount: totalRepliedThisRun,
      scannedPosts: recentStories.length
    };
  } finally {
    isScanningReplies = false;
  }
}

module.exports = {
  runAutoEngagementScan,
  isCommentSafe,
  isAskingAboutBot,
  generateEngagementReply,
  sanitizeReply,
  detectCommentArchetype
};
