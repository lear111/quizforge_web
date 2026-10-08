package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

public final class QuizForgeServer implements AutoCloseable {
    private static final com.fasterxml.jackson.databind.ObjectMapper RESOURCE_MAPPER = Json.MAPPER.copy();
    static { RESOURCE_MAPPER.getFactory().setStreamReadConstraints(com.fasterxml.jackson.core.StreamReadConstraints.builder().maxNestingDepth(64).maxStringLength(((ResourceStore.MAX_BYTES + 2) / 3) * 4).maxNumberLength(100).build()); }
    private final Path root;
    private final Path codeRoot;
    private final String token;
    private final HttpServer server;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore requests = new Semaphore(8);
    private final Library library;
    private final StateStore states;
    private final ResourceStore resources;
    private final EditorDraftStore editorDrafts;
    private final AiSettings aiSettings;
    private final OpenAiCompatibleProvider aiGateway;
    private final AiGradingService aiGrading;
    private final CollectionRoutes collectionRoutes;
    private final Set<String> allowedHosts = new HashSet<>();
    private final Set<String> lanAllowedHosts = new HashSet<>();
    private final NetworkSettings networkSettings;
    private volatile HttpServer lanServer;
    private volatile String networkError;
    public QuizForgeServer(Path root, String host, int port, String token, String node) throws IOException {
        ProjectLayout layout = ProjectLayout.resolve(root);
        this.root = layout.dataRoot(); this.codeRoot = layout.codeRoot(); this.token = token;
        if (token != null && (token.length() < 16 || token.length() > 256 || !token.matches("[A-Za-z0-9._~-]+"))) throw new IllegalArgumentException("Token must contain 16..256 URL-safe characters");
        // Include Node startup and schema compilation; extension VM execution remains limited to 650ms.
        RuleEngine engine = new RuleEngine(codeRoot, node, Duration.ofSeconds(8)); library = new Library(this.root, codeRoot, engine); states = new StateStore(this.root, engine);
        resources = new ResourceStore(this.root); editorDrafts = new EditorDraftStore(this.root);
        aiSettings = new AiSettings(this.root); aiGateway = new OpenAiCompatibleProvider(aiSettings, resources);
        aiGrading = new AiGradingService(this.root, states, library, aiGateway);
        collectionRoutes = new CollectionRoutes(library, states, aiGrading, new CollectionRoutes.Writes() {
            public JsonNode read(HttpExchange exchange) throws IOException { return writeRequest(exchange); }
            public void validateOrigin(HttpExchange exchange) { validateWriteOrigin(exchange); }
        });
        InetAddress address = InetAddress.getByName(host);
        if (address.isAnyLocalAddress()) {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) for (InetAddress local : Collections.list(network.getInetAddresses())) allowedHosts.add(local.getHostAddress().split("%", 2)[0].toLowerCase(Locale.ROOT));
        } else allowedHosts.add(address.getHostAddress().toLowerCase(Locale.ROOT));
        allowedHosts.add("localhost"); allowedHosts.add("127.0.0.1"); allowedHosts.add("::1");
        server = HttpServer.create(new InetSocketAddress(address, port), 64); server.setExecutor(executor); server.createContext("/", this::handle);
        int actualPort = server.getAddress().getPort();
        networkSettings = new NetworkSettings(this.root, Math.max(1024, actualPort == 65535 ? 8788 : actualPort + 1));
        lanAllowedHosts.add("localhost"); lanAllowedHosts.add("127.0.0.1");
    }
    public int upgradeShortAnswerBanks() throws IOException { return ShortAnswerUpgrade.run(library, states); }
    public synchronized void start() {
        server.start();
        if (server.getAddress().getAddress().isLoopbackAddress() && networkSettings.config().enabled()) {
            try { lanServer = createLanServer(networkSettings.config().port()); lanServer.start(); }
            catch (IOException e) { networkError = "Saved LAN port is unavailable; select another port in settings"; System.err.println(networkError); }
        }
    }
    public int port() { return server.getAddress().getPort(); }
    @Override public synchronized void close() { if (lanServer != null) { lanServer.stop(0); lanServer = null; } networkSettings.invalidateSessions(); aiGrading.close(); server.stop(0); executor.shutdownNow(); }

    private HttpServer createLanServer(int port) throws IOException {
        refreshLanHosts();
        HttpServer candidate = HttpServer.create(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), port), 64);
        candidate.setExecutor(executor); candidate.createContext("/", this::handle); return candidate;
    }
    private void refreshLanHosts() throws IOException {
        synchronized (lanAllowedHosts) {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp()) continue;
                for (InetAddress local : Collections.list(network.getInetAddresses())) if (local instanceof Inet4Address) lanAllowedHosts.add(local.getHostAddress());
            }
        }
    }
    private boolean isLan(HttpExchange exchange) { return exchange.getHttpContext().getServer() != server; }
    private boolean canManageNetwork(HttpExchange exchange) {
        if (isLan(exchange) || !server.getAddress().getAddress().isLoopbackAddress() || !exchange.getRemoteAddress().getAddress().isLoopbackAddress()) return false;
        String host = URI.create("http://" + exchange.getRequestHeaders().getFirst("Host")).getHost();
        if (host == null) return false; host = host.replace("[", "").replace("]", "");
        return host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("::1");
    }
    private synchronized JsonNode networkStatus(boolean canManage) {
        NetworkSettings.Config settings = networkSettings.config();
        var response = Json.object().put("canManage", canManage).put("enabled", lanServer != null).put("port", settings.port()).put("passwordConfigured", settings.passwordConfigured());
        var urls = response.putArray("urls");
        if (lanServer != null) {
            synchronized (lanAllowedHosts) { lanAllowedHosts.stream().filter(host -> !host.equals("localhost") && !host.startsWith("127.") && !host.startsWith("169.254.")).sorted().forEach(host -> urls.add("http://" + host + ":" + settings.port() + "/")); }
        }
        if (networkError != null) response.put("error", networkError);
        if (!canManage) response.put("error", "Network settings can only be changed through the local-only server");
        return response;
    }
    private synchronized JsonNode updateNetwork(JsonNode request) {
        NetworkSettings.Config replacement = networkSettings.candidate(request, port());
        HttpServer previous = lanServer, candidate = previous;
        try {
            if (replacement.enabled() && (previous == null || previous.getAddress().getPort() != replacement.port())) { candidate = createLanServer(replacement.port()); candidate.start(); }
            networkSettings.save(replacement);
        } catch (IOException | RuntimeException e) {
            if (candidate != null && candidate != previous) candidate.stop(0);
            throw new ApiException(409, "LAN_SETTINGS_UNAVAILABLE", "Could not save LAN settings or open this port; current settings remain active");
        }
        lanServer = replacement.enabled() ? candidate : null;
        if (previous != null && previous != lanServer) previous.stop(0);
        networkError = null; return networkStatus(true);
    }

    private void handle(HttpExchange exchange) throws IOException {
        boolean acquired = requests.tryAcquire();
        try {
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff"); exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer"); exchange.getResponseHeaders().set("Cache-Control", "no-store");
            if (!acquired) throw new ApiException(503, "SERVER_BUSY", "Server is busy; try again");
            validateHost(exchange);
            String path = exchange.getRequestURI().getPath();
            if (path == null || path.contains("\\") || path.contains("\0") || path.contains("//")) throw ApiException.bad("Invalid path");
            if (path.startsWith("/api/")) {
                if (!path.equals("/api/auth/login")) authenticate(exchange);
                if (path.startsWith("/api/resources/") && exchange.getRequestMethod().equals("GET")) {
                    ResourceStore.Resource resource = resources.read(path.substring("/api/resources/".length()));
                    send(exchange, 200, resource.mime(), resource.bytes());
                } else { JsonNode response = api(exchange, path); json(exchange, 200, response); }
            } else {
                if (!exchange.getRequestMethod().equals("GET")) throw new ApiException(405, "METHOD_NOT_ALLOWED", "Only GET is supported for pages");
                String file = path.equals("/") ? "index.html" : path.substring(1);
                if (file.startsWith("web/")) file = file.substring(4);
                String mime = contentType(file); if (mime == null) throw new ApiException(404, "NOT_FOUND", "Page not found");
                Path asset;
                try { asset = Json.safeFile(codeRoot.resolve("web"), file); }
                catch (IOException e) { throw new ApiException(404, "NOT_FOUND", "Page not found"); }
                if (Files.size(asset) > 4 * 1024 * 1024) throw new ApiException(413, "ASSET_SIZE_LIMIT", "Page asset exceeds the size limit");
                exchange.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
                send(exchange, 200, mime, Files.readAllBytes(asset));
            }
        } catch (ApiException e) { error(exchange, e.status, e.code, e.getMessage()); }
        catch (AiProviderException e) { error(exchange, e.retryable ? 503 : 422, e.code, e.getMessage()); }
        catch (Exception e) { System.err.println("Request failed: " + e.getClass().getSimpleName()); error(exchange, 500, "INTERNAL_ERROR", "Request could not be completed"); }
        finally { if (acquired) requests.release(); exchange.close(); }
    }
    private JsonNode api(HttpExchange exchange, String path) throws IOException {
        String method = exchange.getRequestMethod(); String[] parts = path.substring(1).split("/", -1);
        if (path.equals("/api/auth/login") && method.equals("POST")) {
            JsonNode body = writeRequest(exchange); String password = Json.text(body, "password", 256);
            if (isLan(exchange)) return Json.object().put("token", networkSettings.login(password, exchange.getRemoteAddress().getAddress().getHostAddress()));
            networkSettings.limitLogin(exchange.getRemoteAddress().getAddress().getHostAddress());
            if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), password.getBytes(StandardCharsets.UTF_8))) throw new ApiException(401, "PASSWORD_REQUIRED", "Incorrect access password");
            return Json.object().put("token", token);
        }
        if (path.equals("/api/settings/network")) {
            boolean canManage = canManageNetwork(exchange);
            if (isLan(exchange) || (!server.getAddress().getAddress().isLoopbackAddress() && !exchange.getRemoteAddress().getAddress().isLoopbackAddress())) throw new ApiException(403, "LOCAL_SETTINGS_ONLY", "Open settings on the host computer using its local address");
            if (method.equals("GET")) return networkStatus(canManage);
            if (method.equals("PUT")) {
                if (!canManage) throw new ApiException(403, "LOCAL_SETTINGS_ONLY", "Network settings require the local-only server and a loopback address");
                return updateNetwork(writeRequest(exchange));
            }
        }
        if (path.equals("/api/settings/ai") || path.equals("/api/settings/ai/test")) {
            boolean canManage = canManageNetwork(exchange);
            if (path.equals("/api/settings/ai") && method.equals("GET")) return aiSettings.status().put("canManage", canManage);
            if (!canManage) throw new ApiException(403, "LOCAL_SETTINGS_ONLY", "请在运行 QuizForge 的电脑上使用本机地址修改 AI 设置");
            if (path.equals("/api/settings/ai") && method.equals("PUT")) return aiSettings.update(writeRequest(exchange)).put("canManage", true);
            if (path.endsWith("/test") && method.equals("POST")) { writeRequest(exchange); return aiGateway.testConnection(); }
        }
        if (parts.length == 2 && parts[1].equals("health") && method.equals("GET")) return Json.object().put("ok", true);
        if (path.equals("/api/resources") && method.equals("POST")) return resources.upload(writeRequest(exchange, true));
        if (parts.length == 4 && parts[1].equals("sdk") && method.equals("GET")) return library.sdk(routeId(parts[2]), routeId(parts[3]));
        if (parts.length == 5 && parts[1].equals("sdk") && parts[4].equals("editor") && method.equals("GET")) return library.sdk(routeId(parts[2]), routeId(parts[3]), true);
        if (parts.length == 4 && parts[1].equals("editor-drafts")) {
            String bank = routeId(parts[2]), question = routeId(parts[3]);
            if (method.equals("GET")) return editorDrafts.get(bank, question);
            if (method.equals("PUT")) return editorDrafts.put(bank, question, writeRequest(exchange));
            if (method.equals("DELETE")) { validateWriteOrigin(exchange); return editorDrafts.delete(bank, question); }
        }
        if (parts.length == 2 && parts[1].equals("catalog") && method.equals("GET")) { states.recover(); return library.catalog(); }
        if (parts.length == 5 && parts[1].equals("extensions") && parts[4].equals("page") && method.equals("GET")) return library.page(routeId(parts[2]), routeId(parts[3]));
        if (parts.length >= 4 && parts[1].equals("collections")) return collectionRoutes.route(exchange, method, parts);
        if (!method.equals("GET") && !method.equals("POST")) throw new ApiException(405, "METHOD_NOT_ALLOWED", "Method is not supported");
        throw new ApiException(404, "NOT_FOUND", "Endpoint not found");
    }
    private JsonNode writeRequest(HttpExchange exchange) throws IOException {
        return writeRequest(exchange, false);
    }
    private JsonNode writeRequest(HttpExchange exchange, boolean resource) throws IOException {
        validateWriteOrigin(exchange); String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
        if (contentType == null || !contentType.toLowerCase(Locale.ROOT).split(";", 2)[0].strip().equals("application/json")) throw new ApiException(415, "JSON_REQUIRED", "Content-Type must be application/json");
        byte[] bytes = exchange.getRequestBody().readNBytes(8 * 1024 * 1024 + 1); if (bytes.length > 8 * 1024 * 1024) throw new ApiException(413, "BODY_TOO_LARGE", "Request exceeds the size limit");
        try { return (resource ? RESOURCE_MAPPER : Json.MAPPER).readTree(bytes); } catch (IOException e) { throw ApiException.bad("Malformed JSON"); }
    }
    private void authenticate(HttpExchange exchange) {
        if (isLan(exchange)) {
            if (!networkSettings.authenticated(exchange.getRequestHeaders().getFirst("X-QuizForge-Token"))) throw new ApiException(401, "PASSWORD_REQUIRED", "Enter the LAN access password");
            return;
        }
        if (token == null) return;
        String candidate = exchange.getRequestHeaders().getFirst("X-QuizForge-Token");
        if (candidate == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), candidate.getBytes(StandardCharsets.UTF_8))) throw new ApiException(401, "TOKEN_REQUIRED", "Enter a valid access token to use this server");
    }
    private void validateHost(HttpExchange exchange) {
        String authority = exchange.getRequestHeaders().getFirst("Host"); if (authority == null) throw ApiException.bad("Missing Host header");
        URI uri; try { uri = URI.create("http://" + authority); } catch (IllegalArgumentException e) { throw ApiException.bad("Invalid Host header"); }
        String host = uri.getHost(); if (host != null) host = host.replace("[", "").replace("]", "").toLowerCase(Locale.ROOT);
        int port = uri.getPort() == -1 ? 80 : uri.getPort();
        boolean acceptedHost;
        if (isLan(exchange)) { synchronized (lanAllowedHosts) { acceptedHost = lanAllowedHosts.contains(host); } }
        else acceptedHost = allowedHosts.contains(host);
        if (host == null || uri.getRawUserInfo() != null || !uri.getRawPath().isEmpty() || !acceptedHost || port != exchange.getLocalAddress().getPort()) throw new ApiException(403, "HOST_REJECTED", "Use this server's local address");
    }
    private void validateWriteOrigin(HttpExchange exchange) {
        String origin = exchange.getRequestHeaders().getFirst("Origin"), fetchSite = exchange.getRequestHeaders().getFirst("Sec-Fetch-Site");
        if (fetchSite != null && !fetchSite.equals("same-origin") && !fetchSite.equals("none")) throw new ApiException(403, "ORIGIN_REJECTED", "Writes require the same origin");
        if (origin == null) return; // Non-browser clients; JSON Content-Type still prevents cross-origin form writes.
        URI uri; try { uri = URI.create(origin); } catch (IllegalArgumentException e) { throw new ApiException(403, "ORIGIN_REJECTED", "Writes require the same origin"); }
        String expected = "http://" + exchange.getRequestHeaders().getFirst("Host");
        if (!origin.equals(expected) || !"http".equals(uri.getScheme()) || uri.getRawUserInfo() != null || !uri.getRawPath().isEmpty()) throw new ApiException(403, "ORIGIN_REJECTED", "Writes require the same origin");
    }
    private static String routeId(String value) { if (!value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw ApiException.bad("Invalid resource ID"); return value; }
    private static String contentType(String file) { String lower = file.toLowerCase(Locale.ROOT); if (lower.endsWith(".html")) return "text/html; charset=utf-8"; if (lower.endsWith(".js")) return "text/javascript; charset=utf-8"; if (lower.endsWith(".css")) return "text/css; charset=utf-8"; if (lower.endsWith(".svg")) return "image/svg+xml"; if (lower.endsWith(".png")) return "image/png"; if (lower.endsWith(".ico")) return "image/x-icon"; if (lower.endsWith(".woff2")) return "font/woff2"; return null; }
    private static void error(HttpExchange exchange, int status, String code, String message) throws IOException { var error = Json.object(); error.set("error", Json.object().put("code", code).put("message", message)); json(exchange, status, error); }
    private static void json(HttpExchange exchange, int status, JsonNode value) throws IOException { send(exchange, status, "application/json; charset=utf-8", Json.MAPPER.writeValueAsBytes(value)); }
    private static void send(HttpExchange exchange, int status, String contentType, byte[] bytes) throws IOException { exchange.getResponseHeaders().set("Content-Type", contentType); exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes); }
}
