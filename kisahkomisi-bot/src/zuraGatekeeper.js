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

  // Jika Zura merekomendasikan revisi atau menolak karena cacat logika, gunakan revised_slides Zura!
  if ((verdict.recommended_action === 'USE_REVISED' || !verdict.is_approved) && Array.isArray(verdict.revised_slides) && verdict.revised_slides.length >= 2) {
    console.log(`[ZuraGatekeeper] ✨ Menggunakan versi naskah yang sudah dirombak total oleh Zura agar 100% logis dan manusiawi.`);
    return {
      isApproved: true,
      slides: verdict.revised_slides,
      notes: verdict.critique || 'Dirombak oleh Zura',
      logicFlaws: verdict.logic_flaws || []
    };
  }

  return {
    isApproved: verdict.is_approved !== false,
    slides: (verdict.revised_slides && verdict.revised_slides.length >= 2) ? verdict.revised_slides : storyData.slides,
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
 * Konsultasi & Pembuatan Thread Bumper Susulan ke Zura
 * @param {Object} bumpData - { postTitle, topic, rootPart, lastPart }
 * @returns {Promise<string|null>} teks bumper spontan yang disetujui Zura
 */
async function consultZuraForBump(bumpData) {
  console.log(`[ZuraGatekeeper] 🧵 Meminta Zura menyusun update susulan organik untuk thread: "${bumpData.postTitle}"...`);
  const payload = {
    post_title: bumpData.postTitle || '',
    topic: bumpData.topic || '',
    root_part: bumpData.rootPart || '',
    last_part: bumpData.lastPart || ''
  };

  const verdict = await invokeZuraCLI('--bump', payload);
  if (!verdict || !verdict.bump_text) {
    return null;
  }

  console.log(`[ZuraGatekeeper] 🎯 Zura menyetujui update susulan: "${verdict.bump_text}"`);
  return verdict.bump_text;
}

module.exports = {
  consultZuraForStory,
  consultZuraForReply,
  consultZuraForBump,
  resolveZuraEnv
};

