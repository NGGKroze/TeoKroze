using LogisticsPacking.App.Services;
using LogisticsPacking.App.Views;
using LogisticsPacking.Core;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace LogisticsPacking.App;

public sealed partial class MainWindow : Window
{
    // Отворените клиенти остават живи (не губим работата при "Назад"): ключ = id[:вариант]
    private readonly Dictionary<string, ModuleView> _open = new();

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        ApplyChrome();
        ThemeService.Changed += ApplyChrome;

        AppWindow.Resize(new SizeInt32(1360, 860));
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
        if (File.Exists(icon)) AppWindow.SetIcon(icon);

        Home.OpenRequested += (module, variant) => OpenModule(module, variant);
        Home.SetHandle(WinRT.Interop.WindowNative.GetWindowHandle(this));
        Closed += (_, _) =>
        {
            foreach (var v in _open.Values) v.Dispose();
            AppServices.Sidecars.Dispose();
        };
    }

    /// <summary>Светъл/тъмен вид на контролите и цвят на бутоните в заглавната лента според темата.</summary>
    private void ApplyChrome()
    {
        RootGrid.RequestedTheme = ThemeService.ElementTheme;
        var barLight = ThemeService.TryParse(ThemeService.Current?.Shell.Bar, out var bar) && (0.299 * bar.R + 0.587 * bar.G + 0.114 * bar.B) > 150;
        var fg = barLight ? Colors.Black : Colors.White;
        var tb = AppWindow.TitleBar;
        tb.ButtonBackgroundColor = Colors.Transparent;
        tb.ButtonInactiveBackgroundColor = Colors.Transparent;
        tb.ButtonForegroundColor = fg;
        tb.ButtonInactiveForegroundColor = Colors.Gray;
        tb.ButtonHoverBackgroundColor = barLight ? ColorHelper.FromArgb(40, 0, 0, 0) : ColorHelper.FromArgb(60, 255, 255, 255);
    }

    private void OpenModule(ModuleInfo module, ModuleVariant? variant)
    {
        var key = variant == null ? module.Id : module.Id + ":" + variant.Id;
        if (!_open.TryGetValue(key, out var view))
        {
            view = new ModuleView(module, variant);
            view.BackRequested += (_, _) => ShowHome();
            view.CloseRequested += (_, _) => CloseModule(key);
            _open[key] = view;
            ModuleHost.Children.Add(view);
            _ = view.LoadAsync();
        }
        foreach (var v in _open.Values) v.Visibility = ReferenceEquals(v, view) ? Visibility.Visible : Visibility.Collapsed;
        Home.Visibility = Visibility.Collapsed;
        ModuleHost.Visibility = Visibility.Visible;
    }

    private void ShowHome()
    {
        ModuleHost.Visibility = Visibility.Collapsed;
        Home.Visibility = Visibility.Visible;
        Home.Refresh(_open.Keys.ToHashSet());
    }

    private void CloseModule(string key)
    {
        if (_open.Remove(key, out var view))
        {
            ModuleHost.Children.Remove(view);
            view.Dispose();
        }
        ShowHome();
    }
}
