const assert = require('assert');
const db = require('../src/database');
const { generateContextualAd, getAutoTopicTag } = require('../src/aiStory');
const { consultZuraForBump } = require('../src/zuraGatekeeper');
const { normalizeNicheTag } = require('../src/growthEngine');

async function runZuraUpgradeTests() {
  console.log('🧪 === RUNNING ZURA 5 STRATEGIC UPGRADES VERIFICATION === 🧪\n');

  // Test 1: Expanded Topic Pillars & Niches
  console.log('[Test 1] Verifying Expanded Topic Pillars & Niches...');
  const allNiches = db.getAllNiches();
  const tags = allNiches.map(n => n.niche_tag);
  assert(tags.includes('remote_tech'), 'Niche remote_tech must be present');
  assert(tags.includes('corporate_dilemma'), 'Niche corporate_dilemma must be present');
  assert(tags.includes('workplace_setup'), 'Niche workplace_setup must be present');

  assert.strictEqual(getAutoTopicTag('Drama WFH Remote Tech'), 'remote_tech');
  assert.strictEqual(getAutoTopicTag('Setup Meja Kerja Monitor'), 'workplace_setup');
  assert.strictEqual(getAutoTopicTag('Politik Kantor HRD Promosi'), 'corporate_dilemma');
  console.log('  ✓ 3 New Topic Pillars verified in DB and Auto-Tagging\n');

  // Test 2: Seeded High-Ticket Tech/Ergonomic Products
  console.log('[Test 2] Verifying Seeded High-Ticket Tech Products in Product Bank...');
  const techProds = db.db.prepare(`
    SELECT * FROM product_bank 
    WHERE category IN ('Elektronik & Kerja', 'Kerja & Kantor', 'Gadget & Aksesoris')
  `).all();
  assert(techProds.length >= 3, 'Must have at least 3 tech/ergonomic products');
  const prodNames = techProds.map(p => p.name.toLowerCase());
  assert(prodNames.some(n => n.includes('monitor') || n.includes('screen bar') || n.includes('mouse') || n.includes('wrist')), 'Must contain desk productivity gear');
  console.log(`  ✓ Found ${techProds.length} productivity & tech products in bank\n`);

  // Test 3: Zero Jarring Ad Bridges & Contextual Problem-Solver
  console.log('[Test 3] Verifying Zero Hard-Selling in Product Ad Copy...');
  const sampleProduct = {
    name: 'Baseus i-Wok Monitor Light Bar Layar Komputer',
    category: 'Elektronik & Kerja'
  };
  const adCopy = generateContextualAd(sampleProduct, 'https://s.shopee.co.id/test');
  console.log('  Sample Problem-Solver Ad Copy:\n  "', adCopy, '"');
  assert(!adCopy.includes('selingan dikit'), 'Must NOT contain "selingan dikit"');
  assert(!adCopy.includes('selingan bentar'), 'Must NOT contain "selingan bentar"');
  assert(!adCopy.includes('btw kemarin gue checkout'), 'Must NOT contain "btw kemarin gue checkout"');
  assert(adCopy.includes('https://s.shopee.co.id/test'), 'Must contain affiliate URL');
  console.log('  ✓ Zero hard-selling verified; 100% contextual problem-solver copy\n');

  // Test 4: Thread Bumper Organik
  console.log('[Test 4] Testing Spontaneous Thread Bumper...');
  const bumpResult = await consultZuraForBump({
    postTitle: 'Realitas Gaji 8,5jt di Tangerang',
    topic: 'Pengeluaran hidup anak agency di tangerang',
    rootPart: 'gaji 8,5 juta di tangerang ternyata cuma numpang lewat',
    lastPart: 'mending kerja kantor fancy tapi gaji mepet apa remote di kamar tapi gak ada libur?'
  });
  console.log('  Zura Bump Generated:\n  "', bumpResult, '"');
  assert(typeof bumpResult === 'string' && bumpResult.length >= 20, 'Bump text must be valid string');
  assert(!bumpResult.includes('http'), 'Bump must not have ads');
  console.log('  ✓ Thread Bumper generates organic human follow-up without ads\n');

  console.log('🎉 === ALL ZURA UPGRADE TESTS PASSED CLEANLY! === 🎉');
}

runZuraUpgradeTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

