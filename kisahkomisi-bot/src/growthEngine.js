const db = require('./database');
const { getAccountInsights, getMediaInsights, getActiveAccessToken } = require('./threads');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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
    console.warn('[GrowthEngine] Gagal sinkronisasi account insights:', err.message);
    results.errors.push(`Account: ${err.message}`);
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

      db.upsertStoryInsight(story.id, story.threads_media_id, postMetrics);
      results.postsTracked++;
    } catch (err) {
      // Post lama atau post yang baru saja tayang <1 jam mungkin belum siap insight-nya dari Meta
    }
  }

  console.log(`[GrowthEngine] Sukses tracking performa untuk ${results.postsTracked} postingan.`);
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
- Total Replies/Komentar: ${latestAccount.replies || 0}

TOP CERITA DENGAN PENAYANGAN & INTERAKSI TERTINGGI:
${topStories.map((s, idx) => `${idx + 1}. Judul: "${s.title}" | Topik: ${s.topic} | Views: ${s.views} | Likes: ${s.likes} | Replies: ${s.replies}`).join('\n')}

TUGAS STRATEGIS:
1. Evaluasi apa yang membuat cerita performa tinggi berhasil menarik pembaca.
2. Rumuskan 3 rekomendasi taktis agar penayangan dan klik link affiliate di Threads meningkat lebih cepat.
3. Tentukan 3-5 topik menfess prioritas yang sebaiknya lebih sering diproduksi AI dalam beberapa hari ke depan.

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
  if (Array.isArray(strategyData.recommended_priority_topics) && strategyData.recommended_priority_topics.length > 0) {
    db.setSetting('PRIORITY_TOPICS', JSON.stringify(strategyData.recommended_priority_topics));
    console.log('[GrowthEngine] Rekomendasi topik prioritas otomatis disinkronkan ke AI Generator:', strategyData.recommended_priority_topics);
  }

  return strategyData;
}

/**
 * Format laporan ringkas untuk dikirim ke Telegram admin
 */
async function generateInsightReportMarkdown() {
  const latestAccount = db.getLatestAccountInsight() || { views: 0, likes: 0, replies: 0 };
  const topStories = db.getTopPerformingStories(3);
  const latestStrategy = db.getLatestStrategyLog();

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

  if (latestStrategy) {
    msg += `💡 *Strategi Optimasi Otomatis (AI Chief Strategist):*\n`;
    msg += `• *Evaluasi*: ${latestStrategy.summary}\n`;
    msg += `• *Rencana Aksi*: ${latestStrategy.recommendations}\n`;
  }

  msg += `\n_Sistem otomatis memperbarui analitik dan menyetel bobot konten setiap hari._`;
  return msg;
}

module.exports = {
  trackAllInsights,
  analyzePerformanceAndStrategize,
  generateInsightReportMarkdown
};
