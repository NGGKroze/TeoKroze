namespace LogisticsPacking.Core;

/// <summary>Всички папки на програмата на едно място.</summary>
public sealed class AppPaths
{
    public AppPaths(string installRoot, string userRoot)
    {
        InstallRoot = installRoot;
        UserRoot = userRoot;
    }

    public static AppPaths Default()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrEmpty(local)) local = Path.Combine(Path.GetTempPath(), "LogisticsPacking-user");
        return new AppPaths(AppContext.BaseDirectory, Path.Combine(local, "LogisticsPacking"));
    }

    /// <summary>Папката на инсталацията (само за четене).</summary>
    public string InstallRoot { get; }
    /// <summary>%LOCALAPPDATA%\LogisticsPacking - настройки, логове, данни на модулите.</summary>
    public string UserRoot { get; }

    public string BundledModules => Path.Combine(InstallRoot, "modules");
    /// <summary>Модули, сложени тук, имат предимство пред вградените със същото id (поправка без нов инсталатор).</summary>
    public string UserModules => Path.Combine(UserRoot, "modules");
    public string RuntimeDir => Path.Combine(InstallRoot, "runtime");
    public string LogsDir => Path.Combine(UserRoot, "logs");
    public string DataDir => Path.Combine(UserRoot, "data");
    public string SettingsFile => Path.Combine(UserRoot, "settings.json");

    public string ModuleDataDir(string moduleId) => Path.Combine(DataDir, moduleId);
}
