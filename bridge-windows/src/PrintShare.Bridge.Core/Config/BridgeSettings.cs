using System.Text.Json;

namespace PrintShare.Bridge.Core.Config;

/// <summary>Non-secret bridge settings persisted as JSON. The bridge credential lives in <see cref="SecretStore"/>.</summary>
public sealed class BridgeSettings
{
    public string? ServerUrl { get; set; }
    public string? BridgeId { get; set; }
    public string? AccountName { get; set; }
    public string? AccountEmail { get; set; }

    /// <summary>Windows printer queue names the user chose to share with PrintShare.</summary>
    public List<string> SharedPrinters { get; set; } = new();

    public bool Paused { get; set; }
    public bool AutoStartPrompted { get; set; }

    /// <summary>
    /// Folder for output of virtual printers that normally prompt for a file name
    /// (e.g. "Microsoft Print to PDF"). Lets the full pipeline be tested without hardware.
    /// </summary>
    public string? VirtualPrinterOutputDir { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsPaired => !string.IsNullOrWhiteSpace(ServerUrl) && !string.IsNullOrWhiteSpace(BridgeId);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly object Gate = new();

    public static BridgeSettings Load(string? path = null)
    {
        path ??= BridgePaths.SettingsFile;
        lock (Gate)
        {
            try
            {
                if (File.Exists(path))
                    return JsonSerializer.Deserialize<BridgeSettings>(File.ReadAllText(path), Json) ?? new BridgeSettings();
            }
            catch (JsonException)
            {
                // Corrupt settings: keep a copy for diagnosis and start fresh rather than crash.
                File.Copy(path, path + ".corrupt", overwrite: true);
            }
            return new BridgeSettings();
        }
    }

    public void Save(string? path = null)
    {
        path ??= BridgePaths.SettingsFile;
        lock (Gate)
        {
            AtomicFile.WriteAllText(path, JsonSerializer.Serialize(this, Json));
        }
    }
}
