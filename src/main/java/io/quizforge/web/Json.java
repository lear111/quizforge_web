package io.quizforge.web;

import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

final class Json {
    static final ObjectMapper MAPPER = new ObjectMapper();
    static { MAPPER.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS); MAPPER.enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION); MAPPER.getFactory().setStreamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(64).maxStringLength(2_000_000).maxNumberLength(100).build()); }
    static ObjectNode object() { return MAPPER.createObjectNode(); }
    static String fingerprint(JsonNode value, String extensionFingerprint) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256"); digest.update(extensionFingerprint.getBytes(StandardCharsets.UTF_8)); digest.update((byte) 0); digest.update(MAPPER.writeValueAsBytes(canonical(value))); return HexFormat.of().formatHex(digest.digest());
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static JsonNode canonical(JsonNode value) {
        if (value.isObject()) { ObjectNode object = object(); var names = new java.util.ArrayList<String>(); value.fieldNames().forEachRemaining(names::add); names.sort(String::compareTo); for (String name : names) object.set(name, canonical(value.get(name))); return object; }
        if (value.isArray()) { var array = MAPPER.createArrayNode(); for (JsonNode child : value) array.add(canonical(child)); return array; }
        return value;
    }
    static JsonNode read(Path path, int max) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > max) throw new IOException("Invalid file or size");
        return MAPPER.readTree(Files.readAllBytes(path));
    }
    static String text(JsonNode node, String key, int max) {
        JsonNode value = node.get(key);
        if (value == null || !value.isTextual() || value.asText().isBlank() || value.asText().length() > max) throw ApiException.bad("Invalid " + key);
        return value.asText();
    }
    static String id(JsonNode node, String key) {
        String value = text(node, key, 120);
        if (!value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw ApiException.bad("Invalid " + key);
        return value;
    }
    static Path safeFile(Path directory, String relative) throws IOException {
        Path rel;
        try { rel = Path.of(relative); } catch (RuntimeException e) { throw new IOException("Invalid asset path"); }
        if (rel.isAbsolute() || relative.contains("\\") || relative.contains(":") || relative.contains("\0")) throw new IOException("Invalid asset path");
        Path base = directory.toRealPath();
        Path candidate = base.resolve(rel).normalize();
        if (!candidate.startsWith(base) || !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS) || !candidate.toRealPath().startsWith(base)) throw new IOException("Invalid asset path");
        Path segment = base;
        for (Path component : base.relativize(candidate)) { segment = segment.resolve(component); if (Files.isSymbolicLink(segment)) throw new IOException("Symlinks are not supported"); }
        return candidate;
    }
}
