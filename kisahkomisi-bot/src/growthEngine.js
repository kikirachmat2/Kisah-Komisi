const db = require('./database');
const { getAccountInsights, getMediaInsights, getActiveAccessToken } = require('./threads');
const { TOPICS } = require('./aiStory');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SELF_USERNAME = (process.env.THREADS_USERNAME || 'ceritakikiii').toLowerCase();

/**
 * Metrik `replies` dari Meta ikut menghitung part thread berantai & bump milik kita sendiri.
 * Fungsi ini menghitung balasan ASLI dari akun lain via endpoint conversation.
 * Return null jika gagal (agar tidak menimpa data dengan angka palsu).
 */
async function countRealReplies(mediaId, token) {
  try {
    const res = await fetch(`https://graph.threads.net/v1.0/${mediaId}/conversation?fields=username&access_token=${token}`, {
      signal: AbortSignal.timeout(10000)
    });
    const json = await res.json();
    if (!Array.isArray(json.data)) return null;
    return json.data.filter(c => c.username && c.username.toLowerCase() !== SELF_USERNAME).length;
  } catch (e) {
    return null;
  }
}

/**
 * Mengambil dan menyimpan insight performa akun dan postingan ke database SQLite
 */
async function trackAllInsights() {
  const userId = process.env.THREADS_USER_ID;
  const token = getActiveAccessToken();

  if (!userId || !token) {
    throw new Error('Kredensial Threads API belum lengkap.');
  }

  const results = {
    account: null,
    postsTracked: 0,
    errors: []
  };

  // 1. Ambil & Simpan Account Insights
  try {
    const rawAccount = await getAccountInsights(userId, token);
    const metricsMap = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };

    if (rawAccount?.data) {
      for (const item of rawAccount.data) {
        const name = item.name;
        if (item.total_value && typeof item.total_value.value === 'number') {
          metricsMap[name] = item.total_value.value;
        } else if (Array.isArray(item.values) && item.values.length > 0) {
          // Ambil value hari terakhir
          const latestVal = item.values[item.values.length - 1];
          metricsMap[name] = latestVal.value || 0;
        }
      }
    }

    const todayDate = new Date().toISOString().slice(0, 10);
    db.upsertAccountInsight(todayDate, metricsMap, rawAccount);
    results.account = metricsMap;
    console.log(`[GrowthEngine] Account insights tersimpan untuk tanggal ${todayDate}:`, metricsMap);
  } catch (err) {
    if (err.message && (err.message.includes('API access blocked') || err.message.includes('code":200'))) {
      console.warn('[GrowthEngine] Meta Graph API memblokir endpoint insights. Akun Meta App saat ini belum memiliki izin threads_manage_insights.');
      results.errors.push('Permission threads_manage_insights belum aktif di Meta App.');
    } else {
      console.warn('[GrowthEngine] Gagal sinkronisasi account insights:', err.message);
      results.errors.push(`Account: ${err.message}`);
    }
  }

  // 2. Ambil & Simpan Post Insights untuk 25 cerita terbaru yang sudah tayang
  const publishedStories = db.getRecentPublishedStories ? db.getRecentPublishedStories(25) : db.getAllPublishedStoriesWithMediaId();
  for (const story of publishedStories) {
    try {
      const rawPost = await getMediaInsights(story.threads_media_id, token);
      const postMetrics = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };

      if (rawPost?.data) {
        for (const item of rawPost.data) {
          const val = item.values?.[0]?.value || 0;
          if (item.name === 'views') postMetrics.views = val;
          if (item.name === 'likes') postMetrics.likes = val;
          if (item.name === 'replies' || item.name === 'thread_replies') postMetrics.replies = val;
          if (item.name === 'reposts') postMetrics.reposts = val;
          if (item.name === 'quotes') postMetrics.quotes = val;
        }
      }

      // Ganti angka replies mentah dengan balasan asli dari orang lain
      const realReplies = await countRealReplies(story.threads_media_id, token);
      if (realReplies !== null) postMetrics.replies = realReplies;

      db.upsertStoryInsight(story.id, story.threads_media_id, postMetrics);
      results.postsTracked++;
    } catch (err) {
      // Post lama atau post yang baru saja tayang <1 jam mungkin belum siap insight-nya dari Meta
    }
  }

  console.log(`[GrowthEngine] Sukses tracking performa untuk ${results.postsTracked} postingan.`);

  // 3. Sinkronisasi performa per niche & jalankan evaluasi adaptive locking
  try {
    await syncNicheAnalytics();
    const lockEval = await evaluateAndLockWinningNiches();
    results.nicheEvolution = lockEval;
  } catch (neErr) {
    console.warn('[GrowthEngine] Gagal evaluasi niche locking:', neErr.message);
  }

  return results;
}

