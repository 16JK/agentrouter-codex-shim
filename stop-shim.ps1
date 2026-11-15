Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'agentrouter-shim\.mjs|launch\.mjs' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    "stopped PID $($_.ProcessId)"
  }
"shim stopped."
