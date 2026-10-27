const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const { generateStory, processAnonymousStory } = require('./aiStory');
const { replenishStockBuffer, produceCuratedStory, auditAffiliateLinks } = require('./editorialBoard');
const { 
  trackAllInsights, 
  analyzePerformanceAndStrategize, 
  generateInsightReportMarkdown,
  syncNicheAnalytics,
  evaluateAndLockWinningNiches
} = require('./growthEngine');
const { 
  publishStoryToThreads, 
  getPublishingLimit, 
  getActiveAccessToken, 
  refreshThreadsToken,
  deletePost,
  getPostUrl,
  getExternalReplyCount
} = require('./threads');
const { runAutoEngagementScan } = require('./autoReplyEngine');
const { executeThreadBump } = require('./threadBumper');
const { executeHotTake } = require('./hotTakesEngine');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('FATAL ERROR: BOT_TOKEN belum diset di file .env');
  process.exit(1);
}

const bot = new Telegraf(token);

// Middleware whitelist user (mendukung user ID angka maupun username @username)
const allowedUsers = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(s => s.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

bot.use(async (ctx, next) => {
  const fromId = ctx.from ? String(ctx.from.id) : null;
  const username = ctx.from && ctx.from.username ? ctx.from.username.toLowerCase() : null;
  
  if (allowedUsers.length > 0) {
    const isAllowed = 
      (fromId && allowedUsers.includes(fromId.toLowerCase())) || 
      (username && allowedUsers.includes(username));

    if (!isAllowed) {
      console.warn(`[Security] Unauthorized access attempt from ID: ${fromId} (@${ctx.from?.username || 'no_username'})`);
      return ctx.reply('⚠️ Maaf, Anda tidak memiliki akses ke bot Kisah Komisi ini.');
    }
  }

  // Simpan ID chat admin aktif terakhir agar cron job terjadwal bisa mengirim notifikasi
  if (ctx.chat?.id) {
    db.setSetting('LAST_ADMIN_CHAT_ID', ctx.chat.id);
  }

  return next();
});

// Format mata uang Rupiah
function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

// Kirim notifikasi / alert ke Telegram admin (Return boolean status)
async function sendAdminAlert(text, extra = {}) {
  const adminChatId = process.env.ADMIN_CHAT_ID || db.getSetting('LAST_ADMIN_CHAT_ID');
  if (!adminChatId) {
    console.log('[Alert] Tidak ada adminChatId yang terdaftar untuk menerima alert.');
    return false;
  }
  try {
    await bot.telegram.sendMessage(adminChatId, text, { parse_mode: 'Markdown', ...extra });
    return true;
  } catch (e) {
    console.warn('[Alert] Gagal kirim markdown ke admin, fallback plain text:', e.message);
    try {
      const plain = text.replace(/[*_`\[\]()]/g, '');
      const cleanExtra = { ...extra };
      delete cleanExtra.parse_mode;
      await bot.telegram.sendMessage(adminChatId, plain, cleanExtra);
      return true;
    } catch (err2) {
      console.warn('[Alert] Gagal mengirim notifikasi ke admin:', err2.message);
      return false;
    }
  }
}

// Helper untuk mengirim pesan markdown dengan aman (fallback plain text jika ada formatting error)
async function safeReplyMarkdown(ctx, text, extra = {}) {
  try {
    return await ctx.replyWithMarkdown(text, extra);
  } catch (err) {
    console.warn('[Telegram] Gagal replyWithMarkdown, fallback ke plain text:', err.message);
    const plain = text.replace(/[*_`\[\]()]/g, '');
    const cleanExtra = { ...extra };
    delete cleanExtra.parse_mode;
    return await ctx.reply(plain, cleanExtra);
  }
}

/**
 * Filter pra-publikasi: Membersihkan 100% label fiksi/AI dan delimiter tag sebelum dikirim ke Meta API
 */
function sanitizeStoryBeforePublish(story) {
  let parsedSlides = [];
  try {
    parsedSlides = typeof story.slides_json === 'string' ? JSON.parse(story.slides_json) : (story.slides || []);
  } catch (e) {
    parsedSlides = story.slides || [];
  }

  // Bersihkan segala bentuk label [Cerita Fiksi], (Cerita Fiksi), disclaimer fiksi/AI, dan frasa DM di semua slide
  const cleanSlides = parsedSlides.map(slide => {
    return (slide || '')
      .replace(/\[\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\]/gi, '')
      .replace(/\(\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\)/gi, '')
      .replace(/^.*?(disclaimer|catatan|peringatan)\s*:\s*.*?(fiksi|fiktif|karangan|buatan ai).*$/gim, '')
      .replace(/cerita ini (hanya )?(fiksi|rekaan|karangan|buatan ai)/gi, '')
      .replace(/\b(masuk\s*dm|kiriman\s*dm|spill\s*di\s*dm)\b/gi, 'denger dari obrolan sana-sini')
      .replace(/^[\s\n\r*_-]+/, '')
      .trim();
  }).filter(Boolean);

  // Bersihkan topic_tag dari delimiter pipe, koma, spasi
  let cleanTopicTag = null;
  if (story.topic_tag) {
    const firstTag = String(story.topic_tag).split(/[|,/]/)[0].trim();
    cleanTopicTag = firstTag.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 50) || null;
  }

  return {
    ...story,
    slides: cleanSlides,
    topic_tag: cleanTopicTag
  };
}

// Kirim backup file database SQLite ke Telegram admin
async function sendDatabaseBackup(targetChatId = null) {
  const chatId = targetChatId || process.env.ADMIN_CHAT_ID || db.getSetting('LAST_ADMIN_CHAT_ID');
  if (!chatId) {
    console.log('[Backup] Tidak ada chatId untuk mengirim backup.');
    return false;
  }

  const dbFile = db.getDbPath();
  if (!fs.existsSync(dbFile)) {
    console.warn('[Backup] File database tidak ditemukan di path:', dbFile);
    return false;
  }

  const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try {
    await bot.telegram.sendDocument(chatId, {
      source: dbFile,
      filename: `kisahkomisi-backup-${now}.db`
    }, {
      caption: `💾 *Backup Database Otomatis Kisah Komisi*\n📅 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\nFile ini berisi seluruh antrean cerita, histori komisi, dan data produk affiliate.`
    });
    console.log('[Backup] Database berhasil dikirim ke Telegram.');
    return true;
  } catch (e) {
    console.error('[Backup] Gagal mengirim database:', e.message);
    return false;
  }
}

// Command: /start & /help
function renderHelpMenu(name = 'Kawan') {
  return (
    `👋 Halo *${name}*! Selamat datang di *Kisah Komisi Autopilot Engine*.\n\n` +
    `🚀 *Strategi Autopilot (6 Post/Hari + Jitter Alami):*\n` +
    `• *3 Slot Insight Organik*: Hot Take, Menfess Spill, Financial Breakdown (0% link, dongkrak jangkauan & repost)\n` +
    `• *3 Slot Shopee Affiliate*: Cerita kontekstual, anchoring under 50rb, 2-kubu closing bait\n\n` +
    `🤖 *Kontrol Otomatisasi Threads:*\n` +
    `• \`/insight\` : Cek analitik penayangan & evaluasi tren terkini\n` +
    `• \`/veto\` : Batalkan penerbitan draf dalam 15-menit veto window\n` +
    `• \`/bikin_cerita\` : AI buat 1 cerita menfess viral (Lolos Kurasi QC)\n` +
    `• \`/isi_stok\` : Trigger otomatis isi buffer stok (Target 18 konten / 3 hari)\n` +
    `• \`/stok\` : Cek status & komposisi buffer stok (Affiliate vs Viral)\n` +
    `• \`/post_sekarang\` : Terbitkan 1 konten antrean ke Threads sekarang\n` +
    `• \`/cek_limit\` : Cek sisa kuota posting & replies Meta Threads\n` +
    `• \`/status\` : Cek kesehatan sistem, token, & database\n\n` +
    `🔄 *Pemeliharaan & Keamanan:*\n` +
    `• \`/refresh_token\` : Perpanjang masa aktif token Threads (60 hari lagi)\n` +
    `• \`/backup\` : Download backup database SQLite langsung ke chat\n\n` +
    `🛍️ *Manajemen Link Shopee Affiliate:*\n` +
    `• \`/list_produk\` : Lihat semua link affiliate yang aktif\n` +
    `• \`/tambah_produk <Nama> | <Link>\` : Tambahkan link affiliate Shopee\n\n` +
    `💰 *Pencatatan Keuangan Manual:*\n` +
    `• \`/catat <proyek> | <nominal> | [klien]\` : Catat komisi manual\n` +
    `• \`/rekap\` : Lihat ringkasan pendapatan komisi`
  );
}

bot.start((ctx) => {
  const name = ctx.from?.first_name || 'Kawan';
  safeReplyMarkdown(ctx, renderHelpMenu(name));
});

bot.help((ctx) => {
  const name = ctx.from?.first_name || 'Kawan';
  safeReplyMarkdown(ctx, renderHelpMenu(name));
});

// Command: /status
bot.command('status', async (ctx) => {
  try {
    const queueCount = db.getQueuedStoriesCount();
    const productsCount = db.getAllProducts().length;
    const lastRefresh = db.getSetting('THREADS_TOKEN_REFRESHED_AT', 'Belum pernah di-refresh');
    const uptimeSec = Math.floor(process.uptime());
    const uptimeHours = Math.floor(uptimeSec / 3600);
    const uptimeMin = Math.floor((uptimeSec % 3600) / 60);

    let msg = `⚙️ *STATUS SISTEM KISAH KOMISI:*\n\n`;
    msg += `🟢 *Status Bot*: Aktif & Berjalan Normal\n`;
    msg += `⏱️ *Uptime Server*: ${uptimeHours} jam ${uptimeMin} menit\n`;
    msg += `📦 *Antrean Stok Cerita*: *${queueCount} cerita*\n`;
    msg += `🛍️ *Produk Affiliate*: *${productsCount} produk (100% Beku / Frozen selama Eksperimen)*\n`;
    msg += `🔑 *Terakhir Token Di-refresh*: ${lastRefresh}\n`;
    msg += `🛡️ *Jitter Posting*: Dinonaktifkan (0s - Presisi Waktu Eksperimen Paired A/B)\n`;
    msg += `⏳ *Veto Window*: Aktif (Preview draf dikirim jam 06:30 & 21:00 WIB)\n`;
    msg += `\n⏰ *Jadwal Tayang Paired A/B (2x Sehari WIB):*\n• Pagi: 07:00:00 WIB (Veto cutoff: 06:30 - 07:00 WIB)\n• Malam: 21:30:00 WIB (Veto cutoff: 21:00 - 21:30 WIB)`;

    safeReplyMarkdown(ctx, msg);
  } catch (err) {
    console.error('Error status:', err);
    ctx.reply(`❌ Gagal membaca status: ${err.message}`);
  }
});

// Command: /refresh_token
bot.command('refresh_token', async (ctx) => {
  await ctx.reply('⏳ Sedang menghubungi server Meta untuk me-refresh Access Token Threads...');
  try {
    const res = await refreshThreadsToken();
    const daysLeft = Math.round((res.expires_in || 5184000) / 86400);
    ctx.replyWithMarkdown(
      `🎉 *Token Threads Berhasil Diperpanjang!*\n\n` +
      `📅 *Masa Aktif*: Ditambah ~*${daysLeft} hari* ke depan\n` +
      `🔐 *Penyimpanan*: Token otomatis tersimpan aman di database SQLite dan akan digunakan untuk semua postingan berikutnya.`
    );
  } catch (err) {
    console.error('Error refresh_token command:', err);
    ctx.reply(`❌ Gagal refresh token: ${err.message}`);
  }
});

// Command: /set_token <token>
bot.command('set_token', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/).filter(Boolean);
  const newToken = parts[1];
  if (!newToken) {
    return safeReplyMarkdown(ctx, '⚠️ Masukkan access token Threads yang baru.\nContoh: `/set_token THAAY...`');
  }

  db.setSetting('THREADS_ACCESS_TOKEN', newToken);
  db.setSetting('THREADS_TOKEN_REFRESHED_AT', new Date().toISOString());
  await safeReplyMarkdown(ctx, '✅ *Access Token Threads berhasil diperbarui di database!*\n\nCoba ketik `/status` atau `/post_sekarang` untuk memverifikasi.');
});

