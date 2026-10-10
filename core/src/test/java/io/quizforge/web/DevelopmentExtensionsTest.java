package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class DevelopmentExtensionsTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    void start() throws Exception { fixture.start(null); }
    JsonNode put(String path, JsonNode value) throws Exception {
        var reply = fixture.call("PUT", path, value.toString(), null, "http://127.0.0.1:" + fixture.server.port());
        assertEquals(200, reply.status(), reply.body().toString()); return reply.body();
    }
    void enable() throws Exception { put("/api/settings/development", Json.object().put("enabled", true)); }
    void ui() throws Exception {
        Files.createDirectories(root.resolve("extensions/work-dev/assets"));
        fixture.write("extensions/work-dev/development.json", """
                {"mode":"ui","name":"Draft UI","entry":"page.html","style":"page.css","script":"page.js","editor":{"entry":"edit.html"},"assets":["assets/chart.svg"]}
                """);
        fixture.write("extensions/work-dev/page.html", "<article><img src='assets/chart.svg'><button>Submit</button></article>");
        fixture.write("extensions/work-dev/page.css", "article{width:100%}"); fixture.write("extensions/work-dev/page.js", "document.querySelector('button').onclick=()=>document.body.dataset.submitted='true'");
        fixture.write("extensions/work-dev/edit.html", "<textarea>UI editor</textarea>"); fixture.write("extensions/work-dev/assets/chart.svg", "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><path d='M0 0h40v20'/></svg>");
    }
    void runtime() throws Exception {
        Path source = root.resolve("extensions/generic"), target = root.resolve("extensions/work-dev");
        try (var paths = Files.walk(source)) { for (Path file : paths.toList()) { Path copy = target.resolve(source.relativize(file)); if (Files.isDirectory(file)) Files.createDirectories(copy); else Files.copy(file, copy); } }
        ObjectNode manifest = (ObjectNode) Json.read(target.resolve("manifest.json"), 256 * 1024); manifest.put("id", "draft-type"); fixture.write("extensions/work-dev/manifest.json", manifest.toString());
        ObjectNode examples = (ObjectNode) Json.read(target.resolve("examples.json"), 8 * 1024 * 1024); ((ObjectNode) examples.path("extension")).put("id", "draft-type"); fixture.write("extensions/work-dev/examples.json", examples.toString());
        fixture.write("extensions/work-dev/development.json", "{\"mode\":\"runtime\",\"name\":\"Runtime draft\"}");
        fixture.write("extensions/work-dev/editor.json", "{\"entry\":\"page.html\",\"script\":\"page.js\",\"style\":\"page.css\"}");
    }
    void bank() throws Exception {
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 8 * 1024 * 1024);
        bank.put("id", "draft-bank").put("title", "Draft bank").set("extension", Json.object().put("development", "work-dev")); fixture.write("question-banks/draft.json", bank.toString());
    }
    static JsonNode row(JsonNode rows, String id) { for (JsonNode row : rows) if (row.path("id").asText().equals(id)) return row; throw new AssertionError("Missing catalog row " + id); }
    Map<String, byte[]> productionStates() throws Exception {
        var result = new HashMap<String, byte[]>(); try (var files = Files.list(root.resolve(".state"))) {
            for (Path path : files.filter(path -> path.getFileName().toString().matches("[a-f0-9]{64}\\.json")).toList()) result.put(path.getFileName().toString(), Files.readAllBytes(path));
        } return result;
    }
    @Test void bareUiPagesNeedNoManifestRulesSchemaOrRegistrationAndRefreshOnSave() throws Exception {
        ui(); start(); assertFalse(fixture.get("/api/settings/development").body().path("enabled").asBoolean());
        assertEquals(1, fixture.get("/api/catalog").body().path("extensions").size()); assertEquals(404, fixture.get("/api/development/extensions/work-dev").status());
        enable(); JsonNode row = row(fixture.get("/api/catalog").body().path("extensions"), "work-dev"); assertEquals("development", row.path("kind").asText()); assertFalse(row.has("error"));
        JsonNode page = fixture.get("/api/development/extensions/work-dev").body(); assertFalse(page.has("mode")); assertTrue(page.path("canEdit").asBoolean()); assertEquals("development", page.at("/collection/kind").asText()); assertTrue(page.at("/page/legacyPage").asBoolean());
        assertEquals("assets/chart.svg", page.at("/page/assets/0/path").asText()); assertEquals("image/svg+xml", page.at("/page/assets/0/mime").asText()); assertEquals("page.html", page.at("/page/entryPath").asText());
        assertFalse(page.toString().contains("QF.page.register")); assertEquals(404, fixture.get("/extensions/work-dev/page.html").status());
        String question = "/api/collections/development/work-dev/questions/preview";
        assertEquals(200, fixture.get(question).status()); assertEquals(BankFeatures.DEFAULT.json(), fixture.get(question).body().path("features"));
        ObjectNode whiteboard = Json.object().set("draft", Json.MAPPER.readTree("{\"schemaVersion\":1,\"viewport\":{\"x\":0,\"y\":0,\"zoom\":1},\"strokes\":[],\"paper\":{\"color\":\"#ffffff\",\"pattern\":\"plain\"}}"));
        assertEquals(200, fixture.post(question + "/actions", fixture.action("legacy-ink-save", 0, "whiteboard", whiteboard)).status());
        assertEquals("DEVELOPMENT_NOT_IMPLEMENTED", fixture.post(question + "/actions", fixture.action("legacy-submit-fail", 1, "submit", fixture.answer("yes"))).body().at("/error/code").asText());
        assertEquals("DEVELOPMENT_NOT_IMPLEMENTED", fixture.get("/api/collections/development/work-dev/summary").body().at("/error/code").asText());
        assertEquals(1, fixture.get(question).body().at("/state/revision").asLong()); assertEquals(0, fixture.get("/api/collections/development/work-dev/history").body().path("records").size());
        String revision = page.path("revision").asText(); fixture.write("extensions/work-dev/page.html", "<article>Changed UI</article>");
        assertNotEquals(revision, fixture.get("/api/development/extensions/work-dev/revision").body().path("revision").asText());
        assertEquals("<article>Changed UI</article>", fixture.get("/api/development/extensions/work-dev").body().at("/page/html").asText());
        fixture.server.close(); fixture.server = null; start(); assertTrue(fixture.get("/api/settings/development").body().path("enabled").asBoolean());
    }
    @Test void incompletePagesStayAvailableWhenUnrelatedFormalRulesFail() throws Exception {
        ui(); bank(); start(); enable();
        fixture.get("/api/catalog");
        fixture.write("server/rules-runner.cjs", "const until=Date.now()+2000;while(Date.now()<until){};process.exit(99)");
        fixture.write("extensions/generic/page.css", "article{color:red}");
        fixture.write("extensions/work-dev/page.html", "<article>UI still available</article>");
        assertEquals("<article>UI still available</article>", fixture.get("/api/development/extensions/work-dev").body().at("/page/html").asText());
        JsonNode descriptor = fixture.get("/api/development/banks/draft-bank").body(); assertEquals("development-bank", descriptor.at("/collection/kind").asText());
        assertEquals(2, fixture.get("/api/collections/development-bank/draft-bank").body().path("questions").size());
        assertEquals(descriptor.path("revision"), fixture.get("/api/development/banks/draft-bank/revision").body().path("revision"));
        // Full runtime routes still perform validation rather than bypass the failing engine.
        assertTrue(fixture.get("/api/catalog").body().at("/extensions/0/error").isTextual());
    }
    @Test void legacyMarkerCannotSelectAnotherRuntimeAndErrorsNeverFallBackToFormal() throws Exception {
        runtime(); bank(); fixture.write("extensions/work-dev/development.json", "{\"mode\":\"ui\",\"entry\":\"page.html\"}"); start(); enable();
        JsonNode row = row(fixture.get("/api/catalog").body().path("banks"), "draft-bank"); assertEquals("development-bank", row.path("kind").asText()); assertFalse(row.has("mode"));
        JsonNode descriptor = fixture.get("/api/development/banks/draft-bank").body(); assertEquals("development-bank", descriptor.at("/collection/kind").asText());
        assertEquals(descriptor.path("revision"), fixture.get("/api/development/banks/draft-bank/revision").body().path("revision"));
        assertEquals(404, fixture.get("/api/collections/bank/draft-bank").status()); assertEquals(200, fixture.get("/api/collections/development-bank/draft-bank").status());
        fixture.write("extensions/work-dev/development.json", "{\"mode\":\"typo\"}");
        assertTrue(row(fixture.get("/api/catalog").body().path("extensions"), "work-dev").has("error")); assertEquals(404, fixture.get("/api/collections/extension/draft-type").status());
        assertEquals(404, fixture.get("/api/extensions/draft-type/1.0.0/page").status()); assertEquals(200, fixture.get("/api/extensions/generic/1.0.0/page").status());
        put("/api/settings/development", Json.object().put("enabled", false)); assertEquals(1, fixture.get("/api/catalog").body().path("banks").size());
    }
    @Test void runtimeTestsBanksHistoriesAndDraftsAreIsolatedAndLayoutEditsRetainDrafts() throws Exception {
        runtime(); bank(); byte[] formalBank = Files.readAllBytes(root.resolve("question-banks/bank.json")); start(); fixture.post(ServerTest.QUESTION + "/actions", fixture.action("production-save", 0, "submit", fixture.answer("yes")));
        Map<String, byte[]> before = productionStates(); enable();
        JsonNode descriptor = fixture.get("/api/development/extensions/work-dev").body(); assertEquals("development", descriptor.at("/collection/kind").asText());
        assertEquals("development-bank", fixture.get("/api/development/banks/draft-bank").body().at("/collection/kind").asText());
        String question = "/api/collections/development-bank/draft-bank/questions/q1";
        var saved = fixture.post(question + "/actions", fixture.action("dev-submit-001", 0, "submit", fixture.answer("yes"))); assertEquals(200, saved.status(), saved.body().toString());
        assertEquals(1, saved.body().at("/state/result/score").asInt()); assertEquals(1, fixture.get("/api/collections/development-bank/draft-bank/history").body().path("records").size());
        assertEquals(0, fixture.get("/api/collections/bank/draft-bank/history").body().path("records").size());
        assertEquals(200, fixture.get("/api/collections/development/work-dev/questions/q1/editor").status());
        assertTrue(put("/api/development/editor-drafts/draft-bank/q1", Json.object().put("contentVersion", saved.body().at("/stamp/contentVersion").asText()).put("changed", true).set("draft", Json.object().put("title", "draft"))).path("saved").asBoolean());
        assertEquals("draft", fixture.get("/api/development/editor-drafts/draft-bank/q1").body().at("/draft/title").asText());
        assertFalse(fixture.get("/api/editor-drafts/draft-bank/q1").body().path("draft").isObject());
        JsonNode editor = fixture.get(question + "/editor").body();
        ObjectNode changedData = (ObjectNode) editor.at("/question/data").deepCopy(); changedData.put("public", "edited development question");
        ObjectNode edit = Json.object().put("requestId", "dev-edit-0001").put("title", "Edited test question").put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()).set("data", changedData);
        var edited = fixture.post(question + "/edit", edit); assertEquals(200, edited.status(), edited.body().toString());
        assertEquals("unanswered", edited.body().at("/payload/state/status").asText()); assertEquals("edited development question", fixture.get(question).body().at("/question/data/public").asText());
        assertEquals(1, fixture.get("/api/collections/development-bank/draft-bank/history").body().path("records").size()); assertArrayEquals(formalBank, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        for (var entry : before.entrySet()) assertArrayEquals(entry.getValue(), productionStates().get(entry.getKey())); assertEquals(before.keySet(), productionStates().keySet());
        fixture.write("extensions/work-dev/page.css", "article{color:#456789}");
        assertEquals("unanswered", fixture.get(question).body().at("/state/status").asText()); assertEquals(1, fixture.get("/api/collections/development-bank/draft-bank/history").body().path("records").size());
        assertEquals("draft", fixture.get("/api/development/editor-drafts/draft-bank/q1").body().at("/draft/title").asText());
        put("/api/settings/development", Json.object().put("enabled", false)); assertEquals(404, fixture.get(question).status()); assertEquals(404, fixture.get("/api/collections/development-bank/draft-bank/history").status()); assertEquals(200, fixture.get(ServerTest.QUESTION).status());
    }
    @Test void publicationRequiresReviewedCurrentBytesAndKeepsSourceWithFrozenAssets() throws Exception {
        runtime(); Files.createDirectories(root.resolve("extensions/work-dev/assets")); fixture.write("extensions/work-dev/assets/chart.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
        fixture.write("extensions/work-dev/development.json", "{\"mode\":\"runtime\",\"assets\":[\"assets/chart.svg\"]}"); start(); enable();
        String endpoint = "/api/development/extensions/work-dev/publish"; var plan = fixture.get(endpoint); assertEquals(200, plan.status(), plan.body().toString());
        fixture.write("extensions/work-dev/page.css", "article{color:red}"); assertEquals(409, fixture.post(endpoint, Json.object().set("revision", plan.body().path("revision"))).status()); assertFalse(Files.exists(root.resolve("extensions/draft-type-1.0.0")));
        plan = fixture.get(endpoint); var published = fixture.post(endpoint, Json.object().set("revision", plan.body().path("revision"))); assertEquals(200, published.status(), published.body().toString()); assertTrue(published.body().path("published").asBoolean());
        Path release = root.resolve("extensions/draft-type-1.0.0"); assertTrue(Files.exists(root.resolve("extensions/work-dev/development.json"))); assertFalse(Files.exists(release.resolve("development.json")));
        assertEquals("assets/chart.svg", Json.read(release.resolve("manifest.json"), 256 * 1024).at("/assets/0").asText());
        assertEquals("image/svg+xml", fixture.get("/api/extensions/draft-type/1.0.0/page").body().at("/assets/0/mime").asText());
        byte[] css = Files.readAllBytes(release.resolve("page.css")); fixture.write("extensions/work-dev/page.css", "article{color:blue}"); assertArrayEquals(css, Files.readAllBytes(release.resolve("page.css")));
        assertEquals(409, fixture.get(endpoint).status());
    }
    @Test void runtimeStaticMediaAndPrototypeLeftoversDoNotContaminateBankImageResources() throws Exception {
        runtime(); bank(); Path directory = root.resolve("extensions/work-dev"); Files.createDirectories(directory.resolve("assets"));
        fixture.write("extensions/work-dev/assets/chart.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
        fixture.write("extensions/work-dev/assets/old-ui.svg", "<svg xmlns='http://www.w3.org/2000/svg'><text>Prototype only</text></svg>");
        Files.write(directory.resolve("assets/typeface.woff2"), "wOF2 test font fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Files.write(directory.resolve("assets/source.png"), ResourceSdkTest.PNG);
        ObjectNode manifest = (ObjectNode) Json.read(directory.resolve("manifest.json"), 256 * 1024); manifest.putArray("assets").add("assets/chart.svg").add("assets/typeface.woff2"); fixture.write("extensions/work-dev/manifest.json", manifest.toString());
        start(); enable(); JsonNode catalog = fixture.get("/api/catalog").body(); assertFalse(row(catalog.path("extensions"), "work-dev").has("error")); assertFalse(row(catalog.path("banks"), "draft-bank").has("error"));
        JsonNode descriptor = fixture.get("/api/development/extensions/work-dev").body(); assertEquals(2, descriptor.at("/page/assets").size()); assertEquals("font/woff2", descriptor.at("/page/assets/1/mime").asText()); assertFalse(descriptor.toString().contains("old-ui.svg"));
        String id = ResourceStore.hash(ResourceSdkTest.PNG), resource = "/api/development/resources/" + id;
        var image = fixture.client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:" + fixture.server.port() + resource)).GET().build(), java.net.http.HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, image.statusCode()); assertArrayEquals(ResourceSdkTest.PNG, image.body()); assertEquals(404, fixture.get("/api/resources/" + id).status());
        String question = "/api/collections/development-bank/draft-bank/questions/q1"; assertEquals(200, fixture.post(question + "/actions", fixture.action("static-submit-001", 0, "submit", fixture.answer("yes"))).status());
        String historyId = fixture.get("/api/collections/development-bank/draft-bank/history").body().at("/records/0/id").asText(); JsonNode history = fixture.get("/api/collections/development-bank/draft-bank/history/" + historyId).body(); assertEquals(2, history.at("/page/assets").size());
        String publish = "/api/development/extensions/work-dev/publish"; JsonNode plan = fixture.get(publish).body(); assertEquals(200, fixture.post(publish, Json.object().set("revision", plan.path("revision"))).status());
        assertEquals(2, fixture.get("/api/extensions/draft-type/1.0.0/page").body().path("assets").size()); assertFalse(row(fixture.get("/api/catalog").body().path("extensions"), "draft-type").has("error"));
        // Actual bank folders retain the strict resource-only contract.
        Path bankAssets = root.resolve("question-banks/image-bank/assets"); Files.createDirectories(bankAssets); Files.copy(directory.resolve("assets/chart.svg"), bankAssets.resolve("chart.svg"));
        assertThrows(java.io.IOException.class, () -> new ResourceStore(root).importAssets(bankAssets.getParent()));
    }
    @Test void malformedFormalIdentityAlsoPreventsDuplicatePublicationAndPathsAreBounded() throws Exception {
        runtime(); Files.createDirectories(root.resolve("extensions/broken")); fixture.write("extensions/broken/manifest.json", "{\"id\":\"draft-type\",\"version\":\"1.0.0\"}"); start(); enable();
        assertEquals("EXTENSION_VERSION_EXISTS", fixture.get("/api/development/extensions/work-dev/publish").body().at("/error/code").asText());
        ObjectNode manifest = (ObjectNode) Json.read(root.resolve("extensions/work-dev/manifest.json"), 256 * 1024); String entry = manifest.path("entry").asText();
        manifest.put("entry", "../../question-banks/bank.json"); fixture.write("extensions/work-dev/manifest.json", manifest.toString());
        assertTrue(row(fixture.get("/api/catalog").body().path("extensions"), "work-dev").has("error"));
        manifest.put("entry", entry); fixture.write("extensions/work-dev/manifest.json", manifest.toString());
        fixture.write("extensions/work-dev/development.json", "{\"mode\":\"ui\",\"entry\":\"page.html\",\"assets\":[\"rules.js\"]}"); assertTrue(row(fixture.get("/api/catalog").body().path("extensions"), "work-dev").has("error"));
        Files.write(root.resolve("extensions/work-dev/large.png"), new byte[1024 * 1024 + 1]); fixture.write("extensions/work-dev/development.json", "{\"mode\":\"ui\",\"entry\":\"page.html\",\"assets\":[\"large.png\"]}"); assertTrue(row(fixture.get("/api/catalog").body().path("extensions"), "work-dev").has("error"));
    }
    @Test void settingsAndPublicationRequireLocalServerEvenFromLoopbackOnWildcardBinding() throws Exception {
        runtime(); fixture.server = new QuizForgeServer(root, "0.0.0.0", 0, null, "node"); fixture.server.start();
        assertFalse(fixture.get("/api/settings/development").body().path("canManage").asBoolean());
        assertEquals(403, fixture.call("PUT", "/api/settings/development", "{\"enabled\":true}", null, null).status());
        fixture.server.close(); fixture.server = null; new DevelopmentSettings(root).update(Json.object().put("enabled", true));
        fixture.server = new QuizForgeServer(root, "0.0.0.0", 0, null, "node"); fixture.server.start();
        assertEquals(200, fixture.get("/api/development/extensions/work-dev").status()); assertFalse(fixture.get("/api/development/extensions/work-dev").body().path("canPublish").asBoolean());
        assertEquals(403, fixture.get("/api/development/extensions/work-dev/publish").status());
    }
}
