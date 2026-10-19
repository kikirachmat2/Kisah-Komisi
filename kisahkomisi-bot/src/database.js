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

    CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
    CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON commissions(created_at);
  `);
}

initSchema();

module.exports = {
  db,
  // Helper queries
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

  updateCommissionStatus: (id, userId, status) => {
    const stmt = db.prepare(`
      UPDATE commissions 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND telegram_user_id = ?
    `);
    const info = stmt.run(status, id, String(userId));
    return info.changes > 0;
  }
};
