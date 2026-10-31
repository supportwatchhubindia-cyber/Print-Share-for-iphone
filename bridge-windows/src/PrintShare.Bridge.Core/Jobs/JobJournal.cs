using System.Text.Json;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Config;

namespace PrintShare.Bridge.Core.Jobs;

public enum JournalStage
{
    Received,
    Downloaded,
    /// <summary>Print() has started: data may already be in the Windows queue. Never spool this attempt again.</summary>
    Spooling,
    /// <summary>The spooler job id is known.</summary>
    Spooled,
    Finished,
}

public sealed class JournalEntry
{
    public required string JobId { get; init; }
    public required int Attempt { get; init; }
    public JournalStage Stage { get; set; }
    public string? PrinterName { get; set; }
    public string? DocumentTitle { get; set; }
    public int? SpoolJobId { get; set; }
    public bool SpoolCompleted { get; set; }
    public bool SeenPrinting { get; set; }
    public bool SeenPrintedFlag { get; set; }
    public bool SeenCompleteFlag { get; set; }
    /// <summary>Final status not yet acknowledged by the server (re-sent after reconnect/restart).</summary>
    public StatusReport? PendingReport { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public string Key => $"{JobId}#{Attempt}";
}

/// <summary>
/// Durable per-attempt record of what the bridge has done. This is what prevents duplicate printing:
/// once an attempt reaches <see cref="JournalStage.Spooling"/> it is never sent to Windows again,
/// even if the bridge crashes and the server hands the job back as "in flight".
/// </summary>
public sealed class JobJournal
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };
    private readonly string _path;
    private readonly object _gate = new();
    private readonly Dictionary<string, JournalEntry> _entries;

    public JobJournal(string? path = null)
    {
        _path = path ?? BridgePaths.JournalFile;
        _entries = Load(_path);
    }

    private static Dictionary<string, JournalEntry> Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return new();
            var list = JsonSerializer.Deserialize<List<JournalEntry>>(File.ReadAllText(path), Json) ?? new();
            return list.ToDictionary(e => e.Key);
        }
        catch (JsonException)
        {
            File.Copy(path, path + ".corrupt", overwrite: true);
            return new();
        }
    }

    public JournalEntry? Get(string jobId, int attempt)
    {
        lock (_gate) return _entries.GetValueOrDefault($"{jobId}#{attempt}");
    }

    public void Save(JournalEntry entry)
    {
        lock (_gate)
        {
            entry.UpdatedAt = DateTimeOffset.UtcNow;
            _entries[entry.Key] = entry;
            Persist();
        }
    }

    public void Remove(string jobId, int attempt)
    {
        lock (_gate)
        {
            if (_entries.Remove($"{jobId}#{attempt}")) Persist();
        }
    }

    public IReadOnlyList<JournalEntry> PendingReports()
    {
        lock (_gate) return _entries.Values.Where(e => e.PendingReport is not null).ToList();
    }

    public int Prune(TimeSpan olderThan)
    {
        lock (_gate)
        {
            var cutoff = DateTimeOffset.UtcNow - olderThan;
            var stale = _entries.Values.Where(e => e.UpdatedAt < cutoff && e.PendingReport is null).Select(e => e.Key).ToList();
            foreach (var key in stale) _entries.Remove(key);
            if (stale.Count > 0) Persist();
            return stale.Count;
        }
    }

    private void Persist() => AtomicFile.WriteAllText(_path, JsonSerializer.Serialize(_entries.Values.ToList(), Json));
}
