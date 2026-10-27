const db = require('./database');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Mengambil token Threads aktif (mengutamakan token terbaru di DB sebelum fallback ke .env)
 */
function getActiveAccessToken() {
  const dbToken = db.getSetting('THREADS_ACCESS_TOKEN');
  return dbToken || process.env.THREADS_ACCESS_TOKEN;
}

/**
 * Auto-refresh token Threads Long-Lived (Perpanjang masa aktif 60 hari lagi)
 */
async function refreshThreadsToken() {
  const currentToken = getActiveAccessToken();
  if (!currentToken) {
    throw new Error('Tidak ada access token Threads yang tersedia di database atau .env.');
  }

  const url = `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${currentToken}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.access_token) {
    db.setSetting('THREADS_ACCESS_TOKEN', data.access_token);
    db.setSetting('THREADS_TOKEN_REFRESHED_AT', new Date().toISOString());
    console.log(`[Threads] Token berhasil di-refresh otomatis! Berlaku hingga ${data.expires_in} detik ke depan.`);
    return data;
  } else {
    throw new Error(`Gagal refresh token Threads: ${JSON.stringify(data)}`);
  }
}

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
      if (data.status === 'ERROR' || data.status === 'EXPIRED') {
        throw new Error(`Container processing error (${data.status}): ${data.error_message || JSON.stringify(data)}`);
      }
    } catch (e) {
      if (e.message.includes('Container processing error')) throw e;
      // Abaikan temporary network error saat polling status
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Mempublikasikan satu post ke Threads (Batas resmi Meta: Maksimal 500 karakter per post/reply)
 * Jika replyToId diisi, post akan menjadi REPLY di bawah post tersebut.
 */
async function publishTextPost(userId, accessToken, text, replyToId = null, topicTag = null) {
  // Selalu prioritaskan token aktif di DB (hasil auto-refresh)
  const tokenToUse = getActiveAccessToken() || accessToken;
  if (!tokenToUse) {
    throw new Error('Access token Threads tidak ditemukan.');
  }

  // Hard limit 500 karakter Meta Threads, amankan di max 485 karakter
  const safeText = text.length > 490 ? text.substring(0, 485) + '...' : text;

  const effectiveUserId = userId || process.env.THREADS_USER_ID || db.getSetting('THREADS_USER_ID') || '28712871241704878';
  const createContainerUrl = `${THREADS_API_BASE}/${effectiveUserId}/threads`;
  const payload = {
    media_type: 'TEXT',
    text: safeText,
    access_token: tokenToUse
  };
  if (replyToId) {
    payload.reply_to_id = replyToId;
  }
  if (topicTag && !replyToId) {
    // Ambil tag pertama jika ada delimiter pipe/koma, bersihkan karakter non-alphanumeric
    const firstTag = String(topicTag).split(/[|,/]/)[0].trim();
    const cleanTag = firstTag.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 50);
    if (cleanTag.length > 0) {
      payload.topic_tag = cleanTag;
    }
  }

  // Percobaan pembuatan container dengan retry bertingkat (3 kali)
  let containerData = null;
  let lastContainerErr = null;

  for (let cAttempt = 1; cAttempt <= 3; cAttempt++) {
    try {
      const containerRes = await fetch(createContainerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(payload)
      });

      const resJson = await containerRes.json();
      if (resJson.id) {
        containerData = resJson;
        break;
      }

      // Deteksi error fatal Meta (190: Auth/Token, 200: Permission, 368: Spam/Block)
      if (resJson.error) {
        const code = resJson.error.code;
        const subcode = resJson.error.error_subcode;
        const msg = resJson.error.message || 'Unknown Meta API error';
        if (code === 190 || code === 200 || code === 368) {
          const fatalErr = new Error(`Meta API Fatal Error [${code}${subcode ? '/' + subcode : ''}]: ${msg}`);
          fatalErr.metaCode = code;
          fatalErr.metaSubcode = subcode;
          throw fatalErr;
        }
      }
      lastContainerErr = resJson;
    } catch (err) {
      if (err.metaCode) throw err;
      lastContainerErr = err.message;
    }
    // Jeda sejenak sebelum retry container
    await new Promise(r => setTimeout(r, 2000 * cAttempt));
  }

  if (!containerData?.id) {
    throw new Error(`Gagal membuat container Threads setelah 3 percobaan: ${JSON.stringify(lastContainerErr)}`);
  }

  // Tunggu container selesai diproses oleh Meta (status === 'FINISHED')
  const isFinished = await waitForContainerFinished(containerData.id, tokenToUse);
  if (!isFinished) {
    throw new Error(`Threads container ${containerData.id} tidak selesai diproses oleh Meta (status timeout/expired).`);
  }

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
          access_token: tokenToUse
        })
      });

      const publishData = await publishRes.json();
      if (publishData.id) {
        publishedId = publishData.id;
        break;
      }

      if (publishData.error) {
        const code = publishData.error.code;
        const subcode = publishData.error.error_subcode;
        const msg = publishData.error.message || 'Unknown Meta publish error';
        if (code === 190 || code === 200 || code === 368) {
          const fatalErr = new Error(`Meta API Publish Fatal Error [${code}${subcode ? '/' + subcode : ''}]: ${msg}`);
          fatalErr.metaCode = code;
          fatalErr.metaSubcode = subcode;
          throw fatalErr;
        }
      }
      lastError = publishData;
    } catch (err) {
      if (err.metaCode) throw err;
      lastError = err.message;
    }

    // Jeda 2 detik jika container masih antre di antrian publishing Meta
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
  const tokenToUse = getActiveAccessToken() || accessToken;
  const url = `${THREADS_API_BASE}/${userId}/threads_publishing_limit?fields=quota_usage,config,reply_quota_usage,reply_config&access_token=${tokenToUse}`;
  const res = await fetch(url);
  return await res.json();
}

/**
 * Memecah teks panjang secara cerdas per kalimat utuh (maksimal maxLen karakter)
 * Menjamin tidak ada kalimat atau link URL yang terpotong di tengah jalan.
 */
function splitBySentence(text, maxLen = 420) {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  // Regex pemecah kalimat cerdas (tidak memecah url https:// atau www.)
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s+|$)|$)/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (sentence.length > maxLen) {
        // Jika satu kalimat utuh melebihi maxLen, pecah per kata dengan aman
        const words = sentence.split(/\s+/);
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
 * Publikasikan seluruh cerita sebagai struktur Thread berantai resmi ("Add to thread"):
 * 1. Post Utama (Root Post) -> HANYA 1 POST UTAMA yang tampil di feed profil akun
 * 2. Seluruh part lanjutan diterbitkan secara sekuensial bersambung (Post 2 reply Post 1, Post 3 reply Post 2, dst.)
 * Menghasilkan garis vertikal thread utuh di aplikasi Threads.
 */
async function publishStoryToThreads(userId, accessToken, story) {
  const tokenToUse = getActiveAccessToken() || accessToken;
  const rawParts = Array.isArray(story.slides) 
    ? story.slides.filter(s => typeof s === 'string' && s.trim().length > 0) 
    : [];
  if (rawParts.length === 0) {
    throw new Error('Daftar slide cerita kosong atau tidak valid.');
  }

  const parts = [];
  for (const p of rawParts) {
    const splitted = splitBySentence(p, 420);
    parts.push(...splitted);
  }

  const totalParts = parts.length;
  console.log(`[Threads] Memulai publikasi thread berantai (${totalParts} parts)...`);

  // PART 1: Post Utama (Root Post)
  const rootPostId = await publishTextPost(userId, tokenToUse, parts[0], null, story.topic_tag || null);
  console.log(`[Threads] Post 1 (ROOT) terbit ID: ${rootPostId}${story.topic_tag ? ` [tag: ${story.topic_tag}]` : ''}`);

  // PART 2 s/d SELESAI: Rantai sekuensial bersambung
  let parentPostId = rootPostId;
  const replyIds = [];

  for (let i = 1; i < totalParts; i++) {
    // Jeda 6 detik antar postingan agar Meta selesai mengindeks parent post
    await new Promise(r => setTimeout(r, 6000));

    try {
      const currentReplyId = await publishTextPost(userId, tokenToUse, parts[i], parentPostId);
      replyIds.push(currentReplyId);
      console.log(`[Threads] Chained Part ${i + 1}/${totalParts} terbit ID: ${currentReplyId} (reply to ID: ${parentPostId})`);
      parentPostId = currentReplyId;
    } catch (err) {
      console.warn(`[Threads] Gagal menyambungkan part ${i + 1}:`, err.message);
      // Jika satu part gagal, tetap coba sambungkan part berikutnya ke parent terakhir
    }
  }

  // Ambil official permalink langsung dari Meta Graph API agar URL 100% valid
  const officialPermalink = await fetchPostPermalink(rootPostId, tokenToUse);

  return {
    rootPostId,
    lastPostId: parentPostId,
    replyIds,
    permalink: officialPermalink || `https://www.threads.net/@${process.env.THREADS_USERNAME || 'kikipunyacerita'}`
  };
}

