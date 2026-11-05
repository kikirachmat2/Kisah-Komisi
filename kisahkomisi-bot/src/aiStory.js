const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Kategori Topik Nyata Berbobot (Berdasarkan Pola Viral Threads Indonesia)
const TOPICS_CORPORATE = [
  'Eksploitasi Anak Magang (Magang 3 bulan diperpanjang lagi 3 bulan, ngadep manajer minta kepastian officer vs resign)',
  'Lembur 48 Jam Seminggu Tanpa Bayaran (Manajer bilang jam kerja Senin-Sabtu sudah termasuk gaji, dibantah PP 35/2021)',
  'Trik Licik HRD Nahan Kenaikan Gaji (Dikasih tanggung jawab manajerial tapi status staf dan gaji tetap UMR)',
  'Bos Narsis & Playing Victim (Kesalahan manajer tapi tim bawah yang disuruh nanggung di depan direksi)',
  'Cuti Tahunan Ditolak Alasan Kekeluargaan (Hak cuti dihanguskan sepihak dengan dalih loyalitas perusahaan)',
  'Spill Gaji Karyawan Berujung Dikucilkan (Karyawan baru gaji lebih tinggi dari senior yang loyal 4 tahun)',
  'Budaya Resign Dianggap Khianat (Karyawan loyal ajukan resign baik-baik tapi surat paklaring dipersulit HRD)',
  'Meeting di Luar Jam Kerja Tanpa Uang Lembur (Bos hobi chat WhatsApp jam 10 malam minta data dadakan buat besok pagi)',
  'Promosi Kosong Tanpa Kenaikan Gaji (Dikasih titel Lead/Supervisor baru tapi pas ditanya slip gaji katanya nunggu evaluasi tahun depan)'
];

const TOPICS_INTIMATE_MENFESS = [
  'Kegalauan Ranjang Pasutri Muda (Istri selalu yang mulai inisiatif HB, suami anteng dan jadwalnya kayak mau ketemu menteri)',
  'Nafkah & Uang Dapur Timpang (Suami pelit jatah belanja istri tapi royal ke keluarga/teman tongkrongannya)',
  'Mertua Ikut Campur Privasi Kamar (Mertua suka masuk kamar tanpa ketuk dan mengomentari cara ngurus rumah)',
  'Pasangan Perhitungan Ekstrem (Bensin dihitung bagi dua sampai serupiah, hitung-hitungan makan di warteg)',
  'Hubungan Menggantung Bertahun-tahun (Pacaran 6 tahun menemani dari nol tapi pas ditanya nikah selalu ngeles nunggu mapan)',
  'Dilema Pasangan Minim Inisiatif (Semua keputusan dari makan apa sampai rencana masa depan harus pihak perempuan yang mikir)',
  'Pasangan Selalu Playing Victim (Tiap ada konflik selalu balik nyalahin pasangan sampai merasa bersalah sendiri)'
];

const TOPICS_SOCIAL_DILEMMA = [
  'Tetangga Parkir Mobil Depan Pagar (Garasi dijadikan gudang, mobil parkir nutupin akses jalan warga komplek)',
  'Teman Pinjam Uang Pura-pura Amnesia (Ditagih beralasan lagi susah tapi update story liburan dan makan enak)',
  'Drama Kamar Kosan & Teman Sekamar (Bawa pacar nginep tanpa izin, kasur dipakai saat pemilik lagi lembur)',
  'Drama Token Listrik Jebol di Kontrakan (Teman sekamar nyalain AC 24 jam tapi maunya patungan listrik rata)',
  'Teman Tongkrongan FOMO Gaya Hidup (Nongkrong di cafe mahal tiap minggu padahal cicilan paylater numpuk)',
  'Arisan Komplek Berujung Renggang (Uang arisan macet di bendahara pas ditagih malah bawa-bawa urusan keluarga)',
  'Teman Kantor Pinjam Barang Ga Balik (Minjem charger dan earphone berminggu-minggu pas diminta balik malah sinis)'
];

const TOPICS_HAL_RECEH = [
  'Drama Parkir Minimarket 2 Ribu (Cuma beli permen karet seribu tapi ditarik parkir 2 ribu tanpa karcis)',
  'Shower Kosan Mati Pas Lagi Sampoan (Mata pedih kena busa terpaksa bilas pake air minum galon)',
  'Headset Mati Sebelah Pas Commute KRL (Stasiun Manggarai lagi rusuh tapi telinga cuma denger suara sebelah)',
  'Sandal Jepit Putus Pas Nyebrang Jalan Protokol (Lagi buru-buru nyebrang Sudirman sandal putus terpaksa jalan pincang)',
  'Laptop Kantor Freeze Pas Belum Save Dokumen (Revisi seharian hilang seketika pas atasan minta dikirim sekarang)',
  'Charger Ketinggalan di Kosan Baterai 11% (Kepanikan massal anak magang pas jam kerja baru mulai)'
];

const TOPICS_KELUARGA_RELASI = [
  'Ipar Numpang Hidup di Kontrakan Pasutri Muda (Gak kerja gak bantu beres-beres tapi ngeluh makanan kurang enak)',
  'Kumpul Keluarga Ditanya Kapan Nikah & Beli Rumah (Gaji UMR dituntut standar kesuksesan paman konglomerat)',
  'Drama Kondangan 4 Kali Sebulan (Amplop jebol honor sebulan abis buat kondangan temen yang jarang nyapa)',
  'Pasutri Muda vs Ekspektasi Mertua (Mertua banding-bandingin cara ngurus anak sama zaman dulu)',
  'Pasangan Gak Ada Inisiatif Urusan Masa Depan (Ditanya arah hubungan selalu jawab jalanin aja dulu santai)'
];

const TOPICS_HOBI_RANDOM = [
  'FOMO Padel & Running GBK Demi Konten (Beli jersey 2 juta baru lari 400 meter udah minta duduk di pinggir)',
  'Tiba-tiba Pengen Melihara Tanaman Hias di Kosan (Beli monstera estetik seminggu kemudian daunnya kuning layu)',
  'Nyeduh Kopi Manual V60 Pake Timbangan Digital (Ritual 20 menit tiap pagi demi kopi estetik padahal telat absen finger print)',
  'Ngerakit Lego / Gundam di Umur 26 Tahun (Menyembuhkan inner child tapi dompet yang kena luka batin)',
  'Thrift Shop Baju Bekas Niat Irit Malah Boncos (Niat hemat borong jaket vintage taunya bau apek dan ongkos cuci dry clean lebih mahal)'
];

const TOPICS_HOT_TAKE_RINGAN = [
  'Americano Dingin Tanpa Gula Itu Pahit Doang (Stop pura-pura nikmatin rasa arang demi keliatan mature di tongkrongan)',
  'Pake Earphone Tanpa Lagu di Kantor (Alasan utama bukan denger musik tapi proteksi diri biar ga diajak ngobrol)',
  'Weekend Dua Hari Adalah Penipuan Publik (Sabtu buat tepar bayar utang tidur, Minggu udah stres mikirin Senin)',
  'Meeting yang Harusnya Bisa Selesai di 1 Email (Bentuk teror mental terselubung manajer yang kesepian di kantor)',
  'Split Bill Makan Bareng Dibulatkan ke Atas (Yang pesen wagyu bayar sama rata sama yang cuma pesen es teh manis)'
];

