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
rem  2. RESTARTS ON CRASH, with a delay. A service that dies at 03:00 and stays
rem     dead is a missed 12:05 alert nobody finds out about until they check.
rem  3. LOGS. Output goes to .data\service.log so a crash loop leaves evidence
rem     instead of a silent absence.
rem ===========================================================================

set "ROOT=%~dp0.."
cd /d "%ROOT%" || exit /b 1

if not exist ".data" mkdir ".data"
set "LOG=%ROOT%\.data\service.log"

rem --- do not compete with a service that is already up ---------------------
rem PowerShell rather than netstat: netstat's output is localised, so parsing it
rem breaks on a non-English Windows. A TCP connect either succeeds or it does not.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8787); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] 8787 sudah dijawab proses lain - tidak menjalankan salinan kedua.>> "%LOG%"
  exit /b 0
)

set /a ATTEMPT=0
:loop
set /a ATTEMPT+=1
echo.>> "%LOG%"
echo ========== [%date% %time%] start percobaan !ATTEMPT! ==========>> "%LOG%"
call npm run auto >> "%LOG%" 2>&1
echo [%date% %time%] layanan berhenti dengan kode %errorlevel%>> "%LOG%"

rem A service that exits instantly, over and over, is broken rather than unlucky.
rem Backing off keeps a bad build from writing a gigabyte of log overnight.
if !ATTEMPT! GEQ 20 (
  echo [%date% %time%] BERHENTI - 20 kali gagal berturut-turut. Perbaiki dulu, lalu jalankan ulang task-nya.>> "%LOG%"
  exit /b 1
)
timeout /t 30 /nobreak >nul
goto loop
