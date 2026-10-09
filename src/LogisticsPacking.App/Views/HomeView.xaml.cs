using LogisticsPacking.App.Services;
using LogisticsPacking.Core;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace LogisticsPacking.App.Views;

/// <summary>Начален екран: големи плочки за клиентите + търсене. Всичко се събира на един екран.</summary>
public sealed partial class HomeView : UserControl
{
    public event Action<ModuleInfo, ModuleVariant?>? OpenRequested;

    private sealed record Tile(string Title, string Subtitle, ModuleInfo Module, ModuleVariant? Variant, bool IsGroup);

    private ModuleInfo? _group;          // ако не е null - показваме подклиентите на този модул
    private HashSet<string> _openKeys = new();
    private IntPtr _hwnd;

    public HomeView()
    {
        InitializeComponent();
        Render();
    }

    public void SetHandle(IntPtr hwnd) => _hwnd = hwnd;

    public void Refresh(HashSet<string> openKeys)
    {
        _openKeys = openKeys;
        Render();
    }

    private IEnumerable<Tile> BuildTiles()
    {
        IEnumerable<Tile> all = _group == null
            ? AppServices.Catalog.Modules.Select(m => new Tile(m.Manifest.Name, m.Manifest.Summary, m, null, m.Manifest.HasVariants))
            : _group.Manifest.Variants.Select(v => new Tile(v.Name, v.Summary, _group, v, false));

        var q = SearchBox.Text.Trim();
        if (q.Length == 0) return all;
        return all.Where(t =>
            Contains(t.Title, q) || Contains(t.Subtitle, q) || Contains(t.Module.Id, q) ||
            t.Module.Manifest.Formats.Any(f => Contains(f, q)) ||
            (t.IsGroup && t.Module.Manifest.Variants.Any(v => Contains(v.Name, q))));
    }

    private static bool Contains(string text, string q) => text.Contains(q, StringComparison.CurrentCultureIgnoreCase);

    private void Render()
    {
        TitleText.Text = _group == null ? "Изберете клиент" : _group.Manifest.Name + " – изберете подклиент";
        BackButton.Visibility = _group == null ? Visibility.Collapsed : Visibility.Visible;
        SettingsButton.Visibility = _group == null ? Visibility.Visible : Visibility.Collapsed;

        TileGrid.Children.Clear();
        var tiles = BuildTiles().ToList();
        foreach (var t in tiles) TileGrid.Children.Add(MakeTile(t));
        CountText.Text = _group == null ? $"{tiles.Count} клиента" : $"{tiles.Count} подклиента";
        EmptyText.Visibility = tiles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private UIElement MakeTile(Tile t)
    {
        var key = t.Variant == null ? t.Module.Id : t.Module.Id + ":" + t.Variant.Id;
        var isOpen = _openKeys.Contains(key) || (t.IsGroup && _openKeys.Any(k => k.StartsWith(t.Module.Id + ":")));

        var name = new TextBlock
        {
            Text = t.Title, FontSize = 30, FontWeight = FontWeights.SemiBold,
            Foreground = (Brush)Application.Current.Resources["TileTextBrush"],
            TextAlignment = Microsoft.UI.Xaml.TextAlignment.Center, TextWrapping = TextWrapping.Wrap,
        };
        var rule = new Border
        {
            Width = 36, Height = 2, Margin = new Thickness(0, 6, 0, 2),
            Background = (Brush)Application.Current.Resources["BrassBrush"], HorizontalAlignment = HorizontalAlignment.Center,
        };
        var sub = new TextBlock
        {
            Text = t.IsGroup ? string.Join(" · ", t.Module.Manifest.Variants.Select(v => v.Name)) : t.Subtitle,
            FontSize = 14, Foreground = (Brush)Application.Current.Resources["TileSoftTextBrush"],
            TextAlignment = Microsoft.UI.Xaml.TextAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxLines = 2,
        };
        var stack = new StackPanel { Width = 300, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(name);
        stack.Children.Add(rule);
        stack.Children.Add(sub);

        var content = new Grid();
        content.Children.Add(new Viewbox { Child = stack, Stretch = Stretch.Uniform, Margin = new Thickness(20) });
        if (isOpen)
            content.Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse
            {
                Width = 12, Height = 12, Margin = new Thickness(0, 12, 12, 0),
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
                Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 94, 196, 120)),
            });

        var button = new Button
        {
            Style = (Style)Application.Current.Resources["TileButtonStyle"],
            Content = content, Tag = t,
        };
        ToolTipService.SetToolTip(button, string.IsNullOrEmpty(t.Subtitle) ? t.Title : $"{t.Title} – {t.Subtitle}");
        button.Click += (_, _) => Activate(t);
        return button;
    }

    private void Activate(Tile t)
    {
        if (t.IsGroup)
        {
            _group = t.Module;
            SearchBox.Text = "";
            Render();
            return;
        }
        OpenRequested?.Invoke(t.Module, t.Variant);
    }

    private void OnBack(object sender, RoutedEventArgs e)
    {
        _group = null;
        SearchBox.Text = "";
        Render();
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e) => Render();

    private void OnSearchKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter)
        {
            var first = BuildTiles().FirstOrDefault();
            if (first != null) Activate(first);
        }
        else if (e.Key == VirtualKey.Escape) SearchBox.Text = "";
    }

    private async void OnSettings(object sender, RoutedEventArgs e) =>
        await SettingsDialog.ShowAsync(XamlRoot, _hwnd, () => Render());
}
