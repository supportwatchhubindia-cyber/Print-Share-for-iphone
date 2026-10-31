namespace PrintShare.Bridge.Core.Logging;

public interface ILog
{
    void Debug(string message);
    void Info(string message);
    void Warn(string message);
    void Error(string message, Exception? ex = null);
}

/// <summary>Daily rolling text log in %LOCALAPPDATA%\PrintShare\Bridge\logs (14 days kept).</summary>
public sealed class FileLog : ILog
{
    private readonly object _gate = new();
    private readonly string _dir;
    public event Action<string, string>? Written; // level, message (for the UI activity view)

    public FileLog(string? dir = null)
    {
        _dir = dir ?? BridgePaths.LogsDir;
        Directory.CreateDirectory(_dir);
        try
        {
            foreach (var old in Directory.GetFiles(_dir, "bridge-*.log").Where(f => File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-14)))
                File.Delete(old);
        }
        catch (IOException) { /* best effort */ }
    }

    public void Debug(string message) => Write("DEBUG", message);
    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARN", message);
    public void Error(string message, Exception? ex = null) => Write("ERROR", ex is null ? message : $"{message}: {ex}");

    private void Write(string level, string message)
    {
        var line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [{level}] {message}";
        lock (_gate)
        {
            try
            {
                File.AppendAllText(Path.Combine(_dir, $"bridge-{DateTime.Now:yyyyMMdd}.log"), line + Environment.NewLine);
            }
            catch (IOException) { /* never let logging crash printing */ }
        }
        if (level != "DEBUG") Written?.Invoke(level, message);
    }
}
