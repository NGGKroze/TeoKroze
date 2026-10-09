namespace LogisticsPacking.Core;

public enum ModuleSource { Bundled, User }

/// <summary>Намерен модул: манифест + папка.</summary>
public sealed record ModuleInfo(ModuleManifest Manifest, string Directory, ModuleSource Source)
{
    public string Id => Manifest.Id;
    public string EntryPath => Path.Combine(Directory, Manifest.Entry);
}

public sealed record ModuleProblem(string Directory, string Message);

/// <summary>
/// Открива модулите. Счупен модул (невалиден module.json, липсващ входен файл) не пречи на останалите -
/// той просто се записва в <see cref="Problems"/>.
/// </summary>
public sealed class ModuleCatalog
{
    public IReadOnlyList<ModuleInfo> Modules { get; }
    public IReadOnlyList<ModuleProblem> Problems { get; }

    private ModuleCatalog(List<ModuleInfo> modules, List<ModuleProblem> problems)
    {
        Modules = modules;
        Problems = problems;
    }

    public ModuleInfo? Find(string id) =>
        Modules.FirstOrDefault(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase));

    public static ModuleCatalog Load(AppPaths paths) => Load(paths.BundledModules, paths.UserModules);

    public static ModuleCatalog Load(string bundledDir, string? userDir)
    {
        var problems = new List<ModuleProblem>();
        var byId = new Dictionary<string, ModuleInfo>(StringComparer.OrdinalIgnoreCase);

        // Първо вградените, после потребителските - те презаписват по id.
        foreach (var (dir, source) in new[] { (bundledDir, ModuleSource.Bundled), (userDir, ModuleSource.User) })
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
            foreach (var moduleDir in Directory.EnumerateDirectories(dir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(moduleDir);
                if (name.StartsWith('_') || name.StartsWith('.')) continue;
                var manifestPath = Path.Combine(moduleDir, "module.json");
                if (!File.Exists(manifestPath)) continue;
                try
                {
                    var manifest = ModuleManifest.Parse(File.ReadAllText(manifestPath));
                    var error = Validate(manifest, moduleDir);
                    if (error != null) { problems.Add(new ModuleProblem(moduleDir, error)); continue; }
                    byId[manifest.Id] = new ModuleInfo(manifest, moduleDir, source);
                }
                catch (Exception ex)
                {
                    problems.Add(new ModuleProblem(moduleDir, "module.json: " + ex.Message));
                }
            }
        }

        var modules = byId.Values
            .Where(m => m.Manifest.Enabled)
            .OrderBy(m => m.Manifest.Order).ThenBy(m => m.Manifest.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return new ModuleCatalog(modules, problems);
    }

    public static string? Validate(ModuleManifest m, string dir)
    {
        if (string.IsNullOrWhiteSpace(m.Id)) return "липсва id";
        if (m.Id.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))) return $"невалидно id '{m.Id}'";
        if (string.IsNullOrWhiteSpace(m.Name)) return "липсва name";
        if (m.IsEngine)
            return m.Entry.StartsWith('/') ? null : $"engine модулът иска entry, започващ с '/' (получено '{m.Entry}')";
        if (!m.Type.Equals("html", StringComparison.OrdinalIgnoreCase) && !m.IsPython) return $"непознат type '{m.Type}'";
        var entry = m.IsPython ? (m.Python?.Script ?? m.Entry) : m.Entry;
        if (Path.IsPathRooted(entry) || entry.Contains("..")) return $"невалиден entry '{entry}'";
        if (!File.Exists(Path.Combine(dir, entry))) return $"липсва входен файл '{entry}'";
        if (m.Variants.Any(v => string.IsNullOrWhiteSpace(v.Id) || string.IsNullOrWhiteSpace(v.Name))) return "вариант без id или name";
        return null;
    }
}
