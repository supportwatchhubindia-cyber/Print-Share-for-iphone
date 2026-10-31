using System.Net;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Config;
using PrintShare.Bridge.Core.Logging;
using PrintShare.Bridge.Core.Printing;

namespace PrintShare.Bridge.Core.Jobs;

public sealed record JobResult(string JobId, int JobNumber, string DocumentName, string Status, string? Message);

/// <summary>
/// Executes one job attempt: release/fail early if the printer can't take it, download + verify,
/// spool through the Windows driver, watch the spooler until it confirms, report every step.
/// </summary>
public sealed class JobRunner(BridgeApiClient api, PrinterDiscovery discovery, PdfPrinter printer, JobJournal journal, Func<BridgeSettings> settings, ILog log)
{
    private static readonly TimeSpan FindPoll = TimeSpan.FromMilliseconds(150);
    private static readonly TimeSpan WatchPoll = TimeSpan.FromMilliseconds(500);

    public async Task<JobResult?> RunAsync(BridgeJob job, CancellationTokenSource userCancel, CancellationToken ct)
    {
        var entry = journal.Get(job.Id, job.Attempt);
        if (entry?.Stage == JournalStage.Finished)
        {
            if (entry.PendingReport is not null) await DeliverFinalAsync(job, entry, entry.PendingReport, ct);
            return null;
        }
        if (entry is { Stage: JournalStage.Spooling or JournalStage.Spooled })
        {
            log.Warn($"Job #{job.JobNumber} was already sent to Windows before the bridge restarted; resuming monitoring only (it will not be printed twice).");
            return await WatchAsync(job, entry, printTask: null, userCancel, ct);
        }

        entry = new JournalEntry { JobId = job.Id, Attempt = job.Attempt, Stage = JournalStage.Received };
        journal.Save(entry);

        if (job.CancelRequested || userCancel.IsCancellationRequested)
            return await FinishAsync(job, entry, Final(job, JobStatus.Cancelled, "Cancelled before printing started"), ct);

        var local = discovery.Find(job.PrinterSystemName);
        if (local is null)
            return await FinishAsync(job, entry, Final(job, JobStatus.Failed, $"The printer '{job.PrinterSystemName}' is no longer installed on {AppInfo.MachineName}.", "PRINTER_NOT_FOUND"), ct);

        if (!local.State.CanAcceptJobs)
        {
            // Nothing has been sent to Windows yet, so hand the job back to the queue.
            journal.Remove(job.Id, job.Attempt);
            await ReportAsync(job, new StatusReport
            {
                Attempt = job.Attempt,
                Status = JobStatus.Queued,
                ErrorCode = "PRINTER_NOT_READY",
                Message = $"{local.Name}: {local.State.Message ?? "not ready"}. The job will print when it is ready.",
                PrinterState = local.State.State,
            }, ct);
            return null;
        }

        string? outputFile = null;
        if (local.PromptsForFile)
        {
            var dir = settings().VirtualPrinterOutputDir;
            if (string.IsNullOrWhiteSpace(dir))
                return await FinishAsync(job, entry, Final(job, JobStatus.Failed, $"'{local.Name}' asks for a file name. Choose an output folder for virtual printers in PrintShare Bridge.", "VIRTUAL_PRINTER_NEEDS_FOLDER"), ct);
            Directory.CreateDirectory(dir);
            var ext = (local.DriverName ?? local.Name).Contains("XPS", StringComparison.OrdinalIgnoreCase) ? ".xps" : ".pdf";
            outputFile = Path.Combine(dir, $"PrintShare-{job.JobNumber:D5}-{job.Attempt}-{SafeFileName(job.DocumentName)}{ext}");
        }

        await ProgressAsync(job, $"Downloading document ({job.Document.SizeBytes / 1024.0:0.#} KB)", ct);
        var pdfPath = Path.Combine(BridgePaths.SpoolDir, $"{job.Id}-{job.Attempt}.pdf");
        try
        {
            await api.DownloadDocumentAsync(job.Document.DownloadUrl, pdfPath, job.Document.SizeBytes, job.Document.Sha256, ct);
        }
        catch (BridgeApiException ex) when (ex.Code == "INTEGRITY_ERROR")
        {
            return await FinishAsync(job, entry, Final(job, JobStatus.Failed, ex.Message, "INTEGRITY_ERROR"), ct);
        }
        entry.Stage = JournalStage.Downloaded;
        journal.Save(entry);

        var s = job.Settings;
        var title = $"PrintShare #{job.JobNumber}.{job.Attempt} {Truncate(job.DocumentName, 100)}";
        var request = new PrintRequest(
            local.Name, title, pdfPath, s.Pages, s.Copies, s.PaperSize,
            Landscape: s.Orientation == "LANDSCAPE",
            Color: s.ColorMode == "COLOR",
            Dpi: Math.Clamp(s.Dpi, 150, 1200),
            FitToPage: s.ScaleMode != "ACTUAL",
            OutputFile: outputFile);

        await ProgressAsync(job, $"Rendering {s.Pages.Count} page(s) at {request.Dpi} dpi for {local.Name}", ct);

        // From here on, data may reach the Windows queue: record that first so it is never re-spooled.
        entry.Stage = JournalStage.Spooling;
        entry.PrinterName = local.Name;
        entry.DocumentTitle = title;
        journal.Save(entry);

        using var spoolCts = CancellationTokenSource.CreateLinkedTokenSource(ct, userCancel.Token);
        var printTask = Task.Factory.StartNew(() => printer.Print(request, spoolCts.Token), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        JobResult? result = null;
        try
        {
            result = await WatchAsync(job, entry, printTask, userCancel, ct);
            return result;
        }
        finally
        {
            spoolCts.Cancel();
            try { await printTask; } catch { /* outcome already handled */ }
            TryDelete(pdfPath);
            // A virtual printer leaves an empty or partial file behind when the job is aborted.
            if (outputFile is not null && result is { Status: not JobStatus.Completed }) TryDelete(outputFile);
        }
    }

    /// <summary>Follows the spooler job until <see cref="JobOutcomeTracker"/> reaches a confirmed outcome.</summary>
    private async Task<JobResult?> WatchAsync(BridgeJob job, JournalEntry entry, Task? printTask, CancellationTokenSource userCancel, CancellationToken ct)
    {
        var printerName = entry.PrinterName ?? job.PrinterSystemName;
        var tracker = new JobOutcomeTracker();
        tracker.Restore(entry.SeenPrinting, entry.SeenPrintedFlag, entry.SeenCompleteFlag, everSeen: entry.SpoolJobId is not null);
        // After a restart only a recorded successful spool counts; an interrupted spool is never "drained".
        var spoolDone = entry.SpoolCompleted;
        var cancelIssued = false;
        var missesAfterDone = 0;
        string? lastAlert = null;
        var lastPages = -1;
        var lastProgressReport = DateTime.MinValue;

        if (printTask is null && entry.SpoolJobId is null)
        {
            // Restarted mid-spool: find our job by its unique title.
            var found = entry.DocumentTitle is null ? null : SafeFind(() => SpoolQueue.FindByDocument(printerName, entry.DocumentTitle));
            if (found is null)
                return await FinishAsync(job, entry, Final(job, JobStatus.Failed,
                    "The bridge stopped while sending this job to Windows, so whether it printed cannot be confirmed. Check the printer before retrying.", "OUTCOME_UNKNOWN"), ct);
            await OnSpoolIdAsync(job, entry, found.JobId, ct);
        }

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(entry.SpoolJobId is null ? FindPoll : WatchPoll, ct);

            if (printTask is { IsCompleted: true } && !spoolDone)
            {
                if (printTask.IsCompletedSuccessfully)
                {
                    spoolDone = true;
                    entry.SpoolCompleted = true;
                    journal.Save(entry);
                }
                else
                {
                    var error = printTask.Exception?.GetBaseException() ?? new OperationCanceledException();
                    if (entry.SpoolJobId is { } id) SpoolQueue.Delete(printerName, id);
                    if (error is OperationCanceledException && userCancel.IsCancellationRequested)
                        return await FinishAsync(job, entry, Final(job, JobStatus.Cancelled,
                            entry.SpoolJobId is null
                                ? "Cancelled before anything was sent to the printer."
                                : "Cancelled while sending pages to Windows. Pages already sent to the printer may still print."), ct);
                    if (error is OperationCanceledException) throw error; // bridge shutting down; resume next start
                    var code = error is PrintFailure pf ? pf.Code : "PRINT_FAILED";
                    log.Error($"Job #{job.JobNumber} failed while spooling", error);
                    return await FinishAsync(job, entry, Final(job, JobStatus.Failed, error.Message, code), ct);
                }
            }

            if (userCancel.IsCancellationRequested && !cancelIssued)
            {
                cancelIssued = true;
                if (entry.SpoolJobId is { } id && !SpoolQueue.Delete(printerName, id))
                    log.Warn($"Windows refused to delete spooler job {id}; it may finish printing.");
            }

            var snapshot = entry.SpoolJobId is { } spoolId
                ? SafeFind(() => SpoolQueue.FindById(printerName, spoolId))
                : entry.DocumentTitle is null ? null : SafeFind(() => SpoolQueue.FindByDocument(printerName, entry.DocumentTitle));

            if (snapshot is not null && entry.SpoolJobId is null)
            {
                await OnSpoolIdAsync(job, entry, snapshot.JobId, ct);
                if (cancelIssued) SpoolQueue.Delete(printerName, snapshot.JobId);
            }
            if (snapshot is null && entry.SpoolJobId is null && !spoolDone) continue; // not in the queue yet
            if (snapshot is null && spoolDone && missesAfterDone++ < 2) continue;     // confirm absence on consecutive polls

            var decision = tracker.Observe(snapshot, spoolDone, cancelIssued);
            if (tracker.SeenPrinting != entry.SeenPrinting || tracker.SeenPrintedFlag != entry.SeenPrintedFlag || tracker.SeenCompleteFlag != entry.SeenCompleteFlag)
            {
                entry.SeenPrinting = tracker.SeenPrinting;
                entry.SeenPrintedFlag = tracker.SeenPrintedFlag;
                entry.SeenCompleteFlag = tracker.SeenCompleteFlag;
                journal.Save(entry);
            }

            if (decision.Outcome == SpoolOutcome.Pending)
            {
                if (entry.SpoolJobId is null) continue;
                var alertChanged = tracker.Alert != lastAlert;
                var pagesChanged = tracker.PagesPrinted != lastPages && DateTime.UtcNow - lastProgressReport > TimeSpan.FromSeconds(3);
                if (alertChanged || pagesChanged)
                {
                    lastAlert = tracker.Alert;
                    lastPages = tracker.PagesPrinted;
                    lastProgressReport = DateTime.UtcNow;
                    if (alertChanged) log.Warn($"Job #{job.JobNumber}: {tracker.Alert ?? "printer recovered"}");
                    var printerState = tracker.Alert is null ? null : discovery.Find(printerName)?.State.State;
                    var response = await ReportAsync(job, new StatusReport
                    {
                        Attempt = job.Attempt,
                        Status = JobStatus.Printing,
                        SpoolJobId = entry.SpoolJobId,
                        PagesPrinted = tracker.PagesPrinted > 0 ? tracker.PagesPrinted : null,
                        PrinterAlert = tracker.Alert,
                        PrinterState = printerState,
                    }, ct);
                    if (response?.CancelRequested == true && !userCancel.IsCancellationRequested) userCancel.Cancel();
                }
                continue;
            }

            var report = decision.Outcome switch
            {
                SpoolOutcome.Completed => new StatusReport
                {
                    Attempt = job.Attempt,
                    Status = JobStatus.Completed,
                    SpoolJobId = entry.SpoolJobId,
                    PagesPrinted = tracker.PagesPrinted > 0 ? tracker.PagesPrinted : null,
                    Confirmation = new Confirmation(decision.ConfirmationSource!, $"Windows spooler job {entry.SpoolJobId} on '{printerName}'"),
                },
                SpoolOutcome.Cancelled => Final(job, JobStatus.Cancelled, decision.Message),
                _ => Final(job, JobStatus.Failed, decision.Message, decision.ErrorCode),
            };
            return await FinishAsync(job, entry, report, ct);
        }
    }