// Command: /hapus_post <mediaId>
bot.command('hapus_post', async (ctx) => {
  const parts = ctx.message.text.split(' ').filter(Boolean);
  const mediaId = parts[1];
  if (!mediaId) {
    return ctx.reply('⚠️ Masukkan Media ID postingan Threads yang ingin dihapus.\nContoh: `/hapus_post 18218227525358737`', { parse_mode: 'Markdown' });
  }

  await ctx.reply(`⏳ Menghapus postingan ID ${mediaId} dari Threads...`);
  try {
    await deletePost(mediaId);
    ctx.reply(`✅ Postingan Threads ID ${mediaId} berhasil dihapus dari akun!`);
  } catch (err) {
    console.error('Error hapus_post:', err.message);
    ctx.reply(`❌ Gagal menghapus postingan: ${err.message}\n\nCatatan: Jika error permission, token Anda perlu di-authorize ulang dengan scope threads_delete.`);
  }
});

// Command: /backup
bot.command('backup', async (ctx) => {
  await ctx.reply('⏳ Menyiapkan file backup database SQLite...');
  const success = await sendDatabaseBackup(ctx.chat.id);
  if (!success) {
    ctx.reply('❌ Gagal membuat backup database. Silakan periksa log server.');
  }
});

// Command: /bikin_cerita
bot.command('bikin_cerita', async (ctx) => {
  await ctx.reply('⏳ Sedang memproduksi & mengurasi cerita menfess viral (Creator Gemini + QC Kurator Groq)...');
  try {
    const story = await produceCuratedStory();
    const id = db.addStoryToQueue({
      title: story.title,
      topic: story.topic,
      slides: story.slides,
      productName: story.product_name,
      productUrl: story.product_url,
      scheduledFor: new Date().toISOString(),
      qcScore: story.qcScore,
      qcNotes: story.qcNotes
    });

    let preview = `✅ *Cerita Baru Berhasil Dibuat & Lolos Kurasi!*\n\n`;
    preview += `🆔 *ID Antrean*: #${id}\n`;
    preview += `📖 *Judul*: ${story.title}\n`;
    preview += `🏷️ *Topik*: ${story.topic}\n`;
    preview += `⭐ *QC Score*: *${story.qcScore}/10*\n`;
    preview += `🧐 *Catatan Kurator*: _${story.qcNotes}_\n`;
    if (story.product_name) {
      preview += `🛍️ *Produk*: ${story.product_name}\n`;
      preview += `🔗 *Link*: ${story.product_url}\n`;
    } else {
      preview += `🛍️ *Produk*: _Murni Cerita (Tanpa Iklan)_\n`;
    }
    preview += `\n*Post Utama (Hook):*\n_"${story.slides[0]}"_\n\n`;
    preview += `*Total Bagian*: ${story.slides.length} Bagian (Chained Sequential)\n\n`;
    preview += `Gunakan \`/post_sekarang\` jika ingin langsung menerbitkan ke Threads sekarang!`;

    safeReplyMarkdown(ctx, preview);
  } catch (err) {
    console.error('Error bikin_cerita:', err);
    ctx.reply(`❌ Gagal membuat cerita: ${err.message}`);
  }
});