/**
 * Mengambil insight performa akun Threads secara keseluruhan (views, likes, replies, reposts, quotes)
 */
async function getAccountInsights(userId, accessToken) {
  const tokenToUse = getActiveAccessToken() || accessToken;
  const url = `https://graph.threads.net/v1.0/${userId}/threads_insights?metric=views,likes,replies,reposts,quotes&access_token=${tokenToUse}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal mengambil account insights: HTTP ${res.status} - ${errText}`);
  }
  return await res.json();
}

/**
 * Mengambil insight performa satu post / thread tertentu
 */
async function getMediaInsights(mediaId, accessToken) {
  const tokenToUse = getActiveAccessToken() || accessToken;
  const url = `https://graph.threads.net/v1.0/${mediaId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${tokenToUse}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal mengambil media insights: HTTP ${res.status} - ${errText}`);
  }
  return await res.json();
}

/**
 * Menghapus satu postingan Threads berdasarkan Media ID (membutuhkan permission threads_delete)
 */
async function deletePost(mediaId, accessToken = null) {
  const tokenToUse = getActiveAccessToken() || accessToken;
  if (!tokenToUse) throw new Error('Access token tidak tersedia.');

  const url = `${THREADS_API_BASE}/${mediaId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokenToUse}`
    }
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Gagal delete post (HTTP ${res.status})`);
  }
  return data;
}

/**
 * Mengambil official permalink postingan langsung dari Meta Threads Graph API
 */
async function fetchPostPermalink(mediaId, accessToken = null) {
  if (!mediaId) return null;
  const tokenToUse = getActiveAccessToken() || accessToken;
  if (!tokenToUse) return null;
  try {
    const res = await fetch(`${THREADS_API_BASE}/${mediaId}?fields=permalink&access_token=${tokenToUse}`);
    if (res.ok) {
      const data = await res.json();
      if (data.permalink) return data.permalink;
    }
  } catch (e) {
    // Abaikan jika offline / network glitch
  }
  return null;
}

/**
 * Mengonversi numeric Threads Media ID menjadi Base64 shortcode URL
 * Menghasilkan link yang valid dan bisa langsung dibuka tanpa redirect ke 'invalid_post'
 */
function mediaIdToShortcode(mediaId) {
  if (!mediaId) return '';
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = BigInt(String(mediaId).trim());
    let shortcode = '';
    while (id > 0n) {
      const remainder = Number(id % 64n);
      shortcode = alphabet[remainder] + shortcode;
      id = id / 64n;
    }
    return shortcode;
  } catch (e) {
    return mediaId;
  }
}

function getPostUrl(mediaId, username = (process.env.THREADS_USERNAME || 'kikipunyacerita')) {
  return `https://www.threads.net/@${username}`;
}