    private async Task OnSpoolIdAsync(BridgeJob job, JournalEntry entry, int spoolJobId, CancellationToken ct)
    {
        entry.SpoolJobId = spoolJobId;
        entry.Stage = JournalStage.Spooled;
        journal.Save(entry);
        log.Info($"Job #{job.JobNumber} is Windows spooler job {spoolJobId}");
        await ReportAsync(job, new StatusReport { Attempt = job.Attempt, Status = JobStatus.Printing, SpoolJobId = spoolJobId }, ct, critical: true);
    }

    private async Task<JobResult> FinishAsync(BridgeJob job, JournalEntry entry, StatusReport report, CancellationToken ct)
    {
        entry.Stage = JournalStage.Finished;
        entry.PendingReport = report;
        journal.Save(entry);
        await DeliverFinalAsync(job, entry, report, ct);
        var level = report.Status == JobStatus.Completed ? "completed" : report.Status.ToLowerInvariant();
        log.Info($"Job #{job.JobNumber} {level}{(report.Message is null ? "" : $": {report.Message}")}");
        return new JobResult(job.Id, job.JobNumber, job.DocumentName, report.Status, report.Message);
    }

    /// <summary>Delivers a final status, retrying until the server acknowledges (kept in the journal across restarts).</summary>
    public async Task DeliverFinalAsync(BridgeJob job, JournalEntry entry, StatusReport report, CancellationToken ct) =>
        await DeliverFinalAsync(job.Id, entry, report, ct);

