using System.Collections.Concurrent;
using System.Text.Json;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Config;
using PrintShare.Bridge.Core.Jobs;
using PrintShare.Bridge.Core.Logging;
using PrintShare.Bridge.Core.Printing;

namespace PrintShare.Bridge.Core;

public enum BridgeState
{
    NotPaired,
    Connecting,
    Online,
    Paused,
    Offline,
    Revoked,
}

public sealed record SharedPrinterStatus(string Name, string? DriverName, string State, string? Message, bool Registered, bool IsHpM1005);

public sealed record BridgeSnapshot(
    BridgeState State,
    string? Server,
    string? Account,
    bool RealtimeConnected,
    IReadOnlyList<SharedPrinterStatus> Printers,
    int ActiveJobs,
    string? LastError,
    DateTimeOffset? LastHeartbeat);

/// <summary>
/// The bridge runtime: heartbeat + printer status, job polling (accelerated by WebSocket pushes),
/// per-printer sequential job execution, cancellation, and automatic reconnect with backoff.
/// Hosted by the tray app or by the --headless mode.
/// </summary>
public sealed class BridgeService : IAsyncDisposable
{
    private readonly FileLog _log;
    private readonly PrinterDiscovery _discovery;
    private readonly JobJournal _journal = new();
    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly ConcurrentDictionary<string, (BridgeJob Job, CancellationTokenSource Cancel)> _active = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _printerLocks = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, (DateTime At, DriverCapabilities? Caps)> _capsCache = new(StringComparer.OrdinalIgnoreCase);

    private CancellationTokenSource? _runCts;
    private Task? _runTask;
    private BridgeState _state = BridgeState.NotPaired;
    private bool _realtime;
    private string? _lastError;
    private DateTimeOffset? _lastHeartbeat;
    private Dictionary<string, string> _registered = new(StringComparer.OrdinalIgnoreCase); // systemName -> printerId
    private IReadOnlyList<SharedPrinterStatus> _printerStatus = Array.Empty<SharedPrinterStatus>();

    public BridgeSettings Settings { get; private set; } = BridgeSettings.Load();
    public ILog Log => _log;

    public event Action<BridgeSnapshot>? Changed;
    /// <summary>Raised when a job reaches a final state (for tray notifications).</summary>
    public event Action<JobResult>? JobFinished;

    public BridgeService(FileLog? log = null)
    {
        _log = log ?? new FileLog();
        _discovery = new PrinterDiscovery(_log);
    }

    public BridgeSnapshot Snapshot => new(_state, Settings.ServerUrl, Settings.AccountEmail, _realtime, _printerStatus, _active.Count, _lastError, _lastHeartbeat);

    public IReadOnlyList<LocalPrinter> LocalPrinters() => _discovery.Discover();

    public void Start()
    {
        if (_runTask is { IsCompleted: false }) return;
        if (!Settings.IsPaired || SecretStore.Load() is not { } token)
        {
            SetState(BridgeState.NotPaired);
            return;
        }
        _runCts = new CancellationTokenSource();
        var server = new Uri(Settings.ServerUrl!);
        _runTask = Task.Run(() => RunAsync(server, token, _runCts.Token));
    }

    public async Task StopAsync()
    {
        if (_runCts is null) return;
        _runCts.Cancel();
        try { if (_runTask is not null) await _runTask; } catch (OperationCanceledException) { }
        _runCts.Dispose();
        _runCts = null;
    }

    /// <summary>Exchanges a one-time pairing code for credentials, stores them with DPAPI, and starts.</summary>
    public async Task PairAsync(string serverInput, string pairingCode, CancellationToken ct)
    {
        var server = ServerAddress.Normalize(serverInput);
        var result = await BridgeApiClient.RegisterAsync(server, new RegisterRequest(pairingCode.Trim(), AppInfo.MachineName, AppInfo.OsDescription, AppInfo.Version), ct);
        await StopAsync();
        SecretStore.Save(result.BridgeToken);
        Settings.ServerUrl = server.ToString();
        Settings.BridgeId = result.BridgeId;
        Settings.AccountName = result.Account.Name;
        Settings.AccountEmail = result.Account.Email;
        if (Settings.SharedPrinters.Count == 0)
        {
            // Share the HP LaserJet M1005 by default when it is installed; the user can change this.
            Settings.SharedPrinters.AddRange(_discovery.Discover().Where(p => p.IsHpM1005).Select(p => p.Name));
        }
        Settings.Save();
        _log.Info($"Paired with {server} as {result.Account.Email} (bridge {result.BridgeId})");
        Start();
    }

