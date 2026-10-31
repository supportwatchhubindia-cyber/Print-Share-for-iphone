using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using PrintShare.Bridge.Core;

namespace PrintShare.Bridge.App;

/// <summary>Draws the tray/window icon at runtime, tinted by connection state (no binary assets).</summary>
internal static class IconFactory
{
    private static readonly Dictionary<BridgeState, Icon> Cache = new();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);

    public static Color ColorFor(BridgeState state) => state switch
    {
        BridgeState.Online => Color.FromArgb(37, 99, 235),
        BridgeState.Paused => Color.FromArgb(180, 83, 9),
        BridgeState.Revoked => Color.FromArgb(185, 28, 28),
        _ => Color.FromArgb(120, 128, 145),
    };

    public static Icon For(BridgeState state)
    {
        if (Cache.TryGetValue(state, out var icon)) return icon;
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var bg = new SolidBrush(ColorFor(state));
            using var path = RoundedRect(new Rectangle(0, 0, 31, 31), 8);
            g.FillPath(bg, path);
            using var pen = new Pen(Color.White, 2.4f) { LineJoin = LineJoin.Round };
            g.DrawRectangle(pen, 10, 6, 12, 6);          // paper in
            g.DrawRectangle(pen, 6, 12, 20, 10);         // body
            g.FillRectangle(Brushes.White, 10, 18, 12, 8); // paper out
            if (state is BridgeState.Offline or BridgeState.NotPaired or BridgeState.Connecting)
                g.FillEllipse(Brushes.White, 22, 22, 8, 8);
        }
        var handle = bmp.GetHicon();
        icon = (Icon)Icon.FromHandle(handle).Clone();
        DestroyIcon(handle);
        Cache[state] = icon;
        return icon;
    }

    private static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
