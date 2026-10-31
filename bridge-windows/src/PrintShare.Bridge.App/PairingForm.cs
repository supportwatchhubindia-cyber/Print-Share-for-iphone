using PrintShare.Bridge.Core;

namespace PrintShare.Bridge.App;

/// <summary>Collects the server address and the one-time pairing code from the web dashboard.</summary>
internal sealed class PairingForm : Form
{
    private readonly BridgeService _service;
    private readonly TextBox _server = new() { Dock = DockStyle.Fill, Font = new Font("Segoe UI", 10f) };
    private readonly TextBox _code = new() { Dock = DockStyle.Fill, Font = new Font("Consolas", 16f, FontStyle.Bold), CharacterCasing = CharacterCasing.Upper, MaxLength = 9, TextAlign = HorizontalAlignment.Center };
    private readonly Label _error = new() { ForeColor = Color.FromArgb(185, 28, 28), AutoSize = true, MaximumSize = new Size(420, 0) };
    private readonly Button _pair = new() { Text = "Pair this computer", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };

    public PairingForm(BridgeService service)
    {
        _service = service;
        Text = "Pair PrintShare Bridge";
        Icon = IconFactory.For(BridgeState.Online);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 9.5f);
        Padding = new Padding(20);

        var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, Dock = DockStyle.Fill, Width = 440 };
        layout.Controls.Add(new Label { Text = "Connect this computer to PrintShare", Font = new Font("Segoe UI Semibold", 13f), AutoSize = true, Margin = new Padding(0, 0, 0, 6) });
        layout.Controls.Add(new Label
        {
            Text = "In the PrintShare web dashboard open Printers → Connect computer and generate a pairing code. The code works once and expires after 10 minutes.",
            AutoSize = true,
            MaximumSize = new Size(440, 0),
            ForeColor = Color.FromArgb(91, 104, 134),
            Margin = new Padding(0, 0, 0, 14),
        });
        layout.Controls.Add(new Label { Text = "Server address", AutoSize = true });
        _server.Text = service.Settings.ServerUrl ?? "https://";
        _server.Width = 440;
        layout.Controls.Add(_server);
        layout.Controls.Add(new Label { Text = "Pairing code", AutoSize = true, Margin = new Padding(0, 12, 0, 3) });
        _code.Width = 440;
        layout.Controls.Add(_code);
        layout.Controls.Add(_error);
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 14, 0, 0) };
        var cancel = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel, Padding = new Padding(10, 4, 10, 4) };
        buttons.Controls.Add(_pair);
        buttons.Controls.Add(cancel);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        AcceptButton = _pair;
        CancelButton = cancel;
        _pair.Click += async (_, _) => await PairAsync();
    }

    private async Task PairAsync()
    {
        _error.Text = "";
        _pair.Enabled = false;
        _pair.Text = "Pairing…";
        UseWaitCursor = true;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await _service.PairAsync(_server.Text, _code.Text, timeout.Token);
            MessageBox.Show(this,
                $"This computer is now connected to {_service.Settings.AccountEmail}.\n\n" +
                (_service.Settings.SharedPrinters.Count > 0
                    ? $"Sharing: {string.Join(", ", _service.Settings.SharedPrinters)}.\nRegister it in the web dashboard to start printing."
                    : "Next, choose which printer to share in the PrintShare Bridge window."),
                "Paired", MessageBoxButtons.OK, MessageBoxIcon.Information);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (ArgumentException ex)
        {
            _error.Text = ex.Message;
        }
        catch (HttpRequestException ex)
        {
            _error.Text = $"Could not reach the server: {ex.Message}";
        }
        catch (TaskCanceledException)
        {
            _error.Text = "The server did not respond in time.";
        }
        catch (Exception ex)
        {
            _error.Text = ex.Message;
        }
        finally
        {
            UseWaitCursor = false;
            _pair.Enabled = true;
            _pair.Text = "Pair this computer";
        }
    }
}
