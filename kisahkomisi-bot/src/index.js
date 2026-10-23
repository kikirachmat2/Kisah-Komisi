const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const { generateStory } = require('./aiStory');
const { replenishStockBuffer, produceCuratedStory, auditAffiliateLinks } = require('./editorialBoard');
const { trackAllInsights, analyzePerformanceAndStrategize, generateInsightReportMarkdown } = require('./growthEngine');
const { 
  publishStoryToThreads, 
  getPublishingLimit, 
  getActiveAccessToken, 
  refreshThreadsToken,
  deletePost,
  getPostUrl
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

// Kirim notifikasi / alert ke Telegram admin
async function sendAdminAlert(text, extra = {}) {
  const adminChatId = process.env.ADMIN_CHAT_ID || db.getSetting('LAST_ADMIN_CHAT_ID');
  if (!adminChatId) {
    console.log('[Alert] Tidak ada adminChatId yang terdaftar untuk menerima alert.');
    return;
  }
  try {
    await bot.telegram.sendMessage(adminChatId, text, { parse_mode: 'Markdown', ...extra });
  } catch (e) {
    console.warn('[Alert] Gagal kirim markdown ke admin, fallback plain text:', e.message);
    try {
      const plain = text.replace(/[*_`\[\]()]/g, '');
      const cleanExtra = { ...extra };
      delete cleanExtra.parse_mode;
      await bot.telegram.sendMessage(adminChatId, plain, cleanExtra);
    } catch (err2) {
      console.warn('[Alert] Gagal mengirim notifikasi ke admin:', err2.message);
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
    `🤖 *Kontrol Otomatisasi Threads:*\n` +
    `• \`/insight\` : Cek analitik penayangan & strategi AI terkini\n` +
    `• \`/bikin_cerita\` : AI buat 1 cerita menfess viral (Lolos Kurasi QC)\n` +
    `• \`/isi_stok\` : Trigger otomatis isi buffer stok (Target 9 cerita / 3 hari)\n` +
    `• \`/stok\` : Cek status buffer stok (07:30, 12:30, & 20:00 WIB)\n` +
    `• \`/post_sekarang\` : Terbitkan 1 cerita antrean ke Threads sekarang\n` +
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
    msg += `🛍️ *Produk Affiliate Aktif*: *${productsCount} produk*\n`;
    msg += `🔑 *Terakhir Token Di-refresh*: ${lastRefresh}\n`;
    msg += `🛡️ *Anti-Bot Jitter*: Aktif (Acak 1-10 menit tiap jadwal tayang)\n`;
    msg += `\n⏰ *Jadwal Tayang Golden Hours (3x Sehari):*\n• Pagi: 07:30 WIB (+ Jitter)\n• Siang: 12:30 WIB (+ Jitter)\n• Malam: 20:00 WIB (+ Jitter)`;

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

// Command: /isi_stok
bot.command('isi_stok', async (ctx) => {
  await ctx.reply('⏳ Menjalankan pengisian stok buffer otomatis (Target: 9 cerita / 3 hari)...');
  try {
    const res = await replenishStockBuffer(9);
    if (res.status === 'full') {
      safeReplyMarkdown(ctx, `✅ *Stok Antrean Sudah Penuh!*\n\nSaat ini sudah ada *${res.currentCount} cerita* terkurasi yang siap tayang.`);
    } else if (res.status === 'busy') {
      ctx.reply('⏳ Proses kurasi stok sedang berjalan di background, silakan tunggu sebentar.');
    } else {
      safeReplyMarkdown(ctx, `🎉 *Pengisian Stok Selesai!*\n\nBerhasil menambahkan *${res.added} cerita baru* yang telah lolos QC.\nTotal stok siap tayang sekarang: *${res.currentCount} cerita*.`);
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

    let msg = `📦 *Status Buffer Stok Cerita Otomatis:*\n`;
    msg += `Total Cerita Siap Tayang: *${count} Cerita*\n`;
    msg += `Status Buffer: *${count >= 9 ? '🟢 SEHAT (Aman 3 Hari)' : (count >= 3 ? '🟡 CUKUP (Aman 1-2 Hari)' : '🔴 RENDAH (Auto-Restock Aktif)')}*\n\n`;

    if (upcoming.length > 0) {
      msg += `📋 *Cerita Terdekat yang Siap Tayang:*\n`;
      upcoming.forEach(s => {
        const scoreTag = s.qc_score ? ` ⭐ ${s.qc_score}/10` : '';
        msg += `• *#${s.id}* - ${s.title}${scoreTag} (${s.product_name || 'Cerita'})\n`;
      });
      msg += `\n⏰ *Jadwal Tayang Otomatis (3x Sehari WIB):*\n• Pagi: 07:30 WIB\n• Siang: 12:30 WIB\n• Malam: 20:00 WIB\n\n`;
      msg += `_Sistem autopilot otomatis menjaga minimal 9 cerita di background tanpa perlu intervensi manual._`;
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
    const parsedSlides = JSON.parse(story.slides_json);
    const publishResult = await publishStoryToThreads(userId, token, {
      title: story.title,
      slides: parsedSlides,
      product_name: story.product_name,
      product_url: story.product_url
    });
    const postId = typeof publishResult === 'object' ? publishResult.rootPostId : publishResult;
    const lastId = typeof publishResult === 'object' ? publishResult.lastPostId : postId;

    db.markStoryPublished(story.id, postId, lastId);

    safeReplyMarkdown(
      ctx,
      `🎉 *BERHASIL TAYANG DI THREADS!*\n\n` +
      `📖 *Judul*: ${story.title}\n` +
      `🆔 *Threads Post ID*: \`${postId}\`\n` +
      `🛒 *Struktur*: 1 Post Utama + ${parsedSlides.length - 1} Replies Berantai\n\n` +
      `Cek langsung di aplikasi Threads Anda: *@ceritakikiii*`
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

// ==========================================
// ⏰ AUTO SCHEDULER DENGAN ANTI-BOT JITTER
// Slot Pagi 07:30, Siang 12:30, Malam 20:00 WIB
// ==========================================
async function executeScheduledPosting(label) {
  // Tambahkan jitter acak antara 1 s/d 10 menit agar tidak terbaca bot oleh filter Meta
  const jitterMinutes = Math.floor(Math.random() * 10) + 1;
  const jitterMs = jitterMinutes * 60 * 1000;
  console.log(`[Scheduler] Slot ${label} aktif! Anti-bot jitter menunggu ${jitterMinutes} menit sebelum eksekusi...`);
  
  await new Promise(r => setTimeout(r, jitterMs));

  if (isPostingInProgress) {
    console.warn(`[Scheduler] Sedang ada proses posting lain, menunda slot ${label} selama 30 detik...`);
    await new Promise(r => setTimeout(r, 30000));
  }

  isPostingInProgress = true;
  try {
    console.log(`[Scheduler] Memulai auto-posting untuk slot ${label}...`);
    const userId = process.env.THREADS_USER_ID;
    const token = getActiveAccessToken();

    if (!userId || !token) {
      console.warn('[Scheduler] Threads credentials missing.');
      await sendAdminAlert(`⚠️ *[Scheduler] Gagal Posting (${label})*: Kredensial Threads API belum lengkap di server.`);
      return;
    }

    let story = db.getNextQueuedStory();
    // Jika stok habis, minta AI bikin 1 cerita terkurasi secara on-the-fly!
    if (!story) {
      console.log('[Scheduler] Stok kosong! Men-generate cerita darurat via Creator Gemini + QC Groq...');
      try {
        const generated = await produceCuratedStory();
        db.addStoryToQueue({
          title: generated.title,
          topic: generated.topic,
          slides: generated.slides,
          productName: generated.product_name,
          productUrl: generated.product_url,
          scheduledFor: new Date().toISOString(),
          qcScore: generated.qcScore,
          qcNotes: generated.qcNotes
        });
        story = db.getNextQueuedStory();
      } catch (e) {
        console.error('[Scheduler] Gagal generate cerita darurat:', e);
        await sendAdminAlert(`🚨 *[Scheduler] Error (${label})*: Stok cerita kosong dan gagal auto-generate cerita via AI: ${e.message}`);
        return;
      }
    }

    if (story) {
      try {
        const slides = JSON.parse(story.slides_json);
        const publishResult = await publishStoryToThreads(userId, token, {
          title: story.title,
          slides: slides,
          product_name: story.product_name,
          product_url: story.product_url
        });
        const postId = typeof publishResult === 'object' ? publishResult.rootPostId : publishResult;
        const lastId = typeof publishResult === 'object' ? publishResult.lastPostId : postId;

        db.markStoryPublished(story.id, postId, lastId);
        console.log(`[Scheduler] Sukses posting slot ${label} (Post ID: ${postId})`);

        const remainingStock = db.getQueuedStoriesCount();
        const postLink = getPostUrl(postId);
        await sendAdminAlert(
          `🎉 *BERHASIL AUTO-POSTING KE THREADS!*\n\n` +
          `⏰ *Slot*: ${label}\n` +
          `📖 *Judul*: ${story.title}\n` +
          `🛍️ *Produk*: ${story.product_name || 'Murni Cerita'}\n` +
          `📦 *Sisa Stok Antrean*: *${remainingStock} cerita*\n\n` +
          `🔗 [Buka Postingan Threads](${postLink})\n` +
          `Akun: *@ceritakikiii*`
        );

        // Otomatis isi ulang stok buffer di background agar antrean selalu aman
        replenishStockBuffer(9).catch(e => console.warn('[Scheduler] Auto-replenish error:', e.message));
      } catch (err) {
        console.error(`[Scheduler] Gagal posting cerita #${story.id} (${story.title}) slot ${label}:`, err.message);
        db.markStoryFailed(story.id, err.message);

        // Coba 1x pemulihan otomatis dengan cerita berikutnya di antrean
        const fallbackStory = db.getNextQueuedStory();
        if (fallbackStory) {
          console.log(`[Scheduler] Mencoba mempublikasikan cerita cadangan #${fallbackStory.id} ("${fallbackStory.title}")...`);
          try {
            const fallbackSlides = JSON.parse(fallbackStory.slides_json);
            const fallbackResult = await publishStoryToThreads(userId, token, {
              title: fallbackStory.title,
              slides: fallbackSlides,
              product_name: fallbackStory.product_name,
              product_url: fallbackStory.product_url
            });
            const fallbackPostId = typeof fallbackResult === 'object' ? fallbackResult.rootPostId : fallbackResult;
            const fallbackLastId = typeof fallbackResult === 'object' ? fallbackResult.lastPostId : fallbackPostId;

            db.markStoryPublished(fallbackStory.id, fallbackPostId, fallbackLastId);
            console.log(`[Scheduler] Cerita cadangan #${fallbackStory.id} sukses terbit (Post ID: ${fallbackPostId})`);
            
            await sendAdminAlert(
              `🎉 *AUTO-POSTING BERHASIL (RECOVERY CADANGAN)!*\n\n` +
              `⏰ *Slot*: ${label}\n` +
              `📖 *Judul*: ${fallbackStory.title}\n` +
              `🆔 *Post ID*: \`${fallbackPostId}\`\n\n` +
              `_Catatan: Cerita utama sebelumnya gagal (${err.message}) dan telah digantikan otomatis oleh antrean berikutnya._`
            );
            replenishStockBuffer(9).catch(e => console.warn('[Scheduler] Auto-replenish error:', e.message));
            return;
          } catch (fErr) {
            console.error('[Scheduler] Cerita cadangan juga gagal:', fErr.message);
            db.markStoryFailed(fallbackStory.id, fErr.message);
          }
        }

        await sendAdminAlert(
          `🚨 *GAGAL AUTO-POSTING KE THREADS!*\n\n` +
          `⏰ *Slot*: ${label}\n` +
          `📖 *Judul*: ${story.title}\n` +
          `❌ *Error*: ${err.message}`
        );
      }
    }
  } finally {
    isPostingInProgress = false;
  }
}

// ==========================================
// ⏰ 3 SLOT TAYANG GOLDEN HOURS INDONESIA (WIB)
// Setiap slot disertai anti-bot jitter acak 1-10 menit
// ==========================================
// Slot 1: PAGI 07:30 WIB - Jam komuter & perjalanan kerja
cron.schedule('30 7 * * *', () => executeScheduledPosting('PAGI 07:30 WIB'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// Slot 2: SIANG 12:30 WIB - Jam istirahat makan siang
cron.schedule('30 12 * * *', () => executeScheduledPosting('SIANG 12:30 WIB'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// Slot 3: MALAM 20:00 WIB - Jam prime time rebahan malam
cron.schedule('0 20 * * *', () => executeScheduledPosting('MALAM 20:00 WIB'), {
  scheduled: true,
  timezone: 'Asia/Jakarta'
});

// ==========================================
// 📦 AUTO-REPLENISH BUFFER STOK (Setiap 2 Jam Sekali)
// Menjaga antrean minimal 9 cerita (~3 hari buffer untuk 3x posting sehari)
// ==========================================
cron.schedule('0 */2 * * *', async () => {
  console.log('[Scheduler] Menjalankan auto-replenish buffer stok berkala...');
  try {
    const res = await replenishStockBuffer(9);
    if (res.added > 0) {
      await sendAdminAlert(
        `📦 *[Auto-Stockpile] Stok Berhasil Ditambah!*\n\n` +
        `Dewan Redaksi AI (Gemini Creator + Groq QC) baru saja menambahkan *${res.added} cerita terkurasi* ke antrean.\n` +
        `Total stok siap tayang sekarang: *${res.currentCount} cerita*.`
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
  const userId = process.env.THREADS_USER_ID;
  if (!userId) return;
  console.log(`[HotTakes] Menjalankan opini santai untuk slot ${slotLabel}...`);
  try {
    const res = await executeHotTake(userId, slotLabel);
    if (res) {
      const link = getPostUrl(res.mediaId);
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
  // Trigger otomatis di startup: cek & isi buffer stok bila kurang dari 9
  setTimeout(() => {
    console.log('[Autopilot] Memeriksa stok awal saat startup...');
    replenishStockBuffer(9).catch(e => console.warn('[Autopilot] Startup replenish:', e.message));
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
