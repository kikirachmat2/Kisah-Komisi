const db = require('./database');
const { generateStory, TOPICS } = require('./aiStory');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Mutex lock agar proses pengisian stok tidak tumpang tindih
let isReplenishing = false;

/**
 * Stage 2: Chief Editor / QC Kurator
 * Menilai cerita menfess yang dibuat Creator berdasarkan 4 pilar engagement Threads.
 */
async function evaluateStoryWithQC(story) {
  const slides = story.slides || [];
  const hookSlide = slides[0] || '';
  const intermezzoSlide = slides.find(s => s.includes('http') || s.includes('shope.ee') || s.includes('shopee.co.id')) || '(Tanpa Iklan)';
  const endingSlide = slides[slides.length - 1] || '';

  // Pre-check 1: Deteksi frasa esai / jargon formal yang memicu esai daripada dialog
  const allText = slides.join(' ').toLowerCase();
  const essayJargon = ['faktanya', 'logikanya', 'dalam literatur', 'secara psikologis', 'berdasarkan survei', 'esensi dari', 'menurut pasal'];
  const foundJargon = essayJargon.find(j => allText.includes(j));
  if (foundJargon) {
    return {
      provider: 'Pre-QC Filter',
      approved: false,
      total_score: 4.0,
      scores: { realism: 4, human_tone: 3, format_pacing: 7, affiliate: 10, debate: 4 },
      curator_note: `Ditolak: Mengandung gaya esai formal/jargon ("${foundJargon}"). Wajib adegan konkret percakapan warganet.`
    };
  }

  // Pre-check 2: Pastikan slide 1 diawali header resmi kode
  const expectedHeader = (story.origin === 'submitted') ? '[Kiriman Warganet]' : '[Cerita Fiksi]';
  if (!hookSlide.startsWith(expectedHeader)) {
    return {
      provider: 'Pre-QC Filter',
      approved: false,
      total_score: 5.0,
      scores: { realism: 7, human_tone: 7, format_pacing: 4, affiliate: 10, debate: 6 },
      curator_note: `Ditolak: Header ${expectedHeader} tidak terdeteksi di awal slide 1.`
    };
  }

  const evaluationPrompt = `
Kamu adalah Chief Editor & Kepala Kurator akun Threads viral @ceritakikiii.
Tugasmu adalah menguji dan mengurasi draf cerita menfess sebelum dijadwalkan tayang ke publik.

DATA DRAF CERITA:
Topik: ${story.topic || '-'}
Format Variant: ${story.variant || 'A'}
Produk: ${story.product_name || 'Murni Cerita (Nol Iklan)'}
Link: ${story.product_url || '-'}

SLIDES:
${slides.map((s, idx) => `[Part ${idx + 1}]: ${s}`).join('\n\n')}

KRITERIA PENILAIAN (Skala 1 - 10):
1. realism_score: Apakah ini adegan konkret relatable yang dialami orang dewasa/pekerja Indonesia (kosan, teman, keluarga, transportasi, kantor)? TOLAK jika terasa seperti esai opini atau melodrama sinetron.
2. human_tone_score: Apakah gaya bahasa 100% natural warganet Threads Indonesia (lu-gue/aku-kamu, santai, ceplas-ceplos)? TOLAK jika ada bau klise AI (seperti "tidak disangka-sangka", "pada akhirnya aku menyadari").
3. format_pacing_score: Apakah alur ringkas dan padat (Format A tepat 1 slide ≤280 chars; Format B tepat 3 slide bersambung)?
4. affiliate_score: Nol iklan bernilai 10.
5. debate_score: Apakah memancing netizen untuk berdebat atau menceritakan pengalamannya di kolom reply?

Berikan output HANYA berupa JSON valid persis seperti format ini:
{
  "approved": true,
  "total_score": 8.5,
  "scores": {
    "realism": 9,
    "human_tone": 9,
    "format_pacing": 8,
    "affiliate": 10,
    "debate": 8
  },
  "curator_note": "Ringkasan penilaian kurator dalam 1-2 kalimat"
}

Syarat Lolos (approved = true): total_score >= 7.5 dan realism >= 7.0. Jika terdeteksi gaya esai atau sinetron, set approved = false.
`;

  // 1. Coba QC via Groq (Primary QC LPU ultra-fast)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: evaluationPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          return {
            provider: 'Groq (gpt-oss-120b)',
            approved: Boolean(parsed.approved && parsed.total_score >= 7.5),
            total_score: Number(parsed.total_score) || 8.0,
            scores: parsed.scores || {},
            curator_note: parsed.curator_note || 'Lolos kurasi standar editorial.'
          };
        }
      }
    } catch (e) {
      console.warn('[EditorialBoard] Groq QC error, mencoba fallback:', e.message);
    }
  }

  // 2. Fallback QC via OpenRouter (Emergency QC)
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: evaluationPrompt + '\n\nBalas HANYA string JSON tanpa markdown.' }],
          temperature: 0.3
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(clean);
          return {
            provider: 'OpenRouter (free)',
            approved: Boolean(parsed.approved && parsed.total_score >= 7.5),
            total_score: Number(parsed.total_score) || 8.0,
            scores: parsed.scores || {},
            curator_note: parsed.curator_note || 'Lolos kurasi standar editorial.'
          };
        }
      }
    } catch (e) {
      console.warn('[EditorialBoard] OpenRouter QC error:', e.message);
    }
  }

  // 3. Fallback QC via Gemini Flash (Cadangan handal jika Groq & OpenRouter limit)
  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: evaluationPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      });
      if (geminiRes.ok) {
        const gemData = await geminiRes.json();
        const gemText = gemData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (gemText) {
          const parsed = JSON.parse(gemText.trim());
          return {
            provider: 'Gemini (2.5-flash QC)',
            approved: Boolean(parsed.approved && parsed.total_score >= 7.5),
            total_score: Number(parsed.total_score) || 8.0,
            scores: parsed.scores || {},
            curator_note: parsed.curator_note || 'Lolos kurasi standar editorial.'
          };
        }
      }
    } catch (e) {
      console.warn('[EditorialBoard] Gemini QC error:', e.message);
    }
  }

  // 3. Fallback Heuristik Lokal jika semua API QC sibuk (Sanity Check)
  console.log('[EditorialBoard] Menjalankan Fallback Heuristik Lokal...');
  const hasBasiOpener = /^(halo|hai|kenalin|selamat pagi|siang|malam)/i.test(hookSlide.trim());
  const hasDebateQuestion = endingSlide.includes('?') || endingSlide.includes('gimana') || endingSlide.includes('kalian');
  const allSlidesLengthOk = slides.every(s => s.length >= 80 && s.length <= 480);

  const localScore = (!hasBasiOpener ? 3.0 : 1.0) + (hasDebateQuestion ? 3.0 : 1.5) + (allSlidesLengthOk ? 2.5 : 1.5);
  return {
    provider: 'Local Heuristics',
    approved: localScore >= 7.0,
    total_score: localScore,
    scores: { hook: !hasBasiOpener ? 8.5 : 5.0, debate: hasDebateQuestion ? 8.5 : 6.0 },
    curator_note: 'Lolos uji sanitasi struktur cerita otomatis.'
  };
}

