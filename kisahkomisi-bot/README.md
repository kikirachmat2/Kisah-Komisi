# 🤖 Kisah Komisi — Telegram Bot

Bot Telegram untuk mencatat dan merekap perolehan komisi proyek freelance / bisnis Anda, didukung oleh **Node.js**, **Telegraf**, dan **SQLite** (`better-sqlite3` dalam WAL mode).

---

## 📌 Fitur Utama
- ➕ `/catat <proyek> | <nominal> | [klien] | [catatan]` — Catat komisi baru.
- 📊 `/rekap` — Ringkasan total pendapatan, komisi pending, dan komisi lunas.
- 📋 `/riwayat` — Melihat 10 catatan komisi terakhir.
- ✅ `/lunas <id>` — Update status komisi menjadi lunas.
- ❌ `/batal <id>` — Batalkan pencatatan komisi.
- 🔒 **User Whitelist Protection**: Bot dapat dibatasi hanya untuk user Telegram tertentu via `ALLOWED_USERS`.

---

## ⚙️ Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Isi konfigurasi:
```env
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
ALLOWED_USERS=12345678,87654321  # Kosongkan jika publik
DB_PATH=./data/kisahkomisi.db
NODE_ENV=production
```

---

## 🚀 Menjalankan Bot di Server (PM2)
```bash
# 1. Masuk ke direktori
cd /home/ubuntu/kisahkomisi-bot

# 2. Pasang dependensi
npm install --omit=dev

# 3. Jalankan via PM2 dengan batas memori aman
pm2 start src/index.js --name "kisahkomisi-bot" --max-memory-restart 150M

# 4. Simpan state agar autostart saat reboot
pm2 save
```