const TOPICS_REMOTE_TECH = [
  'Realitas WFH Kerja di Kasur tapi Punggung Remuk (Gaji dollar keliatan keren tapi jam kerja ngikutin timezone US jam 2 subuh)',
  'Godaan Buka Laptop Pas Cuti (Manajer nge-tag Slack urgen pas lagi di pantai, antara cuek atau panik kena SP)',
  'Invoice Freelance Luar Negeri Tertahan di Bank (Kerjaan beres 3 minggu lalu tapi dana nyangkut kena verifikasi kepatuhan)',
  'Perang Batin Gaji Kantor Lokal vs Kontrak Remote (Pilihan antara stabilitas BPJS atau gaji 3x lipat tanpa jaminan karir)',
  'Lembur Marathon Bikin Mata Perih dan Migrain (Menatap 3 monitor sekaligus dari jam 9 pagi sampe tengah malam)'
];

const TOPICS_CORPORATE_DILEMMA = [
  'Promosi Kosong Tanpa Kenaikan Gaji (Dikasih titel Lead baru tapi pas ditanya slip gaji katanya nunggu evaluasi tahun depan)',
  'Budaya Resign Dianggap Musuh Perusahaan (Karyawan loyal ajukan resign baik-baik tapi surat paklaring dipersulit HRD)',
  'Sikut-sikutan Politik Kantor Jelang Bonus Akhir Tahun (Rekan kerja seruangan diam-diam claim hasil kerja tim sebagai inisiatif pribadi)',
  'Revisi Menit Terakhir Sebelum Jam Pulang (Kerjaan sudah di-approve jam 2 siang mendadak dirombak total pas jam 5 sore)',
  'Dilema Speak Up Lawan Atasan Arogan (Tahu keputusan bos salah arah tapi kalau protes takut diparkir di divisi buangan)'
];

const TOPICS_WORKPLACE_SETUP = [
  'Setup Meja Kerja 15 Juta tapi Kursi Bikin Encok (Monitor curved dan mechanical keyboard mahal tapi punggung jompo)',
  'Kabel Meja Kerja Kusut Kayak Benang Ruwet (Tiap mau cabut charger laptop harus narik kabel yang nyangkut di kolong meja)',
  'Lampu Kamar Silau Bikin Mata Cepat Capek (Lembur malam hari cuma modal lampu plafon bikin mata perih dan silau ke layar)',
  'Pergelangan Tangan Sakit Akibat Mouse Biasa (Nge-drag file dan coding 10 jam sehari pergelangan tangan berasa kram dan ngilu)'
];

const TOPICS_KULTUR_DIGITAL = [
  'FOMO Upgrade iPhone Boba vs Tabungan Tipis (Gaji mepet UMR tapi maksa cicil 24 bulan demi gengsi circle nongkrong)',
  'Subscription Trap Generasi Digital (Langganan Netflix, Spotify, iCloud, ChatGPT, dan Gym sebulan 1.2 juta padahal jarang dibuka)',
  'Fenomena Flexing Paylater di Medsos (Pamer liburan dan staycation di story padahal tagihan bulan depan bikin sesak napas)',
  'Doomscrolling Medsos vs Insomnia Akut (Tiap malam niat tidur jam 10 tapi jempol scroll reels sampai jam 2 subuh sambil overthinking masa depan)',
  'Kencan Pertama Split Bill Berujung Ribut (Hitung-hitungan biaya parkir 2 ribu dan saus sambal ekstra dibagi dua sampai receh)',
  'Terjebak Tren Pamer Saldo Tabungan (Netizen pamer mutasi ratusan juta di Threads bikin minder pekerja kantoran yang gajinya pas-pasan)',
  'FOMO Konser Musik Luar Negeri (War tiket 4 juta pakai paylater demi story 15 detik, sisa bulan makan mie instan)',
  'Jebakan Belanja Online Tanggal Kembar (Checkout barang diskon yang sebenarnya gak butuh cuma demi dopamin gratis)',
  'Obsesi Self-Improvement Beracun (Beli webinar dan ebook produktivitas 500 ribu tapi kerjaan harian tetap ditunda-tunda)'
];

const TOPICS_ADULTING_TABOO = [
  'Teman Nikah Pinjam Tabungan Nikah Kita (Niat bantu teman malah pas giliran kita mau nikah uangnya pura-pura lupa)',
  'Warisan Keluarga Bikin Saudara Kandung Putus Kontak (Tanah warisan kakek dijual sepihak oleh paman tertua tanpa musyawarah)',
  'Dilema Merawat Orang Tua Sakit vs Karir di Ibu Kota (Anak pertama dituntut pulang kampung lepas karir demi jaga orang tua)',
  'Patungan Biaya Rumah Sakit Keluarga Besar (Keluarga yang mampu pura-pura miskin pas giliran bayar pengobatan nenek)',
  'Tuntutan Resepsi Nikah Mewah Demi Gengsi Orang Tua (Calon pengantin mau akad sederhana tapi ortu maksa sewa gedung mewah 150 juta)',
  'Dilema Tinggal Bareng Mertua vs Ngontrak Rumah Petak (Antara hemat biaya sewa tapi kena tekanan mental tiap hari)',
  'Teman Curhat Masalah Rumah Tangga Ujungnya Baper (Niat jadi pendengar yang baik malah dituduh jadi orang ketiga)',
  'Anak Sulung Jadi Tulang Punggung Sekaligus Penjamin Hutang (Nama KTP dipakai ortu buat pinjaman bank tanpa izin)',
  'Arisan Keluarga Jadi Ajang Pamer Kekayaan (Tiap kumpul keluarga selalu ada tante yang banding-bandingin gaji dan mobil menantu)'
];

const TOPICS_KARIER_DAN_ETIKA = [
  'Nepotisme Anak Bos Langsung Jadi Manajer (Kerja gak becus tapi bawahan senior yang harus beresin revisi dan laporan tiap hari)',
  'Fenomena Quiet Firing di Korporat (Karyawan lama ga dipecat tapi sengaja ga dikasih kerjaan dan diisolasi biar resign sendiri)',
  'Perang Dingin Divisi Sales vs Divisi Operasional (Sales janjiin fitur mustahil ke klien, tim teknis yang dipaksa begadang)',
  'Atasan Maling Kredit Proyek Bawahan (Ide presentasi kita dipresentasikan bos ke direksi seolah-olah inisiatif tunggal dia)',
  'Dilema Whistleblower Penggelapan Uang Kantor (Tau kecurangan manajer keuangan tapi takut dipecat kalau lapor ke direksi)',
  'Pemberian SP Siluman Tanpa Peringatan Lisan (Tiba-tiba disodorin surat peringatan pas minta evaluasi kenaikan gaji)',
  'Diskriminasi Gaji Karyawan Lama vs Hire Baru (Karyawan baru lulus nego gaji lebih tinggi 40% dari staf loyal 3 tahun)',
  'Budaya Toxic Jam Pulang Tenggo (Kerjaan selesai jam 5 tapi satu divisi ga ada yang berani bangun karena bos masih di ruangan)',
  'Bos Yang Hobi Mikromajemen Parah (Tiap kirim email harus di-cc bos dan revisi tata bahasa berulang kali)'
];

