const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'absen.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS ruangan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruangan_id INTEGER NOT NULL,
  nama TEXT NOT NULL,
  lokasi_lat REAL,
  lokasi_lng REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ruangan_id) REFERENCES ruangan(id)
);

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT
);

CREATE TABLE IF NOT EXISTS jamaah (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  kelas TEXT,
  no_hp TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sesi_ibadah (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_sesi TEXT NOT NULL,
  ruangan TEXT,
  lokasi_lat REAL,
  lokasi_lng REAL,
  waktu_mulai TEXT DEFAULT CURRENT_TIMESTAMP,
  waktu_selesai TEXT,
  status TEXT DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS qr_token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expired_at TEXT NOT NULL,
  FOREIGN KEY (sesi_id) REFERENCES sesi_ibadah(id)
);

CREATE TABLE IF NOT EXISTS absensi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id INTEGER NOT NULL,
  jamaah_id INTEGER NOT NULL,
  qr_token_id INTEGER,
  device_fingerprint TEXT NOT NULL,
  waktu_absen TEXT DEFAULT CURRENT_TIMESTAMP,
  lokasi_lat REAL,
  lokasi_lng REAL,
  status_lokasi TEXT DEFAULT 'tidak_diketahui',
  UNIQUE(sesi_id, jamaah_id),
  FOREIGN KEY (sesi_id) REFERENCES sesi_ibadah(id),
  FOREIGN KEY (jamaah_id) REFERENCES jamaah(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_per_sesi
  ON absensi(sesi_id, device_fingerprint);
`);

// ---------- Migrasi ringan (aman dijalankan berulang) ----------
function tambahKolom(tabel, definisi) {
  try {
    db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${definisi}`);
  } catch (e) {
    // kolom sudah ada, abaikan
  }
}

tambahKolom('sesi_ibadah', 'ruangan TEXT');
tambahKolom('jamaah', 'kelas TEXT');
tambahKolom('sesi_ibadah', 'ruangan_id INTEGER');
tambahKolom('sesi_ibadah', 'kelas_id INTEGER');
tambahKolom('jamaah', 'kelas_id INTEGER');

// Nilai default pengaturan — hanya diisi kalau kuncinya belum ada
const DEFAULT_PENGATURAN = {
  qr_interval_ms: '150000',      // 2,5 menit
  qr_buffer_ms: '2000',          // toleransi keterlambatan submit
  jarak_wajar_meter: '1500',     // radius dianggap wajar dari titik kelas
};

const cekPengaturan = db.prepare('SELECT kunci FROM pengaturan WHERE kunci = ?');
const isiPengaturan = db.prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)');
for (const [kunci, nilai] of Object.entries(DEFAULT_PENGATURAN)) {
  if (!cekPengaturan.get(kunci)) {
    isiPengaturan.run(kunci, nilai);
  }
}

module.exports = db;
