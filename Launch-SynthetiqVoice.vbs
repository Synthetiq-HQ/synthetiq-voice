Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Run """" & root & "\Start-SynthetiqVoice.cmd" & """", 0, False
