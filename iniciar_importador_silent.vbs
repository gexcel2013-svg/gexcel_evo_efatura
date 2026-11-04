' [AG 2026-10-06 16:21] Gexcel EVO - Importador e-Fatura Launcher Silencioso
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
motorDir = fso.GetAbsolutePathName(appDir & "\..\EVO-05_API_Efatura")
pbDir = fso.GetAbsolutePathName(appDir & "\..\EVO-02_Core_BD")
WshShell.CurrentDirectory = appDir

' 1. Iniciar PocketBase Core (Porta 8090) se a pasta existir e nao estiver ativo
If fso.FolderExists(pbDir) Then
    If Not IsPortListening(8090) Then
        cmdPb = "%COMSPEC% /c cd /d """ & pbDir & """ && pocketbase.exe serve --http=127.0.0.1:8090"
        WshShell.Run cmdPb, 0, False
        WScript.Sleep 800
    End If
End If

' 2. Iniciar Motor API e-Fatura (Porta 8015) se nao estiver ativo
If Not IsPortListening(8015) Then
    motorExe = motorDir & "\dist\gevo_efatura_api.exe"
    If fso.FileExists(motorExe) Then
        cmdMotor = """" & motorExe & """"
    Else
        pyExe = motorDir & "\venv\Scripts\pythonw.exe"
        If Not fso.FileExists(pyExe) Then
            pyExe = motorDir & "\.venv\Scripts\pythonw.exe"
        End If
        If Not fso.FileExists(pyExe) Then
            pyExe = "pythonw.exe"
        End If
        cmdMotor = """" & pyExe & """ """ & motorDir & "\run.py"""
    End If
    WshShell.Run cmdMotor, 0, False
    WScript.Sleep 1200
End If

' 3. Iniciar Frontend Vite (Porta 5173) se nao estiver ativo
If Not IsPortListening(5173) Then
    cmdVite = "%COMSPEC% /c npm run dev"
    WshShell.Run cmdVite, 0, False
    WScript.Sleep 1500
End If

' Aguardar prontidão da porta 5173 (até 10 segundos)
For i = 1 To 20
    If IsPortListening(5173) Then Exit For
    WScript.Sleep 500
Next

' 4. Abrir a aplicação em janela dedicada no Chrome ou browser do sistema
chromeExe = ""
chromePaths = Array( _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
    WshShell.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe") _
)

For Each p In chromePaths
    If fso.FileExists(p) Then
        chromeExe = p
        Exit For
    End If
Next

appUrl = "http://localhost:5173"
If chromeExe <> "" Then
    WshShell.Run """" & chromeExe & """ --app=" & appUrl, 1, False
Else
    WshShell.Run appUrl, 1, False
End If

Function IsPortListening(port)
    Dim cmd, res
    cmd = "%COMSPEC% /c netstat -ano | findstr /C:""" & ":" & port & " "" | findstr LISTENING >nul"
    res = WshShell.Run(cmd, 0, True)
    IsPortListening = (res = 0)
End Function
