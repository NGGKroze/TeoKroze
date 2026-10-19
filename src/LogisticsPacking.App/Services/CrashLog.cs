using System.Diagnostics;

namespace LogisticsPacking.App.Services;

/// <summary>
/// Дневник на стартирането и срущанията. Не зависи от нищо друго в програмата, за да записва и при срив в самото начало.
/// Пише на две места: %LOCALAPPDATA%\LogisticsPacking\logs\startup.log и (ако има права) logs\startup.log до програмата.
/// </summary>
internal static class CrashLog
{
    private static readonly string[] Files = BuildPaths();

    private static string[] BuildPaths()
    {
        var list = new List<string>();
        try
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrEmpty(local)) list.Add(Path.Combine(local, "LogisticsPacking", "logs", "startup.log"));
        }
        catch (Exception) { }
        try { list.Add(Path.Combine(AppContext.BaseDirectory, "logs", "startup.log")); } catch (Exception) { }
        return list.ToArray();
    }

    private static string FlagFile => Path.Combine(Path.GetDirectoryName(Primary) ?? Path.GetTempPath(), "starting.flag");

    /// <summary>Отбелязва началото на стартиране. true = предишното не е стигнало до "стабилно" (срив) -> безопасен режим.</summary>
    public static bool BeginAttempt()
    {
        try
        {
            var crashed = File.Exists(FlagFile);
            Directory.CreateDirectory(Path.GetDirectoryName(FlagFile)!);
            File.WriteAllText(FlagFile, DateTime.Now.ToString("O"));
            return crashed;
        }
        catch (Exception) { return false; }
    }

    /// <summary>Стартирането е успешно (или програмата е затворена нормално).</summary>
    public static void EndAttempt()
    {
        try { File.Delete(FlagFile); } catch (Exception) { }
    }

    public static string Primary => Files.FirstOrDefault() ?? "";

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{Environment.ProcessId}] {message}{Environment.NewLine}";
        foreach (var f in Files)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(f)!);
                // стара голяма история не е нужна: над 512 КБ започва наново
                if (File.Exists(f) && new FileInfo(f).Length > 512 * 1024) File.Delete(f);
                File.AppendAllText(f, line);
            }
            catch (Exception) { /* логът не бива да чупи програмата */ }
        }
    }

    public static void Hook()
    {
        Write($"=== Старт. {Environment.OSVersion} | .NET {Environment.Version} | {AppContext.BaseDirectory}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Write("СРИВ (AppDomain, terminating=" + e.IsTerminating + "): " + e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) => { Write("Неизчакана задача: " + e.Exception); e.SetObserved(); };
    }

    /// <summary>Изпълнява козметична стъпка; при грешка я записва и продължава (темата/анимациите не бива да спират програмата).</summary>
    public static void Safe(string step, Action action, bool logOk = false)
    {
        try { action(); if (logOk) Write("OK: " + step); }
        catch (Exception ex) { Write($"ГРЕШКА при „{step}“ (продължава): {ex}"); }
    }
}
