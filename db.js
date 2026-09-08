const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'absen.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
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

// Migrasi ringan: tambah kolom ruangan kalau database lama belum punya
try {
  db.exec('ALTER TABLE sesi_ibadah ADD COLUMN ruangan TEXT');
} catch (e) {
  // kolom sudah ada, abaikan
}
try {
  db.exec('ALTER TABLE jamaah ADD COLUMN kelas TEXT');
} catch (e) {
  // kolom sudah ada, abaikan
}

module.exports = db;
