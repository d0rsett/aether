!ifndef AETHER_INSTALLER_HOOKS
!define AETHER_INSTALLER_HOOKS

!macro NSIS_HOOK_POSTINSTALL
  ; The executable path stays the same on upgrades. Ask Explorer to reload its
  ; icon without deleting the user's icon cache or changing shortcut choices.
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x0005, w "$INSTDIR\${MAINBINARYNAME}.exe", p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!endif
