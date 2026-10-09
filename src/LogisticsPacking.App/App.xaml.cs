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
        CrashLog.Safe("тема", ThemeService.Init, logOk: true);   // стена, плочки и цветове според избраната тема
        try
        {
            _window = new MainWindow();
            CrashLog.Write("OK: главен прозорец създаден");
            _window.Activate();
            CrashLog.Write("OK: прозорецът е показан");
        }
        catch (Exception ex)
        {
            CrashLog.Write("СРИВ при създаване на прозореца: " + ex);
            throw;
        }
    }
}
