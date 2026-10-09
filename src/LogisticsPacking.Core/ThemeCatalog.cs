using System.Text.Json;
using System.Text.Json.Serialization;

namespace LogisticsPacking.Core;

/// <summary>Цветове на обвивката (WinUI): текстове върху стената и плочките, акцент, ленти.</summary>
public sealed class ShellPalette
{
    public string Ink { get; set; } = "#26272B";
    public string InkSoft { get; set; } = "#5B5C62";
    public string StoneText { get; set; } = "#F4F1EA";
    public string StoneSoft { get; set; } = "#C9C5BC";
    public string TileText { get; set; } = "#202125";
    public string TileSoft { get; set; } = "#44454B";
    public string Brass { get; set; } = "#B08D57";
    public string TileBorder { get; set; } = "#8C8F96";
    public string Bar { get; set; } = "#F01F2023";
    public string Paper { get; set; } = "#F5F2EC";
}

/// <summary>Цветове на клиентските екрани (CSS променливи --lps-*; Tailwind акцентът се извежда от Accent).</summary>
public sealed class WebPalette
{
    public string Bg { get; set; } = "#ebe8e2";
    public string Side { get; set; } = "#e6e2da";
    public string Line { get; set; } = "#d8d3c8";
    public string Ink { get; set; } = "#26272b";
    public string InkSoft { get; set; } = "#5b5c62";
    public string Accent { get; set; } = "#2f3034";
    public string AccentDark { get; set; } = "#131416";
    public string Brass { get; set; } = "#b08d57";
    public string BrassDark { get; set; } = "#8d6d3c";
    public string Soft { get; set; } = "#f3ede0";
    public string Sel { get; set; } = "#d9c7a3";
    public string Thumb { get; set; } = "#b6b1a5";
}

/// <summary>Тема: стенно пано (фон), камък за плочките и палитри за обвивката и клиентските екрани.</summary>
public sealed class AppTheme
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Desc { get; set; } = "";
    /// <summary>light | dark - как да изглеждат стандартните контроли (бутони, полета, диалози).</summary>
    public string Mode { get; set; } = "light";
    /// <summary>Лъскавина на плочките 0..1 (0 = плоски карти).</summary>
    public double Gloss { get; set; } = 1.0;
    /// <summary>Скрита от списъка за избор (ползва се само през "system").</summary>
    public bool Hidden { get; set; }
    /// <summary>true = светла или тъмна според Windows (системна тема).</summary>
    public bool Auto { get; set; }
    public string Wall { get; set; } = "";
    public string Tile { get; set; } = "";
    public ShellPalette Shell { get; set; } = new();
    public WebPalette Web { get; set; } = new();
}

/// <summary>Темите се четат от runtime\themes.json - нова тема се добавя без прекомпилиране.</summary>
public sealed class ThemeCatalog
{
    public const string FallbackId = "granite";

    public List<AppTheme> Themes { get; } = new();

    public static ThemeCatalog Load(AppPaths paths)
    {
        var cat = new ThemeCatalog();
        try
        {
            var file = Path.Combine(paths.RuntimeDir, "themes.json");
            if (File.Exists(file))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(file), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
                if (doc.RootElement.TryGetProperty("themes", out var arr))
                    foreach (var el in arr.EnumerateArray())
                    {
                        var t = JsonSerializer.Deserialize<AppTheme>(el.GetRawText(), ModuleManifest.JsonOptions);
                        if (t != null && !string.IsNullOrWhiteSpace(t.Id) && cat.Themes.All(x => x.Id != t.Id)) cat.Themes.Add(t);
                    }
            }
        }
        catch (Exception) { /* повреден файл -> вградената тема */ }
        if (cat.Themes.Count == 0)
            cat.Themes.Add(new AppTheme { Id = FallbackId, Name = "Гранит", Wall = "wall_granite.jpg", Tile = "tile_granite.jpg" });
        return cat;
    }

    public const string SystemId = "system";

    /// <summary>Темата за избор; "system" се разрешава на светла/тъмна според Windows.</summary>
    public AppTheme Resolve(string? id, bool systemDark)
    {
        var t = Get(id);
        return t.Auto ? Get(systemDark ? "system-dark" : "system-light") : t;
    }

    public IEnumerable<AppTheme> Selectable => Themes.Where(t => !t.Hidden);

    public AppTheme Get(string? id) => Themes.FirstOrDefault(t => t.Id == id) ?? Themes.FirstOrDefault(t => t.Id == FallbackId) ?? Themes[0];
}
