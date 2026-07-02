# create_shortcut.ps1
# Run once to create (or re-create) the Desktop shortcut.
# Usage: right-click → Run with PowerShell
#        (or: powershell -ExecutionPolicy Bypass -File create_shortcut.ps1)

$ProjectDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonW     = "C:\Python314\pythonw.exe"
$LaunchScript = Join-Path $ProjectDir "launch.pyw"
$IconFile    = Join-Path $ProjectDir "static\favicon.ico"
$ShortcutPath = [System.IO.Path]::Combine(
    [Environment]::GetFolderPath("Desktop"),
    "Hormiga.lnk"
)

# Verify pythonw.exe exists
if (-not (Test-Path $PythonW)) {
    Write-Host "ERROR: pythonw.exe not found at $PythonW" -ForegroundColor Red
    Write-Host "Edit the `$PythonW variable in this script to point to your pythonw.exe."
    Read-Host "Press Enter to exit"
    exit 1
}

$WshShell  = New-Object -ComObject WScript.Shell
$Shortcut  = $WshShell.CreateShortcut($ShortcutPath)

$Shortcut.TargetPath      = $PythonW
$Shortcut.Arguments       = "`"$LaunchScript`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description     = "Hormiga - Latine Outreach Network"
$Shortcut.WindowStyle     = 7   # 7 = minimised (hides the brief pythonw flash)

# Use favicon.ico if it exists, otherwise leave blank (generic Python icon)
if (Test-Path $IconFile) {
    $Shortcut.IconLocation = "$IconFile,0"
}

$Shortcut.Save()

Write-Host "Shortcut created: $ShortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "To use: double-click 'Hormiga' on your Desktop."
Write-Host "  - If the server is not running, it will start Flask and open your browser."
Write-Host "  - If you double-click again while it is running, it just reopens the browser tab."
Write-Host ""
Read-Host "Press Enter to close"