const TOPICS_PERANTAUAN_DAERAH = [
  'Kejutan Budaya Anak Rantau Pertama Kali di Jakarta (Kaget ritme jalan orang Jakarta serba cepat dan budaya bahasa lu-gue)',
  'Niat Healing Kerja Remote di Bali Malah Boncos (Biaya cafe dan sewa motor mahal, gaji lokal UMR Denpasar mepet)',
  'Dilema Mudik Lebaran Bawa Uang Tipis (Tekanan bawa oleh-oleh dan amplop ponakan padahal saldo rekening pas-pasan)',
  'Kontras Gaya Hidup Rantau vs Standar Kampung Halaman (Di Jakarta makan warteg 15 ribu di kampung dibilang pelit ga mau traktir)',
  'Gegar Bahasa dan Kebiasaan di Kantor Multikultural (Salah paham slang daerah pas meeting kantor yang campur aduk)',
  'Rindu Masakan Rumah vs Katering Harian Hambar (Kangen sambal buatan ibu pas lagi demam sendirian di kamar kos)',
  'Solidaritas Semu Sesama Anak Daerah di Perantauan (Diajak patungan kontrakan bareng taunya kabur ga bayar bagian)',
  'Dilema Beli Rumah di Pinggiran Kota vs Selamanya Ngontrak (Pilihan cicil rumah 2 jam dari kantor atau sewa kos seumur hidup)',
  'Romantisme Semu Kehidupan Kos-Kosan Urban (Kamar pengap tanpa jendela tapi gengsi mau pulang kampung tanpa kesuksesan)'
];

const TOPICS_CERITA_BERSERI = [
  'Obrolan Kasus Skandal Kantor Divisi Sebelah (Part 1: Kejanggalan laporan audit kas kecil berujung saling lempar tanggung jawab)',
  'Misteri Temen Kosan Kamar Ujung yang Gak Pernah Keliatan (Part 1: Paket numpuk depan pintu tapi lampu selalu nyala)',
  'Drama Warisan Tanah Keluarga di Kampung (Part 1: Paman yang gak pernah nengok mendadak pulang bawa sertifikat)',
  'Dilema Resign vs Bertahan di Kantor Toksik (Part 1: SP1 misterius turun setelah menolak disuruh lembur weekend)'
];

const TOPICS = [
  ...TOPICS_CORPORATE,
  ...TOPICS_REMOTE_TECH,
  ...TOPICS_CORPORATE_DILEMMA,
  ...TOPICS_WORKPLACE_SETUP,
  ...TOPICS_KULTUR_DIGITAL,
  ...TOPICS_ADULTING_TABOO,
  ...TOPICS_KARIER_DAN_ETIKA,
  ...TOPICS_PERANTAUAN_DAERAH,
  ...TOPICS_INTIMATE_MENFESS,
  ...TOPICS_SOCIAL_DILEMMA,
  ...TOPICS_HAL_RECEH,
  ...TOPICS_KELUARGA_RELASI,
  ...TOPICS_HOBI_RANDOM,
  ...TOPICS_HOT_TAKE_RINGAN,
  ...TOPICS_CERITA_BERSERI
];

