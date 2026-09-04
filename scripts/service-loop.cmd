@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem  service-loop.cmd — keeps the ValuationPro local service alive.
rem
rem  WHY THIS EXISTS. The scheduler that sends the 12:05 WIB digest, refreshes
rem  prices and writes the pick journal only runs while `npm run auto` is
rem  running. On 2026-09-01 and 09-02 the midday alert never fired for exactly
rem  that reason: nobody had started the service before noon. The job state file
rem  showed `post-sesi-1` stuck on 2026-08-31 while everything else was current,
rem  which is what a missed WINDOW looks like — not a failure, an absence.
rem
rem  Registered as a logon task; see scripts/valuationpro-task.xml.
rem
rem  THREE THINGS THIS DOES THAT A BARE `npm run auto` DOES NOT:
rem
rem  1. REFUSES TO START A SECOND COPY. Vite's dev server starts its own backend
rem     on 8787 when you run `npm run dev`. Two schedulers on one machine would
rem     both fire the digest, and the owner would get every alert twice. If
rem     anything already answers on 8787 this exits quietly and lets it own the
rem     port — the same probe vite's auto-backend plugin does.
rem  2. RESTARTS ON CRASH, with a delay that ACTUALLY DELAYS. A service that
rem     dies at 03:00 and stays dead is a missed 12:05 alert nobody finds out
rem     about until they check. See the note at the bottom on why the delay has
rem     to be `ping` and not `timeout`.
rem  3. LOGS, ke DUA berkas. .data\service.log memuat keluaran layanan itu
rem     sendiri; .data\service-events.log memuat baris siklus hidup singkat.
rem     Alasannya ada di komentar SET di bawah - berkas pertama terkunci selama
rem     layanan jalan, jadi bukti bahwa penjaga bekerja harus mendarat di
rem     berkas kedua.
rem ===========================================================================

set "ROOT=%~dp0.."
cd /d "%ROOT%" || exit /b 1

if not exist ".data" mkdir ".data"

rem  DUA LOG, dan pemisahannya bukan gaya-gayaan.
rem
rem  service.log dipegang TERBUKA oleh redirect `>>` selama npm run auto jalan.
rem  Ketika instance kedua mencoba menulis ke berkas yang sama, Windows menolak
rem  dan cmd MENELAN errornya: exit 0, nol byte tertulis, tanpa pesan apa pun.
rem  Diukur 2026-09-02: task dipicu manual, LastTaskResult 0, penjaga port
rem  bekerja dengan benar - dan lognya tetap 933 byte, jadi tidak ada satu pun
rem  jejak bahwa task itu pernah jalan.
rem
rem  Jadi baris siklus hidup pindah ke berkas sendiri yang tidak pernah dipegang
rem  lama. Log yang hilang persis di saat kita butuh buktinya adalah log yang
rem  lebih buruk daripada tidak ada log.
set "LOG=%ROOT%\.data\service.log"
set "EVT=%ROOT%\.data\service-events.log"

rem --- do not compete with a service that is already up ---------------------
rem PowerShell rather than netstat: netstat's output is localised, so parsing it
rem breaks on a non-English Windows. A TCP connect either succeeds or it does not.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8787); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] 8787 sudah dijawab proses lain - tidak menjalankan salinan kedua.>> "%EVT%"
  exit /b 0
)

set /a ATTEMPT=0
:loop
set /a ATTEMPT+=1
echo [%date% %time%] start percobaan !ATTEMPT!>> "%EVT%"
echo.>> "%LOG%"
echo ========== [%date% %time%] start percobaan !ATTEMPT! ==========>> "%LOG%"
call npm run auto >> "%LOG%" 2>&1
echo [%date% %time%] layanan berhenti dengan kode %errorlevel%>> "%EVT%"

rem A service that exits instantly, over and over, is broken rather than unlucky.
rem Backing off keeps a bad build from writing a gigabyte of log overnight.
if !ATTEMPT! GEQ 20 (
  echo [%date% %time%] BERHENTI - 20 kali gagal berturut-turut. Perbaiki dulu, lalu jalankan ulang task-nya.>> "%EVT%"
  exit /b 1
)

rem  PING, BUKAN TIMEOUT, DAN ITU BUKAN SELERA.
rem
rem  `timeout` menuntut handle konsol. Berkas ini diluncurkan VBS dengan gaya
rem  jendela 0 - tanpa konsol sama sekali - jadi timeout langsung pulang dengan
rem  kode 125 tanpa menunggu apa pun. Jeda 30 detik di baris ini TIDAK PERNAH
rem  terjadi sejak berkas ini ditulis, dan komentarnya menjanjikan sesuatu yang
rem  tidak pernah ada.
rem
rem  Akibatnya terukur pada 2026-09-04: layanan jatuh pukul 09:15:49, dua puluh
rem  percobaan habis dalam 0,8 DETIK, dan loop menyerah pukul 09:15:50. Layanan
rem  mati sampai 22:20 - seluruh jam bursa - tanpa satu pun refresh intraday.
rem
rem  Diukur di jendela tanpa konsol yang sama:
rem     timeout /t 4  -> pulang 0,18 detik, kode 125
rem     ping -n 5     -> pulang 4,08 detik, benar
rem
rem  `ping -n N` menunggu N-1 detik dan tidak butuh konsol.
ping -n 31 127.0.0.1 >nul
goto loop
