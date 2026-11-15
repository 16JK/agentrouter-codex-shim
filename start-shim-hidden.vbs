' 静默启动 agentrouter-shim（无窗口），已在运行则不重复启动
Option Explicit
Dim sh, fso, nodeExe, script
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch.mjs")

If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
Else
  nodeExe = "node"
End If

sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & nodeExe & """ """ & script & """", 0, False
