' ===========================================================================
'  service-supervisor.vbs -- lapisan penjaga di atas service-loop.cmd.
'
'  KENAPA ADA. service-loop.cmd hanya menghidupkan ulang kalau `npm run auto`
'  KELUAR sendiri. Kalau seluruh pohon prosesnya dibunuh -- Ctrl+C di konsol,
'  jendela ditutup, atau End Task -- loop-nya ikut mati dan tidak ada yang
'  tersisa untuk menyalakannya lagi sampai login berikutnya.
'
'  Itu bukan skenario karangan. Diukur 2026-09-02: service.log berakhir dengan
'  ^C pada 17:54, sebelas menit setelah start 17:43, dan sesudah itu tidak ada
'  yang jalan. job-state menunjukkan post-sesi-1 tertinggal di 2026-08-31 dan
'  weekly di 2026-08-29. Jendela yang terlewat tidak pernah kembali sendiri.
'
'  CARA KERJA. Proses ini dijalankan WScript TANPA jendela konsol, jadi tidak
'  ada tempat Ctrl+C bisa mendarat. Tiap 60 detik ia bertanya ke WMI apakah
'  masih ada cmd.exe yang menjalankan service-loop.cmd. Kalau tidak ada, ia
'  menyalakannya lagi -- juga tanpa jendela.
'
'  KENAPA MEMERIKSA PROSES, BUKAN PORT 8787. Kalau yang diperiksa cuma port,
'  ada celah 30 detik: saat npm crash, loop di dalam cmd sedang menunggu
'  sebelum mencoba lagi, dan port memang mati. Supervisor akan mengira tidak
'  ada penjaga lalu menyalakan cmd KEDUA. Dua penjadwal di satu mesin berarti
'  tiap alert terkirim dua kali. Memeriksa keberadaan loop-nya menutup celah
'  itu: selama loop hidup, dia yang berhak menghidupkan ulang, bukan kita.
'  service-loop.cmd tetap punya penjaga port sendiri sebagai lapis kedua.
'
'  TIDAK menghapus berkas apa pun. TIDAK menyentuh registry. TIDAK butuh admin.
'  Mematikan fitur ini: hapus pintasannya dari folder Startup.
' ===========================================================================

Const ROOT = "C:\Users\MIchael ROG\OneDrive - Bina Nusantara\Documents\liviee\ValuationPro"
Const CHECK_EVERY_SEC = 60

' Jeda sebelum periksa pertama. Saat login, Windows masih sibuk dan npm butuh
' waktu untuk mengikat port; memeriksa terlalu cepat cuma menghasilkan
' peluncuran kedua yang langsung keluar lagi.
Const FIRST_DELAY_SEC = 45

' Batas peluncuran ulang per jam. Kalau layanan mati sepuluh kali dalam satu
' jam, ia rusak, bukan sedang sial -- dan supervisor yang terus mencoba hanya
' menulis log berukuran gigabyte semalaman tanpa memperbaiki apa pun.
Const MAX_STARTS_PER_HOUR = 10

Dim cmdPath, evtPath, sh, fso, starts, windowStart
cmdPath = ROOT & "\scripts\service-loop.cmd"
evtPath = ROOT & "\.data\service-events.log"

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(cmdPath) Then
  Log "supervisor BERHENTI - tidak menemukan " & cmdPath
  WScript.Quit 1
End If

' Satu supervisor saja. Logout lalu login lagi akan menjalankan berkas Startup
' sekali lagi, dan dua supervisor yang sama-sama melihat loop mati akan
' menyalakan dua cmd sekaligus. Penjaga port di dalam cmd memang membuat yang
' kedua keluar diam-diam, tapi mengandalkan lapisan itu untuk sesuatu yang bisa
' dicegah di sini adalah cara menumpuk proses tanpa sadar.
If SupervisorAlreadyRunning() Then
  Log "supervisor lain sudah jalan - berhenti tanpa melakukan apa-apa"
  WScript.Quit 0
End If

starts = 0
windowStart = Now
Log "supervisor jalan (periksa tiap " & CHECK_EVERY_SEC & " detik)"

WScript.Sleep FIRST_DELAY_SEC * 1000

