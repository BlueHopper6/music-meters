; Shown by the assisted installer. FFmpeg remains a separately supplied tool.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install MusicMeters"
  !define MUI_WELCOMEPAGE_TEXT "MusicMeters creates music visualization videos on this computer.$\r$\n$\r$\nInstall FFmpeg and FFprobe separately and add both to PATH before using MusicMeters.$\r$\n$\r$\nSetup installs for your Windows account and adds MusicMeters to the Start menu. Existing projects, templates, and preferences are preserved."
  !insertmacro MUI_PAGE_WELCOME
!macroend
