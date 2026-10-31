using System.Diagnostics;
using PrintShare.Bridge.Core;
using PrintShare.Bridge.Core.Api;
using PrintShare.Bridge.Core.Jobs;

namespace PrintShare.Bridge.App;

/// <summary>Notification-area app: status, pause/resume, auto-start opt-in, pairing and the status window.</summary>
internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly BridgeService _service;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _statusItem = new() { Enabled = false };
    private readonly ToolStripMenuItem _pauseItem = new("Pause printing");
    private readonly ToolStripMenuItem _autoStartItem = new("Start with Windows") { CheckOnClick = true };
    private readonly Control _ui = new();
    private StatusForm? _statusForm;
    private BridgeState _lastState = BridgeState.Connecting;

    public TrayApplicationContext(BridgeService service, bool startMinimized)
    {
        _service = service;
        _ui.CreateControl(); // gives us a handle for marshalling events onto the UI thread

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open PrintShare Bridge", null, (_, _) => ShowStatus());
        menu.Items.Add(_pauseItem);
        _pauseItem.Click += (_, _) => _service.SetPaused(!_service.Settings.Paused);
        menu.Items.Add(_autoStartItem);
        _autoStartItem.Checked = AutoStart.IsEnabled;
        _autoStartItem.CheckedChanged += (_, _) => AutoStart.Set(_autoStartItem.Checked);
        menu.Items.Add("Open web dashboard", null, (_, _) => OpenDashboard());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitBridge());

        _tray = new NotifyIcon
        {
            Icon = IconFactory.For(BridgeState.Connecting),
            Text = "PrintShare Bridge",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => ShowStatus();

        _service.Changed += snapshot => OnUi(() => Render(snapshot));
        _service.JobFinished += result => OnUi(() => NotifyJob(result));

        _service.Start();
        Render(_service.Snapshot);

        if (!_service.Settings.IsPaired) OnUi(ShowPairing);
        else if (!startMinimized) OnUi(ShowStatus);
    }

    private void OnUi(Action action)
    {
        if (_ui.IsDisposed) return;
        if (_ui.InvokeRequired) _ui.BeginInvoke(action);
        else action();
    }

    private void Render(BridgeSnapshot s)
    {
        var text = s.State switch
        {
            BridgeState.Online => s.ActiveJobs > 0 ? $"Printing ({s.ActiveJobs} job{(s.ActiveJobs == 1 ? "" : "s")})" : "Connected — ready to print",
            BridgeState.Paused => "Paused — not accepting jobs",
            BridgeState.Connecting => "Connecting…",
            BridgeState.Offline => "Offline — retrying",
            BridgeState.Revoked => "Disconnected — pair again",
            _ => "Not paired",
        };
        _statusItem.Text = text;
        _pauseItem.Text = _service.Settings.Paused ? "Resume printing" : "Pause printing";
        _pauseItem.Enabled = s.State is not (BridgeState.NotPaired or BridgeState.Revoked);
        _tray.Icon = IconFactory.For(s.State);
        var tip = $"PrintShare Bridge — {text}";
        _tray.Text = tip.Length > 63 ? tip[..63] : tip;

        if (s.State == BridgeState.Revoked && _lastState != BridgeState.Revoked)
            _tray.ShowBalloonTip(8000, "PrintShare Bridge disconnected", "This computer was removed from your PrintShare account. Open the bridge to pair it again.", ToolTipIcon.Warning);
        _lastState = s.State;
        _statusForm?.Render(s);
    }

    private void NotifyJob(JobResult r)
    {
        var (title, icon) = r.Status switch
        {
            JobStatus.Completed => ("Printed", ToolTipIcon.Info),
            JobStatus.Cancelled => ("Print job cancelled", ToolTipIcon.Info),
            _ => ("Print job failed", ToolTipIcon.Error),
        };
        _tray.ShowBalloonTip(5000, title, $"#{r.JobNumber} {r.DocumentName}{(r.Message is null || r.Status == JobStatus.Completed ? "" : $"\n{r.Message}")}", icon);
    }

    private void ShowPairing()
    {
        using var form = new PairingForm(_service);
        if (form.ShowDialog() == DialogResult.OK)
        {
            if (!_service.Settings.AutoStartPrompted)
            {
                _service.Settings.AutoStartPrompted = true;
                _service.Settings.Save();
                var answer = MessageBox.Show(
                    "Start PrintShare Bridge automatically when you sign in to Windows?\n\nPrint jobs from your phone can only print while the bridge is running.",
                    "PrintShare Bridge", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer == DialogResult.Yes)
                {
                    AutoStart.Set(true);
                    _autoStartItem.Checked = true;
                }
            }
            ShowStatus();
        }
    }

    private void ShowStatus()
    {
        if (!_service.Settings.IsPaired)
        {
            ShowPairing();
            return;
        }
        if (_statusForm is { IsDisposed: false })
        {
            _statusForm.WindowState = FormWindowState.Normal;
            _statusForm.Activate();
            return;
        }
        _statusForm = new StatusForm(_service, ShowPairing);
        _statusForm.FormClosed += (_, _) => _statusForm = null;
        _statusForm.Render(_service.Snapshot);
        _statusForm.Show();
    }

    private void OpenDashboard()
    {
        var url = _service.Settings.ServerUrl;
        if (string.IsNullOrEmpty(url)) return;
        Process.Start(new ProcessStartInfo(new Uri(new Uri(url), "printers").ToString()) { UseShellExecute = true });
    }

    private void ExitBridge()
    {
        if (_service.Snapshot.ActiveJobs > 0 &&
            MessageBox.Show("A job is still printing. Exit anyway? It will be checked again the next time the bridge starts.", "PrintShare Bridge",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
            return;
        _tray.Visible = false;
        _service.StopAsync().GetAwaiter().GetResult();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Dispose();
            _ui.Dispose();
        }
        base.Dispose(disposing);
    }
}
