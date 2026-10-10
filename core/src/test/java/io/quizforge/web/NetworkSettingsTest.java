package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class NetworkSettingsTest {
    @TempDir Path root;
    QuizForgeServer server;
    final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    static final String SETTINGS = "/api/settings/network", LOGIN = "/api/auth/login", PASSWORD = "tablet-password-123";
    record Reply(int status, JsonNode body) { }

    @BeforeEach void prepare() throws Exception { Files.createDirectories(root.resolve("web")); Files.writeString(root.resolve("web/index.html"), "<title>Test</title>"); }
    @AfterEach void close() { if (server != null) server.close(); }
    void start(String host, String token) throws Exception { server = new QuizForgeServer(root, host, 0, token, "node"); server.start(); }
    int freePort() throws Exception { try (ServerSocket socket = new ServerSocket(0, 8, InetAddress.getByName("0.0.0.0"))) { return socket.getLocalPort(); } }
    Reply request(int port, String method, String path, JsonNode data, String token, String origin) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
        if (token != null) request.header("X-QuizForge-Token", token);
        if (origin != null) request.header("Origin", origin);
        if (data != null) request.header("Content-Type", "application/json");
        request.method(method, data == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(data.toString()));
        HttpResponse<String> reply = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        return new Reply(reply.statusCode(), reply.headers().firstValue("Content-Type").orElse("").startsWith("application/json") ? Json.MAPPER.readTree(reply.body()) : null);
    }
    Reply local(String method, String path, JsonNode data) throws Exception { return request(server.port(), method, path, data, null, "http://127.0.0.1:" + server.port()); }
    JsonNode settings(boolean enabled, int port, String password) { var data = Json.object().put("enabled", enabled).put("port", port); if (password != null) data.put("password", password); return data; }
    Reply login(int port, String password) throws Exception { return request(port, "POST", LOGIN, Json.object().put("password", password), null, "http://127.0.0.1:" + port); }
    String enable(int port) throws Exception { assertEquals(200, local("PUT", SETTINGS, settings(true, port, PASSWORD)).status()); Reply reply = login(port, PASSWORD); assertEquals(200, reply.status()); return reply.body().path("token").asText(); }
    JsonNode publicSettings(boolean lan, boolean publicEnabled, int port, String url, String password) {
        var data = (com.fasterxml.jackson.databind.node.ObjectNode) settings(lan, port, password);
        return data.put("publicEnabled", publicEnabled).put("publicUrl", url);
    }
    // Connect to the isolated local test listener while retaining an external HTTP authority.
    Reply publicRequest(int port, String method, String path, JsonNode data, String session, String authority, String origin, String forwarding) throws Exception {
        byte[] body = data == null ? new byte[0] : data.toString().getBytes(StandardCharsets.UTF_8);
        String headers = method + " " + path + " HTTP/1.1\r\nHost: " + authority + "\r\nConnection: close\r\n"
                + (session == null ? "" : "X-QuizForge-Token: " + session + "\r\n") + (origin == null ? "" : "Origin: " + origin + "\r\n")
                + (data == null ? "" : "Content-Type: application/json\r\nContent-Length: " + body.length + "\r\n") + (forwarding == null ? "" : forwarding) + "\r\n";
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(10_000); socket.getOutputStream().write(headers.getBytes(StandardCharsets.UTF_8)); socket.getOutputStream().write(body); socket.getOutputStream().flush();
            String reply = new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8); int boundary = reply.indexOf("\r\n\r\n");
            int status = Integer.parseInt(reply.substring(0, reply.indexOf("\r\n")).split(" ")[1]);
            return new Reply(status, Json.MAPPER.readTree(reply.substring(boundary + 4)));
        }
    }

    @Test void publicOnlyAccessAuthenticatesHttpsProxyAndCannotManageHostSettings() throws Exception {
        start("127.0.0.1", null); int port = freePort();
        Reply enabled = local("PUT", SETTINGS, publicSettings(false, true, port, "https://Quiz.Example.test:443/", PASSWORD)); assertEquals(200, enabled.status());
        assertFalse(enabled.body().path("enabled").asBoolean()); assertTrue(enabled.body().path("publicEnabled").asBoolean());
        assertEquals("https://quiz.example.test/", enabled.body().path("publicUrl").asText()); assertTrue(enabled.body().path("urls").isEmpty());
        String authority = "quiz.example.test", origin = "https://quiz.example.test";
        assertEquals(401, publicRequest(port, "GET", "/api/health", null, null, authority, null, null).status());
        String forwarding = "X-Forwarded-Proto: https\r\nX-Forwarded-For: 198.51.100.7\r\n";
        Reply login = publicRequest(port, "POST", LOGIN, Json.object().put("password", PASSWORD), null, authority, origin, forwarding); assertEquals(200, login.status());
        String session = login.body().path("token").asText();
        assertEquals(200, publicRequest(port, "GET", "/api/health", null, session, authority, null, forwarding).status());
        assertEquals(403, publicRequest(port, "GET", SETTINGS, null, session, authority, null, forwarding).status());
        for (String path : new String[]{SETTINGS, "/api/settings/ai", "/api/settings/development"})
            assertEquals(403, publicRequest(port, "PUT", path, Json.object(), session, authority, origin, forwarding).status(), path);
        assertEquals(403, request(port, "GET", "/api/health", null, session, null).status()); // LAN is independently disabled.
        assertEquals(403, publicRequest(server.port(), "GET", "/api/health", null, null, authority, null, null).status());
        assertEquals(403, publicRequest(server.port(), "GET", SETTINGS, null, null, "127.0.0.1:" + server.port(), null, forwarding).status());
        assertEquals(200, local("GET", "/api/health", null).status()); // Host access still needs no password.
        assertEquals(403, publicRequest(port, "POST", LOGIN, Json.object().put("password", PASSWORD), null, authority, "http://quiz.example.test", null).status());
        assertEquals(403, publicRequest(port, "POST", LOGIN, Json.object().put("password", PASSWORD), null, authority, "https://other.example.test", null).status());
        assertEquals(403, publicRequest(port, "GET", "/api/health", null, session, "other.example.test", null, null).status());
        assertEquals(403, publicRequest(port, "GET", "/api/health", null, session, "quiz.example.test:8443", null, null).status());
    }

    @Test void lanAndPublicSharePasswordAndRestoreBothSwitchesAfterRestart() throws Exception {
        start("127.0.0.1", null); int port = freePort(); String url = "http://198.51.100.10:9876/", authority = "198.51.100.10:9876", origin = "http://" + authority;
        assertEquals(200, local("PUT", SETTINGS, publicSettings(true, true, port, url, PASSWORD)).status());
        String lanSession = login(port, PASSWORD).body().path("token").asText();
        Reply publicLogin = publicRequest(port, "POST", LOGIN, Json.object().put("password", PASSWORD), null, authority, origin, null); assertEquals(200, publicLogin.status());
        String publicSession = publicLogin.body().path("token").asText();
        assertEquals(200, publicRequest(port, "GET", "/api/health", null, lanSession, authority, null, null).status());
        assertEquals(200, request(port, "GET", "/api/health", null, publicSession, null).status());
        assertEquals(200, local("PUT", SETTINGS, publicSettings(true, true, port, url, "replacement-password")).status());
        assertEquals(401, publicRequest(port, "GET", "/api/health", null, publicSession, authority, null, null).status());
        assertEquals(401, request(port, "GET", "/api/health", null, lanSession, null).status());
        assertEquals(401, publicRequest(port, "POST", LOGIN, Json.object().put("password", PASSWORD), null, authority, origin, null).status());
        server.close(); server = null; start("127.0.0.1", null);
        JsonNode restored = local("GET", SETTINGS, null).body(); assertTrue(restored.path("enabled").asBoolean()); assertTrue(restored.path("publicEnabled").asBoolean()); assertEquals(url, restored.path("publicUrl").asText());
        assertEquals(200, login(port, "replacement-password").status());
        assertEquals(200, publicRequest(port, "POST", LOGIN, Json.object().put("password", "replacement-password"), null, authority, origin, null).status());
        String current = login(port, "replacement-password").body().path("token").asText();
        assertEquals(200, local("PUT", SETTINGS, publicSettings(true, false, port, url, null)).status());
        assertEquals(403, publicRequest(port, "GET", "/api/health", null, current, authority, null, null).status());
        assertEquals(401, request(port, "GET", "/api/health", null, current, null).status());
        assertEquals(200, login(port, "replacement-password").status());
    }

    @Test void publicAddressValidationAndLegacySettingsKeepAccessClosedByDefault() throws Exception {
        NetworkSettings stored = new NetworkSettings(root, 8788);
        stored.save(stored.candidate(settings(true, 8788, PASSWORD), 8787));
        var legacy = (com.fasterxml.jackson.databind.node.ObjectNode) Json.read(root.resolve(".state/network-settings.json"), 8192);
        legacy.remove("publicEnabled"); legacy.remove("publicUrl"); Files.writeString(root.resolve(".state/network-settings.json"), legacy.toString());
        NetworkSettings restored = new NetworkSettings(root, 8788); assertTrue(restored.config().enabled()); assertFalse(restored.config().publicEnabled()); assertEquals("", restored.config().publicUrl());
        for (String address : new String[]{"", "https://example.test/path", "https://user@example.test", "https://example.test/?x=1", "https://example.test/#part", "file:///tmp/test", "https://localhost", "http://127.0.0.1:8787", "https://example.test:0", "https://example.test:65536"})
            assertThrows(ApiException.class, () -> restored.candidate(publicSettings(false, true, 8788, address, null), 8787), address);
        assertThrows(ApiException.class, () -> restored.candidate(((com.fasterxml.jackson.databind.node.ObjectNode) settings(false, 8788, null)).put("publicEnabled", "true"), 8787));
        assertTrue(restored.config().enabled()); assertFalse(restored.config().publicEnabled());
        assertTrue(QuizForgeServer.localNetworkPeer(InetAddress.getByName("192.168.1.2")));
        assertTrue(QuizForgeServer.localNetworkPeer(InetAddress.getByName("172.16.0.2")));
        assertFalse(QuizForgeServer.localNetworkPeer(InetAddress.getByName("198.51.100.7")));
        NetworkSettings fresh = new NetworkSettings(root.resolve("fresh"), 8788);
        assertThrows(ApiException.class, () -> fresh.candidate(publicSettings(false, true, 8788, "https://quiz.example.test/", null), 8787));
    }

    @Test void enablingLanRequiresPasswordAndProtectsApisWithExpiringSessions() throws Exception {
        start("127.0.0.1", null); int lanPort = freePort();
        assertTrue(local("GET", SETTINGS, null).body().path("canManage").asBoolean());
        assertEquals(400, local("PUT", SETTINGS, settings(true, lanPort, null)).status());
        assertEquals(400, local("PUT", SETTINGS, settings(true, lanPort, "short")).status());
        String session = enable(lanPort); assertNotEquals(PASSWORD, session);
        assertEquals(200, request(lanPort, "GET", "/", null, null, null).status());
        assertEquals(401, request(lanPort, "GET", "/api/health", null, null, null).status());
        assertEquals(200, request(lanPort, "GET", "/api/health", null, session, null).status());
        assertEquals(200, local("GET", "/api/health", null).status());
        assertEquals(403, request(lanPort, "POST", LOGIN, Json.object().put("password", PASSWORD), null, "https://other.example").status());
        assertEquals(401, login(lanPort, "wrong-password").status());
        String persisted = Files.readString(root.resolve(".state/network-settings.json")); assertFalse(persisted.contains(PASSWORD)); assertTrue(persisted.contains("PBKDF2WithHmacSHA256"));
    }

    @Test void passwordChangesPortChangesAndDisableInvalidateSessions() throws Exception {
        start("127.0.0.1", null); int lanPort = freePort(); String oldSession = enable(lanPort);
        assertEquals(200, local("PUT", SETTINGS, settings(true, lanPort, "replacement-password")).status());
        assertEquals(401, request(lanPort, "GET", "/api/health", null, oldSession, null).status()); assertEquals(401, login(lanPort, PASSWORD).status());
        String replacement = login(lanPort, "replacement-password").body().path("token").asText();
        assertEquals(200, local("PUT", SETTINGS, settings(true, lanPort, "")).status()); // Blank preserves the current password and session.
        assertEquals(200, request(lanPort, "GET", "/api/health", null, replacement, null).status());
        int nextPort = freePort(); assertEquals(200, local("PUT", SETTINGS, settings(true, nextPort, null)).status());
        assertEquals(401, request(nextPort, "GET", "/api/health", null, replacement, null).status());
        String movedSession = login(nextPort, "replacement-password").body().path("token").asText();
        assertEquals(200, local("PUT", SETTINGS, settings(false, nextPort, null)).status());
        assertFalse(local("GET", SETTINGS, null).body().path("enabled").asBoolean());
        assertEquals(200, local("PUT", SETTINGS, settings(true, nextPort, null)).status());
        assertEquals(401, request(nextPort, "GET", "/api/health", null, movedSession, null).status());
        assertEquals(200, local("GET", "/api/health", null).status());
    }

    @Test void settingsRestoreAfterRestartWithoutPersistingSessions() throws Exception {
        start("127.0.0.1", null); int lanPort = freePort(); String previous = enable(lanPort); server.close(); server = null; start("127.0.0.1", null);
        JsonNode restored = local("GET", SETTINGS, null).body(); assertTrue(restored.path("enabled").asBoolean()); assertTrue(restored.path("passwordConfigured").asBoolean()); assertEquals(lanPort, restored.path("port").asInt());
        assertEquals(401, request(lanPort, "GET", "/api/health", null, previous, null).status()); assertEquals(200, login(lanPort, PASSWORD).status());
    }

    @Test void unavailablePortDoesNotReplaceSettingsOrInterruptLocalAndLanAccess() throws Exception {
        start("127.0.0.1", null); int lanPort = freePort(); String session = enable(lanPort); byte[] saved = Files.readAllBytes(root.resolve(".state/network-settings.json"));
        try (ServerSocket occupied = new ServerSocket(0, 8, InetAddress.getByName("0.0.0.0"))) {
            Reply rejected = local("PUT", SETTINGS, settings(true, occupied.getLocalPort(), "do-not-save-this"));
            assertEquals(409, rejected.status()); assertEquals("LAN_SETTINGS_UNAVAILABLE", rejected.body().at("/error/code").asText());
        }
        assertArrayEquals(saved, Files.readAllBytes(root.resolve(".state/network-settings.json")));
        assertEquals(400, local("PUT", SETTINGS, settings(true, server.port(), null)).status());
        assertEquals(200, local("GET", "/api/health", null).status()); assertEquals(200, request(lanPort, "GET", "/api/health", null, session, null).status());
        server.close(); server = null;
        try (ServerSocket occupied = new ServerSocket(lanPort, 8, InetAddress.getByName("0.0.0.0"))) {
            start("127.0.0.1", null); assertEquals(200, local("GET", "/api/health", null).status());
            JsonNode status = local("GET", SETTINGS, null).body(); assertFalse(status.path("enabled").asBoolean()); assertTrue(status.has("error"));
        }
    }

    @Test void lanCannotManageSettingsAndLoginIsRateLimited() throws Exception {
        start("127.0.0.1", null); int lanPort = freePort(); String session = enable(lanPort);
        assertEquals(403, request(lanPort, "GET", SETTINGS, null, session, null).status());
        assertEquals(403, request(lanPort, "PUT", SETTINGS, settings(false, lanPort, null), session, "http://127.0.0.1:" + lanPort).status());
        assertEquals(403, request(server.port(), "PUT", SETTINGS, settings(false, lanPort, null), null, "http://other.example").status());
        for (int i = 0; i < 5; i++) assertEquals(401, login(lanPort, "wrong-password").status());
        assertEquals(429, login(lanPort, PASSWORD).status());
        assertTrue(local("GET", SETTINGS, null).body().path("enabled").asBoolean());
    }

    @Test void legacyTokenServerStillUsesExistingAuthAndCannotExposeASecondListener() throws Exception {
        String legacyToken = "legacy-access-token-12345"; start("0.0.0.0", legacyToken);
        assertEquals(401, login(server.port(), "wrong-password").status()); Reply loggedIn = login(server.port(), legacyToken);
        assertEquals(200, loggedIn.status()); assertEquals(legacyToken, loggedIn.body().path("token").asText());
        assertEquals(401, request(server.port(), "GET", "/api/health", null, null, null).status()); assertEquals(200, request(server.port(), "GET", "/api/health", null, legacyToken, null).status());
        Reply status = request(server.port(), "GET", SETTINGS, null, legacyToken, null); assertEquals(200, status.status()); assertFalse(status.body().path("canManage").asBoolean());
        assertEquals(403, request(server.port(), "PUT", SETTINGS, settings(true, freePort(), PASSWORD), legacyToken, "http://127.0.0.1:" + server.port()).status());
    }
}
