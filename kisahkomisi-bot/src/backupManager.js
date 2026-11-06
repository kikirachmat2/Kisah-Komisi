/**
 * src/backupManager.js - Automated Remote SQLite Backup to Telegram Cloud
 * 
 * Mengamankan database operasional (kisahkomisi.db & zura.db):
 * 1. Menjalankan SQLite VACUUM INTO / copy aman tanpa lock.
 * 2. Mengompresi file ke format .gz untuk efisiensi transfer.
 * 3. Mengirimkan file dokumen cadangan langsung ke Telegram War Room Group (-5329037538).
 * 4. Melindungi sistem dari risiko single-point-of-failure disk VPS.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./database');

const CANDIDATE_ZURA_DBS = [
  '/home/ubuntu/zura-core/data/zura.db',
  path.join(process.env.HOME || '', 'Documents/Web Develop/Personal AI/data/zura.db')
];

/**
 * Membuat file backup terkompresi .gz dari SQLite database
 */
async function createCompressedBackup(sourceDbPath, label = 'kisahkomisi') {
  if (!fs.existsSync(sourceDbPath)) {
    return null;
  }

  const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempDir = path.join(path.dirname(sourceDbPath), 'temp_backups');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const destGzPath = path.join(tempDir, `${label}_backup_${nowStr}.db.gz`);

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(sourceDbPath);
    const writeStream = fs.createWriteStream(destGzPath);
    const gzip = zlib.createGzip({ level: 9 });

    readStream
      .pipe(gzip)
      .pipe(writeStream)
      .on('finish', () => {
        const stats = fs.statSync(destGzPath);
        resolve({
          path: destGzPath,
          filename: path.basename(destGzPath),
          sizeKb: Math.round(stats.size / 1024),
          createdAt: new Date().toISOString()
        });
      })
      .on('error', reject);
  });
}

/**
 * Menjalankan proses backup penuh dan mengirim ke Telegram War Room
 * @param {Object} telegrafBot - Instance bot Telegraf dari index.js
 * @param {string|number} targetChatId - ID Chat tujuan (default War Room Group)
 */
async function executeDatabaseBackup(telegrafBot, targetChatId = null) {
  const chatId = targetChatId || process.env.TELEGRAM_GROUP_CHAT_ID || '-5329037538';
  if (!telegrafBot || !chatId) {
    console.warn('[Backup] Telegraf bot instance atau chatId belum tersedia.');
    return { success: false, reason: 'missing_bot_or_chat' };
  }

  console.log(`[Backup] 📦 Memulai proses pencadangan database operasional ke Telegram (Chat: ${chatId})...`);

  const results = [];
  const tempFilesToClean = [];

  try {
    // 1. Checkpoint WAL Kisah Komisi DB
    db.runMaintenance();
    const kkDbPath = db.getDbPath();

    // 2. Compress Kisah Komisi DB
    const kkBackup = await createCompressedBackup(kkDbPath, 'kisahkomisi');
    if (kkBackup) {
      tempFilesToClean.push(kkBackup.path);
      const captionKK = `📦 <b>AUTO-BACKUP: KISAH KOMISI DATABASE</b>\n\n• <b>File:</b> <code>${kkBackup.filename}</code>\n• <b>Ukuran:</b> ${kkBackup.sizeKb} KB\n• <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n<i>🛡️ Cadangan aman tersimpan di Telegram Cloud (Anti Single-Point-of-Failure VPS).</i>`;
      
      await telegrafBot.telegram.sendDocument(chatId, {
        source: kkBackup.path,
        filename: kkBackup.filename
      }, {
        caption: captionKK,
        parse_mode: 'HTML'
      });
      results.push(kkBackup);
      console.log(`[Backup] ✅ Sukses mengirim backup Kisah Komisi DB (${kkBackup.sizeKb} KB) ke Telegram.`);
    }

    // 3. Compress Zura DB jika ada
    let zuraDbPath = null;
    for (const p of CANDIDATE_ZURA_DBS) {
      if (fs.existsSync(p)) {
        zuraDbPath = p;
        break;
      }
    }

    if (zuraDbPath) {
      const zuraBackup = await createCompressedBackup(zuraDbPath, 'zura_brain');
      if (zuraBackup) {
        tempFilesToClean.push(zuraBackup.path);
        const captionZura = `🧠 <b>AUTO-BACKUP: ZURA MEMORY & DECISIONS DB</b>\n\n• <b>File:</b> <code>${zuraBackup.filename}</code>\n• <b>Ukuran:</b> ${zuraBackup.sizeKb} KB\n• <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n<i>🛡️ Cadangan memori otonom Zura aman.</i>`;
        
        await telegrafBot.telegram.sendDocument(chatId, {
          source: zuraBackup.path,
          filename: zuraBackup.filename
        }, {
          caption: captionZura,
          parse_mode: 'HTML'
        });
        results.push(zuraBackup);
        console.log(`[Backup] ✅ Sukses mengirim backup Zura DB (${zuraBackup.sizeKb} KB) ke Telegram.`);
      }
    }

    return {
      success: true,
      backedUpCount: results.length,
      files: results
    };
  } catch (err) {
    console.error('[Backup] ❌ Gagal mengeksekusi backup database:', err.message);
    try {
      await telegrafBot.telegram.sendMessage(chatId, `🚨 <b>ALERT BACKUP GAGAL:</b>\n\nError: <code>${err.message}</code>`, { parse_mode: 'HTML' });
    } catch (e) {}
    return { success: false, error: err.message };
  } finally {
    // Bersihkan file sementara
    for (const f of tempFilesToClean) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {}
    }
  }
}

module.exports = {
  createCompressedBackup,
  executeDatabaseBackup
};
