' ASPHALTE Workshop - silent launcher (no console window).
' Double-click this file, or use the desktop shortcut it creates.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
home = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ASPHALTE_Workshop"
pyw = home & "\venv\Scripts\pythonw.exe"
state = home & "\setup_state.txt"
If fso.FileExists(pyw) And fso.FileExists(state) Then
  ' Already set up: start the server hidden. If it is already running, server.py just
  ' opens a window for the running instance and exits.
  sh.Run """" & pyw & """ """ & appDir & "\server.py""", 0, False
Else
  ' First run (or broken environment): run the visible setup in start.bat.
  sh.Run """" & appDir & "\start.bat""", 1, False
End If