// Command: /curhat atau /submit_cerita (Olah DM warganet jadi thread berantai otomatis)
bot.command(['curhat', 'submit_cerita', 'dm'], async (ctx) => {
  const rawText = ctx.message.text.replace(/^\/(curhat|submit_cerita|dm)\s*/i, '').trim();

  if (!rawText || rawText.length < 15) {
    return ctx.reply(
      '💡 *Format Olah Curhat / Cerita DM Anonim:*\n\n' +
      'Ketik:\n`/curhat <isi cerita warganet dari DM>`\n\n' +
      'Contoh:\n' +
      '`/curhat Temen kantor gue mendadak dapet perpanjangan magang 3 bulan lagi padahal janjinya officer...`\n\n' +
      '🤖 *Sistem akan otomatis:*\n' +
      '1. Membaca & menyusun jadi thread bersambung (3-4 slide berantai).\n' +
      '2. Menuliskan hook menggantung & pertanyaan debat warganet.\n' +
      '3. Menaruh credit anonim di paling ujung slide terakhir:\n' +
      '   _"(cerita anonim dari obrolan warganet)"_\n' +
      '4. Masuk ke antrean stok siap tayang!',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply('⏳ Sedang membaca & mengolah cerita warganet jadi thread berantai (Add to thread)...');

  try {
    const story = await processAnonymousStory(rawText, { withProduct: false });

    const id = db.addStoryToQueue({
      title: story.title,
      topic: story.topic,
      slides: story.slides,
      productName: story.product_name,
      productUrl: story.product_url,
      scheduledFor: new Date().toISOString(),
      qcScore: 9.5,
      qcNotes: 'Cerita anonim kiriman warganet/DM diolah otomatis dengan credit di akhir',
      origin: 'community',
      topicTag: story.topicTag,
      variant: 'B',
      formatType: 'community_story'
    });

    let preview = `✅ *Cerita DM Warganet Berhasil Diolah & Masuk Antrean!*\n\n`;
    preview += `🆔 *ID Antrean*: #${id}\n`;
    preview += `📖 *Judul*: ${story.title}\n`;
    preview += `🏷️ *Topik*: ${story.topic}\n`;
    preview += `🧵 *Total Slide*: ${story.slides.length} Part (Add to thread berurutan)\n\n`;
    preview += `*Slide 1 (Hook Utama):*\n"${story.slides[0]}"\n\n`;
    preview += `*Slide Terakhir (Paling Ujung Belakang):*\n"${story.slides[story.slides.length - 1]}"\n\n`;
    preview += `Gunakan \`/post_sekarang\` jika ingin langsung menerbitkan ke Threads sekarang!`;

    safeReplyMarkdown(ctx, preview);
  } catch (err) {
    console.error('Error /curhat:', err);
    ctx.reply(`❌ Gagal mengolah cerita warganet: ${err.message}`);
  }
});

// Command: /isi_stok
bot.command('isi_stok', async (ctx) => {
  await ctx.reply('⏳ Menjalankan pengisian stok buffer otomatis (Target: 18 konten / 3 hari)...');
  try {
    const res = await replenishStockBuffer(18);
    if (res.status === 'full') {
      safeReplyMarkdown(ctx, `✅ *Stok Antrean Sudah Penuh!*\n\nSaat ini sudah ada *${res.currentCount} konten* terkurasi yang siap tayang.`);
    } else if (res.status === 'busy') {
      ctx.reply('⏳ Proses kurasi stok sedang berjalan di background, silakan tunggu sebentar.');
    } else {
      safeReplyMarkdown(ctx, `🎉 *Pengisian Stok Selesai!*\n\nBerhasil menambahkan *${res.added} konten baru* yang telah lolos QC.\nTotal stok siap tayang sekarang: *${res.currentCount} konten*.`);
    }
  } catch (err) {
    console.error('Error isi_stok:', err);
    ctx.reply(`❌ Gagal mengisi stok: ${err.message}`);
  }
});

// Command: /stok
bot.command('stok', (ctx) => {
  try {
    const count = db.getQueuedStoriesCount();
    const upcoming = db.getUpcomingStories(6);
    const breakdown = db.getQueuedFormatBreakdown ? db.getQueuedFormatBreakdown() : {};

    const affCount = breakdown['story_affiliate'] || 0;
    const hotCount = breakdown['hot_take'] || 0;
    const menfessCount = breakdown['menfess_spill'] || 0;
    const finCount = breakdown['financial_breakdown'] || 0;
    const viralCount = hotCount + menfessCount + finCount;

    let msg = `📦 *Status Buffer Stok Konten Autopilot:*\n`;
    msg += `Total Konten Siap Tayang: *${count} Konten* (Target: 18 / 3 Hari)\n`;
    msg += `Status Buffer: *${count >= 18 ? '🟢 PENUH & AMAN (3 Hari)' : (count >= 6 ? '🟡 CUKUP (1-2 Hari)' : '🔴 PERLU REPLENISH (Auto-Restock Aktif)')}*\n\n`;

    msg += `📊 *Komposisi Format:*\n`;
    msg += `• 🛍️ Shopee Affiliate Story: *${affCount}*\n`;
    msg += `• 🔥 Hot Takes (Organik): *${hotCount}*\n`;
    msg += `• 🗣️ Menfess Spill (Organik): *${menfessCount}*\n`;
    msg += `• 💸 Financial Breakdown (Organik): *${finCount}*\n`;
    msg += `_Rasio: ${affCount} Affiliate : ${viralCount} Viral Insight_\n\n`;

    if (upcoming.length > 0) {
      msg += `📋 *6 Konten Terdekat Siap Tayang:*\n`;
      upcoming.forEach(s => {
        let icon = '📖';
        if (s.format_type === 'hot_take') icon = '🔥';
        else if (s.format_type === 'menfess_spill') icon = '🗣️';
        else if (s.format_type === 'financial_breakdown') icon = '💸';

        const scoreTag = s.qc_score ? ` ⭐ ${s.qc_score}/10` : '';
        const prodTag = s.product_name ? ` [Shopee: ${s.product_name.slice(0, 15)}...]` : ' [0% Ad]';
        msg += `• ${icon} *#${s.id}* - ${s.title.slice(0, 32)}...${scoreTag}${prodTag}\n`;
      });
      msg += `\n⏰ *Jadwal Tayang (6x Sehari WIB - Rundown 50/50 Seimbang):*\n`;
      msg += `• 07:15 WIB: ☕ Life Update Kiki (0% Ad)\n`;
      msg += `• 10:00 WIB: ☕ Life Update Kiki (0% Ad)\n`;
      msg += `• 12:30 WIB: 📩 Cerita DM Anonim + Shopee Affiliate\n`;
      msg += `• 16:30 WIB: ☕ Life Update Kiki (0% Ad)\n`;
      msg += `• 19:30 WIB: 🛍️ Story + Shopee Affiliate\n`;
      msg += `• 21:45 WIB: 📩 Cerita DM Anonim + Shopee Affiliate\n\n`;
      msg += `_Setiap postingan memiliki random human jitter 10-30 menit (anti-ban Meta)._`;
    } else {
      msg += `_Antrean sedang kosong. Sistem autopilot akan segera mengisi otomatis di background, atau ketik \`/isi_stok\`!_`;
    }

    safeReplyMarkdown(ctx, msg);
  } catch (err) {
    console.error('Error getStok:', err);
    ctx.reply('❌ Gagal memeriksa stok antrean.');
  }
});

// Command: /insight & /statistik
bot.command(['insight', 'statistik'], async (ctx) => {
  await ctx.reply('⏳ Menarik data analitik terbaru langsung dari Meta Threads API...');
  try {
    await trackAllInsights();
    await analyzePerformanceAndStrategize();
    const report = await generateInsightReportMarkdown();
    safeReplyMarkdown(ctx, report);
  } catch (err) {
    console.error('Error command insight:', err);
    ctx.reply(`❌ Gagal mengambil insight Threads: ${err.message}`);
  }
});

// Command: /cek_limit
bot.command('cek_limit', async (ctx) => {
  const userId = process.env.THREADS_USER_ID;
  const token = getActiveAccessToken();
  if (!userId || !token) {
    return ctx.reply('⚠️ Kredensial Threads API belum lengkap di server!');
  }

  try {
    const limits = await getPublishingLimit(userId, token);
    const data = limits.data?.[0];
    if (!data) {
      return ctx.reply('❌ Gagal membaca limit Threads: ' + JSON.stringify(limits));
    }
    const postUsed = data.quota_usage || 0;
    const postMax = data.config?.quota_total || 250;
    const replyUsed = data.reply_quota_usage || 0;
    const replyMax = data.reply_config?.quota_total || 1000;

    let msg = `📊 *Status Kuota Meta Threads API (Rolling 24 Jam):*\n\n`;
    msg += `📝 *Post Utama (Feed)*:\n• Terpakai: *${postUsed}* dari max ${postMax}\n• Sisa Slot: *${postMax - postUsed} post*\n\n`;
    msg += `💬 *Replies (Lanjutan Cerita)*:\n• Terpakai: *${replyUsed}* dari max ${replyMax}\n• Sisa Slot: *${replyMax - replyUsed} replies*\n\n`;
    msg += `_Aturan Meta: 1 cerita hanya menghabiskan 1 slot Post Utama, sedangkan seluruh lanjutannya masuk ke kuota Replies._`;
    safeReplyMarkdown(ctx, msg);
  } catch (err) {
    console.error('Error cek_limit:', err);
    ctx.reply(`❌ Gagal mengambil limit Threads: ${err.message}`);
  }
});

// Command: /list_produk
bot.command('list_produk', (ctx) => {
  try {
    const products = db.getAllProducts();
    if (products.length === 0) {
      return ctx.reply('⚠️ Belum ada produk affiliate di database. Gunakan /tambah_produk.');
    }
    let msg = `🛍️ *Daftar Produk Affiliate Shopee di Database:*\n\n`;
    products.forEach((p, idx) => {
      msg += `${idx + 1}. *${p.name}* (${p.category || 'Umum'})\n🔗 [Link Produk](${p.affiliate_url})\n\n`;
    });
    msg += `_Tambahkan link baru dengan cara:_\n\`/tambah_produk Nama Barang | https://s.shopee.co.id/xxx\``;
    safeReplyMarkdown(ctx, msg, { disable_web_page_preview: true });
  } catch (err) {
    console.error('Error list_produk:', err);
    ctx.reply('❌ Gagal mengambil daftar produk.');
  }
});

// Command: /tambah_produk <Nama Produk> | <Link Affiliate>
bot.command('tambah_produk', (ctx) => {
  const text = ctx.message.text.replace('/tambah_produk', '').trim();
  if (!text.includes('|')) {
    return safeReplyMarkdown(
      ctx,
      '⚠️ *Format salah!*\n\n' +
      'Gunakan format:\n' +
      '`/tambah_produk Nama Produk | Link Shopee Affiliate`\n\n' +
      'Contoh:\n' +
      '`/tambah_produk Sandal Slop Empuk Pria Wanita | https://s.shopee.co.id/abcxyz`'
    );
  }

  const [name, link] = text.split('|').map(s => s.trim());
  if (!name || !link) {
    return ctx.reply('⚠️ Nama produk dan link affiliate tidak boleh kosong!');
  }

  try {
    const newId = db.addProduct(name, link);
    safeReplyMarkdown(
      ctx,
      `✅ *Produk Affiliate Berhasil Ditambahkan!*\n\n` +
      `🆔 *ID*: #${newId}\n` +
      `📦 *Nama*: ${name}\n` +
      `🔗 *Link*: \`${link}\`\n\n` +
      `Produk ini akan otomatis diputar AI sebagai iklan selingan di cerita-cerita berikutnya!`
    );
  } catch (err) {
    console.error('Error tambah_produk:', err);
    ctx.reply(`❌ Gagal menambah produk: ${err.message}`);
  }
});

// Command: /niche (Dashboard Pilar Viral Terkunci & Eksplorasi)
bot.command('niche', (ctx) => {
  try {
    const allNiches = db.getAllNiches();
    const locked = allNiches.filter(n => n.is_locked);
    const exploring = allNiches.filter(n => !n.is_locked);

    let msg = `🎯 *STATUS ALGORITMA MULTI-NICHE & WAVE-RIDING*\n\n`;

    msg += `🔒 *Pilar Viral Terkunci (Slot Prioritas 50%):*\n`;
    if (locked.length > 0) {
      locked.forEach((n, idx) => {
        msg += `${idx + 1}. *#${n.niche_tag}* (${n.category_label})\n`;
        msg += `   👀 Avg: *${n.avg_views} views* | 📝 Total: ${n.total_posts} post | 💬 Avg: ${n.avg_replies} reply\n`;
        if (n.lock_reason) msg += `   📌 _Alasan: ${n.lock_reason}_\n`;
        msg += `\n`;
      });
    } else {
      msg += `_Belum ada niche terkunci._\n\n`;
    }

    msg += `🌊 *Pilar Eksplorasi Gelombang Baru (Slot Riset 50%):*\n`;
    if (exploring.length > 0) {
      exploring.forEach((n, idx) => {
        msg += `${idx + 1}. *#${n.niche_tag}* (${n.category_label})\n`;
        msg += `   👀 Avg: *${n.avg_views} views* | 📝 Diuji: ${n.total_posts} kali\n`;
      });
    } else {
      msg += `_Semua niche sedang terkunci._\n`;
    }

    msg += `\n💡 *Perintah Kontrol Owner:*\n`;
    msg += `• \`/lock <tag>\` : Kunci niche secara manual (misal: \`/lock krl\`)\n`;
    msg += `• \`/unlock <tag>\` : Buka kunci niche ke eksplorasi\n`;
    msg += `• \`/sync_niche\` : Jalankan sinkronisasi data analitik & evaluasi auto-lock sekarang`;

    safeReplyMarkdown(ctx, msg);
  } catch (err) {
    console.error('Error command /niche:', err);
    ctx.reply('❌ Gagal mengambil status niche.');
  }
});

// Command: /lock <tag>
bot.command('lock', (ctx) => {
  const tag = ctx.message.text.replace('/lock', '').trim().toLowerCase().replace(/^#/, '');
  if (!tag) {
    return ctx.reply('⚠️ Format salah! Gunakan: /lock <niche_tag> (contoh: /lock krl)');
  }

  try {
    const res = db.setNicheLock(tag, true, 'Manual Lock by Owner');
    if (res.changes > 0) {
      safeReplyMarkdown(ctx, `🔒 *Sukses!* Niche \`#${tag}\` berhasil DIKUNCI sebagai pilar viral tetap.`);
    } else {
      ctx.reply(`⚠️ Niche #${tag} tidak ditemukan di database analitik.`);
    }
  } catch (err) {
    ctx.reply(`❌ Gagal mengunci niche: ${err.message}`);
  }
});

// Command: /unlock <tag>
bot.command('unlock', (ctx) => {
  const tag = ctx.message.text.replace('/unlock', '').trim().toLowerCase().replace(/^#/, '');
  if (!tag) {
    return ctx.reply('⚠️ Format salah! Gunakan: /unlock <niche_tag> (contoh: /unlock rumahtangga)');
  }

  try {
    const res = db.setNicheLock(tag, false, 'Manual Unlock by Owner');
    if (res.changes > 0) {
      safeReplyMarkdown(ctx, `🌊 *Sukses!* Niche \`#${tag}\` dibuka kuncinya dan kembali ke rotasi eksplorasi gelombang baru.`);
    } else {
      ctx.reply(`⚠️ Niche #${tag} tidak ditemukan di database analitik.`);
    }
  } catch (err) {
    ctx.reply(`❌ Gagal membuka kunci niche: ${err.message}`);
  }
});

// Command: /sync_niche
bot.command('sync_niche', async (ctx) => {
  await ctx.reply('⏳ Menyinkronkan performa seluruh niche dari postingan nyata...');
  try {
    await syncNicheAnalytics();
    const evalResult = await evaluateAndLockWinningNiches();

    let reply = `✅ *Sinkronisasi Niche Selesai!*\n\n`;
    if (evalResult.newlyLocked && evalResult.newlyLocked.length > 0) {
      reply += `🚀 *Niche yang Baru Saja Terkunci Otomatis (Viral):*\n`;
      evalResult.newlyLocked.forEach(t => reply += `• \`#${t}\`\n`);
      reply += `\n`;
    }
    if (evalResult.newlyUnlocked && evalResult.newlyUnlocked.length > 0) {
      reply += `🌊 *Niche yang Mereda (Kembali ke Eksplorasi):*\n`;
      evalResult.newlyUnlocked.forEach(t => reply += `• \`#${t}\`\n`);
      reply += `\n`;
    }

    reply += `🔒 *Total Niche Terkunci Saat Ini*: ${evalResult.currentLocked.length}\n`;
    reply += `🌊 *Total Niche Eksplorasi*: ${evalResult.currentExploring.length}\n\n`;
    reply += `Ketik \`/niche\` untuk melihat tabel lengkap.`;

    safeReplyMarkdown(ctx, reply);
  } catch (err) {
    console.error('Error sync_niche:', err);
    ctx.reply(`❌ Gagal sinkronisasi niche: ${err.message}`);
  }
});

// Flag mutex untuk mencegah balapan (race condition) antar postingan
let isPostingInProgress = false;

// Command: /post_sekarang (Trigger Manual)
bot.command('post_sekarang', async (ctx) => {
  if (isPostingInProgress) {
    return ctx.reply('⏳ Sedang ada proses posting lain yang berjalan di background. Mohon tunggu.');
  }

  const userId = process.env.THREADS_USER_ID;
  const token = getActiveAccessToken();

  if (!userId || !token) {
    return ctx.reply('⚠️ Kredensial Threads API belum lengkap di server!');
  }

  const story = db.getNextQueuedStory();
  if (!story) {
    return ctx.reply('⚠️ Tidak ada cerita di antrean! Ketik /bikin_cerita dulu.');
  }

  isPostingInProgress = true;
  await ctx.reply(`🚀 Sedang mem-publish cerita: "${story.title}" ke akun Threads @ceritakikiii...`);

  try {
    const cleanStory = sanitizeStoryBeforePublish(story);
    const parsedSlides = cleanStory.slides;
    const publishResult = await publishStoryToThreads(userId, token, {
      title: cleanStory.title,
      slides: parsedSlides,
      product_name: cleanStory.product_name,
      product_url: cleanStory.product_url,
      topic_tag: cleanStory.topic_tag || null
    });
    const postId = typeof publishResult === 'object' ? publishResult.rootPostId : publishResult;
    const lastId = typeof publishResult === 'object' ? publishResult.lastPostId : postId;
    const permalink = typeof publishResult === 'object' ? publishResult.permalink : `https://www.threads.net/@ceritakikiii`;

    db.markStoryPublished(story.id, postId, lastId, permalink);

    safeReplyMarkdown(
      ctx,
      `🎉 *BERHASIL TAYANG DI THREADS!*\n\n` +
      `📖 *Judul*: ${story.title}\n` +
      `🆔 *Threads Post ID*: \`${postId}\`\n` +
      `🛒 *Struktur*: 1 Post Utama + ${parsedSlides.length - 1} Replies Berantai\n\n` +
      `🔗 [Buka Postingan Threads](${permalink})\n` +
      `Akun: *@ceritakikiii*`
    );

    // Isi ulang stok di background
    replenishStockBuffer(9).catch(e => console.warn('[ManualPost] Auto-replenish error:', e.message));
  } catch (err) {
    console.error('Error post_sekarang:', err);
    db.markStoryFailed(story.id, err.message);
    ctx.reply(`❌ Gagal mem-publish ke Threads: ${err.message}`);
  } finally {
    isPostingInProgress = false;
  }
});

// Command: /catat
bot.command('catat', (ctx) => {
  const text = ctx.message.text.replace('/catat', '').trim();
  if (!text) {
    return ctx.reply('⚠️ Format: /catat Proyek | 500000 | Klien');
  }

  const parts = text.split('|').map(p => p.trim());
  const projectName = parts[0];
  const amount = Number(parts[1]?.replace(/[^0-9]/g, ''));
  const clientName = parts[2] || '-';

  if (!projectName || !amount || isNaN(amount)) {
    return ctx.reply('⚠️ Masukkan nama proyek dan nominal yang valid!');
  }

  const id = db.addCommission({
    userId: ctx.from.id,
    username: ctx.from.username || ctx.from.first_name,
    projectName,
    clientName,
    amount
  });

  safeReplyMarkdown(ctx, `✅ *Komisi #${id} Dicatat:* ${projectName} (${formatRupiah(amount)})`);
});

// Command: /rekap
bot.command('rekap', (ctx) => {
  const summary = db.getSummaryByUser(ctx.from.id);
  let total = 0;
  summary.forEach(s => total += s.total_amount);
  safeReplyMarkdown(ctx, `📊 *Rekap Komisi:* Total *${formatRupiah(total)}*`);
});

// Command: /veto (Veto Window Controller untuk 6 Slot Harian)
bot.command('veto', async (ctx) => {
  const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const dateStr = nowWIB.toISOString().slice(0, 10);
  const currentHour = nowWIB.getHours();
  const currentMin = nowWIB.getMinutes();
  const currentTimeVal = currentHour * 60 + currentMin;

  const SLOTS = [
    { time: '07:15', vetoTime: '07:00', label: 'SLOT 1 - PAGI KOMUTER (07:15 WIB)' },
    { time: '10:00', vetoTime: '09:45', label: 'SLOT 2 - COFFEE BREAK (10:00 WIB)' },
    { time: '12:30', vetoTime: '12:15', label: 'SLOT 3 - MAKAN SIANG (12:30 WIB)' },
    { time: '16:30', vetoTime: '16:15', label: 'SLOT 4 - SORE PULANG KANTOR (16:30 WIB)' },
    { time: '19:30', vetoTime: '19:15', label: 'SLOT 5 - MALAM SANTAI (19:30 WIB)' },
    { time: '21:45', vetoTime: '21:30', label: 'SLOT 6 - PEAK REBAHAN (21:45 WIB)' }
  ];

  let targetSlot = null;
  let targetLabel = '';

  // 1. Cek apakah saat ini berada dalam jendela veto aktif (vetoTime s/d postTime + 10 menit)
  for (const s of SLOTS) {
    const [vh, vm] = s.vetoTime.split(':').map(Number);
    const [ph, pm] = s.time.split(':').map(Number);
    const vetoVal = vh * 60 + vm;
    const postVal = ph * 60 + pm;

    if (currentTimeVal >= vetoVal && currentTimeVal <= postVal + 10) {
      targetSlot = s.time;
      targetLabel = s.label;
      break;
    }
  }

  // 2. Jika di luar jendela aktif, cari slot mendatang berikutnya hari ini
  if (!targetSlot) {
    for (const s of SLOTS) {
      const [ph, pm] = s.time.split(':').map(Number);
      const postVal = ph * 60 + pm;
      if (currentTimeVal < postVal) {
        targetSlot = s.time;
        targetLabel = s.label;
        break;
      }
    }
  }

  if (!targetSlot) {
    return safeReplyMarkdown(ctx, '⚠️ Tidak ada slot postingan hari ini yang masih pending untuk diveto.');
  }

  const vetoKey = `VETO_SLOT_${dateStr}_${targetSlot}`;
  db.setSetting(vetoKey, 'vetoed');

  safeReplyMarkdown(
    ctx,
    `🛑 *VETO BERHASIL DIAKTIFKAN!*\n\n` +
    `Slot tayang *${targetLabel}* (${dateStr}) telah *DIBATALKAN*.\n` +
    `Bot TIDAK akan memposting konten ini ke Threads.`
  );
});

// ==========================================
// 💬 COMMAND /bantu_komen (HUMAN-IN-THE-LOOP COMMENT ASSISTANT)
// Guardrails ketat: DILARANG mengarang pengalaman pribadi palsu atas nama owner!
// ==========================================
bot.command('bantu_komen', async (ctx) => {
  const input = ctx.message.text.replace('/bantu_komen', '').trim();
  if (!input) {
    return safeReplyMarkdown(
      ctx,
      '⚠️ *Format salah!*\n\n' +
      'Ketik `/bantu_komen <isi postingan warganet atau konteks curhat>`\n\n' +
      'Contoh:\n' +
      '`/bantu_komen Temen sekamar kosan suka minjem motor tapi bensin ga pernah diganti.`'
    );
  }

  await ctx.reply('✍️ Menyusun 2 draf komentar bernilai tambah (dengan guardrails pengalaman asli)...');

  const commentPrompt = `
Kamu adalah asisten komentar Threads untuk akun @ceritakikiii (milik Kiki Rachmat).
Tugasmu adalah menyusun DUA (2) opsi draf balasan komentar yang bernilai tambah, santai, dan memancing percakapan balik warganet.

POSTINGAN SASARAN:
"${input}"

ATURAN GUARDRAILS KETAT (AMANAH OWNER):
1. DILARANG KERAS MENGARANG PENGALAMAN PRIBADI PALSU (seperti mengarang nama teman, pekerjaan fiktif, atau kejadian palsu), karena owner memposting atas nama dirinya sendiri.
2. Gunakan sudut pandang penanya yang penasaran, empati wajar, atau sudut pandang pihak ketiga.
3. JIKA memerlukan konteks pengalaman pribadi nyata, sediakan placeholder bertanda kurung siku seperti "[tambah pengalaman asli lo pas di kosan]" atau "[sebut nominal bensin]" agar diisi sendiri oleh owner sebelum diposting.
4. Gaya bahasa: santai, ceplas-ceplos warganet Threads Indonesia (lu-gue/aku-kamu, singkat, padat, tanpa penomoran).

Keluarkan HANYA JSON:
{
  "opsi_1": "Draf komentar 1 (fokus empati / pertanyaan penasaran)...",
  "opsi_2": "Draf komentar 2 (fokus tanggapan santai + placeholder pengalaman asli lo)..."
}
`;

  try {
    let resultJson = null;

    if (process.env.GROQ_API_KEY) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: commentPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.7
          })
        });
        if (groqRes.ok) {
          const gData = await groqRes.json();
          resultJson = JSON.parse(gData.choices?.[0]?.message?.content || '{}');
        }
      } catch (ge) {}
    }

    if (!resultJson && process.env.GEMINI_API_KEY) {
      const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: commentPrompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
        })
      });
      if (gemRes.ok) {
        const gmData = await gemRes.json();
        const text = gmData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) resultJson = JSON.parse(text);
      }
    }

    if (!resultJson || (!resultJson.opsi_1 && !resultJson.opsi_2)) {
      return ctx.reply('❌ Gagal menyusun komentar otomatis saat ini. Coba lagi sebentar.');
    }

    let replyMsg = `💬 *Draf Rekomendasi Komentar Threads:*\n\n`;
    if (resultJson.opsi_1) {
      replyMsg += `*Opsi 1 (Pertanyaan/Empati):*\n\`${resultJson.opsi_1}\`\n\n`;
    }
    if (resultJson.opsi_2) {
      replyMsg += `*Opsi 2 (Santai + Placeholder):*\n\`${resultJson.opsi_2}\`\n\n`;
    }
    replyMsg += `_Tips: Salin salah satu teks di atas, sesuaikan bagian [tanda kurung] dengan pengalaman aslimu sebelum membalas di Threads!_`;

    safeReplyMarkdown(ctx, replyMsg);
  } catch (err) {
    console.error('Error /bantu_komen:', err);
    ctx.reply(`❌ Terjadi error: ${err.message}`);
  }
});

