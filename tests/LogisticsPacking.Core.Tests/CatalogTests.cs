using LogisticsPacking.Core;
using Xunit;

namespace LogisticsPacking.Core.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "lps-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (Exception) { } }

    public string Module(string root, string id, string manifestJson, string entry = "index.html")
    {
        var dir = System.IO.Path.Combine(Path, root, id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(System.IO.Path.Combine(dir, "module.json"), manifestJson);
        if (entry != "") File.WriteAllText(System.IO.Path.Combine(dir, entry), "<html></html>");
        return dir;
    }
}

public class CatalogTests
{
    [Fact]
    public void LoadsAndOrdersModules()
    {
        using var t = new TempDir();
        t.Module("bundled", "b", """{"id":"b","name":"Beta","order":20}""");
        t.Module("bundled", "a", """{"id":"a","name":"Alpha","order":10}""");
        var c = ModuleCatalog.Load(Path.Combine(t.Path, "bundled"), null);
        Assert.Equal(new[] { "a", "b" }, c.Modules.Select(m => m.Id));
        Assert.Empty(c.Problems);
    }

    [Fact]
    public void UserModuleOverridesBundled()
    {
        using var t = new TempDir();
        t.Module("bundled", "a", """{"id":"a","name":"Старо","version":"1.0.0"}""");
        t.Module("user", "a", """{"id":"a","name":"Ново","version":"1.1.0"}""");
        var c = ModuleCatalog.Load(Path.Combine(t.Path, "bundled"), Path.Combine(t.Path, "user"));
        var m = Assert.Single(c.Modules);
        Assert.Equal("Ново", m.Manifest.Name);
        Assert.Equal(ModuleSource.User, m.Source);
    }

    [Fact]
    public void BrokenModuleDoesNotAffectOthers()
    {
        using var t = new TempDir();
        t.Module("bundled", "ok", """{"id":"ok","name":"OK"}""");
        t.Module("bundled", "badjson", "{ not json");
        t.Module("bundled", "noentry", """{"id":"noentry","name":"X"}""", entry: "");
        t.Module("bundled", "badtype", """{"id":"badtype","name":"X","type":"exe"}""");
        t.Module("bundled", "traversal", """{"id":"traversal","name":"X","entry":"../x.html"}""");
        var c = ModuleCatalog.Load(Path.Combine(t.Path, "bundled"), null);
        Assert.Equal("ok", Assert.Single(c.Modules).Id);
        Assert.Equal(4, c.Problems.Count);
    }

    [Fact]
    public void DisabledAndUnderscoreFoldersAreHidden()
    {
        using var t = new TempDir();
        t.Module("bundled", "off", """{"id":"off","name":"Off","enabled":false}""");
        t.Module("bundled", "_shared", """{"id":"shared","name":"S"}""");
        Assert.Empty(ModuleCatalog.Load(Path.Combine(t.Path, "bundled"), null).Modules);
    }

    [Fact]
    public void VariantsAreParsed()
    {
        var m = ModuleManifest.Parse("""{"id":"x","name":"X","variants":[{"id":"v","name":"V","onLoad":"1+1"}]}""");
        Assert.True(m.HasVariants);
        Assert.Equal("1+1", m.Variants[0].OnLoad);
    }

    [Fact]
    public void UniquePathAddsCounter()
    {
        using var t = new TempDir();
        File.WriteAllText(Path.Combine(t.Path, "a.xlsx"), "");
        Assert.EndsWith("a (2).xlsx", AppSettings.UniquePath(t.Path, "a.xlsx"));
        Assert.EndsWith("a_b.xlsx", AppSettings.UniquePath(t.Path, "a/b.xlsx"));
    }

    /// <summary>Истинските модули в репото трябва да са валидни.</summary>
    [Fact]
    public void RepositoryModulesAreValid()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !Directory.Exists(Path.Combine(dir, "modules"))) dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);
        var c = ModuleCatalog.Load(Path.Combine(dir!, "modules"), null);
        Assert.Empty(c.Problems);
        Assert.True(c.Modules.Count >= 19, $"Очаквани >=19 модула, намерени {c.Modules.Count}");
        Assert.Equal(c.Modules.Count, c.Modules.Select(m => m.Id).Distinct().Count());
        Assert.Equal(3, c.Find("loreal")!.Manifest.Variants.Count);
        foreach (var m in c.Modules.Where(m => m.Manifest.IsPython))
            Assert.True(File.Exists(Path.Combine(m.Directory, m.Manifest.Python!.Script)));
    }
}

