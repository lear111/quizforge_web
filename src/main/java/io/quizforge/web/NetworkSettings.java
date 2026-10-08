package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
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

/** LAN credentials are separate from question state; only a salted password hash is persisted. */
final class NetworkSettings {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int ITERATIONS = 210_000;
    private static final long SESSION_LIFETIME = Duration.ofHours(12).toMillis();
    private static final long LOGIN_WINDOW = Duration.ofMinutes(1).toMillis();
    private final Path file;
    private final HashMap<String, Long> sessions = new HashMap<>();
    private final LinkedHashMap<String, LoginWindow> attempts = new LinkedHashMap<>();
    private Config config;

    record Config(boolean enabled, int port, byte[] salt, byte[] hash) {
        boolean passwordConfigured() { return salt != null && hash != null; }
    }
    private record LoginWindow(long start, int count) { }

    NetworkSettings(Path root, int defaultPort) throws IOException {
        file = root.resolve(".state/network-settings.json");
        config = new Config(false, defaultPort, null, null);
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            JsonNode saved = Json.read(file, 8 * 1024);
            if (saved == null || !saved.isObject() || saved.path("schemaVersion").asInt() != 1
                    || !saved.path("enabled").isBoolean() || !saved.path("port").isIntegralNumber()
                    || !saved.path("port").canConvertToInt()) throw new IOException("Invalid LAN settings");
            int port = saved.path("port").asInt();
            if (port < 1024 || port > 65535) throw new IOException("Invalid saved LAN port");
            byte[] salt = null, hash = null;
            if (saved.has("password")) {
                JsonNode password = saved.path("password");
                if (!"PBKDF2WithHmacSHA256".equals(password.path("algorithm").asText())
                        || password.path("iterations").asInt() != ITERATIONS) throw new IOException("Invalid LAN password hash");
                try { salt = Base64.getDecoder().decode(password.path("salt").asText()); hash = Base64.getDecoder().decode(password.path("hash").asText()); }
                catch (IllegalArgumentException e) { throw new IOException("Invalid LAN password hash", e); }
                if (salt.length != 16 || hash.length != 32) throw new IOException("Invalid LAN password hash");
            }
            if (saved.path("enabled").asBoolean() && salt == null) throw new IOException("LAN access requires a password");
            config = new Config(saved.path("enabled").asBoolean(), port, salt, hash);
        }
    }

    synchronized Config config() { return config; }

    synchronized Config candidate(JsonNode request, int localPort) {
        if (request == null || !request.isObject() || !request.path("enabled").isBoolean()
                || !request.path("port").isIntegralNumber() || !request.path("port").canConvertToInt()) throw ApiException.bad("Provide enabled and a valid LAN port");
        int port = request.path("port").asInt();
        if (port < 1024 || port > 65535 || port == localPort) throw ApiException.bad("LAN port must be 1024..65535 and different from the local port");
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
        if (enabled && hash == null) throw ApiException.bad("Set a password before enabling LAN access");
        return new Config(enabled, port, salt, hash);
    }

    synchronized void save(Config replacement) throws IOException {
        ObjectNode saved = Json.object().put("schemaVersion", 1).put("enabled", replacement.enabled()).put("port", replacement.port());
        if (replacement.passwordConfigured()) saved.set("password", Json.object().put("algorithm", "PBKDF2WithHmacSHA256").put("iterations", ITERATIONS)
                .put("salt", Base64.getEncoder().encodeToString(replacement.salt())).put("hash", Base64.getEncoder().encodeToString(replacement.hash())));
        Path directory = file.getParent();
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory) || (Files.exists(file, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Invalid LAN settings location");
        Path temporary = Files.createTempFile(directory, ".network-settings-", ".tmp");
        try {
            Files.write(temporary, Json.MAPPER.writeValueAsBytes(saved));
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
        boolean credentialsChanged = !java.util.Arrays.equals(config.hash(), replacement.hash());
        if (!replacement.enabled() || config.port() != replacement.port() || credentialsChanged) sessions.clear();
        config = replacement;
    }

    synchronized String login(String password, String peer) {
        if (!config.enabled() || !config.passwordConfigured()) throw new ApiException(401, "PASSWORD_REQUIRED", "LAN access is not enabled");
        limitLogin(peer);
        if (password == null || password.length() > 256 || !MessageDigest.isEqual(config.hash(), hash(password, config.salt()))) throw new ApiException(401, "PASSWORD_REQUIRED", "Incorrect LAN password");
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
        if (!config.enabled() || token == null) return false;
        Long expires = sessions.get(token); if (expires == null) return false;
        if (expires <= System.currentTimeMillis()) { sessions.remove(token); return false; }
        return true;
    }

    synchronized void invalidateSessions() { sessions.clear(); }

    private static byte[] hash(String password, byte[] salt) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException("Password hashing unavailable", e); }
        finally { spec.clearPassword(); }
    }
}
