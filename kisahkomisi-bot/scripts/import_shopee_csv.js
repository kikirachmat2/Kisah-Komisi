const fs = require('fs');
const path = require('path');
const db = require('../src/database');
const { parseCSVLine, cleanProductName, detectCategory } = require('./shopeeParser');

const DEFAULT_CSV_PATH = '/Users/kiki/Downloads/LinkProdukSekaligus20261021010315-919e3b1beec8470eb0e5be3112da45c1.csv';

function normalizeUrlKey(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return (u.origin + u.pathname).toLowerCase();
  } catch (e) {
    return urlStr.split('?')[0].toLowerCase();
  }
}

async function importShopeeCSV(csvFilePath = DEFAULT_CSV_PATH) {
  console.log(`📦 [Shopee Importer] Membaca file: ${csvFilePath}`);

  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`File CSV tidak ditemukan: ${csvFilePath}`);
  }

  const rawContent = fs.readFileSync(csvFilePath, 'utf8');
  // Hapus UTF-8 BOM jika ada
  const cleanContent = rawContent.replace(/^\uFEFF/, '');
  const lines = cleanContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length <= 1) {
    throw new Error('File CSV kosong atau hanya berisi header');
  }

  const header = parseCSVLine(lines[0]);
  console.log('📋 Header CSV:', header);

  // Ambil produk yang sudah ada di database untuk deteksi duplikasi
  const existingProducts = db.db.prepare('SELECT id, name, affiliate_url FROM product_bank').all();
  const existingUrlMap = new Map();
  existingProducts.forEach(p => {
    existingUrlMap.set(normalizeUrlKey(p.affiliate_url), p.id);
  });

  const insertStmt = db.db.prepare(`
    INSERT INTO product_bank (category, name, description, affiliate_url, active, times_used)
    VALUES (?, ?, ?, ?, 1, 0)
  `);

  const updateStmt = db.db.prepare(`
    UPDATE product_bank
    SET category = ?, name = ?, description = ?, active = 1
    WHERE id = ?
  `);

  let insertedCount = 0;
  let updatedCount = 0;
  const categoryStats = {};

  const rows = lines.slice(1);
  console.log(`🚀 Mulai memproses ${rows.length} baris produk...\n`);

  const importedList = [];

  for (let i = 0; i < rows.length; i++) {
    const row = parseCSVLine(rows[i]);
    if (row.length < 8) continue;

    const rawName = row[1];
    const harga = row[2] || '-';
    const toko = row[4] || '-';
    const komisi = row[6] || '-';
    // Gunakan Link Komisi Ekstra (kolom ke-9/indeks 8), jika kosong fallback ke Link Produk (kolom ke-8/indeks 7)
    let affiliateUrl = (row[8] && row[8].startsWith('http')) ? row[8].trim() : (row[7] || '').trim();

    if (!rawName || !affiliateUrl) {
      continue;
    }

    const cleanName = cleanProductName(rawName);
    const category = detectCategory(cleanName, rawName);
    const description = `Harga: ${harga} | Komisi: ${komisi} | Toko: ${toko}`;

    const urlKey = normalizeUrlKey(affiliateUrl);

    if (existingUrlMap.has(urlKey)) {
      const prodId = existingUrlMap.get(urlKey);
      updateStmt.run(category, cleanName, description, prodId);
      updatedCount++;
    } else {
      insertStmt.run(category, cleanName, description, affiliateUrl);
      existingUrlMap.set(urlKey, true);
      insertedCount++;
    }

    categoryStats[category] = (categoryStats[category] || 0) + 1;
    importedList.push({
      category,
      name: cleanName,
      affiliateUrl,
      description
    });
  }

  console.log('========================================================');
  console.log('🎉 [HASIL IMPORT SHOPEE AFFILIATE]');
  console.log(`✅ Produk Baru Ditambahkan : ${insertedCount}`);
  console.log(`🔄 Produk Diperbarui      : ${updatedCount}`);
  console.log(`📊 Total Produk Aktif      : ${existingProducts.length + insertedCount}`);
  console.log('--------------------------------------------------------');
  console.log('Kategori Distribusi Produk:');
  for (const [cat, count] of Object.entries(categoryStats)) {
    console.log(` - ${cat}: ${count} produk`);
  }
  console.log('========================================================\n');

  return {
    insertedCount,
    updatedCount,
    totalActive: existingProducts.length + insertedCount,
    categoryStats,
    importedList
  };
}

if (require.main === module) {
  const filePath = process.argv[2] || DEFAULT_CSV_PATH;
  importShopeeCSV(filePath)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Gagal import:', err);
      process.exit(1);
    });
}

module.exports = { importShopeeCSV };