// ==========================================
// 📸 JOB PERIODIC SNAPSHOTS VIEWS POSTINGAN
// Interval evaluasi: 1h, 6h, 24h, 72h
// ==========================================
function parseUtcTimestamp(dateStr) {
  if (!dateStr) return NaN;
  if (typeof dateStr !== 'string') return new Date(dateStr).getTime();
  if (dateStr.includes('Z') || dateStr.includes('+')) return new Date(dateStr).getTime();
  return new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
}

async function recordPeriodicSnapshots() {
  const userId = process.env.THREADS_USER_ID;
  const token = getActiveAccessToken();
  if (!userId || !token) return;

  const published = db.getPublishedStoriesForSnapshots();
  const now = Date.now();

  for (const story of published) {
    if (!story.threads_media_id) continue;
    let pubTime = parseUtcTimestamp(story.published_at);
    if (isNaN(pubTime)) {
      // Fallback: ambil timestamp terbit langsung dari Graph API Threads
      try {
        const metaRes = await fetch(`https://graph.threads.net/v1.0/${story.threads_media_id}?fields=timestamp&access_token=${token}`);
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          if (metaJson.timestamp) {
            pubTime = new Date(metaJson.timestamp).getTime();
            // Cache ke database agar tidak perlu fetch API berulang
            db.db.prepare('UPDATE stories SET published_at = ? WHERE id = ?').run(metaJson.timestamp, story.id);
          }
        }
      } catch (e) {}
    }
    if (isNaN(pubTime)) continue;

    const ageHours = (now - pubTime) / (1000 * 60 * 60);

    // KETAT SESUAI PROTOKOL: Jendela presisi interval ±15 menit (0.25 jam) dari WAKTU TERBIT AKTUAL
    // DILARANG MENULIS INTERVAL YANG SUDAH LEWAT! Jika terlewat, jangan tulis retroaktif.
    const intervalsToCheck = [];
    if (ageHours >= 0.75 && ageHours <= 1.25 && !db.hasPostSnapshot(story.threads_media_id, '1h')) {
      intervalsToCheck.push('1h');
    }
    if (ageHours >= 5.75 && ageHours <= 6.25 && !db.hasPostSnapshot(story.threads_media_id, '6h')) {
      intervalsToCheck.push('6h');
    }
    if (ageHours >= 23.75 && ageHours <= 24.25 && !db.hasPostSnapshot(story.threads_media_id, '24h')) {
      intervalsToCheck.push('24h');
    }
    if (ageHours >= 71.75 && ageHours <= 72.25 && !db.hasPostSnapshot(story.threads_media_id, '72h')) {
      intervalsToCheck.push('72h');
    }

    if (intervalsToCheck.length > 0) {
      try {
        const insUrl = `https://graph.threads.net/v1.0/${story.threads_media_id}/insights?metric=views,likes,replies,reposts,quotes`;
        const res = await fetch(insUrl, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        let views = 0, likes = 0, replies = 0, reposts = 0, quotes = 0;
        if (json.data) {
          json.data.forEach(m => {
            if (m.name === 'views') views = m.values?.[0]?.value || 0;
            if (m.name === 'likes') likes = m.values?.[0]?.value || 0;
            if (m.name === 'replies') replies = m.values?.[0]?.value || 0;
            if (m.name === 'reposts') reposts = m.values?.[0]?.value || 0;
            if (m.name === 'quotes') quotes = m.values?.[0]?.value || 0;
          });
        }

        let externalReplies = 0;
        try {
          externalReplies = await getExternalReplyCount(story.threads_media_id, 'ceritakikiii', token);
        } catch (ere) {
          console.warn(`[Snapshot] Gagal fetch external replies untuk ${story.threads_media_id}:`, ere.message);
        }

        for (const interval of intervalsToCheck) {
          db.recordPostSnapshot(story.id, story.threads_media_id, interval, views, likes, replies, reposts, quotes, externalReplies, 0);
          console.log(`[Snapshot] Tersimpan interval presisi ${interval} untuk cerita #${story.id} (${views} views, ${likes} likes, ${replies} replies, ${externalReplies} ext replies)`);
        }
      } catch (err) {
        console.warn(`[Snapshot] Gagal fetch insights untuk ${story.threads_media_id}:`, err.message);
      }
    }
  }
}

