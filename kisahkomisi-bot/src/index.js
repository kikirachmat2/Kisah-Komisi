require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./database');
const { generateStory } = require('./aiStory');
const { publishStoryToThreads } = require('./threads');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('FATAL ERROR: BOT_TOKEN belum diset di file .env');
  process.exit(1);
}

const bot = new Telegraf(token);

// Middleware whitelist user opsional (mendukung user ID angka maupun username @iki021)
const allowedUsers = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(s => s.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

if (allowedUsers.length > 0) {
  bot.use(async (ctx, next) => {
    const fromId = ctx.from ? String(ctx.from.id) : null;
    const username = ctx.from && ctx.from.username ? ctx.from.username.toLowerCase() : null;
    
    const isAllowed = 
      (fromId && allowedUsers.includes(fromId.toLowerCase())) || 
      (username && allowedUsers.includes(username));

    if (isAllowed) {
      return next();
    }
    console.warn(`[Security] Unauthorized access attempt from ID: ${fromId} (@${ctx.from?.username || 'no_username'})`);
    return ctx.reply('⚠️ Maaf, Anda tidak memiliki akses ke bot Kisah Komisi ini.');
  });
}

// Format mata uang Rupiah
function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number);
}

// Command: /start
bot.start((ctx) => {
  const name = ctx.from?.first_name || 'Kawan';
  ctx.replyWithMarkdown(
    `👋 Halo *${name}*! Selamat datang di *Kisah Komisi Autopilot Engine*.\n\n` +
    `🤖 *Kontrol Otomatisasi Threads:*\n` +
    `• \`/bikin_cerita\` : AI buat 1 cerita menfess baru\n` +
    `• \`/stok\` : Cek stok antrean tayang (12:15 & 19:45 WIB)\n` +
    `• \`/post_sekarang\` : Langsung terbitkan 1 cerita antrean ke Threads sekarang\n\n` +
    `🛍️ *Manajemen Link Shopee Affiliate:*\n` +
    `• \`/list_produk\` : Lihat semua link affiliate yang aktif\n` +
    `• \`/tambah_produk <Nama> | <Link>\` : Tambahkan link affiliate Shopee punyamu\n\n` +
    `💰 *Pencatatan Keuangan:*\n` +
    `• \`/catat <proyek> | <nominal> | [klien]\` : Catat komisi manual\n` +
    `• \`/rekap\` : Lihat ringkasan pendapatan\n` +
    `• \`/help\` : Bantuan lengkap`
  );
});

// Command: /bikin_cerita
bot.command('bikin_cerita', async (ctx) => {
  await ctx.reply('⏳ Sedang memproses cerita menfess viral dengan Gemini AI...');
  try {
    const story = await generateStory();
    const id = db.addStoryToQueue({
      title: story.title,
      topic: story.topic,
      slides: story.slides,
      productName: story.product_name,
      productUrl: story.product_url,
      scheduledFor: new Date().toISOString()
    });

    let preview = `✅ *Cerita Baru Berhasil Dibuat & Masuk Antrean!*\n\n`;
    preview += `🆔 *ID Antrean*: #${id}\n`;
    preview += `📖 *Judul*: ${story.title}\n`;
    preview += `🏷️ *Topik*: ${story.topic}\n`;
    preview += `🛍️ *Produk*: ${story.product_name}\n`;
    preview += `🔗 *Link Affiliate*: ${story.product_url}\n\n`;
    preview += `*Contoh Slide 1 (Hook):*\n_"${story.slides[0]}"_\n\n`;
    preview += `*Contoh Slide 7 (Soft Selling):*\n_"${story.slides[6]}"_\n\n`;
    preview += `Gunakan \`/post_sekarang\` jika ingin langsung menerbitkan ke Threads sekarang!`;

    ctx.replyWithMarkdown(preview);
  } catch (err) {
    console.error('Error bikin_cerita:', err);
    ctx.reply(`❌ Gagal membuat cerita: ${err.message}`);
  }
});

// Command: /stok
bot.command('stok', (ctx) => {
  try {
    const count = db.getQueuedStoriesCount();
    const upcoming = db.getUpcomingStories(5);

    let msg = `📦 *Status Antrean Stok Cerita:*\n`;
    msg += `Total Cerita Menunggu: *${count} Cerita*\n\n`;

    if (upcoming.length > 0) {
      msg += `📋 *5 Cerita Terdekat yang Siap Tayang:*\n`;
      upcoming.forEach(s => {
        msg += `• *#${s.id}* - ${s.title} (${s.product_name || '-'})\n`;
      });
      msg += `\n⏰ Jadwal Tayang Otomatis:\n• Siang: 12:15 WIB\n• Malam: 19:45 WIB`;
    } else {
      msg += `_Antrean kosong. Ketik \`/bikin_cerita\` untuk membuat stok baru!_`;
    }

    ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error('Error getStok:', err);
    ctx.reply('❌ Gagal memeriksa stok antrean.');
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
      msg += `${idx + 1}. *${p.name}*\n🔗 [Link Produk](${p.affiliate_url})\n\n`;
    });
    msg += `_Tambahkan link baru dengan cara:_\n\`/tambah_produk Nama Barang | https://s.shopee.co.id/xxx\``;
    ctx.replyWithMarkdown(msg, { disable_web_page_preview: true });
  } catch (err) {
    console.error('Error list_produk:', err);
    ctx.reply('❌ Gagal mengambil daftar produk.');
  }
});