    public async Task DeliverFinalAsync(string jobId, JournalEntry entry, StatusReport report, CancellationToken ct)
    {
        var delay = TimeSpan.FromSeconds(2);
        while (true)
        {
            try
            {
                await api.ReportStatusAsync(jobId, report, ct);
                break;
            }
            catch (BridgeApiException ex) when (ex.Status is HttpStatusCode.Conflict or HttpStatusCode.NotFound or HttpStatusCode.BadRequest)
            {
                log.Warn($"Server did not accept final status for job {jobId}: {ex.Message}");
                break; // job already finished/retried/removed: nothing more to deliver
            }
            catch (BridgeUnauthorizedException)
            {
                throw;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or BridgeApiException && !ct.IsCancellationRequested)
            {
                log.Debug($"Status report failed ({ex.Message}); retrying in {delay.TotalSeconds:0}s");
                await Task.Delay(delay, ct);
                delay = TimeSpan.FromSeconds(Math.Min(60, delay.TotalSeconds * 2));
            }
        }
        entry.PendingReport = null;
        journal.Save(entry);
    }

    private async Task ProgressAsync(BridgeJob job, string message, CancellationToken ct)
    {
        log.Info($"Job #{job.JobNumber}: {message}");
        await ReportAsync(job, new StatusReport { Attempt = job.Attempt, Status = JobStatus.Processing, Message = message }, ct);
    }