// ==========================================
// 🛡️ PENGINGAT KEDALUWARSA TOKEN META THREADS
// Alert dikirim harian jika masa aktif < 15 hari
// ==========================================
async function checkTokenExpiryReminder() {
  const refreshedAtStr = db.getSetting('THREADS_TOKEN_REFRESHED_AT');
  if (!refreshedAtStr) return;
  const refreshedAt = new Date(refreshedAtStr).getTime();
  const elapsedDays = (Date.now() - refreshedAt) / (1000 * 86400);
  const remainingDays = Math.max(0, Math.round(60 - elapsedDays));

  if (remainingDays <= 15) {
    await sendAdminAlert(
      `⚠️ *[PENGINGAT TOKEN THREADS]*\n\n` +
      `Masa aktif token tersisa *${remainingDays} hari lagi* (Refreshed: ${refreshedAtStr.slice(0, 10)}).\n` +
      `Sistem akan mencoba auto-refresh terjadwal, namun pantau terus dashboard untuk memastikan tidak ada auth error.`
    );
  }
}

// ==========================================
// 📅 JADWAL 6 KONTEN HARIAN (RUNDOWN 50/50 SEIMBANG)
// 1. 50% Gedein Insight (Organik 0% Link): Slot 1, 2, 4 (Single Post Life Update Kiki, News/Demo, Viral Callback)
// 2. 50% Jualan Affiliate (Shopee Contextual): Slot 3, 5, 6 (Curhat DM Anonim "hari ini ada dm cerita anonim nih..." + Shopee Anchor Under 50k)
// 3. Fully Otomatis + Jitter Manusiawi (10-30 Menit Anti-Ban)
// ==========================================
const DAILY_SLOTS = [
  { slotNumber: 1, time: '07:15', vetoTime: '07:00', label: 'SLOT 1 - PAGI KOMUTER (07:15 WIB)', defaultFormat: 'single_life_update', targetNicheType: 'locked', hasAffiliate: false },
  { slotNumber: 2, time: '10:00', vetoTime: '09:45', label: 'SLOT 2 - COFFEE BREAK (10:00 WIB)', defaultFormat: 'single_life_update', targetNicheType: 'explore', hasAffiliate: false },
  { slotNumber: 3, time: '12:30', vetoTime: '12:15', label: 'SLOT 3 - MAKAN SIANG (12:30 WIB)', defaultFormat: 'anonymous_curhat_story', targetNicheType: 'locked', hasAffiliate: true },
  { slotNumber: 4, time: '16:30', vetoTime: '16:15', label: 'SLOT 4 - SORE PULANG KANTOR (16:30 WIB)', defaultFormat: 'single_life_update', targetNicheType: 'locked', hasAffiliate: false },
  { slotNumber: 5, time: '19:30', vetoTime: '19:15', label: 'SLOT 5 - MALAM SANTAI (19:30 WIB)', defaultFormat: 'story_affiliate', targetNicheType: 'explore', hasAffiliate: true },
  { slotNumber: 6, time: '21:45', vetoTime: '21:30', label: 'SLOT 6 - PEAK REBAHAN (21:45 WIB)', defaultFormat: 'anonymous_curhat_story', targetNicheType: 'explore', hasAffiliate: true }
];

