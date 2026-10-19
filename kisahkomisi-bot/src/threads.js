const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Mempublikasikan teks tunggal / thread ke Threads
 */
async function publishTextPost(userId, accessToken, text) {
  // 1. Buat media container teks
  const createContainerUrl = `${THREADS_API_BASE}/${userId}/threads`;
  const containerRes = await fetch(createContainerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'TEXT',
      text: text,
      access_token: accessToken
    })
  });

  const containerData = await containerRes.json();
  if (!containerData.id) {
    throw new Error(`Gagal membuat container Threads: ${JSON.stringify(containerData)}`);
  }

  // 2. Publish container
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
 * Balas / reply ke postingan (untuk menaruh link affiliate Shopee di komentar pertama)
 */
async function replyToPost(userId, accessToken, parentPostId, replyText) {
  const createContainerUrl = `${THREADS_API_BASE}/${userId}/threads`;
  const containerRes = await fetch(createContainerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'TEXT',
      text: replyText,
      reply_to_id: parentPostId,
      access_token: accessToken
    })
  });

  const containerData = await containerRes.json();
  if (!containerData.id) {
    console.warn(`Gagal membuat reply container: ${JSON.stringify(containerData)}`);
    return null;
  }

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
  return publishData.id || null;
}

/**
 * Publikasikan seluruh cerita (Slide 1 sebagai post utama, lalu reply berantai atau link di first comment)
 */
async function publishStoryToThreads(userId, accessToken, story) {
  // Format Post Utama: Hook + Slide 1-3
  let mainPostText = `✨ ${story.title.toUpperCase()}\n\n`;
  mainPostText += `[Slide 1/12]\n${story.slides[0]}\n\n`;
  mainPostText += `[Slide 2/12]\n${story.slides[1]}\n\n`;
  mainPostText += `👇 (Lanjutan cerita di bawah thread ini...)`;

  const mainPostId = await publishTextPost(userId, accessToken, mainPostText);
  console.log(`[Threads] Post utama berhasil terbit ID: ${mainPostId}`);

  // Tunggu jeda 2 detik agar tidak kena rate limit
  await new Promise(r => setTimeout(r, 2000));

  // Auto-reply komentar pertama: Link Produk Shopee Affiliate
  if (story.product_name && story.product_url) {
    const affiliateReply = `🛒 Buat yang nanya barang yang gw sebut di cerita (${story.product_name}), gw belinya di toko ini ya (lagi diskon):\n👉 ${story.product_url}\n\nSemoga membantu! ✨`;
    await replyToPost(userId, accessToken, mainPostId, affiliateReply);
    console.log(`[Threads] Auto-reply link affiliate berhasil terkirim!`);
  }

  return mainPostId;
}

module.exports = {
  publishTextPost,
  replyToPost,
  publishStoryToThreads
};
