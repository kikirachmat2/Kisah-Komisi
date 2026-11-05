const db = require('./database');
const { getAccountInsights, getMediaInsights, getActiveAccessToken } = require('./threads');
const { TOPICS } = require('./aiStory');
const { reportStoryOutcome } = require('./zuraGatekeeper');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SELF_USERNAME = (process.env.THREADS_USERNAME || 'kikipunyacerita').toLowerCase();

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

      // Laporkan performa riil ke memori eksekutif Zura (Closed Feedback Loop)
      if (postMetrics.views > 0 || postMetrics.likes > 0) {
        reportStoryOutcome({
          storyId: story.id,
          title: story.title,
          views: postMetrics.views,
          likes: postMetrics.likes,
          replies: postMetrics.replies,
          formatType: story.format_type || 'story'
        }).catch(() => {});
      }
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
 * Membangun memori kognitif dinamis (In-Context Empirical Learning) dari performa nyata di database.
 * Dipakai langsung oleh semua generator konten (aiStory, dailyLifeEngine, contentMixer) dan QC Kurator
 * agar sistem otomatis meniru pola pemenang (73rb views) dan menghindari pola yang flop (<15 views).
 */
function buildCognitiveTuningContext() {
  try {
    const winners = db.getWinningStoryExamples ? db.getWinningStoryExamples(3) : [];
    const flops = db.getUnderperformingStoryExamples ? db.getUnderperformingStoryExamples(3) : [];
    const formatStats = db.getFormatPerformanceStats ? db.getFormatPerformanceStats() : [];

    let dynamicRules = [];
    try {
      const rawRules = db.getSetting('DYNAMIC_TUNING_DIRECTIVES');
      if (rawRules) {
        const parsed = JSON.parse(rawRules);
        if (Array.isArray(parsed)) dynamicRules = parsed;
      }
    } catch (e) {}

    if (dynamicRules.length === 0) {
      dynamicRules = [
        'Tulis 100% seperti ketikan manusia asli warga Threads Indonesia: huruf kecil semua (lowercase), kalimat mengalir santai, bukan gaya rangkuman berita atau laporan AI.',
        'Khusus format rincian gaji (financial_breakdown) wajib skimmable ("Gaji X juta di Kota:"); sedangkan untuk format opini/curhat biasa, JANGAN menjejalkan banyak angka/jam kaku seperti kalkulator.',
        'Jangan gunakan penutup template survei bot ("kalian tim A atau tim B? spill!"); tutup dengan celetukan nyelekit, jujur, atau pertanyaan kasual tongkrongan.'
      ];
    }

    let block = `\n=== MEMORI KOGNITIF AUTO-ADAPT (DATA EMPIRIS AKUN @kikipunyacerita) ===\n`;
    block += `ATURAN SELF-TUNING AKTIF (WAJIB DIIKUTI):\n`;
    dynamicRules.slice(0, 4).forEach((r, idx) => {
      block += `${idx + 1}. ${r}\n`;
    });

    if (winners.length > 0) {
      block += `\nCONTOH POSTINGAN PEMENANG (TERBUKTI MELEDAK DI ALGORITMA THREADS - TIRU CARA BERPIKIR & KEPADATAN FAKTA/ANGKANYA, JANGAN COPY TEKSNYA):\n`;
      winners.slice(0, 2).forEach((w, idx) => {
        const snippet = (w.firstSlide || '').replace(/\s+/g, ' ').slice(0, 220);
        block += `- Winner #${idx + 1} (${w.views} views, ${w.replies} replies, format: ${w.format_type || 'story'}): "${snippet}"\n`;
      });
    }

    if (flops.length > 0) {
      block += `\nANTI-EXAMPLE / CONTOH POSTINGAN FLOP (SEPI <15 VIEWS - HINDARI GAYA ABSTRAK/CRINGE SEPERTI INI):\n`;
      flops.slice(0, 2).forEach((f, idx) => {
        const snippet = (f.firstSlide || '').replace(/\s+/g, ' ').slice(0, 180);
        block += `- Flop #${idx + 1} (${f.views} views): "${snippet}"\n`;
      });
    }

    if (formatStats.length > 0) {
      const topFmt = formatStats[0];
      block += `\nFORMAT TERKUAT SAAT INI: ${topFmt.format_type} (Rata-rata ${topFmt.avg_views} views, rekor ${topFmt.max_views} views).\n`;
    }
    block += `=====================================================================\n`;
    return block;
  } catch (err) {
    console.warn('[GrowthEngine] Gagal menyusun cognitive tuning context:', err.message);
    return '';
  }
}

