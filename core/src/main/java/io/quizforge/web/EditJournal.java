package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Base64;

/** A durable forward-only transaction for the bank and its matching practice state. */
final class EditJournal {
    private final Path root, stateRoot, journal;
    EditJournal(Path root) { this(root, root); }
    EditJournal(Path root, Path stateRoot) { this.root = root; this.stateRoot = stateRoot; journal = stateRoot.resolve(".state/.edit-journal.json"); }
    boolean recover() throws IOException {
        if (!Files.exists(journal, LinkOption.NOFOLLOW_LINKS)) return false;
        JsonNode value = Json.read(journal, 128 * 1024 * 1024);
        if (value.isObject() && value.path("schemaVersion").asInt() == 2) return recoverSource(value);
        if (!value.isObject() || value.path("schemaVersion").asInt() != 1) throw new IOException("Invalid edit journal");
        Path bank = bankPath(Json.text(value, "bank", 240)), state = statePath(Json.text(value, "state", 80));
        byte[] bankBefore = unpack(value.get("bankBefore"), 8 * 1024 * 1024), bankAfter = unpack(value.get("bankAfter"), 8 * 1024 * 1024);
        byte[] stateBefore = unpack(value.get("stateBefore"), 32 * 1024 * 1024), stateAfter = unpack(value.get("stateAfter"), 32 * 1024 * 1024);
        if (bankBefore == null || bankAfter == null || stateAfter == null) throw new IOException("Incomplete edit journal");
        verifyDigest(value, "bankBefore", bankBefore); verifyDigest(value, "bankAfter", bankAfter); verifyDigest(value, "stateBefore", stateBefore); verifyDigest(value, "stateAfter", stateAfter);
        JsonNode plannedBank = Json.MAPPER.readTree(bankAfter), plannedState = Json.MAPPER.readTree(stateAfter);
        String expectedKind = value.path("kind").asText(root.equals(stateRoot) ? "bank" : "development-bank"), expectedId = value.path("collectionId").asText(plannedBank == null ? "" : plannedBank.path("id").asText());
        if (!java.util.List.of("bank", "extension", "development", "development-bank").contains(expectedKind) || plannedBank == null || !plannedBank.isObject() || !plannedBank.path("id").isTextual() || !plannedBank.path("id").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}") || !plannedBank.path("questions").isArray() || plannedState == null || !plannedState.isObject() || plannedState.path("schemaVersion").asInt() != 1 || !plannedState.path("questions").isObject() || !plannedState.path("collection").asText().startsWith(expectedKind + ":" + expectedId + ":")) throw new IOException("Invalid planned edit data");
        // Refuse recovery over unrelated administrator changes. Leave all recovery evidence intact.
        verify(bank, bankBefore, bankAfter); verify(state, stateBefore, stateAfter);
        replace(bank, bankAfter); replace(state, stateAfter); Files.delete(journal); return true;
    }
    void commit(Library.EditPlan edit, Path state, byte[] stateAfter) throws IOException {
        if (Files.exists(journal, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Pending edit journal");
        Path bank = bankPath(root.relativize(edit.path()).toString().replace('\\', '/'));
        Path target = statePath(state.getFileName().toString());
        if (!Arrays.equals(read(bank), edit.before())) throw new ApiException(409, "CONTENT_CONFLICT", "Bank changed before the edit could be saved");
        ObjectNode value = Json.object().put("schemaVersion", 1).put("bank", root.relativize(bank).toString().replace('\\', '/')).put("state", target.getFileName().toString());
        value.put("kind", edit.collection().kind()).put("collectionId", edit.collection().id());
        value.set("bankBefore", pack(edit.before())); value.set("bankAfter", pack(edit.after())); value.set("stateBefore", pack(read(target))); value.set("stateAfter", pack(stateAfter));
        for (String field : java.util.List.of("bankBefore", "bankAfter", "stateBefore", "stateAfter")) value.put(field + "Digest", digest(unpack(value.get(field), 32 * 1024 * 1024)));
        replace(journal, Json.MAPPER.writeValueAsBytes(value));
        // Once the durable journal exists, restart recovery completes this exact edit.
        recover();
    }
    void commitSource(Library.EditPlan edit) throws IOException {
        if (Files.isSymbolicLink(stateRoot.resolve(".state"))) throw new IOException("Unsafe edit journal directory"); Files.createDirectories(journal.getParent());
        if (Files.exists(journal, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Pending edit journal");
        Path bank = bankPath(root.relativize(edit.path()).toString().replace('\\', '/'));
        if (!Arrays.equals(read(bank), edit.before())) throw new ApiException(409, "CONTENT_CONFLICT", "Source changed before the edit could be saved");
        ObjectNode value = Json.object().put("schemaVersion", 2).put("bank", root.relativize(bank).toString().replace('\\', '/'));
        value.set("bankBefore", pack(edit.before())); value.set("bankAfter", pack(edit.after())); value.put("bankBeforeDigest", digest(edit.before())).put("bankAfterDigest", digest(edit.after()));
        replace(journal, Json.MAPPER.writeValueAsBytes(value)); recover();
    }
    private boolean recoverSource(JsonNode value) throws IOException {
        Path bank = bankPath(Json.text(value, "bank", 240)); byte[] before = unpack(value.get("bankBefore"), 8 * 1024 * 1024), after = unpack(value.get("bankAfter"), 8 * 1024 * 1024);
        if (before == null || after == null || value.has("state") || value.has("stateAfter")) throw new IOException("Invalid source-only edit journal"); verifyDigest(value, "bankBefore", before); verifyDigest(value, "bankAfter", after);
        JsonNode document = Json.MAPPER.readTree(after); if (document == null || !document.isObject() || !document.path("questions").isArray()) throw new IOException("Invalid planned source edit");
        verify(bank, before, after); replace(bank, after); Files.delete(journal); return true;
    }
    private Path bankPath(String value) throws IOException {
        Path relative;
        try { relative = Path.of(value); } catch (RuntimeException e) { throw new IOException("Invalid journal bank path"); }
        boolean legacy = relative.getNameCount() == 2 && relative.getFileName().toString().endsWith(".json");
        boolean folder = relative.getNameCount() == 3 && relative.getFileName().toString().equals("bank.json");
        boolean example = false;
        if (relative.getNameCount() >= 3 && relative.getNameCount() <= 9 && relative.getName(0).toString().equals("extensions")) for (Path extension : ExtensionDirectories.scan(root.resolve("extensions"))) {
            Path manifest = extension.resolve("manifest.json"); if (!Files.isRegularFile(manifest, LinkOption.NOFOLLOW_LINKS)) continue;
            try { JsonNode definition = Json.read(manifest, 256 * 1024); if (!definition.path("examples").isTextual()) continue;
                if (Json.safeFile(extension, definition.path("examples").asText()).equals(root.resolve(relative).toAbsolutePath().normalize())) { example = true; break; }
            } catch (IOException | ApiException unrelated) { /* Invalid unrelated leaves must not prevent editing a valid sample. */ }
        }
        if (value.contains("\\") || value.contains(":") || relative.isAbsolute() || (!example && ((!legacy && !folder) || !relative.getName(0).toString().equals("question-banks"))) || !relative.normalize().equals(relative)) throw new IOException("Invalid journal bank path");
        Path result = root.resolve(relative).normalize();
        if (!result.startsWith(root)) throw new IOException("Unsafe journal bank path");
        Path segment = root; for (Path component : relative) { segment = segment.resolve(component); if (Files.isSymbolicLink(segment)) throw new IOException("Unsafe journal bank path"); } return result;
    }
    private Path statePath(String value) throws IOException {
        if (!value.matches("[a-f0-9]{64}\\.json")) throw new IOException("Invalid journal state path");
        Path result = stateRoot.resolve(".state").resolve(value); if (Files.isSymbolicLink(result)) throw new IOException("Unsafe journal state path"); return result;
    }
    private static byte[] read(Path path) throws IOException { if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return null; if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 32 * 1024 * 1024) throw new IOException("Invalid transaction target"); return Files.readAllBytes(path); }
    private static void verify(Path path, byte[] before, byte[] after) throws IOException { byte[] current = read(path); if (!Arrays.equals(current, before) && !Arrays.equals(current, after)) throw new IOException("Transaction target has unrelated changes"); }
    private static String digest(byte[] bytes) { if (bytes == null) return "absent"; try { return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); } }
    private static void verifyDigest(JsonNode journal, String field, byte[] bytes) throws IOException { if (!journal.path(field + "Digest").asText().equals(digest(bytes))) throw new IOException("Edit journal checksum mismatch"); }
    private static JsonNode pack(byte[] bytes) {
        if (bytes == null) return Json.MAPPER.nullNode(); ArrayNode chunks = Json.MAPPER.createArrayNode();
        for (int offset = 0; offset < bytes.length; offset += 512 * 1024) chunks.add(Base64.getEncoder().encodeToString(Arrays.copyOfRange(bytes, offset, Math.min(bytes.length, offset + 512 * 1024)))); return chunks;
    }
    private static byte[] unpack(JsonNode chunks, int max) throws IOException {
        if (chunks != null && chunks.isNull()) return null;
        if (chunks == null || !chunks.isArray() || chunks.size() > 64) throw new IOException("Invalid journal bytes");
        var output = new java.io.ByteArrayOutputStream();
        try { for (JsonNode chunk : chunks) { if (!chunk.isTextual()) throw new IOException("Invalid journal bytes"); byte[] bytes = Base64.getDecoder().decode(chunk.asText()); if (bytes.length > 512 * 1024 || output.size() + bytes.length > max) throw new IOException("Journal target exceeds limit"); output.write(bytes); } }
        catch (IllegalArgumentException e) { throw new IOException("Invalid journal bytes"); } return output.toByteArray();
    }
    static void replace(Path path, byte[] bytes) throws IOException {
        if (Files.isSymbolicLink(path) || Files.isSymbolicLink(path.getParent())) throw new IOException("Unsafe transaction path");
        Path temporary = Files.createTempFile(path.getParent(), ".write-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) { ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true); }
            Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }
}
