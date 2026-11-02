# T-Step Lab

## Link aplikasi GitHub

Setelah perubahan ini di-push ke branch `main`, GitHub Actions akan menerbitkan halaman dari `index.html` secara otomatis:

**https://tiaramelanyy08-code.github.io/T-Step-Lab-App/**

Jika baru pertama kali mengaktifkan Pages, buka repository **Settings > Pages** dan pilih **GitHub Actions** sebagai sumber deploy.

## Menghubungkan API ke Supabase

GitHub Pages hanya meng-host tampilan aplikasi. API tetap berjalan di Render agar Secret key Supabase tidak disimpan atau dibagikan dari browser.

1. Repository ini sudah punya `render.yaml`. Di Render, pilih **New > Blueprint**, hubungkan repository GitHub ini, lalu deploy service `t-step-lab-api`.
2. Pada pengaturan service Render, isi `SUPABASE_SECRET_KEY` dengan Secret key dari project Supabase yang sama. Isi `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `OWNER_USERNAME`, dan `OWNER_PASSWORD` dengan akun login yang ingin dipakai.
3. Tunggu deploy Render selesai. Buka `https://t-step-lab-api.onrender.com/health`; pastikan hasilnya menunjukkan `"database":"connected"`.
4. Push perubahan ke branch `main` di GitHub. Setelah workflow **Deploy T-Step Lab to GitHub Pages** selesai, buka link aplikasi di atas.

URL Supabase sudah diatur di `render.yaml`. Jangan taruh `SUPABASE_SECRET_KEY` di `config.js`, `.env.example`, atau GitHub. Jika Render memberikan URL service yang berbeda, perbarui alamat API di `frontend/config.js`.