/**
 * Mengambil jumlah reply organik HANYA dari akun netizen lain (mengecualikan self-replies akun sendiri)
 * Menghilangkan bias inherent pada Format B (yang secara default memiliki 2 reply bersambung buatan sendiri)
 */
async function getExternalReplyCount(mediaId, myUsername = (process.env.THREADS_USERNAME || 'kikipunyacerita'), accessToken = null) {
  if (!mediaId) return 0;
  const tokenToUse = getActiveAccessToken() || accessToken;
  if (!tokenToUse) return 0;
  try {
    let url = `${THREADS_API_BASE}/${mediaId}/conversation?fields=id,username&access_token=${tokenToUse}`;
    let externalCount = 0;
    let pageCount = 0;

    while (url && pageCount < 5) {
      pageCount++;
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      if (!json.data || !Array.isArray(json.data)) break;

      const external = json.data.filter(r => r.username && r.username.toLowerCase() !== myUsername.toLowerCase());
      externalCount += external.length;

      // Handle pagination if conversation has more items
      url = json.paging?.next || null;
    }

    return externalCount;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  publishTextPost,
  publishStoryToThreads,
  splitBySentence,
  getPublishingLimit,
  getActiveAccessToken,
  refreshThreadsToken,
  getAccountInsights,
  getMediaInsights,
  getExternalReplyCount,
  deletePost,
  mediaIdToShortcode,
  fetchPostPermalink,
  getPostUrl
};
