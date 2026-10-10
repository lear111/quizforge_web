package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

/** Developer packages are opt-in on the host computer, independently of normal startup. */
final class DevelopmentSettings {
    private final Path root, path;
    private volatile boolean enabled;
    DevelopmentSettings(Path root) throws IOException {
        this.root = root; path = root.resolve(".state/development-settings.json");
        if (Files.isSymbolicLink(root.resolve(".state")) || Files.isSymbolicLink(path)) throw new IOException("Unsafe developer settings path");
        if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            JsonNode value = Json.read(path, 4096);
            if (!value.isObject() || value.path("schemaVersion").asInt() != 1 || !value.path("enabled").isBoolean()) throw new IOException("Invalid developer settings");
            enabled = value.path("enabled").asBoolean();
        }
    }
    boolean enabled() { return enabled; }
    ObjectNode status(boolean canManage) { return Json.object().put("enabled", enabled).put("canManage", canManage); }
    synchronized ObjectNode update(JsonNode request) throws IOException {
        if (request == null || !request.isObject() || request.size() != 1 || !request.path("enabled").isBoolean()) throw ApiException.bad("Developer settings require enabled");
        if (Files.isSymbolicLink(root.resolve(".state")) || Files.isSymbolicLink(path)) throw new IOException("Unsafe developer settings path");
        Files.createDirectories(path.getParent());
        boolean next = request.path("enabled").asBoolean();
        EditJournal.replace(path, Json.MAPPER.writeValueAsBytes(Json.object().put("schemaVersion", 1).put("enabled", next)));
        enabled = next; return status(true);
    }
    void requireEnabled() { if (!enabled) throw new ApiException(404, "DEVELOPMENT_DISABLED", "Enable developer mode on the host computer first"); }
}