// Menambahkan sub_id tracking ke link Shopee Affiliate secara aman dan terperinci
function appendSubId(urlStr, subIdOptions = 'threads_ceritakiki') {
  if (!urlStr) return urlStr;
  
  let params = {};
  if (typeof subIdOptions === 'string') {
    params.sub_id1 = subIdOptions;
  } else if (typeof subIdOptions === 'object' && subIdOptions !== null) {
    params = subIdOptions;
  } else {
    params.sub_id1 = 'threads_ceritakiki';
  }

  try {
    const u = new URL(urlStr);
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch (e) {
    let res = urlStr;
    for (const [k, v] of Object.entries(params)) {
      if (v) {
        const separator = res.includes('?') ? '&' : '?';
        res = `${res}${separator}${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
      }
    }
    return res;
  }
}

// Filter teks manusiawi: membersihkan label bot di awal dan penomoran pecahan duplikat di akhir (1/5)
function sanitizeText(str) {
  if (!str) return '';
  return str
    // Hapus penomoran di awal kalimat seperti [Part 1], Part 1:, Slide 1:, 1.
    .replace(/^(\[|\()?\s*(part|slide|bagian)?\s*\d+\s*(\]|\))?\s*[:\.\-]?\s*/gi, '')
    .replace(/^\*\*[^*]+\*\*\s*[:\-]?\s*/g, '')
    // Hapus penomoran pecahan di akhir atau tengah kalimat seperti 1/5, (1/5), [1/5], 2/5, 3/5
    .replace(/(\(|\s|\[)\d+\/\d+(\)|\s|\]|\.)*$/gi, '')
    .replace(/\s*\b\d+\/\d+\b\.?/gi, '')
    // Pertahankan emoji warganet yang pasrah/relatable (🫠, 🙃, 😭, 💀) tapi bersihkan emoji spam beruntun
    .replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]){3,}/gu, '$1')
    .trim();
}

/**
 * Membersihkan nama produk yang panjang / berantakan dari Shopee menjadi nama ringkas manusiawi
 */
function cleanProductName(rawName) {
  if (!rawName) return 'barang ini';
  return rawName
    .replace(/^(\[.*?\]|\(.*?\))\s*/g, '')
    .replace(/\s*-\s*(Official|Original|Garansi).*$/i, '')
    .replace(/\b(100%|Original|Termurah|Terlaris|Promo|Diskon|Gratis Ongkir|Bisa COD)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 45);
}

/**
 * Menghasilkan copy rekomendasi produk yang organik, problem-solver, dan bebas kalimat iklan kaku
 * Zero hard-selling: Dilarang keras memakai frasa canggung seperti 'selingan dikit' atau 'btw kemarin gue checkout'.
 * Produk diposisikan murni sebagai alat bertahan hidup (antidote) dari penderitaan/isu di slide sebelumnya.
 */
function generateContextualAd(product, trackedUrl) {
  if (!product || !trackedUrl) return '';
  const cat = (product.category || '').toLowerCase();
  const name = cleanProductName(product.name);
  const fullName = `${cat} ${name}`.toLowerCase();

  // 1. Kategori: Meja Kerja, Ergonomic & Tech Productivity (Screenbar, Mouse, Wristrest, Meja)
  if (cat.includes('kerja') || cat.includes('kantor') || fullName.includes('monitor') || fullName.includes('mouse') || fullName.includes('wrist') || fullName.includes('keyboard') || fullName.includes('meja') || fullName.includes('organizer')) {
    if (fullName.includes('light') || fullName.includes('lampu') || fullName.includes('bar')) {
      const templates = [
        `pas lembur marathon depan laptop malam-malam lampu kamar bikin silau ke layar, penyelamat mata gue biar ga migrain cuma screenbar ${name} ini: ${trackedUrl}`,
        `daripada mata perih dan silau ngetik sampai subuh modal lampu plafon, kebantu banget pas masang monitor light bar ini di meja: ${trackedUrl}`
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }
    if (fullName.includes('mouse') || fullName.includes('wrist') || fullName.includes('pad')) {
      const templates = [
        `tiap hari ngetik dan coding berjam-jam bikin pergelangan tangan kram, penyelamat punggung sama urat tangan gue cuma ganti pake ${name} ini: ${trackedUrl}`,
        `daripada tangan pegel ngilu tiap buka laptop seharian, bantalan/mouse ergonomis ini beneran nahan urat tangan biar gak mati rasa: ${trackedUrl}`
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }
    const templates = [
      `biar meja kerja gak bikin makin stres liat kabel kusut pas kerja, kebantu rapi pake ${name} ini di meja: ${trackedUrl}`,
      `buat nahan beban kerja marathon depan laptop seharian, setup printilan ${name} ini yang bikin meja tetep waras: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 2. Kategori: Botol Minum / Tumbler / Anti Boncos Kopi
  if (cat.includes('botol') || cat.includes('tumbler') || fullName.includes('tumbler') || fullName.includes('termos')) {
    const templates = [
      `daripada boncos beli es kopi susu 35rb tiap sore demi melek lembur, mending seduh sendiri bawa tumbler dingin ${name} ini ke meja: ${trackedUrl}`,
      `buat nahan kantuk seharian di kantor tanpa bikin dompet bocor beli minum luar, gue selalu andelin tumbler tahan dingin ini: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 3. Kategori: Elektronik & Gadget (Charger, Kabel, Kipas)
  if (cat.includes('elektronik') || cat.includes('gadget') || fullName.includes('charger') || fullName.includes('kabel') || fullName.includes('kipas')) {
    if (fullName.includes('kipas')) {
      const templates = [
        `hawa kosan gerah parah kayak di oven pas siang bolong, untung ada kipas hening ${name} ini yang nyelametin tidur tanpa jebolin token listrik: ${trackedUrl}`,
        `pas AC kamar kosan mati atau gerah lembur di meja sempit, penyelamat darurat gue cuma kipas portable adem ini: ${trackedUrl}`
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }
    const templates = [
      `daripada panik baterai sekarat pas lagi commuting atau ngerjain tugas di luar, charger/kabel bandel ${name} ini wajib standby di tas: ${trackedUrl}`,
      `buat yang sering keteteran cari colokan pas jam kerja, kepala charger/kabel ini lumayan awet buat tempur harian: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 4. Kategori: Skincare & Grooming / Perawatan Diri
  if (cat.includes('skincare') || cat.includes('grooming') || cat.includes('perawatan') || fullName.includes('wash') || fullName.includes('deodorant') || fullName.includes('serum')) {
    const templates = [
      `seharian kena debu polusi jalanan sama ac kantor bikin muka kusam, cuci muka pake ${name} ini lumayan bikin seger lagi sebelum tepar: ${trackedUrl}`,
      `buat ngerawat muka biar gak keliatan kuyu abis lembur marathon tapi tetep hemat, sabun/perawatan ini andalan harian gue: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 5. Kategori: Parfum & Wewangian
  if (cat.includes('parfum') || cat.includes('wewangian')) {
    const templates = [
      `buat parfum harian ngantor yang wanginya kalem dan gak bikin enek pas desak-desakan komuter, gue andelin aroma ${name} ini: ${trackedUrl}`,
      `daripada bau apek abis kena asap jalanan sebelum masuk ruangan meeting, semprotan ${name} ini lumayan tahan lama nemenin kerja: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 6. Kategori: Camilan & Minuman
  if (cat.includes('camilan') || cat.includes('makanan') || cat.includes('teh') || cat.includes('lemon')) {
    const templates = [
      `stok cemilan murah di meja kerja biar gak jajan kopi mahal terus tiap sore, ${name} ini lumayan nemenin lembur: ${trackedUrl}`,
      `buat ganjel perut pas dikejar deadline malam depan laptop, cemilan ${name} ini andalan murah meriah: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 7. Kategori: Rumah Tangga & Kosan
  if (cat.includes('kosan') || cat.includes('rumah')) {
    const templates = [
      `printilan kosan praktis yang bener-bener kepake biar kamar sempit gak makin sumpek, ${name} ini ngebantu banget: ${trackedUrl}`,
      `buat anak kosan yang butuh barang awet harga miring buat nata kamar, kemarin nemu ${name} ini: ${trackedUrl}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Fallback kasual problem-solver
  return `buat yang lagi ngalamin situasi serupa dan butuh solusi praktis harian, barang ${name} ini lumayan ngebantu banget: ${trackedUrl}`;
}

/**
 * Memilih latar/suasana cerita yang relevan secara kontekstual dengan produk
 */
function getThematicVibe(category) {
  if (!category) return 'kehidupan kerja, kantor, kosan, atau rumah tangga';
  const cat = category.toLowerCase();
  if (cat.includes('kerja') || cat.includes('kantor') || cat.includes('mouse') || cat.includes('monitor')) {
    return 'marathon lembur di depan laptop, mata silau, pergelangan tangan pegal, dan meja kerja berantakan';
  }
  if (cat.includes('elektronik') || cat.includes('gadget')) {
    return 'kelelahan lembur kerja, kabel kusut di meja kantor, atau baterai habis saat perjalanan pulang';
  }
  if (cat.includes('kosan') || cat.includes('rumah')) {
    return 'kamar kosan sempit, kontrakan gerah/apek, atau drama perlengkapan dengan teman sekamar';
  }
  if (cat.includes('fashion') || cat.includes('aksesoris') || cat.includes('outfit')) {
    return 'tuntutan berpakaian di kantor, kencan pertama canggung, atau rasa percaya diri saat meeting';
  }
  if (cat.includes('parfum') || cat.includes('wewangian')) {
    return 'aroma ruangan kantor, kencan pertama, atau rasa percaya diri saat bertemu orang banyak';
  }
  if (cat.includes('skincare') || cat.includes('grooming') || cat.includes('perawatan') || cat.includes('body')) {
    return 'kelelahan setelah perjalanan komuter panas terik, menjaga penampilan saat lelah kerja';
  }
  if (cat.includes('olahraga') || cat.includes('kebugaran')) {
    return 'usaha menjaga kesehatan di tengah stres kerjaan, olahraga ringan di kamar sempit';
  }
  if (cat.includes('kesehatan')) {
    return 'leher kaku dan mata lelah akibat menatap layar seharian saat lembur kantor';
  }
  return 'kehidupan sehari-hari pekerja atau pasutri muda di Indonesia';
}

/**
 * Menentukan topic_tag resmi Threads yang relevan dan terbukti aktif dipakai warganet
 */
function getAutoTopicTag(topic) {
  if (!topic) return 'curhat';
  const t = topic.toLowerCase();
  if (t.includes('wfh') || t.includes('remote') || t.includes('freelance') || t.includes('client') || t.includes('coding') || t.includes('timezone')) {
    return 'remote_tech';
  }
  if (t.includes('setup') || t.includes('mouse') || t.includes('keyboard') || t.includes('monitor') || t.includes('meja') || t.includes('ergonomic') || t.includes('kabel')) {
    return 'workplace_setup';
  }
  if (t.includes('fomo') || t.includes('iphone') || t.includes('subscription') || t.includes('netflix') || t.includes('paylater') || t.includes('doomscrolling') || t.includes('split bill') || t.includes('konser')) {
    return 'kultur_digital';
  }
  if (t.includes('warisan') || t.includes('tabungan nikah') || t.includes('resepsi') || t.includes('tulang punggung') || t.includes('sakit') || t.includes('mertua')) {
    return 'adulting_taboo';
  }
  if (t.includes('nepotisme') || t.includes('quiet firing') || t.includes('whistleblower') || t.includes('tenggo') || t.includes('kredit proyek') || t.includes('sp siluman') || t.includes('mikromajemen')) {
    return 'etika_karier';
  }
  if (t.includes('rantau') || t.includes('bali') || t.includes('mudik') || t.includes('kampung') || t.includes('daerah') || t.includes('lu-gue') || t.includes('gegar')) {
    return 'perantauan_daerah';
  }
  if (t.includes('politik kantor') || t.includes('promosi') || t.includes('paklaring') || t.includes('revisi') || t.includes('atasan arogan') || t.includes('sikut')) {
    return 'corporate_dilemma';
  }
  if (t.includes('kantor') || t.includes('kerja') || t.includes('gaji') || t.includes('lembur') || t.includes('bos') || t.includes('hrd') || t.includes('magang') || t.includes('resign') || t.includes('meeting')) {
    return 'duniakerja';
  }
  if (t.includes('kos') || t.includes('kontrakan') || t.includes('kamar') || t.includes('kulkas') || t.includes('token listrik')) {
    return 'anakkos';
  }
  if (t.includes('krl') || t.includes('stasiun') || t.includes('manggarai') || t.includes('gerbong') || t.includes('komuter') || t.includes('kereta')) {
    return 'krl';
  }
  if (t.includes('mertua') || t.includes('suami') || t.includes('istri') || t.includes('pasutri') || t.includes('arisan') || t.includes('tetangga') || t.includes('keluarga') || t.includes('rumah tangga')) {
    return 'rumahtangga';
  }
  if (t.includes('uang') || t.includes('pinjam') || t.includes('bensin') || t.includes('cicilan') || t.includes('finansial') || t.includes('perhitungan') || t.includes('utang')) {
    return 'finansial';
  }
  return 'curhat';
}

/**
 * Generate postingan Threads viral "Orang Banget"
 * Mendukung 2 mode:
 * 1. Single Menfess 1 Part (≤ 280 karakter total, 0% link, viral magnet)
 * 2. Micro-Thread 4-5 Part (Hook adegan konkret + Solusi Shopee Kontekstual + Pertanyaan Terbuka Warganet)
 * Otomatis melampirkan topic_tag resmi Threads (duniakerja, anakkos, krl, rumahtangga, finansial, curhat).
 */
async function generateStory(options = {}) {
  const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!apiKey && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error('Tidak ada AI API KEY (GEMINI, GROQ, atau OPENROUTER) yang diset di .env');
  }

  let forcedTopic = null;
  let variant = 'B';
  let origin = 'fiction';
  let topicTag = null;

  if (typeof options === 'string') {
    forcedTopic = options;
  } else if (typeof options === 'object' && options !== null) {
    forcedTopic = options.topic || options.forcedTopic || null;
    variant = (options.variant || 'B').toUpperCase();
    origin = options.origin || 'fiction';
    topicTag = options.topicTag || null;
  }

  let topic = forcedTopic;
  if (!topic) {
    topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  }

  if (!topicTag) {
    topicTag = getAutoTopicTag(topic);
  }

  const isFormatA = (variant === 'A');
  const withProduct = options.withProduct !== false && !isFormatA;

  let product = null;
  let trackedProductUrl = null;

  if (withProduct) {
    let relevantCategories = [];
    const tLower = (topic || '').toLowerCase();
    if (tLower.includes('kantor') || tLower.includes('kerja') || tLower.includes('gaji') || tLower.includes('lembur') || tLower.includes('bos')) {
      relevantCategories = ['Elektronik & Gadget', 'Gaya Hidup & Botol', 'Kerja & Kantor', 'Camilan & Makanan', 'Parfum & Wewangian'];
    } else if (tLower.includes('kos') || tLower.includes('kontrakan') || tLower.includes('teman') || tLower.includes('kulkas') || tLower.includes('kamar')) {
      relevantCategories = ['Rumah Tangga & Kosan', 'Gaya Hidup & Botol', 'Elektronik & Gadget', 'Perabot & Kosan'];
    } else if (tLower.includes('kencan') || tLower.includes('pacar') || tLower.includes('pasangan') || tLower.includes('suami') || tLower.includes('istri')) {
      relevantCategories = ['Parfum & Wewangian', 'Skincare & Perawatan', 'Skincare Pria', 'Fashion & Outfit'];
    } else if (tLower.includes('krl') || tLower.includes('stasiun') || tLower.includes('jalan') || tLower.includes('komuter')) {
      relevantCategories = ['Gaya Hidup & Botol', 'Elektronik & Gadget', 'Kesehatan', 'Skincare & Perawatan'];
    }

    product = db.getRandomProduct(relevantCategories);
    if (product && product.affiliate_url) {
      const nowWIB = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const currentHour = nowWIB.getHours();
      let slotTag = 'malam';
      if (currentHour < 11) slotTag = 'pagi';
      else if (currentHour < 17) slotTag = 'siang';

      const catSlug = (product.category || 'umum')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 15);

      trackedProductUrl = appendSubId(product.affiliate_url, {
        sub_id1: 'threads_ceritakiki',
        sub_id2: catSlug,
        sub_id3: slotTag,
        sub_id4: product.id ? `p${product.id}` : undefined
      });
    }
  }

  let cognitiveContext = '';
  try {
    const { buildCognitiveTuningContext } = require('./growthEngine');
    if (buildCognitiveTuningContext) {
      cognitiveContext = buildCognitiveTuningContext();
    }
  } catch (e) {}

  let prompt = '';

  if (isFormatA) {
    // FORMAT A: Single Post Curhat Ringkas + Pertanyaan Natural (≤240 karakter teks asli, 0% label fiksi)
    prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pekerja media di Jakarta (usia 26 thn, ngekos di Jakpus, sandwich generation).
Tuliskan SATU (1) POSTINGAN CURHAT TUNGGAL (Single Post, TIDAK BERSAMBUNG, HANYA 1 SLIDE).
Panjang teks cerita: 130 - 220 karakter.
${cognitiveContext}
TOPIK/KERESAHAN NYATA:
${topic}

STRUKTUR DAN ATURAN WAJIB (GAYA MANUSIA ASLI & ANTI-AI):
1. SUDUT PANDANG:
   - Jika opini pribadi: Gunakan sudut pandang orang pertama ("gue di kantor...", "tiap senin pagi di stasiun...", "temen kosan gue...").
   - Jika menceritakan pengalaman orang lain: Gunakan framing obrolan alami ("denger dari obrolan sana-sini...", "kemarin pas lagi nongkrong denger cerita...", "lagi di pantry denger obrolan...").
   - DILARANG KERAS MENGGUNAKAN FRASA "masuk DM", "kiriman DM", ATAU "spill di DM"!
   - DILARANG gaya cerpen/novel orang ketiga (seperti "Pak Baskara", "Direktur menatap Rendy").
2. LANGSUNG KE KEJADIAN & SERTAKAN 1 ANGKA KONKRET: Mulai langsung dari kejadian nyata dan masukkan 1 angka konkret (jam, nominal uang, durasi) supaya tidak abstrak.
3. TUTUP DENGAN PERTANYAAN NATURAL ATAU PERNYATAAN DATAR: DILARANG pakai template bot "kalian tim A atau tim B? spill!". Gunakan pertanyaan manusia biasa seperti "kalau di posisi gini enaknya ditegur langsung atau diemin aja ya?"
4. DILARANG memanggil diri sendiri "Ki". Bebas berekspresi, ceplas-ceplos, emosional, dan santai layaknya warganet Threads asli. Huruf kecil santai.
5. DILARANG MENULIS LABEL/DISCLAIMER SEPERTI "[Cerita Fiksi]", "[Fiksi]", "[Menfess]" ATAU SEJENISNYA!
6. DILARANG iklan/promosi apapun. 100% nol iklan.

Keluarkan HANYA JSON:
{
  "title": "Judul Menfess Singkat (Maksimal 5 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Teks curhat adegan konkret + penutup natural (130-220 karakter)..."
  ]
}
`;
  } else {
    // FORMAT B: Micro-Thread Tepat 3 Part (Persis 3 slide)
    prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pekerja media di Jakarta (usia 26 thn, ngekos di Jakpus, sandwich generation).
Tuliskan SATU UTAS MICRO-THREAD TEPAT 3 PART (PERSIS 3 SLIDE).
${cognitiveContext}
TOPIK/KERESAHAN NYATA:
${topic}

STRUKTUR 3 PART (WAJIB ADA ANGKA KONKRET & TANPA BAHASA AI CRINGE):
1. PART 1 (Hook Kejadian Konkret):
   - Sudut pandang: Jika pengalaman sendiri ("gue", "atasan gue"), jika cerita orang lain gunakan framing obrolan ("denger dari obrolan sana-sini...", "kemarin pas nongkrong denger cerita...").
   - DILARANG KERAS MENGGUNAKAN FRASA "masuk DM", "kiriman DM", ATAU "spill di DM"!
   - DILARANG gaya sinetron orang ketiga (seperti "Pak Baskara mendadak diam" atau "Rendy tertegun").
   - Panjang: 120 - 190 karakter. Huruf kecil santai.
2. PART 2 (Detail Kronologi & Angka Konkret):
   - Kelanjutan kejadian atau dialog singkat apa adanya. WAJIB masukkan 1 detail angka konkret (nominal uang/tagihan/gaji, jam kejadian, atau durasi waktu) agar terasa nyata.
   - Panjang: 150 - 240 karakter.
3. PART 3 (Penutup Natural Warganet - BUKAN Template Survey Bot):
   - Tutup dengan pertanyaan kasual layaknya minta pendapat teman (contoh: "kalau kalian di posisi itu mending langsung ngomong jujur atau cari aman aja?", "wajar gak sih kalau langsung ditolak mentah-mentah?").
   - DILARANG KERAS memakai kalimat template bot "kalian tim X atau tim Y? coba spill!" atau kata "spill!" di akhir kalimat.
   - Panjang: 90 - 160 karakter.

ATURAN KETAT ANTI-AI:
- DILARANG memanggil diri sendiri "Ki" atau "Kiki".
- Gaya bahasa bebas ekspresif, ceplas-ceplos, emosional layaknya obrolan nyata warganet Threads. Dilarang membuat istilah karangan aneh.
- DILARANG MENULIS ANGKA PENOMORAN ("1/3", "Part 1") atau label "[Cerita Fiksi]".
- DILARANG menyisipkan link promosi di prompt ini (link disisipkan otomatis terpisah).

Keluarkan HANYA JSON:
{
  "title": "Judul Utas (Maksimal 5-6 kata)",
  "topic": "${topic}",
  "story_parts": [
    "Part 1 hook kejadian konkret (120-190 chars)...",
    "Part 2 kronologi nyata dengan angka konkret (150-240 chars)...",
    "Part 3 pertanyaan penutup natural tanpa kata spill (90-160 chars)..."
  ]
}
`;
  }

  const models = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
  let data = null;

  if (apiKey) {
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.75
            }
          })
        });

        if (response.ok) {
          data = await response.json();
          break;
        }
        console.warn(`[AI] Model ${model} respon ${response.status}, mencoba model alternatif...`);
      } catch (e) {
        console.warn(`[AI] Gagal request model ${model}:`, e.message);
      }
    }
  }

  let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  // Fallback ke Groq LPU jika Gemini limit (Prioritaskan openai/gpt-oss-120b agar bahasa Indonesia bersih dan tidak halusinasi kata)
  if (!rawText && process.env.GROQ_API_KEY) {
    const groqModels = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
    for (const gModel of groqModels) {
      try {
        console.log(`[AI] Menggunakan Groq LPU (${gModel}) sebagai generator cerita...`);
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: gModel,
            messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
            response_format: { type: 'json_object' },
            temperature: 0.7
          })
        });
        if (groqRes.ok) {
          const groqJson = await groqRes.json();
          rawText = groqJson.choices?.[0]?.message?.content;
          if (rawText) break;
        }
      } catch (e) {
        console.warn(`[AI] Fallback Groq ${gModel} gagal:`, e.message);
      }
    }
  }

  // Fallback ke OpenRouter (Free tier) jika Gemini dan Groq keduanya limit
  if (!rawText && process.env.OPENROUTER_API_KEY) {
    try {
      console.log('[AI] Menggunakan OpenRouter (openrouter/free) sebagai cadangan lapis ke-3 cerita...');
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format tanpa markdown.' }],
          response_format: { type: 'json_object' },
          temperature: 0.75
        })
      });
      if (orRes.ok) {
        const orJson = await orRes.json();
        rawText = orJson.choices?.[0]?.message?.content;
      }
    } catch (e) {
      console.warn('[AI] Fallback OpenRouter gagal:', e.message);
    }
  }

  if (!rawText) {
    throw new Error('Semua AI provider (Gemini, Groq, OpenRouter) sedang sibuk. Silakan coba lagi.');
  }

  const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanJson);

  let cleanParts = (parsed.story_parts || []).map(p => sanitizeText(p));

  // Pastikan jumlah slide sesuai format
  if (isFormatA) {
    cleanParts = [cleanParts[0] || ''];
  } else {
    // Format B: Tepat 3 part
    if (cleanParts.length < 3) {
      cleanParts.push('Ada yang pernah ngalamin kejadian kayak gini juga? Gimana akhirnya kalian nyelesaiinnya?');
    }
    cleanParts = cleanParts.slice(0, 3);
  }

  // SEMATKAN REKOMENDASI PRODUK KONTEKSTUAL SHOPEE (Bila withProduct aktif)
  if (product && trackedProductUrl && !isFormatA) {
    const contextualAd = generateContextualAd(product, trackedProductUrl);
    // Masukkan sebelum slide pertanyaan penutup
    if (cleanParts.length >= 3) {
      cleanParts = [
        cleanParts[0],
        cleanParts[1],
        contextualAd,
        cleanParts[2]
      ];
    } else {
      cleanParts.push(contextualAd);
    }
  }

  // HAPUS TOTAL SEGALA BENTUK LABEL FIKSI / DISCLAIMER DI SELURUH SLIDE
  cleanParts = cleanParts.map(slide => {
    return (slide || '')
      .replace(/\[\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\]/gi, '')
      .replace(/\(\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\)/gi, '')
      .replace(/^.*?(disclaimer|catatan|peringatan)\s*:\s*.*?(fiksi|fiktif|karangan|buatan ai).*$/gim, '')
      .replace(/cerita ini (hanya )?(fiksi|rekaan|karangan|buatan ai)/gi, '')
      .replace(/^[\s\n\r*_-]+/, '')
      .trim();
  }).filter(Boolean);

  // Batasi karakter agar pas di feed Threads:
  // Format A: Maksimal 280 karakter total
  if (isFormatA && cleanParts[0].length > 280) {
    cleanParts[0] = cleanParts[0].substring(0, 275) + '...';
  }
  // Format B Part 1: Maksimal 280 karakter
  if (!isFormatA && cleanParts[0].length > 280) {
    cleanParts[0] = cleanParts[0].substring(0, 275) + '...';
  }

  // Slide selanjutnya dibatasi di bawah batas Threads (480 karakter)
  cleanParts = cleanParts.map((slide, idx) => {
    const s = (slide || '').trim();
    if (s.length > 480) {
      return s.substring(0, 475) + '...';
    }
    return s;
  });

  return {
    title: sanitizeText(parsed.title),
    topic: parsed.topic || topic,
    product_name: product ? product.name : null,
    product_url: trackedProductUrl,
    slides: cleanParts,
    variant: variant,
    origin: origin,
    topicTag: topicTag,
    topic_tag: topicTag,
    is_single_menfess: isFormatA
  };
}

