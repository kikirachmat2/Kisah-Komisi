require('dotenv').config();
const { trackAllInsights, analyzePerformanceAndStrategize, generateInsightReportMarkdown } = require('../src/growthEngine');

async function test() {
  console.log('='.repeat(60));
  console.log('🧪 TESTING AUTONOMOUS GROWTH & STRATEGY ENGINE');
  console.log('='.repeat(60));

  try {
    console.log('\n[1/3] Mengambil data insight Meta Threads...');
    const trackRes = await trackAllInsights();
    console.log('Hasil Tracking:', trackRes);

    console.log('\n[2/3] Menjalankan Analisis Strategis Otomatis (AI Chief Strategist)...');
    const strat = await analyzePerformanceAndStrategize();
    console.log('Hasil Strategi:', JSON.stringify(strat, null, 2));

    console.log('\n[3/3] Memformat Laporan Markdown Executive:');
    const report = await generateInsightReportMarkdown();
    console.log('\n' + report);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 GROWTH ENGINE BERHASIL TERUJI & SIAP DIGUNAKAN!');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('❌ Gagal menguji Growth Engine:', err);
  }
}

test();
