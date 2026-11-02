# T-Step Lab — Sistem Kas Laundry Sepatu

Aplikasi web sederhana untuk mengelola operasional laundry sepatu: pencatatan pesanan, antrean pengerjaan, pembayaran, buku kas, dan jurnal umum. Frontend dibuat dengan HTML, CSS, dan JavaScript; backend menggunakan Node.js; penyimpanan data menggunakan Supabase dengan PostgreSQL.

## Fitur

- Login terpisah untuk Admin dan Owner.
- Pencatatan pesanan untuk satu atau beberapa pasang sepatu, termasuk layanan, jenis/bahan, merek, dan ukuran per pasang.
- Antrean dan pembaruan status pengerjaan hingga pengantaran.
- Perhitungan tarif serta status pembayaran pesanan.
- Buku kas untuk pemasukan pembayaran dan pengeluaran operasional.
- Jurnal umum yang dibentuk dari transaksi.
- Pengaturan katalog layanan dan tarif berdasarkan jenis sepatu.
- Opsi pelanggan mengantar sepatu ke toko, meminta jemput-antar, atau meminta pengantaran setelah pesanan siap.

### Aturan pembayaran dan pengantaran

- Sepatu yang diantar pelanggan ke toko: pembayaran awal minimal 70% dari tarif setiap pasang.
- Permintaan antar oleh karyawan: biaya tetap Rp5.000 per pesanan, bukan per pasang.
- Layanan jemput dari rumah dan antar kembali oleh karyawan: pembayaran harus lunas 100% sebelum penjemputan.
- Permintaan antar setelah pesanan siap dikenai tambahan Rp5.000. Sisa tagihan termasuk biaya antar harus dibayar lunas melalui QRIS sebelum status pengantaran dapat dimulai.

## Teknologi

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js (modul bawaan; tidak memerlukan `package.json`)
- **Database:** Supabase PostgreSQL
- **Diagram ERD:** SVG, ditampilkan langsung di bawah

## ERD (Entity Relationship Diagram)

Diagram berikut menggambarkan empat tabel utama yang benar-benar diterapkan pada PostgreSQL. Diagram disertakan sebagai SVG agar tampil langsung pada README GitHub.

![ERD Sistem Kas Laundry Sepatu T-Step Lab](ERD.svg)

**Ringkasan relasi:** satu pelanggan dapat memiliki banyak pesanan; satu layanan dapat menjadi layanan utama pada banyak pesanan; satu pesanan dapat memiliki banyak pembayaran. Pengeluaran operasional juga tersimpan pada `payments`, dengan `order_id` kosong dan tipe transaksi `expense`.

> **Catatan model multi-pasang:** ERD di atas menampilkan tabel fisik yang ada. Rincian beberapa pasang sepatu serta metadata logistik disimpan aplikasi dalam payload pada `orders.notes`, bukan pada tabel `order_items` terpisah. Struktur SQL lengkap tersedia di [`backend/schema.sql`](backend/schema.sql).

## Struktur folder

```text
T-Step-Lab-App/
├── backend/
│   ├── app.js                 # Server HTTP dan API
│   ├── schema.sql             # Skema PostgreSQL untuk Supabase
│   └── .env                   # Konfigurasi lokal; jangan unggah ke GitHub
├── frontend/
│   ├── index.html
│   ├── config.js              # URL API; diisi workflow GitHub Pages
│   ├── app.js
│   └── styles.css
├── .github/workflows/
│   └── deploy-pages.yml       # Deployment frontend GitHub Pages
├── render.yaml                # Deployment backend Node.js
├── ERD.svg                    # Diagram relasi basis data
├── Buka T-Step Lab.bat        # Menjalankan server dan membuka browser di Windows
└── README.md
```

## Deployment GitHub Pages + Supabase

GitHub Pages hanya dapat menyajikan file statis dan tidak menjalankan `backend/app.js`. Karena itu aplikasi harus menggunakan dua layanan: frontend di GitHub Pages dan API Node.js di Render. Frontend hanya menampilkan status Supabase tersambung setelah backend berhasil memeriksa database; jika API tidak tersedia, aplikasi menampilkan error dan tidak beralih diam-diam ke penyimpanan browser.

