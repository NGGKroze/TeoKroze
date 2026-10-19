using LogisticsPacking.App.Services;
using Microsoft.UI.Xaml;

namespace LogisticsPacking.App;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        CrashLog.Hook();
        UnhandledException += (_, e) =>
        {
            CrashLog.Write("Необработена грешка: " + e.Exception);
            try { AppServices.Log("Необработена грешка: " + e.Exception); } catch (Exception) { }
            e.Handled = true; // една счупена страница не бива да затваря цялата програма
        };
        try
        {
            InitializeComponent();
            CrashLog.Write("OK: App.xaml (ресурси)");
            AppServices.Init();
            CrashLog.Write("OK: услуги и каталог на модулите");
        }
        catch (Exception ex)
        {
            CrashLog.Write("СРИВ при стартиране: " + ex);
            throw;
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // Ако предишното стартиране не е стигнало до стабилно състояние (срив) -> безопасен режим: с основната тема.
        var safeMode = CrashLog.BeginAttempt();
        if (safeMode)
        {
            CrashLog.Write("!!! Предишното стартиране е прекъснато - безопасен режим (тема Гранит).");
            AppServices.Settings.Theme = LogisticsPacking.Core.ThemeCatalog.FallbackId;
            CrashLog.Safe("запис на настройките", () => AppServices.Settings.Save(AppServices.Paths));
        }
        CrashLog.Safe("тема", ThemeService.Init, logOk: true);   // стена, плочки и цветове според избраната тема
        try
        {
            _window = new MainWindow();
            _window.Closed += (_, _) => CrashLog.EndAttempt();
            CrashLog.Write("OK: главен прозорец създаден");
            _window.Activate();
            CrashLog.Write("OK: прозорецът е показан");
            // след 12 секунди без срив стартирането се смята за успешно
            var timer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
            timer.Interval = TimeSpan.FromSeconds(12);
            timer.IsRepeating = false;
            timer.Tick += (_, _) => { CrashLog.EndAttempt(); CrashLog.Write("OK: стабилен старт"); };
            timer.Start();
        }
        catch (Exception ex)
        {
            CrashLog.Write("СРИВ при създаване на прозореца: " + ex);
            throw;
        }
    }
}