/**
 * Mengolah cerita mentah kiriman warganet / DM menjadi thread berantai ("Add to thread": 3-5 part)
 * Karakter: Kiki Rachmat (@kikipunyacerita), anak muda korporat Jaksel, bertindak sebagai kurator/pencerita.
 * 
 * Aturan:
 * 1. Memecah cerita menjadi 3 sampai 4 slide terhubung sekuensial.
 * 2. Part 1: Hook menggantung dengan framing alami obrolan warganet (bukan "masuk DM").
 * 3. Part 2 - (N-1): Eskalasi kronologi atau dialog nyata tanpa bertele-tele.
 * 4. Part Terakhir (Paling Ujung): Pertanyaan diskusi warganet membelah kubu (thread war bait)
 *    + WAJIB menambahkan credit anonim di baris paling akhir:
 *    "(cerita anonim dari obrolan warganet)"
 * 5. 0% Label fiksi, 0% nomor urut ("Part 1", "1/3").
 */
async function processAnonymousStory(rawSubmission, options = {}) {
  const cleanRaw = (rawSubmission || '').trim();
  if (!cleanRaw || cleanRaw.length < 15) {
    throw new Error('Teks cerita curhat terlalu pendek. Masukkan minimal 15 karakter.');
  }

  const prompt = `
Kamu adalah Kiki Rachmat (@kikipunyacerita), pekerja media di Jakarta (usia 26 thn, ngekos di Jakpus, sandwich generation). JANGAN sebut nama asli orang (gunakan "si fulan").

Ada kiriman curhatan/cerita nyata warganet berikut ini:
"""
${cleanRaw}
"""

TUGAS:
Olah dan susun ulang cerita mentah di atas menjadi SATU UTAS POSTINGAN BERSAMBUNG ("Add to thread") SEBANYAK 3 PART/SLIDE yang rapi, runtut, dan apa adanya.

STRUKTUR SLIDE:
1. SLIDE 1 (Hook Kejadian Konkret):
   - Gunakan framing obrolan alami ("denger dari obrolan sana-sini...", "dapet cerita dari temen...", "kemarin denger cerita...") atau langsung masuk ke kejadian.
   - DILARANG menggunakan kata "masuk DM", "kiriman DM", atau "spill di DM"!
   - Panjang: 120 - 190 karakter. Huruf kecil santai.
2. SLIDE 2 (Detail Kronologi & Angka Konkret):
   - Ceritakan inti kronologi, konflik, dan pertahankan angka konkret (nominal uang, durasi, jam) tanpa lebay.
   - Panjang: 150 - 240 karakter.
3. SLIDE 3 (Pertanyaan Penutup Natural):
   - Tutup dengan pertanyaan kasual layaknya manusia biasa minta saran teman (contoh: "kalau di posisi si fulan, mending langsung resign hari itu juga atau bertahan dulu ya?").
   - DILARANG KERAS memakai kalimat template bot "kalian tim A atau tim B? spill!" atau kata "spill!" di ujung kalimat.
   - Panjang: 90 - 150 karakter.

ATURAN MUTLAK (ANTI-AI):
- DILARANG memanggil diri sendiri "Ki". Bebas berekspresi, ceplas-ceplos, dan emosional layaknya obrolan nyata warganet Threads.
- DILARANG MENULIS ANGKA PENOMORAN ("1/3", "Part 1") atau label "[Cerita Fiksi]". Huruf kecil santai.

Keluarkan HANYA JSON:
{
  "title": "Judul Utas Singkat (Maksimal 5 kata)",
  "topic": "Ringkasan Topik (Maksimal 8 kata)",
  "story_parts": [
    "Slide 1 hook kejadian konkret (120-190 chars)...",
    "Slide 2 eskalasi kronologi nyata (150-240 chars)...",
    "Slide 3 pertanyaan penutup natural tanpa kata spill (90-150 chars)..."
  ]
}
`;

  let rawText = null;

  // 1. Coba Gemini
  const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (apiKey) {
    const models = ['gemini-2.5-flash', 'gemini-3-flash-preview'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
          })
        });
        if (res.ok) {
          const jsonRes = await res.json();
          rawText = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) break;
        }
      } catch (e) {
        console.warn(`[AI-Curhat] Gemini ${m} error:`, e.message);
      }
    }
  }

  // 2. Coba Groq (Prioritaskan openai/gpt-oss-120b)
  if (!rawText && process.env.GROQ_API_KEY) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt + '\n\nKeluarkan HANYA JSON persis sesuai format.' }],
          response_format: { type: 'json_object' },
          temperature: 0.7
        })
      });
      if (groqRes.ok) {
        const gJson = await groqRes.json();
        rawText = gJson.choices?.[0]?.message?.content;
      }
    } catch (e) {
      console.warn('[AI-Curhat] Groq fallback error:', e.message);
    }
  }

  let parsed = null;
  if (rawText) {
    try {
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.warn('[AI-Curhat] Gagal parse JSON AI:', e.message);
    }
  }

  // Fallback jika semua AI gagal
  if (!parsed || !Array.isArray(parsed.story_parts) || parsed.story_parts.length === 0) {
    const sentences = cleanRaw.split(/(?<=[.!?])\s+/).filter(Boolean);
    const hook = `denger dari obrolan sana-sini, ${sentences.slice(0, 2).join(' ')}`.substring(0, 240);
    const body = sentences.slice(2, 6).join(' ').substring(0, 300) || 'pas kejadian ini terungkap, rasanya bener-bener ga habis pikir sama situasinya.';
    const question = 'mending langsung speak up di depan forum dengan risiko dimusuhi, atau telen sendiri pura-pura budek demi amannya gaji bulanan?';
    parsed = {
      title: 'Cerita Warganet',
      topic: cleanRaw.substring(0, 60),
      story_parts: [hook, body, question]
    };
  }

  let cleanParts = (parsed.story_parts || []).map(p => sanitizeText(p)).filter(Boolean);

  // Pastikan minimal 3 bagian
  if (cleanParts.length < 3) {
    cleanParts.push('mending langsung speak up dengan risiko dimusuhi, atau telen sendiri demi amannya gaji bulanan?');
  }

  // Bersihkan label fiksi dan frasa DM di seluruh slide
  cleanParts = cleanParts.map(slide => {
    return (slide || '')
      .replace(/\[\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\]/gi, '')
      .replace(/\(\s*(Cerita Fiksi|Kiriman Warganet|Kisah Fiksi|Fiksi|Fiktif)\s*\)/gi, '')
      .replace(/^.*?(disclaimer|catatan|peringatan)\s*:\s*.*?(fiksi|fiktif|karangan|buatan ai).*$/gim, '')
      .replace(/cerita ini (hanya )?(fiksi|rekaan|karangan|buatan ai)/gi, '')
      .replace(/\b(masuk\s*dm|kiriman\s*dm|spill\s*di\s*dm)\b/gi, 'denger dari obrolan sana-sini')
      .replace(/^[\s\n\r*_-]+/, '')
      .trim();
  }).filter(Boolean);

  // Sisipkan produk Shopee jika opsi withProduct aktif (Wajib Kontekstual Sesuai Topik)
  let product = null;
  let trackedProductUrl = null;
  if (options.withProduct === true) {
    let relevantCategories = [];
    const tLower = (cleanRaw || '').toLowerCase();
    if (tLower.includes('wfh') || tLower.includes('laptop') || tLower.includes('remote') || tLower.includes('mouse') || tLower.includes('monitor') || tLower.includes('meja')) {
      relevantCategories = ['Elektronik & Kerja', 'Kerja & Kantor', 'Gadget & Aksesoris'];
    } else if (tLower.includes('kantor') || tLower.includes('kerja') || tLower.includes('gaji') || tLower.includes('lembur') || tLower.includes('bos')) {
      relevantCategories = ['Elektronik & Kerja', 'Gaya Hidup & Botol', 'Kerja & Kantor', 'Gadget & Aksesoris'];
    } else if (tLower.includes('kos') || tLower.includes('kontrakan') || tLower.includes('kamar') || tLower.includes('gerah')) {
      relevantCategories = ['Rumah Tangga & Kosan', 'Gaya Hidup & Botol', 'Elektronik & Kosan', 'Perabot & Kosan'];
    } else {
      relevantCategories = ['Gaya Hidup & Botol', 'Elektronik & Gadget', 'Gadget & Aksesoris'];
    }
    product = db.getRandomProduct(relevantCategories);
    if (product && product.affiliate_url) {
      trackedProductUrl = appendSubId(product.affiliate_url, {
        sub_id1: 'threads_ceritakiki',
        sub_id2: 'curhat_anonim',
        sub_id3: 'story'
      });
      const contextualAd = generateContextualAd(product, trackedProductUrl);
      // Sisipkan tepat sebelum slide terakhir
      const lastIndex = cleanParts.length - 1;
      cleanParts.splice(lastIndex, 0, contextualAd);
    }
  }

  // CREDIT ANONIM DI AKHIR BAIT CERITA (Slide paling belakang / paling ujung)
  const lastIdx = cleanParts.length - 1;
  const anonCredit = '(cerita anonim dari obrolan warganet)';
  if (!cleanParts[lastIdx].includes(anonCredit)) {
    cleanParts[lastIdx] = cleanParts[lastIdx].trim() + `\n\n${anonCredit}`;
  }

  // Batasi panjang karakter slide agar pas di feed Threads
  if (cleanParts[0].length > 280) {
    cleanParts[0] = cleanParts[0].substring(0, 275) + '...';
  }
  cleanParts = cleanParts.map(s => (s.length > 480 ? s.substring(0, 475) + '...' : s));

  const topicTag = getAutoTopicTag(parsed.topic || cleanRaw);

  return {
    title: sanitizeText(parsed.title || 'Cerita Warganet'),
    topic: parsed.topic || cleanRaw.substring(0, 60),
    slides: cleanParts,
    variant: 'B',
    origin: 'community',
    topicTag: topicTag,
    topic_tag: topicTag,
    is_single_menfess: false,
    product_name: product ? product.name : null,
    product_url: trackedProductUrl
  };
}

module.exports = {
  generateStory,
  processAnonymousStory,
  appendSubId,
  getThematicVibe,
  getAutoTopicTag,
  generateContextualAd,
  TOPICS,
  TOPICS_CORPORATE,
  TOPICS_KULTUR_DIGITAL,
  TOPICS_ADULTING_TABOO,
  TOPICS_KARIER_DAN_ETIKA,
  TOPICS_PERANTAUAN_DAERAH,
  TOPICS_INTIMATE_MENFESS,
  TOPICS_SOCIAL_DILEMMA,
  TOPICS_HAL_RECEH,
  TOPICS_KELUARGA_RELASI,
  TOPICS_HOBI_RANDOM,
  TOPICS_HOT_TAKE_RINGAN,
  TOPICS_CERITA_BERSERI
};

