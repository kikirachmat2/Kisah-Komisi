const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Mempublikasikan satu post ke Threads (Maksimal 500 karakter per post)
 */
async function publishTextPost(userId, accessToken, text, replyToId = null) {
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

  // Tunggu sebentar agar container terdaftar di Meta backend
  await new Promise(r => setTimeout(r, 2000));

  // Publish container (dengan retry jika status container belum READY)
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

    // Tunggu 3 detik sebelum retry publish container
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!publishedId) {
    throw new Error(`Gagal mem-publish postingan Threads: ${JSON.stringify(lastError)}`);
  }

  return publishedId;
}

/**
 * Memecah teks panjang secara cerdas per kalimat utuh (maksimal maxLen karakter)
 * Agar tidak ada kata atau kalimat yang terpotong di tengah jalan.
 */
function splitBySentence(text, maxLen = 450) {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      // Jika satu kalimat saja lebih panjang dari maxLen, terpaksa potong per kata
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
 * Publikasikan seluruh cerita sebagai Thread Bersambung murni (tanpa angka pecahan dan tanpa emot)
 */
async function publishStoryToThreads(userId, accessToken, story) {
  // Pecah semua slide secara cerdas agar tidak terpotong mid-sentence
  const rawParts = story.slides;
  const parts = [];

  for (const p of rawParts) {
    const splitted = splitBySentence(p, 450);
    parts.push(...splitted);
  }

  const totalParts = parts.length;
  console.log(`[Threads] Memulai penerbitan thread serial (${totalParts} parts cerdas)...`);

  // PART 1 (Induk Utama Post) - Murni tulisan mengalir utuh
  const rootPostId = await publishTextPost(userId, accessToken, parts[0]);
  console.log(`[Threads] Post 1 (ROOT) terbit ID: ${rootPostId}`);

  // Seluruh kelanjutan part (2 sampai selesai) selalu di-reply langsung ke rootPostId
  for (let i = 1; i < totalParts; i++) {
    // Delay 6 detik agar reply container Meta siap
    await new Promise(r => setTimeout(r, 6000));

    try {
      const currentReplyId = await publishTextPost(userId, accessToken, parts[i], rootPostId);
      console.log(`[Threads] Reply part ${i + 1} terbit ID: ${currentReplyId}`);
    } catch (err) {
      console.warn(`[Threads] Gagal menerbitkan part ${i + 1}:`, err.message);
    }
  }

  return rootPostId;
}

module.exports = {
  publishTextPost,
  publishStoryToThreads,
  splitBySentence
};
