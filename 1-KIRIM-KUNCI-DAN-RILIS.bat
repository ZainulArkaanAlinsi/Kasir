@echo off
setlocal
chcp 65001 >nul

rem ============================================================
rem  KasirOne - kirim kunci Firebase ke Vercel, lalu rilis ulang
rem
rem  Klik dua kali berkas ini. Tidak perlu mengetik apa pun.
rem
rem  Kunci dibaca langsung dari serviceAccountKey.json di folder
rem  ini dan dikirim ke akun Vercel milikmu sendiri. Isinya tidak
rem  pernah ditampilkan di layar dan tidak disimpan ke mana pun.
rem ============================================================

rem Pindah ke folder tempat berkas ini berada, apa pun folder aktif
rem saat diklik. Ini yang membuat salah-folder tidak mungkin terjadi.
cd /d "%~dp0"

echo.
echo ============================================================
echo   KasirOne - penyiapan deploy
echo ============================================================
echo.
echo   Folder : %CD%
echo.

if not exist "serviceAccountKey.json" (
  echo   [X] serviceAccountKey.json tidak ketemu di folder ini.
  echo.
  echo       Berkas ini harus berada di folder yang sama dengan
  echo       package.json. Kalau kuncinya ada di tempat lain,
  echo       salin dulu ke sini.
  goto selesai
)

echo   [1/2] Mengirim kunci Firebase ke Vercel...
echo.
rem Sisi kanan pipa sudah dijalankan di proses cmd tersendiri, jadi "call"
rem tidak diperlukan di sana.
node -e "console.log(Buffer.from(require('fs').readFileSync('serviceAccountKey.json')).toString('base64'))" | vercel.cmd env add FIREBASE_SERVICE_ACCOUNT production --sensitive -y
if errorlevel 1 (
  echo.
  echo   [X] Gagal mengirim kunci.
  echo.
  echo       Kalau pesannya bilang variabelnya sudah ada, jalankan dulu:
  echo         vercel env rm FIREBASE_SERVICE_ACCOUNT production -y
  echo       lalu klik dua kali berkas ini lagi.
  goto selesai
)

echo.
echo   [2/2] Merilis ulang ke https://kasirone.vercel.app ...
echo.
call vercel deploy --prod --yes
if errorlevel 1 (
  echo.
  echo   [X] Rilis gagal. Salin pesan di atas lalu tempel ke chat.
  goto selesai
)

echo.
echo ============================================================
echo   SELESAI.
echo.
echo   Buka di HP : https://kasirone.vercel.app
echo   Login      : zainaril13@gmail.com
echo.
echo   Kalau sandinya belum diganti, klik dua kali berkas
echo   2-GANTI-SANDI.bat lebih dulu.
echo ============================================================

:selesai
echo.
echo   Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
endlocal
