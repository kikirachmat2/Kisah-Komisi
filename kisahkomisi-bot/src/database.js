const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/kisahkomisi.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Inisialisasi better-sqlite3
const db = new Database(dbPath);

// Konfigurasi performa & kehandalan (WAL mode)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Inisialisasi tabel dasar
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT NOT NULL,
      username TEXT,
      project_name TEXT NOT NULL,
      client_name TEXT,
      amount REAL NOT NULL,
      status TEXT CHECK(status IN ('pending', 'paid', 'cancelled')) DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      topic TEXT,
      slides_json TEXT NOT NULL,
      product_name TEXT,
      product_url TEXT,
      scheduled_for DATETIME,
      published_at DATETIME,
      threads_media_id TEXT,
      status TEXT CHECK(status IN ('draft', 'queued', 'published', 'failed')) DEFAULT 'queued',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_bank (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      affiliate_url TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      times_used INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
    CREATE INDEX IF NOT EXISTS idx_stories_schedule ON stories(scheduled_for);
  `);

  // Tabel product_bank murni dikelola lewat /tambah_produk
}

initSchema();

module.exports = {
  db,
  // Komisi helpers
  addCommission: (data) => {
    const stmt = db.prepare(`
      INSERT INTO commissions (telegram_user_id, username, project_name, client_name, amount, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      String(data.userId),
      data.username || null,
      data.projectName,
      data.clientName || null,
      Number(data.amount),
      data.status || 'pending',
      data.notes || null
    );
    return info.lastInsertRowid;
  },

  getCommissionsByUser: (userId, limit = 10) => {
    return db.prepare(`
      SELECT * FROM commissions 
      WHERE telegram_user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(String(userId), limit);
  },

  getSummaryByUser: (userId) => {
    return db.prepare(`
      SELECT 
        status, 
        COUNT(*) as count, 
        COALESCE(SUM(amount), 0) as total_amount 
      FROM commissions 
      WHERE telegram_user_id = ? 
      GROUP BY status
    `).all(String(userId));
  },

  // Stories helpers
  addStoryToQueue: (story) => {
    const stmt = db.prepare(`
      INSERT INTO stories (title, topic, slides_json, product_name, product_url, scheduled_for, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
    `);
    const info = stmt.run(
      story.title,
      story.topic || 'Umum',
      JSON.stringify(story.slides),
      story.productName || null,
      story.productUrl || null,
      story.scheduledFor
    );
    return info.lastInsertRowid;
  },

  getQueuedStoriesCount: () => {
    return db.prepare(`SELECT count(*) as count FROM stories WHERE status = 'queued'`).get().count;
  },

  getNextQueuedStory: () => {
    return db.prepare(`
      SELECT * FROM stories 
      WHERE status = 'queued' 
      ORDER BY scheduled_for ASC, id ASC 
      LIMIT 1
    `).get();
  },

  getUpcomingStories: (limit = 5) => {
    return db.prepare(`
      SELECT id, title, topic, product_name, scheduled_for, status 
      FROM stories 
      WHERE status = 'queued' 
      ORDER BY scheduled_for ASC 
      LIMIT ?
    `).all(limit);
  },

  markStoryPublished: (id, threadsMediaId) => {
    return db.prepare(`
      UPDATE stories 
      SET status = 'published', published_at = CURRENT_TIMESTAMP, threads_media_id = ? 
      WHERE id = ?
    `).run(threadsMediaId, id);
  },

  markStoryFailed: (id, errorMessage) => {
    return db.prepare(`
      UPDATE stories 
      SET status = 'failed', error_message = ? 
      WHERE id = ?
    `).run(errorMessage, id);
  },

  // Product bank helper
  getRandomProduct: (topic) => {
    let prod = null;
    if (topic) {
      prod = db.prepare(`
        SELECT * FROM product_bank 
        WHERE active = 1 AND category LIKE ? 
        ORDER BY times_used ASC, RANDOM() 
        LIMIT 1
      `).get(`%${topic}%`);
    }
    if (!prod) {
      prod = db.prepare(`
        SELECT * FROM product_bank 
        WHERE active = 1 
        ORDER BY times_used ASC, RANDOM() 
        LIMIT 1
      `).get();
    }
    if (prod) {
      db.prepare(`UPDATE product_bank SET times_used = times_used + 1 WHERE id = ?`).run(prod.id);
    }
    return prod;
  },

  getAllProducts: () => {
    return db.prepare(`SELECT * FROM product_bank WHERE active = 1 ORDER BY id ASC`).all();
  },

  addProduct: (name, affiliateUrl, category = 'Rekomendasi') => {
    const stmt = db.prepare(`
      INSERT INTO product_bank (category, name, description, affiliate_url)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(category, name, 'Produk affiliate rekomendasi', affiliateUrl);
    return info.lastInsertRowid;
  },

  clearProducts: () => {
    return db.prepare(`DELETE FROM product_bank`).run();
  }
};
