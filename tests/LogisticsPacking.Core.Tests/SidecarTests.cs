using LogisticsPacking.Core;
using Xunit;

namespace LogisticsPacking.Core.Tests;

public class SidecarTests
{
    private static string? Py() => PythonLocator.Find(new AppPaths("/nonexistent", "/nonexistent"));

    private static (AppPaths paths, ModuleInfo module, TempDir t) Fake(string script)
    {
        var t = new TempDir();
        var dir = t.Module("modules", "fake", """{"id":"fake","name":"Fake","type":"python","entry":"run.py","python":{"script":"run.py","startupTimeoutSec":15}}""", entry: "");
        File.WriteAllText(Path.Combine(dir, "run.py"), script);
        var paths = new AppPaths(t.Path, Path.Combine(t.Path, "user"));
        var module = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single();
        return (paths, module, t);
    }

    [Fact]
    public async Task StartsServesAndStops()
    {
        if (Py() == null) return; // няма Python на тази машина
        var (paths, module, t) = Fake("""
            import os, http.server
            http.server.ThreadingHTTPServer(("127.0.0.1", int(os.environ["TEOKROZE_PORT"])), http.server.SimpleHTTPRequestHandler).serve_forever()
            """);
        using var _ = t;
        using var mgr = new SidecarManager(paths);
        var h = await mgr.StartAsync(module);
        Assert.True(h.IsRunning);
        using (var http = new HttpClient())
            Assert.Contains("run.py", await http.GetStringAsync(h.BaseUri));
        Assert.Same(h, await mgr.StartAsync(module)); // повторно стартиране връща същия процес
        Assert.True(Directory.Exists(paths.ModuleDataDir("fake")));
        mgr.Stop("fake");
        await Task.Delay(500);
        Assert.False(h.IsRunning);
    }

    [Fact]
    public async Task ReportsCrashWithLogTail()
    {
        if (Py() == null) return;
        var (paths, module, t) = Fake("raise SystemExit('грешка при старт')");
        using var _ = t;
        using var mgr = new SidecarManager(paths);
        var ex = await Assert.ThrowsAsync<SidecarException>(() => mgr.StartAsync(module));
        Assert.Contains("грешка при старт", ex.Message);
    }

    [Fact]
    public void PickPortPrefersFreePreferred()
    {
        var p = SidecarManager.PickPort(0);
        Assert.InRange(p, 1025, 65535);
        Assert.Equal(p, SidecarManager.PickPort(p)); // освободен след PickPort
    }
}
