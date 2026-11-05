/**
 * src/supabaseFleet.js - Secondary Backup & Alternative Mirror for KisahKomisi
 * ROLE: Asynchronous shadow mirror & offsite backup ONLY.
 * Local SQLite (data/kisahkomisi.db) remains the primary single source of truth.
 * All operations here are non-blocking and fail-safe.
 */

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const host = process.env.SUPABASE_DB_HOST || 'aws-0-ap-southeast-1.pooler.supabase.com';
    const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10);
    const database = process.env.SUPABASE_DB_NAME || 'postgres';
    const user = process.env.SUPABASE_DB_USER || 'postgres.zqgzrkuhemknqnlfdgjr';
    const password = process.env.SUPABASE_DB_PASS || 'ui9nqBbLKqGSv2Px';

    pool = new Pool({
      host,
      port,
      database,
      user,
      password,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 3000,
    });


    pool.on('error', (err) => {
      console.warn('[SupabaseFleet] PG Pool warning:', err.message);
    });
  }
  return pool;
}

/**
 * Sends heartbeat to fleet_telemetry table in Supabase
 */
async function sendFleetHeartbeat(status = 'ONLINE', metrics = {}) {
  try {
    const p = getPool();
    await p.query(`
      INSERT INTO fleet_telemetry (bot_id, bot_name, role, status, last_heartbeat, host, metrics, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6, NOW())
      ON CONFLICT (bot_id) DO UPDATE SET
        status = EXCLUDED.status,
        last_heartbeat = NOW(),
        metrics = EXCLUDED.metrics,
        updated_at = NOW();
    `, ['threads', 'KisahKomisi Threads Bot', 'CONTENT_CREATOR', status, 'SG1 Cloud', JSON.stringify(metrics)]);
    return true;
  } catch (err) {
    console.warn('[SupabaseFleet] Failed to send heartbeat:', err.message);
    return false;
  }
}

/**
 * Stages a post in threads_staging for Zura's review and emits a DELIBERATION_REQUEST event
 */
async function stageThreadsPost(storyData, slotNumber = 1, slotTime = '19:30') {
  try {
    const p = getPool();
    const draftText = Array.isArray(storyData.slides) ? storyData.slides.join('\n\n---\n\n') : String(storyData.slides || '');
    const res = await p.query(`
      INSERT INTO threads_staging (
        story_id, slot_number, slot_time, deliberation_start,
        draft_text, topic, product_name, affiliate_link, virality_score,
        status, created_at, updated_at
      )
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, 'STAGED', NOW(), NOW())
      RETURNING id;
    `, [
      storyData.story_id || null,
      slotNumber,
      slotTime,
      draftText,
      storyData.topic || '',
      storyData.productName || '',
      storyData.productUrl || '',
      storyData.viralityScore || 8.5
    ]);

    const stagingId = res.rows[0]?.id;

    // Publish event to tri_party_bus
    if (stagingId) {
      await p.query(`
        INSERT INTO tri_party_bus (sender, recipient, topic, action, payload, telegram_broadcast, status, created_at)
        VALUES ('threads', 'zura', 'deliberation', 'DELIBERATION_REQUEST', $1, true, 'PENDING', NOW());
      `, [JSON.stringify({
        staging_id: stagingId,
        slot_number: slotNumber,
        slot_time: slotTime,
        topic: storyData.topic || '',
        product_name: storyData.productName || '',
        draft_snippet: draftText.substring(0, 200)
      })]);
    }

    return stagingId;
  } catch (err) {
    console.warn('[SupabaseFleet] Failed to stage threads post:', err.message);
    return null;
  }
}

/**
 * Updates verdict in threads_staging table
 */
async function updateStagingVerdict(stagingId, isApproved, verdictNotes, finalSlides) {
  if (!stagingId) return false;
  try {
    const p = getPool();
    const verdict = isApproved ? 'APPROVED' : 'REJECTED';
    const status = isApproved ? 'APPROVED' : 'REJECTED';
    const finalText = Array.isArray(finalSlides) ? finalSlides.join('\n\n---\n\n') : String(finalSlides || '');
    await p.query(`
      UPDATE threads_staging
      SET zura_verdict = $1,
          zura_feedback = $2,
          final_approved_text = $3,
          human_check_passed = $4,
          status = $5,
          updated_at = NOW()
      WHERE id = $6;
    `, [verdict, verdictNotes, finalText, isApproved, status, stagingId]);
    return true;
  } catch (err) {
    console.warn('[SupabaseFleet] Failed to update staging verdict:', err.message);
    return false;
  }
}

/**
 * Marks post as published
 */
async function markPostPublished(stagingId, storyId) {
  try {
    const p = getPool();
    await p.query(`
      UPDATE threads_staging
      SET status = 'PUBLISHED', updated_at = NOW()
      WHERE id = $1 OR story_id = $2;
    `, [stagingId || 0, storyId || 0]);

    await p.query(`
      INSERT INTO tri_party_bus (sender, recipient, topic, action, payload, telegram_broadcast, status, created_at)
      VALUES ('threads', 'zura', 'deliberation', 'POST_PUBLISHED', $1, true, 'PENDING', NOW());
    `, [JSON.stringify({ staging_id: stagingId, story_id: storyId })]);
    return true;
  } catch (err) {
    console.warn('[SupabaseFleet] Failed to mark published:', err.message);
    return false;
  }
}

/**
 * Updates views, likes, replies in Supabase
 */
async function updatePostMetrics(storyId, views, likes, replies) {
  try {
    const p = getPool();
    await p.query(`
      UPDATE threads_staging
      SET views = $1, likes = $2, replies = $3, updated_at = NOW()
      WHERE story_id = $4;
    `, [Number(views || 0), Number(likes || 0), Number(replies || 0), Number(storyId)]);
    return true;
  } catch (err) {
    console.warn('[SupabaseFleet] Failed to update post metrics:', err.message);
    return false;
  }
}

// Background heartbeat every 60 seconds
let heartbeatInterval = null;
function startHeartbeat(intervalMs = 60000) {
  if (heartbeatInterval) return;
  sendFleetHeartbeat('ONLINE', { mem_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
  heartbeatInterval = setInterval(() => {
    sendFleetHeartbeat('ONLINE', { mem_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
  }, intervalMs);
}

module.exports = {
  getPool,
  sendFleetHeartbeat,
  stageThreadsPost,
  updateStagingVerdict,
  markPostPublished,
  updatePostMetrics,
  startHeartbeat
};

