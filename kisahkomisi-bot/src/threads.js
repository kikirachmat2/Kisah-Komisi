const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Menunggu container Threads berstatus 'FINISHED' di server Meta
 * Status yang mungkin: IN_PROGRESS, FINISHED, ERROR, EXPIRED
 */
async function waitForContainerFinished(containerId, accessToken, maxAttempts = 15) {
  const statusUrl = `${THREADS_API_BASE}/${containerId}?fields=status,error_message&access_token=${accessToken}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(statusUrl);
      const data = await res.json();
      if (data.status === 'FINISHED') {
        return true;
      }
      if (data.status === 'ERROR') {
        throw new Error(`Container processing error: ${data.error_message || JSON.stringify(data)}`);
      }
    } catch (e) {
      // Abaikan temporary error saat polling
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Mempublikasikan satu post ke Threads (Batas resmi Meta: Maksimal 500 karakter per post/reply)
 * Jika replyToId diisi, post akan menjadi REPLY di bawah post tersebut (tidak mengotori feed profil).
 */
async function publishTextPost(userId, accessToken, text, replyToId = null) {
  // Hard limit 500 karakter Meta Threads, jaga aman di max 480 karakter
  const safeText = text.length > 490 ? text.substring(0, 485) + '...' : text;

  const createContainerUrl = `${THREADS_API_BASE}/${userId}/threads`;
  const payload = {
    media_type: 'TEXT',
    text: safeText,
    access_token: accessToken
  };
  if (replyToId) {
    payload.reply_to_id = replyToId;
  }

  const containerRes = await fetch(createContainerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const containerData = await containerRes.json();
  if (!containerData.id) {
    throw new Error(`Gagal membuat container Threads: ${JSON.stringify(containerData)}`);
  }

  // Tunggu container selesai diproses oleh Meta (status === 'FINISHED')
  await waitForContainerFinished(containerData.id, accessToken);

  // Publish container
  const publishUrl = `${THREADS_API_BASE}/${userId}/threads_publish`;
  let publishedId = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const publishRes = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: accessToken
        })
      });

      const publishData = await publishRes.json();
      if (publishData.id) {
        publishedId = publishData.id;
        break;
      }
      lastError = publishData;
    } catch (err) {
      lastError = err.message;
    }

    // Jeda 2 detik jika container masih antre
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!publishedId) {
    throw new Error(`Gagal mem-publish postingan Threads: ${JSON.stringify(lastError)}`);
  }

  return publishedId;
}

/**
 * Cek kuota publikasi akun Threads dari Meta API (Limit: 250 post baru & 1.000 reply per 24 jam)
 */
async function getPublishingLimit(userId, accessToken) {
  const url = `${THREADS_API_BASE}/${userId}/threads_publishing_limit?fields=quota_usage,config,reply_quota_usage,reply_config&access_token=${accessToken}`;
  const res = await fetch(url);
  return await res.json();
}

/**
 * Memecah teks panjang secara cerdas per kalimat utuh (maksimal maxLen karakter)
 * Menjamin tidak ada kalimat atau kata yang terpotong di tengah jalan.
 */
function splitBySentence(text, maxLen = 420) {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (sentence.length > maxLen) {
        const words = sentence.split(' ');
        let wordChunk = '';
        for (const w of words) {
          if ((wordChunk + ' ' + w).length <= maxLen) {
            wordChunk += (wordChunk ? ' ' : '') + w;
          } else {
            if (wordChunk.trim()) chunks.push(wordChunk.trim());
            wordChunk = w;
          }
        }
        current = wordChunk;
      } else {
        current = sentence;
      }
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Publikasikan seluruh cerita sebagai struktur Thread resmi:
 * 1. Post Utama (Root Post) -> HANYA 1 POST UTAMA yang tampil di feed profil akun
 * 2. Seluruh part lanjutan diterbitkan sebagai REPLIES di bawah Post Utama tersebut
 */
async function publishStoryToThreads(userId, accessToken, story) {
  // Pecah semua slide secara cerdas agar aman di bawah limit 500 karakter Meta
  const rawParts = story.slides;
  const parts = [];

  for (const p of rawParts) {
    const splitted = splitBySentence(p, 420);
    parts.push(...splitted);
  }

  const totalParts = parts.length;
  console.log(`[Threads] Memulai publikasi thread (${totalParts} parts)...`);

  // PART 1: Post Utama (Root Post)
  const rootPostId = await publishTextPost(userId, accessToken, parts[0]);
  console.log(`[Threads] Post 1 (ROOT / Pembuka) terbit ID: ${rootPostId}`);

  // PART 2 s/d SELESAI: Terbit berurutan dengan menyambung ke part sebelumnya (Persis fitur "Add to thread")
  // Post 2 reply ke Post 1 -> Post 3 reply ke Post 2 -> Post 4 reply ke Post 3, dst.
  // Ini yang membuat GARIS VERTIKAL THREAD menyambung utuh dari awal sampai akhir!
  let parentPostId = rootPostId;
  const replyIds = [];

  for (let i = 1; i < totalParts; i++) {
    // Jeda 6 detik antar postingan agar Meta selesai mengindeks parent post
    await new Promise(r => setTimeout(r, 6000));

    try {
      const currentReplyId = await publishTextPost(userId, accessToken, parts[i], parentPostId);
      replyIds.push(currentReplyId);
      console.log(`[Threads] Chained Part ${i + 1}/${totalParts} terbit ID: ${currentReplyId} (tersambung ke ID: ${parentPostId})`);
      parentPostId = currentReplyId; // Sambungkan part berikutnya ke part yang baru saja terbit!
    } catch (err) {
      console.warn(`[Threads] Gagal menyambungkan part ${i + 1}:`, err.message);
      // Jika satu gagal, tetap coba sambungkan part berikutnya ke parent terakhir yang berhasil
    }
  }

  return rootPostId;
}

module.exports = {
  publishTextPost,
  publishStoryToThreads,
  splitBySentence,
  getPublishingLimit
};
