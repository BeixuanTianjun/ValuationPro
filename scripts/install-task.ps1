<#
    install-task.ps1 — mendaftarkan layanan lokal ValuationPro sebagai
    Scheduled Task, supaya penjadwal 12:05 dan 16:20 WIB tetap jalan meski
    laptop baru dinyalakan atau sedang tidur.

    JALANKAN DARI POWERSHELL YANG "RUN AS ADMINISTRATOR".

    ─────────────────────────────────────────────────────────────────────────
    APA YANG SKRIP INI SENTUH — dan apa yang TIDAK

    MENULIS  : satu Scheduled Task bernama "ValuationPro Layanan Lokal".
    MEMBACA  : keberadaan scripts/service-loop.cmd, dan daftar task.

    TIDAK menghapus berkas apa pun. Tidak ada Remove-Item, del, rm, format,
    atau -Force yang menimpa. Tidak menyentuh registry. Tidak mengubah
    ExecutionPolicy sistem. Tidak menyentuh berkas di luar folder proyek —
    dan di dalam folder proyek pun cuma DIBACA, tidak ditulis.

    KALAU TASK-NYA SUDAH ADA: skrip berhenti dan tidak mengubah apa pun.
    Dibuat begitu supaya menjalankan ulang skrip ini selalu aman. Untuk
    mengganti setelan task, hapus dulu lewat Task Scheduler (taskschd.msc),
    baru jalankan skrip ini lagi.

    MEMBATALKAN SEMUANYA:
      Unregister-ScheduledTask -TaskName "ValuationPro Layanan Lokal" -Confirm:$false
    ─────────────────────────────────────────────────────────────────────────
#>

$ErrorActionPreference = 'Stop'
$TaskName = 'ValuationPro Layanan Lokal'
$CmdPath  = 'C:\Users\MIchael ROG\OneDrive - Bina Nusantara\Documents\liviee\ValuationPro\scripts\service-loop.cmd'
$Root     = 'C:\Users\MIchael ROG\OneDrive - Bina Nusantara\Documents\liviee\ValuationPro'

function Say([string]$s) { Write-Host $s }
function Ok ([string]$s) { Write-Host ("  OK    " + $s) -ForegroundColor Green }
function Bad([string]$s) { Write-Host ("  GAGAL " + $s) -ForegroundColor Red }

Say ''
Say '=== Pasang Scheduled Task ValuationPro ==='
Say ''

# --- 1. harus admin -------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Bad 'PowerShell ini BUKAN Administrator.'
    Say ''
    Say '  Tutup jendela ini. Klik kanan ikon PowerShell,'
    Say '  pilih "Run as administrator", lalu jalankan lagi perintah yang sama.'
    Say ''
    Say '  Tidak ada yang diubah.'
    exit 1
}
Ok 'PowerShell berjalan sebagai Administrator.'

# --- 2. berkas yang mau dijalankan harus ada -------------------------------
if (-not (Test-Path -LiteralPath $CmdPath)) {
    Bad "Tidak menemukan: $CmdPath"
    Say '  Tidak ada yang diubah.'
    exit 1
}
Ok 'scripts\service-loop.cmd ditemukan.'

# --- 3. kalau task sudah ada, JANGAN diapa-apakan --------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Say ''
    Ok "Task `"$TaskName`" SUDAH ADA — tidak ada yang diubah."
    Say ''
    Say '  Kalau mau memasang ulang dengan setelan baru, hapus dulu task-nya'
    Say '  lewat Task Scheduler (taskschd.msc), baru jalankan skrip ini lagi.'
    exit 0
}
Ok 'Belum ada task dengan nama itu — aman untuk dibuat.'

# --- 4. rakit dan daftarkan ------------------------------------------------
try {
    $action = New-ScheduledTaskAction `
        -Execute 'C:\Windows\System32\cmd.exe' `
        -Argument ('/c "' + $CmdPath + '"') `
        -WorkingDirectory $Root

    # Dua pemicu: saat login, dan tiap hari 08:00 sebagai jaring pengaman
    # kalau laptop dibiarkan menyala berhari-hari tanpa login ulang.
    $trigLogon = New-ScheduledTaskTrigger -AtLogOn
    $trigDaily = New-ScheduledTaskTrigger -Daily -At '08:00'

    # WakeToRun inilah alasan skrip ini butuh admin: membangunkan laptop yang
    # tidur supaya jendela 12:05 WIB tidak terlewat.
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -WakeToRun `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    # Jalan sebagai user ini, hak biasa — bukan SYSTEM, bukan elevated.
    $principal = New-ScheduledTaskPrincipal `
        -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     @($trigLogon, $trigDaily) `
        -Settings    $settings `
        -Principal   $principal `
        -Description 'Menjalankan layanan lokal ValuationPro (npm run auto) supaya penjadwal 12:05 dan 16:20 WIB, refresh harga, dan jurnal pick tetap jalan. Dibuat oleh scripts/install-task.ps1.' | Out-Null

    Ok 'Task berhasil didaftarkan.'
}
catch {
    Bad ('Pendaftaran gagal: ' + $_.Exception.Message)
    Say ''
    Say '  Tidak ada berkas yang tersentuh. Sistem dalam keadaan seperti semula.'
    exit 1
}

# --- 5. buktikan ada, jangan cuma percaya ---------------------------------
$check = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $check) {
    Bad 'Aneh: pendaftaran mengaku sukses tapi task-nya tidak ketemu.'
    exit 1
}

Say ''
Say '--- Terpasang ---'
Say ("  Nama    : " + $check.TaskName)
Say ("  Status  : " + $check.State)
Say ("  Pemicu  : saat login, dan tiap hari 08:00")
Say ("  Jalan   : " + $check.Actions[0].Execute + ' ' + $check.Actions[0].Arguments)
Say ''
Say 'Layanan akan menyala sendiri. Kalau port 8787 sudah dipakai, dia keluar'
Say 'diam-diam supaya tidak ada dua penjadwal yang mengirim alert dobel.'
Say ''
Say ('Log layanan: ' + (Join-Path $Root '.data\service.log'))
Say ''
Say 'Membatalkan kapan saja:'
Say "  Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
Say ''
