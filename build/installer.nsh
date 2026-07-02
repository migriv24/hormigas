; Custom NSIS script — runs before installation to kill any running Hormiga processes.
; This prevents "Hormiga cannot be closed" dialogs when upgrading.

!macro preInit
  ; Force-kill the server and Electron shell before files are replaced
  nsExec::Exec 'taskkill /F /IM hormiga-server.exe /T'
  nsExec::Exec 'taskkill /F /IM Hormiga.exe /T'
  Sleep 1000
!macroend

!macro customInstall
  ; Nothing extra needed on install
!macroend

!macro customUnInstall
  ; Force-kill on uninstall too
  nsExec::Exec 'taskkill /F /IM hormiga-server.exe /T'
  nsExec::Exec 'taskkill /F /IM Hormiga.exe /T'
  Sleep 500
!macroend