    /// <summary>Non-final report. Progress may be dropped if the network is down; critical ones are retried briefly.</summary>
    private async Task<StatusResponse?> ReportAsync(BridgeJob job, StatusReport report, CancellationToken ct, bool critical = false)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await api.ReportStatusAsync(job.Id, report, ct);
            }
            catch (BridgeApiException ex) when (ex.Status is HttpStatusCode.Conflict or HttpStatusCode.NotFound)
            {
                log.Debug($"Server rejected {report.Status} for job #{job.JobNumber}: {ex.Message}");
                return null;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                if (!critical || attempt >= 5) return null;
                await Task.Delay(TimeSpan.FromSeconds(2 * (attempt + 1)), ct);
            }
        }
    }

    private static StatusReport Final(BridgeJob job, string status, string? message, string? errorCode = null) =>
        new() { Attempt = job.Attempt, Status = status, Message = message, ErrorCode = errorCode };

    private SpoolSnapshot? SafeFind(Func<SpoolSnapshot?> find)
    {
        try
        {
            return find();
        }
        catch (Exception ex)
        {
            log.Debug($"Could not read the Windows queue: {ex.Message}");
            return null;
        }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    private static string SafeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(Path.GetFileNameWithoutExtension(name).Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        return Truncate(string.IsNullOrWhiteSpace(clean) ? "document" : clean, 60);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { }
    }
}
