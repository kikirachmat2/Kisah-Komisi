require('dotenv').config();
const { Telegraf } = require('telegraf');
const db = require('./database');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('FATAL ERROR: BOT_TOKEN belum diset di file .env');
  process.exit(1);
}

const bot = new Telegraf(token);

// Middleware whitelist user opsional
const allowedUsers = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (allowedUsers.length > 0) {
  bot.use(async (ctx, next) => {
    const fromId = ctx.from ? String(ctx.from.id) : null;
    if (fromId && allowedUsers.includes(fromId)) {
      return next();
    }
    console.warn(`[Security] Unauthorized access attempt from ID: ${fromId} (${ctx.from?.username || 'anonymous'})`);
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
    `👋 Halo *${name}*! Selamat datang di *Kisah Komisi Bot*.\n\n` +
    `Bot ini membantu kamu mencatat komisi proyek, status pembayaran, dan melihat ringkasan keuanganmu.\n\n` +
    `📌 *Daftar Perintah:*\n` +
    `• \`/catat <proyek> | <nominal> | [klien] | [catatan]\` : Catat komisi baru\n` +
    `• \`/rekap\` : Lihat ringkasan komisi (Pending & Paid)\n` +
    `• \`/riwayat\` : Lihat 10 catatan komisi terakhir\n` +
    `• \`/lunas <id_komisi>\` : Tandai komisi sudah lunas\n` +
    `• \`/batal <id_komisi>\` : Tandai komisi dibatalkan\n` +
    `• \`/help\` : Bantuan penggunaan`
  );
});

// Command: /help
bot.help((ctx) => {
  ctx.replyWithMarkdown(
    `📖 *Panduan Penggunaan Kisah Komisi Bot*\n\n` +
    `*1. Mencatat Komisi:*\n` +
    `Gunakan format dengan pemisah tanda pipa (\`|\`):\n` +
    `\`/catat Web Company | 2500000 | PT Maju Jaya | DP 50%\`\n\n` +
    `*2. Rekapitulasi:*\n` +
    `Ketik \`/rekap\` untuk melihat total pendapatan dan komisi yang masih menggantung.\n\n` +
    `*3. Update Status:*\n` +
    `Ketik \`/lunas 1\` untuk menandai komisi #1 sebagai sudah dibayar.`
  );
});

// Command: /catat
bot.command('catat', (ctx) => {
  const text = ctx.message.text.replace('/catat', '').trim();
  if (!text) {
    return ctx.reply(
      '⚠️ Format salah!\nContoh: /catat Desain Logo | 500000 | Toko Kopi | Revisi 2x'
    );
  }

  const parts = text.split('|').map(p => p.trim());
  const projectName = parts[0];
  const amountStr = parts[1];
  const clientName = parts[2] || '-';
  const notes = parts[3] || '';

  const cleanAmount = amountStr ? amountStr.replace(/[^0-9]/g, '') : null;
  const amount = Number(cleanAmount);

  if (!projectName || !amount || isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Harap masukkan nama proyek dan nominal angka yang valid!');
  }

  try {
    const id = db.addCommission({
      userId: ctx.from.id,
      username: ctx.from.username || ctx.from.first_name,
      projectName,
      clientName,
      amount,
      notes
    });

    ctx.replyWithMarkdown(
      `✅ *Komisi Berhasil Dicatat!*\n\n` +
      `🆔 *ID*: #${id}\n` +
      `📁 *Proyek*: ${projectName}\n` +
      `💰 *Nominal*: ${formatRupiah(amount)}\n` +
      `👤 *Klien*: ${clientName}\n` +
      `📝 *Catatan*: ${notes || '-'}\n` +
      `📊 *Status*: ⏳ Pending`
    );
  } catch (err) {
    console.error('Error addCommission:', err);
    ctx.reply('❌ Terjadi kesalahan saat menyimpan data komisi.');
  }
});

