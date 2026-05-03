# Hermes One-Click WebView2 Native Launcher

This project builds `HermesWebUI.exe`, the native Windows launcher for Hermes One-Click that:

- starts the bundled Python WebUI server from `runtime\venv`;
- loads `http://127.0.0.1:8787/` inside WebView2;
- uses the bundled Fixed Version Runtime from `runtime\webview2`;
- terminates the server process tree when the window closes.

Build through the staging script:

```powershell
pwsh scripts\Build-Staging.ps1 -WebView2FixedRuntimePath C:\vendor\Microsoft.WebView2.FixedRuntime.x64
```

Requirements on the build machine:

- .NET 8 SDK
- WebView2 Fixed Version Runtime package, decompressed directory, `.zip`, or `.cab`

The installed user machine does not need .NET, Python, Edge, or WebView2 installed separately when staging is built with the Fixed Runtime path.
