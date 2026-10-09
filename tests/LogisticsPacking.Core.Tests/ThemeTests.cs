using System.Text.Json;
using LogisticsPacking.Core;
using Xunit;

namespace LogisticsPacking.Core.Tests;

public class ThemeCatalogTests
{
    private static string Repo()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d != null && !File.Exists(Path.Combine(d.FullName, "runtime", "themes.json"))) d = d.Parent;
        return d?.FullName ?? throw new DirectoryNotFoundException("runtime\\themes.json не е намерен над тестовата папка");
    }

    [Fact]
    public void ShippedThemesAreCompleteAndAssetsExist()
    {
        var repo = Repo();
        var cat = ThemeCatalog.Load(new AppPaths(repo, Path.Combine(repo, "user")));
        Assert.True(cat.Themes.Count >= 5);
        Assert.Equal(cat.Themes.Count, cat.Themes.Select(t => t.Id).Distinct().Count());
        Assert.Contains(cat.Themes, t => t.Id == ThemeCatalog.FallbackId);
        var hex = new System.Text.RegularExpressions.Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");
        foreach (var t in cat.Themes)
        {
            Assert.False(string.IsNullOrWhiteSpace(t.Name));
            Assert.True(File.Exists(Path.Combine(repo, "src", "LogisticsPacking.App", "Assets", t.Wall)), $"{t.Id}: липсва {t.Wall}");
            Assert.True(File.Exists(Path.Combine(repo, "src", "LogisticsPacking.App", "Assets", t.Tile)), $"{t.Id}: липсва {t.Tile}");
            foreach (var o in new object[] { t.Shell, t.Web })
                foreach (var p in o.GetType().GetProperties())
                    Assert.True(hex.IsMatch((string)p.GetValue(o)!), $"{t.Id}.{p.Name} не е цвят: {p.GetValue(o)}");
        }
    }

    [Fact]
    public void SystemThemeFollowsWindowsMode()
    {
        var repo = Repo();
        var cat = ThemeCatalog.Load(new AppPaths(repo, Path.Combine(repo, "user")));
        Assert.Equal("system-light", cat.Resolve("system", systemDark: false).Id);
        Assert.Equal("system-dark", cat.Resolve("system", systemDark: true).Id);
        Assert.Equal("midnight", cat.Resolve("midnight", systemDark: false).Id);
        Assert.DoesNotContain(cat.Selectable, x => x.Hidden);
        Assert.Equal(new[] { "granite", "midnight", "system" }, cat.Selectable.Select(x => x.Id));
    }

    [Fact]
    public void UnknownThemeFallsBackToGranite()
    {
        var repo = Repo();
        var cat = ThemeCatalog.Load(new AppPaths(repo, Path.Combine(repo, "user")));
        Assert.Equal(ThemeCatalog.FallbackId, cat.Get("няма-такава").Id);
        Assert.Equal(ThemeCatalog.FallbackId, cat.Get(null).Id);
    }

    [Fact]
    public void BrokenThemesFileGivesBuiltInTheme()
    {
        using var t = new TempDir();
        Directory.CreateDirectory(Path.Combine(t.Path, "runtime"));
        File.WriteAllText(Path.Combine(t.Path, "runtime", "themes.json"), "{ не е json");
        var cat = ThemeCatalog.Load(new AppPaths(t.Path, Path.Combine(t.Path, "user")));
        Assert.Single(cat.Themes);
    }

    [Fact]
    public void InjectorWritesThemePalette()
    {
        using var t = new TempDir();
        t.Module("modules", "m", """{"id":"m","name":"M"}""");
        var rt = Path.Combine(t.Path, "runtime");
        Directory.CreateDirectory(rt);
        File.WriteAllText(Path.Combine(rt, "lps-theme.js"), "var T = {{THEME}}; var CSS = {{CSS}}; var MODULE = {{MODULE}};");
        File.WriteAllText(Path.Combine(rt, "lps-theme.css"), "body{}");
        var paths = new AppPaths(t.Path, Path.Combine(t.Path, "user"));
        var module = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single();
        var theme = new AppTheme { Id = "x", Web = new WebPalette { Accent = "#112233" } };
        var js = ThemeInjector.BuildScript(paths, module, theme)!;
        Assert.Contains("\"accent\":\"#112233\"", js);
        Assert.DoesNotContain("{{", js);
    }
}
