# ARAH — Teman Langkah Sehari-hari

ARAH membantu pengguna mengubah tujuan atau hal yang terasa membingungkan menjadi langkah kecil, menyimpan catatan, merawat rutinitas, membaca panduan praktis, dan bertanya kepada asisten AI **Arah Cerdas**.

## Fitur

- **Peta langkah:** susun tujuan menjadi tindakan sederhana yang bisa disesuaikan.
- **Arah Cerdas:** ruang percakapan AI berbahasa Indonesia untuk belajar, meminta penjelasan, menyusun ide, dan merencanakan pekerjaan.
- **Pergantian layanan otomatis:** aplikasi mencoba jalur AI cadangan ketika jalur utama mencapai batas, mengalami gangguan, atau tidak tersedia. Nama penyedia tidak ditampilkan di antarmuka.
- **Langkah saya:** daftar tindakan dengan kategori, tenggat opsional, filter, dan status selesai.
- **Catatan:** simpan, cari, edit, dan hapus catatan pribadi.
- **Rutinitas:** buat kebiasaan, tandai penyelesaian harian, dan lihat ringkasan.
- **Panduan praktis:** materi ringkas seputar kebiasaan, keuangan pribadi dasar, fokus, persiapan kerja, merapikan ruang, dan pertimbangan keputusan.
- **Bantu memilih:** bandingkan dua pilihan dan simpan hasil pemikiran sebagai catatan.
- **Privasi:** catatan dan rutinitas disimpan di `localStorage`. Pesan yang dikirim ke Arah Cerdas diteruskan ke layanan AI untuk diproses. Jangan kirim kata sandi, kode verifikasi, atau data sensitif.
- **Cadangan:** ekspor dan pulihkan data dalam format JSON.
- **PWA:** bisa dipasang dari browser yang mendukung dan memiliki cache offline untuk shell aplikasi.

## Aktifkan Arah Cerdas di Netlify

Fungsi AI berjalan di server Netlify, bukan di browser. Ini disengaja agar kunci API tidak tertanam di `app.js`, HTML, atau APK yang dapat dibongkar.

1. Unggah isi folder `arah-app` ke repository atau proyek Netlify, lalu deploy sebagai situs Netlify.
2. Buka pengaturan situs Netlify → **Environment variables**.
3. Tambahkan `GEMINI_API_KEYS` dan `DEEPSEEK_API_KEYS` sebagai environment variables dengan scope **Functions**.
4. Isi masing-masing variabel dengan kunci yang sudah dibuat ulang. Bila punya beberapa kunci, pisahkan dengan koma atau baris baru.
5. Deploy ulang situs agar fungsi menerima konfigurasi terbaru.

Jangan menulis kunci sungguhan ke `.env.example`, `app.js`, `index.html`, atau repository publik. File `.env.example` hanya berisi contoh nama variabel. Kunci yang pernah dibagikan di chat atau repository sebaiknya dicabut dan diganti.

Fungsi tersedia pada path `/.netlify/functions/arah-ai`. Bila aplikasi di-host hanya pada GitHub Pages atau hosting statis yang tidak menjalankan Netlify Functions, halaman chat akan muncul tetapi AI tidak akan tersambung.

## Jalankan secara lokal

Jalankan situs melalui Netlify CLI agar fungsi server ikut tersedia. Instal Netlify CLI, atur environment variables lokal di berkas `.env` yang tidak diunggah, lalu jalankan:

```bash
netlify dev
```

Membuka `index.html` langsung atau memakai server statis sederhana hanya menampilkan antarmuka; fungsi AI tidak ikut berjalan.

## Pasang di HP

- **Android:** buka URL HTTPS Netlify menggunakan Chrome, lalu pilih menu browser **Install app** atau **Add to Home screen** jika tersedia.
- **iPhone:** buka URL menggunakan Safari, tekan **Share**, lalu **Add to Home Screen**.

Ini adalah PWA, bukan APK Android native. Untuk membuat APK Android, proyek perlu dibungkus menggunakan Android Studio, Trusted Web Activity, atau Capacitor.

## Batasan dan ketepatan

- Arah Cerdas memerlukan koneksi internet dan konfigurasi server AI yang aktif.
- Pergantian otomatis mencoba kunci lain yang telah dikonfigurasi dan kemudian layanan cadangan. Ini tidak dapat menjamin layanan selalu tersedia; kuota, saldo, izin akun, dan gangguan jaringan tetap dapat membatasi jawaban.
- Batas permintaan sederhana per alamat IP diterapkan di fungsi. Untuk penggunaan publik yang lebih luas, tambahkan autentikasi dan penyimpanan rate-limit terpusat.
- Jawaban AI bisa keliru atau tidak mutakhir. Periksa informasi penting melalui sumber resmi.
- Catatan, langkah, dan rutinitas berada di penyimpanan lokal browser dan tidak otomatis tersinkron antarperangkat.
- Cache offline menyimpan shell aplikasi; chat AI tidak bekerja tanpa internet.

## Struktur proyek

```text
arah-app/
├── index.html
├── styles.css
├── app.js
├── manifest.json
├── sw.js
├── netlify.toml
├── netlify/functions/arah-ai.js
├── .env.example
├── .gitignore
├── README.md
├── LICENSE
└── assets/
```

## Lisensi

MIT. Lihat file `LICENSE`.
