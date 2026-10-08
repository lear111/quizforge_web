package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryFlag;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/** The server owns the single active profile; browser responses never carry credentials. */
final class AiSettings {
    record Profile(boolean enabled, URI baseUrl, String model, String apiKey, boolean vision, String outputMode, int maxOutputTokens, int timeoutSeconds) {
        @Override public String toString() { return "AiProfile[enabled=" + enabled + ",apiKeyConfigured=" + !apiKey.isEmpty() + "]"; }
    }
    private final Path root, directory, file;
    private Profile profile = new Profile(false, null, "", "", false, "json", 2048, 60);
    AiSettings(Path root) throws IOException {
        this.root = root; directory = root.resolve(".state/ai"); file = directory.resolve("profile.json");
        safe(false);
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            try { profile = parse(Json.read(file, 32 * 1024), profile, true); }
            catch (IOException | RuntimeException e) { throw new IOException("Invalid AI profile"); }
            restrict(directory, true); restrict(file, false);
        }
    }
    synchronized Profile profile() { return profile; }
    synchronized ObjectNode status() {
        return Json.object().put("enabled", profile.enabled()).put("provider", "openai-compatible").put("baseUrl", profile.baseUrl() == null ? "" : profile.baseUrl().toString()).put("model", profile.model())
                .put("apiKeyConfigured", !profile.apiKey().isEmpty()).put("vision", profile.vision()).put("outputMode", profile.outputMode()).put("maxOutputTokens", profile.maxOutputTokens()).put("timeoutSeconds", profile.timeoutSeconds());
    }
    synchronized ObjectNode update(JsonNode request) throws IOException {
        Profile replacement = parse(request, profile, false); safe(true);
        ObjectNode stored = Json.object().put("schemaVersion", 1).put("enabled", replacement.enabled()).put("provider", "openai-compatible").put("baseUrl", replacement.baseUrl() == null ? "" : replacement.baseUrl().toString()).put("model", replacement.model())
                .put("apiKey", replacement.apiKey()).put("vision", replacement.vision()).put("outputMode", replacement.outputMode()).put("maxOutputTokens", replacement.maxOutputTokens()).put("timeoutSeconds", replacement.timeoutSeconds());
        EditJournal.replace(file, Json.MAPPER.writeValueAsBytes(stored)); restrict(file, false); profile = replacement; return status();
    }
    private static Profile parse(JsonNode request, Profile previous, boolean stored) {
        if (request == null || !request.isObject()) throw ApiException.bad("Invalid AI settings");
        Set<String> fields = Set.of("schemaVersion", "enabled", "provider", "baseUrl", "model", "apiKey", "clearApiKey", "vision", "outputMode", "maxOutputTokens", "timeoutSeconds");
        request.fieldNames().forEachRemaining(field -> { if (!fields.contains(field) || (!stored && field.equals("schemaVersion"))) throw ApiException.bad("Invalid AI settings field"); });
        if (stored && request.path("schemaVersion").asInt() != 1) throw ApiException.bad("Invalid AI settings version");
        if (request.has("provider") && (!request.path("provider").isTextual() || !request.path("provider").asText().equals("openai-compatible"))) throw ApiException.bad("Unsupported AI provider");
        boolean enabled = bool(request, "enabled", previous.enabled()), vision = bool(request, "vision", previous.vision()), clear = bool(request, "clearApiKey", false);
        String url = text(request, "baseUrl", previous.baseUrl() == null ? "" : previous.baseUrl().toString(), 2048), model = text(request, "model", previous.model(), 200), key = text(request, "apiKey", "", 4096);
        if (key.indexOf('\r') >= 0 || key.indexOf('\n') >= 0 || key.chars().anyMatch(c -> c < 32 || c > 126)) throw ApiException.bad("Invalid AI credential");
        if (clear && !key.isEmpty()) throw ApiException.bad("Cannot replace and clear the API key together");
        if (!stored && key.isEmpty() && !clear) key = previous.apiKey();
        if (clear) key = "";
        String mode = text(request, "outputMode", previous.outputMode(), 20);
        if (!List.of("schema", "json", "text").contains(mode)) throw ApiException.bad("Invalid AI output mode");
        URI base = url.isBlank() ? null : baseUri(url);
        if (enabled && (base == null || model.isBlank())) throw ApiException.bad("AI address and model are required when enabled");
        return new Profile(enabled, base, model, key, vision, mode, number(request, "maxOutputTokens", previous.maxOutputTokens(), 256, 8192), number(request, "timeoutSeconds", previous.timeoutSeconds(), 10, 120));
    }
    private static URI baseUri(String value) {
        URI uri;
        try { uri = URI.create(value); } catch (IllegalArgumentException e) { throw ApiException.bad("Invalid model base URL"); }
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535 || (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) || !uri.normalize().equals(uri)) throw ApiException.bad("Model base URL must be HTTP(S) without credentials, query or fragment");
        if (uri.getScheme().equals("http")) {
            try { for (InetAddress address : InetAddress.getAllByName(uri.getHost())) if (!address.isLoopbackAddress() && !address.isSiteLocalAddress() && !address.isLinkLocalAddress() && !(address.getAddress().length == 16 && (address.getAddress()[0] & 0xfe) == 0xfc)) throw ApiException.bad("HTTP model endpoints must be localhost or a private network"); }
            catch (java.net.UnknownHostException e) { throw ApiException.bad("Local model host cannot be resolved"); }
        }
        String url = uri.toString(); return URI.create(url.endsWith("/") ? url.substring(0, url.length() - 1) : url);
    }
    private static boolean bool(JsonNode value, String field, boolean fallback) { if (!value.has(field)) return fallback; if (!value.path(field).isBoolean()) throw ApiException.bad("Invalid AI " + field); return value.path(field).asBoolean(); }
    private static String text(JsonNode value, String field, String fallback, int max) { if (!value.has(field)) return fallback; if (!value.path(field).isTextual() || value.path(field).asText().length() > max) throw ApiException.bad("Invalid AI " + field); return value.path(field).asText().strip(); }
    private static int number(JsonNode value, String field, int fallback, int min, int max) { if (!value.has(field)) return fallback; if (!value.path(field).isIntegralNumber() || !value.path(field).canConvertToInt() || value.path(field).asInt() < min || value.path(field).asInt() > max) throw ApiException.bad("Invalid AI " + field); return value.path(field).asInt(); }
    private void safe(boolean create) throws IOException {
        Path state = root.resolve(".state");
        if (Files.isSymbolicLink(state) || Files.isSymbolicLink(directory) || Files.isSymbolicLink(file) || (Files.exists(directory, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Unsafe AI settings path");
        if (create) { Files.createDirectories(directory); restrict(directory, true); }
    }
    private static void restrict(Path path, boolean directory) throws IOException {
        PosixFileAttributeView posix = Files.getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (posix != null) { posix.setPermissions(PosixFilePermissions.fromString(directory ? "rwx------" : "rw-------")); return; }
        AclFileAttributeView acl = Files.getFileAttributeView(path, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (acl == null) throw new IOException("Filesystem cannot protect AI credentials");
        var entry = AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(Files.getOwner(path, LinkOption.NOFOLLOW_LINKS)).setPermissions(EnumSet.allOf(AclEntryPermission.class));
        if (directory) entry.setFlags(AclEntryFlag.FILE_INHERIT, AclEntryFlag.DIRECTORY_INHERIT);
        acl.setAcl(List.of(entry.build()));
        var owner = Files.getOwner(path, LinkOption.NOFOLLOW_LINKS);
        if (acl.getAcl().stream().anyMatch(value -> value.type() == AclEntryType.ALLOW && value.permissions().contains(AclEntryPermission.READ_DATA) && !value.principal().equals(owner))) throw new IOException("Filesystem did not protect AI credentials");
    }
}