public class TileLayoutTests
{
    [Theory]
    [InlineData(19, 1200, 640)]
    [InlineData(19, 1000, 560)]
    [InlineData(19, 1920, 900)]
    [InlineData(3, 1200, 640)]
    [InlineData(1, 800, 500)]
    [InlineData(25, 900, 520)]
    public void TilesAlwaysFitTheArea(int count, double w, double h)
    {
        var r = TileLayout.Compute(count, w, h);
        Assert.True(r.Cols * r.Rows >= count);
        Assert.True(r.Cols * r.TileWidth + (r.Cols - 1) * 16 <= w + 0.01, "ширина");
        Assert.True(r.Rows * r.TileHeight + (r.Rows - 1) * 16 <= h + 0.01, "височина");
        Assert.True(r.TileWidth > 60 && r.TileHeight > 40);
    }

    [Fact]
    public void FewerTilesGetBigger()
    {
        Assert.True(TileLayout.Compute(2, 1200, 640).TileHeight > TileLayout.Compute(19, 1200, 640).TileHeight);
    }
}

public class ThemeTests
{
    private static (AppPaths paths, ModuleInfo module, TempDir t) Setup(string manifest = """{"id":"m","name":"M"}""")
    {
        var t = new TempDir();
        var dir = t.Module("modules", "m", manifest);
        var rt = Path.Combine(t.Path, "runtime");
        Directory.CreateDirectory(rt);
        File.WriteAllText(Path.Combine(rt, "lps-theme.js"), "/* c */ var CSS = {{CSS}}; var MODULE = {{MODULE}};");
        File.WriteAllText(Path.Combine(rt, "lps-theme.css"), "body{background:url(\"{{MARBLE}}\")}");
        File.WriteAllBytes(Path.Combine(rt, "lps-marble.jpg"), new byte[] { 1, 2, 3 });
        var paths = new AppPaths(t.Path, Path.Combine(t.Path, "user"));
        return (paths, ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single(), t);
    }

    [Fact]
    public void BuildsScriptWithModuleCssAndMarble()
    {
        var (paths, module, t) = Setup();
        using var _ = t;
        File.WriteAllText(Path.Combine(module.Directory, "lps.css"), "h1{color:red}");
        var js = ThemeInjector.BuildScript(paths, module)!;
        Assert.Contains("data:image/jpeg;base64,AQID", js);
        Assert.Contains("h1{color:red}", js);
        Assert.Contains("var MODULE = \"m\";", js);
        Assert.DoesNotContain("{{", js);
    }

    [Fact]
    public void ThemeCanBeDisabledPerModule()
    {
        var (paths, module, t) = Setup("""{"id":"m","name":"M","theme":false}""");
        using var _ = t;
        Assert.Null(ThemeInjector.BuildScript(paths, module));
    }

    [Fact]
    public void RealThemeFilesHaveNoStrayPlaceholders()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !Directory.Exists(Path.Combine(dir, "runtime"))) dir = Path.GetDirectoryName(dir);
        var js = File.ReadAllText(Path.Combine(dir!, "runtime", "lps-theme.js"));
        Assert.Equal(1, System.Text.RegularExpressions.Regex.Matches(js, @"\{\{CSS\}\}").Count);
        Assert.Equal(1, System.Text.RegularExpressions.Regex.Matches(js, @"\{\{MODULE\}\}").Count);
    }
}

public class I18nTests
{
    [Fact]
    public void MergesCommonAndModuleDictionaries()
    {
        using var t = new TempDir();
        var dir = t.Module("modules", "m", """{"id":"m","name":"M"}""");
        File.WriteAllText(Path.Combine(dir, "bg.json"), """{"exact":{"Hello":"Здравей","Clear":"Нулирай"},"patterns":[["^N (\\d+)$","Н $1"]],"skip":["#x"]}""");
        var rt = Path.Combine(t.Path, "runtime"); Directory.CreateDirectory(Path.Combine(rt, "i18n"));
        File.WriteAllText(Path.Combine(rt, "lps-i18n.js"), "var DICT = {{DICT}};");
        File.WriteAllText(Path.Combine(rt, "i18n", "common.bg.json"), """{"exact":{"Clear":"Изчисти","Print":"Печат"},"skip":["#p"]}""");
        var paths = new AppPaths(t.Path, Path.Combine(t.Path, "user"));
        var module = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single();
        var js = ThemeInjector.BuildI18nScript(paths, module)!;
        Assert.Contains("\"Hello\":\"", js.Replace("\\u0417", "")); // ключът е записан
        Assert.Contains("Print", js);
        Assert.DoesNotContain("{{", js);
        // модулният речник има предимство над общия
        Assert.DoesNotContain("\\u0418\\u0437\\u0447\\u0438\\u0441\\u0442\\u0438", js); // "Изчисти" е презаписано с "Нулирай"
        Assert.Contains("#x", js); Assert.Contains("#p", js);
    }