/**
 * Mengambil daftar topik prioritas gabungan (hasil sintesis AI + topik prioritas dari bank topik)
 */
function getAdaptivePriorityTopics() {
  const result = {
    generatedTopics: [],
    priorityBankTopics: [],
    winningFormats: []
  };
  try {
    const genRaw = db.getSetting('DYNAMIC_GENERATED_TOPICS');
    if (genRaw) {
      const parsed = JSON.parse(genRaw);
      if (Array.isArray(parsed)) result.generatedTopics = parsed.filter(Boolean);
    }
  } catch (e) {}

  try {
    const prioRaw = db.getSetting('PRIORITY_TOPICS');
    if (prioRaw) {
      const parsed = JSON.parse(prioRaw);
      if (Array.isArray(parsed)) result.priorityBankTopics = parsed.filter(Boolean);
    }
  } catch (e) {}

  try {
    const fmtRaw = db.getSetting('WINNING_FORMATS_RANK');
    if (fmtRaw) {
      const parsed = JSON.parse(fmtRaw);
      if (Array.isArray(parsed)) result.winningFormats = parsed.filter(Boolean);
    }
  } catch (e) {}

  return result;
}

/**
 * Menganalisis data performa nyata akun dan menyusun strategi pertumbuhan otomatis
 * (Self-Evolving Cognitive Loop: membandingkan post pemenang vs post flop, membaca komentar netizen,
 * merumuskan aturan penulisan baru, dan menciptakan topik baru berpotensi viral).
 */