// Command: /rekap
bot.command('rekap', (ctx) => {
  try {
    const summary = db.getSummaryByUser(ctx.from.id);
    if (!summary || summary.length === 0) {
      return ctx.reply('Belum ada data komisi yang tercatat. Gunakan /catat untuk mulai!');
    }

    let pendingTotal = 0;
    let pendingCount = 0;
    let paidTotal = 0;
    let paidCount = 0;

    summary.forEach(row => {
      if (row.status === 'pending') {
        pendingTotal = row.total_amount;
        pendingCount = row.count;
      } else if (row.status === 'paid') {
        paidTotal = row.total_amount;
        paidCount = row.count;
      }
    });

    ctx.replyWithMarkdown(
      `📊 *Rekapitulasi Kisah Komisi Kamu*\n\n` +
      `⏳ *Belum Lunas (Pending):*\n` +
      `• Total: *${formatRupiah(pendingTotal)}* (${pendingCount} proyek)\n\n` +
      `✅ *Sudah Diterima (Paid):*\n` +
      `• Total: *${formatRupiah(paidTotal)}* (${paidCount} proyek)\n\n` +
      `💵 *Grand Total Keseluruhan:* *${formatRupiah(pendingTotal + paidTotal)}*`
    );
  } catch (err) {
    console.error('Error getSummary:', err);
    ctx.reply('❌ Gagal mengambil rekapitulasi data.');
  }
});

// Command: /riwayat
bot.command('riwayat', (ctx) => {
  try {
    const items = db.getCommissionsByUser(ctx.from.id, 10);
    if (!items || items.length === 0) {
      return ctx.reply('Belum ada riwayat komisi.');
    }

    let message = `📋 *10 Catatan Komisi Terakhir:*\n\n`;
    items.forEach(item => {
      const statusIcon = item.status === 'paid' ? '✅ Lunas' : item.status === 'pending' ? '⏳ Pending' : '❌ Batal';
      message += `• *#${item.id}* - ${item.project_name}\n`;
      message += `  ${formatRupiah(item.amount)} [${statusIcon}]\n`;
      message += `  Klien: ${item.client_name || '-'} | Tgl: ${item.created_at.split(' ')[0]}\n\n`;
    });

    ctx.replyWithMarkdown(message);
  } catch (err) {
    console.error('Error getRiwayat:', err);
    ctx.reply('❌ Gagal mengambil riwayat komisi.');
  }
});

// Command: /lunas <id>
bot.command('lunas', (ctx) => {
  const parts = ctx.message.text.split(' ');
  const id = parseInt(parts[1], 10);
  if (!id) {
    return ctx.reply('⚠️ Harap masukkan ID komisi. Contoh: /lunas 1');
  }

  const success = db.updateCommissionStatus(id, ctx.from.id, 'paid');
  if (success) {
    ctx.reply(`✅ Komisi #${id} berhasil diupdate menjadi: SUDAH LUNAS 🎉`);
  } else {
    ctx.reply(`❌ Komisi #${id} tidak ditemukan atau bukan milik akun Anda.`);
  }
});

// Command: /batal <id>
bot.command('batal', (ctx) => {
  const parts = ctx.message.text.split(' ');
  const id = parseInt(parts[1], 10);
  if (!id) {
    return ctx.reply('⚠️ Harap masukkan ID komisi. Contoh: /batal 1');
  }

  const success = db.updateCommissionStatus(id, ctx.from.id, 'cancelled');
  if (success) {
    ctx.reply(`⚠️ Komisi #${id} telah ditandai DIBATALKAN.`);
  } else {
    ctx.reply(`❌ Komisi #${id} tidak ditemukan atau bukan milik akun Anda.`);
  }
});

// Start bot
bot.launch().then(() => {
  console.log('🚀 Kisah Komisi Telegram Bot berhasil berjalan!');
}).catch(err => {
  console.error('FATAL: Gagal menjalankan Telegram Bot:', err);
  process.exit(1);
});

// Graceful shutdown untuk PM2 & SQLite WAL flush
function gracefulShutdown(signal) {
  console.log(`\nMenangkap sinyal ${signal}. Menutup bot dan database dengan aman...`);
  bot.stop(signal);
  try {
    db.db.close();
    console.log('Database connection closed cleanly.');
  } catch (e) {
    console.error('Error closing database:', e);
  }
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