// ==========================================
// ⏳ PREPARE & NOTIFY 15-MINUTE VETO WINDOW
// Dijalankan 15 menit sebelum setiap slot tayang
// ==========================================
async function prepareAndNotifyVetoSlot(slotTime, label, slotNumber = null) {
  try {
    const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const dateStr = nowWIB.toISOString().slice(0, 10);
    const slotConf = DAILY_SLOTS.find(s => s.time === slotTime) || {
      slotNumber: slotNumber || 1,
      hasAffiliate: false,
      defaultFormat: 'single_life_update',
      targetNicheType: 'locked'
    };

    let story = null;
    let storyId = null;

    // Cek apakah sudah ada story yang disiapkan sebelumnya
    const preparedId = db.getSetting(`PREPARED_STORY_${dateStr}_${slotTime}`);
    if (preparedId) {
      story = db.getStoryById(preparedId);
      if (story && story.status !== 'queued') story = null;
    }

    if (!story) {
      const targetFormat = slotConf.defaultFormat || (slotConf.hasAffiliate ? 'anonymous_curhat_story' : 'single_life_update');
      story = db.getNextQueuedStory ? db.getNextQueuedStory(targetFormat) : null;

      if (!story) {
        console.log(`[VetoWindow] Antrean kosong untuk format ${targetFormat}, memproduksi langsung untuk slot ${label}...`);
        const curated = await produceCuratedStory({
          formatType: targetFormat,
          targetNicheType: slotConf.targetNicheType || 'locked',
          variant: 'B',
          origin: 'fiction'
        });
        storyId = db.addStoryToQueue({
          title: curated.title,
          topic: curated.topic,
          slides: curated.slides,
          productName: curated.product_name || null,
          productUrl: curated.product_url || null,
          scheduledFor: `${dateStr}T${slotTime}:00+07:00`,
          qcScore: curated.qcScore,
          qcNotes: curated.qcNotes,
          origin: curated.origin || 'fiction',
          topicTag: curated.topic_tag || curated.topicTag || 'curhat',
          variant: curated.variant || 'B',
          formatType: curated.format_type || targetFormat
        });
        story = db.getStoryById(storyId);
      }

      if (story) {
        db.setSetting(`PREPARED_STORY_${dateStr}_${slotTime}`, String(story.id));
      }
    }

    if (!story) {
      console.log(`[VetoWindow] Tidak ada konten siap tayang untuk ${dateStr} ${slotTime}.`);
      return;
    }

    const slides = JSON.parse(story.slides_json);
    const firstSlide = slides[0] || '';
    const formatType = story.format_type || (story.product_url ? 'story_affiliate' : 'hot_take');

    let formatBadge = '📖 Cerita Relate + Shopee Affiliate';
    if (formatType === 'single_life_update') formatBadge = '☕ Life Update Kiki (Real-Time Persona, 0% Iklan)';
    else if (formatType === 'anonymous_curhat_story') formatBadge = '📩 Cerita DM Anonim Warganet (Add to thread + Shopee)';
    else if (formatType === 'hot_take') formatBadge = '🔥 Hot Take (1-Liner Sarcasm & Relatable Truth)';
    else if (formatType === 'menfess_spill') formatBadge = '🗣️ Menfess Spill (Crowdsourcing Reply Magnet)';
    else if (formatType === 'financial_breakdown') formatBadge = '💸 Financial Breakdown (In This Economy)';

    const sent = await sendAdminAlert(
      `⏳ *[15-MIN VETO WINDOW]* Draf Siap Tayang Jam *${slotTime} WIB*!\n\n` +
      `⏰ *Slot*: ${label}\n` +
      `🏷️ *Format*: *${formatBadge}*\n` +
      `🔖 *Topic Tag*: \`#${story.topic_tag || 'threads'}\`\n` +
      `📖 *Judul*: ${story.title}\n\n` +
      `*Pratinjau Hook / Post Utama:*\n` +
      `_"${firstSlide}"_\n\n` +
      (slides.length > 1 ? `_Total ${slides.length} bagian thread._\n\n` : '') +
      (story.product_name ? `🛍️ *Rekomendasi Shopee*: ${story.product_name}\n🔗 *Link*: \`${story.product_url || '-'}\`\n\n` : '✨ *Murni Insight Organik* (0% Link Iklan - Memaksimalkan Reach & Repost)\n\n') +
      `⚠️ *Opsi Kontrol Owner:*\n` +
      `Bot akan otomatis menerbitkan post ini sekitar jam *${slotTime} WIB* (dengan random human jitter 10-30 menit).\n` +
      `Ketik \`/veto\` untuk membatalkan tayang dalam 15 menit ke depan.`
    );

    if (sent) {
      db.setSetting(`VETO_ALERT_DELIVERED_${dateStr}_${slotTime}`, 'success');
      console.log(`[VetoWindow] Notifikasi veto Telegram berhasil terkirim untuk slot ${label}.`);
    } else {
      db.setSetting(`VETO_ALERT_DELIVERED_${dateStr}_${slotTime}`, 'failed');
      console.error(`[VetoWindow] GAGAL mengirim notifikasi veto Telegram untuk slot ${label}.`);
    }
  } catch (err) {
    console.error(`[VetoWindow] Gagal menyiapkan draf veto untuk slot ${label}:`, err.message);
  }
}

