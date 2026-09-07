# Web Absensi Ibadah

Sistem absensi kehadiran ibadah dengan QR code yang berganti otomatis tiap 5 detik, supaya hanya jamaah yang benar-benar hadir yang bisa absen.

## Cara Menjalankan

1. Install [Node.js](https://nodejs.org) versi 18 ke atas.
2. Buka folder ini di terminal, lalu jalankan:
   ```
   npm install
   npm start
   ```
3. Server jalan di `http://localhost:3000`

## Halaman yang Tersedia

| Halaman | Untuk siapa | Fungsi |
|---|---|---|
| `/admin.html` | Panitia | Mulai sesi ibadah & tampilkan QR di proyektor/layar |
| `/absen.html` | Jamaah | Scan QR pakai HP masing-masing lalu absen |
| `/laporan.html?sesi=ID` | Panitia | Lihat daftar hadir (link muncul otomatis dari halaman admin) |

## Alur Pemakaian di Hari-H

1. Panitia buka `/admin.html` di laptop, colokkan ke proyektor/layar
2. Isi nama sesi (misal "Ibadah Minggu, 7 Sept 2026") → klik **Mulai Sesi**
3. QR otomatis tampil dan berganti tiap 5 detik
4. Jamaah buka `/absen.html` di HP masing-masing (bisa disebar linknya lewat grup, atau ditulis di depan)
5. Jamaah scan QR yang sedang tampil di layar → cari & pilih nama → klik **Absen Sekarang**
6. Kalau nama belum terdaftar, jamaah bisa daftar sendiri lewat link "Daftar sebagai jamaah baru"
7. Selesai ibadah, panitia klik **Tutup Sesi** di halaman admin

## Deploy ke Internet (Supaya Bisa Diakses dari HP Jamaah)

Aplikasi ini perlu online (bukan cuma localhost) supaya HP jamaah bisa mengaksesnya. Opsi gratis/murah yang mudah:
- **Railway.app** atau **Render.com** — tinggal hubungkan folder ini, otomatis jalan
- VPS murah (kalau sudah ada) — jalankan dengan `pm2` supaya tetap hidup di background

## Catatan Keamanan yang Sudah Diterapkan

- QR berganti tiap 5 detik + toleransi 2 detik keterlambatan submit
- 1 device (HP) hanya bisa dipakai absen 1 nama per sesi
- Lokasi GPS dicatat sebagai penanda tambahan (tidak memblokir absen), untuk panitia spot-check
- Setiap nama hanya bisa tercatat hadir 1 kali per sesi

## Struktur Database

Lihat `db.js` — 4 tabel: `jamaah`, `sesi_ibadah`, `qr_token`, `absensi`.
