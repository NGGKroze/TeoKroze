using System.Text.Json;
using System.Text.Json.Serialization;

namespace LogisticsPacking.Core;

/// <summary>Съдържанието на module.json - единственото, което обвивката знае за даден клиент.</summary>
public sealed class ModuleManifest
{
    public int Schema { get; init; } = 1;
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Version { get; init; } = "1.0.0";
    /// <summary>"html" (статични файлове в WebView2) или "python" (локален сървър).</summary>
    public string Type { get; init; } = "html";
    /// <summary>html: входен файл (index.html). python: скрипт за стартиране (run.py).</summary>
    public string Entry { get; init; } = "index.html";
    public int Order { get; init; }
    public bool Enabled { get; init; } = true;
    /// <summary>false = модулът се показва със собствения си вид (без общата тема).</summary>
    public bool Theme { get; init; } = true;
    public string Summary { get; init; } = "";
    public string Note { get; init; } = "";
    public List<string> Requires { get; init; } = new();
    public List<string> Formats { get; init; } = new();
    public PythonSettings? Python { get; init; }
    /// <summary>Подклиенти (напр. L'Oréal -> Valentino / Prada / Biotherm).</summary>
    public List<ModuleVariant> Variants { get; init; } = new();
    /// <summary>JS грешки на страницата, които са известни от оригинала (само за тестове).</summary>
    public List<string> KnownPageErrors { get; init; } = new();

    [JsonIgnore] public bool IsPython => string.Equals(Type, "python", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore] public bool HasVariants => Variants.Count > 0;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static ModuleManifest Parse(string json) =>
        JsonSerializer.Deserialize<ModuleManifest>(json, JsonOptions)
        ?? throw new JsonException("Празен module.json");
}

public sealed class PythonSettings
{
    public string Script { get; init; } = "run.py";
    /// <summary>Предпочитан порт (за да се запазват настройките на страницата между стартиранията).</summary>
    public int Port { get; init; }
    public string Health { get; init; } = "/";
    public int StartupTimeoutSec { get; init; } = 90;
}

public sealed class ModuleVariant
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Summary { get; init; } = "";
    public string Note { get; init; } = "";
    public List<string> Requires { get; init; } = new();
    /// <summary>JavaScript, който се изпълнява след зареждане на страницата (избира режим/таб).</summary>
    public string OnLoad { get; init; } = "";
}
