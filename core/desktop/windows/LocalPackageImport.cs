using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace QuizForge.Desktop
{
    internal sealed class ImportedPackage
    {
        internal string Name, BankId;
        internal int Banks, Extensions;
    }

    // Files are read only by the native launcher, then uploaded through the same
    // validated binary endpoint used by the browser. No HTTP file-path reader.
    internal static class LocalPackageImport
    {
        internal static string ValidateFile(string file)
        {
            if (string.IsNullOrWhiteSpace(file) || file.Length > 4096 || !file.EndsWith(".qbank", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("请选择本机的 .qbank 题库文件。");
            string full = Path.GetFullPath(file);
            if (full.StartsWith(@"\\", StringComparison.Ordinal)) throw new ArgumentException("请先将题库文件下载到本机，再双击导入。");
            var info = new FileInfo(full);
            if (!info.Exists || (info.Attributes & FileAttributes.Directory) != 0) throw new IOException("题库文件不存在，请重新选择。");
            if (info.Length == 0 || info.Length > 128L * 1024 * 1024) throw new IOException("题库文件不能为空，且不能超过 128 MiB。");
            return full;
        }
        internal static string CommandFile(string command)
        {
            if (command == null || command.Length > 32768 || !command.StartsWith("{", StringComparison.Ordinal)) return null;
            try
            {
                var request = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(command);
                if (request.Count != 2 || !request.ContainsKey("command") || !request.ContainsKey("file") || request["command"] as string != "import") return null;
                return request["file"] as string;
            }
            catch { return null; }
        }
        private static async Task<string> ReadResponse(Stream stream)
        {
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                var text = new StringBuilder(); var buffer = new char[8192]; int count;
                while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) != 0)
                {
                    if (text.Length + count > 8 * 1024 * 1024) throw new IOException("导入响应过大，请刷新题库列表查看结果。");
                    text.Append(buffer, 0, count);
                }
                return text.ToString();
            }
        }
        internal static async Task<ImportedPackage> Upload(string baseUrl, string file, bool sendFileName = true)
        {
            file = ValidateFile(file);
            var endpoint = new Uri(new Uri(baseUrl), "api/library/import");
            if (endpoint.Scheme != "http" || endpoint.Host != "127.0.0.1") throw new IOException("本机导入地址无效。");
            using (var source = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true))
            {
                if (source.Length == 0 || source.Length > 128L * 1024 * 1024) throw new IOException("题库文件不能为空，且不能超过 128 MiB。");
                var request = (HttpWebRequest)WebRequest.Create(endpoint);
                request.Method = "POST"; request.ContentType = "application/vnd.quizforge.qbank";
                if (sendFileName) request.Headers["X-QuizForge-Filename"] = Uri.EscapeDataString(Path.GetFileName(file));
                request.ContentLength = source.Length; request.AllowWriteStreamBuffering = false;
                request.AllowAutoRedirect = false; request.Proxy = null; request.Timeout = 180000; request.ReadWriteTimeout = 180000;
                request.ServicePoint.Expect100Continue = false;
                using (var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(3)))
                using (deadline.Token.Register(request.Abort))
                {
                HttpWebResponse response = null; WebException rejectedError = null;
                try
                {
                    using (var upload = await request.GetRequestStreamAsync()) await source.CopyToAsync(upload);
                    response = (HttpWebResponse)await request.GetResponseAsync();
                }
                catch (WebException failure) { rejectedError = failure; }
                if (rejectedError != null)
                {
                    if (rejectedError.Response != null)
                    {
                        using (var rejected = rejectedError.Response)
                        {
                            var body = await ReadResponse(rejected.GetResponseStream());
                            try
                            {
                                var error = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(body)["error"] as Dictionary<string, object>;
                                if (error != null && error.ContainsKey("message")) throw new IOException(error["message"] as string ?? "题库导入失败。");
                            }
                            catch (IOException) { throw; }
                            catch { }
                        }
                    }
                    throw new IOException("无法完成导入，请检查应用运行情况后重试。", rejectedError);
                }
                using (response)
                {
                    var serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
                    var value = serializer.Deserialize<Dictionary<string, object>>(await ReadResponse(response.GetResponseStream()));
                    string name = value["name"] as string ?? value["group"] as string;
                    var result = new ImportedPackage { Name = name, Banks = Convert.ToInt32(value["importedBanks"]), Extensions = Convert.ToInt32(value["importedExtensions"]) };
                    var catalog = value["catalog"] as Dictionary<string, object>;
                    if (catalog == null || result.Banks < 1) throw new IOException("导入结果无效，请刷新题库列表查看。");
                    foreach (Dictionary<string, object> bank in (IEnumerable)catalog["banks"])
                    {
                        object candidate;
                        if ((value["scope"] as string == "bank" && bank.TryGetValue("path", out candidate) && candidate as string == value["path"] as string)
                            || (value["scope"] as string != "bank" && bank.TryGetValue("group", out candidate) && candidate as string == value["group"] as string))
                        { result.BankId = bank["id"] as string; break; }
                    }
                    if (string.IsNullOrEmpty(result.BankId)) throw new IOException("题库已导入，请在列表中打开新题库。");
                    return result;
                }
                }
            }
        }
    }
}
