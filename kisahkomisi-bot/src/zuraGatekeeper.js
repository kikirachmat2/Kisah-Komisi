/**
 * src/zuraGatekeeper.js - Zura Autonomous Gatekeeper & Advisory Client
 * 
 * Jembatan wajib antara Kisah Komisi Engine dengan Zura (Personal AI Orchestrator).
 * Memastikan:
 * 1. Setiap postingan baru wajib dievaluasi Zura (logika realistis, anti-plot-hole, 100% manusiawi).
 * 2. Jika ada cacat logika (seperti Surabaya KRL atau sewa kontrakan + KPR), Zura merombak otomatis.
 * 3. Setiap balasan komentar netizen wajib dikirim bersama konteks lengkap postingan agar 100% nyambung.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let supabaseFleet = null;
try {
  supabaseFleet = require('./supabaseFleet');
  supabaseFleet.startHeartbeat(60000);
} catch (e) {
  // Graceful fallback if pg or supabaseFleet is missing
}


// Kandidat path Python virtualenv Zura
const CANDIDATE_PYTHONS = [
  '/home/ubuntu/zura-core/venv/bin/python3',
  path.join(process.env.HOME || '', 'Documents/Web Develop/Personal AI/venv/bin/python3'),
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  'python3'
];

// Kandidat script zura_advisory.py
const CANDIDATE_SCRIPTS = [
  '/home/ubuntu/zura-core/scripts/zura_advisory.py',
  path.join(process.env.HOME || '', 'Documents/Web Develop/Personal AI/scripts/zura_advisory.py')
];

function resolveZuraEnv() {
  let pythonBin = 'python3';
  for (const p of CANDIDATE_PYTHONS) {
    if (fs.existsSync(p)) {
      pythonBin = p;
      break;
    }
  }

  let scriptPath = null;
  for (const s of CANDIDATE_SCRIPTS) {
    if (fs.existsSync(s)) {
      scriptPath = s;
      break;
    }
  }

  return { pythonBin, scriptPath };
}

/**
 * Menjalankan zura_advisory.py secara asinkron
 */