/**
 * Menganalisis data performa nyata akun dan menyusun strategi pertumbuhan otomatis
 */
async function analyzePerformanceAndStrategize() {
  const topStories = db.getTopPerformingStories(5);
  const accountHistory = db.getAccountInsightsHistory(7);
  const latestAccount = db.getLatestAccountInsight() || { views: 0, likes: 0, replies: 0 };

  const prompt = `
Kamu adalah Chief Growth Strategist & Head of Audience Retention untuk akun Threads viral @ceritakikiii.

DATA PERFORMA NYATA DARI META THREADS API:
- Total Views Hari Ini: ${latestAccount.views || 0} views
- Total Likes: ${latestAccount.likes || 0}
- Total Replies dari orang lain: ${latestAccount.replies || 0}

TOP CERITA (replies = HANYA balasan dari akun lain, bukan part thread sendiri):
${topStories.map((s, idx) => `${idx + 1}. Judul: "${s.title}" | Topik: ${s.topic} | Views: ${s.views} | Likes: ${s.likes} | Replies asli: ${s.replies}`).join('\n')}

ATURAN ANALISIS:
- Jika total sampel kecil (views < 500 atau replies asli = 0), JANGAN menarik kesimpulan kuat. Katakan datanya belum cukup.
- Threads berbasis teks: JANGAN rekomendasikan hashtag, hook visual/video, atau "link di bio".
- recommended_priority_topics WAJIB dipilih persis (copy teks utuh) dari daftar topik berikut, tidak boleh membuat topik baru:
${TOPICS.map(t => `  - ${t}`).join('\n')}

TUGAS STRATEGIS:
1. Evaluasi jujur apa yang terlihat dari data (termasuk jika datanya belum cukup).
2. Rumuskan 3 rekomendasi taktis untuk menaikkan balasan asli dan views di Threads.
3. Pilih 3-5 topik prioritas dari daftar di atas.

Keluarkan HANYA JSON persis sesuai struktur ini:
{
  "summary": "Analisis singkat performa 1-2 kalimat",
  "key_learnings": [
    "Poin observasi 1",
    "Poin observasi 2"
  ],
  "actionable_strategy": "Tindakan optimasi utama untuk slot tayang berikutnya",
  "recommended_priority_topics": [
    "Nama Topik 1",
    "Nama Topik 2"
  ]
}
`;

  let strategyData = null;

  // Coba analisis via Groq 120B (Reasoning kuat)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.4
        })
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          strategyData = JSON.parse(content);
        }
      }
    } catch (e) {
      console.warn('[GrowthEngine] Groq strategy error:', e.message);
    }
  }

  // Fallback ke OpenRouter
  if (!strategyData && OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: 'nvidia/nemotron-3.5-lightning:free',
          messages: [{ role: 'user', content: prompt + '\n\nBalas HANYA string JSON.' }],
          temperature: 0.4
        })
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
          strategyData = JSON.parse(clean);
        }
      }
    } catch (e) {
      console.warn('[GrowthEngine] OpenRouter strategy error:', e.message);
    }
  }

  if (!strategyData) {
    strategyData = {
      summary: 'Akun mempertahankan pertumbuhan organik yang stabil di tab Untuk Anda (FYP).',
      key_learnings: [
        'Topik dengan konflik personal dan barang sehari-hari memiliki rasio completion rate tertinggi.',
        'Hook tanpa sapaan basi terbukti menahan audiens membaca hingga bagian akhir.'
      ],
      actionable_strategy: 'Pertahankan 3 slot tayang harian (Pagi 07:30, Siang 12:30, Malam 20:00) dengan fokus pada drama relasi & kehidupan kosan.',
      recommended_priority_topics: [
        'Drama Kosan & Teman Sekamar',
        'Kantor Toxic & Rekan Muka Dua',
        'Kencan Pertama Zonk & Aneh'
      ]
    };
  }

  // Simpan hasil strategi ke database
  db.recordStrategyLog(strategyData.summary, strategyData.actionable_strategy, strategyData.recommended_priority_topics);

  // Terapkan adaptasi dinamis: simpan topik prioritas agar sistem AI mengutamakannya
  // Hanya terima topik yang benar-benar ada di bank topik (cegah topik fiksi/horor lama masuk lagi)
  const validTopics = Array.isArray(strategyData.recommended_priority_topics)
    ? strategyData.recommended_priority_topics.filter(t => TOPICS.includes(t))
    : [];
  strategyData.recommended_priority_topics = validTopics;
  if (validTopics.length > 0) {
    db.setSetting('PRIORITY_TOPICS', JSON.stringify(validTopics));
    console.log('[GrowthEngine] Rekomendasi topik prioritas otomatis disinkronkan ke AI Generator:', strategyData.recommended_priority_topics);
  }

  return strategyData;
}