async function analyzePerformanceAndStrategize() {
  const topStories = db.getWinningStoryExamples ? db.getWinningStoryExamples(5) : db.getTopPerformingStories(5);
  const flopStories = db.getUnderperformingStoryExamples ? db.getUnderperformingStoryExamples(5) : [];
  const formatStats = db.getFormatPerformanceStats ? db.getFormatPerformanceStats() : [];
  const recentComments = db.getRecentNetizenCommentsForIdeation ? db.getRecentNetizenCommentsForIdeation(8) : [];
  const latestAccount = db.getLatestAccountInsight() || { views: 0, likes: 0, replies: 0 };

  const prompt = `
Kamu adalah Cognitive Self-Tuning Engine & Chief Growth Strategist untuk akun Threads Indonesia @kikipunyacerita.
Tugasmu adalah melakukan bedah empiris (data-driven) antara postingan yang MELEDAK vs postingan yang FLOP (sepi), lalu memprogram ulang aturan penulisan AI dan melahirkan topik-topik baru yang memicu debat & perhitungan nyata warganet.

1. DATA AKUN TERKINI:
- Views Akun: ${latestAccount.views || 0} | Likes: ${latestAccount.likes || 0} | Replies: ${latestAccount.replies || 0}

2. PERFORMA PER FORMAT KONTEN:
${formatStats.map(f => `- Format "${f.format_type}": ${f.total_posts} post | Avg Views: ${f.avg_views} | Max Views: ${f.max_views} | Avg Replies: ${f.avg_replies}`).join('\n') || '- Belum ada data format'}

3. POSTINGAN PEMENANG (TERBUKTI VIRAL / VIEWS TERTINGGI):
${topStories.map((s, idx) => `${idx + 1}. [${s.format_type || 'story'}] Views: ${s.views} | Replies: ${s.replies} | Hook: "${(s.firstSlide || s.title || '').replace(/\s+/g, ' ').slice(0, 200)}"`).join('\n') || '- Belum ada post pemenang'}

4. POSTINGAN FLOP / GAGAL (VIEWS <= 15, SEPI INTERAKSI):
${flopStories.map((s, idx) => `${idx + 1}. [${s.format_type || 'story'}] Views: ${s.views} | Hook: "${(s.firstSlide || s.title || '').replace(/\s+/g, ' ').slice(0, 180)}"`).join('\n') || '- Tidak ada sampel flop'}

5. KOMENTAR ASLI NETIZEN TERBARU (Bahan Ideasi Topik Baru):
${recentComments.map((c, idx) => `- @${c.author_username}: "${String(c.comment_text).replace(/\s+/g, ' ').slice(0, 140)}"`).join('\n') || '- Belum ada komentar baru'}

6. DAFTAR BANK TOPIK STATIS:
${TOPICS.map(t => `  - ${t}`).join('\n')}

TUGAS KOGNITIF KAMU (TARGET KPI: MINIMAL 1.000 VIEWS PER POSTINGAN):
1. Bandingkan secara tajam: Kenapa Postingan Pemenang bisa tembus ribuan/puluhan ribu views sedangkan Postingan Flop cuma <15 views? (Perhatikan gaya ketikan manusia asli, hook yang memicu debat warganet, rincian gaji skimmable vs tulisan kaku khas AI yang merangkum berita atau menjejalkan angka kalkulator di kalimat biasa).
2. Kunci Algoritma Meta Threads: REPLY DEPTH & DEBATE VELOCITY adalah sinyal #1 ranking feed For You. Postingan yang banjir komentar perdebatan/quote akan otomatis dilempar ke ribuan orang luar.
3. Rumuskan TEPAT 3 aturan instruksi prompt konkret ("dynamic_prompt_rules") yang akan disuntikkan langsung ke otak penulis AI di siklus berikutnya supaya setiap postingan baru punya DNA yang sama dengan Postingan Pemenang dan 100% bebas dari kesan Bot AI.
   PENTING: Jangan menyuruh AI menjejalkan jam/durasi/rupiah kaku di setiap kalimat biasa. Wajibkan ketikan lowercase santai warga Threads, punchline nyelekit/jujur, dan akhiri dengan pemicu debat/opini tajam yang memaksa netizen nimbrung.
4. Ciptakan 5 TOPIK BARU SPESIFIK ("generated_new_topics") yang lagi rame / relatable banget buat memancing perdebatan sengit warga Threads Indonesia (bebas topik apa saja tanpa guardrail: isu viral pemerintah, dunia kerja toxic, finansial tertekan, drama hubungan, fenomena sosial).
5. Pilih 3-5 "recommended_priority_topics" dari Daftar Bank Topik Statis di atas.
6. Urutkan 3 format terbaik di "winning_formats" berdasarkan data performa di atas.

Keluarkan HANYA JSON valid persis sesuai struktur ini:
{
  "summary": "Analisis tajam 1-2 kalimat membandingkan pola pemenang vs pola yang flop",
  "key_learnings": [
    "Observasi empiris 1",
    "Observasi empiris 2"
  ],
  "actionable_strategy": "Langkah adaptasi konkret yang langsung diterapkan sistem hari ini",
  "dynamic_prompt_rules": [
    "Aturan wajib 1 untuk penulis AI (spesifik & terukur)",
    "Aturan wajib 2 untuk penulis AI",
    "Aturan wajib 3 untuk penulis AI"
  ],
  "generated_new_topics": [
    "Topik baru spesifik 1 (lengkap dengan konteks & angka/konflik nyata)",
    "Topik baru spesifik 2",
    "Topik baru spesifik 3",
    "Topik baru spesifik 4",
    "Topik baru spesifik 5"
  ],
  "winning_formats": [
    "financial_breakdown",
    "menfess_spill",
    "anonymous_curhat_story"
  ],
  "recommended_priority_topics": [
    "Nama Topik dari Bank Statis 1",
    "Nama Topik dari Bank Statis 2"
  ]
}
`;

  let strategyData = null;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // 1. Coba analisis via Groq 120B (Reasoning cepat & tajam)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(18000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.35
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

  // 2. Fallback ke Gemini 2.5 Flash
  if (!strategyData && GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(18000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.35 }
        })
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) {
          strategyData = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
        }
      }
    } catch (e) {
      console.warn('[GrowthEngine] Gemini strategy error:', e.message);
    }
  }

  // 3. Fallback ke OpenRouter
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
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt + '\n\nBalas HANYA string JSON.' }],
          temperature: 0.35
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
      summary: 'Data empiris menunjukkan postingan dengan rincian angka rupiah konkret (bedah gaji & biaya hidup) mendominasi mutlak dibanding keluhan abstrak.',
      key_learnings: [
        'Postingan dengan rincian angka rupiah skimmable mendorong audiens berhenti scroll dan berdebat di kolom reply.',
        'Kalimat pembuka yang abstrak atau penuh kata slang beruntun langsung dilewati algoritma For You.'
      ],
      actionable_strategy: 'Tunggangi semua isu viral real-time tanpa filter, gunakan ketikan lowercase natural warga Threads, dan maksimalkan format dengan hit-rate tertinggi.',
      dynamic_prompt_rules: [
        'Tulis 100% seperti ketikan manusia asli warga Threads Indonesia: huruf kecil semua (lowercase), mengalir santai, jangan merangkum berita atau menjejalkan banyak angka kaku seperti robot.',
        'Tulis dengan nada jujur/nyelekit khas tongkrongan Jakarta tanpa menumpuk kata slang dan tanpa memanggil diri sendiri Ki.',
        'Hindari penutup template "kalian tim A atau B? spill!"; gunakan pertanyaan debat natural atau celetukan jujur.'
      ],
      generated_new_topics: [
        'Simulasi Gaji 6.8 Juta Anak Perantauan di Jakarta: Potongan Kosan 1.7 Juta, KRL, Kirim Ortu, Sisa Tabungan Cuma 400 Ribu',
        'Dilema Reimburse Kantor Belum Cair Berminggu-minggu Padahal Saldo Rekening Pribadi Udah Kritis Menjelang Tanggal Tua',
        'Teman Kantor Pinjam Duit Buat Nombok Paylater Bilangnya Ganti Tanggal 25 Tapi Malah Pamer Beli Barang Baru di Story',
        'Realita Biaya Nikah Sederhana vs Tuntutan Keluarga Besar yang Minta Resepsi Mewah Tanpa Mau Ikut Patungan',
        'Atasan Minta Standby Revisi Hari Sabtu Tanpa Hitungan Lembur Padahal Kontrak Kerja Jelas Senin-Jumat'
      ],
      winning_formats: [
        'financial_breakdown',
        'menfess_spill',
        'anonymous_curhat_story'
      ],
      recommended_priority_topics: [
        'Spill Gaji Karyawan Berujung Dikucilkan (Karyawan baru gaji lebih tinggi dari senior yang loyal 4 tahun)',
        'Teman Pinjam Uang Pura-pura Amnesia (Ditagih beralasan lagi susah tapi update story liburan dan makan enak)',
        'Drama Token Listrik Jebol di Kontrakan (Teman sekamar nyalain AC 24 jam tapi maunya patungan listrik rata)'
      ]
    };
  }

  // Simpan hasil strategi ke database
  db.recordStrategyLog(strategyData.summary, strategyData.actionable_strategy, strategyData.recommended_priority_topics);

  // 1. Simpan Dynamic Prompt Rules (Aturan Self-Tuning yang langsung mengubah prompt generator)
  if (Array.isArray(strategyData.dynamic_prompt_rules) && strategyData.dynamic_prompt_rules.length > 0) {
    const cleanRules = strategyData.dynamic_prompt_rules.map(r => String(r).trim()).filter(Boolean).slice(0, 5);
    db.setSetting('DYNAMIC_TUNING_DIRECTIVES', JSON.stringify(cleanRules));
    console.log('[GrowthEngine] 🧠 Dynamic Prompt Directives diperbarui otomatis:', cleanRules);
  }

  // 2. Simpan Generated New Topics (Tanpa filter/guardrail topik)
  if (Array.isArray(strategyData.generated_new_topics) && strategyData.generated_new_topics.length > 0) {
    const cleanGenTopics = strategyData.generated_new_topics
      .map(t => String(t).trim())
      .filter(t => t.length >= 15)
      .slice(0, 8);
    if (cleanGenTopics.length > 0) {
      db.setSetting('DYNAMIC_GENERATED_TOPICS', JSON.stringify(cleanGenTopics));
      console.log('[GrowthEngine] 💡 Topik baru hasil sintesis AI disimpan:', cleanGenTopics);
    }
  }

  // 3. Simpan Winning Formats Rank
  if (Array.isArray(strategyData.winning_formats) && strategyData.winning_formats.length > 0) {
    db.setSetting('WINNING_FORMATS_RANK', JSON.stringify(strategyData.winning_formats));
  }

  // 4. Simpan Priority Topics dari Bank Statis
  const validTopics = Array.isArray(strategyData.recommended_priority_topics)
    ? strategyData.recommended_priority_topics.filter(t => TOPICS.includes(t))
    : [];
  strategyData.recommended_priority_topics = validTopics;
  if (validTopics.length > 0) {
    db.setSetting('PRIORITY_TOPICS', JSON.stringify(validTopics));
    console.log('[GrowthEngine] 🎯 Rekomendasi topik prioritas disinkronkan:', strategyData.recommended_priority_topics);
  }

  db.setSetting('LAST_COGNITIVE_TUNING_AT', new Date().toISOString());
  return strategyData;
}

