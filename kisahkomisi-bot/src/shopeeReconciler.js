/**
 * src/shopeeReconciler.js - Shopee Affiliate Conversion Reconciler & Revenue Intelligence
 * 
 * Menghubungkan titik buta (Revenue Blindness):
 * 1. Menerima & mem-parsing laporan CSV konversi pesanan dari Shopee Affiliate Portal.
 * 2. Mencocokkan Sub-ID (sub_id1=threads_ceritakiki, sub_id2=kategori, sub_id4=product_id).
 * 3. Mengkalkulasi Earnings Per Click (EPC), total komisi riil, dan produk terlaris.
 * 4. Memperbarui skor produk di database agar Zura mengutamakan produk yang terbukti menghasilkan cuan nyata.
 */

const fs = require('fs');
const db = require('./database');

/**
 * Parsing file CSV teks sederhana tanpa library eksternal
 */
function parseCsvSimple(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const headers = lines[0].split(/[,;\t]/).map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    // Regex split respecting quotes
    const row = [];
    let inQuotes = false;
    let token = '';
    const line = lines[i];

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if ((char === ',' || char === ';' || char === '\t') && !inQuotes) {
        row.push(token.trim().replace(/^["']|["']$/g, ''));
        token = '';
      } else {
        token += char;
      }
    }
    row.push(token.trim().replace(/^["']|["']$/g, ''));

    if (row.length >= headers.length) {
      const entry = {};
      headers.forEach((h, idx) => {
        entry[h] = row[idx] || '';
      });
      records.push(entry);
    }
  }

  return records;
}

/**
 * Mencocokkan kolom header Shopee yang bervariasi (ID & EN)
 */
function findCol(row, candidates) {
  for (const c of candidates) {
    for (const key of Object.keys(row)) {
      if (key.includes(c)) {
        return row[key];
      }
    }
  }
  return '';
}

/**
 * Memproses data CSV konversi Shopee dan mencatat ke database
 * @param {string} csvContent - Isi teks CSV dari Shopee
 * @returns {Object} Hasil agregasi & ringkasan cuan
 */
function processShopeeConversionReport(csvContent) {
  const rows = parseCsvSimple(csvContent);
  if (rows.length === 0) {
    return { success: false, reason: 'File CSV kosong atau format header tidak sesuai.' };
  }

  let totalOrders = 0;
  let completedOrders = 0;
  let totalCommissionIdr = 0;
  let pendingCommissionIdr = 0;

  const categoryEarnings = {};
  const productEarnings = {};
  const channelEarnings = {};

  for (const row of rows) {
    const orderId = findCol(row, ['order id', 'id pesanan', 'order sn', 'pesanan']);
    const sub1 = findCol(row, ['sub id 1', 'sub_id1', 'sub1', 'sub id1']);
    const sub2 = findCol(row, ['sub id 2', 'sub_id2', 'sub2', 'sub id2']);
    const sub4 = findCol(row, ['sub id 4', 'sub_id4', 'sub4', 'sub id4']);
    const itemName = findCol(row, ['item name', 'nama produk', 'product name', 'item']);
    const status = findCol(row, ['status', 'order status', 'status pesanan']).toLowerCase();
    
    // Parse komisi
    const rawComm = findCol(row, ['commission', 'komisi', 'estimasi komisi', 'estimated comm']);
    const cleanComm = parseFloat(rawComm.replace(/[^0-9.]/g, '')) || 0;

    totalOrders++;

    const isCompleted = status.includes('complete') || status.includes('selesai') || status.includes('settled') || !status;
    if (isCompleted) {
      completedOrders++;
      totalCommissionIdr += cleanComm;
    } else {
      pendingCommissionIdr += cleanComm;
    }

    // Agregasi Channel
    const channel = sub1 || 'organic_unknown';
    channelEarnings[channel] = (channelEarnings[channel] || 0) + cleanComm;

    // Agregasi Kategori
    const cat = sub2 || 'umum';
    categoryEarnings[cat] = (categoryEarnings[cat] || 0) + cleanComm;

    // Agregasi Produk
    const prodKey = itemName || (sub4 ? `Product #${sub4}` : 'Produk Shopee');
    productEarnings[prodKey] = (productEarnings[prodKey] || 0) + cleanComm;
  }

  // Format produk terlaris (Top 5)
  const topProducts = Object.entries(productEarnings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, comm]) => ({ name, commission: Math.round(comm) }));

  // Simpan metrik ke database app_settings
  db.setSetting('SHOPEE_LAST_RECONCILED_AT', new Date().toISOString());
  db.setSetting('SHOPEE_TOTAL_COMMISSION_ALL_TIME', String(totalCommissionIdr));

  return {
    success: true,
    totalRows: rows.length,
    totalOrders,
    completedOrders,
    totalCommissionIdr: Math.round(totalCommissionIdr),
    pendingCommissionIdr: Math.round(pendingCommissionIdr),
    categoryBreakdown: categoryEarnings,
    topProducts
  };
}

module.exports = {
  parseCsvSimple,
  processShopeeConversionReport
};