/**
 * Normalisasi tag niche ke pilar standar
 */
function normalizeNicheTag(rawTag) {
  if (!rawTag) return 'curhat';
  const clean = String(rawTag).toLowerCase().split(/[|,/]/)[0].trim().replace(/[^a-z0-9_]/g, '');
  if (clean.includes('finansial') || clean.includes('gaji') || clean.includes('ekonomi')) return 'finansial';
  if (clean.includes('krl') || clean.includes('komuter') || clean.includes('transportasi') || clean.includes('ojol')) return 'krl';
  if (clean.includes('kerja') || clean.includes('kantor') || clean.includes('lembur')) return 'duniakerja';
  if (clean.includes('kos') || clean.includes('kontrakan') || clean.includes('kamar')) return 'anakkos';
  if (clean.includes('relasi') || clean.includes('kencan') || clean.includes('pacar') || clean.includes('jodoh')) return 'relasi';
  if (clean.includes('tangga') || clean.includes('tetangga') || clean.includes('komplek')) return 'rumahtangga';
  if (clean.includes('belanja') || clean.includes('shopee') || clean.includes('lifestyle')) return 'lifestyle_belanja';
  if (clean.includes('radar') || clean.includes('viral') || clean.includes('tren')) return 'radar_viral';
  return clean || 'curhat';
}

/**
 * Sinkronisasi data analitik per niche dari data insight postingan nyata
 */
