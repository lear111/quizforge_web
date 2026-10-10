package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** LAN and public access share credentials; only a salted password hash is persisted. */
final class NetworkSettings {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int ITERATIONS = 210_000;
    private static final long SESSION_LIFETIME = Duration.ofHours(12).toMillis();
    private static final long LOGIN_WINDOW = Duration.ofMinutes(1).toMillis();
    private final Path file;
    private final HashMap<String, Long> sessions = new HashMap<>();
    private final LinkedHashMap<String, LoginWindow> attempts = new LinkedHashMap<>();
    private Config config;

    record Config(boolean enabled, boolean publicEnabled, String publicUrl, int port, byte[] salt, byte[] hash) {
        boolean remoteEnabled() { return enabled || publicEnabled; }
        boolean passwordConfigured() { return salt != null && hash != null; }
    }
    private record LoginWindow(long start, int count) { }

    NetworkSettings(Path root, int defaultPort) throws IOException {
        file = root.resolve(".state/network-settings.json");
        config = new Config(false, false, "", defaultPort, null, null);
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            JsonNode saved = Json.read(file, 8 * 1024);
            if (saved == null || !saved.isObject() || saved.path("schemaVersion").asInt() != 1
                    || !saved.path("enabled").isBoolean() || !saved.path("port").isIntegralNumber()
                    || !saved.path("port").canConvertToInt()
                    || (saved.has("publicEnabled") && !saved.path("publicEnabled").isBoolean())
                    || (saved.has("publicUrl") && !saved.path("publicUrl").isTextual())) throw new IOException("Invalid network settings");
            int port = saved.path("port").asInt();
            if (port < 1024 || port > 65535) throw new IOException("Invalid saved network port");
            byte[] salt = null, hash = null;
            if (saved.has("password")) {
                JsonNode password = saved.path("password");
                if (!"PBKDF2WithHmacSHA256".equals(password.path("algorithm").asText())
                        || password.path("iterations").asInt() != ITERATIONS) throw new IOException("Invalid connection password hash");
                try { salt = Base64.getDecoder().decode(password.path("salt").asText()); hash = Base64.getDecoder().decode(password.path("hash").asText()); }
                catch (IllegalArgumentException e) { throw new IOException("Invalid connection password hash", e); }
                if (salt.length != 16 || hash.length != 32) throw new IOException("Invalid connection password hash");
            }
            boolean publicEnabled = saved.path("publicEnabled").asBoolean(false);
            String publicUrl;
            try { publicUrl = normalizePublicUrl(saved.path("publicUrl").asText("")); }
            catch (ApiException error) { throw new IOException("Invalid saved public address", error); }
            if (publicEnabled && publicUrl.isEmpty()) throw new IOException("Public access requires an address");
            if ((saved.path("enabled").asBoolean() || publicEnabled) && salt == null) throw new IOException("Remote access requires a password");
            config = new Config(saved.path("enabled").asBoolean(), publicEnabled, publicUrl, port, salt, hash);
        }
    }

    synchronized Config config() { return config; }

    synchronized Config candidate(JsonNode request, int localPort) {
        if (request == null || !request.isObject() || !request.path("enabled").isBoolean()
                || !request.path("port").isIntegralNumber() || !request.path("port").canConvertToInt()
                || (request.has("publicEnabled") && !request.path("publicEnabled").isBoolean())
                || (request.has("publicUrl") && !request.path("publicUrl").isTextual())) throw ApiException.bad("Provide connection switches and a valid port");
        int port = request.path("port").asInt();
        if (port < 1024 || port > 65535 || port == localPort) throw ApiException.bad("Connection port must be 1024..65535 and different from the local port");
        boolean publicEnabled = request.has("publicEnabled") ? request.path("publicEnabled").asBoolean() : config.publicEnabled();
        String publicUrl = request.has("publicUrl") ? normalizePublicUrl(request.path("publicUrl").asText()) : config.publicUrl();
        if (publicEnabled && publicUrl.isEmpty()) throw new ApiException(400, "INVALID_PUBLIC_URL", "开启公网连接时请填写公网访问地址");
        byte[] salt = config.salt(), hash = config.hash();
        if (request.has("password")) {
            if (!request.path("password").isTextual()) throw ApiException.bad("Invalid password");
            String password = request.path("password").asText();
            if (!password.isBlank()) {
                if (password.length() < 8 || password.length() > 256) throw ApiException.bad("Password must contain 8..256 characters");
                salt = new byte[16]; RANDOM.nextBytes(salt); hash = hash(password, salt);
            }
        }
        boolean enabled = request.path("enabled").asBoolean();
        if ((enabled || publicEnabled) && hash == null) throw ApiException.bad("Set a password before enabling remote access");
        return new Config(enabled, publicEnabled, publicUrl, port, salt, hash);
    }

    synchronized void save(Config replacement) throws IOException {
        ObjectNode saved = Json.object().put("schemaVersion", 1).put("enabled", replacement.enabled())
                .put("publicEnabled", replacement.publicEnabled()).put("publicUrl", replacement.publicUrl()).put("port", replacement.port());
        if (replacement.passwordConfigured()) saved.set("password", Json.object().put("algorithm", "PBKDF2WithHmacSHA256").put("iterations", ITERATIONS)
                .put("salt", Base64.getEncoder().encodeToString(replacement.salt())).put("hash", Base64.getEncoder().encodeToString(replacement.hash())));
        Path directory = file.getParent();
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory) || (Files.exists(file, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Invalid network settings location");
        Path temporary = Files.createTempFile(directory, ".network-settings-", ".tmp");
        try {
            Files.write(temporary, Json.MAPPER.writeValueAsBytes(saved));
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
        boolean credentialsChanged = !java.util.Arrays.equals(config.hash(), replacement.hash());
        if (config.enabled() != replacement.enabled() || config.publicEnabled() != replacement.publicEnabled()
                || !config.publicUrl().equals(replacement.publicUrl()) || config.port() != replacement.port() || credentialsChanged) sessions.clear();
        config = replacement;
    }

    synchronized String login(String password, String peer) {
        if (!config.remoteEnabled() || !config.passwordConfigured()) throw new ApiException(401, "PASSWORD_REQUIRED", "Remote access is not enabled");
        limitLogin(peer);
        if (password == null || password.length() > 256 || !MessageDigest.isEqual(config.hash(), hash(password, config.salt()))) throw new ApiException(401, "PASSWORD_REQUIRED", "Incorrect connection password");
        long now = System.currentTimeMillis(); sessions.entrySet().removeIf(entry -> entry.getValue() <= now);
        if (sessions.size() >= 128) sessions.clear();
        byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes); String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        sessions.put(token, now + SESSION_LIFETIME); return token;
    }

    synchronized void limitLogin(String peer) {
        long now = System.currentTimeMillis();
        attempts.entrySet().removeIf(entry -> now - entry.getValue().start() >= LOGIN_WINDOW);
        LoginWindow current = attempts.get(peer);
        if (current != null && current.count() >= 6) throw new ApiException(429, "LOGIN_RATE_LIMITED", "Too many login attempts; try again in a minute");
        if (attempts.size() >= 256 && current == null) throw new ApiException(429, "LOGIN_RATE_LIMITED", "Too many login attempts; try again in a minute");
        attempts.put(peer, new LoginWindow(current == null ? now : current.start(), current == null ? 1 : current.count() + 1));
    }

    synchronized boolean authenticated(String token) {
        if (!config.remoteEnabled() || token == null) return false;
        Long expires = sessions.get(token); if (expires == null) return false;
        if (expires <= System.currentTimeMillis()) { sessions.remove(token); return false; }
        return true;
    }

    synchronized void invalidateSessions() { sessions.clear(); }

    static String normalizePublicUrl(String value) {
        String message = "公网访问地址需为 http:// 或 https:// 域名／公网 IP 地址，可带端口，不包含路径、账号或查询参数。";
        if (value.isBlank()) return "";
        if (value.length() > 500) throw new ApiException(400, "INVALID_PUBLIC_URL", message);
        try {
            URI uri = URI.create(value.strip()); String scheme = uri.getScheme(), host = uri.getHost();
            if (scheme == null || host == null) throw new IllegalArgumentException();
            scheme = scheme.toLowerCase(java.util.Locale.ROOT); host = host.replace("[", "").replace("]", "").toLowerCase(java.util.Locale.ROOT);
            if ((!scheme.equals("http") && !scheme.equals("https")) || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (!uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/")) || uri.getPort() < -1 || uri.getPort() == 0 || uri.getPort() > 65535
                    || host.equals("localhost") || host.endsWith(".localhost") || host.startsWith("127.") || host.equals("::1") || host.equals("::") || host.equals("0.0.0.0")) throw new IllegalArgumentException();
            int port = uri.getPort(); if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            return scheme + "://" + (host.contains(":") ? "[" + host + "]" : host) + (port == -1 ? "" : ":" + port) + "/";
        } catch (IllegalArgumentException error) { throw new ApiException(400, "INVALID_PUBLIC_URL", message); }
    }

    private static byte[] hash(String password, byte[] salt) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException("Password hashing unavailable", e); }
        finally { spec.clearPassword(); }
    }
}
