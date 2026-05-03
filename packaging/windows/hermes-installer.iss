; Hermes One-Click — Inno Setup 6: minimal launcher-only installer (no Python/agent copy).
; For full bundle see hermes-installer-staging.iss after running scripts/Build-Staging.ps1.
#define MyAppName "Hermes One-Click"
#define MyAppVersion "0.1.0-dev"
#define MyAppPublisher "Hermes One-Click"

[Setup]
AppId={{A8C4E2B1-4F3D-5E6A-9B0C-1D2E3F4A5B6C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\_dist
OutputBaseFilename=HermesOneClickSetup-{#MyAppVersion}
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
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click"; Filename: "{app}\launcher\HermesWebUIWindow.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click Server"; Filename: "{app}\launcher\HermesWebUI.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Hermes One-Click Dashboard"; Filename: "{app}\launcher\HermesDashboard.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\launcher\HermesWebUIWindow.cmd"; Tasks: desktopicon

[Files]
Source: "launcher\*"; DestDir: "{app}\launcher"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}\share\packaging-windows"; Flags: ignoreversion

[Run]
; Optional: WebView2 bootstrap when launcher exe is ready
