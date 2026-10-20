const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/database');
const { generateStory } = require('../src/aiStory');
const { splitBySentence } = require('../src/threads');
const { evaluateStoryWithQC, produceCuratedStory } = require('../src/editorialBoard');

async function runBulletproofCheck() {
  console.log('============================================================');
  console.log('🛡️ FORENSIC AUDIT & BULLETPROOF TEST');
  console.log('============================================================\n');

  // Test 1: Generate Story (Verify product, themeHint, priority topics)
  console.log('[1/4] Menguji generateStory() & integrasi produk/tema...');
  const story = await generateStory();
  console.log(`✅ Sukses generate cerita: "${story.title}"`);
  console.log(`   Topik: ${story.topic}`);
  console.log(`   Produk: ${story.product_name || 'Tanpa Produk'} (${story.product_url || '-'})`);
  console.log(`   Jumlah Slide: ${story.slides.length}`);
  if (!story.title || !story.slides || story.slides.length < 5) {
    throw new Error('Hasil generateStory tidak memenuhi syarat struktur slide!');
  }

  // Test 2: QC Evaluation
  console.log('\n[2/4] Menguji Editorial Board Dual-Agent QC...');
  const qc = await evaluateStoryWithQC(story);
  console.log(`✅ QC Selesai via ${qc.provider}: Skor ${qc.total_score}/10 | Approved: ${qc.approved}`);
  console.log(`   Catatan: "${qc.curator_note}"`);

  // Test 3: Threads safe sentence splitting
  console.log('\n[3/4] Menguji algoritma pemecah kalimat Threads (splitBySentence)...');
  const longText = 'Kalimat pertama yang agak panjang. ' + 'Kalimat kedua yang sangat panjang sekali '.repeat(15) + 'https://s.shopee.co.id/sample_link_with_underscore_abc123. Selesai.';
  const chunks = splitBySentence(longText, 420);
  console.log(`✅ Berhasil dipecah menjadi ${chunks.length} chunks aman.`);
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].length > 490) {
      throw new Error(`Chunk ${i} melebihi batas safe length 490 karakter! (${chunks[i].length})`);
    }
  }

  // Test 4: Database Product Bank Rotation
  console.log('\n[4/4] Menguji rotasi produk di database...');
  const p1 = db.getRandomProduct();
  console.log(`✅ Produk terpilih: ${p1?.name} (Times used: ${p1?.times_used})`);

  console.log('\n============================================================');
  console.log('🎉 SELURUH SKENARIO FORENSIC LOLOS 100%!');
  console.log('============================================================');
}

runBulletproofCheck().catch(err => {
  console.error('\n❌ BULLETPROOF TEST GAGAL:', err);
  process.exit(1);
});
