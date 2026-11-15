@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\agentrouter-shim.vbs" 2>nul
echo Autostart removed (if it said file not found, nothing was installed).
pause