// ==========================================
// ⏰ EKSEKUTOR POSTING DENGAN RANDOM HUMAN JITTER
// Jitter acak 10-30 menit (600.000 - 1.800.000 ms) agar natural & bebas pola robotik
// ==========================================
async function executeScheduledPosting(slotTime, label, slotNumber = null) {
  const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const dateStr = nowWIB.toISOString().slice(0, 10);
  const vetoKey = `VETO_SLOT_${dateStr}_${slotTime}`;

  // Cek apakah slot ini telah diveto oleh owner
  if (db.getSetting(vetoKey) === 'vetoed') {
    console.log(`[Scheduler] Slot ${label} (${slotTime}) DIBATALKAN oleh veto owner.`);
    await sendAdminAlert(`🛑 *[VETO DIPROSES]* Slot tayang *${label}* telah dilewati dan tidak diterbitkan ke Threads sesuai veto owner.`);
    return;
  }

  // RANDOM JITTER MANUSIAWI (10 s/d 30 menit: 600.000 - 1.800.000 ms)
  // Menghindari footprint posting kaku/robotik pada detik :00 agar aman dari deteksi algoritma Meta
  const jitterMs = Math.floor(Math.random() * (1800000 - 600000 + 1)) + 600000;
  const jitterSec = Math.round(jitterMs / 1000);
  const jitterMin = (jitterMs / 60000).toFixed(1);
  console.log(`[Scheduler] Random jitter manusiawi aktif untuk ${label}: menunggu ${jitterMin} menit (${jitterSec} detik)...`);
  await new Promise(r => setTimeout(r, jitterMs));

  // Cek kembali veto pasca-jitter (siapa tahu owner veto saat jitter berjalan)
  if (db.getSetting(vetoKey) === 'vetoed') {
    console.log(`[Scheduler] Slot ${label} (${slotTime}) diveto saat masa jitter.`);
    await sendAdminAlert(`🛑 *[VETO DIPROSES]* Slot tayang *${label}* dibatalkan sesuai veto owner.`);
    return;
  }

  // Tunggu jika ada proses posting lain sedang berjalan (maksimal 5 kali x 15 detik)
  let waitAttempts = 0;
  while (isPostingInProgress && waitAttempts < 5) {
    console.warn(`[Scheduler] Sedang ada proses posting lain, menunggu 15 detik (percobaan ${waitAttempts + 1}/5)...`);
    await new Promise(r => setTimeout(r, 15000));
    waitAttempts++;
  }
  if (isPostingInProgress) {
    console.error(`[Scheduler] Slot ${label} dilewati karena proses posting sebelumnya belum selesai.`);
    return;
  }

  isPostingInProgress = true;
  try {

    const userId = process.env.THREADS_USER_ID;
    const token = getActiveAccessToken();

    if (!userId || !token) {
      console.warn('[Scheduler] Threads credentials missing.');
      await sendAdminAlert(`⚠️ *[Scheduler] Gagal Posting (${label})*: Kredensial Threads API belum lengkap di server.`);
      return;
    }

    const slotConf = DAILY_SLOTS.find(s => s.time === slotTime) || {
      slotNumber: slotNumber || 1,
      hasAffiliate: false,
      defaultFormat: 'single_life_update'
    };

    let story = null;
    const preparedId = db.getSetting(`PREPARED_STORY_${dateStr}_${slotTime}`);
    if (preparedId) {
      story = db.getStoryById(preparedId);
      if (story && story.status !== 'queued') story = null;
    }

    const targetFormat = slotConf.defaultFormat || (slotConf.hasAffiliate ? 'anonymous_curhat_story' : 'single_life_update');

    if (!story) {
      story = db.getNextQueuedStory ? db.getNextQueuedStory(targetFormat) : null;
    }

    if (!story) {
      console.log(`[Scheduler] Antrean darurat kosong untuk slot ${label}, memproduksi langsung...`);
      const curated = await produceCuratedStory({
        formatType: targetFormat,
        targetNicheType: slotConf.targetNicheType || 'locked',
        variant: 'B',
        origin: 'fiction'
      });
      const storyId = db.addStoryToQueue({
        title: curated.title,
        topic: curated.topic,
        slides: curated.slides,
        productName: curated.product_name || null,
        productUrl: curated.product_url || null,
        scheduledFor: `${dateStr}T${slotTime}:00+07:00`,
        qcScore: curated.qcScore,
        qcNotes: curated.qcNotes,
        origin: curated.origin || 'fiction',
        topicTag: curated.topic_tag || curated.topicTag || 'curhat',
        variant: curated.variant || 'B',
        formatType: curated.format_type || targetFormat
      });
      story = db.getStoryById(storyId);
    }

    if (!story) {
      console.log(`[Scheduler] Tidak ada konten yang dapat diposting untuk slot ${label}.`);
      return;
    }

    try {
      const cleanStory = sanitizeStoryBeforePublish(story);
      const slides = cleanStory.slides;
      const publishResult = await publishStoryToThreads(userId, token, {
        title: cleanStory.title,
        slides: slides,
        product_name: cleanStory.product_name,
        product_url: cleanStory.product_url,
        topic_tag: cleanStory.topic_tag || null
      });

      const postId = typeof publishResult === 'object' ? publishResult.rootPostId : publishResult;
      const lastId = typeof publishResult === 'object' ? publishResult.lastPostId : postId;
      const permalink = typeof publishResult === 'object' ? publishResult.permalink : `https://www.threads.net/@ceritakikiii`;

      db.markStoryPublished(story.id, postId, lastId, permalink);
      console.log(`[Scheduler] Sukses terbit postingan #${story.id} (${label}, Format ${story.format_type || 'story'}): ${postId}`);

      const formatType = story.format_type || (story.product_url ? 'story_affiliate' : 'hot_take');
      let formatBadge = '📖 Cerita Relate + Shopee Affiliate';
      if (formatType === 'single_life_update') formatBadge = '☕ Life Update Kiki (Real-Time Persona, 0% Iklan)';
      else if (formatType === 'anonymous_curhat_story') formatBadge = '📩 Cerita DM Anonim Warganet (Add to thread + Shopee)';
      else if (formatType === 'hot_take') formatBadge = '🔥 Hot Take (1-Liner Sarcasm & Relatable Truth)';
      else if (formatType === 'menfess_spill') formatBadge = '🗣️ Menfess Spill (Crowdsourcing Reply Magnet)';
      else if (formatType === 'financial_breakdown') formatBadge = '💸 Financial Breakdown (In This Economy)';

      await sendAdminAlert(
        `🎉 *BERHASIL TAYANG DI THREADS!*\n\n` +
        `⏰ *Slot*: ${label}\n` +
        `⏱️ *Random Jitter*: +${jitterMin} menit (${jitterSec}s)\n` +
        `🏷️ *Format*: *${formatBadge}*\n` +
        `📖 *Judul*: ${story.title}\n` +
        (story.product_name ? `🛍️ *Produk Shopee*: ${story.product_name}\n` : `✨ *Organik*: 0% Link (Growth Magnet)\n`) +
        `🔖 *Topic Tag*: \`#${story.topic_tag || 'threads'}\`\n` +
        `🆔 *Post ID*: \`${postId}\`\n\n` +
        `🔗 [Buka Postingan Threads](${permalink})\n` +
        `Akun: *@ceritakikiii*`
      );
    } catch (err) {
      console.error(`[Scheduler] Gagal posting konten #${story.id} (${story.title}) slot ${label}:`, err.message);
      db.markStoryFailed(story.id, err.message);

      const isFatal = err.metaCode === 190 || err.metaCode === 200 || err.metaCode === 368 ||
                      /190|200|368/.test(err.message);

      if (isFatal) {
        const code = err.metaCode || 'FATAL_META_ERROR';
        console.error(`[Scheduler] MENDETEKSI ERROR FATAL META (${code}). RETRY BUTA DIBATALKAN DEMI KEAMANAN AKUN.`);
        await sendAdminAlert(
          `🚨 *ALERT PUBLISH META ERROR [KODE ${code}]!*\n\n` +
          `Publish pada slot *${label}* GAGAL dan *TIDAK diretry buta* untuk mencegah pembatasan akun lebih lanjut.\n\n` +
          `📖 *Konten*: ${story.title}\n` +
          `❌ *Pesan Error*: ${err.message}`
        );
        return;
      }

      await sendAdminAlert(
        `🚨 *GAGAL AUTO-POSTING KE THREADS!*\n\n` +
        `⏰ *Slot*: ${label}\n` +
        `📖 *Judul*: ${story.title}\n` +
        `❌ *Error*: ${err.message}`
      );
    }
  } finally {
    isPostingInProgress = false;
  }
}

// ==========================================
// ⏰ CRON 6 SLOT HARIAN DENGAN 15-MINUTE VETO WINDOW (WIB)
// ==========================================

