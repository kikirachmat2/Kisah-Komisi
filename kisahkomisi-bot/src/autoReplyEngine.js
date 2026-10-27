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

// Filter kata toxic / SARA / spam (sistem tidak membalas komentar toxic)
const TOXIC_KEYWORDS = [
  'judi', 'slot', 'gacor', 'open bo', 'porn', 'bokep', 'sange', 'bugil',
  'anjing', 'babi', 'tolol', 'goblok', 'bangsat', 'kontol', 'memek',
  'jokowi', 'prabowo', 'gibran', 'anies', 'ganjar', 'pemerintah', 'politik',
  'agama', 'islam', 'kristen', 'kafir', 'sesat'
];

function isCommentSafe(text) {
  if (!text || text.length < 3) return false;
  const lower = text.toLowerCase();
  for (const word of TOXIC_KEYWORDS) {
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
 * Filter ketat: Menjamin balasan 100% manusia asli dan tidak ada bocoran AI/fiksi.
 */
function sanitizeReply(text) {
  if (!text) return null;
  let clean = text.replace(/^["']|["']$/g, '').trim();

  // Deteksi jika LLM masih mencoba mengaku AI / Bot / Fiksi
  const forbiddenPatterns = [
    /saya (adalah )?(sebuah )?(ai|bot|robot|model)/i,
    /bantuan ai/i,
    /cerita(nya)? fiksi/i,
    /ditulis (oleh|dengan) ai/i,
    /dibuat (oleh|dengan) ai/i,
    /sebagai ai/i,
    /as an ai/i,
    /kecerdasan buatan/i,
    /\bfiksi\b/i
  ];

  for (const pat of forbiddenPatterns) {
    if (pat.test(clean)) {
      console.warn(`[AutoReply] Sanitizer menolak balasan karena terdeteksi pengakuan AI/fiksi: "${clean}"`);
      return 'Bukan bot woy haha, ini gue adminnya lagi mantau sambil ngopi wkwk';
    }
  }

  return clean;
}

/**
 * Generate balasan santai ala Kiki Rachmat (@ceritakikiii)
 * Karakter: Manusia asli, kurator Threads, santai, ceplas-ceplos, relatable.
 * DILARANG KERAS MENGAKU BOT, AI, ATAU FIKSI!
 */
async function generateEngagementReply(storyTitle, netizenComment, authorUsername) {
  if (!netizenComment || !authorUsername) return null;

  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii), pemilik akun dan kurator Threads. Bio akun kamu: "In this economy mau nulis cerita orang-orang aja lah".
Kamu adalah MANUSIA ASLI (bukan bot, bukan robot, bukan AI). Gaya bicaramu santai, ramah, ceplas-ceplos khas warganet Threads Indonesia ("gue", "lu", "wkwk", "haha").

Postingan kamu (Judul: "${storyTitle}")
Netizen (@${authorUsername}) baru saja berkomentar:
"${netizenComment}"

Tuliskan 1 BALASAN SINGKAT (1-2 kalimat pendek, 10-25 kata) untuk membalas netizen tersebut.

PANDUAN KHUSUS SESUAI SITUASI:
1. JIKA NETIZEN MENUDUH / TANYA INI BOT ATAU AI ("bot ya?", "ini AI?", "robot", "otomatis", dll):
   - DILARANG KERAS MENGAKU BOT ATAU AI! DILARANG MENYEBUT FIKSI ATAU BANTUAN AI!
   - Jawab santai bercanda layaknya manusia asli warganet:
     Contoh: "Bukan bot woy haha, ini gue adminnya masih napas lagi mantau sambil ngopi wkwk", "Sembarangan dibilang bot, jari gue masih pegel balesin komen lu nih wkwk", "Enak aja bot, bot gak bakal relate puyengnya akhir bulan woy wkwk".
2. JIKA NETIZEN KOMPLAIN HITUNGAN / MATEMATIKA SALAH / DUIT ILANG / NANYA META.AI SOAL HITUNGAN ("salah hitung tuh", "sisanya beda", "duit sejuta kemana", "@meta.ai berapa", dll):
   - DILARANG KERAS MENGAKU FIKSI ATAU AI!
   - Jawab santai, ngeles relatable layaknya manusia yang khilaf ngetik atau ada pengeluaran tak terduga yang kelupaan masuk list:
     Contoh: "Wkwk jeli bener mata lu, sori kepleset sejuta lagi kelupaan ketulis buat bayar cicilan/darurat wkwk", "Haha iya sori otak udah ngebul akhir bulan, sejuta lagi kepotong buat jajan bocah kelupaan masuk list wkwk", "Wkwk buset jeli amat, sejuta lagi menguap buat biaya tak terduga yang malu dispill wkwk".
3. JIKA KOMENTAR NORMAL / CURHAT / SARAN:
   - Balas dengan empati santai / celetukan warganet dan ajukan pertanyaan pancingan pendek agar diskusi berlanjut (misal: "Wkwk bener banget, lu sendiri pernah di posisi kayak gitu juga gak?", "Nah ini, serba salah emang. Menurut lu solusinya gimana?").

ATURAN KETAT:
- DILARANG MENGAKU BOT, DILARANG MENGAKU AI, DILARANG MENGAKU FIKSI.
- DILARANG gaya bahasa kaku seperti customer service (jangan gunakan kata formal seperti "mohon maaf atas ketidaknyamanan").
- DILARANG promosi produk atau menyisipkan link apapun.
- Output HANYA teks balasan langsung tanpa tanda kutip.
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

/**
 * Scan seluruh postingan aktif dan jalankan auto-reply secara aman dan terukur
 */
async function runAutoEngagementScan(userId) {
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
}

module.exports = {
  runAutoEngagementScan,
  isCommentSafe,
  isAskingAboutBot,
  generateEngagementReply
};
