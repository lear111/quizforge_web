using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace QuizForge.Desktop
{
    internal sealed class HubPackageImport
    {
        internal const string Origin = "https://quizforge.treenewbee.cloud";
        private const long MaxBytes = 128L * 1024 * 1024;
        private readonly Func<Uri, HttpWebRequest> createRequest;
        private readonly TimeSpan timeout;
        private static readonly HashSet<string> active = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // Injection is available only to in-assembly tests. No command-line,
        // registry, manifest or environment override exists in the shipped EXE.
        internal HubPackageImport(Func<Uri, HttpWebRequest> factory = null, TimeSpan? networkTimeout = null)
        {
            createRequest = factory ?? (uri => (HttpWebRequest)WebRequest.Create(uri));
            timeout = networkTimeout ?? TimeSpan.FromSeconds(180);
        }
        private HttpWebRequest Request(string path)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.SystemDefault;
            var request = createRequest(new Uri(Origin + path));
            request.Method = "GET"; request.AllowAutoRedirect = false;
            request.Proxy = null;
            request.CookieContainer = null; request.Credentials = null; request.UseDefaultCredentials = false;
            request.PreAuthenticate = false; request.AutomaticDecompression = DecompressionMethods.None;
            request.Timeout = 180000; request.ReadWriteTimeout = 180000;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            return request;
        }
        private static bool ContentType(HttpWebResponse response, string expected)
        {
            return string.Equals((response.ContentType ?? "").Split(';')[0].Trim(), expected, StringComparison.OrdinalIgnoreCase);
        }
        private static async Task<string> Json(HttpWebResponse response, CancellationToken token)
        {
            if (!ContentType(response, "application/json") || response.ContentLength > 32768) throw new IOException("Hub 返回的数据无效，请稍后重试或下载 .qbank 文件。");
            using (var stream = response.GetResponseStream())
            using (var result = new MemoryStream())
            {
                var buffer = new byte[4096]; int count;
                while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, token)) != 0)
                {
                    if (result.Length + count > 32768) throw new IOException("Hub 返回的数据过大，请稍后重试。");
                    result.Write(buffer, 0, count);
                }
                return new UTF8Encoding(false, true).GetString(result.ToArray());
            }
        }
        private static Dictionary<string, object> Object(object value)
        {
            var result = value as Dictionary<string, object>;
            if (result == null) throw new IOException("Hub 导入清单无效。"); return result;
        }
        private static object Field(Dictionary<string, object> value, string key)
        {
            object result; if (!value.TryGetValue(key, out result)) throw new IOException("Hub 导入清单缺少必要信息。"); return result;
        }
        private static long Integer(object value)
        {
            if (!(value is int) && !(value is long)) throw new IOException("Hub 导入清单中的数字无效。"); return Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }
        private static string Message(string code)
        {
            switch (code)
            {
                case "LOCAL_IMPORT_REQUEST_INVALID": return "Hub 导入链接无效，请回到网站重新点击。";
                case "LOCAL_IMPORT_DISABLED": return "Hub 暂未开启直接导入，请回到网站下载 .qbank 文件。";
                case "LOCAL_IMPORT_UNAVAILABLE": return "此题库暂不可用，请回到 Hub 查看。";
                case "LOCAL_IMPORT_REVISION_CHANGED": return "题库版本已变化，请刷新 Hub 后重新点击，不会自动换成其他版本。";
                case "LOCAL_IMPORT_TOO_LARGE": return "题库文件超过 128 MiB，请使用文件下载。";
                case "LOCAL_IMPORT_FORMAT_UNSUPPORTED": return "此附件不支持直接导入，请使用文件下载。";
                case "LOCAL_IMPORT_RATE_LIMITED": return "请求过于频繁，请稍后重试。";
                case "LOCAL_IMPORT_TRAFFIC_LIMIT": return "Hub 下载流量额度不足，请稍后重试。";
                default: return "Hub 下载失败，请稍后重试或回到网站下载 .qbank 文件。";
            }
        }
        private static async Task<IOException> Rejected(WebException failure, CancellationToken token)
        {
            using (var response = failure.Response as HttpWebResponse)
            {
                if (response == null) return new IOException("无法连接 Hub，请检查网络或下载 .qbank 文件后导入。");
                try
                {
                    var value = Object(new JavaScriptSerializer().DeserializeObject(await Json(response, token)));
                    object code; return new IOException(Message(value.TryGetValue("code", out code) ? code as string : null));
                }
                catch (OperationCanceledException) { throw; }
                catch { return new IOException(Message(null)); }
            }
        }
        private static async Task<HttpWebResponse> Response(HttpWebRequest request, CancellationToken token)
        {
            WebException failure = null;
            try { return (HttpWebResponse)await request.GetResponseAsync(); }
            catch (WebException error) { failure = error; }
            if (token.IsCancellationRequested) { if (failure.Response != null) failure.Response.Dispose(); token.ThrowIfCancellationRequested(); }
            throw await Rejected(failure, token);
        }
        private static string Container(string dataRoot)
        {
            string temp = Path.Combine(dataRoot, ".temp"), root = Path.Combine(temp, "hub-import-v1");
            Directory.CreateDirectory(temp); CheckDirectory(temp); Directory.CreateDirectory(root); CheckDirectory(root); return root;
        }
        private static void CheckDirectory(string path)
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Hub 临时目录不能是链接，请检查数据目录。");
        }
        internal static void CleanStale(string dataRoot, Action<string> warning)
        {
            string root = Path.Combine(dataRoot, ".temp", "hub-import-v1");
            if (!Directory.Exists(root)) return;
            try
            {
                CheckDirectory(Path.GetDirectoryName(root)); CheckDirectory(root);
                foreach (string folder in Directory.GetDirectories(root))
                {
                    Guid id;
                    if (!Guid.TryParseExact(Path.GetFileName(folder), "N", out id) || Directory.GetLastWriteTimeUtc(folder) >= DateTime.UtcNow.AddHours(-24)) continue;
                    lock (active) { if (active.Contains(folder)) continue; }
                    RemoveStage(folder);
                }
            }
            catch { warning("Hub 临时下载清理失败，将在下次启动时重试。"); }
        }
        private static void RemoveStage(string stage)
        {
            // Our task creates exactly one file. Never recursively delete an
            // unexpected directory, junction, or a user's other temporary files.
            CheckDirectory(stage);
            foreach (string file in Directory.GetFiles(stage))
            {
                if (Path.GetFileName(file) != "package.qbank" || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new IOException("暂存目录含未知内容。");
            }
            if (Directory.GetDirectories(stage).Length != 0) throw new IOException("暂存目录含未知内容。");
            string archive = Path.Combine(stage, "package.qbank"); if (File.Exists(archive)) File.Delete(archive);
            Directory.Delete(stage);
        }
        internal async Task<ImportedPackage> Import(string baseUrl, string dataRoot, HubImportRequest source, Action<string, string> progress, Action<string> warning)
        {
            string stage = null;
            try
            {
                using (var deadline = new CancellationTokenSource(timeout))
                {
                    var token = deadline.Token;
                    try
                    {
                        progress("downloading", "正在获取 Hub 题库信息…");
                        string prefix = "/api/packs/" + source.PackId;
                        Dictionary<string, object> manifest;
                        var request = Request(prefix + "/local-import?revision=" + source.Revision);
                        using (token.Register(request.Abort))
                        using (var response = await Response(request, token))
                        {
                            if (response.StatusCode != HttpStatusCode.OK) throw new IOException("Hub 未返回题库清单，已停止导入。");
                            manifest = Object(new JavaScriptSerializer { MaxJsonLength = 32768 }.DeserializeObject(await Json(response, token)));
                        }
                        var pack = Object(Field(manifest, "pack")); var archive = Object(Field(manifest, "archive"));
                        string name = Field(archive, "name") as string, sha = Field(archive, "sha256") as string;
                        long size = Integer(Field(archive, "size"));
                        if (Integer(Field(manifest, "schemaVersion")) != 1 || Field(pack, "id") as string != source.PackId
                            || Integer(Field(pack, "revision")).ToString(CultureInfo.InvariantCulture) != source.Revision || !(Field(pack, "title") is string)
                            || name == null || !name.EndsWith(".qbank", StringComparison.OrdinalIgnoreCase)
                            || sha == null || !Regex.IsMatch(sha, @"\A[0-9a-f]{64}\z") || size < 1 || size > MaxBytes) throw new IOException("Hub 导入清单与链接不匹配或文件信息无效。");
                        string display = Regex.Replace(name, @"[\p{C}]", " "); if (display.Length > 160) display = display.Substring(0, 160);
                        stage = Path.Combine(Container(dataRoot), Guid.NewGuid().ToString("N")); Directory.CreateDirectory(stage);
                        lock (active) active.Add(stage);
                        string file = Path.Combine(stage, "package.qbank");
                        progress("downloading", "正在下载：" + display);
                        request = Request(prefix + "/download?revision=" + source.Revision + "&sha256=" + sha);
                        using (token.Register(request.Abort))
                        using (var response = await Response(request, token))
                        {
                            if (response.StatusCode != HttpStatusCode.OK || !ContentType(response, "application/octet-stream") || response.ContentLength != size
                                || !string.IsNullOrEmpty(response.ContentEncoding)) throw new IOException("Hub 下载响应的类型或长度无效，已停止导入。");
                            using (var stream = response.GetResponseStream())
                            using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                            using (var digest = SHA256.Create())
                            {
                                var buffer = new byte[81920]; int count; long received = 0; int lastPercent = -1;
                                while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, token)) != 0)
                                {
                                    received += count; if (received > size || received > MaxBytes) throw new IOException("Hub 文件大小与清单不符，已停止导入。");
                                    digest.TransformBlock(buffer, 0, count, buffer, 0);
                                    await output.WriteAsync(buffer, 0, count, token);
                                    int percent = (int)(received * 100 / size);
                                    if (percent != lastPercent) { progress("downloading", "正在下载：" + display + "（" + percent + "%）"); lastPercent = percent; }
                                }
                                digest.TransformFinalBlock(new byte[0], 0, 0);
                                string actual = BitConverter.ToString(digest.Hash).Replace("-", "").ToLowerInvariant();
                                if (received != size || actual != sha) throw new IOException("Hub 文件长度或 SHA-256 校验失败，未导入题库。");
                            }
                        }
                        token.ThrowIfCancellationRequested();
                    }
                    catch (OperationCanceledException) { throw new IOException("Hub 下载等待超时，请稍后重新点击或下载文件导入。"); }
                    catch (Exception)
                    {
                        if (token.IsCancellationRequested) throw new IOException("Hub 下载等待超时，请稍后重新点击或下载文件导入。");
                        throw;
                    }
                }
                progress("importing", "下载校验完成，正在校验并导入题库…");
                // The fixed staging basename must not rename every imported
                // bank to "package". Let the original importer use its manifest.
                return await LocalPackageImport.Upload(baseUrl, Path.Combine(stage, "package.qbank"), false);
            }
            finally
            {
                if (stage != null)
                {
                    try { RemoveStage(stage); } catch { warning("Hub 临时下载未能清理，将在下次启动时重试。"); }
                    lock (active) active.Remove(stage);
                }
            }
        }
    }
}
