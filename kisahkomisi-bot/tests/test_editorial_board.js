require('dotenv').config();
const { produceCuratedStory } = require('../src/editorialBoard');

async function test() {
  console.log('='.repeat(60));
  console.log('🧪 TESTING DUAL-AGENT EDITORIAL BOARD (Creator + QC)');
  console.log('='.repeat(60));

  const start = Date.now();
  try {
    const story = await produceCuratedStory();
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log('\n✅ HASIL PRODUKSI & KURASI:');
    console.log(`Judul      : ${story.title}`);
    console.log(`Topik      : ${story.topic}`);
    console.log(`Produk     : ${story.product_name || '-'}`);
    console.log(`QC Score   : ${story.qcScore}/10`);
    console.log(`QC Notes   : ${story.qcNotes}`);
    console.log(`Waktu      : ${duration} detik`);
    console.log(`Total Slide: ${story.slides.length} parts`);

    console.log('\n[Part 1 / Hook]:');
    console.log(story.slides[0]);

    console.log('\n[Intermezzo / Iklan]:');
    const intermezzo = story.slides.find(s => s.includes('http') || s.includes('shope.ee'));
    console.log(intermezzo || '(Murni Cerita)');

    console.log('\n[Part 6 / Ending & Debat]:');
    console.log(story.slides[story.slides.length - 1]);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 EDITORIAL BOARD BERJALAN SEMPURNA!');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('❌ Gagal menguji Editorial Board:', err);
  }
}

test();