    public async Task UnpairAsync()
    {
        await StopAsync();
        SecretStore.Delete();
        Settings.BridgeId = null;
        Settings.AccountEmail = null;
        Settings.AccountName = null;
        Settings.Save();
        _registered.Clear();
        SetState(BridgeState.NotPaired);
    }

    public void SetPaused(bool paused)
    {
        Settings.Paused = paused;
        Settings.Save();
        _log.Info(paused ? "Printing paused by user" : "Printing resumed");
        Wake();
        Publish();
    }

    public void SetShared(string printerName, bool shared)
    {
        Settings.SharedPrinters.RemoveAll(p => string.Equals(p, printerName, StringComparison.OrdinalIgnoreCase));
        if (shared) Settings.SharedPrinters.Add(printerName);
        Settings.Save();
        Wake();
    }

    public void SetVirtualOutputDir(string? dir)
    {
        Settings.VirtualPrinterOutputDir = string.IsNullOrWhiteSpace(dir) ? null : dir;
        Settings.Save();
    }

    public void Wake()
    {
        if (_wake.CurrentCount == 0)
        {
            try { _wake.Release(); } catch (SemaphoreFullException) { }
        }
    }

    private async Task RunAsync(Uri server, string token, CancellationToken ct)
    {
        using var api = new BridgeApiClient(server, token);
        var runner = new JobRunner(api, _discovery, new PdfPrinter(_log), _journal, () => Settings, _log);
        var realtime = new RealtimeClient(server, token, _log);
        realtime.ConnectionChanged += connected =>
        {
            _realtime = connected;
            if (connected) Wake();
            Publish();
        };
        realtime.MessageReceived += (type, payload) => OnRealtime(type, payload);
        var realtimeTask = realtime.RunAsync(ct);

        _journal.Prune(TimeSpan.FromDays(14));
        SetState(BridgeState.Connecting);
        var backoff = TimeSpan.FromSeconds(2);
        var heartbeatEvery = TimeSpan.FromSeconds(20);
        var pollEvery = TimeSpan.FromSeconds(15);
        var lastHeartbeat = DateTime.MinValue;
        var pendingFlushed = false;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (DateTime.UtcNow - lastHeartbeat >= heartbeatEvery || _state is BridgeState.Connecting or BridgeState.Offline)
                {
                    var hb = await HeartbeatAsync(api, ct);
                    lastHeartbeat = DateTime.UtcNow;
                    heartbeatEvery = TimeSpan.FromSeconds(Math.Clamp(hb.HeartbeatIntervalSeconds, 5, 120));
                    pollEvery = TimeSpan.FromSeconds(Math.Clamp(hb.PollIntervalSeconds, 5, 120));
                    foreach (var id in hb.CancelJobIds) CancelJob(id);
                }
                if (!pendingFlushed)
                {
                    await FlushPendingReportsAsync(runner, ct);
                    pendingFlushed = true;
                }
                if (!Settings.Paused) await PollAsync(api, runner, ct);
                backoff = TimeSpan.FromSeconds(2);
                _lastError = null;
                SetState(Settings.Paused ? BridgeState.Paused : BridgeState.Online);
                await WaitAsync(pollEvery < heartbeatEvery ? pollEvery : heartbeatEvery, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (BridgeUnauthorizedException ex)
            {
                _log.Warn($"Server rejected the bridge credentials: {ex.Message}");
                _lastError = "This bridge was disconnected from your PrintShare account. Pair it again.";
                SetState(BridgeState.Revoked);
                break;
            }
            catch (Exception ex)
            {
                _lastError = ex is HttpRequestException or TaskCanceledException ? $"Cannot reach {server.Host}: {ex.Message}" : ex.Message;
                _log.Warn($"Connection problem: {ex.Message} (retrying in {backoff.TotalSeconds:0}s)");
                SetState(BridgeState.Offline);
                await WaitAsync(backoff, ct).ConfigureAwait(false);
                backoff = TimeSpan.FromSeconds(Math.Min(60, backoff.TotalSeconds * 2));
            }
        }

        foreach (var (_, (_, cancel)) in _active) cancel.Dispose();
        try { await realtimeTask; } catch (OperationCanceledException) { }
        _realtime = false;
    }

