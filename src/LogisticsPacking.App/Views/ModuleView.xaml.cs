using System.Diagnostics;
using LogisticsPacking.App.Services;
using LogisticsPacking.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace LogisticsPacking.App.Views;

/// <summary>Един отворен клиент: WebView2 (HTML) или WebView2 към локалния Python сървър на модула.</summary>
public sealed partial class ModuleView : UserControl, IDisposable
{
    public event EventHandler? BackRequested;
    public event EventHandler? CloseRequested;

    private readonly ModuleInfo _module;
    private readonly ModuleVariant? _variant;
    private SidecarHandle? _sidecar;
    private bool _coreReady;
    private bool _onLoadDone;
    private string? _lastDownload;
    private string? _logPath;
    private bool _disposed;

    public ModuleView(ModuleInfo module, ModuleVariant? variant)
    {
        _module = module;
        _variant = variant;
        InitializeComponent();
        NameText.Text = variant == null ? module.Manifest.Name : $"{module.Manifest.Name} – {variant.Name}";
        SummaryText.Text = variant?.Summary ?? module.Manifest.Summary;
        BuildInfoFlyout();
    }

    private string HostName => _module.Id + ".lps.local";

    public async Task LoadAsync()
    {
        if (_disposed) return;
        ShowLoading(_module.Manifest.IsPython ? "Стартира се модулът…" : "Зарежда се…");
        try
        {
            await Web.EnsureCoreWebView2Async();
            if (!_coreReady) SetupCore();

            Uri target;
            if (_module.Manifest.IsPython)
            {
                _sidecar = await AppServices.Sidecars.StartAsync(_module);
                _logPath = _sidecar.LogPath;
                target = _sidecar.BaseUri;
            }
            else
            {
                Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    HostName, _module.Directory, CoreWebView2HostResourceAccessKind.Allow);
                target = new Uri($"https://{HostName}/{_module.Manifest.Entry}");
            }
            _onLoadDone = false;
            Web.CoreWebView2.Navigate(target.AbsoluteUri);
        }
        catch (SidecarException ex)
        {
            ShowError(ex.Message, ex.LogPath);
        }
        catch (Exception ex)
        {
            AppServices.Log($"{_module.Id}: {ex}");
            var msg = ex.Message;
            if (ex is System.Runtime.InteropServices.COMException || ex.GetType().Name.Contains("WebView2"))
                msg = "Липсва или не стартира Microsoft Edge WebView2 Runtime. Инсталирайте го от Microsoft и стартирайте програмата отново.\n\n" + ex.Message;
            ShowError(msg, null);
        }
    }

    private void SetupCore()
    {
        var core = Web.CoreWebView2;
        var s = core.Settings;
        s.IsStatusBarEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreDefaultScriptDialogsEnabled = true;

        core.NavigationCompleted += async (_, e) =>
        {
            if (_disposed) return;
            LoadingPanel.Visibility = Visibility.Collapsed;
            if (!e.IsSuccess)
            {
                ShowError($"Страницата не се зареди ({e.WebErrorStatus}).", _logPath);
                return;
            }
            if (!_onLoadDone && !string.IsNullOrWhiteSpace(_variant?.OnLoad))
            {
                _onLoadDone = true;
                try { await core.ExecuteScriptAsync(_variant!.OnLoad); }
                catch (Exception ex) { AppServices.Log($"{_module.Id}/{_variant!.Id} onLoad: {ex.Message}"); }
            }
        };

        // Външни връзки (http/https извън модула) се отварят в браузъра по подразбиране.
        core.NavigationStarting += (sender, e) =>
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u)) return;
            var local = u.Host == HostName || u.Host == "127.0.0.1" || u.Host == "localhost" || u.Scheme is "about" or "data" or "blob";
            if (!local && u.Scheme is "http" or "https")
            {
                e.Cancel = true;
                _ = Windows.System.Launcher.LaunchUriAsync(u);
            }
        };

        core.DownloadStarting += OnDownloadStarting;

        // Обща тема: вкарва се преди скриптовете на страницата (може да се изключи в Настройки или в module.json).
        if (AppServices.Settings.UnifiedTheme)
        {
            var themeScript = ThemeInjector.BuildScript(AppServices.Paths, _module);
            if (themeScript != null) _ = core.AddScriptToExecuteOnDocumentCreatedAsync(themeScript);
        }
        if (AppServices.Settings.UnifiedLayout)
        {
            var layoutScript = ThemeInjector.BuildLayoutScript(AppServices.Paths, _module);
            if (layoutScript != null) _ = core.AddScriptToExecuteOnDocumentCreatedAsync(layoutScript);
        }
        if (AppServices.Settings.BulgarianUi)
        {
            var i18nScript = ThemeInjector.BuildI18nScript(AppServices.Paths, _module);
            if (i18nScript != null) _ = core.AddScriptToExecuteOnDocumentCreatedAsync(i18nScript);
        }
        // Общ engine (OCR/PDF): страницата го иска през LPS.engine, обвивката го стартира и връща адреса.
        var engineScript = ThemeInjector.BuildEngineScript(AppServices.Paths);
        if (engineScript != null)
        {
            _ = core.AddScriptToExecuteOnDocumentCreatedAsync(engineScript);
            core.WebMessageReceived += OnWebMessage;
        }
        _coreReady = true;
    }

    private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(e.WebMessageAsJson);
            if (!doc.RootElement.TryGetProperty("cmd", out var cmd) || cmd.GetString() != "engine.start") return;
            try
            {
                var uri = await AppServices.Engine.EnsureStartedAsync();
                sender.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(new { cmd = "engine.ready", url = uri.GetLeftPart(UriPartial.Authority) }));
            }
            catch (Exception ex)
            {
                AppServices.Log("Engine: " + ex.Message);
                sender.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(new { cmd = "engine.error", message = ex.Message }));
            }
        }
        catch (Exception ex) { AppServices.Log("WebMessage: " + ex.Message); }
    }

    private void OnDownloadStarting(CoreWebView2 sender, CoreWebView2DownloadStartingEventArgs e)
    {
        if (AppServices.Settings.AskWhereToSave) return; // стандартният диалог "Запази като"

        try
        {
            var dir = Path.Combine(AppServices.Settings.ResolveOutputDirectory(), SafeName(_module.Manifest.Name));
            Directory.CreateDirectory(dir);
            var path = AppSettings.UniquePath(dir, Path.GetFileName(e.ResultFilePath));
            e.ResultFilePath = path;
            e.Handled = true;
            e.DownloadOperation.StateChanged += (op, _) =>
            {
                if (op.State == CoreWebView2DownloadState.Completed)
                {
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        _lastDownload = path;
                        DownloadBar.Message = path;
                        DownloadBar.IsOpen = true;
                    });
                }
                else if (op.State == CoreWebView2DownloadState.Interrupted)
                {
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        DownloadBar.Severity = InfoBarSeverity.Error;
                        DownloadBar.Title = "Свалянето е прекъснато";
                        DownloadBar.Message = Path.GetFileName(path);
                        DownloadBar.IsOpen = true;
                    });
                }
            };
            DownloadBar.Severity = InfoBarSeverity.Success;
            DownloadBar.Title = "Файлът е записан";
        }
        catch (Exception ex)
        {
            AppServices.Log($"Сваляне: {ex}");
        }
    }

    private static string SafeName(string name) =>
        string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)).Trim();

    private void BuildInfoFlyout()
    {
        var m = _module.Manifest;
        var requires = _variant?.Requires.Count > 0 ? _variant.Requires : m.Requires;
        var note = !string.IsNullOrEmpty(_variant?.Note) ? _variant!.Note : m.Note;

        var panel = new StackPanel { Spacing = 8, MaxWidth = 460 };
        panel.Children.Add(new TextBlock { Text = "Нужни файлове", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 16 });
        foreach (var r in requires)
            panel.Children.Add(new TextBlock { Text = "•  " + r, TextWrapping = TextWrapping.Wrap });
        if (requires.Count == 0) panel.Children.Add(new TextBlock { Text = "—" });
        if (m.Formats.Count > 0)
            panel.Children.Add(new TextBlock { Text = "Формати: " + string.Join(", ", m.Formats), Opacity = 0.7 });
        if (!string.IsNullOrWhiteSpace(note))
            panel.Children.Add(new TextBlock { Text = note, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
        panel.Children.Add(new TextBlock { Text = $"Версия на модула: {m.Version}", Opacity = 0.5, FontSize = 12, Margin = new Thickness(0, 6, 0, 0) });
        InfoFlyout.Content = panel;
    }

    private void ShowLoading(string text)
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        LoadingText.Text = text;
        LoadingPanel.Visibility = Visibility.Visible;
    }

    private void ShowError(string message, string? logPath)
    {
        LoadingPanel.Visibility = Visibility.Collapsed;
        ErrorText.Text = message;
        _logPath = logPath ?? _logPath;
        OpenLogButton.Visibility = !string.IsNullOrEmpty(_logPath) && File.Exists(_logPath) ? Visibility.Visible : Visibility.Collapsed;
        ErrorPanel.Visibility = Visibility.Visible;
    }

    private async void OnReload(object sender, RoutedEventArgs e)
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        if (_module.Manifest.IsPython && (_sidecar == null || !_sidecar.IsRunning)) { await LoadAsync(); return; }
        if (!_coreReady) { await LoadAsync(); return; }
        _onLoadDone = false;
        ShowLoading("Зарежда се…");
        Web.CoreWebView2.Reload();
    }

    private void OnBack(object sender, RoutedEventArgs e) => BackRequested?.Invoke(this, EventArgs.Empty);
    private void OnClose(object sender, RoutedEventArgs e) => CloseRequested?.Invoke(this, EventArgs.Empty);

    private void OnOpenResults(object sender, RoutedEventArgs e)
    {
        var dir = Path.Combine(AppServices.Settings.ResolveOutputDirectory(), SafeName(_module.Manifest.Name));
        if (!Directory.Exists(dir)) dir = AppServices.Settings.ResolveOutputDirectory();
        Directory.CreateDirectory(dir);
        Shell(dir);
    }

    private void OnOpenLog(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_logPath) && File.Exists(_logPath)) Shell(_logPath);
    }

    private void OnOpenDownloadedFile(object sender, RoutedEventArgs e)
    {
        if (_lastDownload != null && File.Exists(_lastDownload)) Shell(_lastDownload);
    }

    private void OnShowDownloadedFile(object sender, RoutedEventArgs e)
    {
        if (_lastDownload != null && File.Exists(_lastDownload))
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_lastDownload}\"") { UseShellExecute = true });
    }

    private static void Shell(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        catch (Exception ex) { AppServices.Log($"Отваряне на {path}: {ex.Message}"); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { Web.Close(); } catch (Exception) { /* вече е затворен */ }
        if (_module.Manifest.IsPython) AppServices.Sidecars.Stop(_module.Id);
    }
}
