const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');
const { publishTextPost, getActiveAccessToken } = require('./threads');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * Generate 1 slide update pendek ala Kiki Rachmat (@ceritakikiii)
 * untuk menyundul kembali thread yang mulai melandai di feed For You
 */
async function generateBumpUpdate(story) {
  const prompt = `
Kamu adalah Kiki Rachmat (@ceritakikiii).
Bio kamu: "In this economy mau nulis cerita orang-orang aja lah".
Kamu adalah kurator cerita menfess / curhatan kehidupan nyata anak muda di Threads.

Beberapa jam lalu kamu mengunggah cerita menfess berantai berjudul:
"${story.title}" (Topik: ${story.topic})

Tugasmu: Tuliskan SATU (1) slide balasan singkat (1-2 kalimat, maksimal 180-220 karakter) sebagai "UPDATE KELANJUTAN CERITA" di bawah thread tersebut.

Tujuan:
Menyundul kembali postingan ke puncak algoritma feed Threads seolah-olah kamu baru saja mendapat kabar lanjutan dari pengirim cerita atau merespons reaksi seru netizen di kolom reply.

ATURAN SANGAT KETAT:
1. Awali dengan variasi pembuka santai: "Update dikit:", "Btw ada update lanjutan:", "Banyak yang salfok di komen:", atau "Barusan dapet kabar tambahan:".
2. Nada bicara: Santai, manusiawi, khas tongkrongan Indonesia (contoh: "Update dikit: Ternyata si pelaku udah dipanggil HRD tadi siang dan sekarang lagi nangis-nangis di tangga darurat wkwk. Gimana menurut kalian?").
3. DILARANG KERAS menyebut produk jualan atau menyisipkan link apapun! Murni kelanjutan cerita.
4. Maksimal 220 karakter, jangan terlalu panjang.
5. Output HANYA teks balasan tanpa tanda kutip.
`;

  // 1. Coba Gemini 2.5 Flash
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.75 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (reply) return reply.replace(/^["']|["']$/g, '');
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
          max_tokens: 120,
          temperature: 0.75
        })
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return reply.replace(/^["']|["']$/g, '');
      }
    } catch (e) {
      console.warn('[ThreadBumper] Groq fallback error:', e.message);
    }
  }

  return 'Update dikit: Banyak banget yang DM nanyain kelanjutan kasus ini. Nanti kalau ada kabar baru bakal gue spill lagi di thread ini ya!';
}

/**
 * Mengecek dan mengeksekusi 1 bump cerdas untuk thread yang sedang melandai
 */
async function executeThreadBump(userId) {
  const token = getActiveAccessToken();
  if (!token || !userId) {
    console.log('[ThreadBumper] Kredensial Threads belum lengkap, skip.');
    return null;
  }

  // Cari cerita yang terbit antara 2.5 s/d 6 jam yang lalu dan belum pernah di-bump
  const targetStory = db.getLatestPublishedStoryUnbumped(2.0, 6.0);
  if (!targetStory) {
    console.log('[ThreadBumper] Tidak ada thread yang memenuhi kriteria cooldown untuk di-bump saat ini.');
    return null;
  }

  console.log(`[ThreadBumper] Mempersiapkan bump untuk Cerita #${targetStory.id}: "${targetStory.title}"...`);

  // Generate narasi update
  const bumpText = await generateBumpUpdate(targetStory);

  try {
    // Terbitkan reply di bawah root post dari cerita tersebut
    console.log(`[ThreadBumper] Mempublikasikan bump ke Threads (Parent: ${targetStory.threads_media_id})...`);
    const bumpPostId = await publishTextPost(userId, token, bumpText, targetStory.threads_media_id);

    // Tandai di database agar tidak pernah di-bump dua kali
    db.markStoryBumped(targetStory.id);
    console.log(`[ThreadBumper] SUKSES! Thread #${targetStory.id} berhasil di-bump (Reply ID: ${bumpPostId})`);

    return {
      storyId: targetStory.id,
      title: targetStory.title,
      bumpText,
      bumpPostId,
      rootMediaId: targetStory.threads_media_id
    };
  } catch (err) {
    console.error(`[ThreadBumper] Gagal mempublikasikan bump untuk cerita #${targetStory.id}:`, err.message);
    return null;
  }
}

module.exports = {
  executeThreadBump,
  generateBumpUpdate
};
