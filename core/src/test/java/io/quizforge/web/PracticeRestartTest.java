package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class PracticeRestartTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    static final String BANK = "/api/collections/bank/bank", SESSION = "71d677b0-029f-465f-9688-b3fba68ab15c";
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    ServerTest.Reply call(String method, String path, JsonNode body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + fixture.server.port() + path))
                .header("Origin", "http://127.0.0.1:" + fixture.server.port()).header("X-QuizForge-Practice-Session", SESSION);
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString()));
        var response = fixture.client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        return new ServerTest.Reply(response.statusCode(), Json.MAPPER.readTree(response.body()), response);
    }
    JsonNode get(String path) throws Exception { var response = call("GET", path, null); assertEquals(200, response.status(), response.body().toString()); return response.body(); }
    JsonNode post(String path, JsonNode body) throws Exception { var response = call("POST", path, body); assertEquals(200, response.status(), response.body().toString()); return response.body(); }
    ObjectNode command(String id, JsonNode summary) { ObjectNode value = Json.object().put("requestId", id).put("summaryVersion", summary.path("summaryVersion").asText()); value.set("roundId", summary.path("roundId")); return value; }
    ObjectNode ink() throws Exception { return Json.object().set("draft", Json.MAPPER.readTree("""
            {"schemaVersion":1,"viewport":{"x":3,"y":4,"zoom":1.2},"strokes":[{"id":"stroke-one","color":"#123456","width":2,"points":[{"x":10,"y":20,"pressure":0.5}]}],"paper":{"color":"#ffffff","pattern":"grid"}}
            """)); }
    void assertFresh(String base, long firstRevision, long secondRevision) throws Exception {
        JsonNode collection = get(base);
        for (String id : java.util.List.of("q1", "q2")) {
            JsonNode payload = get(base + "/questions/" + id), state = payload.path("state");
            assertEquals("unanswered", state.path("status").asText()); assertTrue(state.path("answer").isNull()); assertTrue(state.path("result").isNull()); assertTrue(payload.path("draft").isNull());
            assertEquals(id.equals("q1") ? firstRevision : secondRevision, state.path("revision").asLong()); assertEquals(state, collection.path("states").path(id)); assertFalse(payload.path("question").path("data").has("reveal"));
        }
        JsonNode summary = get(base + "/summary"); assertFalse(summary.path("finished").asBoolean()); assertTrue(summary.path("roundId").isNull()); assertEquals(0, summary.path("submittedCount").asInt()); assertEquals(0, summary.path("score").asInt()); assertEquals(2, summary.path("maxScore").asInt());
    }
    @Test void restartClearsAllAnswersAndInkPreservesHistoryAndReplaysWithoutResettingNewWork() throws Exception {
        fixture.start(null); String q1 = BANK + "/questions/q1", q2 = BANK + "/questions/q2";
        ObjectNode submitted = fixture.action("restart-old-submit", 0, "submit", fixture.answer("yes")); post(q1 + "/actions", submitted);
        post(q1 + "/actions", fixture.action("restart-first-ink", 1, "whiteboard", ink()));
        post(q2 + "/actions", fixture.action("restart-old-choice", 0, "draft", fixture.answer("no")));
        post(q2 + "/actions", fixture.action("restart-second-ink", 1, "whiteboard", ink()));
        JsonNode finished = post(BANK + "/finish", command("restart-finish-one", get(BANK + "/summary")));
        String history = BANK + "/history/" + finished.path("historyId").asText(); JsonNode frozen = get(history);
        ObjectNode request = command("restart-round-one", finished); JsonNode receipt = post(BANK + "/restart", request); assertTrue(receipt.path("restarted").asBoolean());
        assertFresh(BANK, 3, 3); assertEquals(frozen, get(history)); assertEquals(1, get(BANK + "/history").path("records").size());
        assertEquals("REVISION_CONFLICT", call("POST", q1 + "/actions", submitted).body().at("/error/code").asText());
        JsonNode next = post(q1 + "/actions", fixture.action("restart-new-submit", 3, "submit", fixture.answer("no")));
        assertEquals(receipt, post(BANK + "/restart", request)); assertEquals(next, get(q1)); assertEquals(2, get(BANK + "/history").path("records").size()); assertEquals(frozen, get(history));
        ObjectNode reused = request.deepCopy().put("summaryVersion", "wrong"); assertEquals("REQUEST_ID_REUSED", call("POST", BANK + "/restart", reused).body().at("/error/code").asText());
        fixture.server.close(); fixture.server = null; fixture.start(null);
        assertEquals(receipt, post(BANK + "/restart", request)); assertEquals(4, get(q1).at("/state/revision").asLong()); assertEquals("submitted", get(q1).at("/state/status").asText()); assertEquals(frozen, get(history));
    }
    @Test void restartRequiresCompletionAndRejectsAnotherClientsStaleReset() throws Exception {
        fixture.start(null); JsonNode initial = get(BANK + "/summary");
        assertEquals("PRACTICE_NOT_FINISHED", call("POST", BANK + "/restart", command("restart-unfinished", initial)).body().at("/error/code").asText());
        JsonNode finished = post(BANK + "/finish", command("restart-finish-empty", initial));
        ObjectNode stale = command("restart-stale-client", finished); post(BANK + "/restart", command("restart-first-client", finished)); assertFresh(BANK, 1, 1);
        JsonNode draft = post(BANK + "/questions/q1/actions", fixture.action("restart-new-draft", 1, "draft", fixture.answer("yes")));
        assertEquals("SUMMARY_CONFLICT", call("POST", BANK + "/restart", stale).body().at("/error/code").asText()); assertEquals(draft, get(BANK + "/questions/q1"));
        assertEquals(403, fixture.call("POST", BANK + "/restart", stale.toString(), null, "http://untrusted.example").status());
    }
    @Test void restartWorksForTemporaryPracticeAndExtensionSamples() throws Exception {
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 1024 * 1024); bank.set("features", Json.object().put("history", false)); fixture.write("question-banks/bank.json", bank.toString());
        fixture.start(null);
        for (String base : java.util.List.of(BANK, "/api/collections/extension/generic")) {
            post(base + "/questions/q1/actions", fixture.action("restart-sample-submit", 0, "submit", fixture.answer("yes")));
            JsonNode finished = post(base + "/finish", command("restart-sample-finish", get(base + "/summary"))); ObjectNode request = command("restart-sample-round", finished);
            post(base + "/restart", request); assertFresh(base, 2, 1); post(base + "/restart", request); assertFresh(base, 2, 1);
            if (base.equals(BANK)) {
                assertTrue(finished.path("historyId").isNull()); assertEquals(403, call("GET", base + "/history", null).status());
                try (var files = Files.list(root.resolve(".state"))) { assertEquals(0, files.filter(path -> path.getFileName().toString().matches("[a-f0-9]{64}\\.json")).count()); }
            } else assertEquals(1, get(base + "/history").path("records").size());
        }
    }
}
