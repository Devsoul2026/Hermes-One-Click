using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HermesWebUI;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new HermesWindow());
    }
}

internal sealed class HermesWindow : Form
{
    private const int RecentLogBufferSize = 400;

    private readonly WebView2 _webView = new();
    private readonly Label _statusLabel = new();
    private readonly ConcurrentQueue<string> _recentLogs = new();
    private Process? _serverProcess;
    private string _rootDir = "";
    private int _port = 8787;
    private StreamWriter? _logWriter;
    private readonly object _logLock = new();

    public HermesWindow()
    {
        Text = "Hermes One-Click";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? Icon;
        MinimumSize = new Size(1120, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(15, 23, 42);

        _statusLabel.Dock = DockStyle.Fill;
        _statusLabel.ForeColor = Color.FromArgb(226, 232, 240);
        _statusLabel.Font = new Font("Segoe UI", 11f, FontStyle.Regular);
        _statusLabel.TextAlign = ContentAlignment.MiddleCenter;
        _statusLabel.Text = "Starting Hermes One-Click...";
        Controls.Add(_statusLabel);

        _webView.Dock = DockStyle.Fill;
        _webView.Visible = false;
        Controls.Add(_webView);

        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, _) => StopServer();
    }

    private async Task StartAsync()
    {
        try
        {
            _rootDir = ResolveInstallRoot();
            _port = ResolvePort();
            SetStatus("Starting local Hermes One-Click server...");
            await EnsureServerAsync();

            SetStatus("Opening Hermes One-Click...");
            await InitializeWebViewAsync();
            _webView.Source = new Uri($"http://127.0.0.1:{_port}/");
            _webView.Visible = true;
            _statusLabel.Visible = false;
        }
        catch (Exception ex)
        {
            SetStatus("Hermes One-Click failed to start.\r\n\r\n" + ex.Message);
            MessageBox.Show(this, ex.Message, "Hermes One-Click startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static int ResolvePort()
    {
        var raw = Environment.GetEnvironmentVariable("HERMES_WEBUI_PORT");
        return int.TryParse(raw, out var port) && port > 0 ? port : 8787;
    }

    private string ResolveInstallRoot()
    {
        var dir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        for (var i = 0; i < 6; i++)
        {
            if (Directory.Exists(Path.Combine(dir, "app", "hermes-webui")) &&
                Directory.Exists(Path.Combine(dir, "app", "hermes-agent")))
            {
                return dir;
            }

            var parent = Directory.GetParent(dir);
            if (parent is null) break;
            dir = parent.FullName;
        }

            throw new DirectoryNotFoundException("Cannot find Hermes One-Click install root. Expected app\\hermes-webui and app\\hermes-agent near HermesWebUI.exe.");
    }

    private async Task EnsureServerAsync()
    {
        if (await IsPortOpenAsync()) return;

        var python = ResolvePythonPath();
        var webuiDir = Path.Combine(_rootDir, "app", "hermes-webui");
        var serverPy = Path.Combine(webuiDir, "server.py");

        if (!File.Exists(serverPy))
        {
            throw new FileNotFoundException("Hermes One-Click WebUI server.py is missing.", serverPy);
        }

        var envPath = string.Join(Path.PathSeparator, new[]
        {
            Path.Combine(_rootDir, "runtime", "python"),
            Path.Combine(_rootDir, "tools", "bin"),
            Path.Combine(_rootDir, "node"),
            Environment.GetEnvironmentVariable("PATH") ?? "",
        }.Where(p => !string.IsNullOrWhiteSpace(p)));

        OpenLogWriter();

        var startInfo = new ProcessStartInfo
        {
            FileName = python,
            Arguments = "-u server.py",
            WorkingDirectory = webuiDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        startInfo.Environment["PATH"] = envPath;
        startInfo.Environment["HERMES_WEBUI_NATIVE_FOLDER_PICKER"] = "1";
        startInfo.Environment["HERMES_WEBUI_AGENT_DIR"] = Path.Combine(_rootDir, "app", "hermes-agent");
        startInfo.Environment["HERMES_WEBUI_PYTHON"] = python;
        startInfo.Environment["HERMES_WEBUI_PORT"] = _port.ToString();
        startInfo.Environment["PYTHONUTF8"] = "1";
        startInfo.Environment["PYTHONIOENCODING"] = "utf-8";
        // Force unbuffered stdio so Python flushes lines promptly into the pipe
        // we drain in OnLogLine. Without this, embeddable Python may keep stdout
        // line-buffered which still works but is harder to debug.
        startInfo.Environment["PYTHONUNBUFFERED"] = "1";

        _serverProcess = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start Hermes One-Click WebUI server.");

        // Asynchronously drain stdout/stderr — if we don't, the OS pipe buffer
        // (~64KB on Windows) fills as the server prints per-request JSON logs and
        // the next print() call blocks the request handler thread, hanging every
        // subsequent API call. This is the root cause behind users reporting
        // gateway/log/init "无效" after the first few requests succeeded.
        _serverProcess.OutputDataReceived += (_, e) => OnLogLine(e.Data, isError: false);
        _serverProcess.ErrorDataReceived += (_, e) => OnLogLine(e.Data, isError: true);
        _serverProcess.BeginOutputReadLine();
        _serverProcess.BeginErrorReadLine();

        var deadline = DateTimeOffset.UtcNow.AddSeconds(120);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (_serverProcess.HasExited)
            {
                // Give the async readers a brief window to flush their buffers
                // before we read the recent-log snapshot for the error message.
                try { _serverProcess.WaitForExit(500); } catch { }
                var detail = string.Join("\r\n", _recentLogs).Trim();
                var suffix = string.IsNullOrWhiteSpace(detail) ? "" : "\r\n\r\n" + detail;
                throw new InvalidOperationException($"Hermes One-Click WebUI server exited early with code {_serverProcess.ExitCode}.{suffix}");
            }
            if (await IsPortOpenAsync())
            {
                // The local HTTP socket is accepting connections, so open the UI.
                // Frontend requests can continue to hydrate settings/gateway state
                // without making launcher startup depend on one specific API.
                await Task.Delay(300);
                return;
            }
            await Task.Delay(500);
        }

        var logPath = GetWebUiLogPath();
        var recent = string.Join("\r\n", _recentLogs).Trim();
        var timeoutDetail = string.IsNullOrWhiteSpace(recent)
            ? ""
            : "\r\n\r\nRecent WebUI log:\r\n" + recent;
        throw new TimeoutException(
            $"Hermes One-Click WebUI did not open port http://127.0.0.1:{_port}/ within 120 seconds.\r\n\r\n" +
            $"Log file: {logPath}" +
            timeoutDetail
        );
    }

    private void OpenLogWriter()
    {
        try
        {
            var logDir = Path.GetDirectoryName(GetWebUiLogPath())!;
            Directory.CreateDirectory(logDir);
            var path = GetWebUiLogPath();
            var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
            _logWriter = new StreamWriter(stream) { AutoFlush = true };
            _logWriter.WriteLine($"# Hermes One-Click launcher log {DateTimeOffset.Now:O}");
        }
        catch
        {
            // Logging to disk is best-effort; the in-memory ring buffer still
            // captures recent output for early-exit diagnostics.
            _logWriter = null;
        }
    }

    private static string GetWebUiLogPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Hermes",
            "logs",
            "webui.log"
        );
    }

    private void OnLogLine(string? data, bool isError)
    {
        if (data is null) return;
        var prefix = isError ? "[stderr] " : "";
        var line = prefix + data;

        _recentLogs.Enqueue(line);
        while (_recentLogs.Count > RecentLogBufferSize && _recentLogs.TryDequeue(out _)) { }

        if (_logWriter is null) return;
        try
        {
            lock (_logLock)
            {
                _logWriter.WriteLine(line);
            }
        }
        catch
        {
            // Disk full / file lock — never let logging failures kill the app.
        }
    }

    private string ResolvePythonPath()
    {
        var portable = Path.Combine(_rootDir, "runtime", "python", "python.exe");
        if (File.Exists(portable)) return portable;

        var bundled = Path.Combine(_rootDir, "runtime", "venv", "Scripts", "python.exe");
        if (File.Exists(bundled)) return bundled;

        // Development/staging fallback matching launcher\HermesWebUIWindow.cmd:
        // _staging\Hermes -> repo root -> hermes-agent\.venv.
        var dev = Path.GetFullPath(Path.Combine(_rootDir, "..", "..", "hermes-agent", ".venv", "Scripts", "python.exe"));
        if (File.Exists(dev)) return dev;

        throw new FileNotFoundException(
            "Python runtime is missing. Build staging with scripts\\Build-Staging.ps1, or create hermes-agent\\.venv for development testing.",
            bundled
        );
    }

    private async Task<bool> IsPortOpenAsync()
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, _port).WaitAsync(TimeSpan.FromMilliseconds(700));
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Hermes",
            "WebView2Profile"
        );
        Directory.CreateDirectory(userData);

        var fixedRuntime = FindFixedRuntimeFolder();
        var environment = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: fixedRuntime,
            userDataFolder: userData
        );

        await _webView.EnsureCoreWebView2Async(environment);
        var settings = _webView.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = true;
        settings.AreDevToolsEnabled = IsDebugEnabled();
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = true;

        _webView.CoreWebView2.ProcessFailed += (_, args) =>
        {
            SetStatus($"WebView2 process failed: {args.ProcessFailedKind}");
        };
    }

    private string? FindFixedRuntimeFolder()
    {
        var root = Path.Combine(_rootDir, "runtime", "webview2");
        if (!Directory.Exists(root))
        {
            // Development fallback: if staging was built without a Fixed Runtime,
            // pass null so WebView2 uses the system Evergreen runtime. Production
            // installers should still bundle runtime\webview2 for zero-dependency use.
            return null;
        }

        var exe = Directory.EnumerateFiles(root, "msedgewebview2.exe", SearchOption.AllDirectories).FirstOrDefault();
        if (exe is null)
        {
            return null;
        }

        return Path.GetDirectoryName(exe) ?? root;
    }

    private static bool IsDebugEnabled()
    {
        var raw = Environment.GetEnvironmentVariable("HERMES_WEBUI_DEBUG");
        return string.Equals(raw, "1", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    private void SetStatus(string text)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => SetStatus(text)));
            return;
        }
        _statusLabel.Text = text;
    }

    private void StopServer()
    {
        try
        {
            if (_serverProcess is { HasExited: false })
            {
                _serverProcess.Kill(entireProcessTree: true);
                _serverProcess.Dispose();
            }
        }
        catch
        {
            // Shutdown should never block window close.
        }
        finally
        {
            try
            {
                lock (_logLock)
                {
                    _logWriter?.Dispose();
                    _logWriter = null;
                }
            }
            catch { }
        }
    }
}
