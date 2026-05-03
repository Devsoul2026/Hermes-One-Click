; Hermes One-Click — Full installer from scripts/Build-Staging.ps1 output (_staging\Hermes).
; Compile from repo root or packaging\windows; staging path is relative to this .iss file.

#define MyAppName "Hermes One-Click"
#define MyAppVersion "0.1.0-dev"
#define MyAppPublisher "Devsoul"

[Setup]
AppId={{A8C4E2B1-4F3D-5E6A-9B0C-1D2E3F4A5B6C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}
SetupIconFile=launcher-native\app.ico
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\_dist
OutputBaseFilename=HermesOneClickSetup-Devsoul-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Icons]
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click"; Filename: "{app}\HermesWebUI.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click Server"; Filename: "{app}\launcher\HermesWebUI.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click (Edge fallback)"; Filename: "{app}\launcher\HermesWebUIWindow.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click Dashboard"; Filename: "{app}\launcher\HermesDashboard.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\HermesWebUI.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Files]
Source: "..\..\_staging\Hermes\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