1. Pastikan project Supabase sudah memiliki skema dari [`backend/schema.sql`](backend/schema.sql).
2. Buat layanan Web Service di Render dari repository ini dan gunakan blueprint [`render.yaml`](render.yaml). Isi environment variables yang diminta Render:
   - `SUPABASE_URL`: URL project Supabase.
   - `SUPABASE_SECRET_KEY`: Secret key Supabase (jangan pernah gunakan atau unggah key ini di frontend/GitHub).
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `OWNER_USERNAME`, `OWNER_PASSWORD`: akun Admin dan Owner yang Anda tentukan.
3. Tunggu hingga layanan Render berstatus **Live**. Buka URL `https://...onrender.com/health`; hasilnya harus memuat `"database":"connected"`.
4. Di GitHub, buka **Settings → Pages**, ubah **Build and deployment → Source** menjadi **GitHub Actions**.
5. Di **Settings → Secrets and variables → Actions → Variables**, buat variable `TSTEP_API_URL` berisi URL backend Render, tanpa garis miring di akhir.
6. Unggah/push perubahan ini ke branch `main`. Workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) akan membangun ulang `frontend/config.js` dengan URL API dan menerbitkan frontend.
7. Pastikan workflow **Deploy T-Step Lab to GitHub Pages** berhasil. Muat ulang halaman GitHub Pages; label koneksi harus menunjukkan **Terhubung ke Supabase**.

Render blueprint membatasi CORS ke origin GitHub Pages proyek ini. Jangan menambahkan key Supabase atau password akun ke variable frontend, workflow, ataupun file yang dipublikasikan.

## Persiapan lokal

1. Pasang Node.js LTS pada komputer.
2. Buat atau pilih project di [Supabase](https://supabase.com/).
3. Buka **Supabase Dashboard → SQL Editor**, lalu jalankan seluruh isi [`backend/schema.sql`](backend/schema.sql).
4. Buat file lokal `backend/.env` dengan konfigurasi berikut:

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
   PORT=3000
   ```

   Gunakan **Secret key** Supabase (diawali `sb_secret_`) atau `service_role` key lama di backend. **Publishable key (`sb_publishable_`) tidak dapat menggantikan key backend ini.** Jangan gunakan Secret key di frontend, jangan menaruh nilainya di README, dan jangan commit file `.env`.

5. Jalankan aplikasi:
   - **Windows:** klik dua kali `Buka T-Step Lab.bat`.
   - **Terminal:** dari folder proyek, jalankan `node backend\app.js`.
6. Buka [http://localhost:3000](http://localhost:3000).

Backend juga mengenali variabel `SUPABASE_SERVICE_ROLE_KEY`. `SUPABASE_URL` wajib menunjuk ke project yang benar. `PORT` dapat dibiarkan menggunakan nilai bawaan `3000`.

## Akun aplikasi

Akun demo Admin dan Owner tersedia untuk menjalankan backend lokal. Saat `NODE_ENV=production`, backend tidak memakai akun demo: isi `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `OWNER_USERNAME`, dan `OWNER_PASSWORD` melalui environment hosting.

## Dokumentasi skema dan ERD

Skema PostgreSQL lengkap untuk tabel `customers`, `services`, `orders`, dan `payments`, termasuk constraint, indeks, serta fungsi RPC tersedia di:

- [SQL skema Supabase](backend/schema.sql)

**Catatan model:** detail beberapa pasang sepatu dan sebagian metadata pengantaran saat ini disimpan dalam metadata terenkode di `orders.notes`, bukan sebagai tabel `order_items` terpisah. Karena itu, ERD menggambarkan relasi tabel yang benar-benar ada di database, bukan struktur internal payload tersebut.

## Keamanan sebelum publikasi

- Pastikan `backend/.env` dan file konfigurasi lokal tidak masuk ke commit.
- Jangan menaruh Supabase Secret/service-role key di frontend, README, screenshot, atau riwayat commit.
- Publishable key memang boleh digunakan pada client dengan kebijakan RLS yang sesuai, tetapi aplikasi ini menjalankan akses data melalui backend dan karena itu memerlukan Secret/service-role key yang hanya disimpan di server.
- Jika Secret/service-role key pernah terunggah atau terbagi, segera rotasi di Supabase dan perbarui secret pada Render serta `backend/.env` lokal.
- Ganti akun demo yang didefinisikan di backend sebelum publikasi atau deployment. Untuk produksi, gunakan autentikasi yang sesuai, penyimpanan password yang di-hash, HTTPS, dan pengelolaan secret di lingkungan server.
- RLS aktif pada tabel Supabase. Aplikasi mengakses basis data melalui backend; jangan memberikan akses key server kepada browser.

## Pengembangan

Frontend disajikan langsung oleh server Node.js dari folder `frontend`. Perubahan antarmuka dapat diuji dengan memuat ulang browser. Perubahan backend memerlukan server dimulai ulang. Pemeriksaan sintaks JavaScript dapat dijalankan dengan:

```text
node --check frontend\app.js
node --check backend\app.js
```
