using LogisticsPacking.Core;

namespace LogisticsPacking.App.Services;

/// <summary>Общите услуги на програмата (пътища, каталог с модули, Python процеси, настройки).</summary>
internal static class AppServices
{
    public static AppPaths Paths { get; private set; } = null!;
    public static ModuleCatalog Catalog { get; private set; } = null!;
    public static SidecarManager Sidecars { get; private set; } = null!;
    public static EngineService Engine { get; private set; } = null!;
    public static AppSettings Settings { get; set; } = new();

    public static void Init()
    {
        Paths = AppPaths.Default();
        Directory.CreateDirectory(Paths.UserRoot);
        Directory.CreateDirectory(Paths.LogsDir);
        // Профилът на WebView2 е в папка с права за запис (инсталацията може да е само за четене).
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(Paths.UserRoot, "webview"));
        Settings = AppSettings.Load(Paths);
        Catalog = ModuleCatalog.Load(Paths);
        Sidecars = new SidecarManager(Paths);
        Engine = new EngineService(Paths, Sidecars);
    }

    public static void ReloadCatalog() => Catalog = ModuleCatalog.Load(Paths);

    public static void Log(string message)
    {
        try { File.AppendAllText(Path.Combine(Paths.LogsDir, "app.log"), $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}"); }
        catch (Exception) { /* логът не бива да чупи програмата */ }
    }
}
