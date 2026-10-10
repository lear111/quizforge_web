package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Uses unchanged legacy packages, isolated state, and executable routing fixtures. */
class VersionCompatibilityTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    @AfterEach void close() { fixture.close(); }
    void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    ObjectNode read(String path) throws Exception { return (ObjectNode) Json.read(root.resolve(path), 32 * 1024 * 1024); }
    Library library() throws Exception { return new Library(root, new RuleEngine(root, "node", Duration.ofSeconds(8))); }
    static ObjectNode requirement(String declaration) throws Exception {
        return Json.object().set("requiresApi", Json.MAPPER.readTree(declaration));
    }
    static void removeVersions(JsonNode value) {
        if (value.isObject()) ((ObjectNode) value).remove("apiVersion");
        for (JsonNode child : value) removeVersions(child);
    }

    @Test void absentAndCompatibleDeclarationsUseV1WhileInvalidRequirementsAreRejected() throws Exception {
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(Json.object()));
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(requirement("{\"major\":1,\"minMinor\":0}")));
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(requirement("{\"major\":1.0,\"minMinor\":0.0}")));
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(requirement("{\"major\":1,\"minMinor\":1,\"capabilities\":[\"outline-items\"]}")));
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(requirement("{\"major\":1,\"minMinor\":2,\"capabilities\":[\"score\",\"outline-items\"]}")));
        assertDoesNotThrow(() -> ExtensionApi.requireManifest(requirement("""
                {"major":1,"minMinor":0,"capabilities":["practice","editor","editor-drafts","score","manual-review","ai-grading","resources","richtext","navigation","lifecycle"]}
                """)));
        for (String invalid : List.of("null", "[]", "{}", "{\"major\":\"1\",\"minMinor\":0}", "{\"major\":1,\"minMinor\":0.5}",
                "{\"major\":0,\"minMinor\":0}", "{\"major\":1,\"minMinor\":-1}", "{\"major\":1,\"minMinor\":0,\"typo\":true}",
                "{\"major\":1,\"minMinor\":0,\"capabilities\":null}", "{\"major\":1,\"minMinor\":0,\"capabilities\":[1]}",
                "{\"major\":1,\"minMinor\":0,\"capabilities\":[\"editor\",\"editor\"]}", "{\"major\":1,\"minMinor\":0,\"capabilities\":[\"outline-items\"]}", "{\"major\":2147483648,\"minMinor\":0}"))
            assertEquals("INVALID_API_REQUIREMENT", assertThrows(ApiException.class, () -> ExtensionApi.requireManifest(requirement(invalid))).code, invalid);
        for (String future : List.of("{\"major\":2,\"minMinor\":0}", "{\"major\":1,\"minMinor\":3}"))
            assertEquals("UNSUPPORTED_EXTENSION_API", assertThrows(ApiException.class, () -> ExtensionApi.requireManifest(requirement(future))).code);
        assertEquals("UNSUPPORTED_API_CAPABILITY", assertThrows(ApiException.class,
                () -> ExtensionApi.requireManifest(requirement("{\"major\":1,\"minMinor\":0,\"capabilities\":[\"future-feature\"]}"))).code);
    }

    @Test void incompatibleExtensionIsRejectedBeforeAnyRulesExecuteAndFilesAreUntouched() throws Exception {
        prepare(); ObjectNode manifest = read("extensions/generic/manifest.json"); manifest.set("requiresApi", requirement("{\"major\":2,\"minMinor\":0}").path("requiresApi"));
        fixture.write("extensions/generic/manifest.json", manifest.toString());
        fixture.write("server/rules-runner.cjs", "require('node:fs').writeFileSync('rules-executed','yes'); process.stdout.write(JSON.stringify({ok:true,data:{valid:true}}));");
        byte[] packageBytes = Files.readAllBytes(root.resolve("extensions/generic/manifest.json")), bankBytes = Files.readAllBytes(root.resolve("question-banks/bank.json"));
        JsonNode catalog = library().catalog(); assertEquals("UNSUPPORTED_EXTENSION_API", catalog.at("/extensions/0/errorCode").asText());
        assertFalse(Files.exists(root.resolve("rules-executed"))); assertFalse(Files.exists(root.resolve(".state")));
        assertArrayEquals(packageBytes, Files.readAllBytes(root.resolve("extensions/generic/manifest.json")));
        assertArrayEquals(bankBytes, Files.readAllBytes(root.resolve("question-banks/bank.json")));
    }

    @Test void legacyAndDeclaredV1BanksLoadWithoutRewritingAndFutureFormatsAreIsolated() throws Exception {
        prepare(); Library library = library(); Library.Collection legacy = library.collection("bank", "bank");
        byte[] legacyBytes = Files.readAllBytes(root.resolve("question-banks/bank.json"));
        assertEquals(ExtensionApi.version(), library.page("generic", "1.0.0").path("apiVersion"));
        assertArrayEquals(legacyBytes, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        ObjectNode declared = read("question-banks/bank.json"); declared.put("formatVersion", 1); fixture.write("question-banks/bank.json", declared.toString());
        byte[] declaredBytes = Files.readAllBytes(root.resolve("question-banks/bank.json"));
        assertEquals(legacy, library.collection("bank", "bank")); assertArrayEquals(declaredBytes, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        declared.put("formatVersion", 1.0); fixture.write("question-banks/bank.json", declared.toString());
        assertEquals(legacy, library.collection("bank", "bank"));
        for (String invalid : List.of("null", "\"1\"", "1.5", "0", "-1", "2147483648", "2")) {
            declared.set("formatVersion", Json.MAPPER.readTree(invalid)); fixture.write("question-banks/bank.json", declared.toString());
            byte[] bytes = Files.readAllBytes(root.resolve("question-banks/bank.json")); JsonNode row = library.catalog().at("/banks/0");
            assertEquals(invalid.equals("2") ? "UNSUPPORTED_BANK_FORMAT" : "INVALID_BANK_FORMAT", row.path("errorCode").asText(), invalid);
            assertArrayEquals(bytes, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        }
        // Examples use the same collection format and must also reject before invoking rules.
        ObjectNode examples = read("extensions/generic/examples.json"); examples.put("formatVersion", 2); fixture.write("extensions/generic/examples.json", examples.toString());
        fixture.write("server/rules-runner.cjs", "process.stdout.write(JSON.stringify({ok:false}));");
        byte[] exampleBytes = Files.readAllBytes(root.resolve("extensions/generic/examples.json"));
        assertEquals("UNSUPPORTED_BANK_FORMAT", library.catalog().at("/extensions/0/errorCode").asText());
        assertArrayEquals(exampleBytes, Files.readAllBytes(root.resolve("extensions/generic/examples.json")));
    }

    @Test void multipleInstalledVersionsPreserveExactLegacyBindingAndFingerprint() throws Exception {
        prepare(); Library library = library(); Library.Collection original = library.collection("bank", "bank");
        byte[] bankBytes = Files.readAllBytes(root.resolve("question-banks/bank.json")), manifestBytes = Files.readAllBytes(root.resolve("extensions/generic/manifest.json"));
        try (var paths = Files.walk(root.resolve("extensions/generic"))) {
            for (Path source : paths.toList()) { Path target = root.resolve("extensions/generic-new").resolve(root.resolve("extensions/generic").relativize(source));
                if (Files.isDirectory(source)) Files.createDirectories(target); else Files.copy(source, target); }
        }
        ObjectNode next = read("extensions/generic-new/manifest.json"); next.put("version", "1.1.0");
        next.set("requiresApi", requirement("{\"major\":1,\"minMinor\":0,\"capabilities\":[\"practice\",\"score\"]}").path("requiresApi")); fixture.write("extensions/generic-new/manifest.json", next.toString());
        ObjectNode examples = read("extensions/generic-new/examples.json"); ((ObjectNode) examples.path("extension")).put("version", "1.1.0"); fixture.write("extensions/generic-new/examples.json", examples.toString());
        assertEquals(original, library.collection("bank", "bank")); assertEquals("1.1.0", library.collection("extension", "generic").extension().version());
        assertEquals(ExtensionApi.version(), library.page("generic", "1.0.0").path("apiVersion")); assertEquals(ExtensionApi.version(), library.page("generic", "1.1.0").path("apiVersion"));
        assertArrayEquals(bankBytes, Files.readAllBytes(root.resolve("question-banks/bank.json"))); assertArrayEquals(manifestBytes, Files.readAllBytes(root.resolve("extensions/generic/manifest.json")));
    }

    @Test void oldStateAndHistoryWithoutApiVersionRecoverAfterRestartWithoutRewriting() throws Exception {
        prepare(); fixture.start(null);
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("legacy-version-001", 0, "submit", fixture.answer("yes"))); assertEquals(200, submitted.status());
        fixture.finishCurrent("legacy-finish-001"); String id = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText();
        Path state = fixture.savedFile(); fixture.server.close(); fixture.server = null;
        ObjectNode saved = (ObjectNode) Json.read(state, 32 * 1024 * 1024); removeVersions(saved); Files.writeString(state, saved.toString());
        byte[] before = Files.readAllBytes(state), bank = Files.readAllBytes(root.resolve("question-banks/bank.json")); fixture.start(null);
        var restored = fixture.get(ServerTest.QUESTION); assertEquals(200, restored.status()); assertEquals(submitted.body().path("state"), restored.body().path("state"));
        var history = fixture.get("/api/collections/bank/bank/history/" + id); assertEquals(200, history.status()); assertEquals(Json.object().put("major", 1).put("minor", 0), history.body().path("apiVersion"));
        assertEquals(Json.object().put("major", 1).put("minor", 0), history.body().at("/page/apiVersion")); assertEquals("submitted", history.body().at("/questions/0/payload/state/status").asText());
        assertEquals("unanswered", history.body().at("/questions/1/payload/state/status").asText()); assertEquals(1, history.body().at("/questions/0/payload/state/result/score").asInt());
        assertArrayEquals(before, Files.readAllBytes(state)); assertArrayEquals(bank, Files.readAllBytes(root.resolve("question-banks/bank.json")));
    }

    @Test void futureHistoryPageIsRejectedDespiteSupportedRoundAndRemainsRecoverable() throws Exception {
        prepare(); fixture.start(null);
        assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("future-history-001", 0, "submit", fixture.answer("yes"))).status());
        fixture.finishCurrent("future-finish-001"); String id = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText();
        Path state = fixture.savedFile(); fixture.server.close(); fixture.server = null; ObjectNode saved = (ObjectNode) Json.read(state, 32 * 1024 * 1024);
        ObjectNode round = (ObjectNode) saved.path("historyRounds").get(0); assertEquals(ExtensionApi.version(), round.path("apiVersion"));
        ((ObjectNode) round.path("page")).set("apiVersion", Json.object().put("major", 2).put("minor", 0)); Files.writeString(state, saved.toString()); byte[] bytes = Files.readAllBytes(state);
        fixture.start(null); var rejected = fixture.get("/api/collections/bank/bank/history/" + id);
        assertEquals(409, rejected.status()); assertEquals("UNSUPPORTED_HISTORY_API", rejected.body().at("/error/code").asText());
        assertEquals("UNSUPPORTED_HISTORY_API", fixture.get(ServerTest.QUESTION).body().at("/error/code").asText()); assertArrayEquals(bytes, Files.readAllBytes(state));
    }

    @Test void editingPreservesUnknownBankAndQuestionMetadataAndExplicitFormatVersion() throws Exception {
        prepare(); ObjectNode bank = read("question-banks/bank.json"); bank.put("formatVersion", 1); bank.set("authorMetadata", Json.object().put("name", "Author"));
        ((ObjectNode) bank.path("questions").get(0)).put("customTag", "preserve-me"); fixture.write("question-banks/bank.json", bank.toString());
        Library library = library(); Library.Collection collection = library.collection("bank", "bank");
        Library.EditPlan plan = library.prepareEdit(collection, "q1", "New title", collection.question("q1").data()); JsonNode after = Json.MAPPER.readTree(plan.after());
        assertEquals(1, after.path("formatVersion").asInt()); assertEquals(bank.path("authorMetadata"), after.path("authorMetadata")); assertEquals("preserve-me", after.at("/questions/0/customTag").asText());
        assertEquals("1.0.0", after.at("/extension/version").asText()); assertArrayEquals(plan.before(), Files.readAllBytes(root.resolve("question-banks/bank.json")));
    }
}