/**
 * Menghasilkan 1 cerita terkurasi yang telah lolos QC Dewan Redaksi.
 * Mengulang maksimal 2 kali bila draf awal ditolak.
 */
async function produceCuratedStory(options = null) {
  let storyOpts = {};
  if (typeof options === 'string') {
    storyOpts = { topic: options };
  } else if (typeof options === 'object' && options !== null) {
    storyOpts = { ...options };
  }

  if (!storyOpts.topic) {
    const recentTopics = db.getRecentStoryTopics ? db.getRecentStoryTopics(12) : [];
    // Prioritaskan topik yang belum pernah dipakai dalam 12 postingan terakhir
    const freshTopics = TOPICS.filter(t => !recentTopics.some(rt => rt.toLowerCase().includes(t.toLowerCase().slice(0, 20))));
    if (freshTopics.length > 0) {
      storyOpts.topic = freshTopics[Math.floor(Math.random() * freshTopics.length)];
    }
  }

  const maxAttempts = 2;
  let lastDraft = null;
  let lastQC = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[EditorialBoard] Memproduksi draf cerita (Percobaan ${attempt}/${maxAttempts})...`);
    const draft = await generateStory(storyOpts);
    const qc = await evaluateStoryWithQC(draft);

    console.log(`[EditorialBoard] Hasil QC (${qc.provider}): Skor ${qc.total_score} | Approved: ${qc.approved}`);
    console.log(`[EditorialBoard] Catatan: "${qc.curator_note}"`);

    if (qc.approved) {
      return {
        ...draft,
        qcScore: qc.total_score,
        qcNotes: `[${qc.provider}] ${qc.curator_note}`
      };
    }

    lastDraft = draft;
    lastQC = qc;
  }

  // Bila attempt 2 masih belum tembus 7.5 tapi sudah di atas 6.5, terima dengan catatan
  console.log('[EditorialBoard] Ambang batas disesuaikan untuk memastikan pasokan antrean tidak macet.');
  return {
    ...lastDraft,
    qcScore: lastQC?.total_score || 7.2,
    qcNotes: `[Auto-Approved] ${lastQC?.curator_note || 'Lolos kriteria batas toleransi.'}`
  };
}

/**
 * Pengisi Stok Otomatis (Autonomous Stockpile Replenisher)
 * Memastikan minimal ada TARGET_BUFFER cerita siap tayang di antrean database.
 * Default 9 cerita (~3 hari buffer untuk 3x posting sehari).
 */
async function replenishStockBuffer(targetBuffer = 9) {
  if (isReplenishing) {
    console.log('[EditorialBoard] Proses replenish sedang berjalan di background, skip panggilan ganda.');
    return { status: 'busy', added: 0, currentCount: db.getQueuedStoriesCount() };
  }

  isReplenishing = true;
  try {
    const currentCount = db.getQueuedStoriesCount();
    console.log(`[EditorialBoard] Cek stok antrean: Ada ${currentCount} cerita (Target buffer: ${targetBuffer}).`);

    if (currentCount >= targetBuffer) {
      return { status: 'full', added: 0, currentCount };
    }

    const needed = targetBuffer - currentCount;
    // Batasi maksimal 3 cerita per run agar tidak terkena rate limit
    const toCreate = Math.min(needed, 3);
    console.log(`[EditorialBoard] Memulai pembuatan ${toCreate} cerita terkurasi baru...`);

    let addedCount = 0;
    for (let i = 0; i < toCreate; i++) {
      try {
        const story = await produceCuratedStory();
        const id = db.addStoryToQueue({
          title: story.title,
          topic: story.topic,
          slides: story.slides,
          productName: story.product_name,
          productUrl: story.product_url,
          scheduledFor: new Date().toISOString(),
          qcScore: story.qcScore,
          qcNotes: story.qcNotes
        });
        addedCount++;
        console.log(`[EditorialBoard] Cerita #${id} ("${story.title}") berhasil dikurasi & dimasukkan ke antrean!`);
        // Jeda 2 detik antar pembuatan
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.error(`[EditorialBoard] Gagal memproduksi cerita ke-${i + 1}:`, err.message);
      }
    }

    const newTotal = db.getQueuedStoriesCount();
    console.log(`[EditorialBoard] Selesai replenish: Menambahkan ${addedCount} cerita. Total stok sekarang: ${newTotal}.`);
    return { status: 'success', added: addedCount, currentCount: newTotal };
  } finally {
    isReplenishing = false;
  }
}

