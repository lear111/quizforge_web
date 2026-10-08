package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

/** Incomplete editor documents are deliberately independent of formal question validation. */
final class EditorDraftStore {
    static final int MAX_BYTES = 1024 * 1024;
    private final Path root, directory;
    EditorDraftStore(Path root) { this.root = root; directory = root.resolve(".state/editor-drafts"); }
    synchronized ObjectNode get(String bank, String question) throws IOException {
        Path file = file(bank, question, false);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return Json.object().putNull("draft");
        JsonNode stored = Json.read(file, MAX_BYTES);
        if (!stored.isObject() || stored.path("schemaVersion").asInt() != 1 || !bank.equals(stored.path("bank").asText()) || !question.equals(stored.path("question").asText())) throw new ApiException(503, "EDITOR_DRAFT_UNAVAILABLE", "Stored editor draft is invalid");
        validate(stored);
        ObjectNode result = Json.object().put("contentVersion", stored.path("contentVersion").asText()).put("changed", stored.path("changed").asBoolean()); result.set("draft", stored.path("draft").deepCopy()); return result;
    }
    synchronized ObjectNode put(String bank, String question, JsonNode request) throws IOException {
        validate(request);
        if (request.size() != 3) throw ApiException.bad("Editor draft requires contentVersion, draft and changed");
        ObjectNode stored = Json.object().put("schemaVersion", 1).put("bank", bank).put("question", question).put("contentVersion", request.path("contentVersion").asText()).put("changed", request.path("changed").asBoolean()); stored.set("draft", request.path("draft").deepCopy());
        byte[] bytes = Json.MAPPER.writeValueAsBytes(stored);
        if (bytes.length > MAX_BYTES) throw new ApiException(413, "EDITOR_DRAFT_SIZE_LIMIT", "Editor draft exceeds 1 MiB");
        EditJournal.replace(file(bank, question, true), bytes); return Json.object().put("saved", true);
    }
    synchronized ObjectNode delete(String bank, String question) throws IOException { return Json.object().put("deleted", Files.deleteIfExists(file(bank, question, false))); }
    private static void validate(JsonNode request) {
        if (request == null || !request.isObject() || !request.path("contentVersion").isTextual() || !request.path("contentVersion").asText().matches("[a-f0-9]{64}") || !request.path("draft").isObject() || !request.path("changed").isBoolean()) throw ApiException.bad("Invalid editor draft envelope");
    }
    private Path file(String bank, String question, boolean create) throws IOException {
        if (!bank.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}") || !question.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw ApiException.bad("Invalid editor draft ID");
        Path state = root.resolve(".state");
        if (Files.isSymbolicLink(state) || Files.isSymbolicLink(directory) || (Files.exists(directory, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Unsafe editor draft directory");
        if (create) Files.createDirectories(directory);
        Path result = directory.resolve(ResourceStore.hash((bank + ":" + question).getBytes(StandardCharsets.UTF_8)) + ".json");
        if (Files.isSymbolicLink(result)) throw new IOException("Unsafe editor draft file"); return result;
    }
}
