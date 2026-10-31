using System.Text.Json.Serialization;

namespace PrintShare.Bridge.Core.Api;

// Wire contracts for /api/bridge/*. Mirrors web/src/server/bridge/service.ts and printing/jobs.ts.

public sealed record RegisterRequest(string PairingCode, string Name, string Os, string AppVersion);

public sealed record AccountInfo(string Name, string Email);

public sealed record RegisterResponse(string BridgeId, string BridgeToken, AccountInfo Account, int HeartbeatIntervalSeconds, int PollIntervalSeconds);

public sealed record DriverCapabilities(bool SupportsColor, bool CanDuplex, List<string> PaperSizes, List<int> ResolutionsDpi, int MaxCopies);

public sealed record PrinterReport(
    string SystemName,
    string? DriverName,
    string? PortName,
    bool IsDefault,
    string State,
    string? StateMessage,
    DriverCapabilities? Capabilities);

public sealed record HeartbeatRequest(string AppVersion, string Os, bool Paused, List<PrinterReport> Printers);

public sealed record RegisteredPrinter(string Id, string? SystemName, string Name);

public sealed record HeartbeatResponse(
    DateTimeOffset ServerTime,
    int HeartbeatIntervalSeconds,
    int PollIntervalSeconds,
    List<string> CancelJobIds,
    List<RegisteredPrinter> Printers);

public sealed record JobDocument(string Sha256, long SizeBytes, int PageCount, string DownloadUrl);

public sealed record JobSettings(
    int Copies,
    List<int> Pages,
    string PaperSize,
    string Orientation,
    string ColorMode,
    string Duplex,
    string Quality,
    int Dpi,
    string ScaleMode);

public sealed record BridgeJob(
    string Id,
    int JobNumber,
    int Attempt,
    string Status,
    string PrinterId,
    string PrinterSystemName,
    string DocumentName,
    bool CancelRequested,
    int? SpoolJobId,
    JobDocument Document,
    JobSettings Settings)
{
    public string Key => $"{Id}#{Attempt}";
}

public sealed record JobsResponse(List<BridgeJob> Jobs);

public sealed record Confirmation(string Source, string? Detail = null);

/// <summary>Status report for one job attempt. COMPLETED must carry a spooler <see cref="Confirmation"/>.</summary>
public sealed record StatusReport
{
    public required int Attempt { get; init; }
    public required string Status { get; init; }
    public string? Message { get; init; }
    public string? ErrorCode { get; init; }
    public int? SpoolJobId { get; init; }
    public int? PagesPrinted { get; init; }

    /// <summary>Always serialised: null tells the server the printer alert has cleared.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public string? PrinterAlert { get; init; }

    public string? PrinterState { get; init; }
    public Confirmation? Confirmation { get; init; }

    public bool IsTerminal => Status is JobStatus.Completed or JobStatus.Failed or JobStatus.Cancelled;
}

public sealed record StatusResponse(string Status, bool CancelRequested);

public sealed record ApiErrorBody(ApiErrorDetail? Error);
public sealed record ApiErrorDetail(string Code, string Message);

public static class JobStatus
{
    public const string Queued = "QUEUED";
    public const string Processing = "PROCESSING";
    public const string Printing = "PRINTING";
    public const string Completed = "COMPLETED";
    public const string Failed = "FAILED";
    public const string Cancelled = "CANCELLED";
}

public static class ConfirmationSource
{
    public const string PrintedFlag = "SPOOLER_PRINTED_FLAG";
    public const string CompleteFlag = "SPOOLER_COMPLETE_FLAG";
    public const string QueueDrained = "SPOOLER_QUEUE_DRAINED";
}
