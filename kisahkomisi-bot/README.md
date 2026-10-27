# 🤖 Kisah Komisi / Cerita Kiki — Autopilot Engine & Telegram Controller

Mesin otomatisasi konten viral **Meta Threads** (`@kikipunyacerita`) dan pelacakan **Shopee Affiliate** berbasis AI, dikendalikan penuh secara real-time melalui **Telegram Bot** (`@kisahkomisibot`).

Dibangun menggunakan **Node.js**, **Telegraf**, **Better-SQLite3 (WAL Mode)**, **Google Gemini 2.5/3.0 Flash**, dan **Official Meta Threads Graph API**.

---

## 🌟 Fitur Utama & Arsitektur

### 1. 🧵 Threads Sequential Chaining ("Add to Thread")
- Menghasilkan format posting berantai vertikal bersambung resmi Meta.
- **1 Post Utama (Root Post)** tampil di feed profil.
- **Replies 1 s/d selesai** otomatis tersambung ke post sebelumnya (`reply_to_id = previousReplyId`), memunculkan garis vertikal utuh tanpa terputus.
- Mematuhi limit Meta Threads: 250 post utama & 1.000 replies per 24 jam.

### 2. 🤖 Contextual AI Storytelling (Gemini AI)
- Menggunakan 18 arketipe topik menfess viral Indonesia (drama kosan, kantor toxic, mertua julid, selingkuh hal sepele, fomo teman, dll).
- **High-Hook Opening (Part 1)**: Langsung masuk ke detik kejadian mengejutkan dalam 10 kata pertama, tanpa pembuka basi.
- **Debate Bait / Comment Magnet (Part 6)**: Mengakhiri cerita dengan pertanyaan diskusi polarisasi untuk memancing perdebatan netizen di kolom komentar.
- **Pembersih Otomatis**: Menghapus penomoran pecahan `[1/6]` dan emotikon Unicode agar murni menyerupai ketikan curhat netizen asli.

### 3. 🛍️ Shopee Affiliate Sub-ID Tracking & Intermezzo
- Disisipkan secara halus sebagai intermezzo di tengah thread (setelah Part 3).
- Dilengkapi parameter pelacakan konversi Shopee Affiliate otomatis: `?sub_id1=threads_ceritakiki`.
- Latar cerita AI diselaraskan secara tematik dengan kategori produk di database (Elektronik, Rumah Tangga, Fashion, Skincare).

### 4. 🛡️ Anti-Bot Posting Jitter & Security
- Jadwal tayang otomatis harian (12:15 WIB & 19:45 WIB) dilengkapi **Anti-Bot Jitter acak (1–10 menit)**.
- Meta membaca aktivitas posting seperti perilaku manusia alami, melindungi akun dari shadowban.

### 5. 🔄 Auto-Refresh Token Threads (60 Hari)
- Auto-refresh token berkala terjadwal setiap tanggal 1 & 15 jam 03:00 WIB.
- Token terbaru tersimpan langsung ke tabel `app_settings` di database SQLite dan langsung aktif tanpa perlu restart bot.
- Bisa diperpanjang kapan saja via perintah `/refresh_token`.

### 6. 💾 Automated Database Backup & Alerting
- Backup database otomatis dikirim langsung ke chat Telegram admin setiap hari Minggu jam 02:00 WIB.
- Notifikasi real-time ke Telegram saat postingan berhasil tayang atau saat terjadi kendala.
- Perintah `/backup` untuk mendownload snapshot database SQLite kapan saja.

---

## 📋 Daftar Perintah Telegram Bot

| Perintah | Deskripsi |
|---|---|
| `/start` / `/help` | Menampilkan panduan lengkap dan navigasi kontrol |
| `/bikin_cerita` | Meminta AI Gemini membuat 1 cerita menfess baru & masuk antrean |
| `/stok` | Memeriksa jumlah stok antrean cerita yang siap tayang |
| `/post_sekarang` | Menerbitkan 1 cerita terdepan di antrean ke Threads secara instan |
| `/cek_limit` | Memeriksa sisa kuota posting feed & replies Meta Threads Anda |
| `/status` | Cek uptime server, status token, stok cerita, dan proteksi jitter |
| `/refresh_token` | Perpanjang masa aktif access token Threads (+60 hari) |
| `/backup` | Mengirim file backup database SQLite langsung ke chat |
| `/list_produk` | Menampilkan seluruh link affiliate Shopee aktif di database |
| `/tambah_produk <Nama> \| <Link>` | Menambahkan produk affiliate baru |
| `/catat <Proyek> \| <Nominal> \| [Klien]` | Catat perolehan komisi freelance manual |
| `/rekap` | Ringkasan pendapatan komisi |

---

## ⚙️ Variabel Lingkungan (`.env`)

```env
BOT_TOKEN=your_telegram_bot_token
ALLOWED_USERS=@your_username,123456789
ADMIN_CHAT_ID=123456789
GEMINI_API_KEY=your_gemini_api_key
THREADS_USER_ID=your_meta_threads_user_id
THREADS_ACCESS_TOKEN=your_meta_long_lived_access_token
DB_PATH=./data/kisahkomisi.db
NODE_ENV=production
```

---

## 🚀 Deployment ke Server VPS

Jalankan script auto-deploy:
```bash
./deploy.sh
```

Atau jalankan manual di server via PM2:
```bash
cd /home/ubuntu/kisahkomisi-bot
npm install --omit=dev
pm2 start src/index.js --name "kisahkomisi-bot" --max-memory-restart 150M
pm2 save
```
