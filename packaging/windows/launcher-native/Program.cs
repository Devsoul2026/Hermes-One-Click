using System.Diagnostics;
using System.Net;
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
    private readonly WebView2 _webView = new();
    private readonly Label _statusLabel = new();
    private Process? _serverProcess;
    private string _rootDir = "";
    private int _port = 8787;

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
        if (await IsReadyAsync()) return;

        var python = ResolvePythonPath();
        var webuiDir = Path.Combine(_rootDir, "app", "hermes-webui");
        var serverPy = Path.Combine(webuiDir, "server.py");

        if (!File.Exists(serverPy))
        {
            throw new FileNotFoundException("Hermes One-Click WebUI server.py is missing.", serverPy);
        }

        var envPath = string.Join(Path.PathSeparator, new[]
        {
            Path.Combine(_rootDir, "tools", "bin"),
            Path.Combine(_rootDir, "node"),
            Environment.GetEnvironmentVariable("PATH") ?? "",
        }.Where(p => !string.IsNullOrWhiteSpace(p)));

        var startInfo = new ProcessStartInfo
        {
            FileName = python,
            Arguments = "server.py",
            WorkingDirectory = webuiDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        startInfo.Environment["PATH"] = envPath;
        startInfo.Environment["HERMES_WEBUI_NATIVE_FOLDER_PICKER"] = "1";
        startInfo.Environment["HERMES_WEBUI_AGENT_DIR"] = Path.Combine(_rootDir, "app", "hermes-agent");
        startInfo.Environment["HERMES_WEBUI_PYTHON"] = python;
        startInfo.Environment["HERMES_WEBUI_PORT"] = _port.ToString();
        startInfo.Environment["PYTHONUTF8"] = "1";
        startInfo.Environment["PYTHONIOENCODING"] = "utf-8";

        _serverProcess = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start Hermes One-Click WebUI server.");

        var deadline = DateTimeOffset.UtcNow.AddSeconds(45);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (_serverProcess.HasExited)
            {
                throw new InvalidOperationException($"Hermes One-Click WebUI server exited early with code {_serverProcess.ExitCode}.");
            }
            if (await IsReadyAsync()) return;
            await Task.Delay(500);
        }

        throw new TimeoutException($"Hermes One-Click WebUI did not become ready on http://127.0.0.1:{_port}/.");
    }

    private string ResolvePythonPath()
    {
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

    private async Task<bool> IsReadyAsync()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            using var res = await client.GetAsync($"http://127.0.0.1:{_port}/api/settings");
            return res.StatusCode == HttpStatusCode.OK;
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
    }
}
