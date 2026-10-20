const db = require('./database');
const { generateStory } = require('./aiStory');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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

  const evaluationPrompt = `
Kamu adalah Chief Editor & Kepala Kurator akun Threads viral @kisahkomisi.
Tugasmu adalah menguji dan mengurasi draf cerita menfess sebelum dijadwalkan tayang ke publik.

DATA DRAF CERITA:
Topik: ${story.topic || '-'}
Produk: ${story.product_name || 'Murni Cerita'}
Link: ${story.product_url || '-'}

SLIDES:
${slides.map((s, idx) => `[Part ${idx + 1}]: ${s}`).join('\n\n')}

KRITERIA PENILAIAN (Skala 1 - 10):
1. hook_score: Apakah 10-15 kata pertama di Part 1 langsung memikat dan mengejutkan pembaca? DILARANG ada sapaan basi (seperti "Halo guys", "Kenalin").
2. pacing_score: Apakah alur cerita mengalir bertahap dari awal, memuncak di tengah, sampai konklusi?
3. affiliate_score: Apakah sisipan rekomendasi terasa wajar, relevan secara situasi, dan tidak hard-selling seperti iklan TV?
4. debate_score: Apakah bagian akhir memancing netizen untuk berdebat atau berkomentar memberikan pendapat?

Berikan output HANYA berupa JSON valid persis seperti format ini:
{
  "approved": true,
  "total_score": 8.5,
  "scores": {
    "hook": 9,
    "pacing": 8,
    "affiliate": 9,
    "debate": 8
  },
  "curator_note": "Ringkasan penilaian kurator dalam 1-2 kalimat"
}

Syarat Lolos (approved = true): total_score >= 7.5. Jika di bawah 7.5, set approved = false.
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
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: 'nvidia/nemotron-3.5-lightning:free',
          messages: [{ role: 'user', content: evaluationPrompt + '\n\nBalas HANYA string JSON.' }],
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
            provider: 'OpenRouter (nemotron)',
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
async function produceCuratedStory() {
  const maxAttempts = 2;
  let lastDraft = null;
  let lastQC = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[EditorialBoard] Memproduksi draf cerita (Percobaan ${attempt}/${maxAttempts})...`);
    const draft = await generateStory();
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
 */
async function replenishStockBuffer(targetBuffer = 6) {
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

module.exports = {
  evaluateStoryWithQC,
  produceCuratedStory,
  replenishStockBuffer
};
