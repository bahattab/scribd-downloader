#ifndef AppVersion
  #define AppVersion "0.5.0"
#endif
[Setup]
AppId={{8AA82B60-04B9-4D7D-A605-BACBEFC40050}
AppName=Free Scribd Downloader
AppVersion={#AppVersion}
AppPublisher=bahattab
AppPublisherURL=https://github.com/bahattab/scribd-downloader
DefaultDirName={localappdata}\Programs\Free Scribd Downloader
DefaultGroupName=Free Scribd Downloader
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=Free-Scribd-Downloader-{#AppVersion}-Windows-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\FreeScribdDownloader.exe
CloseApplications=yes
SetupLogging=no
[Files]
Source: "..\dist\FreeScribdDownloader\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
[Icons]
Name: "{group}\Free Scribd Downloader"; Filename: "{app}\FreeScribdDownloader.exe"
Name: "{autodesktop}\Free Scribd Downloader"; Filename: "{app}\FreeScribdDownloader.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\FreeScribdDownloader.exe"; Description: "Launch Free Scribd Downloader"; Flags: nowait postinstall skipifsilent
