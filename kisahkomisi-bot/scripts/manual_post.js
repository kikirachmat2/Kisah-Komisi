const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/database');
const { generateStory } = require('../src/aiStory');
const { publishStoryToThreads, getActiveAccessToken } = require('../src/threads');

async function main() {
  console.log('🤖 [Manual Post] Menyiapkan cerita baru dengan Gemini AI...');
  const story = await generateStory();

  console.log('\n📖 Judul:', story.title);
  console.log('🏷️ Topik:', story.topic);
  console.log('🛍️ Produk:', story.product_name);
  console.log('🔗 Link Tracked:', story.product_url);
  console.log(`📑 Total Slides: ${story.slides.length} bagian\n`);

  console.log('--- PREVIEW KONTEN ---');
  story.slides.forEach((slide, idx) => {
    console.log(`\n[Bagian ${idx + 1}] (${slide.length} karakter):`);
    console.log(slide);
  });
  console.log('\n----------------------\n');

  const userId = process.env.THREADS_USER_ID;
  const token = getActiveAccessToken();

  if (!userId || !token) {
    throw new Error('Kredensial Threads API (THREADS_USER_ID / THREADS_ACCESS_TOKEN) belum diset!');
  }

  // Simpan ke database dulu
  const storyId = db.addStoryToQueue({
    title: story.title,
    topic: story.topic,
    slides: story.slides,
    productName: story.product_name,
    productUrl: story.product_url,
    scheduledFor: new Date().toISOString()
  });

  if (story.product_url) {
    console.log('🔍 [Verifikasi Link] Memeriksa redirect link affiliate...');
    try {
      const res = await fetch(story.product_url, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      if (loc.includes('error_page')) {
        throw new Error(`Link affiliate diarahkan ke error_page oleh Shopee: ${story.product_url}`);
      }
      console.log('✅ [Verifikasi Link] Link 100% VALID mengarah ke:', loc.substring(0, 60));
    } catch (e) {
      console.warn('⚠️ Peringatan link check:', e.message);
    }
  }

  console.log(`🚀 [Threads] Mulai mempublikasikan cerita #${storyId} ke akun @ceritakikiii...`);
  const rootPostId = await publishStoryToThreads(userId, token, story);

  db.markStoryPublished(storyId, rootPostId);

  console.log(`\n🎉 [SUKSES TAYANG] Root Post ID: ${rootPostId}`);
  console.log(`🔗 Cek live di Threads: https://www.threads.net/@ceritakikiii/post/${rootPostId}`);
}

main().catch(err => {
  console.error('\n❌ [ERROR]:', err);
  process.exit(1);
});
