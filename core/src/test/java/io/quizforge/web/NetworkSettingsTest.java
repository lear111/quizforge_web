package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
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
