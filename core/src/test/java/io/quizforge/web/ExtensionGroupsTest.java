package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ExtensionGroupsTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    void write(String relative, String value) throws Exception { Files.createDirectories(root.resolve(relative).getParent()); fixture.write(relative, value); }
    void cloneGeneric(String relative, String id) throws Exception {
        Path source = root.resolve("extensions/generic"), target = root.resolve(relative);
        try (var files = Files.walk(source)) { for (Path file : files.toList()) { Path copy = target.resolve(source.relativize(file)); if (Files.isDirectory(file)) Files.createDirectories(copy); else Files.copy(file, copy); } }
        ObjectNode manifest = (ObjectNode) Json.read(target.resolve("manifest.json"), 256 * 1024); manifest.put("id", id); write(relative + "/manifest.json", manifest.toString());
        ObjectNode examples = (ObjectNode) Json.read(target.resolve("examples.json"), 8 * 1024 * 1024); ((ObjectNode) examples.path("extension")).put("id", id); write(relative + "/examples.json", examples.toString());
    }
    JsonNode get(String path) throws Exception { var reply = fixture.get(path); assertEquals(200, reply.status(), String.valueOf(reply.body())); return reply.body(); }
    void enable() throws Exception { var reply = fixture.call("PUT", "/api/settings/development", "{\"enabled\":true}", null, "http://127.0.0.1:" + fixture.server.port()); assertEquals(200, reply.status()); }
    @Test void movingFormalExtensionsIntoGroupsPreservesMixedPracticeEditingAndFrozenHistory() throws Exception {
        write("extensions/generic/editor.json", "{\"entry\":\"page.html\",\"script\":\"page.js\",\"style\":\"page.css\"}"); cloneGeneric("extensions/基础题型/beta", "beta");
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 8 * 1024 * 1024); bank.remove("extension");
        ((ObjectNode) bank.at("/questions/0")).set("extension", Json.object().put("id", "generic").put("version", "1.0.0")); ((ObjectNode) bank.at("/questions/1")).set("extension", Json.object().put("id", "beta").put("version", "1.0.0")); write("question-banks/bank.json", bank.toString());
        write("extensions/基础题型/README.md", "This group contains independent extensions."); write("extensions/desktop.ini", "[ViewState]");
        fixture.start(null); assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("group-first-submit", 0, "submit", fixture.answer("yes"))).status());
        Files.move(root.resolve("extensions/generic"), root.resolve("extensions/基础题型/generic"));
        JsonNode catalog = get("/api/catalog"); assertEquals(2, catalog.path("extensions").size()); for (JsonNode row : catalog.path("extensions")) { assertFalse(row.has("error"), row.toString()); assertEquals("基础题型", row.path("group").asText()); assertFalse(row.has("types")); }
        assertEquals("submitted", get(ServerTest.QUESTION).at("/state/status").asText()); assertEquals(1, get(ServerTest.QUESTION).at("/state/revision").asInt());
        assertEquals(200, fixture.get("/api/extensions/generic/1.0.0/page").status()); JsonNode overview = get("/api/collections/bank/bank"); assertEquals("beta", overview.at("/questions/1/type/id").asText()); assertFalse(overview.at("/questions/1/type").has("typeId"));
        String second = "/api/collections/bank/bank/questions/q2"; assertEquals(200, fixture.post(second + "/actions", fixture.action("group-second-submit", 0, "submit", fixture.answer("no"))).status());
        JsonNode editor = get(second + "/editor"); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "Edited after grouping"); ObjectNode request = Json.object().put("requestId", "group-edit-second").put("title", "Edited").put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()); request.set("data", data); assertEquals(200, fixture.post(second + "/edit", request).status());
        assertEquals("submitted", get(ServerTest.QUESTION).at("/state/status").asText()); assertEquals("unanswered", get(second).at("/state/status").asText());
        String id = get("/api/collections/bank/bank/history").at("/records/0/id").asText(); assertEquals(2, get("/api/collections/bank/bank/history/" + id).path("pages").size());
    }
    @Test void developmentLeafMovesKeepBindingsAndPublishIntoTheSameGroup() throws Exception {
        cloneGeneric("extensions/group-a/work-dev", "draft-type"); write("extensions/group-a/work-dev/development.json", "{\"mode\":\"runtime\",\"name\":\"Draft type\"}");
        ObjectNode examples = (ObjectNode) Json.read(root.resolve("extensions/group-a/work-dev/examples.json"), 8 * 1024 * 1024); examples.remove("extension"); for (JsonNode sample : examples.path("questions")) ((ObjectNode) sample).set("extension", Json.object().put("development", "work-dev")); write("extensions/group-a/work-dev/examples.json", examples.toString()); byte[] sourceExamples = Files.readAllBytes(root.resolve("extensions/group-a/work-dev/examples.json"));
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 8 * 1024 * 1024); bank.put("id", "draft-bank").set("extension", Json.object().put("development", "work-dev")); write("question-banks/draft.json", bank.toString()); byte[] before = Files.readAllBytes(root.resolve("question-banks/draft.json"));
        fixture.start(null); enable(); String question = "/api/collections/development-bank/draft-bank/questions/q1";
        assertEquals(200, fixture.post(question + "/actions", fixture.action("group-dev-submit", 0, "submit", fixture.answer("yes"))).status()); String revision = get("/api/development/extensions/work-dev/revision").path("revision").asText();
        Files.createDirectories(root.resolve("extensions/group-b")); Files.move(root.resolve("extensions/group-a/work-dev"), root.resolve("extensions/group-b/work-dev"));
        assertEquals(revision, get("/api/development/extensions/work-dev/revision").path("revision").asText()); assertEquals("submitted", get(question).at("/state/status").asText()); assertEquals(1, get("/api/collections/development-bank/draft-bank/history").path("records").size()); assertEquals("group-b", DevelopmentExtensionsTest.row(get("/api/catalog").path("extensions"), "work-dev").path("group").asText());
        JsonNode plan = get("/api/development/extensions/work-dev/publish"); assertEquals("group-b/draft-type-1.0.0", plan.path("targetFolder").asText()); var published = fixture.post("/api/development/extensions/work-dev/publish", Json.object().put("revision", plan.path("revision").asText())); assertEquals(200, published.status(), String.valueOf(published.body()));
        assertTrue(Files.exists(root.resolve("extensions/group-b/draft-type-1.0.0/manifest.json"))); assertTrue(Files.exists(root.resolve("extensions/group-b/work-dev/development.json"))); assertArrayEquals(sourceExamples, Files.readAllBytes(root.resolve("extensions/group-b/work-dev/examples.json"))); assertArrayEquals(before, Files.readAllBytes(root.resolve("question-banks/draft.json"))); assertEquals(200, fixture.get("/api/collections/extension/draft-type").status());
        JsonNode formalExamples = Json.read(root.resolve("extensions/group-b/draft-type-1.0.0/examples.json"), 8 * 1024 * 1024); assertEquals("draft-type", formalExamples.at("/questions/0/extension/id").asText()); assertFalse(formalExamples.at("/questions/0/extension").has("development"));
    }
    @Test void multiTypeManifestsReferencesAndRoutesAreRejectedAndDevelopmentNamesAreUnique() throws Exception {
        cloneGeneric("extensions/bad", "bad"); ObjectNode manifest = (ObjectNode) Json.read(root.resolve("extensions/bad/manifest.json"), 256 * 1024); manifest.putArray("types").addObject().put("id", "choice").put("path", "choice"); write("extensions/bad/manifest.json", manifest.toString());
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 8 * 1024 * 1024); bank.put("id", "bad-bank"); ((ObjectNode) bank.path("extension")).put("typeId", "choice"); write("question-banks/bad.json", bank.toString());
        for (String group : java.util.List.of("a", "b")) { write("extensions/" + group + "/duplicate-dev/development.json", "{\"mode\":\"ui\",\"entry\":\"page.html\"}"); write("extensions/" + group + "/duplicate-dev/page.html", "<article>UI</article>"); }
        fixture.start(null); enable(); JsonNode catalog = get("/api/catalog"); assertTrue(DevelopmentExtensionsTest.row(catalog.path("extensions"), "bad").has("error")); assertTrue(DevelopmentExtensionsTest.row(catalog.path("banks"), "bad-bank").has("error"));
        int duplicates = 0; for (JsonNode row : catalog.path("extensions")) if (row.path("id").asText().equals("duplicate-dev")) { duplicates++; assertTrue(row.has("error")); } assertEquals(2, duplicates);
        assertEquals(400, fixture.get("/api/development/extensions/duplicate-dev").status()); assertEquals(400, fixture.get("/api/extensions/generic/1.0.0/page?typeId=choice").status()); assertEquals(200, fixture.get(ServerTest.QUESTION).status());
    }
    @Test void directoryDepthAndLinksAreBoundedBeforeFollowingGroups() throws Exception {
        Path nested = root.resolve("deep-extensions/a/b/c/d/e"); Files.createDirectories(nested); assertThrows(ApiException.class, () -> ExtensionDirectories.scan(root.resolve("deep-extensions")));
        Path grouped = root.resolve("link-extensions"), outside = root.resolve("outside"); Files.createDirectories(grouped); Files.createDirectories(outside);
        try { Files.createSymbolicLink(grouped.resolve("redirect"), outside); }
        catch (java.io.IOException | UnsupportedOperationException unavailable) { return; }
        assertThrows(ApiException.class, () -> ExtensionDirectories.scan(grouped));
    }
    @Test void uiLeafUsesOneTypeBankForMultipleSamplesAndExplicitSelfBindings() throws Exception {
        write("extensions/group/ui-dev/development.json", "{\"mode\":\"ui\",\"name\":\"UI type\",\"entry\":\"page.html\",\"examples\":\"examples/bank.json\"}"); write("extensions/group/ui-dev/page.html", "<article>Single UI type</article>");
        ObjectNode samples = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 8 * 1024 * 1024); samples.put("id", "examples"); samples.remove("extension"); for (JsonNode question : samples.path("questions")) ((ObjectNode) question).set("extension", Json.object().put("development", "ui-dev")); write("extensions/group/ui-dev/examples/bank.json", samples.toString()); samples.put("id", "ui-bank"); write("question-banks/ui.json", samples.toString());
        fixture.start(null); enable(); JsonNode descriptor = get("/api/development/extensions/ui-dev"); assertEquals(2, descriptor.path("questions").size()); assertEquals("q1", descriptor.at("/question/id").asText()); assertEquals("UI type", descriptor.at("/extension/name").asText()); assertFalse(descriptor.path("extension").has("typeId")); assertEquals(2, DevelopmentExtensionsTest.row(get("/api/catalog").path("extensions"), "ui-dev").path("questionCount").asInt()); assertEquals(2, get("/api/development/banks/ui-bank").path("questions").size());
        ((ObjectNode) samples.at("/questions/1/extension")).put("typeId", "unsupported"); write("question-banks/ui.json", samples.toString()); assertEquals(400, fixture.get("/api/development/banks/ui-bank").status());
        ((ObjectNode) samples.at("/questions/1/extension")).remove("typeId"); ((ObjectNode) samples.at("/questions/1/extension")).put("development", "other-dev"); write("question-banks/ui.json", samples.toString()); assertEquals(400, fixture.get("/api/development/banks/ui-bank").status());
        samples.put("id", "examples"); write("extensions/group/ui-dev/examples/bank.json", samples.toString()); assertTrue(DevelopmentExtensionsTest.row(get("/api/catalog").path("extensions"), "ui-dev").has("error"));
    }
}
