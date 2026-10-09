namespace LogisticsPacking.Core;

/// <summary>Общият engine (runtime\engine\run.py): един процес с OCR и PDF услуги за всички модули. Стартира се при първа нужда.</summary>
public sealed class EngineService
{
    private readonly AppPaths _paths;
    private readonly SidecarManager _sidecars;

    public EngineService(AppPaths paths, SidecarManager sidecars)
    {
        _paths = paths;
        _sidecars = sidecars;
    }

    public string EngineDir => Path.Combine(_paths.RuntimeDir, "engine");
    public bool Exists => File.Exists(Path.Combine(EngineDir, "run.py"));

    public async Task<Uri> EnsureStartedAsync(CancellationToken ct = default)
    {
        if (!Exists) throw new SidecarException("Липсва runtime\\engine (общият engine не е инсталиран).");
        var manifest = new ModuleManifest
        {
            Id = "_engine", Name = "Engine", Type = "python", Entry = "run.py",
            Python = new PythonSettings { Script = "run.py", Health = "/health", StartupTimeoutSec = 60 },
        };
        var handle = await _sidecars.StartAsync(new ModuleInfo(manifest, EngineDir, ModuleSource.Bundled), ct).ConfigureAwait(false);
        return handle.BaseUri;
    }
}
