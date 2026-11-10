using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace QuizForge.Desktop
{
    internal sealed class Options
    {
        internal string Root = Application.StartupPath;
        internal string DataRoot;
        internal bool Installed;
        internal string InstalledMutexName;
        internal int Port = 8787;
        internal bool NoBrowser;
        internal string ImportFile;
        internal HubImportRequest HubImport;
        internal string Command = "open";
        internal string PipeName;
        internal static Options Parse(string[] args)
        {
            var result = new Options();
            if (Array.IndexOf(args, "--open-url") >= 0)
            {
                if (args.Length != 2 || args[0] != "--open-url") throw new ArgumentException("Hub 链接必须单独使用 --open-url，不能附带其他启动参数。");
                result.HubImport = HubImportRequest.Parse(args[1]);
                args = new string[0];
            }
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--root": result.Root = args[++i]; break;
                    case "--data-root": result.DataRoot = args[++i]; break;
                    case "--layout": result.Command = "layout"; break;
                    case "--port": result.Port = int.Parse(args[++i]); break;
                    case "--no-browser": result.NoBrowser = true; break;
                    case "--status": result.Command = "status"; break;
                    case "--quit": result.Command = "quit"; break;
                    case "--import":
                        if (result.ImportFile != null || i + 1 >= args.Length) throw new ArgumentException("一次只能打开一个 .qbank 文件。");
                        result.ImportFile = args[++i]; break;
                    default:
                        if (result.ImportFile != null || !args[i].EndsWith(".qbank", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("未知启动参数：" + args[i]);
                        result.ImportFile = args[i]; break;
                }
            }
            if (result.ImportFile != null)
            {
                if (result.Command != "open") throw new ArgumentException("导入文件不能和状态、退出或布局查询同时使用。");
                result.ImportFile = LocalPackageImport.ValidateFile(result.ImportFile);
            }
            result.Root = Path.GetFullPath(result.Root);
            if (result.Root.Length > 3) result.Root = result.Root.TrimEnd(Path.DirectorySeparatorChar);
            if (!Directory.Exists(result.Root) || result.Port < 0 || result.Port > 65535) throw new ArgumentException("应用目录或端口无效。");
            string installation = Path.Combine(result.Root, "INSTALLATION.json");
            if (File.Exists(installation))
            {
                var marker = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(installation));
                if (!marker.ContainsKey("schemaVersion") || Convert.ToInt32(marker["schemaVersion"]) != 1 || !marker.ContainsKey("dataMode") || (string)marker["dataMode"] != "user")
                    throw new ArgumentException("安装配置无效，请重新安装 QuizForge。");
                result.Installed = true;
                string applicationId = marker.ContainsKey("applicationId") ? marker["applicationId"] as string : "QuizForge.Desktop";
                if (applicationId == null || !System.Text.RegularExpressions.Regex.IsMatch(applicationId, "^QuizForge\\.[A-Za-z0-9.-]{1,120}$")) throw new ArgumentException("安装标识无效，请重新安装 QuizForge。");
                result.InstalledMutexName = "Local\\" + applicationId;
            }
            result.DataRoot = Path.GetFullPath(result.DataRoot ?? (result.Installed ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuizForge") : result.Root));
            if (result.DataRoot.Length > 3) result.DataRoot = result.DataRoot.TrimEnd(Path.DirectorySeparatorChar);
            if (result.Installed && (string.Equals(result.DataRoot, result.Root, StringComparison.OrdinalIgnoreCase) || result.DataRoot.StartsWith(result.Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException("用户数据目录必须位于安装目录之外。");
            using (var digest = SHA256.Create())
                result.PipeName = "QuizForgeTray-" + BitConverter.ToString(digest.ComputeHash(Encoding.UTF8.GetBytes(result.DataRoot.ToLowerInvariant()))).Replace("-", "");
            return result;
        }
    }

    internal static class Program
    {
        // Control clients emit JSON and errors to redirected streams. Their
        // encoding must not depend on the Windows/OEM console code page.
        internal static void ConfigureConsoleEncoding()
        {
            // A WinExe may have redirected streams but no console handle.
            // Encode those streams explicitly without changing a console code page.
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
        }

        [STAThread]
        private static int Main(string[] args)
        {
            Options options = null;
            bool quiet = Array.IndexOf(args, "--no-browser") >= 0 || Array.IndexOf(args, "--layout") >= 0 || Array.IndexOf(args, "--status") >= 0 || Array.IndexOf(args, "--quit") >= 0;
            try
            {
                ConfigureConsoleEncoding();
                options = Options.Parse(args);
                return Run(options);
            }
            catch (Exception error)
            {
                string message = "QuizForge 无法启动：" + error.Message;
                if (!quiet && (options == null || options.Command == "open" && !options.NoBrowser))
                    MessageBox.Show(message, "QuizForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Console.Error.WriteLine(message);
                return 1;
            }
        }
        // In-assembly tests supply their own layout and HTTP transport here;
        // the release entry point always parses the strict production options.
        internal static int Run(Options options, HubPackageImport hub = null)
        {
                ConfigureConsoleEncoding();
                if (options.Command == "layout")
                {
                    Console.WriteLine(new JavaScriptSerializer().Serialize(new { programRoot = options.Root, dataRoot = options.DataRoot, installed = options.Installed }));
                    return 0;
                }
                // Control clients must not create the owner mutex: a status or
                // exit request can arrive before the first launcher has started.
                if (options.Command != "open")
                {
                    Console.WriteLine(SingleInstance.Send(options.PipeName, options.Command));
                    return 0;
                }
                bool first;
                using (var mutex = new Mutex(true, "Local\\" + options.PipeName, out first))
                {
                    if (!first)
                    {
                        string command = options.ImportFile == null ? options.Command : new JavaScriptSerializer().Serialize(new { command = "import", file = options.ImportFile });
                        if (options.HubImport != null) command = options.HubImport.Command;
                        Console.WriteLine(SingleInstance.Send(options.PipeName, command));
                        return 0;
                    }
                    try
                    {
                        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
                        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                        using (var installedMutex = options.Installed ? new Mutex(false, options.InstalledMutexName) : null)
                        using (var context = new TrayContext(options, hub)) Application.Run(context);
                    }
                    finally { mutex.ReleaseMutex(); }
                }
                return 0;
        }
    }

    internal static class SingleInstance
    {
        internal static string Send(string name, string command)
        {
            using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut))
            {
                pipe.Connect(5000);
                using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
                using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                {
                    writer.WriteLine(command); writer.Flush();
                    var response = reader.ReadLineAsync();
                    if (!response.Wait(5000)) throw new IOException("托盘程序未响应，请稍后重试。");
                    if (string.IsNullOrWhiteSpace(response.Result)) throw new IOException("运行中的 QuizForge 未能接收请求。请先保存并退出旧托盘，再重新打开题库。");
                    var payload = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(response.Result);
                    if (payload.ContainsKey("error")) throw new IOException(payload["error"] as string ?? "托盘请求失败。");
                    return response.Result;
                }
            }
        }
        internal static async Task Listen(string name, Func<string, Task<string>> handle, CancellationToken cancellation)
        {
            var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    using (var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security))
                    using (cancellation.Register(() => pipe.Dispose()))
                    {
                        await pipe.WaitForConnectionAsync(cancellation);
                        using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                        using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
                        {
                            var reading = reader.ReadLineAsync();
                            if (await Task.WhenAny(reading, Task.Delay(3000, cancellation)) != reading) continue;
                            string command = await reading;
                            if (command != "open" && command != "status" && command != "quit" && LocalPackageImport.CommandFile(command) == null && HubImportRequest.FromCommand(command) == null) continue;
                            await writer.WriteLineAsync(await handle(command)); await writer.FlushAsync();
                        }
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (ObjectDisposedException) { if (cancellation.IsCancellationRequested) break; }
                catch (IOException) { if (cancellation.IsCancellationRequested) break; }
            }
        }
    }
}
