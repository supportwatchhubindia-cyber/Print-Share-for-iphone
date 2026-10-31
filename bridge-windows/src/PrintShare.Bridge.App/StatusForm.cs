using System.Diagnostics;
using PrintShare.Bridge.Core;

namespace PrintShare.Bridge.App;

/// <summary>Main window: connection status, which printers are shared, virtual-printer folder, live activity.</summary>
internal sealed class StatusForm : Form
{
    private readonly BridgeService _service;
    private readonly Action _repair;
    private readonly Label _state = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 12f) };
    private readonly Label _detail = new() { AutoSize = true, ForeColor = Color.FromArgb(91, 104, 134), MaximumSize = new Size(600, 0) };
    private readonly Panel _dot = new() { Size = new Size(12, 12), Margin = new Padding(0, 8, 8, 0) };
    private readonly CheckedListBox _printers = new() { Dock = DockStyle.Fill, CheckOnClick = true, IntegralHeight = false, Font = new Font("Segoe UI", 9.5f) };
    private readonly TextBox _outputDir = new() { Dock = DockStyle.Fill, ReadOnly = true };
    private readonly ListBox _activity = new() { Dock = DockStyle.Fill, IntegralHeight = false, Font = new Font("Consolas", 9f), HorizontalScrollbar = true };
    private readonly Button _pause = new() { AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
    private bool _loadingPrinters;

    public StatusForm(BridgeService service, Action repair)
    {
        _service = service;
        _repair = repair;
        Text = "PrintShare Bridge";
        Icon = IconFactory.For(BridgeState.Online);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(680, 640);
        MinimumSize = new Size(560, 520);
        Font = new Font("Segoe UI", 9.5f);
        Padding = new Padding(16);

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var header = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0, 0, 0, 10) };
        header.Controls.Add(_dot);
        var headerText = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        headerText.Controls.Add(_state);
        headerText.Controls.Add(_detail);
        header.Controls.Add(headerText);
        root.Controls.Add(header);

        var printersBox = new GroupBox { Text = "Printers to share with PrintShare", Dock = DockStyle.Fill, Padding = new Padding(10) };
        var printersLayout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
        printersLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        printersLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        printersLayout.Controls.Add(_printers);
        var refresh = new Button { Text = "Refresh printers", AutoSize = true };
        refresh.Click += (_, _) => LoadPrinters();
        printersLayout.Controls.Add(refresh);
        printersBox.Controls.Add(printersLayout);
        root.Controls.Add(printersBox);
        _printers.ItemCheck += (_, e) =>
        {
            if (_loadingPrinters || _printers.Items[e.Index] is not PrinterItem item) return;
            _service.SetShared(item.Name, e.NewValue == CheckState.Checked);
        };

        var folderRow = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 3, AutoSize = true, Margin = new Padding(0, 8, 0, 8) };
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        folderRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        folderRow.Controls.Add(new Label { Text = "Virtual printer output:", AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 6, 0) });
        folderRow.Controls.Add(_outputDir);
        var browse = new Button { Text = "Choose…", AutoSize = true };
        browse.Click += (_, _) => ChooseOutputDir();
        folderRow.Controls.Add(browse);
        root.Controls.Add(folderRow);

        var activityBox = new GroupBox { Text = "Activity", Dock = DockStyle.Fill, Padding = new Padding(10) };
        activityBox.Controls.Add(_activity);
        root.Controls.Add(activityBox);

        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 10, 0, 0) };
        _pause.Click += (_, _) => _service.SetPaused(!_service.Settings.Paused);
        buttons.Controls.Add(_pause);
        AddButton(buttons, "Open web dashboard", () => Open(new Uri(new Uri(_service.Settings.ServerUrl!), "printers").ToString()));
        AddButton(buttons, "Open logs", () => Open(BridgePaths.LogsDir));
        AddButton(buttons, "Pair again…", () =>
        {
            if (MessageBox.Show(this, "Disconnect this computer and pair it again with a new code?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            _service.UnpairAsync().GetAwaiter().GetResult();
            Close();
            _repair();
        });
        root.Controls.Add(buttons);
        Controls.Add(root);

        if (_service.Log is Core.Logging.FileLog log) log.Written += OnLog;
        FormClosed += (_, _) =>
        {
            if (_service.Log is Core.Logging.FileLog l) l.Written -= OnLog;
        };
        _outputDir.Text = _service.Settings.VirtualPrinterOutputDir ?? "(not set — needed only for “Microsoft Print to PDF” and similar)";
        LoadPrinters();
    }

    private static void AddButton(FlowLayoutPanel panel, string text, Action onClick)
    {
        var b = new Button { Text = text, AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
        b.Click += (_, _) => onClick();
        panel.Controls.Add(b);
    }

    private void OnLog(string level, string message)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _activity.Items.Insert(0, $"{DateTime.Now:HH:mm:ss}  {(level == "INFO" ? "" : level + " ")}{message}");
            while (_activity.Items.Count > 300) _activity.Items.RemoveAt(_activity.Items.Count - 1);
        });
    }

    public void Render(BridgeSnapshot s)
    {
        if (IsDisposed) return;
        _dot.BackColor = IconFactory.ColorFor(s.State);
        _state.Text = s.State switch
        {
            BridgeState.Online => s.ActiveJobs > 0 ? "Printing" : "Connected — ready to print",
            BridgeState.Paused => "Paused",
            BridgeState.Connecting => "Connecting…",
            BridgeState.Offline => "Offline — retrying automatically",
            BridgeState.Revoked => "Disconnected from PrintShare",
            _ => "Not paired",
        };
        var printers = s.Printers.Count == 0
            ? "No printers shared yet — tick one below."
            : string.Join("   ", s.Printers.Select(p => $"{p.Name}: {p.State.ToLowerInvariant().Replace('_', ' ')}{(p.Registered ? "" : " (register it in the dashboard)")}"));
        _detail.Text = $"{s.Server} · {s.Account}\n{printers}" +
                       (s.LastError is null ? "" : $"\n{s.LastError}") +
                       (s.RealtimeConnected ? "" : s.State == BridgeState.Online ? "\nLive channel reconnecting (jobs still arrive by polling)" : "");
        _pause.Text = _service.Settings.Paused ? "Resume printing" : "Pause printing";
    }

    private void LoadPrinters()
    {
        _loadingPrinters = true;
        _printers.Items.Clear();
        foreach (var p in _service.LocalPrinters())
        {
            var shared = _service.Settings.SharedPrinters.Contains(p.Name, StringComparer.OrdinalIgnoreCase);
            _printers.Items.Add(new PrinterItem(p.Name, $"{p.Name}   —   {p.DriverName} · {p.PortName} · {p.State.State.ToLowerInvariant()}{(p.IsHpM1005 ? "   ★ HP LaserJet M1005" : "")}"), shared);
        }
        _loadingPrinters = false;
    }

    private void ChooseOutputDir()
    {
        using var dialog = new FolderBrowserDialog { Description = "Folder for files produced by virtual printers such as Microsoft Print to PDF", UseDescriptionForTitle = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        _service.SetVirtualOutputDir(dialog.SelectedPath);
        _outputDir.Text = dialog.SelectedPath;
    }

    private static void Open(string target) => Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });

    private sealed record PrinterItem(string Name, string Label)
    {
        public override string ToString() => Label;
    }
}
