using LogisticsPacking.App.Services;
using Microsoft.UI.Xaml;

namespace LogisticsPacking.App;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        AppServices.Init();
        UnhandledException += (_, e) =>
        {
            AppServices.Log("Необработена грешка: " + e.Exception);
            e.Handled = true; // една счупена страница не бива да затваря цялата програма
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
