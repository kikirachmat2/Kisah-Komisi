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

// Konfigurasi performa & kehandalan (WAL mode + 5s busy timeout)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER UNIQUE,
      threads_media_id TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS account_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date DATE UNIQUE,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      raw_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS strategy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary TEXT NOT NULL,
      recommendations TEXT NOT NULL,
      top_topics TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auto_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      threads_media_id TEXT NOT NULL,
      comment_id TEXT UNIQUE NOT NULL,
      author_username TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      reply_media_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hot_takes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_source TEXT,
      headline TEXT,
      post_text TEXT NOT NULL,
      threads_media_id TEXT,
      slot_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
    CREATE INDEX IF NOT EXISTS idx_stories_schedule ON stories(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_story_insights_story ON story_insights(story_id);
    CREATE INDEX IF NOT EXISTS idx_auto_replies_comment ON auto_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_auto_replies_media ON auto_replies(threads_media_id);
    CREATE INDEX IF NOT EXISTS idx_hot_takes_created ON hot_takes(created_at);
  `);

  // Migrasi aman untuk kolom qc_score, qc_notes, bumped_at, dan last_media_id jika belum ada
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN qc_score REAL;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN qc_notes TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN bumped_at DATETIME;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN last_media_id TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN permalink TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN origin TEXT DEFAULT 'fiction';`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN topic_tag TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN variant TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE stories ADD COLUMN format_type TEXT DEFAULT 'story';`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE post_snapshots ADD COLUMN external_replies INTEGER DEFAULT 0;`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE post_snapshots ADD COLUMN is_backfill INTEGER DEFAULT 0;`);
  } catch (e) {}

  // Tandai seluruh snapshot awal historis sebagai backfill
  try {
    db.exec(`UPDATE post_snapshots SET is_backfill = 1 WHERE recorded_at <= '2026-10-24 05:00:00';`);
  } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS experiment_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_number INTEGER NOT NULL,
      scheduled_date DATE NOT NULL,
      slot_time TEXT NOT NULL,
      variant TEXT CHECK(variant IN ('A', 'B')) NOT NULL,
      theme TEXT NOT NULL,
      topic_tag TEXT NOT NULL,
      origin TEXT CHECK(origin IN ('fiction', 'submitted')) DEFAULT 'fiction',
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
      story_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      threads_media_id TEXT NOT NULL,
      snapshot_interval TEXT CHECK(snapshot_interval IN ('1h', '6h', '24h', '72h', 'cumulative')) NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      external_replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      quotes INTEGER DEFAULT 0,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_experiment_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_date DATE UNIQUE NOT NULL,
      day_number INTEGER NOT NULL,
      variant_a_views_24h INTEGER DEFAULT 0,
      variant_b_views_24h INTEGER DEFAULT 0,
      owner_comments_count INTEGER DEFAULT 0,
      new_followers_count INTEGER DEFAULT 0,
      publish_failed_flag INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS niche_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      niche_tag TEXT UNIQUE NOT NULL,
      category_label TEXT NOT NULL,
      is_locked INTEGER DEFAULT 0,
      lock_reason TEXT,
      total_posts INTEGER DEFAULT 0,
      total_views INTEGER DEFAULT 0,
      total_likes INTEGER DEFAULT 0,
      total_replies INTEGER DEFAULT 0,
      avg_views REAL DEFAULT 0,
      avg_replies REAL DEFAULT 0,
      last_tested_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_media ON post_snapshots(threads_media_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_interval ON post_snapshots(snapshot_interval);
    CREATE INDEX IF NOT EXISTS idx_exp_schedule_date ON experiment_schedule(scheduled_date, slot_time);
    CREATE INDEX IF NOT EXISTS idx_niche_locked ON niche_analytics(is_locked);
  `);

  // Seed pilar niche awal jika tabel baru dibuat
  const nicheCount = db.prepare(`SELECT COUNT(*) as cnt FROM niche_analytics`).get()?.cnt || 0;
  if (nicheCount === 0) {
    const seedNiches = [
      { tag: 'finansial', label: 'Finansial & In This Economy', locked: 1, reason: 'Pilar Viral: Simulasi Gaji & Realitas Finansial' },
      { tag: 'krl', label: 'Komuter & Transportasi Publik', locked: 1, reason: 'Pilar Viral: Realitas Jam Sibuk & Perjalanan Kerja' },
      { tag: 'duniakerja', label: 'Dunia Kerja & Kantor', locked: 1, reason: 'Pilar Utama: Drama Rekan Kantor & Lembur' },
      { tag: 'anakkos', label: 'Anak Kos & Kontrakan', locked: 0, reason: null },
      { tag: 'relasi', label: 'Percintaan & Kencan', locked: 0, reason: null },
      { tag: 'rumahtangga', label: 'Tetangga & Lingkungan', locked: 0, reason: null },
      { tag: 'lifestyle_belanja', label: 'Belanja & Gaya Hidup', locked: 0, reason: null },
      { tag: 'radar_viral', label: 'Live Real-time Trending Radar', locked: 0, reason: null }
    ];
    const insertNiche = db.prepare(`
      INSERT OR IGNORE INTO niche_analytics (niche_tag, category_label, is_locked, lock_reason)
      VALUES (?, ?, ?, ?)
    `);
    seedNiches.forEach(n => insertNiche.run(n.tag, n.label, n.locked, n.reason));
  }
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
      INSERT INTO stories (title, topic, slides_json, product_name, product_url, scheduled_for, status, qc_score, qc_notes, origin, topic_tag, variant, format_type)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      story.title,
      story.topic || 'Umum',
      JSON.stringify(story.slides),
      story.productName || null,
      story.productUrl || null,
      story.scheduledFor,
      story.qcScore || null,
      story.qcNotes || null,
      story.origin || 'fiction',
      story.topicTag || null,
      story.variant || null,
      story.formatType || story.format_type || 'story_affiliate'
    );
    return info.lastInsertRowid;
  },

  recordPostSnapshot: (storyId, mediaId, interval, views, likes, replies, reposts, quotes, externalReplies = 0, isBackfill = 0) => {
    return db.prepare(`
      INSERT INTO post_snapshots (story_id, threads_media_id, snapshot_interval, views, likes, replies, reposts, quotes, external_replies, is_backfill)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(storyId, mediaId, interval, views, likes, replies, reposts, quotes, externalReplies, isBackfill);
  },

  hasPostSnapshot: (mediaId, interval) => {
    const row = db.prepare(`
      SELECT id FROM post_snapshots WHERE threads_media_id = ? AND snapshot_interval = ?
    `).get(mediaId, interval);
    return Boolean(row);
  },

  getPostSnapshots: (storyId) => {
    return db.prepare(`
      SELECT * FROM post_snapshots WHERE story_id = ? ORDER BY id ASC
    `).all(storyId);
  },

  getPublishedStoriesForSnapshots: () => {
    return db.prepare(`
      SELECT id, title, published_at, threads_media_id, origin, topic_tag, variant
      FROM stories
      WHERE status = 'published' AND threads_media_id IS NOT NULL
      ORDER BY id DESC
    `).all();
  },

  getExperimentSlot: (dateStr, slotTime) => {
    return db.prepare(`
      SELECT * FROM experiment_schedule 
      WHERE scheduled_date = ? AND slot_time = ?
    `).get(dateStr, slotTime);
  },

  updateExperimentSlot: (id, status, storyId = null) => {
    return db.prepare(`
      UPDATE experiment_schedule 
      SET status = ?, story_id = COALESCE(?, story_id) 
      WHERE id = ?
    `).run(status, storyId, id);
  },

  upsertDailyExperimentLog: (log) => {
    return db.prepare(`
      INSERT INTO daily_experiment_logs (log_date, day_number, variant_a_views_24h, variant_b_views_24h, owner_comments_count, new_followers_count, publish_failed_flag, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(log_date) DO UPDATE SET
        variant_a_views_24h = excluded.variant_a_views_24h,
        variant_b_views_24h = excluded.variant_b_views_24h,
        owner_comments_count = excluded.owner_comments_count,
        new_followers_count = excluded.new_followers_count,
        publish_failed_flag = excluded.publish_failed_flag,
        notes = excluded.notes
    `).run(
      log.date,
      log.dayNumber,
      log.variantAViews24h || 0,
      log.variantBViews24h || 0,
      log.ownerCommentsCount || 0,
      log.newFollowersCount || 0,
      log.publishFailedFlag || 0,
      log.notes || null
    );
  },

  getQueuedStoriesCount: () => {
    return db.prepare(`SELECT count(*) as count FROM stories WHERE status = 'queued'`).get().count;
  },

  getQueuedFormatBreakdown: () => {
    const rows = db.prepare(`SELECT format_type, count(*) as count FROM stories WHERE status = 'queued' GROUP BY format_type`).all();
    const res = {};
    rows.forEach(r => {
      res[r.format_type || 'story_affiliate'] = r.count;
    });
    return res;
  },

  getNextQueuedStory: (formatType = null) => {
    if (formatType) {
      return db.prepare(`
        SELECT * FROM stories 
        WHERE status = 'queued' AND format_type = ? 
        ORDER BY id ASC 
        LIMIT 1
      `).get(formatType) || null;
    }
    return db.prepare(`
      SELECT * FROM stories 
      WHERE status = 'queued' 
      ORDER BY id ASC 
      LIMIT 1
    `).get();
  },

  getStoryById: (id) => {
    return db.prepare(`SELECT * FROM stories WHERE id = ?`).get(id);
  },

  getUpcomingStories: (limit = 6) => {
    return db.prepare(`
      SELECT id, title, topic, product_name, format_type, slides_json, scheduled_for, status, qc_score, qc_notes 
      FROM stories 
      WHERE status = 'queued' 
      ORDER BY id ASC 
      LIMIT ?
    `).all(limit);
  },

  markStoryPublished: (id, threadsMediaId, lastMediaId = null, permalink = null) => {
    return db.prepare(`
      UPDATE stories 
      SET status = 'published', published_at = CURRENT_TIMESTAMP, threads_media_id = ?, last_media_id = ?, permalink = ? 
      WHERE id = ?
    `).run(threadsMediaId, lastMediaId || threadsMediaId, permalink, id);
  },

  updateStoryLastMediaId: (id, lastMediaId) => {
    return db.prepare(`
      UPDATE stories 
      SET last_media_id = ? 
      WHERE id = ?
    `).run(lastMediaId, id);
  },

  getRecentStoryTopics: (limit = 10) => {
    const rows = db.prepare(`
      SELECT topic FROM stories 
      ORDER BY id DESC 
      LIMIT ?
    `).all(limit);
    return rows.map(r => r.topic).filter(Boolean);
  },

  markStoryFailed: (id, errorMessage) => {
    return db.prepare(`
      UPDATE stories 
      SET status = 'failed', error_message = ? 
      WHERE id = ?
    `).run(errorMessage, id);
  },

  // Product bank helper
  getRandomProduct: (categoriesOrTopic) => {
    let prod = null;
    if (Array.isArray(categoriesOrTopic) && categoriesOrTopic.length > 0) {
      const placeholders = categoriesOrTopic.map(() => 'category LIKE ?').join(' OR ');
      const params = categoriesOrTopic.map(c => `%${c}%`);
      prod = db.prepare(`
        SELECT * FROM product_bank 
        WHERE active = 1 AND (${placeholders})
        ORDER BY times_used ASC, RANDOM() 
        LIMIT 1
      `).get(...params);
    } else if (typeof categoriesOrTopic === 'string' && categoriesOrTopic.trim()) {
      prod = db.prepare(`
        SELECT * FROM product_bank 
        WHERE active = 1 AND category LIKE ? 
        ORDER BY times_used ASC, RANDOM() 
        LIMIT 1
      `).get(`%${categoriesOrTopic}%`);
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
  },

  getSetting: (key, defaultValue = null) => {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key);
    return row ? row.value : defaultValue;
  },

  setSetting: (key, value) => {
    return db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value));
  },

  // Insights & Analytics Helpers
  upsertStoryInsight: (storyId, mediaId, metrics) => {
    return db.prepare(`
      INSERT INTO story_insights (story_id, threads_media_id, views, likes, replies, reposts, quotes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(story_id) DO UPDATE SET
        views = excluded.views,
        likes = excluded.likes,
        replies = excluded.replies,
        reposts = excluded.reposts,
        quotes = excluded.quotes,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      storyId,
      mediaId,
      Number(metrics.views || 0),
      Number(metrics.likes || 0),
      Number(metrics.replies || 0),
      Number(metrics.reposts || 0),
      Number(metrics.quotes || 0)
    );
  },

  upsertAccountInsight: (snapshotDate, metrics, rawJson = null) => {
    return db.prepare(`
      INSERT INTO account_insights (snapshot_date, views, likes, replies, reposts, quotes, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(snapshot_date) DO UPDATE SET
        views = excluded.views,
        likes = excluded.likes,
        replies = excluded.replies,
        reposts = excluded.reposts,
        quotes = excluded.quotes,
        raw_json = excluded.raw_json
    `).run(
      snapshotDate,
      Number(metrics.views || 0),
      Number(metrics.likes || 0),
      Number(metrics.replies || 0),
      Number(metrics.reposts || 0),
      Number(metrics.quotes || 0),
      rawJson ? JSON.stringify(rawJson) : null
    );
  },

  getLatestAccountInsight: () => {
    return db.prepare(`SELECT * FROM account_insights ORDER BY snapshot_date DESC LIMIT 1`).get();
  },

  getAccountInsightsHistory: (limit = 7) => {
    return db.prepare(`SELECT * FROM account_insights ORDER BY snapshot_date DESC LIMIT ?`).all(limit);
  },

  getTopPerformingStories: (limit = 5) => {
    return db.prepare(`
      SELECT s.id, s.title, s.topic, s.product_name, s.published_at,
             COALESCE(i.views, 0) as views,
             COALESCE(i.likes, 0) as likes,
             COALESCE(i.replies, 0) as replies,
             COALESCE(i.reposts, 0) as reposts
      FROM stories s
      LEFT JOIN story_insights i ON s.id = i.story_id
      WHERE s.status = 'published' AND s.threads_media_id IS NOT NULL
      ORDER BY views DESC, likes DESC, s.id DESC
      LIMIT ?
    `).all(limit);
  },

  getAllPublishedStoriesWithMediaId: () => {
    return db.prepare(`
      SELECT id, title, topic, product_name, threads_media_id, published_at
      FROM stories 
      WHERE status = 'published' AND threads_media_id IS NOT NULL
      ORDER BY id DESC
    `).all();
  },

  getRecentPublishedStories: (limit = 25) => {
    return db.prepare(`
      SELECT id, title, topic, product_name, threads_media_id, published_at
      FROM stories 
      WHERE status = 'published' AND threads_media_id IS NOT NULL
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  },

  getRecentStoriesForDeduplication: (limit = 40) => {
    const rows = db.prepare(`
      SELECT id, title, topic, format_type, slides_json, status, created_at, published_at
      FROM stories
      WHERE status IN ('published', 'queued')
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);

    return rows.map(r => {
      let slides = [];
      try {
        slides = JSON.parse(r.slides_json);
      } catch (e) {
        slides = [r.slides_json];
      }
      return {
        ...r,
        slides
      };
    });
  },

  getRecentFinancialDetails: (limit = 20) => {
    const stories = db.prepare(`
      SELECT id, slides_json, topic, format_type, published_at
      FROM stories
      WHERE status IN ('published', 'queued')
        AND (format_type = 'financial_breakdown' OR topic LIKE '%gaji%' OR slides_json LIKE '%gaji%')
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);

    const details = [];
    for (const s of stories) {
      let text = '';
      try {
        const parsed = JSON.parse(s.slides_json);
        text = Array.isArray(parsed) ? parsed.join(' ') : String(parsed);
      } catch (e) {
        text = String(s.slides_json);
      }

      // Ekstraksi nominal gaji (contoh: "Gaji 6 juta", "gaji 5.5 jt", "gaji 1.8jt")
      const incomeMatch = text.match(/(?:gaji|income)\s*(?:sebesar)?\s*(\d+[,\.]?\d*)\s*(jt|juta|ribu|rb)?/i);
      let incomeJt = null;
      if (incomeMatch && incomeMatch[1]) {
        let valStr = incomeMatch[1].replace(',', '.');
        let val = parseFloat(valStr);
        const unit = (incomeMatch[2] || '').toLowerCase();
        if (unit === 'ribu' || unit === 'rb') val = val / 1000;
        incomeJt = Number(val.toFixed(1));
      }

      // Ekstraksi lokasi (contoh: "di Jakarta", "di Jaksel", "di Kuningan")
      const locationMatch = text.match(/di\s+([A-Z][a-zA-Z\s\/\(\)]+?)(?::|\n|\r|,|\.|$)/);
      const location = locationMatch ? locationMatch[1].trim() : null;

      details.push({
        id: s.id,
        incomeJt,
        location,
        textSnippet: text.slice(0, 150)
      });
    }
    return details;
  },

  recordStrategyLog: (summary, recommendations, topTopics = null) => {
    return db.prepare(`
      INSERT INTO strategy_logs (summary, recommendations, top_topics)
      VALUES (?, ?, ?)
    `).run(summary, recommendations, topTopics ? JSON.stringify(topTopics) : null);
  },

  getLatestStrategyLog: () => {
    return db.prepare(`SELECT * FROM strategy_logs ORDER BY id DESC LIMIT 1`).get();
  },

  // Auto-Reply Helpers
  isCommentReplied: (commentId) => {
    const row = db.prepare(`SELECT id FROM auto_replies WHERE comment_id = ?`).get(commentId);
    return !!row;
  },

  logAutoReply: ({ threadsMediaId, commentId, authorUsername, commentText, replyText, replyMediaId }) => {
    return db.prepare(`
      INSERT INTO auto_replies (threads_media_id, comment_id, author_username, comment_text, reply_text, reply_media_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(threadsMediaId, commentId, authorUsername, commentText, replyText, replyMediaId || null);
  },

  getDailyAutoReplyCount: () => {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt 
      FROM auto_replies 
      WHERE created_at >= datetime('now', '-24 hours')
    `).get();
    return row ? row.cnt : 0;
  },

  getAutoReplyCountForMedia: (mediaId) => {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt 
      FROM auto_replies 
      WHERE threads_media_id = ?
    `).get(mediaId);
    return row ? row.cnt : 0;
  },

  hasRepliedToUserInMedia: (mediaId, username) => {
    if (!mediaId || !username) return false;
    const row = db.prepare(`
      SELECT id FROM auto_replies 
      WHERE threads_media_id = ? AND LOWER(author_username) = LOWER(?)
      LIMIT 1
    `).get(mediaId, username.trim());
    return !!row;
  },

  // Thread Bumper Helpers
  getLatestPublishedStoryUnbumped: (minHoursAgo = 2.5, maxHoursAgo = 6) => {
    return db.prepare(`
      SELECT id, title, topic, slides_json, threads_media_id, last_media_id, published_at
      FROM stories
      WHERE status = 'published' 
        AND threads_media_id IS NOT NULL 
        AND bumped_at IS NULL
        AND published_at >= datetime('now', '-' || ? || ' hours')
        AND published_at <= datetime('now', '-' || ? || ' hours')
      ORDER BY id DESC
      LIMIT 1
    `).get(maxHoursAgo, minHoursAgo);
  },

  markStoryBumped: (storyId) => {
    return db.prepare(`UPDATE stories SET bumped_at = CURRENT_TIMESTAMP WHERE id = ?`).run(storyId);
  },

  // Hot Takes Helpers
  logHotTake: ({ topicSource, headline, postText, threadsMediaId, slotLabel }) => {
    return db.prepare(`
      INSERT INTO hot_takes (topic_source, headline, post_text, threads_media_id, slot_label)
      VALUES (?, ?, ?, ?, ?)
    `).run(topicSource || 'news_radar', headline || null, postText, threadsMediaId || null, slotLabel || null);
  },

  getRecentHotTakes: (limit = 10) => {
    return db.prepare(`
      SELECT * FROM hot_takes 
      ORDER BY id DESC 
      LIMIT ?
    `).all(limit);
  },

  // Database maintenance: checkpoint WAL to prevent file bloat on VPS
  runMaintenance: () => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      return true;
    } catch (e) {
      console.warn('[DB] Maintenance warning:', e.message);
      return false;
    }
  },

  // Adaptive Multi-Niche Lock & Explorer Helpers
  getLockedNiches: () => {
    const rows = db.prepare(`SELECT niche_tag FROM niche_analytics WHERE is_locked = 1 ORDER BY avg_views DESC`).all();
    return rows.map(r => r.niche_tag);
  },

  getExploringNiches: () => {
    const rows = db.prepare(`SELECT niche_tag FROM niche_analytics WHERE is_locked = 0 ORDER BY last_tested_at ASC, id ASC`).all();
    return rows.map(r => r.niche_tag);
  },

  getAllNiches: () => {
    return db.prepare(`SELECT * FROM niche_analytics ORDER BY is_locked DESC, avg_views DESC`).all();
  },

  setNicheLock: (nicheTag, isLocked, reason = null) => {
    return db.prepare(`
      UPDATE niche_analytics 
      SET is_locked = ?, lock_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE niche_tag = ?
    `).run(isLocked ? 1 : 0, reason, nicheTag);
  },

  recordNichePostUsage: (nicheTag) => {
    return db.prepare(`
      UPDATE niche_analytics 
      SET total_posts = total_posts + 1, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE niche_tag = ?
    `).run(nicheTag);
  },

  updateNicheMetrics: (nicheTag, { views = 0, likes = 0, replies = 0 }) => {
    const current = db.prepare(`SELECT total_posts, total_views, total_likes, total_replies FROM niche_analytics WHERE niche_tag = ?`).get(nicheTag);
    if (!current) return false;
    const newViews = current.total_views + views;
    const newLikes = current.total_likes + likes;
    const newReplies = current.total_replies + replies;
    const posts = Math.max(current.total_posts, 1);
    const avgViews = Number((newViews / posts).toFixed(1));
    const avgReplies = Number((newReplies / posts).toFixed(1));

    return db.prepare(`
      UPDATE niche_analytics 
      SET total_views = ?, total_likes = ?, total_replies = ?, avg_views = ?, avg_replies = ?, updated_at = CURRENT_TIMESTAMP
      WHERE niche_tag = ?
    `).run(newViews, newLikes, newReplies, avgViews, avgReplies, nicheTag);
  },

  getDbPath: () => dbPath
};
