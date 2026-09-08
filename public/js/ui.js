// Komponen UI kecil bersama: toast notifikasi & dialog konfirmasi custom.
// Dipakai di admin.html, absen.html, laporan.html menggantikan alert()/confirm() bawaan browser.

(function () {
  function pastikanKontainerToast() {
    let c = document.getElementById('toast-kontainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-kontainer';
      document.body.appendChild(c);
    }
    return c;
  }

  window.showToast = function (pesan, jenis = 'info', durasiMs = 3800) {
    const kontainer = pastikanKontainerToast();
    const el = document.createElement('div');
    el.className = `toast toast-${jenis}`;
    el.textContent = pesan;
    kontainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('tampil'));
    setTimeout(() => {
      el.classList.remove('tampil');
      setTimeout(() => el.remove(), 250);
    }, durasiMs);
  };

  window.confirmDialog = function (pesan, opsi = {}) {
    const { judul = 'Konfirmasi', teksYa = 'Ya', teksTidak = 'Batal', bahaya = false } = opsi;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-kotak">
          <h3>${judul}</h3>
          <p>${pesan}</p>
          <div class="modal-aksi">
            <button class="btn-luar modal-batal">${teksTidak}</button>
            <button class="${bahaya ? 'btn-bahaya' : 'btn-utama'} modal-ya">${teksYa}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('tampil'));

      function tutup(hasil) {
        overlay.classList.remove('tampil');
        setTimeout(() => overlay.remove(), 200);
        resolve(hasil);
      }
      overlay.querySelector('.modal-batal').addEventListener('click', () => tutup(false));
      overlay.querySelector('.modal-ya').addEventListener('click', () => tutup(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) tutup(false);
      });
    });
  };
})();
