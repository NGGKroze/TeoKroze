using System.Text.Json;

namespace LogisticsPacking.Core;

public sealed class AppSettings
{
    /// <summary>Къде се записват свалените файлове. Празно = Документи\Logistics Packing.</summary>
    public string OutputDirectory { get; set; } = "";
    /// <summary>true = показва "Запази като"; false = записва директно в папката за резултати.</summary>
    public bool AskWhereToSave { get; set; }
    /// <summary>Обща тема (мрамор/гранит) върху клиентските екрани. false = оригиналният им вид.</summary>
    public bool UnifiedTheme { get; set; } = true;

    public string ResolveOutputDirectory()
    {
        if (!string.IsNullOrWhiteSpace(OutputDirectory)) return OutputDirectory;
        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        if (string.IsNullOrEmpty(docs)) docs = Path.GetTempPath();
        return Path.Combine(docs, "Logistics Packing");
    }

    public static AppSettings Load(AppPaths paths)
    {
        try
        {
            if (File.Exists(paths.SettingsFile))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(paths.SettingsFile), ModuleManifest.JsonOptions) ?? new();
        }
        catch (Exception) { /* повреден файл -> настройки по подразбиране */ }
        return new AppSettings();
    }

    public void Save(AppPaths paths)
    {
        Directory.CreateDirectory(paths.UserRoot);
        File.WriteAllText(paths.SettingsFile, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Уникално име на файл в папката (име (2).xlsx), за да не се презаписват резултати.</summary>
    public static string UniquePath(string directory, string fileName)
    {
        fileName = string.Concat(fileName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
        if (string.IsNullOrWhiteSpace(fileName)) fileName = "file";
        var stem = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        var path = Path.Combine(directory, fileName);
        for (var i = 2; File.Exists(path); i++) path = Path.Combine(directory, $"{stem} ({i}){ext}");
        return path;
    }
}
