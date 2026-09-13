@echo off
setlocal
chcp 65001 >nul

rem ============================================================
rem  KasirOne - ganti sandi akun admin
rem
rem  Klik dua kali berkas ini, lalu ketik sandi barunya saat
rem  diminta. Sandinya diketik di jendela ini saja: tidak masuk
rem  riwayat perintah, dan tidak perlu ditulis di mana pun.
rem ============================================================

cd /d "%~dp0"

set "AKUN=zainaril13@gmail.com"

echo.
echo ============================================================
echo   Ganti sandi - %AKUN%
echo ============================================================
echo.
echo   Sandi minimal 6 karakter (aturan Firebase).
echo.
echo   Saran: hindari sandi yang gampang ditebak seperti
echo   "admin321". Aplikasi ini sudah bisa dibuka siapa saja di
echo   internet, dan akun ini melihat harga modal serta seluruh
echo   omzet toko.
echo.

set "SANDI="
set /p "SANDI=  Sandi baru: "

if "%SANDI%"=="" (
  echo.
  echo   [X] Dibatalkan - sandi kosong.
  goto selesai
)

echo.
echo   Menyimpan...
echo.

node -e "import('./server/services/firebase.js').then(async m=>{ if(!m.initFirebase()){console.error('  [X] Firebase Admin gagal dimuat. Cek .env dan serviceAccountKey.json.');process.exit(1);} const u=await m.getAuth().getUserByEmail(process.argv[1]); await m.getAuth().updateUser(u.uid,{password:process.argv[2]}); console.log('  [OK] Sandi diganti untuk',u.email); }).catch(e=>{ console.error('  [X] Gagal:', e.message); process.exit(1); })" "%AKUN%" "%SANDI%"

if errorlevel 1 (
  echo.
  echo   Sandi TIDAK jadi diganti. Salin pesan di atas lalu tempel ke chat.
  goto selesai
)

echo.
echo ============================================================
echo   Sekarang bisa login di https://kasirone.vercel.app
echo.
echo   Email : %AKUN%
echo   Sandi : yang barusan kamu ketik
echo ============================================================

:selesai
rem Sandi dibuang dari memori jendela ini begitu selesai dipakai.
set "SANDI="
echo.
echo   Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
endlocal
