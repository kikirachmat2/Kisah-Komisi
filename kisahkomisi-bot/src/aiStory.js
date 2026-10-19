const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TOPICS = [
  'Kisah Menfess Kosan (Teman Sekamar Toxic / Misteri / Hemat Ekstrem)',
  'Kisah Menfess Percintaan & Hubungan (Greenflag vs Redflag / Kejutan Lucu)',
  'Kisah Menfess Dunia Kerja & Kantor (Lembur / Bos Aneh / Rekan Kerja Kocak)',
  'Kisah Menfess Perjuangan Hidup & Self Healing (Dari Titik Terendah Menuju Sukses)',
  'Kisah Menfess Keluarga & Mertua (Drama Relatable / Cerita Mengharukan)'
];

/**
 * Generate 1 cerita menfess 12 slide menggunakan Gemini AI
 */
async function generateStory(forcedTopic = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY belum diset di .env');
  }

  const topic = forcedTopic || TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const product = db.getRandomProduct(topic);

  const prompt = `
Kamu adalah content creator viral Threads dan penulis cerita menfess Indonesia nomor 1.
Buatkan 1 cerita menfess viral yang sangat emosional, relatable, dan bikin penasaran (gaya bahasa Threads/Twitter Indonesia santai: "gw", "lu", "anjir", "sumpah", "sender").

Ketentuan Format Ketat:
1. Cerita terdiri dari tepat 12 Slide untuk format Carousel Threads.
2. Panjang teks per slide adalah 2-4 kalimat padat yang mudah dibaca dalam 5 detik.
3. Struktur Slide:
   - Slide 1: Hook Pembuka yang bikin berhenti scroll (misal: "Sumpah gw baru sadar temen sekamar gw nyimpen ini di lemarinya...", "Nyesel banget baru tau sekarang...", "Cerita ini ga pernah gw ceritain ke siapa-siapa...")
   - Slide 2 s/d 5: Kronologi masalah, ketegangan, atau konflik cerita yang makin memuncak.
   - Slide 6: Momen solusi/kebiasaan baru di mana karakter mulai menggunakan atau membutuhkan barang ini: "${product ? product.name : 'Aroma Diffuser'}". Sebutkan fungsinya secara natural dalam cerita tanpa terlihat seperti iklan!
   - Slide 7: Rekomendasi/spill produk secara halus (Soft Selling). Katakan betapa barang ini menyelamatkan situasi karakter. Beri info: "(Link produknya gw taruh di komentar pertama ya guys!)".
   - Slide 8 s/d 11: Lanjutan plot cerita, klimaks, dan ending yang memuaskan atau ada plot twist tak terduga.
   - Slide 12: Pertanyaan penutup ke audiens (Call-to-Action) untuk memicu ratusan komentar (contoh: "Kalian ada yang pernah punya pengalaman sama kayak gw ga? Cerita di bawah dong...").

Format output WAJIB HANYA berupa JSON murni tanpa markdown triple backtick, dengan struktur:
{
  "title": "Judul Cerita Pendek Menarik",
  "topic": "${topic}",
  "product_name": "${product ? product.name : 'Produk Rekomendasi'}",
  "slides": [
    "Teks Slide 1...",
    "Teks Slide 2...",
    "Teks Slide 3...",
    "Teks Slide 4...",
    "Teks Slide 5...",
    "Teks Slide 6...",
    "Teks Slide 7...",
    "Teks Slide 8...",
    "Teks Slide 9...",
    "Teks Slide 10...",
    "Teks Slide 11...",
    "Teks Slide 12..."
  ]
}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.85
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Respon Gemini kosong.');
  }

  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanJson);

  return {
    ...parsed,
    product_url: product ? product.affiliate_url : 'https://s.shopee.co.id/'
  };
}

module.exports = {
  generateStory,
  TOPICS
};
