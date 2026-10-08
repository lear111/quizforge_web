package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;

/** Content-addressed image resources outlive mutable banks and their source folders. */
final class ResourceStore {
    static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final Map<String, String> TYPES = Map.of("image/png", "png", "image/jpeg", "jpg", "image/webp", "webp", "image/gif", "gif");
    record Resource(String id, String mime, byte[] bytes) { }
    private final Path root, directory;
    ResourceStore(Path root) { this.root = root; directory = root.resolve(".state/resources"); }

    synchronized ObjectNode upload(JsonNode request) throws IOException {
        if (request == null || !request.isObject() || request.size() != 2 || !request.has("mime") || !request.has("data")) throw ApiException.bad("Image upload requires mime and base64 data");
        String mime = Json.text(request, "mime", 80);
        JsonNode encoded = request.get("data");
        if (!TYPES.containsKey(mime)) throw new ApiException(415, "IMAGE_TYPE_UNSUPPORTED", "Only PNG, JPEG, WebP and GIF images are supported");
        if (encoded == null || !encoded.isTextual() || encoded.asText().isEmpty() || encoded.asText().length() > ((MAX_BYTES + 2) / 3) * 4) throw new ApiException(413, "IMAGE_SIZE_LIMIT", "Image exceeds 4 MiB");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded.asText()); } catch (IllegalArgumentException e) { throw ApiException.bad("Invalid base64 image"); }
        Resource resource = store(mime, bytes);
        return Json.object().put("id", resource.id()).put("mime", resource.mime()).put("size", bytes.length);
    }

    synchronized Resource read(String id) throws IOException {
        if (!id.matches("[a-f0-9]{64}")) throw ApiException.bad("Invalid image resource ID");
        safeDirectory(false);
        for (var type : TYPES.entrySet()) {
            Path file = directory.resolve(id + "." + type.getValue());
            if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) continue;
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(file) || Files.size(file) > MAX_BYTES) throw new ApiException(503, "RESOURCE_UNAVAILABLE", "Stored image is invalid");
            byte[] bytes = Files.readAllBytes(file);
            if (!id.equals(hash(bytes)) || !type.getKey().equals(detectMime(bytes))) throw new ApiException(503, "RESOURCE_UNAVAILABLE", "Stored image checksum or type is invalid");
            return new Resource(id, type.getKey(), bytes);
        }
        throw new ApiException(404, "RESOURCE_NOT_FOUND", "Image resource does not exist");
    }

    synchronized void importAssets(Path bankDirectory) throws IOException {
        Path assets = bankDirectory.resolve("assets");
        if (!Files.exists(assets, LinkOption.NOFOLLOW_LINKS)) return;
        if (Files.isSymbolicLink(assets) || !Files.isDirectory(assets, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Bank assets must be a normal directory");
        try (var paths = Files.walk(assets)) {
            var files = paths.limit(1001).toList();
            if (files.size() > 1000) throw new IOException("Too many bank assets");
            for (Path file : files) {
                if (Files.isSymbolicLink(file)) throw new IOException("Bank assets cannot contain symlinks");
                if (Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) continue;
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_BYTES) throw new IOException("Invalid bank asset size");
                byte[] bytes = Files.readAllBytes(file); String mime = detectMime(bytes);
                if (mime == null) throw new IOException("Bank assets support only PNG, JPEG, WebP and GIF");
                store(mime, bytes);
            }
        }
    }

    synchronized void exportReferences(Path bankDirectory, JsonNode document) throws IOException {
        var ids = new java.util.LinkedHashSet<String>(); collectReferences(document, ids);
        if (ids.isEmpty()) return;
        Path assets = bankDirectory.resolve("assets");
        if (Files.isSymbolicLink(bankDirectory) || Files.isSymbolicLink(assets) || (Files.exists(assets, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(assets, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Unsafe bank asset directory");
        Files.createDirectories(assets);
        for (String id : ids) {
            Resource resource;
            try { resource = read(id); } catch (ApiException e) { throw new ApiException(422, "IMAGE_REFERENCE_UNAVAILABLE", "A referenced image is unavailable; the question was not saved"); }
            Path destination = assets.resolve(id + "." + TYPES.get(resource.mime()));
            if (!Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) EditJournal.replace(destination, resource.bytes());
            else if (!Files.isRegularFile(destination, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(destination) || Files.size(destination) != resource.bytes().length || !MessageDigest.isEqual(Files.readAllBytes(destination), resource.bytes())) throw new IOException("Bank image has unrelated changes");
        }
    }
    private static void collectReferences(JsonNode value, java.util.Set<String> ids) {
        if (value.isObject()) {
            if (value.path("type").asText().equals("image") && value.path("attrs").has("assetId")) {
                JsonNode id = value.path("attrs").get("assetId");
                if (!id.isTextual() || !id.asText().matches("[a-f0-9]{64}")) throw ApiException.bad("Invalid image resource reference"); ids.add(id.asText());
            }
            for (JsonNode child : value) collectReferences(child, ids);
        } else if (value.isArray()) for (JsonNode child : value) collectReferences(child, ids);
    }

    private Resource store(String mime, byte[] bytes) throws IOException {
        if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new ApiException(413, "IMAGE_SIZE_LIMIT", "Image exceeds 4 MiB");
        if (!mime.equals(detectMime(bytes))) throw new ApiException(415, "IMAGE_TYPE_MISMATCH", "Image bytes do not match the declared type");
        safeDirectory(true); String id = hash(bytes); Path file = directory.resolve(id + "." + TYPES.get(mime));
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) EditJournal.replace(file, bytes);
        else if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(file) || Files.size(file) != bytes.length || !MessageDigest.isEqual(Files.readAllBytes(file), bytes)) throw new IOException("Stored image has unrelated changes");
        return new Resource(id, mime, bytes);
    }
    private void safeDirectory(boolean create) throws IOException {
        Path state = root.resolve(".state");
        if (Files.isSymbolicLink(state) || Files.isSymbolicLink(directory) || (Files.exists(directory, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Unsafe resource directory");
        if (create) Files.createDirectories(directory);
    }
    static String hash(byte[] bytes) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); } }
    private static String detectMime(byte[] bytes) {
        if (bytes.length >= 24 && bytes[0] == (byte) 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G' && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10 && bytes[12] == 'I' && bytes[13] == 'H' && bytes[14] == 'D' && bytes[15] == 'R') return "image/png";
        if (bytes.length >= 4 && bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xd8 && bytes[bytes.length - 2] == (byte) 0xff && bytes[bytes.length - 1] == (byte) 0xd9) return "image/jpeg";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return "image/webp";
        if (bytes.length >= 10 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == '8' && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a') return "image/gif";
        return null;
    }
}
