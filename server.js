const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ---------- Pengaturan (dimuat dari DB, bisa diubah lewat halaman Pengaturan) ----------

const pengaturan = {
  qr_interval_ms: 150000,
  qr_buffer_ms: 2000,
  jarak_wajar_meter: 1500,
};

function muatPengaturan() {
  const baris = db.prepare('SELECT kunci, nilai FROM pengaturan').all();
  for (const b of baris) {
    if (b.kunci in pengaturan) pengaturan[b.kunci] = Number(b.nilai);
  }
}
muatPengaturan();

// Timer rotasi QR per sesi aktif: { [sesiId]: intervalHandle }
const timers = {};
// QR terakhir per sesi, biar client yang baru join langsung dapat QR yang lagi aktif
const qrTerakhir = {};

function jarakMeter(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function buatTokenBaru(sesiId) {
  try {
    const token = nanoid(24);
    const createdAt = new Date();
    const expiredAt = new Date(createdAt.getTime() + pengaturan.qr_interval_ms);
    db.prepare(
      `INSERT INTO qr_token (sesi_id, token, created_at, expired_at) VALUES (?, ?, ?, ?)`
    ).run(sesiId, token, createdAt.toISOString(), expiredAt.toISOString());

    const dataUrl = await QRCode.toDataURL(token, { width: 320, margin: 1 });
    qrTerakhir[sesiId] = { token, dataUrl };
    io.to(`sesi-${sesiId}`).emit('qr-baru', { token, dataUrl });
    console.log(`[OK] QR baru untuk sesi ${sesiId}`);
  } catch (err) {
    console.error(`[GAGAL] Bikin QR untuk sesi ${sesiId}:`, err);
  }
}

function mulaiRotasi(sesiId) {
  if (timers[sesiId]) return;
  buatTokenBaru(sesiId);
  timers[sesiId] = setInterval(() => buatTokenBaru(sesiId), pengaturan.qr_interval_ms);
}

function hentikanRotasi(sesiId) {
  if (timers[sesiId]) {
    clearInterval(timers[sesiId]);
    delete timers[sesiId];
  }
  delete qrTerakhir[sesiId];
}

// Lanjutkan rotasi utk sesi yang masih 'aktif' kalau server baru saja restart
for (const sesi of db.prepare(`SELECT id FROM sesi_ibadah WHERE status = 'aktif'`).all()) {
  mulaiRotasi(sesi.id);
}

// ---------- API: Pengaturan ----------

app.get('/api/pengaturan', (req, res) => {
  res.json(pengaturan);
});

app.put('/api/pengaturan', (req, res) => {
  const { qr_interval_ms, qr_buffer_ms, jarak_wajar_meter } = req.body;
  const nilaiBaru = { qr_interval_ms, qr_buffer_ms, jarak_wajar_meter };
  const upsert = db.prepare(
    `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai`
  );
  for (const [kunci, nilai] of Object.entries(nilaiBaru)) {
    if (nilai === undefined || nilai === null || nilai === '') continue;
    const angka = Number(nilai);
    if (!Number.isFinite(angka) || angka <= 0) {
      return res.status(400).json({ error: `Nilai untuk ${kunci} tidak valid.` });
    }
    upsert.run(kunci, String(angka));
    pengaturan[kunci] = angka;
  }
  // Sesi yang sedang aktif ikut pakai interval baru mulai rotasi berikutnya
  for (const sesiId of Object.keys(timers)) {
    clearInterval(timers[sesiId]);
    timers[sesiId] = setInterval(() => buatTokenBaru(sesiId), pengaturan.qr_interval_ms);
  }
  res.json(pengaturan);
});

// ---------- API: Ruangan ----------

app.get('/api/ruangan', (req, res) => {
  const daftar = db
    .prepare(
      `SELECT r.id, r.nama,
              (SELECT COUNT(*) FROM kelas k WHERE k.ruangan_id = r.id) AS jumlah_kelas
       FROM ruangan r ORDER BY r.nama ASC`
    )
    .all();
  res.json(daftar);
});

app.post('/api/ruangan', (req, res) => {
  const nama = (req.body.nama || '').trim();
  if (!nama) return res.status(400).json({ error: 'Nama ruangan wajib diisi.' });
  try {
    const info = db.prepare(`INSERT INTO ruangan (nama) VALUES (?)`).run(nama);
    res.json({ id: info.lastInsertRowid, nama, jumlah_kelas: 0 });
  } catch (e) {
    res.status(400).json({ error: 'Nama ruangan sudah dipakai.' });
  }
});

app.delete('/api/ruangan/:id', (req, res) => {
  const { id } = req.params;
  const jumlahKelas = db.prepare(`SELECT COUNT(*) AS n FROM kelas WHERE ruangan_id = ?`).get(id).n;
  if (jumlahKelas > 0) {
    return res.status(400).json({ error: 'Hapus dulu semua kelas di ruangan ini sebelum menghapus ruangannya.' });
  }
  db.prepare(`DELETE FROM ruangan WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ---------- API: Kelas ----------

app.get('/api/kelas', (req, res) => {
  // Semua kelas, disertai nama ruangannya — dipakai buat dropdown pendaftaran jamaah
  const daftar = db
    .prepare(
      `SELECT k.id, k.nama, k.ruangan_id, r.nama AS ruangan_nama, k.lokasi_lat, k.lokasi_lng
       FROM kelas k JOIN ruangan r ON r.id = k.ruangan_id
       ORDER BY r.nama ASC, k.nama ASC`
    )
    .all();
  res.json(daftar);
});

app.get('/api/ruangan/:id/kelas', (req, res) => {
  const daftar = db
    .prepare(`SELECT * FROM kelas WHERE ruangan_id = ? ORDER BY nama ASC`)
    .all(req.params.id);
  res.json(daftar);
});

app.post('/api/kelas', (req, res) => {
  const { ruangan_id, nama, lokasi_lat, lokasi_lng } = req.body;
  const namaBersih = (nama || '').trim();
  if (!ruangan_id || !namaBersih) {
    return res.status(400).json({ error: 'Ruangan dan nama kelas wajib diisi.' });
  }
  const info = db
    .prepare(`INSERT INTO kelas (ruangan_id, nama, lokasi_lat, lokasi_lng) VALUES (?, ?, ?, ?)`)
    .run(ruangan_id, namaBersih, lokasi_lat ?? null, lokasi_lng ?? null);
  res.json({ id: info.lastInsertRowid, ruangan_id, nama: namaBersih, lokasi_lat, lokasi_lng });
});

app.put('/api/kelas/:id', (req, res) => {
  const { nama, lokasi_lat, lokasi_lng } = req.body;
  const namaBersih = (nama || '').trim();
  if (!namaBersih) return res.status(400).json({ error: 'Nama kelas wajib diisi.' });
  db.prepare(`UPDATE kelas SET nama = ?, lokasi_lat = ?, lokasi_lng = ? WHERE id = ?`).run(
    namaBersih,
    lokasi_lat ?? null,
    lokasi_lng ?? null,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/kelas/:id', (req, res) => {
  db.prepare(`DELETE FROM kelas WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- API: Sesi ----------

app.post('/api/sesi', (req, res) => {
  const { nama_sesi, kelas_id } = req.body;
  if (!nama_sesi) return res.status(400).json({ error: 'nama_sesi wajib diisi' });
  if (!kelas_id) return res.status(400).json({ error: 'Pilih ruangan & kelas terlebih dulu' });

  const kelas = db
    .prepare(
      `SELECT k.*, r.nama AS ruangan_nama FROM kelas k JOIN ruangan r ON r.id = k.ruangan_id WHERE k.id = ?`
    )
    .get(kelas_id);
  if (!kelas) return res.status(400).json({ error: 'Kelas tidak ditemukan' });

  const info = db
    .prepare(
      `INSERT INTO sesi_ibadah (nama_sesi, ruangan, lokasi_lat, lokasi_lng, ruangan_id, kelas_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'aktif')`
    )
    .run(
      nama_sesi,
      `${kelas.ruangan_nama} — ${kelas.nama}`,
      kelas.lokasi_lat,
      kelas.lokasi_lng,
      kelas.ruangan_id,
      kelas.id
    );

  mulaiRotasi(info.lastInsertRowid);
  res.json({
    id: info.lastInsertRowid,
    nama_sesi,
    ruangan: `${kelas.ruangan_nama} — ${kelas.nama}`,
    interval_ms: pengaturan.qr_interval_ms,
  });
});

app.get('/api/sesi/aktif', (req, res) => {
  const sesi = db
    .prepare(`SELECT * FROM sesi_ibadah WHERE status = 'aktif' ORDER BY id DESC LIMIT 1`)
    .get();
  res.json(sesi || null);
});

app.get('/api/sesi', (req, res) => {
  const daftar = db
    .prepare(
      `SELECT s.id, s.nama_sesi, s.ruangan, s.waktu_mulai, s.waktu_selesai, s.status,
              (SELECT COUNT(*) FROM absensi a WHERE a.sesi_id = s.id) AS jumlah_hadir
       FROM sesi_ibadah s ORDER BY s.id DESC LIMIT 100`
    )
    .all();
  res.json(daftar);
});

app.get('/api/sesi/:id', (req, res) => {
  const sesi = db.prepare(`SELECT * FROM sesi_ibadah WHERE id = ?`).get(req.params.id);
  res.json(sesi || null);
});

app.post('/api/sesi/:id/tutup', (req, res) => {
  const { id } = req.params;
  db.prepare(`UPDATE sesi_ibadah SET status='selesai', waktu_selesai=? WHERE id=?`).run(
    new Date().toISOString(),
    id
  );
  hentikanRotasi(id);
  io.to(`sesi-${id}`).emit('sesi-selesai');
  res.json({ ok: true });
});

// ---------- API: Jamaah ----------

app.get('/api/jamaah/cari', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const hasil = db
    .prepare(
      `SELECT j.id, j.nama, j.kelas, j.kelas_id, k.nama AS kelas_nama, r.nama AS ruangan_nama
       FROM jamaah j
       LEFT JOIN kelas k ON k.id = j.kelas_id
       LEFT JOIN ruangan r ON r.id = k.ruangan_id
       WHERE j.nama LIKE ? ORDER BY j.nama LIMIT 15`
    )
    .all(q);
  res.json(hasil);
});

app.post('/api/jamaah', (req, res) => {
  const { nama, kelas_id, no_hp } = req.body;
  if (!nama || !nama.trim()) return res.status(400).json({ error: 'nama wajib diisi' });

  let kelasNamaText = null;
  if (kelas_id) {
    const k = db.prepare(`SELECT nama FROM kelas WHERE id = ?`).get(kelas_id);
    if (k) kelasNamaText = k.nama;
  }

  const info = db
    .prepare(`INSERT INTO jamaah (nama, kelas, kelas_id, no_hp) VALUES (?, ?, ?, ?)`)
    .run(nama.trim(), kelasNamaText, kelas_id || null, no_hp || null);
  res.json({ id: info.lastInsertRowid, nama: nama.trim(), kelas: kelasNamaText, kelas_id: kelas_id || null });
});

// ---------- API: Absen ----------

app.post('/api/absen', (req, res) => {
  const { sesi_id, token, jamaah_id, device_fingerprint, lat, lng } = req.body;

  if (!sesi_id || !token || !jamaah_id || !device_fingerprint) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  const sesi = db.prepare(`SELECT * FROM sesi_ibadah WHERE id = ?`).get(sesi_id);
  if (!sesi || sesi.status !== 'aktif') {
    return res.status(400).json({ error: 'Sesi tidak aktif' });
  }

  const qrToken = db.prepare(`SELECT * FROM qr_token WHERE token = ? AND sesi_id = ?`).get(token, sesi_id);
  if (!qrToken) {
    return res.status(400).json({ error: 'QR tidak dikenali. Coba scan ulang.' });
  }

  const batasWaktu = new Date(new Date(qrToken.expired_at).getTime() + pengaturan.qr_buffer_ms);
  if (new Date() > batasWaktu) {
    return res.status(400).json({ error: 'QR sudah kedaluwarsa. Silakan scan QR yang sedang tampil.' });
  }

  const sudahAbsenDenganNamaLain = db
    .prepare(`SELECT * FROM absensi WHERE sesi_id = ? AND device_fingerprint = ?`)
    .get(sesi_id, device_fingerprint);
  if (sudahAbsenDenganNamaLain) {
    return res.status(400).json({
      error: `Device ini sudah dipakai untuk absen atas nama lain di sesi ini.`,
    });
  }

  const sudahAbsen = db
    .prepare(`SELECT * FROM absensi WHERE sesi_id = ? AND jamaah_id = ?`)
    .get(sesi_id, jamaah_id);
  if (sudahAbsen) {
    return res.status(400).json({ error: 'Nama ini sudah tercatat hadir di sesi ini.' });
  }

  let statusLokasi = 'tidak_diketahui';
  if (lat && lng && sesi.lokasi_lat && sesi.lokasi_lng) {
    const jarak = jarakMeter(lat, lng, sesi.lokasi_lat, sesi.lokasi_lng);
    statusLokasi = jarak <= pengaturan.jarak_wajar_meter ? 'wajar' : 'perlu_dicek';
  }

  db.prepare(
    `INSERT INTO absensi (sesi_id, jamaah_id, qr_token_id, device_fingerprint, lokasi_lat, lokasi_lng, status_lokasi)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sesi_id, jamaah_id, qrToken.id, device_fingerprint, lat || null, lng || null, statusLokasi);

  const jamaah = db.prepare(`SELECT nama FROM jamaah WHERE id = ?`).get(jamaah_id);
  io.to(`sesi-${sesi_id}`).emit('absen-baru', { nama: jamaah.nama, status_lokasi: statusLokasi });

  res.json({ ok: true, nama: jamaah.nama });
});

app.get('/api/sesi/:id/laporan', (req, res) => {
  const { id } = req.params;
  const daftar = db
    .prepare(
      `SELECT a.id, j.nama, j.kelas, a.waktu_absen, a.status_lokasi
       FROM absensi a JOIN jamaah j ON j.id = a.jamaah_id
       WHERE a.sesi_id = ? ORDER BY j.kelas ASC, a.waktu_absen ASC`
    )
    .all(id);
  res.json(daftar);
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  socket.on('join-sesi', (sesiId) => {
    socket.join(`sesi-${sesiId}`);
    if (qrTerakhir[sesiId]) {
      socket.emit('qr-baru', qrTerakhir[sesiId]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
