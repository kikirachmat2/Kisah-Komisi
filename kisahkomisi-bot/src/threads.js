const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Mempublikasikan satu post ke Threads (Maksimal 500 karakter per post)
 */
async function publishTextPost(userId, accessToken, text, replyToId = null) {
  // Potong aman di 490 karakter jika terlewat batas
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

  // Publish container
  const publishUrl = `${THREADS_API_BASE}/${userId}/threads_publish`;
  const publishRes = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerData.id,
      access_token: accessToken
    })
  });

  const publishData = await publishRes.json();
  if (!publishData.id) {
    throw new Error(`Gagal mem-publish postingan Threads: ${JSON.stringify(publishData)}`);
  }

  return publishData.id;
}

/**
 * Publikasikan seluruh cerita sebagai Thread Bersambung (Serial Post 1/N, 2/N ... dst)
 */
async function publishStoryToThreads(userId, accessToken, story) {
  const parts = story.slides;
  const totalParts = parts.length;

  console.log(`[Threads] Memulai penerbitan thread serial (${totalParts} parts)...`);

  // PART 1 (Induk Utama Post)
  const part1Header = `🧵 [1/${totalParts}] ${story.title.toUpperCase()}\n\n`;
  const part1Body = parts[0];
  const post1Text = (part1Header + part1Body).length > 480 
    ? part1Header + part1Body.substring(0, 480 - part1Header.length) + '...' 
    : part1Header + part1Body;

  const rootPostId = await publishTextPost(userId, accessToken, post1Text);
  console.log(`[Threads] Post 1/${totalParts} (ROOT) terbit ID: ${rootPostId}`);

  let lastPostId = rootPostId;

  // Seluruh kelanjutan part (2 sampai 8) selalu di-reply langsung ke rootPostId
  for (let i = 1; i < totalParts; i++) {
    // Delay 5 detik agar Meta container selesai terindeks
    await new Promise(r => setTimeout(r, 5000));

    const partHeader = `[${i + 1}/${totalParts}]\n`;
    const fullText = partHeader + parts[i];
    const safePartText = fullText.length > 480 ? fullText.substring(0, 475) + '...' : fullText;

    try {
      const currentReplyId = await publishTextPost(userId, accessToken, safePartText, rootPostId);
      console.log(`[Threads] Post ${i + 1}/${totalParts} terbit ID: ${currentReplyId}`);
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