/**
 * Normalisasi tag niche ke pilar standar
 */
function normalizeNicheTag(rawTag) {
  if (!rawTag) return 'curhat';
  const clean = String(rawTag).toLowerCase().split(/[|,/]/)[0].trim().replace(/[^a-z0-9_]/g, '');
  if (clean.includes('remote') || clean.includes('wfh') || clean.includes('tech') || clean.includes('freelance')) return 'remote_tech';
  if (clean.includes('setup') || clean.includes('meja') || clean.includes('ergonomic') || clean.includes('mouse') || clean.includes('monitor')) return 'workplace_setup';
  if (clean.includes('dilema') || clean.includes('politik') || clean.includes('promosi') || clean.includes('hrd')) return 'corporate_dilemma';
  if (clean.includes('digital') || clean.includes('fomo') || clean.includes('medsos') || clean.includes('paylater') || clean.includes('iphone')) return 'kultur_digital';
  if (clean.includes('taboo') || clean.includes('warisan') || clean.includes('resepsi') || clean.includes('nikah') || clean.includes('mertua')) return 'adulting_taboo';
  if (clean.includes('etika') || clean.includes('nepotisme') || clean.includes('firing') || clean.includes('bos') || clean.includes('tenggo')) return 'etika_karier';
  if (clean.includes('rantau') || clean.includes('perantauan') || clean.includes('daerah') || clean.includes('mudik') || clean.includes('bali')) return 'perantauan_daerah';
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
 * KPI TARGET: minimal views per postingan (default 1000, bisa diubah lewat app_settings VIEW_TARGET)
 */
function getViewTarget() {
  const raw = Number(db.getSetting('VIEW_TARGET'));
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

/**
 * Hit-rate per format terhadap target views (dipakai Bandit Allocator).
 * Skor Bayesian (hits+1)/(posts+2) supaya format dengan sampel kecil tidak langsung dicap jelek/bagus.
 */
function getFormatHitRates(target = getViewTarget()) {
  try {
    const rows = db.db.prepare(`
      SELECT COALESCE(s.format_type, 'story_affiliate') as format_type,
             COUNT(s.id) as posts,
             SUM(CASE WHEN COALESCE(i.views, 0) >= ? THEN 1 ELSE 0 END) as hits,
             ROUND(AVG(COALESCE(i.views, 0)), 1) as avg_views
      FROM stories s
      LEFT JOIN story_insights i ON s.id = i.story_id
      WHERE s.status = 'published' AND s.threads_media_id IS NOT NULL
        AND s.published_at <= datetime('now', '-6 hours')
      GROUP BY COALESCE(s.format_type, 'story_affiliate')
    `).all(target);
    const map = {};
    for (const r of rows) {
      map[r.format_type] = {
        posts: r.posts,
        hits: r.hits || 0,
        avg_views: r.avg_views,
        score: ((r.hits || 0) + 1) / (r.posts + 2)
      };
    }
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Bandit Allocator (Thompson-style sederhana): pilih format organik untuk slot non-affiliate.
 * Exploit format yang paling sering tembus target, tapi tetap eksplor 20% agar tidak terjebak 1 format.
 */
function chooseAdaptiveFormat(candidates, fallback) {
  if (!Array.isArray(candidates) || candidates.length === 0) return fallback;
  const rates = getFormatHitRates();
  if (Math.random() < 0.2) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let best = fallback;
  let bestScore = -1;
  for (const f of candidates) {
    const r = rates[f] || { score: 0.5, posts: 0 };
    // Noise sebanding ketidakpastian (sampel kecil = noise besar)
    const noise = (Math.random() - 0.5) * (1 / Math.sqrt((r.posts || 0) + 1)) * 0.3;
    const s = r.score + noise;
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
}

/**
 * Progress KPI 7 hari terakhir: berapa post yang tembus target views.
 */
function getKpiProgress(days = 7) {
  const target = getViewTarget();
  try {
    const rows = db.db.prepare(`
      SELECT s.id, s.title, s.format_type, COALESCE(i.views, 0) as views
      FROM stories s
      LEFT JOIN story_insights i ON s.id = i.story_id
      WHERE s.status = 'published' AND s.threads_media_id IS NOT NULL
        AND s.published_at >= datetime('now', '-' || ? || ' days')
      ORDER BY views DESC
    `).all(days);
    const hits = rows.filter(r => r.views >= target);
    return {
      target,
      days,
      total: rows.length,
      hits: hits.length,
      hitRate: rows.length > 0 ? Math.round((hits.length / rows.length) * 100) : 0,
      best: rows[0] || null,
      worst: rows[rows.length - 1] || null
    };
  } catch (e) {
    return { target, days, total: 0, hits: 0, hitRate: 0, best: null, worst: null };
  }
}

/**
 * Format laporan ringkas untuk dikirim ke Telegram admin
 */
async function generateInsightReportMarkdown() {
  const latestAccount = db.getLatestAccountInsight() || { views: 0, likes: 0, replies: 0 };
  const topStories = db.getTopPerformingStories(3);
  const latestStrategy = db.getLatestStrategyLog();
  const allNiches = db.getAllNiches();

  const currentUsername = process.env.THREADS_USERNAME || 'kikipunyacerita';
  let msg = `📊 *LAPORAN INSIGHT & PERFORMA THREADS (@${currentUsername})*\n`;
  msg += `📅 _Data Sinkronisasi Meta Threads API_\n\n`;

  msg += `📈 *Metrik Akun Terkini:*\n`;
  msg += `• Total Penayangan (*Views*): *${latestAccount.views || 0} tayangan*\n`;
  msg += `• Total Interaksi (*Likes*): *${latestAccount.likes || 0} likes*\n`;
  msg += `• Total Diskusi (*Replies*): *${latestAccount.replies || 0} balasan*\n\n`;

  const kpi = getKpiProgress(7);
  msg += `🎯 *KPI Target ${kpi.target} Views/Post (7 Hari):*\n`;
  msg += `• Tembus target: *${kpi.hits}/${kpi.total} post* (${kpi.hitRate}%)\n`;
  if (kpi.best) msg += `• Terbaik: ${kpi.best.views} views (${kpi.best.format_type || 'story'})\n`;
  msg += `\n`;

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
    msg += `💡 *Strategi Optimasi Otomatis (Cognitive Self-Tuning):*\n`;
    msg += `• *Evaluasi*: ${latestStrategy.summary}\n`;
    msg += `• *Rencana Aksi*: ${latestStrategy.recommendations}\n`;
  }

  try {
    const rawRules = db.getSetting('DYNAMIC_TUNING_DIRECTIVES');
    if (rawRules) {
      const rules = JSON.parse(rawRules);
      if (Array.isArray(rules) && rules.length > 0) {
        msg += `\n🧠 *Aturan Self-Tuning Aktif (Disuntik ke Prompt AI):*\n`;
        rules.slice(0, 3).forEach((r, idx) => {
          msg += `${idx + 1}. _${r}_\n`;
        });
      }
    }
  } catch (e) {}

  msg += `\n_Sistem autopilot belajar dari data nyata (Winner vs Flop) dan memperbarui instruksi penulisan secara otomatis._`;
  return msg;
}

/**
 * Menghitung kuota & hak tayang affiliate adaptif per hari berdasarkan traksi algoritma & views nyata.
 * 
 * Filosofi:
 * - Baseline (Tier 1: BASELINE): 1 slot affiliate/hari (Slot 5 Malam Santai). 5 slot lainnya 100% organik link-free
 *   untuk meloloskan akun dari penalti de-ranking link eksternal Meta Threads.
 * - Naik ke 2 slot/hari (Tier 2: MOMENTUM): Terbuka untuk Slot 3 (Makan Siang) + Slot 5 (Malam Santai) jika
 *   akun menunjukkan momentum sehat (views postingan baru >= 250, atau ada postingan hari ini >= 75 views, atau replies >= 5).
 * - Naik ke 3 slot/hari (Tier 3: SURGE): Terbuka untuk Slot 3, 5, dan 6 jika akun sedang VIRAL (ada postingan >= 1.000 views
 *   sesuai target KPI, atau total daily views akun >= 1.000).
 */
function getAdaptiveAffiliateStatus() {
  try {
    const manualQuota = db.getSetting('MANUAL_AFFILIATE_QUOTA');
    if (manualQuota && ['1', '2', '3'].includes(String(manualQuota))) {
      const q = parseInt(manualQuota, 10);
      const allowed = q === 3 ? [3, 5, 6] : (q === 2 ? [3, 5] : [5]);
      return {
        tier: 'MANUAL_OVERRIDE',
        quota: q,
        allowedSlots: allowed,
        reason: `Ditetapkan manual oleh user: ${q} slot affiliate/hari.`,
        metrics: {}
      };
    }

    const recentStories = db.getRecentPublishedStoriesWithInsights ? db.getRecentPublishedStoriesWithInsights(12) : [];
    const latestInsight = db.getLatestAccountInsight ? db.getLatestAccountInsight() : null;

    const maxRecentViews = recentStories.length ? Math.max(...recentStories.map(s => Number(s.views || 0))) : 0;
    const avgRecentViews = recentStories.length ? Math.round(recentStories.reduce((acc, s) => acc + Number(s.views || 0), 0) / recentStories.length) : 0;
    const maxRecentReplies = recentStories.length ? Math.max(...recentStories.map(s => Number(s.replies || 0))) : 0;
    const accountDailyViews = latestInsight ? Number(latestInsight.views || 0) : 0;

    const latestPost = recentStories[0] || null;
    const latestPostViews = latestPost ? Number(latestPost.views || 0) : 0;
    const latestPostReplies = latestPost ? Number(latestPost.replies || 0) : 0;

    // TIER 3: VIRAL SURGE (3 Slot: Slot 3 Makan Siang, Slot 5 Malam Santai, Slot 6 Peak Rebahan)
    if (maxRecentViews >= 1000 || accountDailyViews >= 1000) {
      return {
        tier: 'SURGE',
        quota: 3,
        allowedSlots: [3, 5, 6],
        reason: `Viral surge aktif! Postingan tembus >= 1.000 views (Max: ${maxRecentViews}, Akun: ${accountDailyViews}). Kuota maksimal 3 slot affiliate dibuka!`,
        metrics: { maxRecentViews, avgRecentViews, maxRecentReplies, accountDailyViews, latestPostViews }
      };
    }

    // TIER 2: MOMENTUM (2 Slot: Slot 3 Makan Siang + Slot 5 Malam Santai)
    if (maxRecentViews >= 250 || avgRecentViews >= 100 || maxRecentReplies >= 5 || latestPostViews >= 75 || latestPostReplies >= 3 || accountDailyViews >= 200) {
      return {
        tier: 'MOMENTUM',
        quota: 2,
        allowedSlots: [3, 5],
        reason: `Traksi momentum sehat! (Max views: ${maxRecentViews}, Post terbaru: ${latestPostViews} views, Replies: ${maxRecentReplies}). Kuota dinaikkan menjadi 2 slot affiliate (Slot 3 & 5).`,
        metrics: { maxRecentViews, avgRecentViews, maxRecentReplies, accountDailyViews, latestPostViews }
      };
    }

    // TIER 1: BASELINE (1 Slot: Slot 5 Malam Santai)
    return {
      tier: 'BASELINE',
      quota: 1,
      allowedSlots: [5],
      reason: `Fase pelindung algoritma (Views masih < 250). Mengunci 1 slot affiliate harian di jam malam (Slot 5), 5 slot lainnya 100% organik link-free untuk membuka distribusi For You.`,
      metrics: { maxRecentViews, avgRecentViews, maxRecentReplies, accountDailyViews, latestPostViews }
    };
  } catch (err) {
    return {
      tier: 'BASELINE',
      quota: 1,
      allowedSlots: [5],
      reason: `Fallback pengaman: ${err.message}`,
      metrics: {}
    };
  }
}

module.exports = {
  trackAllInsights,
  analyzePerformanceAndStrategize,
  generateInsightReportMarkdown,
  countRealReplies,
  syncNicheAnalytics,
  evaluateAndLockWinningNiches,
  normalizeNicheTag,
  buildCognitiveTuningContext,
  getAdaptivePriorityTopics,
  getViewTarget,
  getFormatHitRates,
  chooseAdaptiveFormat,
  getKpiProgress,
  getAdaptiveAffiliateStatus
};
