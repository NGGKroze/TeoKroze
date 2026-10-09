using System.Diagnostics;
using LogisticsPacking.App.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage.Pickers;

namespace LogisticsPacking.App.Views;

/// <summary>Настройки: папка за резултати, "питай къде да запиша", потребителски модули, проблеми с модули.</summary>
internal static class SettingsDialog
{
    public static async Task ShowAsync(XamlRoot root, IntPtr hwnd, Action onSaved)
    {
        var settings = AppServices.Settings;

        var pathBox = new TextBox { Text = settings.ResolveOutputDirectory(), IsReadOnly = false, MinWidth = 380, Header = "Папка за резултати (свалените Excel / PDF файлове)" };
        var browse = new Button { Content = "Избери…" };
        browse.Click += async (_, _) =>
        {
            var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
            picker.FileTypeFilter.Add("*");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
            var folder = await picker.PickSingleFolderAsync();
            if (folder != null) pathBox.Text = folder.Path;
        };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(pathBox);
        row.Children.Add(new Border { Child = browse, VerticalAlignment = VerticalAlignment.Bottom });

        var ask = new ToggleSwitch
        {
            Header = "При сваляне", OnContent = "Питай къде да се запише", OffContent = "Записвай директно в папката за резултати",
            IsOn = settings.AskWhereToSave,
        };

        var theme = new ToggleSwitch
        {
            Header = "Вид на клиентските екрани", OnContent = "Единна тема (цветове на избраната тема)", OffContent = "Оригиналният вид на всеки клиент",
            IsOn = settings.UnifiedTheme,
        };

        var layout = new ToggleSwitch
        {
            Header = "Подредба на клиентските екрани", OnContent = "Единна (заглавие, ляв панел, лента с действия)", OffContent = "Оригиналната на всеки клиент",
            IsOn = settings.UnifiedLayout,
        };
        var bg = new ToggleSwitch
        {
            Header = "Език на клиентските екрани", OnContent = "Български", OffContent = "Оригинален (английски/френски)",
            IsOn = settings.BulgarianUi,
        };

        var userModules = new HyperlinkButton { Content = "Отвори папката с потребителски модули (поправки без нов инсталатор)" };
        userModules.Click += (_, _) =>
        {
            Directory.CreateDirectory(AppServices.Paths.UserModules);
            Process.Start(new ProcessStartInfo(AppServices.Paths.UserModules) { UseShellExecute = true });
        };
        var logs = new HyperlinkButton { Content = "Отвори папката с логове" };
        logs.Click += (_, _) => Process.Start(new ProcessStartInfo(AppServices.Paths.LogsDir) { UseShellExecute = true });

        var panel = new StackPanel { Spacing = 14 };
        panel.Children.Add(row);
        panel.Children.Add(ask);
        panel.Children.Add(theme);
        panel.Children.Add(layout);
        panel.Children.Add(bg);
        panel.Children.Add(userModules);
        panel.Children.Add(logs);

        var problems = AppServices.Catalog.Problems;
        if (problems.Count > 0)
        {
            panel.Children.Add(new TextBlock { Text = $"Модули с проблем ({problems.Count}):", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            panel.Children.Add(new TextBlock
            {
                Text = string.Join("\n", problems.Select(p => $"{Path.GetFileName(p.Directory)}: {p.Message}")),
                TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true, Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 176, 48, 48)),
            });
        }
        panel.Children.Add(new TextBlock { Text = $"Намерени клиенти: {AppServices.Catalog.Modules.Count}", Opacity = 0.6 });

        var dialog = new ContentDialog
        {
            XamlRoot = root, Title = "Настройки", Content = panel,
            RequestedTheme = ThemeService.ElementTheme, PrimaryButtonText = "Запази", CloseButtonText = "Отказ", DefaultButton = ContentDialogButton.Primary,
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            settings.OutputDirectory = pathBox.Text.Trim();
            settings.AskWhereToSave = ask.IsOn;
            settings.UnifiedTheme = theme.IsOn;
            settings.BulgarianUi = bg.IsOn;
            settings.UnifiedLayout = layout.IsOn;
            try { settings.Save(AppServices.Paths); }
            catch (Exception ex) { AppServices.Log("Запис на настройки: " + ex.Message); }
            AppServices.ApplySettings();
            onSaved();
        }
    }
}
