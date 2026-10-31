using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Config;
using PrintShare.Bridge.Core.Jobs;

namespace PrintShare.Bridge.Core.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "psbridge-tests-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public void Dispose()
    {
        try { Directory.Delete(Path, true); } catch (IOException) { }
    }
}

public class JobJournalTests
{
    [Fact]
    public void Persists_entries_across_instances()
    {
        using var dir = new TempDir();
        var file = Path.Combine(dir.Path, "journal.json");
        var journal = new JobJournal(file);
        journal.Save(new JournalEntry { JobId = "job1", Attempt = 2, Stage = JournalStage.Spooled, SpoolJobId = 17, DocumentTitle = "PrintShare #5.2 x" });

        var reloaded = new JobJournal(file).Get("job1", 2);
        Assert.NotNull(reloaded);
        Assert.Equal(JournalStage.Spooled, reloaded!.Stage);
        Assert.Equal(17, reloaded.SpoolJobId);
        Assert.Null(new JobJournal(file).Get("job1", 1)); // attempts are independent
    }

    [Fact]
    public void Keeps_pending_final_reports_until_acknowledged()
    {
        using var dir = new TempDir();
        var file = Path.Combine(dir.Path, "journal.json");
        var journal = new JobJournal(file);
        var entry = new JournalEntry { JobId = "j", Attempt = 1, Stage = JournalStage.Finished };
        entry.PendingReport = new StatusReport { Attempt = 1, Status = JobStatus.Completed, SpoolJobId = 3, Confirmation = new Confirmation(ConfirmationSource.PrintedFlag) };
        journal.Save(entry);

        var pending = new JobJournal(file).PendingReports();
        Assert.Single(pending);
        Assert.Equal(JobStatus.Completed, pending[0].PendingReport!.Status);

        entry.PendingReport = null;
        journal.Save(entry);
        Assert.Empty(new JobJournal(file).PendingReports());
    }

    [Fact]
    public void Prunes_old_entries_but_not_pending_ones()
    {
        using var dir = new TempDir();
        var journal = new JobJournal(Path.Combine(dir.Path, "journal.json"));
        journal.Save(new JournalEntry { JobId = "old", Attempt = 1, Stage = JournalStage.Finished });
        journal.Save(new JournalEntry { JobId = "pending", Attempt = 1, Stage = JournalStage.Finished, PendingReport = new StatusReport { Attempt = 1, Status = JobStatus.Failed } });
        Assert.Equal(1, journal.Prune(TimeSpan.Zero));
        Assert.Null(journal.Get("old", 1));
        Assert.NotNull(journal.Get("pending", 1));
    }

    [Fact]
    public void Survives_a_corrupt_file()
    {
        using var dir = new TempDir();
        var file = Path.Combine(dir.Path, "journal.json");
        File.WriteAllText(file, "{ not json");
        Assert.Empty(new JobJournal(file).PendingReports());
        Assert.True(File.Exists(file + ".corrupt"));
    }
}

public class StatusReportSerializationTests
{
    [Fact]
    public void Always_sends_printer_alert_so_null_clears_it_and_omits_other_nulls()
    {
        var json = JsonSerializer.Serialize(new StatusReport { Attempt = 1, Status = JobStatus.Printing, SpoolJobId = 9 }, BridgeApiClient.Json);
        Assert.Contains("\"printerAlert\":null", json);
        Assert.DoesNotContain("confirmation", json);
        Assert.Contains("\"spoolJobId\":9", json);
    }

