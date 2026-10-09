using LogisticsPacking.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace LogisticsPacking.App.Services;

/// <summary>
/// Прилага тема върху обвивката. Четките в App.xaml се сменят "на място" (същите обекти),
/// затова всичко, което ги ползва през StaticResource, се обновява веднага - без рестарт.
/// </summary>
internal static class ThemeService
{
    public static ThemeCatalog Catalog { get; private set; } = null!;
    public static AppTheme Current { get; private set; } = null!;

    public static void Init()
    {
        Catalog = ThemeCatalog.Load(AppServices.Paths);
        Apply(AppServices.Settings.Theme);
    }

    public static void Apply(string? id)
    {
        var theme = Catalog.Get(id);
        Current = theme;
        var res = Application.Current.Resources;
        SetImage(res, "MarbleBrush", theme.Wall);   // стената (фон)
        SetImage(res, "GraniteBrush", theme.Tile);  // камъкът на плочките
        var s = theme.Shell;
        SetColor(res, "InkBrush", s.Ink);
        SetColor(res, "InkSoftBrush", s.InkSoft);
        SetColor(res, "StoneTextBrush", s.StoneText);
        SetColor(res, "StoneSoftTextBrush", s.StoneSoft);
        SetColor(res, "TileTextBrush", s.TileText);
        SetColor(res, "TileSoftTextBrush", s.TileSoft);
        SetColor(res, "BrassBrush", s.Brass);
        SetColor(res, "TileBorderBrush", s.TileBorder);
        SetColor(res, "BarBrush", s.Bar);
        SetColor(res, "PaperBrush", s.Paper);
    }

    private static void SetImage(ResourceDictionary res, string key, string asset)
    {
        if (res[key] is ImageBrush b && !string.IsNullOrEmpty(asset))
            b.ImageSource = new BitmapImage(new Uri("ms-appx:///Assets/" + asset));
    }

    private static void SetColor(ResourceDictionary res, string key, string hex)
    {
        if (res[key] is SolidColorBrush b && TryParse(hex, out var c)) b.Color = c;
    }

    /// <summary>#RRGGBB или #AARRGGBB.</summary>
    public static bool TryParse(string? hex, out Windows.UI.Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(hex)) return false;
        var h = hex.Trim().TrimStart('#');
        if (h.Length != 6 && h.Length != 8) return false;
        try
        {
            var v = Convert.ToUInt32(h, 16);
            color = h.Length == 8
                ? Windows.UI.Color.FromArgb((byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v)
                : Windows.UI.Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
            return true;
        }
        catch (FormatException) { return false; }
    }
}
