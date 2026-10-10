package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashMap;

/** Development identifies an editable copy; it does not select a separate runtime. */
final class DevelopmentExtensions {
    record Package(String folder, String mode, String name, String description, Path directory, JsonNode marker, String revision) {
        ObjectNode metadata() { return Json.object().put("folder", folder); }
    }
    private static final Map<String, String> MEDIA = Map.ofEntries(Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"), Map.entry("webp", "image/webp"), Map.entry("gif", "image/gif"), Map.entry("svg", "image/svg+xml"), Map.entry("woff", "font/woff"), Map.entry("woff2", "font/woff2"), Map.entry("ttf", "font/ttf"), Map.entry("otf", "font/otf"));
    private DevelopmentExtensions() { }
    static boolean marked(Path directory) { return Files.exists(directory.resolve("development.json"), LinkOption.NOFOLLOW_LINKS); }
    static Package read(Path directory) throws IOException {
        String folder = directory.getFileName().toString();
        if (!folder.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw ApiException.bad("Invalid development folder ID");
        JsonNode marker = Json.read(Json.safeFile(directory, "development.json"), 256 * 1024);
        if (!marker.isObject()) throw ApiException.bad("Invalid development marker");
        if (marker.has("mode") && (!marker.path("mode").isTextual() || !List.of("ui", "runtime").contains(marker.path("mode").asText()))) throw ApiException.bad("Invalid legacy development mode");
        JsonNode manifest = Files.exists(directory.resolve("manifest.json"), LinkOption.NOFOLLOW_LINKS) ? Json.read(Json.safeFile(directory, "manifest.json"), 256 * 1024) : Json.object();
        String name = marker.has("name") ? Json.text(marker, "name", 300) : manifest.has("name") ? Json.text(manifest, "name", 300) : folder;
        if (marker.has("description") && (!marker.path("description").isTextual() || marker.path("description").asText().length() > 4000)) throw ApiException.bad("Invalid development description");
        String description = marker.path("description").asText("");
        if (marker.has("types") || marker.has("packageFormatVersion")) throw ApiException.bad("Each development extension provides one question type; use folders to group extensions");
        if (!Files.exists(directory.resolve("manifest.json"), LinkOption.NOFOLLOW_LINKS)) page(directory, marker, marker.path("assets"));
        if (marker.has("editor")) page(directory, marker.get("editor"), marker.path("assets"));
        Package value = new Package(folder, "runtime", name, description, directory, marker.deepCopy(), revision(directory));
        if (!Files.exists(directory.resolve("manifest.json"), LinkOption.NOFOLLOW_LINKS) && marker.has("examples")) {
            JsonNode examples = Json.read(Json.safeFile(directory, Json.text(marker, "examples", 240)), 8 * 1024 * 1024);
            if (!Json.id(examples, "id").equals("examples")) throw ApiException.bad("Invalid example ID"); uiQuestions(value, examples);
        }
        return value;
    }
    static ObjectNode descriptor(Package value) throws IOException {
        ObjectNode result = Json.object().put("id", value.folder()).put("title", value.name()).put("description", value.description()).put("revision", value.revision()).put("canEdit", value.marker().has("editor"));
        result.set("development", value.metadata());
        result.set("features", BankFeatures.DEFAULT.json());
        return result;
    }
    static ArrayNode uiQuestions(Package value, JsonNode raw) {
        if (raw == null || !raw.isObject()) throw ApiException.bad("Invalid UI sample bank");
        ExtensionApi.requireBank(raw); Json.text(raw, "title", 300);
        BankFeatures.read(raw);
        JsonNode questions = raw.path("questions"); if (!questions.isArray() || questions.isEmpty() || questions.size() > 10000) throw ApiException.bad("Invalid questions");
        JsonNode fallback = raw.get("extension"); if (fallback != null) requireUiReference(value, fallback);
        ArrayNode result = Json.MAPPER.createArrayNode(); var ids = new HashSet<String>();
        for (JsonNode question : questions) {
            if (question.has("features")) throw ApiException.bad("features belong at the bank root");
            if (!question.isObject() || !ids.add(Json.id(question, "id")) || !question.has("data")) throw ApiException.bad("Duplicate question or missing data");
            Json.text(question, "title", 300); requireUiReference(value, question.has("extension") ? question.get("extension") : fallback); result.add(question.deepCopy());
        }
        return result;
    }
    private static void requireUiReference(Package value, JsonNode reference) {
        if (reference == null || !reference.isObject() || reference.size() != 1 || !reference.path("development").isTextual() || !reference.path("development").asText().equals(value.folder())) throw ApiException.bad("UI sample questions must reference this single development extension");
    }
    static ObjectNode page(Path directory, JsonNode declaration, JsonNode media) throws IOException {
        if (declaration == null || !declaration.isObject()) throw ApiException.bad("Invalid development page declaration");
        String entry = Json.text(declaration, "entry", 240);
        ObjectNode page = Json.object().put("html", text(directory, entry)).put("entryPath", entry);
        for (String field : List.of("script", "style")) {
            page.put(field, declaration.has(field) ? text(directory, Json.text(declaration, field, 240)) : "");
            if (declaration.has(field)) page.put(field + "Path", declaration.path(field).asText());
        }
        if (!media.isMissingNode()) {
            if (!media.isArray() || media.size() > 100) throw ApiException.bad("Development assets must be a bounded list");
            long total = 0; var seen = new HashSet<String>(); ArrayNode assets = page.putArray("assets");
            for (JsonNode item : media) {
                if (!item.isTextual() || item.asText().isBlank() || item.asText().length() > 240 || !seen.add(item.asText())) throw ApiException.bad("Invalid development asset path");
                String relative = item.asText(), ext = relative.substring(relative.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT), mime = MEDIA.get(ext);
                if (mime == null) throw ApiException.bad("Development assets support image and font files");
                Path file = Json.safeFile(directory, relative); long size = Files.size(file); total += size;
                if (size > 1024 * 1024 || total > 8 * 1024 * 1024) throw new IOException("Inline static assets must be at most 1 MiB each and 8 MiB in total; use QF.resources for larger images");
                assets.add(Json.object().put("path", relative).put("mime", mime).put("base64", Base64.getEncoder().encodeToString(Files.readAllBytes(file))));
            }
        }
        return page;
    }
    private static String text(Path directory, String relative) throws IOException {
        Path file = Json.safeFile(directory, relative); if (Files.size(file) > 1024 * 1024) throw new IOException("Development page asset exceeds the size limit");
        return Files.readString(file, StandardCharsets.UTF_8);
    }
    static String revision(Path directory) throws IOException {
        StringBuilder value = new StringBuilder();
        try (var paths = Files.walk(directory)) {
            List<Path> files = paths.sorted().limit(1001).toList();
            if (files.size() > 1000) throw new IOException("Development package has too many files");
            for (Path file : files) {
                if (Files.isSymbolicLink(file)) throw new IOException("Development package cannot contain symlinks");
                if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) continue;
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Invalid development file");
                value.append(directory.relativize(file)).append(':').append(Files.size(file)).append(':').append(Files.getLastModifiedTime(file)).append(';');
            }
        }
        return ResourceStore.hash(value.toString().getBytes(StandardCharsets.UTF_8));
    }
    static Map<String, byte[]> snapshot(Path directory) throws IOException {
        var result = new LinkedHashMap<String, byte[]>(); long total = 0;
        try (var paths = Files.walk(directory)) {
            List<Path> files = paths.sorted().limit(1001).toList(); if (files.size() > 1000) throw new IOException("Development package has too many files");
            for (Path file : files) {
                if (Files.isSymbolicLink(file)) throw new IOException("Development package cannot contain symlinks");
                if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) continue;
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > 8 * 1024 * 1024) throw new IOException("Invalid development package file size");
                byte[] bytes = Files.readAllBytes(file); total += bytes.length;
                if (total > 32 * 1024 * 1024) throw new IOException("Development package exceeds 32 MiB");
                result.put(directory.relativize(file).toString().replace('\\', '/'), bytes);
            }
        }
        return result;
    }
    static String snapshotRevision(Map<String, byte[]> files) {
        ObjectNode signatures = Json.object(); files.forEach((path, bytes) -> signatures.put(path, ResourceStore.hash(bytes)));
        return Json.fingerprint(signatures, "quizforge-development-publish-v1");
    }
    static String runtimeId(String folder) { return "dev." + (folder.length() <= 116 ? folder : ResourceStore.hash(folder.getBytes(StandardCharsets.UTF_8))); }
    static ObjectNode runtimeMetadata(Library.Extension value) {
        String folder = value.directory().getFileName().toString();
        return value.version().equals("0.0.0") && value.id().equals(runtimeId(folder)) && marked(value.directory()) ? Json.object().put("folder", folder) : null;
    }
    static Library.Extension runtime(Library.Extension source, String folder, String revision) throws IOException {
        // Page/editor code and their visual assets trigger reloads, not answer invalidation.
        ObjectNode contract = Json.object().put("outlineItems", source.outlineItemsDeclared());
        if (source.contentApi() != null) contract.set("contentApi", source.contentApi());
        for (var item : List.of(Map.entry("rules", source.rules() == null ? "" : source.rules().toString()), Map.entry("questionSchema", source.questionSchema() == null ? "" : source.questionSchema().toString()), Map.entry("answerSchema", source.answerSchema() == null ? "" : source.answerSchema().toString()))) {
            contract.put(item.getKey(), item.getValue().isEmpty() ? "" : ResourceStore.hash(Files.readAllBytes(Path.of(item.getValue()))));
        }
        String fingerprint = Json.fingerprint(contract, "quizforge-development-rules-v2");
        return new Library.Extension(runtimeId(folder), "0.0.0", source.name(), source.description(), source.directory(), source.entry(), source.script(), source.style(), source.rules(), source.questionSchema(), source.answerSchema(), source.examples(), fingerprint, source.dependencies(), source.contentApi(), source.providerRevision() + ":" + revision, source.outlineItemsDeclared());
    }
    static JsonNode bindRuntimeExamples(JsonNode raw, Library.Extension original, Library.Extension runtime) {
        ObjectNode copy = (ObjectNode) raw.deepCopy();
        rewriteReference(copy, original, runtime);
        for (JsonNode item : copy.path("questions")) rewriteReference((ObjectNode) item, original, runtime);
        return copy;
    }
    private static void rewriteReference(ObjectNode item, Library.Extension original, Library.Extension runtime) {
        JsonNode reference = item.get("extension");
        if (reference == null) return;
        if (!reference.isObject() || reference.has("typeId")) throw ApiException.bad("Invalid example extension reference");
        boolean ownDevelopment = reference.has("development");
        if (ownDevelopment && (reference.size() != 1 || !reference.path("development").asText().equals(original.directory().getFileName().toString()))) throw ApiException.bad("Examples must reference their own development extension");
        if (ownDevelopment || reference.path("id").asText().equals(original.id()) && reference.path("version").asText().equals(original.version())) item.set("extension", Json.object().put("id", runtime.id()).put("version", runtime.version()));
    }
}
