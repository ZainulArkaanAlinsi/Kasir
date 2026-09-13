@echo off
setlocal
chcp 65001 >nul

rem ============================================================
rem  KasirOne - ganti sandi akun admin
rem
rem  Klik dua kali berkas ini, lalu ketik sandi barunya saat
rem  diminta. Ketikannya tidak akan terlihat di layar.
rem
rem  Berkas ini sengaja tidak menangani sandinya sendiri. Command
rem  Prompt memperlakukan sebagian tanda baca sebagai perintah,
rem  jadi sandi yang mengandungnya akan rusak sebelum sampai ke
rem  Firebase. Seluruh urusan sandi diserahkan ke skrip Node yang
rem  membacanya langsung dari ketikan.
rem ============================================================

cd /d "%~dp0"

node scripts\ganti-sandi.js
if errorlevel 1 (
  echo.
  echo   Sandi TIDAK jadi diganti. Salin pesan di atas lalu tempel ke chat.
)

echo.
echo   Tekan tombol apa saja untuk menutup jendela ini.
pause >nul
endlocal
