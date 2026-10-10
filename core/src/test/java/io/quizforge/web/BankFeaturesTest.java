package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class BankFeaturesTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    static final String SESSION = "0aaae116-209d-47e8-b0e8-19b0c6164e11", NEXT_PAGE = "cb589ef9-23bb-49d1-a3ce-7188e90c09b7";
    static final String SAMPLE = "/api/collections/extension/generic", BANK = "/api/collections/bank/bank";
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    void features(String relative, ObjectNode features) throws Exception { ObjectNode bank = (ObjectNode) Json.read(root.resolve(relative), 8 * 1024 * 1024); bank.set("features", features); fixture.write(relative, bank.toString()); }
    ServerTest.Reply call(String method, String path, JsonNode body, String session, boolean transientImage) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + fixture.server.port() + path));
        if (session != null) request.header("X-QuizForge-Practice-Session", session);
        if (transientImage) request.header("X-QuizForge-Transient-Resource", "true");
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString()));
        var response = fixture.client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode value = response.headers().firstValue("Content-Type").orElse("").startsWith("application/json") ? Json.MAPPER.readTree(response.body()) : null;
        return new ServerTest.Reply(response.statusCode(), value, response);
    }
    JsonNode get(String path, String session) throws Exception { var reply = call("GET", path, null, session, false); assertEquals(200, reply.status(), String.valueOf(reply.body())); return reply.body(); }
    JsonNode post(String path, JsonNode body, String session) throws Exception { var reply = call("POST", path, body, session, false); assertEquals(200, reply.status(), String.valueOf(reply.body())); return reply.body(); }
    ObjectNode ink() throws Exception { return Json.object().set("draft", Json.MAPPER.readTree("{\"schemaVersion\":1,\"viewport\":{\"x\":0,\"y\":0,\"zoom\":1},\"strokes\":[],\"paper\":{\"color\":\"#ffffff\",\"pattern\":\"plain\"}}")); }
    Map<String, String> stateFiles() throws Exception {
        var values = new LinkedHashMap<String, String>();
        for (String directory : java.util.List.of(".state", ".development/.state")) if (Files.exists(root.resolve(directory))) try (var files = Files.walk(root.resolve(directory))) { for (Path file : files.filter(Files::isRegularFile).toList()) values.put(root.relativize(file).toString(), ResourceStore.hash(Files.readAllBytes(file))); }
        return values;
    }
    @Test void rootsHaveStrictBooleanFeaturesAndLegacyDefaultsAcrossBanksAndSamples() throws Exception {
        assertEquals(BankFeatures.DEFAULT, BankFeatures.read(Json.object()));
        assertEquals(new BankFeatures(true, false, true), BankFeatures.read(Json.object().set("features", Json.object().put("whiteboard", false))));
        for (JsonNode invalid : java.util.List.of(Json.MAPPER.nullNode(), Json.MAPPER.createArrayNode(), Json.object().put("editing", "false"), Json.object().put("unknown", true))) assertThrows(ApiException.class, () -> BankFeatures.read(Json.object().set("features", invalid)));
        fixture.start(null); assertEquals(BankFeatures.DEFAULT.json(), get(BANK, null).path("features")); assertEquals(BankFeatures.DEFAULT.json(), get(SAMPLE, null).path("features"));
        ObjectNode raw = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 1024 * 1024); ((ObjectNode) raw.at("/questions/0")).set("features", Json.object().put("history", false)); fixture.write("question-banks/bank.json", raw.toString());
        assertEquals(404, fixture.get(BANK).status()); assertTrue(fixture.get("/api/catalog").body().at("/banks/0").has("error"));
        features("extensions/generic/examples.json", Json.object().put("editing", 1)); assertTrue(fixture.get("/api/catalog").body().at("/extensions/0").has("error"));
    }
    @Test void disabledToolsAreEnforcedAndHistoryOffDoesNotDeleteOldRecords() throws Exception {
        fixture.start(null); fixture.post(ServerTest.QUESTION + "/actions", fixture.action("original-submission", 0, "submit", fixture.answer("yes")));
        String oldId = get(BANK + "/history", null).at("/records/0/id").asText(); var disk = stateFiles();
        features("question-banks/bank.json", Json.object().put("editing", false).put("whiteboard", false).put("history", false));
        assertEquals(409, fixture.get(ServerTest.QUESTION).status()); assertEquals(403, call("GET", ServerTest.QUESTION + "/editor", null, SESSION, false).status());
        assertEquals(403, call("POST", ServerTest.QUESTION + "/actions", fixture.action("disabled-whiteboard", 0, "whiteboard", ink()), SESSION, false).status());
        assertEquals(403, fixture.get(BANK + "/history").status()); assertEquals(403, fixture.delete(BANK + "/history/" + oldId).status()); assertEquals(403, fixture.get("/api/editor-drafts/bank/q1").status());
        assertEquals(disk, stateFiles()); features("question-banks/bank.json", Json.object()); assertEquals("submitted", get(ServerTest.QUESTION, null).at("/state/status").asText()); assertEquals(oldId, get(BANK + "/history", null).at("/records/0/id").asText());
    }
    @Test void transientPracticeSupportsAutosaveSubmissionCompletionAndFreshPageWithoutDiskWrites() throws Exception {
        features("question-banks/bank.json", Json.object().put("history", false)); fixture.start(null); get("/api/catalog", null); var disk = stateFiles();
        assertEquals("unanswered", get(ServerTest.QUESTION, SESSION).at("/state/status").asText());
        post(ServerTest.QUESTION + "/actions", fixture.action("page-answer-draft", 0, "draft", fixture.answer("yes")), SESSION);
        ObjectNode draft = ink();
        post(ServerTest.QUESTION + "/actions", fixture.action("page-ink-draft", 1, "whiteboard", draft), SESSION);
        JsonNode submitted = post(ServerTest.QUESTION + "/actions", fixture.action("page-answer-submit", 2, "submit", fixture.answer("yes")), SESSION); assertEquals(1, submitted.at("/state/result/score").asInt());
        assertEquals("submitted", get(ServerTest.QUESTION, SESSION).at("/state/status").asText()); assertEquals("unanswered", get(ServerTest.QUESTION, NEXT_PAGE).at("/state/status").asText());
        JsonNode summary = get(BANK + "/summary", SESSION); assertEquals(1, summary.path("score").asInt()); assertEquals(2, summary.path("maxScore").asInt()); ObjectNode finish = Json.object().put("requestId", "page-finish-request").put("summaryVersion", summary.path("summaryVersion").asText()); finish.set("roundId", summary.path("roundId"));
        JsonNode finished = post(BANK + "/finish", finish, SESSION); assertTrue(finished.path("finished").asBoolean()); assertTrue(finished.path("historyId").isNull()); assertTrue(get(BANK + "/summary", SESSION).path("finished").asBoolean());
        assertEquals(finished, post(BANK + "/finish", finish, SESSION)); assertEquals(disk, stateFiles());
        ObjectNode image = Json.object().put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(ResourceSdkTest.PNG)); var uploaded = call("POST", "/api/resources", image, SESSION, true); assertEquals(200, uploaded.status());
        String resource = "/api/resources/" + uploaded.body().path("id").asText(); assertEquals(200, call("GET", resource, null, SESSION, false).status()); assertEquals(404, call("GET", resource, null, NEXT_PAGE, false).status()); assertEquals(disk, stateFiles());
    }
    @Test void realSampleEditingExportsImagesPreservesBankCodeIdentityAndFreezesOldHistory() throws Exception {
        ObjectNode schema = (ObjectNode) Json.read(root.resolve("extensions/generic/question.json"), 1024 * 1024); ((ObjectNode) schema.path("properties")).set("document", Json.object().put("type", "object")); fixture.write("extensions/generic/question.json", schema.toString());
        fixture.start(null); post(ServerTest.QUESTION + "/actions", fixture.action("bank-before-sample-edit", 0, "submit", fixture.answer("yes")), null);
        String sampleQuestion = SAMPLE + "/questions/q1"; post(sampleQuestion + "/actions", fixture.action("sample-first-submit", 0, "submit", fixture.answer("yes")), null);
        String historyId = get(SAMPLE + "/history", null).at("/records/0/id").asText(); JsonNode frozen = get(SAMPLE + "/history/" + historyId, null), bankBefore = get(ServerTest.QUESTION, null);
        String imageId = post("/api/resources", Json.object().put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(ResourceSdkTest.PNG)), null).path("id").asText();
        JsonNode editor = get(sampleQuestion + "/editor", null); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "Updated sample"); data.set("document", Json.object().put("type", "image").set("attrs", Json.object().put("assetId", imageId)));
        post(sampleQuestion + "/edit", fixture.editRequest("sample-image-edit", editor, "Updated sample title", data), null);
        assertEquals("Updated sample", Json.read(root.resolve("extensions/generic/examples.json"), 1024 * 1024).at("/questions/0/data/public").asText()); assertArrayEquals(ResourceSdkTest.PNG, Files.readAllBytes(root.resolve("extensions/generic/assets/" + imageId + ".png")));
        assertEquals("unanswered", get(sampleQuestion, null).at("/state/status").asText()); assertEquals(bankBefore.path("state"), get(ServerTest.QUESTION, null).path("state")); assertEquals(frozen.path("questions"), get(SAMPLE + "/history/" + historyId, null).path("questions")); assertFalse(get("/api/catalog", null).at("/extensions/0").has("error"));
        ObjectNode draft = Json.object().put("contentVersion", "a".repeat(64)).put("changed", true).set("draft", Json.object().put("title", "Sample draft"));
        assertEquals(200, call("PUT", "/api/editor-drafts/generic/q1?kind=extension", draft, null, false).status()); assertEquals(draft, get("/api/editor-drafts/generic/q1?kind=extension", null)); assertTrue(get("/api/editor-drafts/generic/q1", null).path("draft").isNull());
    }
    @Test void transientSampleEditingWritesOnlySourceAndNotTemporaryAnswersOrDrafts() throws Exception {
        features("extensions/generic/examples.json", Json.object().put("history", false)); fixture.start(null); get("/api/catalog", null); var disk = stateFiles(); String question = SAMPLE + "/questions/q1";
        post(question + "/actions", fixture.action("sample-temp-submit", 0, "submit", fixture.answer("yes")), SESSION);
        JsonNode editor = get(question + "/editor", SESSION); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "Persisted editable sample"); post(question + "/edit", fixture.editRequest("sample-temp-edit", editor, "Saved title", data), SESSION);
        assertEquals("Persisted editable sample", Json.read(root.resolve("extensions/generic/examples.json"), 1024 * 1024).at("/questions/0/data/public").asText()); assertEquals(disk, stateFiles()); assertFalse(Files.exists(root.resolve(".state/.edit-journal.json"))); assertEquals(403, fixture.get("/api/editor-drafts/generic/q1?kind=extension").status()); assertEquals("unanswered", get(question, NEXT_PAGE).at("/state/status").asText());
    }
    @Test void runtimeAndLegacySamplesShareCollectionFeatures() throws Exception {
        fixture.write("extensions/generic/development.json", "{\"mode\":\"runtime\"}");
        features("extensions/generic/examples.json", Json.object().put("whiteboard", false));
        Files.createDirectories(root.resolve("extensions/ui-dev")); Files.writeString(root.resolve("extensions/ui-dev/development.json"), "{\"mode\":\"ui\",\"entry\":\"page.html\",\"examples\":\"examples.json\"}"); Files.writeString(root.resolve("extensions/ui-dev/page.html"), "<p>Prototype</p>");
        ObjectNode ui = (ObjectNode) Json.read(root.resolve("extensions/generic/examples.json"), 1024 * 1024); ui.set("extension", Json.object().put("development", "ui-dev")); ui.set("features", Json.object().put("editing", false).put("history", false)); Files.writeString(root.resolve("extensions/ui-dev/examples.json"), ui.toString());
        fixture.start(null); call("PUT", "/api/settings/development", Json.object().put("enabled", true), null, false);
        String question = "/api/collections/development/generic/questions/q1"; JsonNode editor = get(question + "/editor", null); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "Runtime sample update"); post(question + "/edit", fixture.editRequest("runtime-sample-edit", editor, "Updated runtime", data), null);
        assertEquals("Runtime sample update", Json.read(root.resolve("extensions/generic/examples.json"), 1024 * 1024).at("/questions/0/data/public").asText()); assertFalse(get("/api/development/extensions/generic", null).at("/features/whiteboard").asBoolean());
        JsonNode descriptor = get("/api/development/extensions/ui-dev", null); assertFalse(descriptor.at("/features/editing").asBoolean()); assertFalse(descriptor.at("/features/history").asBoolean()); assertEquals(200, call("GET", "/api/collections/development/ui-dev", null, SESSION, false).status());
    }
}
