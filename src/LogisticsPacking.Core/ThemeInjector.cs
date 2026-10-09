using System.Text.Json;

namespace LogisticsPacking.Core;

/// <summary>
/// Сглобява скрипта с общата тема (runtime\lps-theme.js + lps-theme.css + модулния lps.css), който обвивката
/// вкарва във всяка страница. Така един файл променя вида на всички клиенти, а модул може да има собствени корекции.
/// </summary>
public static class ThemeInjector
{
    public static string? BuildScript(AppPaths paths, ModuleInfo module, AppTheme? theme = null, bool animations = true)
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

        var web = JsonSerializer.Serialize(theme?.Web ?? new WebPalette(), new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        return File.ReadAllText(jsPath)
            .Replace("{{THEME}}", web)
            .Replace("{{ANIM}}", animations ? "true" : "false")
            .Replace("{{MODULE}}", JsonSerializer.Serialize(module.Id))
            .Replace("{{CSS}}", JsonSerializer.Serialize(css));
    }

    /// <summary>Единната структура (runtime\lps-layout.js + modules/&lt;id&gt;/layout.json). null = без layout.json или изключено.</summary>
    public static string? BuildLayoutScript(AppPaths paths, ModuleInfo module)
    {
        if (!module.Manifest.Layout) return null;
        var jsPath = Path.Combine(paths.RuntimeDir, "lps-layout.js");
        var cfgPath = Path.Combine(module.Directory, "layout.json");
        if (!File.Exists(jsPath) || !File.Exists(cfgPath)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(cfgPath), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
        return File.ReadAllText(jsPath).Replace("{{LAYOUT}}", doc.RootElement.GetRawText());
    }

    /// <summary>Помощникът LPS.engine (runtime\lps-engine.js) - достъп до общия OCR/PDF engine от страниците.</summary>
    public static string? BuildEngineScript(AppPaths paths)
    {
        var p = Path.Combine(paths.RuntimeDir, "lps-engine.js");
        return File.Exists(p) ? File.ReadAllText(p) : null;
    }

    /// <summary>Скрипт за превода на български (runtime\lps-i18n.js + общия и модулния речник). null = изключен или няма речник.</summary>
    public static string? BuildI18nScript(AppPaths paths, ModuleInfo module)
    {
        if (!module.Manifest.Translate) return null;
        var jsPath = Path.Combine(paths.RuntimeDir, "lps-i18n.js");
        if (!File.Exists(jsPath)) return null;

        var dict = new I18nDictionary();
        dict.Merge(Path.Combine(paths.RuntimeDir, "i18n", "common.bg.json"));
        dict.Merge(Path.Combine(module.Directory, "bg.json"));
        return File.ReadAllText(jsPath).Replace("{{DICT}}", dict.ToJson());
    }
}

/// <summary>Речник "английски текст -> български" (точни съвпадения + шаблони) със скрити за превод области.</summary>
public sealed class I18nDictionary
{
    public Dictionary<string, string> Exact { get; } = new(StringComparer.Ordinal);
    public List<string[]> Patterns { get; } = new();
    public List<string> Skip { get; } = new();

    public void Merge(string path)
    {
        if (!File.Exists(path)) return;
        using var doc = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
        var root = doc.RootElement;
        if (root.TryGetProperty("exact", out var ex))
            foreach (var p in ex.EnumerateObject()) Exact[p.Name] = p.Value.GetString() ?? "";
        if (root.TryGetProperty("patterns", out var pa))
            foreach (var item in pa.EnumerateArray())
            {
                var parts = item.EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
                if (parts.Length >= 2) Patterns.Add(parts);
            }
        if (root.TryGetProperty("skip", out var sk))
            foreach (var item in sk.EnumerateArray())
            {
                var v = item.GetString();
                if (!string.IsNullOrWhiteSpace(v) && !Skip.Contains(v)) Skip.Add(v);
            }
    }

    public string ToJson() => JsonSerializer.Serialize(new { exact = Exact, patterns = Patterns, skip = Skip });
}
