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
 * Tanpa emotikon berlebihan, mengalir murni selayaknya ketikan curhat orang biasa.
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

ATURAN GAYA PENULISAN SANGAT PENTING:
1. JANGAN PAKAI BANYAK EMOTIKON! Tulis selayaknya orang curhat biasa di Twitter / Threads.
2. JANGAN TULIS ANGKA PENOMORAN SEPERTI "[1/8]", "(1/5)", ATAU SEJENISNYA! Tulis langsung teks ceritanya mengalir.
3. CERITA HARUS 100% MURNI CERITA! JANGAN HUBUNGKAN ISI CERITA DENGAN PRODUK APAPUN! Karakter di cerita dilarang dipaksa beli atau pakai produk.
4. Gaya bahasa: Santai, lu-gw / aku-kamu, ceplas-ceplos anak muda Indonesia, POV orang pertama ("aku" atau "gw"), penuh detail kejadian nyata, emosional.
5. Cerita dibagi menjadi 6 Bagian bersambung:
   - Part 1: Hook pembuka santai tapi memikat (misal: "Waktu itu jaman kuliah terdamparlah aku di kontrakan temen...", "Ini cerita yang ga pernah gw ceritain ke siapa-siapa...")
   - Part 2, 3: Kronologi awal dan kejadian aneh / lucu / tegang.
   - Part 4: Bagian cerita yang lagi seru-serunya / puncak masalah.
   - Part 5: Reaksi, kejutan, dan kelanjutan cerita.
   - Part 6: Ending cerita tuntas + pertanyaan penutup santai tanpa lebay ("Kalian pernah ngalamin hal aneh kayak gini ga?").

Format output WAJIB HANYA berupa JSON murni tanpa markdown:
{
  "title": "Judul Cerita Pendek (hanya teks biasa)",
  "topic": "${topic}",
  "story_parts": [
    "Teks Part 1...",
    "Teks Part 2...",
    "Teks Part 3...",
    "Teks Part 4...",
    "Teks Part 5...",
    "Teks Part 6..."
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

  // Format iklan selingan murni tanpa emot norak
  const adIntermezzo = `Btw selingan bentar ya, kemarin banyak yang nanya rekomendasi ${product ? product.name : 'barang ini'} belinya di mana, aku belinya di toko ini mumpung lagi diskon:\n${product ? product.affiliate_url : 'https://s.shopee.co.id/'}\n\nLanjut ceritanya ke bawah...`;

  // Sisipkan iklan murni di tengah-tengah thread
  const fullThreadParts = [
    parsed.story_parts[0],
    parsed.story_parts[1],
    parsed.story_parts[2],
    adIntermezzo, // Iklan lewat santai
    parsed.story_parts[3],
    parsed.story_parts[4],
    parsed.story_parts[5]
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
