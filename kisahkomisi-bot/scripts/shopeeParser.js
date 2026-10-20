const fs = require('fs');

// Rule-based smart categorization & name cleanup
function cleanProductName(rawName) {
  if (!rawName) return '';
  let name = rawName
    .replace(/^\[[^\]]+\]\s*/g, '') // Hapus [JENNIE'S PICK], [BELIA], [BOXA], dll di awal
    .replace(/^\([^)]+\)\s*/g, '') // Hapus (Buy 1 Get 1), (BELI 1 GRATIS 1)
    .replace(/^PROMO\s*-\s*/gi, '')
    .replace(/^HOT\s*-\s*/gi, '')
    .replace(/【[^】]+】/g, '')
    .replace(/\s*-\s*All Size.*$/gi, '')
    .replace(/\s*-\s*All Variant.*$/gi, '')
    .replace(/\s*-\s*Terlaris.*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Bersihkan pemotongan agar nyaman dibaca di thread (maksimal 50-55 karakter)
  if (name.length > 55) {
    const cut = name.substring(0, 52);
    const lastSpace = cut.lastIndexOf(' ');
    name = (lastSpace > 28 ? cut.substring(0, lastSpace) : cut) + '...';
  }
  return name;
}

function detectCategory(name, desc = '') {
  const text = (name + ' ' + desc).toLowerCase();

  // 1. Gaya Hidup, Botol & Tumbler
  if (
    text.includes('tumbler') || text.includes('botol') || text.includes('bottle') || text.includes('thermos') ||
    text.includes('corkcicle') || text.includes('coffee dripper') || text.includes('v60') ||
    text.includes('saringan kopi')
  ) {
    return 'Gaya Hidup & Botol';
  }

  // 2. Skincare, Grooming & Parfum
  if (
    text.includes('parfum') || text.includes('perfume') || text.includes('fragrance') ||
    text.includes('facial wash') || text.includes('face wash') || text.includes('serum') ||
    text.includes('cleanser') || text.includes('lotion') || text.includes('deodorant') ||
    text.includes('shampoo') || text.includes('shampo') || text.includes('kemiri') ||
    text.includes('lip cream') || text.includes('lip balm') || text.includes('lipstick') ||
    text.includes('hair tonic') || text.includes('foundation') || text.includes('bedak') ||
    text.includes('moisturiz') || text.includes('sunscreen') || text.includes('skincare') ||
    text.includes('eyelash') || text.includes('freshcare') || text.includes('hair treatment') ||
    text.includes('pure paw paw') || text.includes('vaseline') || text.includes('wardah') ||
    text.includes('make over') || text.includes('senka') || text.includes('cosrx')
  ) {
    if (text.includes('parfum') || text.includes('perfume') || text.includes('fragrance')) return 'Parfum & Wewangian';
    if (text.includes('men') || text.includes('kahf')) return 'Skincare Pria';
    return 'Skincare & Perawatan';
  }

  // 3. Olahraga & Outdoor
  if (
    text.includes('barbel') || text.includes('dumbbell') || text.includes('gym') ||
    text.includes('running') || text.includes('sport') || text.includes('futsal') ||
    text.includes('badminton') || text.includes('camping') || text.includes('outdoor')
  ) {
    return 'Olahraga & Kebugaran';
  }

  // 4. Elektronik & Gadget
  if (
    text.includes('charger') || text.includes('kabel') || text.includes('headset') ||
    text.includes('earphone') || text.includes('tws') || text.includes('speaker') ||
    text.includes('bor ') || text.includes('bor impact') || text.includes('kipas') ||
    text.includes('tempered glass') || text.includes('powerbank') || text.includes('laptop') ||
    text.includes('ssd') || text.includes('hdd') || text.includes('pouch case for ssd') ||
    text.includes('essager') || text.includes('tipe c') || text.includes('type c') ||
    text.includes('type-c') || text.includes('lightning') || text.includes('basike')
  ) {
    return 'Elektronik & Gadget';
  }

  // 5. Makanan & Minuman
  if (
    text.includes('kering kentang') || text.includes('teh ') || text.includes('usus krispi') ||
    text.includes('abon') || text.includes('snack') || text.includes('kacang') ||
    text.includes('kering tempe') || text.includes('minyak goreng') || text.includes('sari lemon') ||
    text.includes('keripik') || text.includes('basreng')
  ) {
    return 'Camilan & Makanan';
  }

  // 6. Rumah Tangga & Kosan
  if (
    text.includes('meja') || text.includes('kursi') || text.includes('keset') ||
    text.includes('tisu') || text.includes('tissue') || text.includes('talenan') ||
    text.includes('hanger') || text.includes('wadah makanan') || text.includes('kontainer') ||
    text.includes('spons') || text.includes('pembersih botol') || text.includes('dupa') ||
    text.includes('media tanam') || text.includes('cocopeat') || text.includes('pupuk') ||
    text.includes('tanah subur') || text.includes('popok') || text.includes('mamypoko')
  ) {
    return 'Rumah Tangga & Kosan';
  }

  // 7. Fashion & Pakaian
  if (
    text.includes('celana') || text.includes('baju') || text.includes('tas ') ||
    text.includes('pouch') || text.includes('hand bag') || text.includes('sandal') ||
    text.includes('kaos kaki') || text.includes('ikat pinggang') || text.includes('belt') ||
    text.includes('sajadah') || text.includes('sarung') || text.includes('sarung jok') ||
    text.includes('sarung mobil')
  ) {
    return 'Fashion & Outfit';
  }

  // 8. Mainan, Hobi & Buku
  if (
    text.includes('mainan') || text.includes('action model') || text.includes('transformers') ||
    text.includes('squishy') || text.includes('remote control') || text.includes('buku') ||
    text.includes('pulpen') || text.includes('biji') || text.includes('benih') ||
    text.includes('kucing') || text.includes('scabies') || text.includes('pop mart') ||
    text.includes('hacipupu')
  ) {
    return 'Hobi & Hiburan';
  }

  // 9. Kesehatan
  if (text.includes('masker')) {
    return 'Kesehatan';
  }

  return 'Rekomendasi Populer';
}

// Simple standard CSV row parser handling quotes and commas
function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

module.exports = {
  cleanProductName,
  detectCategory,
  parseCSVLine
};