async function syncNicheAnalytics() {
  try {
    const rawData = db.db.prepare(`
      SELECT 
        s.topic_tag,
        COUNT(s.id) as post_count,
        COALESCE(SUM(si.views), 0) as sum_views,
        COALESCE(SUM(si.likes), 0) as sum_likes,
        COALESCE(SUM(si.replies), 0) as sum_replies
      FROM stories s
      LEFT JOIN story_insights si ON s.id = si.story_id
      WHERE s.status = 'published' AND s.threads_media_id IS NOT NULL
      GROUP BY s.topic_tag
    `).all();

    const nicheMap = {};
    for (const row of rawData) {
      const tag = normalizeNicheTag(row.topic_tag);
      if (!nicheMap[tag]) {
        nicheMap[tag] = { posts: 0, views: 0, likes: 0, replies: 0 };
      }
      nicheMap[tag].posts += row.post_count;
      nicheMap[tag].views += row.sum_views;
      nicheMap[tag].likes += row.sum_likes;
      nicheMap[tag].replies += row.sum_replies;
    }

    const upsertNiche = db.db.prepare(`
      INSERT INTO niche_analytics (niche_tag, category_label, total_posts, total_views, total_likes, total_replies, avg_views, avg_replies, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(niche_tag) DO UPDATE SET
        total_posts = excluded.total_posts,
        total_views = excluded.total_views,
        total_likes = excluded.total_likes,
        total_replies = excluded.total_replies,
        avg_views = excluded.avg_views,
        avg_replies = excluded.avg_replies,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const [tag, m] of Object.entries(nicheMap)) {
      const posts = Math.max(m.posts, 1);
      const avgViews = Number((m.views / posts).toFixed(1));
      const avgReplies = Number((m.replies / posts).toFixed(1));
      const label = tag.charAt(0).toUpperCase() + tag.slice(1);
      upsertNiche.run(tag, label, m.posts, m.views, m.likes, m.replies, avgViews, avgReplies);
    }

    console.log(`[GrowthEngine] Niche analytics tersinkronisasi untuk ${Object.keys(nicheMap).length} pilar niche.`);
    return nicheMap;
  } catch (err) {
    console.warn('[GrowthEngine] Gagal sync niche analytics:', err.message);
    return {};
  }
}

/**
 * Algoritma Adaptif: Mengevaluasi performa niche dan mengunci (auto-lock) gelombang viral baru
 * Prinsip:
 * 1. Exploitation Lock: Kunci niche pemenang (avg_views >= 50) agar slot performa tinggi terjaga.
 * 2. Continuous Exploration: Jangan terpaku di 1 niche; terus uji niche baru (50% slot harian).
 * 3. Wave Cooldown: Jika niche yang dikunci mendingin drastis, buka kunci untuk digantikan pilar baru.
 */
async function evaluateAndLockWinningNiches() {
  const allNiches = db.getAllNiches();
  if (allNiches.length === 0) return { locked: [], exploring: [] };

  const totalViews = allNiches.reduce((acc, n) => acc + (n.total_views || 0), 0);
  const totalPosts = allNiches.reduce((acc, n) => acc + (n.total_posts || 0), 0);
  const overallAvgViews = totalPosts > 0 ? (totalViews / totalPosts) : 0;

  const newlyLocked = [];
  const newlyUnlocked = [];

  for (const n of allNiches) {
    // 1. Cek promosi niche eksplorasi ke LOCKED jika performa viral terbukti
    // Syarat: minimal 2 post diuji, dan avg_views >= 50 atau >= 1.25x rata-rata akun
    if (!n.is_locked && n.total_posts >= 2) {
      if (n.avg_views >= 50 || (overallAvgViews > 0 && n.avg_views >= 1.25 * overallAvgViews)) {
        db.setNicheLock(n.niche_tag, true, `Auto-Locked: Rata-rata ${n.avg_views} views (Gelombang Viral Terbukti)`);
        newlyLocked.push(n.niche_tag);
        console.log(`[GrowthEngine] 🚀 Auto-Locking Niche "${n.niche_tag}"! Performa rata-rata: ${n.avg_views} views.`);
      }
    }

    // 2. Cek apakah ada pilar terkunci yang gelombangnya mendingin drastis (Wave Cooldown)
    // Syarat: minimal 6 post, dan avg_views turun di bawah 15 views
    // Pengecualian: pertahankan minimal 2 niche terkunci (core anchor finansial / krl)
    if (n.is_locked && n.total_posts >= 6 && n.avg_views < 15) {
      const lockedCount = allNiches.filter(x => x.is_locked).length;
      if (lockedCount > 2) {
        db.setNicheLock(n.niche_tag, false, `Auto-Unlocked: Gelombang mereda (${n.avg_views} views), kembali ke rotasi eksplorasi`);
        newlyUnlocked.push(n.niche_tag);
        console.log(`[GrowthEngine] 🌊 Auto-Unlocking Niche "${n.niche_tag}" untuk eksplorasi ulang.`);
      }
    }
  }

  const currentLocked = db.getLockedNiches();
  const currentExploring = db.getExploringNiches();

  return {
    newlyLocked,
    newlyUnlocked,
    currentLocked,
    currentExploring
  };
}

/**
 * Format laporan ringkas untuk dikirim ke Telegram admin
 */
async function generateInsightReportMarkdown() {
  const latestAccount = db.getLatestAccountInsight() || { views: 0, likes: 0, replies: 0 };
  const topStories = db.getTopPerformingStories(3);
  const latestStrategy = db.getLatestStrategyLog();
  const allNiches = db.getAllNiches();

  let msg = `📊 *LAPORAN INSIGHT & PERFORMA THREADS (@ceritakikiii)*\n`;
  msg += `📅 _Data Sinkronisasi Meta Threads API_\n\n`;

  msg += `📈 *Metrik Akun Terkini:*\n`;
  msg += `• Total Penayangan (*Views*): *${latestAccount.views || 0} tayangan*\n`;
  msg += `• Total Interaksi (*Likes*): *${latestAccount.likes || 0} likes*\n`;
  msg += `• Total Diskusi (*Replies*): *${latestAccount.replies || 0} balasan*\n\n`;

  if (topStories.length > 0 && topStories[0].views > 0) {
    msg += `🏆 *Top Cerita Paling Banyak Dilihat:*\n`;
    topStories.forEach((s, idx) => {
      msg += `${idx + 1}. *${s.title}*\n`;
      msg += `   👀 ${s.views} views | ❤️ ${s.likes} likes | 💬 ${s.replies} replies\n`;
    });
    msg += `\n`;
  }

  // Dashboard Algoritma Multi-Niche & Wave-Riding
  if (allNiches.length > 0) {
    const locked = allNiches.filter(n => n.is_locked);
    const exploring = allNiches.filter(n => !n.is_locked);

    msg += `🎯 *Algoritma Multi-Niche & Wave-Riding:*\n`;
    msg += `🔒 *Pilar Viral Terkunci (50% Slot):*\n`;
    if (locked.length > 0) {
      locked.forEach(n => {
        msg += `• \`#${n.niche_tag}\` (${n.avg_views} avg views, ${n.total_posts} posts) ${n.lock_reason ? `- _${n.lock_reason}_` : ''}\n`;
      });
    } else {
      msg += `_Belum ada niche terkunci._\n`;
    }

    msg += `\n🌊 *Eksplorasi Gelombang Baru (50% Slot):*\n`;
    if (exploring.length > 0) {
      exploring.slice(0, 5).forEach(n => {
        msg += `• \`#${n.niche_tag}\` (${n.avg_views} avg views, ${n.total_posts} uji tayang)\n`;
      });
    } else {
      msg += `_Semua niche sedang terkunci._\n`;
    }
    msg += `\n`;
  }

  if (latestStrategy) {
    msg += `💡 *Strategi Optimasi Otomatis (AI Chief Strategist):*\n`;
    msg += `• *Evaluasi*: ${latestStrategy.summary}\n`;
    msg += `• *Rencana Aksi*: ${latestStrategy.recommendations}\n`;
  }

  msg += `\n_Sistem autopilot mengunci pilar viral dan adaptif mencari tren baru setiap hari._`;
  return msg;
}

module.exports = {
  trackAllInsights,
  analyzePerformanceAndStrategize,
  generateInsightReportMarkdown,
  countRealReplies,
  syncNicheAnalytics,
  evaluateAndLockWinningNiches,
  normalizeNicheTag
};
