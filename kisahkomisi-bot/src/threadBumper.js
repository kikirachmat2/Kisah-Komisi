const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { publishTextPost, getActiveAccessToken } = require('./threads');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Validasi ketat agar teks update tidak buntung / kepotong
 */
function isValidBump(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length < 50 || clean.length > 450) return false;
  // Wajib punya minimal 8 kata
  if (clean.split(/\s+/).length < 8) return false;
  // Wajib diakhiri tanda baca lengkap (tidak boleh terpotong di tengah jalan)
  if (!/[.!?]$/.test(clean)) return false;
  // Tidak boleh cuma kalimat awalan
  if (/^(update dikit|btw ada|barusan dapet|banyak yang salfok)\s*:?\s*$/i.test(clean)) return false;
  return true;
}

/**
 * Generate 1 slide update pendek ala Kiki Rachmat (@ceritakikiii)
 * untuk menyundul kembali thread yang mulai melandai di feed For You
 */
async function generateBumpUpdate(story) {
  // Selama eksperimen, Thread Bumper dinonaktifkan 100%
  if (process.env.EXPERIMENT_PAUSE_EXTRAS !== 'false') {
    return null;
  }

  const prompt = `
Kamu adalah kurator di Threads @ceritakikiii. Bio: "In this economy mau nulis cerita orang-orang aja lah".
Utas sebelumnya berjudul: "${story.title}" (Topik: ${story.topic}).

Tugas: Tuliskan SATU (1) balasan tindak lanjut netral (1-2 kalimat, panjang 80-160 karakter).
ATURAN KETAT INTEGRITAS:
1. DILARANG KERAS mengarang kelanjutan fiktif seolah dapat kabar lanjutan (dilarang bilang 'pelaku nangis', 'dapet kabar baru', dsb).
2. DILARANG menggunakan klausa palsu seperti 'Banyak yang salfok di komen:'.
3. Balasan HANYA berupa pertanyaan lanjutan seputar dilema atau perspektif alternatif bagi warganet yang baru membaca utas ini.
4. Nol link, nol promosi produk.
5. Output HANYA teks balasan langsung tanpa tanda kutip.
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
            maxOutputTokens: 600,
            temperature: 0.75,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidBump(clean)) return clean;
        console.warn(`[ThreadBumper] Hasil Gemini tidak lolos validasi ("${clean}"), mencoba Groq...`);
      }
    } catch (e) {
      console.warn('[ThreadBumper] Gemini rate limit/error, mencoba Groq...');
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
          max_tokens: 300,
          temperature: 0.75
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidBump(clean)) return clean;
        console.warn(`[ThreadBumper] Hasil Groq tidak lolos validasi ("${clean}").`);
      }
    } catch (e) {
      console.warn('[ThreadBumper] Groq fallback error:', e.message);
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
          max_tokens: 300,
          temperature: 0.75
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const clean = text ? text.replace(/^["']|["']$/g, '').trim() : '';
        if (isValidBump(clean)) return clean;
        console.warn(`[ThreadBumper] Hasil OpenRouter tidak lolos validasi ("${clean}").`);
      }
    } catch (e) {
      console.warn('[ThreadBumper] OpenRouter fallback error:', e.message);
    }
  }

  // Fallback aman dan utuh jika AI error
  const fallbacks = [
    'Update dikit: Banyak obrolan sana-sini yang nanyain kelanjutan kasus ini. Ternyata masalahnya udah mulai dimediasi sama pihak terkait tadi sore. Semoga ada solusi adil!',
    'Btw ada update lanjutan: Katanya si empunya cerita udah mutusin buat ambil sikap tegas setelah baca saran-saran di komen. Makasih banyak buat yang udah kasih insight!',
    'Barusan dapet kabar tambahan: Cerita ini ternyata rame dibahas di kantor sebelah juga. Realita dunia kerja emang kadang lebih drama dari sinetron wkwk. Tetap semangat pejuang rupiah!'
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Mengecek dan mengeksekusi 1 bump cerdas untuk thread yang sedang melandai
 * WAJIB reply ke last_media_id agar terbit sebagai "Add to thread" bersambung, bukan comment reply biasa.
 */
async function executeThreadBump(userId) {
  const token = getActiveAccessToken();
  if (!token || !userId) {
    console.log('[ThreadBumper] Kredensial Threads belum lengkap, skip.');
    return null;
  }

  // Cari cerita yang terbit antara 2.0 s/d 6 jam yang lalu dan belum pernah di-bump
  const targetStory = db.getLatestPublishedStoryUnbumped(2.0, 6.0);
  if (!targetStory) {
    console.log('[ThreadBumper] Tidak ada thread yang memenuhi kriteria cooldown untuk di-bump saat ini.');
    return null;
  }

  console.log(`[ThreadBumper] Mempersiapkan bump untuk Cerita #${targetStory.id}: "${targetStory.title}"...`);

  // Targetkan part terakhir agar Threads merendernya sebagai sambungan garis vertikal ("Add to thread")
  const parentPostId = targetStory.last_media_id || targetStory.threads_media_id;
  console.log(`[ThreadBumper] Target parent post untuk 'Add to thread': ${parentPostId} (Root: ${targetStory.threads_media_id})`);

  // Generate narasi update utuh
  const bumpText = await generateBumpUpdate(targetStory);
  if (!bumpText) {
    console.log('[ThreadBumper] Bump update dinonaktifkan atau kosong, lewati proses bump.');
    return null;
  }

  try {
    console.log(`[ThreadBumper] Mempublikasikan sambungan bump ke Threads di bawah parent ID: ${parentPostId}...`);
    const bumpPostId = await publishTextPost(userId, token, bumpText, parentPostId);

    // Tandai di database agar tidak pernah di-bump dua kali dan perbarui last_media_id
    db.markStoryBumped(targetStory.id);
    db.updateStoryLastMediaId(targetStory.id, bumpPostId);
    console.log(`[ThreadBumper] SUKSES! Thread #${targetStory.id} berhasil di-bump sambung (Post ID: ${bumpPostId})`);

    return {
      storyId: targetStory.id,
      title: targetStory.title,
      bumpText,
      bumpPostId,
      rootMediaId: targetStory.threads_media_id,
      parentPostId
    };
  } catch (err) {
    console.error(`[ThreadBumper] Gagal mempublikasikan bump untuk cerita #${targetStory.id}:`, err.message);
    return null;
  }
}

module.exports = {
  executeThreadBump,
  generateBumpUpdate,
  isValidBump
};
