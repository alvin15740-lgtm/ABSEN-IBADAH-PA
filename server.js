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

   const QR_INTERVAL_MS = 150000;   // ganti QR tiap 2,5 menit
const QR_BUFFER_MS = 2000;     // toleransi keterlambatan submit dari jamaah
const JARAK_WAJAR_METER = 150; // radius dianggap "wajar" dari titik lokasi sesi

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
    const expiredAt = new Date(createdAt.getTime() + QR_INTERVAL_MS);
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
  timers[sesiId] = setInterval(() => buatTokenBaru(sesiId), QR_INTERVAL_MS);
}

function hentikanRotasi(sesiId) {
  if (timers[sesiId]) {
    clearInterval(timers[sesiId]);
    delete timers[sesiId];
  }
  delete qrTerakhir[sesiId];
}

// ---------- API: Sesi ----------

app.post('/api/sesi', (req, res) => {
  const { nama_sesi, ruangan, lokasi_lat, lokasi_lng } = req.body;
  if (!nama_sesi) return res.status(400).json({ error: 'nama_sesi wajib diisi' });

  const info = db
    .prepare(
      `INSERT INTO sesi_ibadah (nama_sesi, ruangan, lokasi_lat, lokasi_lng, status) VALUES (?, ?, ?, ?, 'aktif')`
    )
    .run(nama_sesi, ruangan || null, lokasi_lat || null, lokasi_lng || null);

  mulaiRotasi(info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid, nama_sesi, ruangan, interval_ms: QR_INTERVAL_MS });
});

app.get('/api/sesi/aktif', (req, res) => {
  const sesi = db
    .prepare(`SELECT * FROM sesi_ibadah WHERE status = 'aktif' ORDER BY id DESC LIMIT 1`)
    .get();
  res.json(sesi || null);
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
    .prepare(`SELECT id, nama, kelas FROM jamaah WHERE nama LIKE ? ORDER BY nama LIMIT 15`)
    .all(q);
  res.json(hasil);
});

app.post('/api/jamaah', (req, res) => {
  const { nama, kelas, no_hp } = req.body;
  if (!nama || !nama.trim()) return res.status(400).json({ error: 'nama wajib diisi' });
  const info = db.prepare(`INSERT INTO jamaah (nama, kelas, no_hp) VALUES (?, ?, ?)`).run(nama.trim(), kelas || null, no_hp || null);
  res.json({ id: info.lastInsertRowid, nama: nama.trim(), kelas: kelas || null });
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

  const batasWaktu = new Date(new Date(qrToken.expired_at).getTime() + QR_BUFFER_MS);
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
    statusLokasi = jarak <= JARAK_WAJAR_METER ? 'wajar' : 'perlu_dicek';
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
