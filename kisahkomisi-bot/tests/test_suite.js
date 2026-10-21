const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { appendSubId, getThematicVibe, generateStory } = require('../src/aiStory');
const { splitBySentence, getActiveAccessToken } = require('../src/threads');
const db = require('../src/database');

async function runTests() {
  console.log('🧪 === RUNNING COMPREHENSIVE TEST SUITE === 🧪\n');

  // TEST 1: appendSubId
  console.log('[Test 1] Testing appendSubId...');
  const url1 = 'https://s.shopee.co.id/2AwoQ0tZfG';
  const tracked1 = appendSubId(url1, 'threads_ceritakiki');
  assert(tracked1.includes('sub_id1=threads_ceritakiki'), 'URL 1 should contain sub_id1');
  console.log('  ✓ URL tanpa query:', tracked1);

  const url2 = 'https://shopee.co.id/product/123?utm_source=ig';
  const tracked2 = appendSubId(url2, 'threads_ceritakiki');
  assert(tracked2.includes('utm_source=ig') && tracked2.includes('sub_id1=threads_ceritakiki'), 'URL 2 should preserve existing query and add sub_id1');
  assert(!tracked2.includes('??'), 'URL 2 should not have double question marks');
  console.log('  ✓ URL dengan query:', tracked2);

  const url3 = 'https://s.shopee.co.id/2AwoQ0tZfG';
  const tracked3 = appendSubId(url3, {
    sub_id1: 'threads_ceritakiki',
    sub_id2: 'kosan',
    sub_id3: 'pagi',
    sub_id4: 'p42'
  });
  assert(tracked3.includes('sub_id1=threads_ceritakiki'), 'URL 3 sub_id1');
  assert(tracked3.includes('sub_id2=kosan'), 'URL 3 sub_id2');
  assert(tracked3.includes('sub_id3=pagi'), 'URL 3 sub_id3');
  assert(tracked3.includes('sub_id4=p42'), 'URL 3 sub_id4');
  console.log('  ✓ URL multi-tier granular tracking:', tracked3);

  // TEST 2: getThematicVibe
  console.log('\n[Test 2] Testing getThematicVibe...');
  const vibeGadget = getThematicVibe('Elektronik & Gadget');
  assert(vibeGadget.includes('lembur') || vibeGadget.includes('commuter') || vibeGadget.includes('musik'), 'Gadget vibe matched');
  const vibeKosan = getThematicVibe('Rumah Tangga & Kosan');
  assert(vibeKosan.includes('kosan') || vibeKosan.includes('kontrakan'), 'Kosan vibe matched');
  console.log('  ✓ Vibe Gadget:', vibeGadget);
  console.log('  ✓ Vibe Kosan:', vibeKosan);

  // TEST 3: splitBySentence
  console.log('\n[Test 3] Testing splitBySentence...');
  const testTextWithUrl = 'Halo guys ini cerita seru banget kemarin pas jalan-jalan. Btw ini link rekomendasinya https://s.shopee.co.id/2AwoQ0tZfG ya jangan lupa diorder. Lanjut ke cerita utama lagi.';
  const chunks = splitBySentence(testTextWithUrl, 420);
  assert(chunks.length === 1, 'Short text with URL should not be split');
  assert(chunks[0].includes('https://s.shopee.co.id/2AwoQ0tZfG'), 'URL must remain intact');
  console.log('  ✓ Sentence splitter preserves URLs intact (chunks:', chunks.length, ')');

  // Text longer than 420 chars
  const longText = 'Kalimat pertama yang agak panjang untuk menguji sistem pemecah kalimat cerdas. '.repeat(8);
  const longChunks = splitBySentence(longText, 420);
  assert(longChunks.length > 1, 'Long text should be split into multiple chunks');
  longChunks.forEach((c, idx) => {
    assert(c.length <= 420, `Chunk ${idx} length (${c.length}) must be <= 420`);
  });
  console.log(`  ✓ Long text (${longText.length} chars) cleanly split into ${longChunks.length} chunks, all <= 420 chars`);

  // TEST 4: Database Settings & Product Bank
  console.log('\n[Test 4] Testing Database helpers...');
  db.setSetting('TEST_KEY', 'TEST_VALUE_123');
  const retrievedVal = db.getSetting('TEST_KEY');
  assert.strictEqual(retrievedVal, 'TEST_VALUE_123', 'Setting value should match');
  console.log('  ✓ Database app_settings get/set works.');

  const dbPath = db.getDbPath();
  assert(typeof dbPath === 'string' && dbPath.length > 0, 'getDbPath should return valid path');
  console.log('  ✓ Database path:', dbPath);

  const prod = db.getRandomProduct();
  console.log('  ✓ Random product retrieved from DB:', prod ? prod.name : 'No product');

  const token = getActiveAccessToken();
  console.log('  ✓ Active access token present:', !!token);

  // TEST 5: Real Gemini AI Story Generation
  console.log('\n[Test 5] Testing generateStory with Gemini AI (live)...');
  const story = await generateStory();
  console.log('  ✓ Generated Title:', story.title);
  console.log('  ✓ Topic:', story.topic);
  console.log('  ✓ Product Attached:', story.product_name || 'None');
  console.log('  ✓ Total Slides:', story.slides.length);
  
  assert(story.slides.length >= 6, 'Story should have at least 6 slides (including intermezzo)');
  console.log('\n--- SLIDE PREVIEWS ---');
  story.slides.forEach((slide, i) => {
    console.log(`[Slide ${i + 1}] (${slide.length} chars):\n${slide.substring(0, 120)}...\n`);
  });

  // TEST 6: Auto-Reply Engine Guardrails & DB helpers
  console.log('\n[Test 6] Testing Auto-Reply Engine & Guardrails...');
  const { isCommentSafe } = require('../src/autoReplyEngine');
  assert(isCommentSafe('Sumpah relate banget cerita ini, nyesek abis!') === true, 'Safe comment allowed');
  assert(isCommentSafe('Ini bot ya? Dasar robot jelek') === false, 'Bot accusation rejected');
  assert(isCommentSafe('Mau judi slot gacor hari ini') === false, 'Spam comment rejected');
  assert(isCommentSafe('Dasar tolol goblok') === false, 'Toxic comment rejected');

  db.logAutoReply({
    threadsMediaId: 'mock_test_media',
    commentId: 'mock_test_comment_' + Date.now(),
    authorUsername: 'test_user',
    commentText: 'Relate banget',
    replyText: 'Wkwk bener banget kan!',
    replyMediaId: 'mock_reply_id'
  });
  const dailyCount = db.getDailyAutoReplyCount();
  assert(dailyCount > 0, 'Daily auto reply count should be incremented');
  console.log('  ✓ Auto-Reply Guardrails & DB Tracking: 100% Verified');

  // TEST 7: Hot Takes Engine & News Radar
  console.log('\n[Test 7] Testing Hot Takes Engine & Social Radar...');
  const { fetchTrendingHeadline, generateHotTakePost } = require('../src/hotTakesEngine');
  const headlineInfo = await fetchTrendingHeadline();
  assert(headlineInfo && headlineInfo.headline, 'Trending headline must be present');
  console.log(`  ✓ Headline Source: ${headlineInfo.source} | "${headlineInfo.headline.substring(0, 50)}..."`);

  const hotTake = await generateHotTakePost(headlineInfo, 'PAGI');
  assert(hotTake && hotTake.length > 20, 'Hot take text should be valid length');
  assert(!hotTake.includes('shopee.co.id'), 'Hot take must not contain affiliate links');
  console.log(`  ✓ Generated Hot Take (${hotTake.length} chars): "${hotTake.substring(0, 60)}..."`);

  db.logHotTake({
    topicSource: headlineInfo.source,
    headline: headlineInfo.headline,
    postText: hotTake,
    threadsMediaId: 'mock_media_id_hottake',
    slotLabel: 'TEST_SLOT'
  });
  const recentHotTakes = db.getRecentHotTakes(1);
  assert(recentHotTakes.length > 0, 'Hot take successfully recorded in database');
  console.log('  ✓ Hot Takes Database Persistence: Verified');

  console.log('\n🎉 === ALL TESTS PASSED SUCCESSFULLY! === 🎉');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
