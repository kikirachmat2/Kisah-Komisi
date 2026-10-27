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
 * Generate balasan santai ala Kiki Rachmat (@ceritakikiii)
 * Karakter: Manusia asli, warganet Threads Indonesia, ceplas-ceplos, santai, relate.
 * 
 * PRINSIP PRAGMATIK KOMUNIKASI WARGANET (Anti-Freak & Anti-Survey Bot):
 * 1. ZERO INTERROGATIVE: Dilarang keras bertanya balik ("kamu sendiri pernah?", "menurutmu gimana?").
 * 2. SPONTANEOUS BANTER: Tanggapi dengan celetukan pendek, tawa getir, atau afirmasi (5-14 kata).
 * 3. DILARANG MENGAKU BOT, AI, ATAU FIKSI!
 */
async function generateEngagementReply(storyTitle, netizenComment, authorUsername) {
  if (!netizenComment || !authorUsername) return null;

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), pemilik akun Threads. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Kamu MANUSIA ASLI (bukan bot, bukan AI). Gaya ngetik: santai, ceplas-ceplos, bahasa tongkrongan warganet Threads Indonesia ("gue", "lu", "wkwk", "haha", "anjir", "valid", "relate").

Postingan kamu (Judul: "${storyTitle}")
Netizen (@${authorUsername}) baru saja berkomentar:
"${netizenComment}"

TUGAS: Tuliskan SATU (1) BALASAN SINGKAT (HANYA 5 - 14 KATA).

PANDUAN MUTLAK & ILMIAH SUPAYA TIDAK FREAK / TIDAK TERLIHAT SEPERTI BOT:
1. DILARANG BERTANYA BALIK! (JANGAN PERNAH tanya "kamu sendiri pernah ngalamin?", "menurut lu gimana?", atau bertanya apapun). Warganet asli TIDAK mewawancarai orang di kolom komentar.
2. DILARANG GAYA CUSTOMER SERVICE / SURVEY: Jangan memancing feedback buatan. Cukup beri CELETUKAN SPONTAN, afirmasi tulus, atau tawa getir.
3. JIKA KOMENTAR NORMAL / CURHAT / RELATE:
   - Cukup celetukan santai: "wkwk asli relate bgt ini mah", "valid sih, pusing bgt emang haha", "bener anjir, ga habis pikir gue", "nyesek tapi nyata emang wkwk", "bisa gila kalo dipikirin terus haha".
4. JIKA KOMPLAIN HITUNGAN / MATEMATIKA / DUIT / ANGKA SALAH:
   - DILARANG MENGAKU FIKSI/AI!
   - Ngeles manusiawi santai: "wkwk sori kepleset sejuta kelupaan ketulis buat jajan darurat haha", "haha iya sori otak udah ngebul akhir bulan jeli bener mata lu", "sejuta lagi menguap buat biaya tak terduga yang malu dispill wkwk".
5. JIKA TUDUH BOT / AI ("bot ya?", "ini AI?", "robot"):
   - Bercanda santai manusia warganet: "bukan bot woy haha jari gue masih pegel balesin komen lu nih", "enak aja bot, bot gak bakal relate puyengnya akhir bulan woy wkwk".

ATURAN FORMAT:
- DILARANG TANDA TANYA (?). DILARANG BERTANYA!
- DILARANG EMOJI LEBAY (jangan pakai 😭🥺🙏✨). Cukup teks santai dengan wkwk/haha.
- Output HANYA kalimat balasan langsung tanpa tanda kutip. Huruf kecil santai layaknya ngetik di HP.
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

  let totalRepliedThisRun = 0;
  const ignoredUsernames = ['ceritakikiii', 'kisahkomisi', 'meta.ai', 'meta', 'threads'];

  for (const story of recentStories) {
    if (dailyCount + totalRepliedThisRun >= MAX_DAILY_REPLIES) break;

    const postReplyCount = db.getAutoReplyCountForMedia(story.threads_media_id);
    if (postReplyCount >= MAX_REPLIES_PER_POST) {
      continue; // Sudah cukup membalas di postingan ini
    }

    const comments = await fetchPostComments(story.threads_media_id, token);
    const now = Date.now();

    for (const comment of comments) {
      if (dailyCount + totalRepliedThisRun >= MAX_DAILY_REPLIES) break;
      if (postReplyCount + (totalRepliedThisRun) >= MAX_REPLIES_PER_POST) break;

      // 1. Abaikan komentar dari akun sendiri, Meta AI, atau bot
      const author = (comment.username || '').toLowerCase().trim();
      if (!author || ignoredUsernames.includes(author) || author.includes('meta.ai')) {
        continue;
      }

      // Abaikan jika komentar kosong atau hanya mention bot tanpa teks
      const textTrim = (comment.text || '').toLowerCase().trim();
      if (!textTrim || textTrim === '@meta.ai' || textTrim === '@meta') {
        continue;
      }

      // 2. Abaikan jika sudah pernah dibalas sebelumnya
      if (db.isCommentReplied(comment.id)) {
        continue;
      }

      // 2b. Abaikan jika user ini sudah pernah kita balas di postingan yang sama (cegah spam reply ke 1 orang)
      if (db.hasRepliedToUserInMedia(story.threads_media_id, comment.username)) {
        continue;
      }

      // 3. Cek usia komentar (harus >= 8 menit dan <= 24 jam)
      const commentTime = new Date(comment.timestamp).getTime();
      const ageMinutes = (now - commentTime) / (1000 * 60);
      if (ageMinutes < MIN_COMMENT_AGE_MINUTES || ageMinutes > (MAX_COMMENT_AGE_HOURS * 60)) {
        continue;
      }

      // 4. Guardrail keamanan sentimen
      if (!isCommentSafe(comment.text)) {
        console.log(`[AutoReply] Komentar dari @${comment.username} dilewati (filter sensitif): "${comment.text.substring(0, 30)}..."`);
        continue;
      }

      console.log(`[AutoReply] Menemukan komentar netizen @${comment.username}: "${comment.text.substring(0, 40)}..."`);

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
  sanitizeReply
};
