using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace LogisticsPacking.Core;

public sealed class SidecarException : Exception
{
    public string? LogPath { get; }
    public SidecarException(string message, string? logPath = null) : base(message) => LogPath = logPath;
}

public sealed class SidecarHandle
{
    public required string ModuleId { get; init; }
    public required Uri BaseUri { get; init; }
    public required string LogPath { get; init; }
    internal Process Process { get; init; } = null!;
    public bool IsRunning => !Process.HasExited;
}

/// <summary>Стартира и спира Python модулите (по един процес на модул, на 127.0.0.1).</summary>
public sealed class SidecarManager : IDisposable
{
    private readonly AppPaths _paths;
    private readonly Dictionary<string, SidecarHandle> _running = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JobObject? _job = JobObject.TryCreate();
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };

    public SidecarManager(AppPaths paths) => _paths = paths;

    /// <summary>Допълнителни променливи на средата за всички Python процеси (напр. TEOKROZE_OUTPUT_DIR).</summary>
    public Dictionary<string, string> ExtraEnvironment { get; } = new();

    public async Task<SidecarHandle> StartAsync(ModuleInfo module, CancellationToken ct = default)
    {
        if (!module.Manifest.IsPython) throw new ArgumentException("Модулът не е Python.", nameof(module));
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_running.TryGetValue(module.Id, out var existing))
            {
                if (existing.IsRunning) return existing;
                _running.Remove(module.Id);
            }

            var python = PythonLocator.Find(_paths)
                ?? throw new SidecarException("Не е намерен Python. Преинсталирайте програмата (липсва папка runtime\\python).");
            var py = module.Manifest.Python ?? new PythonSettings();
            var script = Path.Combine(module.Directory, string.IsNullOrWhiteSpace(py.Script) ? module.Manifest.Entry : py.Script);

            Directory.CreateDirectory(_paths.LogsDir);
            var dataDir = _paths.ModuleDataDir(module.Id);
            Directory.CreateDirectory(dataDir);
            var logPath = Path.Combine(_paths.LogsDir, module.Id + ".log");
            var port = PickPort(py.Port);

            var psi = new ProcessStartInfo(python)
            {
                WorkingDirectory = module.Directory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,   // държим го отворен: EOF = обвивката е умряла
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                // Python пише UTF-8 (PYTHONUTF8=1); без това .NET чете изхода в OEM кодировка на Windows.
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
            };
            psi.ArgumentList.Add("-u");
            psi.ArgumentList.Add(script);
            psi.Environment["TEOKROZE_PORT"] = port.ToString();
            psi.Environment["TEOKROZE_DATA_DIR"] = dataDir;
            foreach (var kv in ExtraEnvironment) psi.Environment[kv.Key] = kv.Value;
            psi.Environment["PYTHONUTF8"] = "1";
            psi.Environment["PYTHONDONTWRITEBYTECODE"] = "1";
            psi.Environment["TEOKROZE_RUNTIME"] = _paths.RuntimeDir;
            psi.Environment["PYTHONPATH"] = string.Join(Path.PathSeparator, new[] { _paths.RuntimeDir, module.Directory });
            var tess = PythonLocator.FindTesseractDir(_paths);
            if (tess != null)
            {
                psi.Environment["TESSERACT_CMD"] = Path.Combine(tess, OperatingSystem.IsWindows() ? "tesseract.exe" : "tesseract");
                psi.Environment["TESSDATA_PREFIX"] = Path.Combine(tess, "tessdata");
                psi.Environment["PATH"] = tess + Path.PathSeparator + (Environment.GetEnvironmentVariable("PATH") ?? "");
            }

            var log = new StreamWriter(new FileStream(logPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite), new System.Text.UTF8Encoding(false)) { AutoFlush = true };
            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            void Write(string text) { lock (log) { try { log.WriteLine(text); } catch (ObjectDisposedException) { } } }
            process.OutputDataReceived += (_, e) => { if (e.Data != null) Write(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) Write(e.Data); };
            process.Exited += (_, _) => { Write("[процесът приключи]"); };
            try { process.Start(); }
            catch (Exception ex) { throw new SidecarException("Python модулът не може да се стартира: " + ex.Message, logPath); }
            _job?.Add(process);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            var baseUri = new Uri($"http://127.0.0.1:{port}/");
            var health = new Uri(baseUri, py.Health.TrimStart('/'));
            try
            {
                await WaitReadyAsync(process, health, TimeSpan.FromSeconds(Math.Max(5, py.StartupTimeoutSec)), logPath, ct).ConfigureAwait(false);
            }
            catch
            {
                Kill(process);
                throw;
            }

            var handle = new SidecarHandle { ModuleId = module.Id, BaseUri = baseUri, LogPath = logPath, Process = process };
            _running[module.Id] = handle;
            return handle;
        }
        finally { _gate.Release(); }
    }

    public void Stop(string moduleId)
    {
        _gate.Wait();
        try
        {
            if (_running.Remove(moduleId, out var h)) Kill(h.Process);
        }
        finally { _gate.Release(); }
    }

    public void StopAll()
    {
        _gate.Wait();
        try
        {
            foreach (var h in _running.Values) Kill(h.Process);
            _running.Clear();
        }
        finally { _gate.Release(); }
    }

    public void Dispose()
    {
        StopAll();
        _job?.Dispose();
    }

    private static void Kill(Process p)
    {
        try
        {
            try { p.StandardInput.Close(); } catch (Exception) { }
            if (!p.WaitForExit(500)) p.Kill(entireProcessTree: true);
        }
        catch (Exception) { /* вече е приключил */ }
    }

    private static async Task WaitReadyAsync(Process p, Uri health, TimeSpan timeout, string logPath, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (p.HasExited)
                throw new SidecarException("Модулът се затвори при стартиране.\n" + LogTail(logPath), logPath);
            try
            {
                using var resp = await Http.GetAsync(health, ct).ConfigureAwait(false);
                if ((int)resp.StatusCode < 500) return;
            }
            catch (HttpRequestException) { /* още не слуша */ }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { /* бавен отговор */ }
            await Task.Delay(250, ct).ConfigureAwait(false);
        }
        throw new SidecarException($"Модулът не стартира за {timeout.TotalSeconds:0} сек.\n" + LogTail(logPath), logPath);
    }

    public static string LogTail(string logPath, int lines = 12)
    {
        try
        {
            using var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var sr = new StreamReader(fs, System.Text.Encoding.UTF8);
            return string.Join('\n', sr.ReadToEnd().Split('\n').TakeLast(lines)).Trim();
        }
        catch (Exception) { return ""; }
    }

    /// <summary>Предпочитания порт, ако е свободен; иначе произволен свободен.</summary>
    public static int PickPort(int preferred)
    {
        if (preferred is > 1024 and < 65536 && IsFree(preferred)) return preferred;
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        try { return ((IPEndPoint)l.LocalEndpoint).Port; }
        finally { l.Stop(); }
    }

    private static bool IsFree(int port)
    {
        try
        {
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch (SocketException) { return false; }
    }
}
