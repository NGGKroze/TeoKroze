namespace LogisticsPacking.Core;

/// <summary>Намира Python: първо вградения (runtime\python), после (за разработка) този от системата.</summary>
public static class PythonLocator
{
    public static string? Find(AppPaths paths)
    {
        var fromEnv = Environment.GetEnvironmentVariable("TEOKROZE_PYTHON");
        if (!string.IsNullOrWhiteSpace(fromEnv) && File.Exists(fromEnv)) return fromEnv;

        foreach (var rel in new[] { "python/python.exe", "python/bin/python3" })
        {
            var p = Path.Combine(paths.RuntimeDir, rel);
            if (File.Exists(p)) return p;
        }

        var names = OperatingSystem.IsWindows() ? new[] { "python.exe" } : new[] { "python3", "python" };
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            foreach (var n in names)
            {
                try
                {
                    var p = Path.Combine(dir.Trim('"'), n);
                    // Windows Store "заместител" на python.exe е 0-байтов файл - пропускаме го.
                    if (File.Exists(p) && new FileInfo(p).Length > 0) return p;
                }
                catch (Exception) { /* невалиден запис в PATH */ }
            }
        return null;
    }

    public static string? FindTesseractDir(AppPaths paths)
    {
        var dir = Path.Combine(paths.RuntimeDir, "tesseract");
        var exe = OperatingSystem.IsWindows() ? "tesseract.exe" : "tesseract";
        return File.Exists(Path.Combine(dir, exe)) ? dir : null;
    }
}
