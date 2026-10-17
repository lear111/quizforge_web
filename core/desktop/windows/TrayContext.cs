using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace QuizForge.Desktop
{
    internal sealed class TrayContext : ApplicationContext
    {
        private readonly Options options;
        private readonly Form dispatcher = new Form { ShowInTaskbar = false };
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly ToolStripMenuItem statusItem = new ToolStripMenuItem { Enabled = false };
        private readonly ToolStripMenuItem openItem = new ToolStripMenuItem("打开 QuizForge");
        private readonly ToolStripMenuItem quitItem = new ToolStripMenuItem("退出 QuizForge");
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<string, Icon> icons = new Dictionary<string, Icon>();
        private readonly TaskCompletionSource<bool> ready = new TaskCompletionSource<bool>();
        private Process service;
        private ProcessJob job;
        private Task startup;
        private string state = "启动中", url = "", detail = "正在启动本机服务…";
        private string lastError = "", failureReason = "";
        private volatile bool missingModule;
        private DateTime? startedAt;
        private volatile bool quitting, disposed;
        private int openRequests;

        internal TrayContext(Options options)
        {
            this.options = options;
            var unused = dispatcher.Handle;
            var menu = new ContextMenuStrip();
            menu.Items.Add(statusItem); menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openItem); menu.Items.Add("运行情况…", null, (sender, args) => ShowStatus());
            menu.Items.Add(new ToolStripSeparator()); menu.Items.Add(quitItem);
            tray.ContextMenuStrip = menu;
            tray.MouseClick += (sender, args) => { if (args.Button == MouseButtons.Left) OpenPage(); };
            openItem.Click += (sender, args) => OpenPage();
            quitItem.Click += (sender, args) => BeginQuit();
            SetState("启动中", detail); tray.Visible = true;
            Task.Run(() => SingleInstance.Listen(options.PipeName, HandleCommand, cancellation.Token));
            startup = Task.Run((Func<Task>)StartService);
        }
        private void Post(Action action)
        {
            if (disposed || dispatcher.IsDisposed) return;
            try { dispatcher.BeginInvoke(new Action(() => { if (!disposed) action(); })); }
            catch (InvalidOperationException) { }
        }
        private Task<string> HandleCommand(string command)
        {
            var result = new TaskCompletionSource<string>();
            Post(() =>
            {
                if (command == "open") OpenPage();
                // Let the pipe reply before the UI and listener are disposed.
                if (command == "quit") Task.Delay(150).ContinueWith(_ => Post(BeginQuit));
                result.TrySetResult(StatusJson());
            });
            return result.Task;
        }
        private string StatusJson()
        {
            return json.Serialize(new { state, url, detail, launcherPid = Process.GetCurrentProcess().Id,
                servicePid = service == null ? 0 : service.Id, root = options.Root,
                startedAt = startedAt.HasValue ? startedAt.Value.ToUniversalTime().ToString("o") : null,
                browserOpenRequests = openRequests, noBrowser = options.NoBrowser });
        }
        private static string Quote(string value)
        {
            // Windows command-line quoting, including a trailing backslash.
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') result.Append('\\', slashes * 2 + 1);
                else result.Append('\\', slashes);
                result.Append(character); slashes = 0;
            }
            result.Append('\\', slashes * 2); return result.Append('"').ToString();
        }
        private string FindNode()
        {
            string bundled = Path.Combine(options.Root, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;
            foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                if (string.IsNullOrWhiteSpace(folder)) continue;
                try { string file = Path.Combine(folder.Trim().Trim('"'), "node.exe"); if (File.Exists(file)) return Path.GetFullPath(file); }
                catch (ArgumentException) { }
            }
            throw new IOException("缺少 Node.js 24。请重新解压完整预览包；源码目录需安装 Node.js 24。");
        }
        private async Task StartService()
        {
            try
            {
                string entry = Path.Combine(options.Root, "core", "server", "main.mjs");
                if (!File.Exists(entry)) throw new IOException("缺少 core/server/main.mjs，请重新解压完整应用。");
                string node = FindNode();
                job = new ProcessJob();
                using (var probe = new Process { StartInfo = new ProcessStartInfo(node, "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true } })
                {
                    probe.Start(); job.Add(probe);
                    var reading = probe.StandardOutput.ReadToEndAsync();
                    if (await Task.WhenAny(reading, Task.Delay(5000)) != reading) { if (!probe.HasExited) probe.Kill(); throw new IOException("运行环境检测超时。"); }
                    string version = await reading;
                    if (!probe.WaitForExit(5000) || probe.ExitCode != 0 || !version.Trim().StartsWith("v24."))
                        throw new IOException("运行环境版本不符，需要 Node.js 24。");
                }
                if (quitting) return;
                var process = new Process();
                process.StartInfo = new ProcessStartInfo(node, Quote(entry) + " --root " + Quote(options.Root) + " --host 127.0.0.1 --port " + options.Port + " --desktop")
                {
                    WorkingDirectory = options.Root, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                };
                process.EnableRaisingEvents = true;
                process.OutputDataReceived += OnOutput;
                process.ErrorDataReceived += (sender, args) =>
                {
                    if (string.IsNullOrWhiteSpace(args.Data)) return;
                    if (args.Data.Contains("ERR_MODULE_NOT_FOUND")) missingModule = true;
                    lastError = args.Data.Substring(0, Math.Min(args.Data.Length, 1200));
                };
                process.Exited += (sender, args) =>
                {
                    // Drain redirected output so a final failure reason is not lost.
                    try { ((Process)sender).WaitForExit(); } catch { }
                    Post(OnServiceExit);
                };
                process.Start();
                try { job.Add(process); }
                catch { if (!process.HasExited) process.Kill(); throw; }
                service = process;
                process.BeginOutputReadLine(); process.BeginErrorReadLine();
                var completed = await Task.WhenAny(ready.Task, Task.Delay(90000, cancellation.Token));
                if (completed != ready.Task && !quitting) throw new IOException("服务启动超时，请查看运行情况并退出后重试。");
            }
            catch (Exception error)
            {
                Post(() =>
                {
                    if (quitting) return;
                    SetState("启动失败", error.Message);
                    tray.ShowBalloonTip(5000, "QuizForge 启动失败", error.Message, ToolTipIcon.Error);
                });
                // A failed launch never takes control of a pre-existing host.
                if (service != null) { try { service.StandardInput.Close(); } catch { } }
                if (job != null) job.Dispose();
            }
        }
        private void OnOutput(object sender, DataReceivedEventArgs args)
        {
            const string prefix = "QUIZFORGE_DESKTOP ";
            if (args.Data == null || !args.Data.StartsWith(prefix)) return;
            try
            {
                var payload = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(args.Data.Substring(prefix.Length));
                if (Convert.ToInt32(payload["pid"]) != service.Id) return;
                if ((string)payload["event"] == "failed")
                {
                    string reason = payload.ContainsKey("reason") ? payload["reason"] as string : null;
                    if (!string.IsNullOrWhiteSpace(reason)) failureReason = reason.Trim().Substring(0, Math.Min(reason.Trim().Length, 300));
                    return;
                }
                if ((string)payload["event"] != "ready") return;
                int port = Convert.ToInt32(payload["port"]);
                if (port < 1 || port > 65535) return;
                Post(() =>
                {
                    if (quitting || service.HasExited) return;
                    url = "http://127.0.0.1:" + port + "/"; startedAt = DateTime.Now;
                    SetState("运行中", "服务已就绪。"); ready.TrySetResult(true); OpenPage();
                });
            }
            catch { Post(() => SetState("启动失败", "服务启动消息无效。")); }
        }
        private void OnServiceExit()
        {
            ready.TrySetResult(false);
            if (job != null) job.Dispose();
            if (quitting) return;
            string message = lastError;
            if (failureReason != "") message = failureReason;
            else if (message.Contains("EADDRINUSE") || message.Contains("already open"))
                message = "同目录服务或端口已被其他启动方式占用。请先保存作答并关闭原服务，再双击 QuizForge.exe。";
            else if (missingModule)
                message = IsSourceCheckout() ? "运行依赖缺失或版本不符。请在应用根目录运行 npm --prefix core ci 后重新启动。" : "运行依赖缺失，请重新解压完整预览包。";
            if (string.IsNullOrWhiteSpace(message)) message = "后台服务已退出，请退出托盘后重新启动。";
            string title = startedAt.HasValue ? "服务已停止" : "启动失败";
            SetState(title, message);
            tray.ShowBalloonTip(5000, "QuizForge " + title, message, ToolTipIcon.Error);
        }
        // Mirrors isSourceCheckout in core/server/host/platform/dependencies.js.
        private bool IsSourceCheckout()
        {
            return File.Exists(Path.Combine(options.Root, "core", "package-lock.json")) && !File.Exists(Path.Combine(options.Root, "RELEASE.json"));
        }
        private void OpenPage()
        {
            if (state != "运行中" || quitting)
            {
                tray.ShowBalloonTip(3000, "QuizForge · " + state, detail, ToolTipIcon.Info); return;
            }
            openRequests++;
            if (options.NoBrowser) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch { tray.ShowBalloonTip(4000, "QuizForge", "无法打开默认浏览器，请在浏览器访问：" + url, ToolTipIcon.Warning); }
        }
        private void SetState(string next, string message)
        {
            state = next; detail = message; statusItem.Text = "状态：" + state;
            tray.Text = "QuizForge · " + state;
            if (!icons.ContainsKey(state)) icons[state] = MakeIcon(state);
            tray.Icon = icons[state]; openItem.Enabled = state == "运行中" && !quitting;
        }
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
        private Icon MakeIcon(string status)
        {
            using (var bitmap = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(bitmap))
            using (var original = Icon.ExtractAssociatedIcon(Application.ExecutablePath))
            {
                graphics.DrawIcon(original ?? SystemIcons.Application, new Rectangle(0, 0, 32, 32));
                Color color = status == "运行中" ? Color.SeaGreen : status == "启动中" || status == "正在退出" ? Color.DarkOrange : Color.Firebrick;
                using (var brush = new SolidBrush(color)) { graphics.FillEllipse(Brushes.White, 19, 19, 13, 13); graphics.FillEllipse(brush, 21, 21, 9, 9); }
                IntPtr handle = bitmap.GetHicon();
                try { return (Icon)Icon.FromHandle(handle).Clone(); }
                finally { DestroyIcon(handle); }
            }
        }
        private void ShowStatus()
        {
            var dialog = new Form { Text = "QuizForge · 运行情况", ClientSize = new Size(480, 240), StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, Icon = tray.Icon };
            string elapsed = startedAt.HasValue ? ((int)(DateTime.Now - startedAt.Value).TotalMinutes) + " 分钟" : "尚未就绪";
            dialog.Controls.Add(new Label { Text = "服务状态：" + state + "\n\n本机地址：" + (url == "" ? "尚未就绪" : url) + "\n\n运行时长：" + elapsed,
                AutoSize = false, Location = new Point(20, 20), Size = new Size(440, 90) });
            dialog.Controls.Add(new TextBox { Text = detail, ReadOnly = true, Multiline = true, BorderStyle = BorderStyle.None,
                BackColor = dialog.BackColor, Location = new Point(20, 120), Size = new Size(440, 60) });
            var close = new Button { Text = "关闭", DialogResult = DialogResult.OK, Location = new Point(370, 195), Size = new Size(90, 30) };
            dialog.Controls.Add(close); dialog.AcceptButton = close; dialog.CancelButton = close;
            using (dialog) dialog.ShowDialog();
        }
        private async void BeginQuit()
        {
            if (quitting) return;
            quitting = true; quitItem.Enabled = false; SetState("正在退出", "正在等待服务处理完已收到的保存请求…");
            try
            {
                if (service != null && !service.HasExited)
                {
                    try { service.StandardInput.WriteLine("quit"); service.StandardInput.Flush(); service.StandardInput.Close(); }
                    catch (IOException) { }
                    await Task.Run(() => service.WaitForExit());
                }
                else if (startup != null && !startup.IsCompleted)
                {
                    ready.TrySetResult(false); await startup;
                    if (service != null && !service.HasExited)
                    {
                        service.StandardInput.Close(); await Task.Run(() => service.WaitForExit());
                    }
                }
            }
            finally { ExitThread(); }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                disposed = true; cancellation.Cancel(); tray.Visible = false; tray.Dispose();
                if (service != null) { try { service.StandardInput.Close(); } catch { } }
                if (job != null) job.Dispose();
                foreach (var icon in icons.Values) icon.Dispose();
                dispatcher.Dispose(); cancellation.Dispose();
                if (service != null) service.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
