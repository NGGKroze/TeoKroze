; Inno Setup 6 - инсталатор на Logistics Packing Solution (на български, без администраторски права)
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\app"
#endif

[Setup]
AppId={{6F1B2C84-5D0E-4B7A-9C3A-2E7F4A9D1B10}
AppName=Logistics Packing Solution
AppVersion={#AppVersion}
AppPublisher=TeoKroze
DefaultDirName={autopf}\Logistics Packing Solution
DefaultGroupName=Logistics Packing Solution
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=LogisticsPacking-Setup-{#AppVersion}
SetupIconFile=..\src\LogisticsPacking.App\Assets\app.ico
UninstallDisplayIcon={app}\LogisticsPacking.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=LogisticsPacking.exe
RestartApplications=no
UsePreviousAppDir=yes

[Languages]
Name: "bulgarian"; MessagesFile: "compiler:Languages\Bulgarian.isl"

[Tasks]
Name: "desktopicon"; Description: "Икона на работния плот"; GroupDescription: "Допълнителни икони:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; По желание: офлайн инсталатор на WebView2 Runtime (сложете го в installer\redist\)
#ifexist "redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
Source: "redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2
#endif

[InstallDelete]
; Нова версия = чиста замяна: старите модули, Python и ресурси се трият преди копирането,
; за да не остават файлове от предишни версии. Данните на потребителя (%LOCALAPPDATA%\LogisticsPacking,
; Документи\Logistics Packing) не се пипат.
Type: filesandordirs; Name: "{app}\modules"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\Assets"

[Icons]
Name: "{group}\Logistics Packing Solution"; Filename: "{app}\LogisticsPacking.exe"
Name: "{autodesktop}\Logistics Packing Solution"; Filename: "{app}\LogisticsPacking.exe"; Tasks: desktopicon

[Run]
#ifexist "redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "Инсталира се Microsoft Edge WebView2 Runtime…"; Check: NeedsWebView2; Flags: waituntilterminated
#endif
Filename: "{app}\LogisticsPacking.exe"; Description: "Стартирай Logistics Packing Solution"; Flags: nowait postinstall skipifsilent

[Code]
function WebView2Installed(): Boolean;
var v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  if Result then Result := (v <> '') and (v <> '0.0.0.0');
end;

function NeedsWebView2(): Boolean;
begin
  Result := not WebView2Installed();
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (not WebView2Installed()) then
    MsgBox('Не е намерен Microsoft Edge WebView2 Runtime. Програмата се нуждае от него, за да показва клиентските екрани. ' +
           'Инсталирайте го от Microsoft (търсете "WebView2 Runtime") или сложете офлайн инсталатора в installer\redist и компилирайте наново.',
           mbInformation, MB_OK);
end;

[UninstallDelete]
; Данните и резултатите на потребителя (%LOCALAPPDATA%\LogisticsPacking, Документи) се запазват.
Type: filesandordirs; Name: "{app}"