// SLOT 1: PAGI KOMUTER (07:15 WIB) -> Veto 07:00 WIB
cron.schedule('0 7 * * *', () => prepareAndNotifyVetoSlot('07:15', 'SLOT 1 - PAGI KOMUTER (07:15 WIB)', 1), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('15 7 * * *', () => executeScheduledPosting('07:15', 'SLOT 1 - PAGI KOMUTER (07:15 WIB)', 1), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// SLOT 2: COFFEE BREAK (10:00 WIB) -> Veto 09:45 WIB
cron.schedule('45 9 * * *', () => prepareAndNotifyVetoSlot('10:00', 'SLOT 2 - COFFEE BREAK (10:00 WIB)', 2), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('0 10 * * *', () => executeScheduledPosting('10:00', 'SLOT 2 - COFFEE BREAK (10:00 WIB)', 2), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// SLOT 3: MAKAN SIANG (12:30 WIB) -> Veto 12:15 WIB [AFFILIATE #1]
cron.schedule('15 12 * * *', () => prepareAndNotifyVetoSlot('12:30', 'SLOT 3 - MAKAN SIANG (12:30 WIB)', 3), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('30 12 * * *', () => executeScheduledPosting('12:30', 'SLOT 3 - MAKAN SIANG (12:30 WIB)', 3), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// SLOT 4: SORE PULANG KANTOR (16:30 WIB) -> Veto 16:15 WIB
cron.schedule('15 16 * * *', () => prepareAndNotifyVetoSlot('16:30', 'SLOT 4 - SORE PULANG KANTOR (16:30 WIB)', 4), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('30 16 * * *', () => executeScheduledPosting('16:30', 'SLOT 4 - SORE PULANG KANTOR (16:30 WIB)', 4), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// SLOT 5: MALAM SANTAI (19:30 WIB) -> Veto 19:15 WIB [AFFILIATE #2]
cron.schedule('15 19 * * *', () => prepareAndNotifyVetoSlot('19:30', 'SLOT 5 - MALAM SANTAI (19:30 WIB)', 5), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('30 19 * * *', () => executeScheduledPosting('19:30', 'SLOT 5 - MALAM SANTAI (19:30 WIB)', 5), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// SLOT 6: PEAK REBAHAN (21:45 WIB) -> Veto 21:30 WIB [AFFILIATE #3]
cron.schedule('30 21 * * *', () => prepareAndNotifyVetoSlot('21:45', 'SLOT 6 - PEAK REBAHAN (21:45 WIB)', 6), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});
cron.schedule('45 21 * * *', () => executeScheduledPosting('21:45', 'SLOT 6 - PEAK REBAHAN (21:45 WIB)', 6), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// Polling Snapshot Views berkala tiap 10 menit (Memastikan jendela presisi ±15 menit tercapai)
cron.schedule('*/10 * * * *', () => {
  recordPeriodicSnapshots().catch(e => console.warn('[Snapshot Cron Error]:', e.message));
});

// Pengecekan Kedaluwarsa Token Harian jam 08:00 WIB
cron.schedule('0 8 * * *', () => {
  checkTokenExpiryReminder().catch(e => console.warn('[Token Check Error]:', e.message));
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 📦 AUTO-REPLENISH BUFFER STOK (Target 18 Konten / 3 Hari Buffer)
// Menjaga keseimbangan 50% Shopee Affiliate & 50% Viral Growth Insight
// ==========================================
cron.schedule('0 */2 * * *', async () => {
  console.log('[Scheduler] Menjalankan auto-replenish buffer stok berkala (Target 18 konten)...');
  try {
    const res = await replenishStockBuffer(18);
    if (res.added > 0) {
      await sendAdminAlert(
        `📦 *[Auto-Stockpile] Stok Berhasil Ditambah!*\n\n` +
        `Dewan Redaksi AI baru saja menambahkan *${res.added} konten terkurasi* ke antrean.\n` +
        `Total stok siap tayang sekarang: *${res.currentCount} konten* (Target 18 untuk buffer 3 hari).`
      );
    }
  } catch (err) {
    console.error('[Scheduler] Gagal auto-replenish:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 🛡️ AFFILIATE LINK HEALTH PATROL (Tiap Hari jam 04:00 WIB)
// Audit link Shopee aktif; karantina otomatis jika toko tutup / 404
// ==========================================
cron.schedule('0 4 * * *', async () => {
  console.log('[Patrol] Menjalankan audit kesehatan link Shopee Affiliate...');
  try {
    const broken = await auditAffiliateLinks();
    if (broken.length > 0) {
      await sendAdminAlert(
        `⚠️ *[Affiliate Patrol Alert]*\n\n` +
        `Ditemukan *${broken.length} link produk Shopee* yang mengarah ke error/404 dan telah dinonaktifkan otomatis dari rotasi:\n` +
        broken.map(b => `• ${b}`).join('\n')
      );
    }
  } catch (err) {
    console.error('[Patrol] Gagal audit link:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 📊 DAILY INSIGHT SYNC & STRATEGY DIGEST (Setiap Malam jam 21:00 WIB)
// Menarik analitik Meta Threads & menyusun rekomendasi strategi konten otomatis
// ==========================================
cron.schedule('0 21 * * *', async () => {
  console.log('[Scheduler] Menjalankan sinkronisasi insight & evaluasi strategi harian...');
  try {
    await trackAllInsights();
    await analyzePerformanceAndStrategize();
    const report = await generateInsightReportMarkdown();
    await sendAdminAlert(report);
  } catch (err) {
    console.error('[Scheduler] Gagal sync insights harian:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 🔄 AUTO-REFRESH TOKEN BERKALA (Tiap tgl 1 & 15 jam 03:00 WIB)
// ==========================================
cron.schedule('0 3 1,15 * *', async () => {
  console.log('[Scheduler] Menjalankan auto-refresh token Threads terjadwal...');
  try {
    const res = await refreshThreadsToken();
    const daysLeft = Math.round((res.expires_in || 5184000) / 86400);
    await sendAdminAlert(`🔄 *Auto-Refresh Token Threads Berhasil!*\n\nMasa aktif token diperpanjang hingga *${daysLeft} hari* ke depan.`);
  } catch (err) {
    console.error('[Scheduler] Gagal auto-refresh token:', err);
    await sendAdminAlert(`🚨 *PERINGATAN: Gagal Auto-Refresh Token Threads!*\n\nError: ${err.message}`);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 💬 AUTONOMOUS AUTO-ENGAGEMENT & REPLY (Setiap 2 Jam Sekali)
// Membalas komentar netizen secara selektif dengan persona Kiki Rachmat
// Dilengkapi guardrails ketat: Max 3/post, max 10/hari, zero toxicity
// ==========================================
cron.schedule('45 8,10,12,14,16,18,20,22 * * *', async () => {
  const userId = process.env.THREADS_USER_ID;
  if (!userId) return;
  console.log('[AutoReply] Menjalankan scan komentar masuk di Threads...');
  try {
    const res = await runAutoEngagementScan(userId);
    if (res.repliedCount > 0) {
      await sendAdminAlert(
        `💬 *[Auto-Engage] Kiki Membalas Netizen!*\n\n` +
        `Berhasil membalas *${res.repliedCount} komentar* di Threads secara natural.\n` +
        `Total interaksi bot hari ini: *${db.getDailyAutoReplyCount()}/10 replies* (Batas aman).`
      );
    }
  } catch (err) {
    console.warn('[AutoReply] Error saat auto-engagement scan:', err.message);
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 🧹 DATABASE & VPS HEALTH CHECK (Tiap Hari Jam 03:30 WIB)
// Melakukan WAL truncation & vacuum memory agar VPS tetap enteng
// ==========================================
cron.schedule('30 3 * * *', () => {
  console.log('[Maintenance] Menjalankan database checkpoint & cleanup VPS...');
  db.runMaintenance();
  if (global.gc) {
    global.gc();
  }
}, {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 🚀 THREAD BUMPER (The 4-Hour Algorithmic Resurfacing)
// Jadwal bump presisi di lembah tayangan tanpa menabrak slot berikutnya:
// 1. Pagi: 10:45 WIB (selesai 1h 45m sebelum slot siang 12:30)
// 2. Siang: 16:00 WIB (selesai 4 jam sebelum slot malam 20:00)
// 3. Malam: 23:00 WIB (jam netizen begadang)
// ==========================================
async function runScheduledThreadBump(slotLabel) {
  if (process.env.EXPERIMENT_PAUSE_EXTRAS !== 'false') {
    // Dijeda selama eksperimen 14 hari agar tidak mengaburkan metrik A/B
    return;
  }
  const userId = process.env.THREADS_USER_ID;
  if (!userId) return;
  console.log(`[ThreadBumper] Menjalankan bump cerdas untuk slot ${slotLabel}...`);
  try {
    const res = await executeThreadBump(userId);
    if (res) {
      const link = getPostUrl(res.rootMediaId);
      await sendAdminAlert(
        `🚀 *[Thread Bumper] Post Berhasil Disundul Ulang!*\n\n` +
        `📖 *Cerita*: ${res.title}\n` +
        `💬 *Update*: "${res.bumpText}"\n\n` +
        `🔗 [Cek Live di Threads](${link})\n` +
        `Algoritma Threads akan merekomendasikan ulang thread ini ke puncak feed For You.`
      );
    }
  } catch (err) {
    console.warn('[ThreadBumper] Gagal bump:', err.message);
  }
}

cron.schedule('45 10 * * *', () => runScheduledThreadBump('PAGI (10:45 WIB)'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

cron.schedule('0 16 * * *', () => runScheduledThreadBump('SIANG (16:00 WIB)'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

cron.schedule('0 23 * * *', () => runScheduledThreadBump('MALAM (23:00 WIB)'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// ⚡ KIKI'S DAILY HOT TAKES & REALITY CHECKS
// Opini santai mengomentari berita & realitas ekonomi Indonesia (0 Link)
// 1. Pagi: 10:15 WIB (Keresahan berita pagi / dunia kerja)
// 2. Sore: 15:30 WIB (Keresahan finansial / In This Economy)
// ==========================================
async function runScheduledHotTake(slotLabel) {
  if (process.env.EXPERIMENT_PAUSE_EXTRAS !== 'false') {
    // Dijeda selama eksperimen 14 hari agar tidak mengaburkan metrik A/B
    return;
  }
  const userId = process.env.THREADS_USER_ID;
  if (!userId) return;
  console.log(`[HotTakes] Menjalankan opini santai untuk slot ${slotLabel}...`);
  try {
    const res = await executeHotTake(userId, slotLabel);
    if (res) {
      const link = res.permalink || getPostUrl(res.mediaId);
      await sendAdminAlert(
        `⚡ *[Hot Take Terbit]* Kiki baru saja mengunggah opini santai di Threads:\n\n` +
        `"${res.postText}"\n\n` +
        `📰 *Dasar Isu*: ${res.headline} (${res.source})\n` +
        `🔗 [Lihat di Threads](${link})\n` +
        `Format organik 0 link ini menjaga reputasi akun dan mendongkrak distribusi feed For You.`
      );
    }
  } catch (err) {
    console.warn('[HotTakes] Gagal eksekusi hot take:', err.message);
  }
}

cron.schedule('15 10 * * *', () => runScheduledHotTake('PAGI (10:15 WIB)'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

cron.schedule('30 15 * * *', () => runScheduledHotTake('SORE (15:30 WIB)'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// Global Error Catching untuk Telegraf
bot.catch((err, ctx) => {
  console.error(`[Telegraf Error] Update ID ${ctx?.update?.update_id || 'unknown'}:`, err);
});

// Start Bot
bot.launch().then(() => {
  console.log('🚀 Kisah Komisi Autopilot Engine AKTIF (Timezone: Asia/Jakarta)!');
  // Trigger otomatis di startup: cek & isi buffer stok bila kurang dari 18
  setTimeout(() => {
    console.log('[Autopilot] Memeriksa stok awal saat startup...');
    replenishStockBuffer(18).catch(e => console.warn('[Autopilot] Startup replenish:', e.message));
  }, 5000);
}).catch(err => {
  console.error('FATAL bot.launch:', err);
  process.exit(1);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`Menangkap ${signal}, menutup dengan aman...`);
  try { bot.stop(signal); } catch (e) {}
  try { db.db.close(); } catch (e) {}
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Guard terhadap unhandled error agar tidak mematikan node process secara diam-diam
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});