// Command: /tambah_produk <Nama Produk> | <Link Affiliate>
bot.command('tambah_produk', (ctx) => {
  const text = ctx.message.text.replace('/tambah_produk', '').trim();
  if (!text.includes('|')) {
    return ctx.replyWithMarkdown(
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
    ctx.replyWithMarkdown(
      `✅ *Produk Affiliate Berhasil Ditambahkan!*\n\n` +
      `🆔 *ID*: #${newId}\n` +
      `📦 *Nama*: ${name}\n` +
      `🔗 *Link*: ${link}\n\n` +
      `Produk ini akan otomatis diputar AI sebagai iklan selingan di cerita-cerita berikutnya!`
    );
  } catch (err) {
    console.error('Error tambah_produk:', err);
    ctx.reply(`❌ Gagal menambah produk: ${err.message}`);
  }
});

// Command: /post_sekarang (Trigger Manual)
bot.command('post_sekarang', async (ctx) => {
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (!userId || !token) {
    return ctx.reply('⚠️ Kredensial Threads API belum lengkap di server!');
  }

  const story = db.getNextQueuedStory();
  if (!story) {
    return ctx.reply('⚠️ Tidak ada cerita di antrean! Ketik /bikin_cerita dulu.');
  }

  await ctx.reply(`🚀 Sedang mem-publish cerita: "${story.title}" ke akun Threads @kisahkomisi...`);

  try {
    const parsedSlides = JSON.parse(story.slides_json);
    const postId = await publishStoryToThreads(userId, token, {
      title: story.title,
      slides: parsedSlides,
      product_name: story.product_name,
      product_url: story.product_url
    });

    db.markStoryPublished(story.id, postId);

    ctx.replyWithMarkdown(
      `🎉 *BERHASIL TAYANG DI THREADS!*\n\n` +
      `📖 *Judul*: ${story.title}\n` +
      `🆔 *Threads Post ID*: \`${postId}\`\n` +
      `🛒 *Produk & Link Shopee*: Otomatis terpasang di komentar pertama!\n\n` +
      `Cek langsung di aplikasi Threads Anda: *@kisahkomisi*`
    );
  } catch (err) {
    console.error('Error post_sekarang:', err);
    db.markStoryFailed(story.id, err.message);
    ctx.reply(`❌ Gagal mem-publish ke Threads: ${err.message}`);
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

  ctx.replyWithMarkdown(`✅ *Komisi #${id} Dicatat:* ${projectName} (${formatRupiah(amount)})`);
});

// Command: /rekap
bot.command('rekap', (ctx) => {
  const summary = db.getSummaryByUser(ctx.from.id);
  let total = 0;
  summary.forEach(s => total += s.total_amount);
  ctx.replyWithMarkdown(`📊 *Rekap Komisi:* Total *${formatRupiah(total)}*`);
});

// ==========================================
// ⏰ AUTO SCHEDULER (CRON JOB)
// Jam Siang (12:15 WIB = 05:15 UTC)
// Jam Malam (19:45 WIB = 12:45 UTC)
// ==========================================
async function executeScheduledPosting(label) {
  console.log(`[Scheduler] Memulai auto-posting untuk slot ${label}...`);
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;

  if (!userId || !token) {
    console.warn('[Scheduler] Threads credentials missing.');
    return;
  }

  let story = db.getNextQueuedStory();
  // Jika stok habis, minta AI bikin 1 cerita secara on-the-fly!
  if (!story) {
    console.log('[Scheduler] Stok kosong! Men-generate cerita darurat via Gemini...');
    try {
      const generated = await generateStory();
      const id = db.addStoryToQueue({
        title: generated.title,
        topic: generated.topic,
        slides: generated.slides,
        productName: generated.product_name,
        productUrl: generated.product_url,
        scheduledFor: new Date().toISOString()
      });
      story = db.getNextQueuedStory();
    } catch (e) {
      console.error('[Scheduler] Gagal generate cerita darurat:', e);
      return;
    }
  }

  if (story) {
    try {
      const slides = JSON.parse(story.slides_json);
      const postId = await publishStoryToThreads(userId, token, {
        title: story.title,
        slides: slides,
        product_name: story.product_name,
        product_url: story.product_url
      });
      db.markStoryPublished(story.id, postId);
      console.log(`[Scheduler] Sukses posting slot ${label} (Post ID: ${postId})`);
    } catch (err) {
      console.error(`[Scheduler] Gagal posting slot ${label}:`, err);
      db.markStoryFailed(story.id, err.message);
    }
  }
}

// 12:15 WIB (05:15 UTC di server)
cron.schedule('15 5 * * *', () => executeScheduledPosting('SIANG 12:15 WIB'));

// 19:45 WIB (12:45 UTC di server)
cron.schedule('45 12 * * *', () => executeScheduledPosting('MALAM 19:45 WIB'));

// Start Bot
bot.launch().then(() => {
  console.log('🚀 Kisah Komisi Autopilot Engine AKTIF!');
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`Menangkap ${signal}, menutup dengan aman...`);
  bot.stop(signal);
  try { db.db.close(); } catch (e) {}
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