function invokeZuraCLI(mode, payload) {
  return new Promise((resolve) => {
    const { pythonBin, scriptPath } = resolveZuraEnv();
    if (!scriptPath) {
      console.warn('[ZuraGatekeeper] Script zura_advisory.py tidak ditemukan, lewati advisory.');
      return resolve(null);
    }

    const payloadStr = JSON.stringify(payload);
    execFile(pythonBin, [scriptPath, mode, payloadStr], {
      timeout: 35000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[ZuraGatekeeper] Gagal menjalankan advisory (${mode}):`, error.message);
        return resolve(null);
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (e) {
        console.warn(`[ZuraGatekeeper] Gagal parse output JSON Zura: ${stdout.substring(0, 100)}...`);
        resolve(null);
      }
    });
  });
}

/**
 * Konsultasi & Review Cerita/Thread ke Zura sebelum di-queue atau di-publish
 * @param {Object} storyData - { topic, formatType, productName, productUrl, slides, city }
 * @returns {Promise<Object>} verdict Zura
 */
async function consultZuraForStory(storyData) {
  console.log(`[ZuraGatekeeper] 🧐 Menyerahkan draf cerita ke Zura untuk QC Eksekutif...`);

  // 1. Stage ke Supabase (Fleet Cloud Hub)
  let stagingId = null;
  if (supabaseFleet) {
    try {
      stagingId = await supabaseFleet.stageThreadsPost(storyData);
      if (stagingId) {
        console.log(`[ZuraGatekeeper] ☁️ Draf berhasil distage di Supabase (ID: ${stagingId}).`);
      }
    } catch (e) {
      console.warn(`[ZuraGatekeeper] Gagal stage draf ke Supabase: ${e.message}`);
    }
  }

  const payload = {
    topic: storyData.topic || '',
    format_type: storyData.formatType || 'story',
    product_name: storyData.productName || '',
    product_url: storyData.productUrl || '',
    slides: storyData.slides || [],
    city: storyData.city || ''
  };

  const verdict = await invokeZuraCLI('--story', payload);
  if (!verdict) {
    console.warn('[ZuraGatekeeper] Zura tidak merespons, fallback ke draf original.');
    if (supabaseFleet && stagingId) {
      supabaseFleet.updateStagingVerdict(stagingId, true, 'Zura offline fallback', storyData.slides).catch(() => {});
    }
    return {
      isApproved: true,
      slides: storyData.slides,
      notes: 'Zura advisory offline, fallback original.'
    };
  }

  console.log(`[ZuraGatekeeper] 📢 Keputusan Zura: [Action: ${verdict.recommended_action}] - Critique: "${verdict.critique ? verdict.critique.substring(0, 80) : ''}..."`);

  if (verdict.logic_flaws && verdict.logic_flaws.length > 0) {
    console.log(`[ZuraGatekeeper] ⚠️ Plot holes ditemukan Zura:`, verdict.logic_flaws);
  }

  const hasRevisedSlides = Array.isArray(verdict.revised_slides) && verdict.revised_slides.length >= 1;

  // Jika Zura merekomendasikan revisi atau menolak karena cacat logika, gunakan revised_slides Zura jika ada!
  if (verdict.recommended_action === 'USE_REVISED' && hasRevisedSlides) {
    console.log(`[ZuraGatekeeper] ✨ Menggunakan versi naskah yang sudah dirombak total oleh Zura (${verdict.revised_slides.length} slide).`);
    if (supabaseFleet && stagingId) {
      supabaseFleet.updateStagingVerdict(stagingId, true, verdict.critique || 'Dirombak oleh Zura', verdict.revised_slides).catch(() => {});
    }
    return {
      isApproved: true,
      slides: verdict.revised_slides,
      notes: verdict.critique || 'Dirombak oleh Zura',
      logicFlaws: verdict.logic_flaws || []
    };
  }

  // Jika Zura menolak keras dan tidak ada naskah revisi yang valid, VETO TOTAL!
  if (verdict.is_approved === false || verdict.recommended_action === 'REJECT') {
    if (hasRevisedSlides) {
      console.log(`[ZuraGatekeeper] ✨ Draf awal ditolak, tapi Zura menyediakan naskah revisi valid. Menggunakan revisi Zura.`);
      if (supabaseFleet && stagingId) {
        supabaseFleet.updateStagingVerdict(stagingId, true, verdict.critique || 'Diganti revisi Zura', verdict.revised_slides).catch(() => {});
      }
      return {
        isApproved: true,
        slides: verdict.revised_slides,
        notes: verdict.critique || 'Draf awal ditolak, diganti revisi Zura',
        logicFlaws: verdict.logic_flaws || []
      };
    }
    console.warn(`[ZuraGatekeeper] ⛔ Zura MEM-VETO draf cerita (tanpa revisi otomatis). Draf ditolak demi menjaga reputasi akun!`);
    if (supabaseFleet && stagingId) {
      supabaseFleet.updateStagingVerdict(stagingId, false, verdict.critique || 'Ditolak total oleh Zura', storyData.slides).catch(() => {});
    }
    return {
      isApproved: false,
      slides: storyData.slides,
      notes: verdict.critique || 'Ditolak total oleh Zura (Cacat Logika/Hitung)',
      logicFlaws: verdict.logic_flaws || []
    };
  }

  if (supabaseFleet && stagingId) {
    supabaseFleet.updateStagingVerdict(stagingId, true, verdict.critique || 'Disetujui Zura', hasRevisedSlides ? verdict.revised_slides : storyData.slides).catch(() => {});
  }

  return {
    isApproved: true,
    slides: hasRevisedSlides ? verdict.revised_slides : storyData.slides,
    notes: verdict.critique || 'Disetujui Zura',
    logicFlaws: verdict.logic_flaws || []
  };
}

/**
 * Konsultasi & Review Balasan Komentar Netizen ke Zura
 * @param {Object} replyData - { postTitle, postContent, commenter, commentText, draftReply }
 * @returns {Promise<string>} balasan yang 100% nyambung dan disetujui Zura
 */
async function consultZuraForReply(replyData) {
  console.log(`[ZuraGatekeeper] 💬 Meminta Zura mengevaluasi balasan komentar @${replyData.commenter}: "${replyData.commentText.substring(0, 40)}..."`);
  
  const payload = {
    post_title: replyData.postTitle || '',
    post_content: replyData.postContent || '',
    commenter: replyData.commenter || 'warganet',
    comment_text: replyData.commentText || '',
    draft_reply: replyData.draftReply || ''
  };

  const verdict = await invokeZuraCLI('--reply', payload);
  if (!verdict || !verdict.approved_reply || verdict.is_relevant === false) {
    console.warn(`[ZuraGatekeeper] ⚠️ Zura menolak balasan komentar (tidak relevan / AI offline). Membatalkan balasan demi integritas konten.`);
    return null;
  }

  console.log(`[ZuraGatekeeper] 🎯 Zura menyetujui balasan kontekstual: "${verdict.approved_reply}"`);
  return verdict.approved_reply;
}

/**
 * Konsultasi & Pembuatan Thread Bumper Susulan ke Zura (Mendukung Surge Affiliate)
 * @param {Object} bumpData - { postTitle, topic, rootPart, lastPart, views, productName, productUrl }
 * @returns {Promise<string|null>} teks bumper spontan yang disetujui Zura
 */
async function consultZuraForBump(bumpData) {
  console.log(`[ZuraGatekeeper] 🧵 Meminta Zura menyusun update susulan (${bumpData.views || 0} views) untuk: "${bumpData.postTitle}"...`);
  const payload = {
    post_title: bumpData.postTitle || '',
    topic: bumpData.topic || '',
    root_part: bumpData.rootPart || '',
    last_part: bumpData.lastPart || '',
    views: Number(bumpData.views || 0),
    product_name: bumpData.productName || '',
    product_url: bumpData.productUrl || ''
  };

  const verdict = await invokeZuraCLI('--bump', payload);
  if (!verdict || !verdict.bump_text) {
    return null;
  }

  console.log(`[ZuraGatekeeper] 🎯 Zura menyetujui update susulan: "${verdict.bump_text}"`);
  return verdict.bump_text;
}

/**
 * Mengirimkan laporan performa riil postingan ke Zura (Closed Feedback Loop)
 * @param {Object} outcomeData - { storyId, title, views, likes, replies, formatType }
 */
async function reportStoryOutcome(outcomeData) {
  try {
    const payload = {
      story_id: outcomeData.storyId,
      title: outcomeData.title,
      views: Number(outcomeData.views || 0),
      likes: Number(outcomeData.likes || 0),
      replies: Number(outcomeData.replies || 0),
      format_type: outcomeData.formatType || 'story'
    };

    // Sync to Supabase
    if (supabaseFleet) {
      supabaseFleet.updatePostMetrics(
        payload.story_id,
        payload.views,
        payload.likes,
        payload.replies
      ).catch(() => {});
    }

    await invokeZuraCLI('--feedback', payload);
  } catch (e) {
    // Non-blocking telemetry
  }
}

module.exports = {
  consultZuraForStory,
  consultZuraForReply,
  consultZuraForBump,
  reportStoryOutcome,
  resolveZuraEnv
};

