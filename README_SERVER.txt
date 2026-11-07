SERVER BUKU KONSULTASI SKRIPSI FKIP UPGRIP
===========================================

APA INI
Aplikasi buku yang sama, tetapi dosen dan mahasiswa memakai AKUN. Dosen login lalu mengirim saran dan paraf langsung ke server. Mahasiswa login lalu menekan "Ambil dari server" di buku. Hanya akun dosen yang ditugaskan ke mahasiswa itu yang dapat membuat entri, jadi mahasiswa tidak bisa memalsukannya.
Tidak butuh paket tambahan. Cukup Node.js versi 18 atau lebih baru (disarankan 22).

HALAMAN
  /            aplikasi buku (mahasiswa dan dosen)
  /admin       halaman admin prodi: akun, penugasan pembimbing, rekap entri
  /verifikasi  cek kode 8 karakter di Kartu Bimbingan (boleh dibuka siapa saja)

MENJALANKAN DI KOMPUTER SENDIRI (UJI COBA)
  1. Pasang Node.js dari nodejs.org.
  2. Buka terminal di folder ini, lalu jalankan:  node server.js
  3. Catat KATA SANDI ADMIN yang tampil sekali di layar (nama pengguna: admin).
     Atau tetapkan sendiri sebelum menjalankan:  ADMIN_PASSWORD=SandiAdmin123 node server.js
  4. Buka http://localhost:3000/admin dan login. Anda wajib mengganti sandi.
  Catatan: untuk dipakai orang lain, server harus ditayangkan dengan HTTPS (lihat bawah).

PENGATURAN (variabel lingkungan)
  PORT            port server (bawaan 3000)
  DATA_DIR        folder penyimpanan data (bawaan ./data). WAJIB di disk yang tidak terhapus.
  ADMIN_PASSWORD  sandi awal admin (min. 8 karakter). Bila kosong dibuat acak dan dicetak sekali.
  TRUST_PROXY=1   isi 1 bila server berada di belakang proxy/HTTPS platform (hampir semua hosting).
                  Tanpa ini, alamat IP pengguna terbaca sebagai alamat proxy.

MENAYANGKAN KE PENGGUNA (PILIH SATU)
  A. VPS murah (Linux) + Caddy untuk HTTPS otomatis. Paling stabil dan murah.
       - Salin folder ini ke server, jalankan dengan systemd:  node server.js
       - Caddy:  contoh.upgrip.ac.id { reverse_proxy localhost:3000 }
       - Jalankan dengan TRUST_PROXY=1
  B. Docker (di VPS atau layanan yang mendukung Docker):
       docker build -t buku-konsultasi .
       docker run -d -p 3000:3000 -v /data/buku:/data -e ADMIN_PASSWORD=GantiIni123 buku-konsultasi
  C. Platform seperti Render atau Railway: bisa, TETAPI hanya dengan disk permanen (persistent disk atau
     volume) yang dipasang ke DATA_DIR. Paket gratis tanpa disk permanen MENGHAPUS data saat server
     dimulai ulang. Jangan dipakai untuk data bimbingan.
  Tanyakan juga ke bagian TI kampus; server kampus dengan alamat resmi adalah pilihan terbaik.

HTTPS WAJIB. Tanpa HTTPS, kata sandi dan cookie login dapat disadap di jaringan. PWA (pasang aplikasi) juga hanya
berjalan di HTTPS.

LANGKAH PERTAMA ADMIN
  1. Login di /admin, ganti sandi.
  2. Tab Akun: tempel daftar dosen (namapengguna;Nama), lalu daftar mahasiswa
     (NIM;Nama;pembimbing 1;pembimbing 2;validator). Pembimbing diisi nama pengguna dosen.
  3. Unduh .csv kata sandi sementara dan bagikan ke masing-masing orang. Sandi itu hanya tampil sekali.
     Pengguna wajib menggantinya saat login pertama.
  4. Lupa sandi: admin menekan "Reset sandi" untuk akun itu (tidak ada reset lewat email).

CADANGAN (PENTING)
  Seluruh data ada di DATA_DIR: db.json dan folder sig/ (gambar paraf). Server membuat salinan db.json
  harian (cadangan-TANGGAL.json, disimpan 14 hari) di folder yang sama, tetapi itu belum cukup bila disknya rusak.
  Salin seluruh DATA_DIR ke tempat lain secara berkala, minimal seminggu sekali.

YANG DIJAMIN DAN YANG TIDAK
  - Dijamin: entri dosen hanya bisa dibuat oleh akun dosen yang ditugaskan ke mahasiswa itu, tercatat dengan
    waktu server, dan tiap entri punya kode verifikasi. Sandi disimpan terenkripsi (scrypt), sesi memakai
    cookie HttpOnly, percobaan login dibatasi.
  - Tidak dijamin: buku di perangkat mahasiswa tetap berupa berkas lokal. Bila mahasiswa membuka kunci kolom,
    dia dapat mengetik apa pun di bukunya sendiri. Karena itu keaslian diperiksa dari catatan server:
    gunakan /verifikasi dengan kode di Kartu Bimbingan, atau rekap di /admin.
  - Skala: penyimpanan berupa berkas JSON, cukup untuk satu prodi atau fakultas (ratusan sampai beberapa ribu
    akun). Untuk skala universitas, ganti ke basis data sungguhan.
  - Belum ada: reset sandi lewat email, penghapusan akun massal, riwayat perubahan (audit log).

MEMPERBARUI APLIKASI
  Ganti isi folder public/ dan jalankan ulang server. Naikkan angka VERSI di public/sw.js bila index.html berubah.
