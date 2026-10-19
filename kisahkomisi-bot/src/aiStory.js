const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TOPICS = [
  'Cerita Anak Kontrakan / Kosan (Drama Sekamar, Kejadian Aneh Jam 2 Malem, Cinta Lokasi)',
  'Cerita Kantor & Dunia Kerja (Drama Magang, Bos Narsis, Teman Muka Dua)',
  'Cerita Romansa & Percintaan (Clbk Gagal, Kencan Pertama Zonk, Selingkuh Ketahuan)',
  'Cerita Menfess Keluarga & Mertua (Drama Hajatan, Warisan Kocak, Perbedaan Sudut Pandang)',
  'Cerita Horror Komedi / Kejadian Absurd Tak Terduga di Perantauan'
];

/**
 * Generate serial thread cerita viral gaya Threads Indonesia (murni cerita seru)
 * Iklan produk diselipkan sebagai sponsor break yang jujur & santai di tengah thread.
 */
async function generateStory(forcedTopic = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY belum diset di .env');
  }

  const topic = forcedTopic || TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const product = db.getRandomProduct();

  const prompt = `
Kamu adalah pencerita menfess viral nomor 1 di Threads Indonesia (seperti akun @nobondandrise).
Buatkan SATU CERITA PANJANG yang sangat seru, kocak, dramatis, atau bikin penasaran pembaca sampai akhir.

ATURAN PALING PENTING:
1. CERITA HARUS 100% MURNI CERITA! JANGAN HUBUNGKAN ISI CERITA DENGAN PRODUK APAPUN! Karakter di cerita dilarang dipaksa beli atau pakai produk.
2. Gaya bahasa: Santai, lu-gw, ceplas-ceplos anak muda Indonesia, POV orang pertama ("aku" atau "gw"), penuh detail lucu/bikin gregetan, emosional.
3. Cerita dibagi menjadi 7 Bagian/Post bersambung (Post 1 sampai Post 7).
   - Post 1: Hook pembuka yang kuat (misal: "Waktu itu jaman kuliah di kontrakan...", "Cerita ini ga pernah gw ceritain...", "Sumpah ini pengalaman paling absurd...")
   - Post 2, 3, 4: Perkembangan cerita, ketegangan, kejadian lucu/kacau yang makin seru.
   - Post 5: Bagian cerita yang lagi gantung/seru-serunya.
   - Post 6: Kelanjutan cerita menuju klimaks dan penyelesaian.
   - Post 7: Ending cerita yang memuaskan + pertanyaan interaksi santai ke audiens.

Format output WAJIB HANYA berupa JSON murni tanpa markdown:
{
  "title": "Judul Cerita Hook Menarik",
  "topic": "${topic}",
  "story_parts": [
    "Teks Post 1...",
    "Teks Post 2...",
    "Teks Post 3...",
    "Teks Post 4...",
    "Teks Post 5...",
    "Teks Post 6...",
    "Teks Post 7..."
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
        temperature: 0.9
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

  // Format iklan selingan lewat (sponsor break) yang santai di tengah-tengah thread
  const adIntermezzo = `☕ [IKLAN LEWAT BENTAR YA GES]\n\nSelingan bentar mumpung inget, kemarin banyak banget yang nanya racun barang estetik & fungsional ini:\n👉 *${product ? product.name : 'Barang Viral'}*\nLagi ada promo diskon di toko resminya: ${product ? product.affiliate_url : 'https://s.shopee.co.id/'}\n\nOke lanjut ceritanya ke bawah ya 👇👇`;

  // Sisipkan iklan di antara bagian 4 dan 5 (atau jadikan part tersendiri)
  const fullThreadParts = [
    parsed.story_parts[0],
    parsed.story_parts[1],
    parsed.story_parts[2],
    parsed.story_parts[3],
    adIntermezzo, // IKLAN LEWAT MURNI
    parsed.story_parts[4],
    parsed.story_parts[5],
    parsed.story_parts[6]
  ];

  return {
    title: parsed.title,
    topic: parsed.topic,
    product_name: product ? product.name : 'Produk Rekomendasi',
    product_url: product ? product.affiliate_url : 'https://s.shopee.co.id/',
    slides: fullThreadParts
  };
}

module.exports = {
  generateStory,
  TOPICS
};
