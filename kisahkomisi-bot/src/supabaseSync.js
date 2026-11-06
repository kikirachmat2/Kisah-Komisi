/**
 * src/supabaseSync.js - Supabase Hybrid Cloud Mirror & Schema Provisioner
 * 
 * Menghubungkan SQLite Lokal dengan Supabase Cloud PostgreSQL:
 * 1. Zero-Crash: Jika SUPABASE_URL / KEY belum diisi, fallback anggun tanpa mengganggu bot.
 * 2. Menyediakan generator DDL SQL resmi untuk dibuat di Supabase Studio dalam 1-klik.
 * 3. Menjalankan sinkronisasi REST tanpa dependensi npm berat (menggunakan Fetch bawaan Node.js).
 */

const db = require('./database');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

/**
 * Menghasilkan SQL Schema DDL untuk Supabase Studio (SQL Editor)
 */
function generateSupabaseSchemaSql() {
  return `
-- ==============================================================
-- KISAH KOMISI & ZURA - SUPABASE CLOUD MIRROR SCHEMA
-- Copy-paste query ini ke SQL Editor di Supabase Studio
-- ==============================================================

-- 1. Table Stories (Cloud Mirror)
CREATE TABLE IF NOT EXISTS stories (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,
  format_type TEXT DEFAULT 'story',
  slides JSONB,
  product_name TEXT,
  product_url TEXT,
  threads_media_id TEXT,
  status TEXT DEFAULT 'queued',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table Story Insights (Performa Views & Engagement)
CREATE TABLE IF NOT EXISTS story_insights (
  id BIGSERIAL PRIMARY KEY,
  story_id BIGINT UNIQUE REFERENCES stories(id) ON DELETE CASCADE,
  threads_media_id TEXT,
  views BIGINT DEFAULT 0,
  likes INT DEFAULT 0,
  replies INT DEFAULT 0,
  reposts INT DEFAULT 0,
  quotes INT DEFAULT 0,
  commissions_idr BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table Product Bank (Katalog Afiliasi Shopee)
CREATE TABLE IF NOT EXISTS product_bank (
  id BIGINT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  affiliate_url TEXT NOT NULL,
  times_used INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing untuk kecepatan query dashboard
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_story_insights_views ON story_insights(views DESC);
`;
}

/**
 * Memeriksa kesiapan koneksi Supabase
 */
function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Sinkronisasi data SQLite ke Supabase Cloud via REST API
 */
async function syncStoriesToSupabase(limit = 20) {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      message: 'SUPABASE_URL atau SUPABASE_KEY belum diset di .env. Gunakan generateSupabaseSchemaSql() untuk menyiapkan tabel.',
      schemaSql: generateSupabaseSchemaSql()
    };
  }

  try {
    const stories = db.db.prepare(`
      SELECT s.id, s.title, s.topic, s.slides_json, s.product_name, s.product_url, 
             s.threads_media_id, s.status, s.published_at, s.created_at,
             COALESCE(si.views, 0) as views,
             COALESCE(si.likes, 0) as likes,
             COALESCE(si.replies, 0) as replies
      FROM stories s
      LEFT JOIN story_insights si ON s.id = si.story_id
      ORDER BY s.id DESC
      LIMIT ?
    `).all(limit);

    if (stories.length === 0) {
      return { configured: true, syncedCount: 0 };
    }

    const payload = stories.map(s => {
      let parsedSlides = [];
      try {
        parsedSlides = JSON.parse(s.slides_json);
      } catch (e) {
        parsedSlides = [s.slides_json];
      }
      return {
        id: s.id,
        title: s.title,
        topic: s.topic,
        slides: parsedSlides,
        product_name: s.product_name,
        product_url: s.product_url,
        threads_media_id: s.threads_media_id,
        status: s.status,
        published_at: s.published_at ? new Date(s.published_at).toISOString() : null
      };
    });

    const endpoint = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/stories?on_conflict=id`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase REST Error (${res.status}): ${errText}`);
    }

    return {
      configured: true,
      syncedCount: payload.length,
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    console.warn('[SupabaseSync] Gagal sync ke cloud:', err.message);
    return { configured: true, success: false, error: err.message };
  }
}

module.exports = {
  isSupabaseConfigured,
  generateSupabaseSchemaSql,
  syncStoriesToSupabase
};

