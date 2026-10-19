# 🔑 Panduan Akses Server Backup (Lazarus / Server 2)

Dokumen ini berisi panduan dan detail akses SSH ke **Server 2 (Backup Server / Lazarus Project)** di Oracle Cloud Singapore untuk kebutuhan development project **Kisah Komisi**.

---

## 📌 Spesifikasi & Info Server

| Parameter | Nilai |
| :--- | :--- |
| **Instance Name** | `Lazarus Project` (Oracle Cloud Infrastructure) |
| **Region** | `ap-singapore-1` (Singapore) |
| **Public IP** | `213.35.118.26` |
| **Private IP** | `10.0.0.215` |
| **SSH Username** | `ubuntu` |
| **SSH Port** | `22` (Standar) |
| **Lokasi SSH Key** | `/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key` |

---

## 🚀 Cara Akses Server via SSH

### 1. Perintah SSH Langsung dari Terminal

Buka terminal di Mac Anda, lalu jalankan perintah berikut:

```bash
ssh -i "/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key" ubuntu@213.35.118.26
```

> **Catatan Izin Key (Opsional)**:  
> Jika muncul peringatan *"Permissions 0644 for ... are too open"*, set permission key terlebih dahulu:
> ```bash
> chmod 600 "/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key"
> ```

---

### 2. Mempermudah Akses via SSH Config (Alias `ssh server-backup`)

Agar tidak perlu mengetik path key dan IP panjang setiap saat, tambahkan konfigurasi ini ke file `~/.ssh/config` di Mac Anda:

```ssh-config
Host server-backup
    HostName 213.35.118.26
    User ubuntu
    IdentityFile "/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key"
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Setelah ditambahkan, Anda cukup mengetik perintah singkat ini untuk login:
```bash
ssh server-backup
```

---

## 📂 Transfer File (Upload / Download)

### Upload File dari Mac ke Server
```bash
scp -i "/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key" <file_lokal> ubuntu@213.35.118.26:/home/ubuntu/
```

### Download File dari Server ke Mac
```bash
scp -i "/Users/kiki/Documents/Web Develop/Server Singapore/Lazarus/ssh-key-Lazarus.key" ubuntu@213.35.118.26:/home/ubuntu/<file_remote> ./
```

---

## 🛠️ Perintah Berguna di Dalam Server

- **Cek Status Resource (RAM/Disk/CPU)**:
  ```bash
  htop
  df -h
  free -m
  ```
- **Cek Service yang Sedang Berjalan**:
  ```bash
  systemctl list-units --type=service --state=running
  ```
- **Cek Port yang Sedang Terbuka**:
  ```bash
  sudo ss -tulpn
  ```
