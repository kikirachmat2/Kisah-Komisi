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
 * Publikasikan seluruh cerita sebagai Thread Bersambung murni (tanpa angka pecahan dan tanpa emot)
 */
async function publishStoryToThreads(userId, accessToken, story) {
  const parts = story.slides;
  const totalParts = parts.length;

  console.log(`[Threads] Memulai penerbitan thread serial (${totalParts} parts)...`);

  // PART 1 (Induk Utama Post) - Murni tulisan mengalir
  const post1Text = parts[0].length > 480 
    ? parts[0].substring(0, 475) + '...' 
    : parts[0];

  const rootPostId = await publishTextPost(userId, accessToken, post1Text);
  console.log(`[Threads] Post 1 (ROOT) terbit ID: ${rootPostId}`);

  // Seluruh kelanjutan part (2 sampai selesai) selalu di-reply langsung ke rootPostId
  for (let i = 1; i < totalParts; i++) {
    // Delay 6 detik agar reply container Meta siap
    await new Promise(r => setTimeout(r, 6000));

    const fullText = parts[i];
    const safePartText = fullText.length > 480 ? fullText.substring(0, 475) + '...' : fullText;

    try {
      const currentReplyId = await publishTextPost(userId, accessToken, safePartText, rootPostId);
      console.log(`[Threads] Reply part ${i + 1} terbit ID: ${currentReplyId}`);
    } catch (err) {
      console.warn(`[Threads] Gagal menerbitkan part ${i + 1}:`, err.message);
    }
  }

  return rootPostId;
}

module.exports = {
  publishTextPost,
  publishStoryToThreads
};
