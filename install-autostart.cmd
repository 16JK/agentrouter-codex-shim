@echo off
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /Y "%~dp0start-shim-hidden.vbs" "%STARTUP%\agentrouter-shim.vbs" >nul
if errorlevel 1 (
  echo FAILED: check permissions.
) else (
  echo OK: autostart installed to "%STARTUP%\agentrouter-shim.vbs"
  echo Run uninstall-autostart.cmd to remove it.
)
pause
