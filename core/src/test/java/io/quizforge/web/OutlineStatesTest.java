package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class OutlineStatesTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    static final String BASE = "/api/collections/bank/bank";
    static final String RULES = """
            QF.defineType({
              project(data,state){return {public:data.public,maxScore:1};},
              getScore(data,state){
                // Instrument cache reuse: a whiteboard-only revision must not re-enter scoring.
                if(state.revision===2 && !state.submitted) throw Error('unexpected whiteboard recompute');
                return {score:state.submitted?state.result.score:0,maxScore:1,
                  outlineStates:state.submitted?state.result.feedback.outlineStates:
                    [{id:'part-21',status:'unanswered'},{id:'part-22',status:'unanswered'},{id:'not-in-outline',status:'unanswered'}]};
              },
              grade(data,answer){const correct=answer.value===data.expected;
                return {gradingStatus:'graded',score:correct?1:0,maxScore:1,correct,
                  feedback:{outlineStates:[{id:'part-21',status:correct?'correct':'incorrect'},{id:'part-22',status:'incorrect'},{id:'not-in-outline',status:'correct'}]}};},
              review(data,answer,review){return {gradingStatus:'graded',score:review.score,maxScore:1,correct:review.score===1,
                feedback:{outlineStates:[{id:'part-21',status:'correct'},{id:'part-22',status:'incorrect'}]}};}
            });
            """;
    @BeforeEach void prepare() throws Exception {
        fixture.root = root; fixture.prepare();
        ObjectNode manifest = read("extensions/generic/manifest.json");
        manifest.putObject("requiresApi").put("major", 1).put("minMinor", 2).putArray("capabilities").add("practice").add("score").add("manual-review").add("outline-items");
        fixture.write("extensions/generic/manifest.json", manifest.toString()); fixture.write("extensions/generic/rules.js", RULES);
        ObjectNode bank = read("question-banks/bank.json");
        for (JsonNode question : bank.path("questions")) {
            var items = ((ObjectNode) question).putObject("outline").put("level", "parts").putArray("items");
            items.addObject().put("id", "part-21").put("label", "21"); items.addObject().put("id", "part-22").put("label", "22");
        }
        fixture.write("question-banks/bank.json", bank.toString());
        fixture.write("extensions/generic/examples.json", bank.deepCopy().put("id", "examples").toString());
    }
    @AfterEach void close() { fixture.close(); }
    ObjectNode read(String name) throws Exception { return (ObjectNode) Json.read(root.resolve(name), 32 * 1024 * 1024); }
    JsonNode details(JsonNode payload) { return payload.at("/state/outlineStates"); }

    @Test void answersRefreshStatesWhiteboardReusesCacheAndHistoryRetainsSnapshotAfterRetryAndRestart() throws Exception {
        fixture.start(null);
        assertEquals("unanswered", details(fixture.get(ServerTest.QUESTION).body()).get(0).path("status").asText());
        var draft = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-draft-001", 0, "draft", fixture.answer("yes")));
        assertEquals(200, draft.status(), draft.body().toString()); assertEquals("unanswered", details(draft.body()).get(0).path("status").asText());
        ObjectNode ink = Json.object(); ink.set("draft", Json.MAPPER.readTree("""
                {"schemaVersion":1,"viewport":{"x":0,"y":0,"zoom":1},"strokes":[],"paper":{"color":"#ffffff","pattern":"plain"}}
                """));
        var whiteboard = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-ink-001", 1, "whiteboard", ink));
        assertEquals(200, whiteboard.status(), whiteboard.body().toString()); assertEquals(details(draft.body()), details(whiteboard.body()));
        assertEquals("unanswered", fixture.get(BASE).body().at("/states/q1/outlineStates/0/status").asText());
        assertEquals("unanswered", fixture.get(BASE).body().at("/states/q2/outlineStates/0/status").asText());
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-submit-001", 2, "submit", fixture.answer("yes")));
        assertEquals(200, submitted.status(), submitted.body().toString()); assertEquals(2, details(submitted.body()).size());
        assertEquals("correct", details(submitted.body()).get(0).path("status").asText()); assertEquals("incorrect", details(submitted.body()).get(1).path("status").asText());
        JsonNode summary = fixture.get(BASE + "/summary").body(); assertEquals(1, summary.path("score").asInt()); assertEquals(2, summary.path("maxScore").asInt()); assertEquals(details(submitted.body()), summary.at("/questions/0/outlineStates"));
        fixture.finishCurrent("child-finish-001"); String historyId = fixture.get(BASE + "/history").body().at("/records/0/id").asText();
        JsonNode frozen = fixture.get(BASE + "/history/" + historyId).body(); assertEquals(details(submitted.body()), frozen.at("/questions/0/payload/state/outlineStates")); assertEquals(details(submitted.body()), frozen.at("/summary/questions/0/outlineStates"));
        var retry = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-retry-001", 3, "retry", Json.object()));
        assertEquals(200, retry.status()); assertEquals("unanswered", details(retry.body()).get(0).path("status").asText()); assertEquals(frozen, fixture.get(BASE + "/history/" + historyId).body());
        fixture.server.close(); fixture.server = null; fixture.start(null);
        assertEquals(details(retry.body()), details(fixture.get(ServerTest.QUESTION).body())); assertEquals(frozen, fixture.get(BASE + "/history/" + historyId).body());
    }

    @Test void pendingAndManualReviewUpdateChildStatesWithoutChangingParentSubmissionUnit() throws Exception {
        fixture.write("extensions/generic/rules.js", RULES.replace("if(state.revision===2 && !state.submitted)", "if(false)")
                .replace("gradingStatus:'graded',score:correct?1:0,maxScore:1,correct,", "gradingStatus:'pending',score:null,maxScore:1,correct:null,"));
        fixture.start(null); var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-pending-001", 0, "submit", fixture.answer("yes")));
        assertEquals(200, submitted.status(), submitted.body().toString()); assertTrue(submitted.body().at("/state/result/score").isNull()); assertEquals("incorrect", details(submitted.body()).get(1).path("status").asText());
        JsonNode summary = fixture.get(BASE + "/summary").body(); assertEquals(1, summary.path("pendingCount").asInt()); assertEquals(1, summary.path("submittedCount").asInt());
        ObjectNode review = Json.object(); review.putObject("review").put("score", .5);
        var confirmed = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-review-001", 1, "review", review));
        assertEquals(200, confirmed.status(), confirmed.body().toString()); assertEquals("incorrect", details(confirmed.body()).get(1).path("status").asText());
        JsonNode record = fixture.get(BASE + "/history").body().at("/records/0"); assertEquals(1, record.path("submittedCount").asInt());
        JsonNode history = fixture.get(BASE + "/history/" + record.path("id").asText()).body(); assertEquals(details(confirmed.body()), history.at("/questions/0/payload/state/outlineStates"));
    }

    @Test void invalidFrozenStatesAreRejectedAndAbsenceRemainsValid() throws Exception {
        fixture.start(null); assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("child-history-001", 0, "submit", fixture.answer("yes"))).status());
        ObjectNode saved = (ObjectNode) Json.read(fixture.savedFile(), 32 * 1024 * 1024).path("historyRounds").get(0); assertDoesNotThrow(() -> HistoryRounds.validate(saved));
        for (String value : List.of("null", "[]", "[{\"id\":\"part-21\",\"status\":\"wrong\"}]", "[{\"id\":\"part-21\",\"status\":\"correct\"},{\"id\":\"part-21\",\"status\":\"incorrect\"}]")) {
            ObjectNode bad = saved.deepCopy(); ((ObjectNode) bad.at("/questions/0/payload/state")).set("outlineStates", Json.MAPPER.readTree(value));
            ((ObjectNode) bad.at("/collection/states")).set("q1", bad.at("/questions/0/payload/state").deepCopy());
            if (value.equals("[]")) assertDoesNotThrow(() -> HistoryRounds.validate(bad)); else assertThrows(java.io.IOException.class, () -> HistoryRounds.validate(bad));
        }
        ObjectNode old = saved.deepCopy(); ((ObjectNode) old.at("/questions/0/payload/state")).remove("outlineStates"); ((ObjectNode) old.at("/collection/states/q1")).remove("outlineStates"); assertDoesNotThrow(() -> HistoryRounds.validate(old));
    }

    @Test void parentOnlyOutlineIgnoresChildDetailsAndInvalidLiveStatesRejectWithoutSaving() throws Exception {
        ObjectNode bank = read("question-banks/bank.json"); for (JsonNode question : bank.path("questions")) ((ObjectNode) question).set("outline", Json.object().put("level", "question").put("label", "一"));
        fixture.write("question-banks/bank.json", bank.toString()); fixture.start(null);
        assertFalse(fixture.get(ServerTest.QUESTION).body().path("state").has("outlineStates")); assertFalse(fixture.get(BASE + "/summary").body().path("questions").get(0).has("outlineStates"));
        fixture.server.close(); fixture.server = null; fixture.write("question-banks/bank.json", read("extensions/generic/examples.json").put("id", "bank").toString());
        fixture.write("extensions/generic/rules.js", RULES.replace("status:'unanswered'", "status:'correct'")); fixture.start(null);
        var response = fixture.get(ServerTest.QUESTION); assertEquals(422, response.status()); assertEquals("INVALID_OUTLINE_STATES", response.body().at("/error/code").asText());
        try (var paths = Files.list(root.resolve(".state"))) { assertFalse(paths.anyMatch(path -> path.getFileName().toString().matches("[a-f0-9]{64}\\.json"))); }
    }
}