    [Fact]
    public void TranslationCanBeDisabledPerModule()
    {
        using var t = new TempDir();
        t.Module("modules", "m", """{"id":"m","name":"M","translate":false}""");
        var rt = Path.Combine(t.Path, "runtime"); Directory.CreateDirectory(rt);
        File.WriteAllText(Path.Combine(rt, "lps-i18n.js"), "{{DICT}}");
        var module = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single();
        Assert.Null(ThemeInjector.BuildI18nScript(new AppPaths(t.Path, t.Path), module));
    }

    [Fact]
    public void AllRealDictionariesAreValidJson()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !Directory.Exists(Path.Combine(dir, "modules"))) dir = Path.GetDirectoryName(dir);
        var paths = new AppPaths(dir!, Path.Combine(Path.GetTempPath(), "lps-x"));
        var catalog = ModuleCatalog.Load(paths);
        foreach (var m in catalog.Modules)
        {
            var d = new I18nDictionary();
            d.Merge(Path.Combine(m.Directory, "bg.json"));
            Assert.True(d.Exact.Count > 0, $"{m.Id}: празен или липсващ bg.json");
            foreach (var p in d.Patterns) System.Text.RegularExpressions.Regex.IsMatch("x", p[0]); // валидни регулярни изрази
        }
    }
}

public class LayoutTests
{
    [Fact]
    public void BuildsLayoutScriptFromLayoutJson()
    {
        using var t = new TempDir();
        var dir = t.Module("modules", "m", """{"id":"m","name":"M"}""");
        File.WriteAllText(Path.Combine(dir, "layout.json"), """{"title":"T","side":[{"move":["#a"]}]}""");
        var rt = Path.Combine(t.Path, "runtime"); Directory.CreateDirectory(rt);
        File.WriteAllText(Path.Combine(rt, "lps-layout.js"), "var CFG = {{LAYOUT}};");
        var module = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null).Modules.Single();
        var js = ThemeInjector.BuildLayoutScript(new AppPaths(t.Path, t.Path), module)!;
        Assert.Contains("\"title\":\"T\"", js.Replace(" ", ""));
        Assert.DoesNotContain("{{", js);
    }

    [Fact]
    public void LayoutCanBeDisabledOrMissing()
    {
        using var t = new TempDir();
        var dir = t.Module("modules", "off", """{"id":"off","name":"X","layout":false}""");
        File.WriteAllText(Path.Combine(dir, "layout.json"), "{}");
        t.Module("modules", "none", """{"id":"none","name":"Y"}""");
        var rt = Path.Combine(t.Path, "runtime"); Directory.CreateDirectory(rt);
        File.WriteAllText(Path.Combine(rt, "lps-layout.js"), "{{LAYOUT}}");
        var cat = ModuleCatalog.Load(Path.Combine(t.Path, "modules"), null);
        var paths = new AppPaths(t.Path, t.Path);
        Assert.Null(ThemeInjector.BuildLayoutScript(paths, cat.Find("off")!));
        Assert.Null(ThemeInjector.BuildLayoutScript(paths, cat.Find("none")!));
    }

    [Fact]
    public void AllRealLayoutFilesAreValidJson()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !Directory.Exists(Path.Combine(dir, "modules"))) dir = Path.GetDirectoryName(dir);
        var paths = new AppPaths(dir!, Path.Combine(Path.GetTempPath(), "lps-y"));
        foreach (var m in ModuleCatalog.Load(paths).Modules)
        {
            var js = ThemeInjector.BuildLayoutScript(paths, m);
            Assert.NotNull(js);
            Assert.DoesNotContain("{{LAYOUT}}", js);
        }
    }
}
