using System.Text.Json;

namespace LogisticsPacking.Core;

/// <summary>
/// Сглобява скрипта с общата тема (runtime\lps-theme.js + lps-theme.css + модулния lps.css), който обвивката
/// вкарва във всяка страница. Така един файл променя вида на всички клиенти, а модул може да има собствени корекции.
/// </summary>
public static class ThemeInjector
{
    public static string? BuildScript(AppPaths paths, ModuleInfo module)
    {
        if (!module.Manifest.Theme) return null;
        var jsPath = Path.Combine(paths.RuntimeDir, "lps-theme.js");
        var cssPath = Path.Combine(paths.RuntimeDir, "lps-theme.css");
        if (!File.Exists(jsPath) || !File.Exists(cssPath)) return null;

        var css = File.ReadAllText(cssPath);
        var marblePath = Path.Combine(paths.RuntimeDir, "lps-marble.jpg");
        var marble = File.Exists(marblePath) ? "data:image/jpeg;base64," + Convert.ToBase64String(File.ReadAllBytes(marblePath)) : "";
        css = css.Replace("{{MARBLE}}", marble);

        var moduleCss = Path.Combine(module.Directory, "lps.css");
        if (File.Exists(moduleCss)) css += "\n" + File.ReadAllText(moduleCss);

        return File.ReadAllText(jsPath)
            .Replace("{{MODULE}}", JsonSerializer.Serialize(module.Id))
            .Replace("{{CSS}}", JsonSerializer.Serialize(css));
    }
}
