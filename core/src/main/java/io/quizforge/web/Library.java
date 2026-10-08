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
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class Library {
    record Dependency(String id, String version) { }
    record Extension(String id, String version, String name, String description, Path directory,
                     Path entry, Path script, Path style, Path rules, Path questionSchema, Path answerSchema, Path examples, String fingerprint, List<Dependency> dependencies) {
        Extension(String id, String version, String name, String description, Path directory, Path entry, Path script, Path style, Path rules, Path questionSchema, Path answerSchema, Path examples, String fingerprint) {
            this(id, version, name, description, directory, entry, script, style, rules, questionSchema, answerSchema, examples, fingerprint, List.of());
        }
    }
    record Question(String id, String title, JsonNode data, String fingerprint, Extension extension) {
        Question(String id, String title, JsonNode data, String fingerprint) { this(id, title, data, fingerprint, null); }
    }
    record EditPlan(Path path, byte[] before, byte[] after, Collection collection, Question question) { }
    record Collection(String id, String title, String description, String kind, Extension extension, List<Question> questions,
                      List<Extension> extensions, String extensionFingerprint) {
        private record Bindings(List<Question> questions, List<Extension> extensions, String fingerprint) { }
        Collection(String id, String title, String description, String kind, Extension extension, List<Question> questions) {
            this(id, title, description, kind, extension, bindings(extension, questions));
        }
        private Collection(String id, String title, String description, String kind, Extension extension, Bindings bindings) {
            this(id, title, description, kind, extension, bindings.questions(), bindings.extensions(), bindings.fingerprint());
        }
        Collection {
            questions = List.copyOf(questions); extensions = List.copyOf(extensions);
        }
        String stateKey() { return kind + ":" + id + ":" + (extension == null ? "mixed" : extension.id() + ":" + extension.version()); }
        Question question(String id) { return questions.stream().filter(q -> q.id().equals(id)).findFirst().orElseThrow(() -> new ApiException(404, "QUESTION_NOT_FOUND", "Question does not exist")); }
        Extension extensionFor(Question question) {
            Extension value = question.extension() == null ? extension : question.extension();
            if (value == null) throw ApiException.bad("Question extension is missing");
            return value;
        }
        private static Bindings bindings(Extension extension, List<Question> questions) {
            List<Question> resolved = questions.stream().map(q -> q.extension() == null && extension != null ? new Question(q.id(), q.title(), q.data(), q.fingerprint(), extension) : q).toList();
            var values = new LinkedHashMap<String, Extension>();
            for (Question question : resolved) {
                Extension value = question.extension(); if (value == null) throw ApiException.bad("Question extension is missing");
                values.putIfAbsent(value.id() + "@" + value.version(), value);
            }
            List<Extension> used = List.copyOf(values.values());
            if (extension != null) return new Bindings(resolved, used, extension.fingerprint());
            ArrayNode identities = Json.MAPPER.createArrayNode();
            used.stream().sorted(Comparator.comparing(e -> e.id() + "@" + e.version())).forEach(e -> identities.add(Json.object().put("id", e.id()).put("version", e.version()).put("fingerprint", e.fingerprint())));
            return new Bindings(resolved, used, Json.fingerprint(identities, "quizforge-mixed-extensions-v1"));
        }
    }
    private final Path root;
    private final Path codeRoot;
    private final RuleEngine engine;
    private final ResourceStore resources;
    private Map<String, Extension> extensions = Map.of();
    private Map<String, Collection> banks = Map.of(), previews = Map.of();
    private Map<String, Path> bankPaths = Map.of();
    private ObjectNode catalog = Json.object();
    private String previousSignature = null;
    Library(Path root, RuleEngine engine) { this(root, root, engine); }
    Library(Path root, Path codeRoot, RuleEngine engine) { this.root = root; this.codeRoot = codeRoot; this.engine = engine; resources = new ResourceStore(root); }

    synchronized ObjectNode catalog() { refresh(); return catalog.deepCopy(); }
    synchronized Collection collection(String kind, String id) {
        refresh();
        Map<String, Collection> values = switch (kind) { case "bank" -> banks; case "extension" -> previews; default -> throw ApiException.bad("Invalid collection kind"); };
        Collection collection = values.get(id);
        if (collection == null) throw new ApiException(404, "COLLECTION_NOT_FOUND", "Collection unavailable; inspect catalog errors");
        return collection;
    }
    synchronized ObjectNode page(String id, String version) {
        refresh(); Extension extension = extensions.get(id + "@" + version);
        if (extension == null) throw new ApiException(404, "EXTENSION_NOT_FOUND", "Extension is unavailable");
        try { return snapshotPage(extension); }
        catch (IOException e) { throw new ApiException(422, "INVALID_EXTENSION", "Extension page is unavailable"); }
    }
    static ObjectNode snapshotPage(Extension extension) throws IOException {
        return withDependencies(Json.object().put("html", asset(extension.entry())).put("script", asset(extension.script())).put("style", asset(extension.style())), extension);
    }
    synchronized ObjectNode editorPage(Extension extension) {
        Path declaration = extension.directory().resolve("editor.json");
        if (!Files.exists(declaration, LinkOption.NOFOLLOW_LINKS)) return null;
        try {
            JsonNode config = Json.read(Json.safeFile(extension.directory(), "editor.json"), 256 * 1024);
            return withDependencies(Json.object().put("html", asset(Json.safeFile(extension.directory(), Json.text(config, "entry", 240))))
                    .put("script", asset(Json.safeFile(extension.directory(), Json.text(config, "script", 240))))
                    .put("style", asset(Json.safeFile(extension.directory(), Json.text(config, "style", 240)))), extension);
        } catch (IOException | RuntimeException e) { throw new ApiException(422, "INVALID_EDITOR", "Extension editor declaration or assets are invalid"); }
    }
    private static ObjectNode withDependencies(ObjectNode page, Extension extension) {
        if (!extension.dependencies().isEmpty()) {
            ArrayNode values = page.putArray("dependencies");
            for (Dependency dependency : extension.dependencies()) values.add(Json.object().put("id", dependency.id()).put("version", dependency.version()));
        }
        return page;
    }
    synchronized ObjectNode sdk(String id, String version) {
        return sdk(id, version, false);
    }
    synchronized ObjectNode sdk(String id, String version, boolean editor) {
        validateSdk(id, version);
        try {
            ObjectNode snapshot = resolveSdk(id, version);
            if (editor) return Json.object().put("script", snapshot.path("editorScript").asText());
            return Json.object().put("script", snapshot.path("script").asText()).put("style", snapshot.path("style").asText());
        } catch (IOException e) { throw new ApiException(404, "SDK_UNAVAILABLE", "Requested public SDK version is unavailable"); }
    }
    private List<Dependency> dependencies(JsonNode manifest) throws IOException {
        JsonNode values = manifest.get("dependencies"); if (values == null) return List.of();
        if (!values.isArray() || values.size() > 4) throw ApiException.bad("Invalid SDK dependencies");
        List<Dependency> result = new ArrayList<>(); var ids = new HashSet<String>();
        for (JsonNode value : values) {
            if (!value.isObject() || value.size() != 2) throw ApiException.bad("Invalid SDK dependency");
            String id = Json.id(value, "id"), version = Json.id(value, "version"); validateSdk(id, version);
            if (!ids.add(id)) throw ApiException.bad("Duplicate SDK dependency");
            try { resolveSdk(id, version); }
            catch (IOException e) { throw new ApiException(422, "SDK_UNAVAILABLE", "Public SDK " + id + "@" + version + " is unavailable: " + e.getMessage()); }
            result.add(new Dependency(id, version));
        }
        return List.copyOf(result);
    }
    private static void validateSdk(String id, String version) {
        if (!id.equals("quizforge.richtext") || !version.matches("[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}")) throw new ApiException(404, "SDK_UNAVAILABLE", "Unsupported public SDK package or version");
    }
    private ObjectNode resolveSdk(String id, String version) throws IOException {
        Path archive = sdkArchive(id, version, false);
        // Once published locally, the snapshot serves banks and frozen history.
        // Source rebuilds must never replace that version's installed assets.
        return Files.exists(archive, LinkOption.NOFOLLOW_LINKS) ? readSdkArchive(archive, id, version) : pinSdk(id, version);
    }
    private ObjectNode pinSdk(String id, String version) throws IOException {
        Path source = codeRoot.resolve("shared/richtext").resolve(version);
        if (Files.isSymbolicLink(codeRoot.resolve("shared")) || Files.isSymbolicLink(codeRoot.resolve("shared/richtext")) || Files.isSymbolicLink(source)) throw new IOException("Unsafe SDK directory");
        ObjectNode current = Json.object().put("id", id).put("version", version).put("script", asset(Json.safeFile(source, "richtext.js"))).put("editorScript", asset(Json.safeFile(source, "richtext-editor.js"))).put("style", asset(Json.safeFile(source, "richtext.css")));
        Path archive = sdkArchive(id, version, true);
        if (Files.exists(archive, LinkOption.NOFOLLOW_LINKS)) {
            ObjectNode stored = readSdkArchive(archive, id, version);
            if (!stored.equals(current)) throw new ApiException(409, "SDK_VERSION_CHANGED", "Public SDK versions are immutable; publish changes under a new version");
            return stored;
        }
        EditJournal.replace(archive, Json.MAPPER.writeValueAsBytes(current)); return current;
    }
    private Path sdkArchive(String id, String version, boolean create) throws IOException {
        Path current = root;
        for (String component : List.of(".state", "sdk", id, version)) {
            current = current.resolve(component);
            if (Files.isSymbolicLink(current) || (Files.exists(current, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS))) throw new IOException("Unsafe SDK archive directory");
            if (create) Files.createDirectories(current);
        }
        Path file = current.resolve("sdk.json"); if (Files.isSymbolicLink(file)) throw new IOException("Unsafe SDK archive"); return file;
    }
    private static ObjectNode readSdkArchive(Path path, String id, String version) throws IOException {
        JsonNode value = Json.read(path, 5 * 1024 * 1024);
        if (!value.isObject() || value.size() != 5 || !value.path("id").asText().equals(id) || !value.path("version").asText().equals(version) || !value.path("script").isTextual() || !value.path("editorScript").isTextual() || !value.path("style").isTextual() || value.path("script").asText().length() > 1024 * 1024 || value.path("editorScript").asText().length() > 1024 * 1024 || value.path("style").asText().length() > 1024 * 1024) throw new IOException("Invalid SDK archive");
        return (ObjectNode) value;
    }
    synchronized EditPlan prepareEdit(Collection current, String questionId, String title, JsonNode data) {
        if (!current.kind().equals("bank")) throw new ApiException(409, "READ_ONLY_COLLECTION", "Extension examples cannot be edited as a bank");
        Collection latest = collection("bank", current.id());
        if (!latest.equals(current)) throw new ApiException(409, "CONTENT_CONFLICT", "Bank changed while preparing the edit");
        Path path = bankPaths.get(current.id());
        try {
            byte[] before = Files.readAllBytes(path); ObjectNode raw = (ObjectNode) Json.MAPPER.readTree(before);
            if (!parseCollection(raw, "bank", current.extension(), current.id(), null).equals(current)) throw new ApiException(409, "CONTENT_CONFLICT", "Bank changed while reading the edit source");
            for (JsonNode item : raw.path("questions")) if (item.path("id").asText().equals(questionId)) {
                ((ObjectNode) item).put("title", title); ((ObjectNode) item).set("data", data.deepCopy());
            }
            Collection replacement = parseCollection(raw, "bank", current.extension(), current.id(), null);
            if (path.getFileName().toString().equals("bank.json") && !path.getParent().equals(root.resolve("question-banks"))) resources.exportReferences(path.getParent(), data);
            byte[] after = Json.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsBytes(raw);
            if (after.length > 8 * 1024 * 1024) throw new ApiException(413, "BANK_SIZE_LIMIT", "Bank exceeds the size limit");
            return new EditPlan(path, before, after, replacement, replacement.question(questionId));
        } catch (IOException e) { throw new ApiException(503, "BANK_UNAVAILABLE", "Bank cannot be prepared for editing"); }
    }
    synchronized EditPlan prepareShortAnswerUpgrade(Collection current) throws IOException {
        if (!current.kind().equals("bank") || current.extension() == null || !current.extension().id().equals("quizforge.short-answer") || !java.util.Set.of("1.0.0", "1.1.0", "1.2.0").contains(current.extension().version()))
            throw ApiException.bad("Only short-answer 1.0.0, 1.1.0 or 1.2.0 banks can use this upgrade");
        Collection latest = collection("bank", current.id());
        if (!latest.equals(current)) throw new ApiException(409, "CONTENT_CONFLICT", "Bank changed before upgrade");
        Extension target = shortAnswerUpgradeTarget();
        Path path = bankPaths.get(current.id()); byte[] before = Files.readAllBytes(path);
        ObjectNode raw = (ObjectNode) Json.MAPPER.readTree(before);
        if (!parseCollection(raw, "bank", current.extension(), current.id(), null).equals(current)) throw new ApiException(409, "CONTENT_CONFLICT", "Bank changed while reading upgrade source");
        ((ObjectNode) raw.path("extension")).put("version", target.version());
        if (!current.extension().version().equals("1.2.0")) {
            for (JsonNode question : raw.path("questions")) {
                String title = question.path("title").asText().trim();
                ObjectNode stem = (ObjectNode) question.path("data").path("stem");
                ArrayNode content = (ArrayNode) stem.path("content");
                // The new view has one stem; retain the old separate title as rich text.
                if (!title.isEmpty() && (content.isEmpty() || !nodeText(content.get(0)).trim().equals(title))) {
                    ObjectNode heading = Json.object().put("type", "heading"); heading.putObject("attrs").put("level", 2);
                    heading.putArray("content").addObject().put("type", "text").put("text", title);
                    content.insert(0, heading);
                }
            }
        }
        Collection replacement = parseCollection(raw, "bank", target, current.id(), null);
        return new EditPlan(path, before, Json.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsBytes(raw), replacement, null);
    }
    private Extension shortAnswerUpgradeTarget() {
        for (JsonNode row : catalog.path("extensions")) {
            if (row.path("id").asText().equals("quizforge.short-answer") && row.path("version").asText().equals("1.2.1") && row.has("error"))
                throw new ApiException(row.path("errorStatus").asInt(422), row.path("errorCode").asText("INVALID_EXTENSION"), "Short-answer upgrade target 1.2.1 is unavailable: " + row.path("error").asText());
        }
        Extension target = extensions.get("quizforge.short-answer@1.2.1");
        if (target == null) throw new ApiException(422, "MISSING_EXTENSION", "Advanced short-answer 1.2.1 is not installed");
        return target;
    }
    private static String nodeText(JsonNode node) {
        if (node == null) return "";
        if (node.path("type").asText().equals("text")) return node.path("text").asText();
        StringBuilder value = new StringBuilder(); for (JsonNode child : node.path("content")) value.append(nodeText(child)); return value.toString();
    }
    private void refresh() {
        List<Path> extensionFolders = children(root.resolve("extensions"), false, 200);
        List<Path> bankFiles = bankFiles(root.resolve("question-banks"));
        String signature = signature(extensionFolders, bankFiles);
        if (signature.equals(previousSignature)) return;
        boolean transientRuleFailure = false;
        Map<String, Extension> nextExtensions = new LinkedHashMap<>();
        Map<String, Collection> nextBanks = new LinkedHashMap<>(), nextPreviews = new HashMap<>();
        Map<String, Path> nextBankPaths = new HashMap<>();
        ArrayNode extensionCatalog = Json.MAPPER.createArrayNode(), bankCatalog = Json.MAPPER.createArrayNode();
        for (Path folder : extensionFolders) {
            ObjectNode entry = Json.object().put("id", fallback(folder)).put("version", "?").put("name", fallback(folder)).put("description", "").put("questionCount", 0);
            try {
                Extension extension = extension(folder, entry);
                resources.importAssets(folder);
                entry.put("id", extension.id()).put("version", extension.version()).put("name", extension.name()).put("description", extension.description());
                String key = extension.id() + "@" + extension.version();
                if (nextExtensions.containsKey(key)) throw ApiException.bad("Duplicate extension version");
                nextExtensions.put(key, extension);
                try {
                    Collection preview = parseCollection(extension.examples(), "extension", extension, extension.id(), "examples");
                    entry.put("questionCount", preview.questions().size());
                    Collection previous = nextPreviews.get(extension.id());
                    if (previous == null || compareVersion(extension.version(), previous.extension().version()) > 0) nextPreviews.put(extension.id(), preview);
                } catch (Exception e) { transientRuleFailure |= transientRules(e); catalogError(entry, e, "INVALID_EXTENSION_EXAMPLES", "Invalid extension examples or question data"); }
            } catch (Exception e) { catalogError(entry, e, "INVALID_EXTENSION", "Invalid extension manifest or declared assets"); }
            extensionCatalog.add(entry);
        }
        for (Path file : bankFiles) {
            ObjectNode entry = Json.object().put("id", fallback(file).replaceFirst("\\.json$", "")).put("title", fallback(file)).put("description", "").put("questionCount", 0);
            try {
                if (file.getFileName().toString().equals("bank.json") && !file.getParent().equals(root.resolve("question-banks"))) resources.importAssets(file.getParent());
                JsonNode raw = Json.read(file, 8 * 1024 * 1024);
                String id = Json.id(raw, "id"), title = Json.text(raw, "title", 300);
                entry.put("id", id).put("title", title).put("description", optional(raw, "description", 4000));
                Extension extension = raw.has("extension") ? resolveExtension(raw.get("extension"), nextExtensions) : null;
                if (nextBanks.containsKey(id)) throw ApiException.bad("Duplicate bank ID");
                Collection bank = parseResolvedCollection(raw, "bank", extension, id, nextExtensions);
                if (bank.extension() == null) entry.putNull("extension");
                else entry.set("extension", extensionReference(bank.extension()));
                ArrayNode used = entry.putArray("extensions"); for (Extension value : bank.extensions()) used.add(extensionReference(value));
                nextBanks.put(id, bank); nextBankPaths.put(id, file); entry.put("questionCount", bank.questions().size());
            } catch (Exception e) { transientRuleFailure |= transientRules(e); catalogError(entry, e, "INVALID_BANK", "Invalid bank JSON, extension reference, or question data"); }
            bankCatalog.add(entry);
        }
        // The preview route is keyed by type ID and opens its latest installed version.
        // Keep older packages addressable for bound banks/history, without duplicate preview rows.
        ArrayNode previewsCatalog = Json.MAPPER.createArrayNode();
        for (JsonNode entry : extensionCatalog) {
            Collection preview = nextPreviews.get(entry.path("id").asText());
            if (entry.has("error") || preview == null || entry.path("version").asText().equals(preview.extension().version())) previewsCatalog.add(entry);
        }
        catalog = Json.object(); catalog.set("banks", bankCatalog); catalog.set("extensions", previewsCatalog);
        extensions = Map.copyOf(nextExtensions); banks = Map.copyOf(nextBanks); bankPaths = Map.copyOf(nextBankPaths); previews = Map.copyOf(nextPreviews); previousSignature = transientRuleFailure ? null : signature;
    }
    private static boolean transientRules(Exception failure) {
        return failure instanceof ApiException api && (api.code.equals("RULE_TIMEOUT") || api.code.equals("RULE_UNAVAILABLE"));
    }
    private static void catalogError(ObjectNode entry, Exception failure, String defaultCode, String description) {
        if (failure instanceof ApiException api) entry.put("error", api.getMessage()).put("errorCode", api.code).put("errorStatus", api.status);
        else entry.put("error", description + (failure.getMessage() == null ? "" : ": " + failure.getMessage())).put("errorCode", defaultCode).put("errorStatus", 422);
    }
    private Extension extension(Path folder, ObjectNode entry) throws IOException {
        JsonNode manifest = Json.read(Json.safeFile(folder, "manifest.json"), 256 * 1024);
        String id = Json.id(manifest, "id"), version = Json.id(manifest, "version");
        entry.put("id", id).put("version", version).put("name", Json.text(manifest, "name", 300)).put("description", optional(manifest, "description", 4000));
        List<Path> assets = new ArrayList<>();
        for (String field : List.of("entry", "script", "style", "rules", "questionSchema", "answerSchema", "examples")) {
            Path asset = Json.safeFile(folder, Json.text(manifest, field, 240));
            int max = field.equals("examples") ? 8 * 1024 * 1024 : 1024 * 1024;
            if (Files.size(asset) > max) throw new IOException("Asset size limit"); assets.add(asset);
        }
        return new Extension(id, version, Json.text(manifest, "name", 300), optional(manifest, "description", 4000), folder,
                assets.get(0), assets.get(1), assets.get(2), assets.get(3), assets.get(4), assets.get(5), assets.get(6), extensionFingerprint(folder, assets), dependencies(manifest));
    }
    private static String extensionFingerprint(Path folder, List<Path> assets) throws IOException {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256"); digest.update("quizforge-extension-v1".getBytes(StandardCharsets.UTF_8));
            var files = new ArrayList<Path>(); files.add(Json.safeFile(folder, "manifest.json")); files.addAll(assets.subList(0, 6));
            for (Path file : files) { byte[] bytes = Files.readAllBytes(file); digest.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.length).array()); digest.update(bytes); }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private Collection parseCollection(Path file, String kind, Extension extension, String id, String requiredFileId) throws IOException {
        JsonNode raw = Json.read(file, 8 * 1024 * 1024);
        if (requiredFileId != null && !requiredFileId.equals(Json.id(raw, "id"))) throw ApiException.bad("Invalid example ID");
        return parseCollection(raw, kind, extension, id, (String) null);
    }
    private Collection parseCollection(JsonNode raw, String kind, Extension extension, String id, String ignored) {
        var available = new HashMap<>(extensions);
        if (extension != null) available.put(extension.id() + "@" + extension.version(), extension);
        return parseResolvedCollection(raw, kind, extension, id, available);
    }
    private Collection parseResolvedCollection(JsonNode raw, String kind, Extension extension, String id, Map<String, Extension> available) {
        if (!raw.isObject() || kind.equals("bank") && !id.equals(Json.id(raw, "id"))) throw ApiException.bad("Invalid bank ID");
        Extension fallback = raw.has("extension") ? resolveExtension(raw.get("extension"), available) : null;
        if (extension != null && (fallback == null || !extension.id().equals(fallback.id()) || !extension.version().equals(fallback.version()))) throw ApiException.bad("Extension mismatch");
        JsonNode questions = raw.get("questions");
        if (questions == null || !questions.isArray() || questions.isEmpty() || questions.size() > 10000) throw ApiException.bad("Invalid questions");
        var list = new ArrayList<Question>(); var ids = new HashSet<String>(); boolean perQuestion = false;
        for (JsonNode question : questions) {
            String qid = Json.id(question, "id");
            if (!ids.add(qid) || !question.has("data")) throw ApiException.bad("Duplicate question or missing data");
            Extension owner = question.has("extension") ? resolveExtension(question.get("extension"), available) : fallback;
            if (owner == null) throw ApiException.bad("Missing question extension");
            if (kind.equals("extension") && (extension == null || !owner.id().equals(extension.id()) || !owner.version().equals(extension.version()))) throw ApiException.bad("Example extension mismatch");
            perQuestion |= question.has("extension");
            JsonNode rawData = question.get("data").deepCopy();
            list.add(new Question(qid, Json.text(question, "title", 300), rawData, Json.fingerprint(rawData, owner.fingerprint()), owner));
        }
        RuleBatches.validate(engine, list);
        Extension collectionExtension = kind.equals("extension") ? extension : perQuestion || fallback == null ? null : fallback;
        return new Collection(id, Json.text(raw, "title", 300), optional(raw, "description", 4000), kind, collectionExtension, List.copyOf(list));
    }
    private static Extension resolveExtension(JsonNode reference, Map<String, Extension> available) {
        if (reference == null || !reference.isObject()) throw ApiException.bad("Invalid extension reference");
        Extension value = available.get(Json.id(reference, "id") + "@" + Json.id(reference, "version"));
        if (value == null) throw ApiException.bad("Missing extension");
        return value;
    }
    private static ObjectNode extensionReference(Extension value) { return Json.object().put("id", value.id()).put("version", value.version()); }
    private static List<Path> children(Path directory, boolean jsonFiles, int limit) {
        if (!Files.exists(directory)) return List.of();
        if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) throw new ApiException(422, "INVALID_LIBRARY", "Library directory must be a normal directory");
        try (var paths = Files.list(directory)) {
            List<Path> values = paths.filter(path -> !Files.isSymbolicLink(path)).filter(path -> jsonFiles ? Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && path.getFileName().toString().endsWith(".json") : Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)).sorted().limit(limit + 1L).toList();
            if (values.size() > limit) throw new ApiException(422, "LIBRARY_LIMIT", "Library has too many entries"); return values;
        } catch (IOException e) { throw new ApiException(503, "LIBRARY_UNAVAILABLE", "Library directory cannot be read"); }
    }
    private static List<Path> bankFiles(Path directory) {
        var files = new ArrayList<>(children(directory, true, 1000));
        for (Path folder : children(directory, false, 1000)) {
            Path bank = folder.resolve("bank.json");
            if (Files.isRegularFile(bank, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(bank)) files.add(bank);
        }
        if (files.size() > 1000) throw new ApiException(422, "LIBRARY_LIMIT", "Library has too many banks");
        files.sort(Comparator.naturalOrder()); return List.copyOf(files);
    }
    private String signature(List<Path> folders, List<Path> banks) {
        StringBuilder signature = new StringBuilder();
        try {
            for (Path folder : folders) {
                signature.append(folder).append(':');
                try {
                    Path manifest = Json.safeFile(folder, "manifest.json"); stamp(signature, manifest);
                    JsonNode value = Json.read(manifest, 256 * 1024);
                    for (String field : List.of("entry", "script", "style", "rules", "questionSchema", "answerSchema", "examples")) stamp(signature, Json.safeFile(folder, Json.text(value, field, 240)));
                    JsonNode dependencies = value.path("dependencies");
                    if (dependencies.isArray()) for (JsonNode dependency : dependencies) {
                        String id = Json.id(dependency, "id"), version = Json.id(dependency, "version"); validateSdk(id, version);
                        Path sdk = codeRoot.resolve("shared/richtext").resolve(version);
                        stamp(signature, Json.safeFile(sdk, "richtext.js")); stamp(signature, Json.safeFile(sdk, "richtext-editor.js")); stamp(signature, Json.safeFile(sdk, "richtext.css"));
                    }
                    stampAssets(signature, folder);
                } catch (IOException | RuntimeException e) { signature.append("invalid;"); }
            }
            for (Path path : banks) {
                stamp(signature, path);
                if (path.getFileName().toString().equals("bank.json") && !path.getParent().equals(root.resolve("question-banks"))) {
                    stampAssets(signature, path.getParent());
                }
            }
        } catch (IOException e) { signature.append("unreadable"); }
        return signature.toString();
    }
    private static void stampAssets(StringBuilder signature, Path directory) throws IOException {
        Path assets = directory.resolve("assets");
        if (Files.isDirectory(assets, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(assets)) try (var entries = Files.walk(assets)) {
            for (Path file : entries.limit(1001).sorted().toList()) stamp(signature, file);
        }
    }
    private static void stamp(StringBuilder signature, Path path) throws IOException { signature.append(path).append(':').append(Files.size(path)).append(':').append(Files.getLastModifiedTime(path)).append(';'); }
    private static String optional(JsonNode raw, String field, int max) { if (!raw.has(field)) return ""; JsonNode value = raw.get(field); if (!value.isTextual() || value.asText().length() > max) throw ApiException.bad("Invalid " + field); return value.asText(); }
    private static String asset(Path path) throws IOException { if (Files.size(path) > 1024 * 1024) throw new IOException("Asset size limit"); return Files.readString(path, StandardCharsets.UTF_8); }
    private static String fallback(Path path) { String name = path.getFileName().toString(); return name.substring(0, Math.min(name.length(), 120)); }
    private static int compareVersion(String left, String right) {
        String[] a = left.split("[.-]"), b = right.split("[.-]");
        for (int i = 0; i < Math.max(a.length, b.length); i++) { String x = i < a.length ? a[i] : "0", y = i < b.length ? b[i] : "0"; int comparison; try { comparison = new java.math.BigInteger(x).compareTo(new java.math.BigInteger(y)); } catch (NumberFormatException e) { comparison = x.compareTo(y); } if (comparison != 0) return comparison; }
        return 0;
    }
}
