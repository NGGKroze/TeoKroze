' Creates a desktop shortcut "ASPHALTE Workshop" with the app icon.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = sh.SpecialFolders("Desktop")
Set lnk = sh.CreateShortcut(desktop & "\ASPHALTE Workshop.lnk")
lnk.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
lnk.Arguments = """" & appDir & "\ASPHALTE.vbs"""
lnk.WorkingDirectory = appDir
lnk.IconLocation = appDir & "\assets\asphalte.ico"
lnk.Description = "ASPHALTE Python + Tesseract Workshop"
lnk.Save
