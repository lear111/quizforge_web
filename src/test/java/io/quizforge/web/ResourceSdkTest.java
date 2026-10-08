package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

class ResourceSdkTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    static final byte[] PNG = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=");
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    void write(String relative, String value) throws Exception { fixture.write(relative, value); }
    byte[] image(String id, String token) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + fixture.server.port() + "/api/resources/" + id));
        if (token != null) request.header("X-QuizForge-Token", token);
        var response = fixture.client.send(request.GET().build(), HttpResponse.BodyHandlers.ofByteArray()); assertEquals(200, response.statusCode()); assertEquals("image/png", response.headers().firstValue("Content-Type").orElse("")); return response.body();
    }
    @Test void uploadsAreContentAddressedBoundedAuthenticatedAndSurviveRestart() throws Exception {
        fixture.start(ServerTest.TOKEN);
        ObjectNode request = Json.object().put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(PNG));
        assertEquals(401, fixture.post("/api/resources", request).status());
        assertEquals(403, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, "https://other.example").status());
        JsonNode saved = fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).body(); String id = saved.path("id").asText();
        assertEquals(ResourceStore.hash(PNG), id); assertEquals(PNG.length, saved.path("size").asInt()); assertArrayEquals(PNG, image(id, ServerTest.TOKEN)); assertEquals(401, fixture.get("/api/resources/" + id).status());
        assertEquals(saved, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).body());
        request.put("mime", "image/svg+xml"); assertEquals(415, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).status());
        request.put("mime", "image/jpeg"); assertEquals(415, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).status());
        request.put("mime", "image/png").put("data", "!"); assertEquals(400, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).status());
        byte[] large = Arrays.copyOf(PNG, 2100000); request.put("data", Base64.getEncoder().encodeToString(large)); assertEquals(200, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).status());
        request.put("data", Base64.getEncoder().encodeToString(Arrays.copyOf(PNG, ResourceStore.MAX_BYTES + 1))); assertEquals(413, fixture.call("POST", "/api/resources", request.toString(), ServerTest.TOKEN, null).status());
        fixture.server.close(); fixture.server = null; fixture.start(ServerTest.TOKEN); assertArrayEquals(PNG, image(id, ServerTest.TOKEN));
    }
    @Test void directoryBanksImportResourcesAndEditThroughDurableTransaction() throws Exception {
        Path directory = root.resolve("question-banks/directory-bank"); Files.createDirectories(directory.resolve("assets"));
        Files.move(root.resolve("question-banks/bank.json"), directory.resolve("bank.json")); Files.write(directory.resolve("assets/source.png"), PNG);
        ObjectNode schema = (ObjectNode) Json.read(root.resolve("extensions/generic/question.json"), 1024 * 1024); ((ObjectNode) schema.path("properties")).set("document", Json.object().put("type", "object")); write("extensions/generic/question.json", schema.toString());
        fixture.start(null); JsonNode catalog = fixture.get("/api/catalog").body(); assertEquals(1, catalog.path("banks").size()); assertFalse(catalog.at("/banks/0").has("error")); assertArrayEquals(PNG, image(ResourceStore.hash(PNG), null));
        JsonNode editor = fixture.get(ServerTest.QUESTION + "/editor").body();
        ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); ObjectNode document = Json.object().put("type", "image"); document.set("attrs", Json.object().put("assetId", ResourceStore.hash(PNG))); data.set("document", document);
        var saved = fixture.post(ServerTest.QUESTION + "/edit", fixture.editRequest("directory-edit", editor, "Directory title", data)); assertEquals(200, saved.status(), saved.body().toString()); assertArrayEquals(PNG, Files.readAllBytes(directory.resolve("assets/" + ResourceStore.hash(PNG) + ".png")));
        assertEquals("Directory title", Json.read(directory.resolve("bank.json"), 8 * 1024 * 1024).at("/questions/0/title").asText()); assertFalse(Files.exists(root.resolve(".state/.edit-journal.json")));
        Files.delete(directory.resolve("assets/source.png")); Files.delete(directory.resolve("assets/" + ResourceStore.hash(PNG) + ".png")); Files.delete(directory.resolve("assets")); Files.delete(directory.resolve("bank.json")); Files.delete(directory);
        assertArrayEquals(PNG, image(ResourceStore.hash(PNG), null)); assertEquals(0, fixture.get("/api/catalog").body().path("banks").size());
    }
    @Test void publicSdkDependenciesAreReferencesAndPublishedVersionRemainsFrozen() throws Exception {
        Files.createDirectories(root.resolve("shared/richtext/1.0.0")); write("shared/richtext/1.0.0/richtext.js", "window.staticVersion = 1;"); write("shared/richtext/1.0.0/richtext-editor.js", "window.editorVersion = 1;"); write("shared/richtext/1.0.0/richtext.css", ".richtext{color:red}");
        ObjectNode manifest = (ObjectNode) Json.read(root.resolve("extensions/generic/manifest.json"), 1024 * 1024); manifest.putArray("dependencies").add(Json.object().put("id", "quizforge.richtext").put("version", "1.0.0")); write("extensions/generic/manifest.json", manifest.toString());
        fixture.start(null); JsonNode page = fixture.get("/api/extensions/generic/1.0.0/page").body(); assertEquals(2, page.at("/dependencies/0").size()); assertEquals("quizforge.richtext", page.at("/dependencies/0/id").asText());
        String endpoint = "/api/sdk/quizforge.richtext/1.0.0"; JsonNode sdk = fixture.get(endpoint).body(); assertEquals(2, sdk.size()); assertEquals("window.staticVersion = 1;", sdk.path("script").asText()); assertEquals("window.editorVersion = 1;", fixture.get(endpoint + "/editor").body().path("script").asText());
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("sdk-history", 0, "submit", fixture.answer("yes"))); assertEquals(200, submitted.status(), submitted.body().toString() + fixture.get("/api/catalog").body()); String historyId = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText(); JsonNode history = fixture.get("/api/collections/bank/bank/history/" + historyId).body(); assertEquals(page.path("dependencies"), history.at("/page/dependencies")); assertFalse(history.at("/page").toString().contains("staticVersion"));
        write("shared/richtext/1.0.0/richtext.js", "window.staticVersion = 2;"); assertTrue(fixture.get("/api/catalog").body().at("/extensions/0").has("error")); assertEquals(sdk, fixture.get(endpoint).body());
        Files.delete(root.resolve("shared/richtext/1.0.0/richtext.js")); Files.delete(root.resolve("shared/richtext/1.0.0/richtext-editor.js")); Files.delete(root.resolve("shared/richtext/1.0.0/richtext.css")); fixture.server.close(); fixture.server = null; fixture.start(null);
        assertEquals(sdk, fixture.get(endpoint).body()); assertEquals(history, fixture.get("/api/collections/bank/bank/history/" + historyId).body()); assertEquals(404, fixture.get("/api/sdk/other/1.0.0").status()); assertEquals(404, fixture.get("/api/sdk/quizforge.richtext/not-version").status());
    }
    @Test void incompleteEditorDraftPersistsWithoutChangingBankAndDeletesOnlyItsOwnEntry() throws Exception {
        fixture.start(null); String endpoint = "/api/editor-drafts/bank/q1"; assertTrue(fixture.get(endpoint).body().path("draft").isNull()); byte[] before = Files.readAllBytes(root.resolve("question-banks/bank.json"));
        ObjectNode request = Json.object().put("contentVersion", "a".repeat(64)).put("changed", true); request.set("draft", Json.object().put("title", "").put("emptyStem", ""));
        assertEquals(403, fixture.call("PUT", endpoint, request.toString(), null, "https://other.example").status()); assertEquals(200, fixture.call("PUT", endpoint, request.toString(), null, null).status()); assertEquals(request, fixture.get(endpoint).body());
        assertEquals(200, fixture.call("PUT", "/api/editor-drafts/bank/q2", request.toString(), null, null).status()); assertArrayEquals(before, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        ObjectNode large = request.deepCopy(); ((ObjectNode) large.path("draft")).put("text", "x".repeat(EditorDraftStore.MAX_BYTES)); assertEquals(413, fixture.call("PUT", endpoint, large.toString(), null, null).status()); assertEquals(request, fixture.get(endpoint).body());
        fixture.server.close(); fixture.server = null; fixture.start(null); assertEquals(request, fixture.get(endpoint).body()); assertTrue(fixture.delete(endpoint).body().path("deleted").asBoolean()); assertTrue(fixture.get(endpoint).body().path("draft").isNull()); assertEquals(request, fixture.get("/api/editor-drafts/bank/q2").body());
    }
}