    [Fact]
    public void Deserialises_server_job_payload()
    {
        const string payload = """
        {"jobs":[{"id":"cj1","jobNumber":12,"attempt":1,"status":"PROCESSING","printerId":"p1","printerSystemName":"HP LaserJet M1005",
          "documentName":"a.pdf","cancelRequested":false,"spoolJobId":null,
          "document":{"sha256":"ab","sizeBytes":10,"pageCount":3,"downloadUrl":"/api/bridge/jobs/cj1/document?token=x"},
          "settings":{"copies":2,"pages":[1,2],"paperSize":"A4","orientation":"PORTRAIT","colorMode":"MONOCHROME","duplex":"SIMPLEX","quality":"NORMAL","dpi":600,"scaleMode":"FIT"}}]}
        """;
        var result = JsonSerializer.Deserialize<JobsResponse>(payload, BridgeApiClient.Json)!;
        var job = Assert.Single(result.Jobs);
        Assert.Equal("cj1#1", job.Key);
        Assert.Equal(new[] { 1, 2 }, job.Settings.Pages);
        Assert.Equal(600, job.Settings.Dpi);
    }
}

public class DownloadTests
{
    private sealed class StubHandler(HttpStatusCode status, byte[] body) : HttpMessageHandler
    {
        public HttpRequestMessage? Last { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Last = request;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new ByteArrayContent(body) });
        }
    }

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    [Fact]
    public async Task Verifies_hash_and_sends_bridge_credentials()
    {
        using var dir = new TempDir();
        var body = Encoding.ASCII.GetBytes("%PDF-1.7 test document");
        var handler = new StubHandler(HttpStatusCode.OK, body);
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "bridge.secret", handler);
        var dest = Path.Combine(dir.Path, "doc.pdf");
        await api.DownloadDocumentAsync("/api/bridge/jobs/j/document?token=t", dest, body.Length, Sha(body), CancellationToken.None);
        Assert.Equal(body, File.ReadAllBytes(dest));
        Assert.Equal("Bearer", handler.Last!.Headers.Authorization!.Scheme);
        Assert.Equal("https://print.example.com/api/bridge/jobs/j/document?token=t", handler.Last.RequestUri!.ToString());
    }

    [Fact]
    public async Task Rejects_tampered_documents()
    {
        using var dir = new TempDir();
        var body = Encoding.ASCII.GetBytes("%PDF-1.7 tampered");
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "t", new StubHandler(HttpStatusCode.OK, body));
        var dest = Path.Combine(dir.Path, "doc.pdf");
        var ex = await Assert.ThrowsAsync<BridgeApiException>(() => api.DownloadDocumentAsync("/d", dest, body.Length, new string('0', 64), CancellationToken.None));
        Assert.Equal("INTEGRITY_ERROR", ex.Code);
        Assert.False(File.Exists(dest));
    }

    [Fact]
    public async Task Refuses_absolute_download_urls()
    {
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "t", new StubHandler(HttpStatusCode.OK, Array.Empty<byte>()));
        await Assert.ThrowsAsync<BridgeApiException>(() => api.DownloadDocumentAsync("https://evil.example/x.pdf", "x", 1, "", CancellationToken.None));
    }

    [Fact]
    public async Task Maps_401_to_unauthorized()
    {
        var body = Encoding.UTF8.GetBytes("""{"error":{"code":"UNAUTHORIZED","message":"revoked"}}""");
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "t", new StubHandler(HttpStatusCode.Unauthorized, body));
        var ex = await Assert.ThrowsAsync<BridgeUnauthorizedException>(() => api.HeartbeatAsync(new HeartbeatRequest("1", "w", false, new()), CancellationToken.None));
        Assert.Equal("revoked", ex.Message);
    }
}

public class SecretStoreTests
{
    [Fact]
    public void Round_trips_with_dpapi_and_is_not_plaintext()
    {
        using var dir = new TempDir();
        var file = Path.Combine(dir.Path, "credentials.bin");
        SecretStore.Save("bridgeid.super-secret-value", file);
        Assert.DoesNotContain("super-secret", Encoding.UTF8.GetString(File.ReadAllBytes(file)));
        Assert.Equal("bridgeid.super-secret-value", SecretStore.Load(file));
        SecretStore.Delete(file);
        Assert.Null(SecretStore.Load(file));
    }
}