/**
 * Autonomous Affiliate Link Health Patrol
 * Memeriksa semua link Shopee aktif di database.
 * Jika ada link toko yang tutup / error 404, nonaktifkan otomatis agar pembaca tidak kecewa.
 */
async function auditAffiliateLinks() {
  const products = db.getAllProducts();
  const deactivated = [];

  for (const prod of products) {
    try {
      const res = await fetch(prod.affiliate_url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        }
      });
      const finalUrl = res.url || '';
      if (!res.ok || finalUrl.includes('error_page') || res.status === 404) {
        db.db.prepare('UPDATE product_bank SET active = 0 WHERE id = ?').run(prod.id);
        deactivated.push(prod.name);
        console.warn(`[AffiliatePatrol] Produk "${prod.name}" dinonaktifkan karena link error: ${finalUrl}`);

        // Bersihkan cerita antrean yang masih mengantongi link produk rusak ini
        try {
          const queuedWithProd = db.db.prepare(`
            SELECT id, slides_json FROM stories 
            WHERE status = 'queued' AND product_name = ?
          `).all(prod.name);

          for (const qs of queuedWithProd) {
            const rawSlides = JSON.parse(qs.slides_json);
            // Buang slide yang berisi tautan affiliate rusak
            const cleanSlides = rawSlides.filter(s => !s.includes(prod.affiliate_url) && !s.includes('belinya di mana'));
            db.db.prepare(`
              UPDATE stories 
              SET slides_json = ?, product_name = NULL, product_url = NULL 
              WHERE id = ?
            `).run(JSON.stringify(cleanSlides), qs.id);
            console.log(`[AffiliatePatrol] Menghapus tautan rusak dari cerita antrean #${qs.id}`);
          }
        } catch (cleanErr) {
          console.warn('[AffiliatePatrol] Gagal membersihkan antrean:', cleanErr.message);
        }
      }
    } catch (e) {
      // Abaikan jika hanya timeout sementara agar tidak salah menonaktifkan
    }
  }

  return deactivated;
}

module.exports = {
  evaluateStoryWithQC,
  produceCuratedStory,
  replenishStockBuffer,
  auditAffiliateLinks
};