Do
  If DateDiff("n", windowStart, Now) >= 60 Then
    starts = 0
    windowStart = Now
  End If

  If Not LoopIsRunning() Then
    If starts >= MAX_STARTS_PER_HOUR Then
      Log "supervisor DIAM - sudah " & starts & " kali menyalakan dalam sejam. Perbaiki dulu layanannya."
    Else
      starts = starts + 1
      Log "penjaga tidak ditemukan - menyalakan service-loop.cmd (ke-" & starts & " jam ini)"
      sh.Run """" & cmdPath & """", 0, False
    End If
  End If

  WScript.Sleep CHECK_EVERY_SEC * 1000
Loop

' --- apakah sudah ada supervisor lain? ----------------------------------------
' Menghitung wscript.exe yang menjalankan berkas INI. Diri sendiri selalu ikut
' terhitung, jadi ambang-nya lebih dari satu. Kalau WMI tidak menjawab,
' jawabannya False -- lebih baik dua supervisor (yang tidak berbahaya, karena
' keduanya tetap memeriksa sebelum menyalakan) daripada nol.
Function SupervisorAlreadyRunning()
  Dim wmi, procs, p, n
  SupervisorAlreadyRunning = False
  On Error Resume Next
  Err.Clear
  Set wmi = GetObject("winmgmts:root\cimv2")
  If Err.Number <> 0 Then Exit Function
  Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'wscript.exe' OR Name = 'cscript.exe'")
  If Err.Number <> 0 Then Exit Function
  On Error GoTo 0

  n = 0
  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, "service-supervisor.vbs", vbTextCompare) > 0 Then n = n + 1
    End If
  Next
  SupervisorAlreadyRunning = (n > 1)
End Function

' --- apakah masih ada cmd.exe yang menjalankan service-loop.cmd? -------------
' Kueri WMI dibungkus On Error: kalau WMI sedang tidak menjawab, jawaban yang
' aman adalah "masih jalan". Salah tebak ke arah itu berarti satu siklus
' terlewat; salah tebak ke arah sebaliknya berarti dua penjadwal hidup.
Function LoopIsRunning()
  Dim wmi, procs, p
  LoopIsRunning = True
  On Error Resume Next
  Err.Clear

  ' Moniker PENDEK, dan itu disengaja. Bentuk panjang dengan "\.\" di depan
  ' mudah rusak saat berkas ini dilewatkan alat lain: satu backslash hilang,
  ' monikernya jadi tidak sah, dan GetObject menjawab -2147217375 dengan
  ' Err.Description KOSONG. Karena fungsi ini menjawab True saat gagal,
  ' supervisor akan diam selamanya sambil log-nya terlihat sehat. Persis itu
  ' yang terjadi 2026-09-02, sebelum berkas ini sempat dipasang.
  Set wmi = GetObject("winmgmts:root\cimv2")
  If Err.Number <> 0 Then
    WmiTrouble "GetObject gagal (" & Err.Number & ")"
    Exit Function
  End If

  Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'cmd.exe'")
  If Err.Number <> 0 Then
    WmiTrouble "ExecQuery gagal (" & Err.Number & ")"
    Exit Function
  End If
  On Error GoTo 0

  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, "service-loop.cmd", vbTextCompare) > 0 Then
        LoopIsRunning = True
        Exit Function
      End If
    End If
  Next
  LoopIsRunning = False
End Function

' --- catat kegagalan WMI, tapi jangan membanjiri log ---------------------------
' Kalau WMI mati, fungsi di atas menjawab "masih jalan" supaya tidak ada
' penjadwal kedua yang lahir. Konsekuensinya supervisor jadi pasif -- dan itu
' HARUS terlihat, bukan diam. Sekali per jam cukup untuk ketahuan tanpa
' menulis 1.440 baris sehari.
Dim lastWmiLog
Sub WmiTrouble(msg)
  If IsEmpty(lastWmiLog) Then lastWmiLog = DateAdd("h", -2, Now)
  If DateDiff("n", lastWmiLog, Now) >= 60 Then
    lastWmiLog = Now
    Log "WMI tidak bisa ditanya - supervisor menganggap penjaga masih hidup dan TIDAK menyalakan apa pun. " & msg
  End If
End Sub

' --- log baris siklus hidup --------------------------------------------------
' Menulis ke service-events.log, BUKAN service.log. Berkas kedua itu dipegang
' terbuka oleh redirect ">>" selama layanan jalan, dan penulis kedua ke berkas
' yang sedang terkunci gagal DIAM-DIAM: exit 0, nol byte, tanpa pesan.
Sub Log(msg)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(evtPath, 8, True)
  If Err.Number = 0 Then
    f.WriteLine "[" & Now & "] " & msg
    f.Close
  End If
  On Error GoTo 0
End Sub
