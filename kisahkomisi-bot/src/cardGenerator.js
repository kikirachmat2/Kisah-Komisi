/**
 * src/cardGenerator.js - Pure SVG Visual Card Generator for Financial Breakdown Carousels
 * 
 * Menghasilkan kartu visual 1080x1080 (rasio 1:1 standar Meta Threads):
 * 1. Menampilkan header Kiki Rachmat (@kikipunyacerita).
 * 2. Visualisasi tabel pengeluaran & tabungan dengan progress bar persentase.
 * 3. Dilema penutup yang memicu engagement di kolom komentar.
 * 4. Tanpa dependensi biner berat (100% Native Node.js SVG).
 */

const fs = require('fs');
const path = require('path');

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Menghasilkan string SVG modern 1080x1080
 */
function generateFinancialCardSvg(data) {
  const title = escapeXml(data.title || 'Breakdown Realita Gaji Jakarta');
  const salaryText = escapeXml(data.salaryText || 'Gaji Rp 6.000.000 / Bulan');
  const city = escapeXml(data.city || 'Jakarta Pusat');
  const items = Array.isArray(data.items) ? data.items : [
    { label: 'Kosan & Listrik', amount: 'Rp 1.800.000', pct: 30 },
    { label: 'Makan & Minum', amount: 'Rp 2.000.000', pct: 33 },
    { label: 'Transport KRL/Ojol', amount: 'Rp 500.000', pct: 8 },
    { label: 'Kirim Orang Tua', amount: 'Rp 1.000.000', pct: 17 },
    { label: 'Sisa Tabungan / Darurat', amount: 'Rp 700.000', pct: 12 }
  ];
  const dilemaNote = escapeXml(data.dilemaNote || 'Menurut kalian, sisa segini masih wajar buat masa depan atau bertahan hidup aja?');

  let rowsSvg = '';
  let yOffset = 380;

  items.slice(0, 5).forEach((item, idx) => {
    const label = escapeXml(item.label);
    const amount = escapeXml(item.amount);
    const pct = Math.min(100, Math.max(0, Number(item.pct) || 20));
    const barWidth = Math.round((pct / 100) * 880);

    rowsSvg += `
      <!-- Item ${idx + 1} -->
      <g transform="translate(100, ${yOffset})">
        <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="600" fill="#F3F4F6">${label}</text>
        <text x="880" y="0" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="700" fill="#10B981">${amount}</text>
        
        <!-- Progress Bar Background -->
        <rect x="0" y="14" width="880" height="12" rx="6" fill="#374151" />
        <!-- Progress Fill -->
        <rect x="0" y="14" width="${barWidth}" height="12" rx="6" fill="#3B82F6" />
      </g>
    `;
    yOffset += 85;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1080" viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background Gradient -->
  <rect width="1080" height="1080" rx="40" fill="#111827"/>
  <rect x="20" y="20" width="1040" height="1040" rx="30" stroke="#1F2937" stroke-width="4"/>

  <!-- Subtle Ambient Glow -->
  <circle cx="950" cy="150" r="280" fill="#1E3A8A" opacity="0.25" filter="blur(90px)"/>
  <circle cx="120" cy="950" r="240" fill="#065F46" opacity="0.2" filter="blur(90px)"/>

  <!-- Header Badge -->
  <g transform="translate(100, 100)">
    <rect width="260" height="52" rx="26" fill="#1F2937"/>
    <circle cx="28" cy="26" r="12" fill="#10B981"/>
    <text x="52" y="34" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#9CA3AF">@kikipunyacerita</text>
  </g>

  <!-- Location Pill -->
  <g transform="translate(760, 100)">
    <rect width="220" height="52" rx="26" fill="#1E293B"/>
    <text x="110" y="33" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="600" fill="#60A5FA">📍 ${city}</text>
  </g>

  <!-- Title & Salary -->
  <text x="100" y="240" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" fill="#FFFFFF">${title}</text>
  <text x="100" y="295" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="30" font-weight="700" fill="#F59E0B">💰 ${salaryText}</text>

  <!-- Divider Line -->
  <line x1="100" y1="330" x2="980" y2="330" stroke="#374151" stroke-width="2"/>

  <!-- Rows -->
  ${rowsSvg}

  <!-- Footer Dilemma Card -->
  <g transform="translate(100, 840)">
    <rect width="880" height="140" rx="20" fill="#1E293B" stroke="#334155" stroke-width="2"/>
    <text x="40" y="50" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#F87171">💭 DILEMA REALITA:</text>
    <text x="40" y="90" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="500" fill="#E2E8F0">${dilemaNote}</text>
  </g>
</svg>`;
}

/**
 * Menyimpan kartu SVG ke disk
 */
function saveFinancialCard(data, outputPath = null) {
  const svgContent = generateFinancialCardSvg(data);
  const out = outputPath || path.join(__dirname, '../data/preview_card.svg');
  fs.writeFileSync(out, svgContent, 'utf-8');
  return { path: out, svgContent };
}

module.exports = {
  generateFinancialCardSvg,
  saveFinancialCard
};