    private async Task WaitAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await _wake.WaitAsync(delay, ct); } catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
    }

    private async Task<HeartbeatResponse> HeartbeatAsync(BridgeApiClient api, CancellationToken ct)
    {
        var shared = _discovery.Discover()
            .Where(p => Settings.SharedPrinters.Contains(p.Name, StringComparer.OrdinalIgnoreCase))
            .ToList();
        var reports = shared.Select(p => new PrinterReport(p.Name, p.DriverName, p.PortName, p.IsDefault, p.State.State, p.State.Message, Capabilities(p.Name))).ToList();
        var hb = await api.HeartbeatAsync(new HeartbeatRequest(AppInfo.Version, AppInfo.OsDescription, Settings.Paused, reports), ct);
        _lastHeartbeat = DateTimeOffset.Now;
        _registered = hb.Printers.Where(p => p.SystemName is not null)
            .GroupBy(p => p.SystemName!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        _printerStatus = shared.Select(p => new SharedPrinterStatus(p.Name, p.DriverName, p.State.State, p.State.Message, _registered.ContainsKey(p.Name), p.IsHpM1005)).ToList();
        return hb;
    }

    private DriverCapabilities? Capabilities(string printerName)
    {
        if (_capsCache.TryGetValue(printerName, out var cached) && DateTime.UtcNow - cached.At < TimeSpan.FromMinutes(10)) return cached.Caps;
        var caps = _discovery.ReadCapabilities(printerName);
        _capsCache[printerName] = (DateTime.UtcNow, caps);
        return caps;
    }

    private async Task PollAsync(BridgeApiClient api, JobRunner runner, CancellationToken ct)
    {
        var ready = _printerStatus.Where(p => p.Registered && p.State is "READY" or "PRINTING")
            .Select(p => _registered[p.Name])
            .ToList();
        var jobs = await api.GetJobsAsync(ready, ct);
        foreach (var job in jobs)
        {
            if (_active.TryGetValue(job.Key, out var running))
            {
                if (job.CancelRequested && !running.Cancel.IsCancellationRequested) running.Cancel.Cancel();
                continue;
            }
            var cancel = new CancellationTokenSource();
            if (job.CancelRequested) cancel.Cancel();
            if (!_active.TryAdd(job.Key, (job, cancel))) continue;
            _log.Info($"Received job #{job.JobNumber} \"{job.DocumentName}\" for {job.PrinterSystemName}");
            _ = Task.Run(() => ExecuteAsync(runner, job, cancel, ct), CancellationToken.None);
        }
        Publish();
    }

    private async Task ExecuteAsync(JobRunner runner, BridgeJob job, CancellationTokenSource cancel, CancellationToken ct)
    {
        var gate = _printerLocks.GetOrAdd(job.PrinterSystemName, _ => new SemaphoreSlim(1, 1));
        try
        {
            await gate.WaitAsync(ct);
            try
            {
                var result = await runner.RunAsync(job, cancel, ct);
                if (result is not null) JobFinished?.Invoke(result);
            }
            finally
            {
                gate.Release();
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutting down: the journal lets the next start resume this attempt safely.
        }
        catch (BridgeUnauthorizedException)
        {
            SetState(BridgeState.Revoked);
        }
        catch (Exception ex)
        {
            // Network failures before spooling are safe to retry: the job comes back as in-flight.
            _log.Error($"Job #{job.JobNumber} interrupted", ex);
        }
        finally
        {
            _active.TryRemove(job.Key, out _);
            cancel.Dispose();
            Publish();
            Wake();
        }
    }

    private async Task FlushPendingReportsAsync(JobRunner runner, CancellationToken ct)
    {
        foreach (var entry in _journal.PendingReports())
        {
            _log.Info($"Re-sending final status {entry.PendingReport!.Status} for job {entry.JobId}");
            await runner.DeliverFinalAsync(entry.JobId, entry, entry.PendingReport, ct);
        }
    }

    private void CancelJob(string jobId)
    {
        foreach (var (_, (job, cancel)) in _active)
        {
            if (job.Id != jobId || cancel.IsCancellationRequested) continue;
            _log.Info($"Cancel requested for job #{job.JobNumber}");
            cancel.Cancel();
        }
    }

    private void OnRealtime(string type, JsonElement payload)
    {
        switch (type)
        {
            case "job.available":
                Wake();
                break;
            case "job.cancel" when payload.TryGetProperty("jobId", out var id) && id.GetString() is { } jobId:
                CancelJob(jobId);
                break;
            case "printers.refresh":
                _log.Info("Printer refresh requested from the web dashboard");
                _capsCache.Clear();
                _state = BridgeState.Connecting; // forces an immediate heartbeat
                Wake();
                break;
            case "bridge.revoked":
                _lastError = "This bridge was disconnected from your PrintShare account. Pair it again.";
                SetState(BridgeState.Revoked);
                _runCts?.Cancel();
                break;
        }
    }

    private void SetState(BridgeState state)
    {
        _state = state;
        Publish();
    }

    private void Publish() => Changed?.Invoke(Snapshot);

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _wake.Dispose();
    }
}
