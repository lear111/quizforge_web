package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

/** Artificial manual-review type: all persistence stays inside a temporary library. */
class ManualReviewTest {
    @TempDir Path root;
    RuleEngine engine;
    Library library;
    Library.Collection bank;
    StateStore store;

    @BeforeEach void prepare() throws IOException {
        Files.createDirectories(root.resolve("server")); Files.copy(Path.of("server/rules-runner.cjs"), root.resolve("server/rules-runner.cjs"));
        // Only the runner's dependencies; editor packages are not needed by the Java fixture.
        for (String module : new String[]{"ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string"}) {
            Path source = Path.of("node_modules", module);
            try (var paths = Files.walk(source)) { for (Path path : paths.toList()) {
                Path target = root.resolve(path); if (Files.isDirectory(path)) Files.createDirectories(target); else Files.copy(path, target);
            } }
        }
        Files.createDirectories(root.resolve("extensions/manual")); Files.createDirectories(root.resolve("question-banks"));
        write("extensions/manual/manifest.json", """
                {"id":"manual","version":"1.0.0","name":"Manual review","entry":"page.html","script":"page.js","style":"page.css","rules":"rules.js","questionSchema":"question.json","answerSchema":"answer.json","examples":"examples.json"}
                """);
        write("extensions/manual/page.html", "<article>Frozen manual page</article>"); write("extensions/manual/page.js", "QF.page.register({onLoad(){}})"); write("extensions/manual/page.css", "article{color:#123}");
        write("extensions/manual/question.json", """
                {"type":"object","required":["stem","reference","maxScore"],"additionalProperties":false,"properties":{"stem":{"type":"string"},"reference":{"type":"string"},"maxScore":{"type":"number","minimum":0.5}}}
                """);
        write("extensions/manual/answer.json", """
                {"type":"object","required":["text"],"additionalProperties":false,"properties":{"text":{"type":"string","maxLength":100}}}
                """);
        write("extensions/manual/rules.js", """
                QF.defineType({
                  project(data,state){return {stem:data.stem,maxScore:data.maxScore,...(state.submitted?{reference:data.reference,graded:state.result.gradingStatus==='graded'}:{})};},
                  grade(data,answer){return {gradingStatus:'pending',score:null,maxScore:data.maxScore,correct:null,feedback:'等待评分'};},
                  review(data,answer,review){if(!Number.isInteger(review.score*2))throw Error('Half points required');return {gradingStatus:'graded',score:review.score,maxScore:data.maxScore,correct:review.score===data.maxScore,feedback:review.feedback||'人工评分'};},
                  getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:data.maxScore};}
                });
                """);
        String json = """
                {"id":"manual-bank","title":"Manual bank","extension":{"id":"manual","version":"1.0.0"},"questions":[{"id":"q1","title":"Question 1","data":{"stem":"First","reference":"Reference 1","maxScore":5}},{"id":"q2","title":"Question 2","data":{"stem":"Second","reference":"Reference 2","maxScore":3}}]}
                """;
        write("question-banks/manual.json", json); write("extensions/manual/examples.json", json.replace("manual-bank", "examples"));
        engine = new RuleEngine(root, "node", Duration.ofSeconds(4)); library = new Library(root, engine); bank = library.collection("bank", "manual-bank"); store = new StateStore(root, engine);
    }

    void write(String path, String text) throws IOException { Files.writeString(root.resolve(path), text); }
    ObjectNode act(String id, String question, long revision, String action, ObjectNode data) {
        ObjectNode request = Json.object().put("requestId", id).put("revision", revision).put("action", action);
        request.set("data", data); request.put("contentVersion", store.stamp(bank, bank.question(question)).path("contentVersion").asText()); return request;
    }
    ObjectNode answer(String text) { return Json.object().set("answer", Json.object().put("text", text)); }
    ObjectNode review(double score) { return Json.object().set("review", Json.object().put("score", score).put("feedback", "检查评分")); }
    ObjectNode finish(String id) { ObjectNode summary = store.summary(bank), request = Json.object().put("requestId", id).put("summaryVersion", summary.path("summaryVersion").asText()); request.set("roundId", summary.path("roundId")); return request; }
    ObjectNode question(String id) { return store.question(bank, bank.question(id)); }
    ObjectNode save(String id, JsonNode request) { return store.act(bank, bank.question(id), request); }
    void assertJsonEquals(JsonNode expected, JsonNode actual) throws IOException { assertEquals(Json.MAPPER.readTree(expected.toString()), Json.MAPPER.readTree(actual.toString())); }
    Path stateFile() throws IOException { try (var paths = Files.list(root.resolve(".state"))) { return paths.filter(p -> p.getFileName().toString().matches("[a-f0-9]{64}\\.json")).findFirst().orElseThrow(); } }

    @Test void pendingSubmissionReviewReplayRegradeAndCompletionRemainOneFrozenRound() throws Exception {
        ObjectNode pending = save("q1", act("submit-first", "q1", 0, "submit", answer("My answer")));
        assertEquals("pending", pending.at("/state/result/gradingStatus").asText()); assertTrue(pending.at("/state/result/score").isNull()); assertTrue(pending.at("/state/result/correct").isNull());
        assertTrue(pending.at("/capabilities/canReview").asBoolean());
        ObjectNode summary = store.summary(bank); String roundId = summary.path("roundId").asText();
        assertEquals(1, summary.path("submittedCount").asInt()); assertEquals(0, summary.path("gradedCount").asInt()); assertEquals(1, summary.path("pendingCount").asInt());
        assertEquals(0, summary.path("score").asInt()); assertEquals(8, summary.path("maxScore").asInt()); assertTrue(summary.at("/questions/0/score").isNull()); assertEquals("unsubmitted", summary.at("/questions/1/gradingStatus").asText());
        assertEquals("PENDING_REVIEW", assertThrows(ApiException.class, () -> store.finish(bank, finish("finish-pending"))).code);
        ObjectNode history = store.history("bank", bank.id(), roundId); JsonNode frozenPage = history.path("page");
        assertEquals(2, history.path("questions").size()); assertEquals(1, history.path("pendingCount").asInt()); assertTrue(history.at("/questions/0/payload/state/result/score").isNull());

        store = new StateStore(root, engine); assertEquals(1, store.summary(bank).path("pendingCount").asInt()); assertEquals(pending.path("state"), question("q1").path("state"));
        ObjectNode request = act("review-first", "q1", 1, "review", review(2.5)); ObjectNode reviewed = save("q1", request);
        assertEquals(2.5, reviewed.at("/state/result/score").asDouble()); assertEquals("graded", reviewed.at("/state/result/gradingStatus").asText()); assertTrue(reviewed.at("/question/data/graded").asBoolean());
        ObjectNode afterReview = store.history("bank", bank.id(), roundId); assertEquals(frozenPage, afterReview.path("page")); assertJsonEquals(reviewed, afterReview.at("/questions/0/payload"));
        assertEquals(1, afterReview.path("gradedCount").asInt()); assertEquals(0, afterReview.path("pendingCount").asInt());
        assertEquals(reviewed, save("q1", request)); assertEquals(afterReview, store.history("bank", bank.id(), roundId));
        byte[] beforeBadReview = Files.readAllBytes(stateFile());
        assertEquals("RULE_REJECTED", assertThrows(ApiException.class, () -> save("q1", act("quarter-bad", "q1", 2, "review", review(2.25)))).code);
        assertArrayEquals(beforeBadReview, Files.readAllBytes(stateFile())); assertEquals(reviewed, question("q1"));
        assertEquals("REVISION_CONFLICT", assertThrows(ApiException.class, () -> save("q1", act("stale-review", "q1", 1, "review", review(3)))).code);
        ObjectNode regraded = save("q1", act("review-second", "q1", 2, "review", review(3.5))); assertEquals(3.5, store.summary(bank).path("score").asDouble());
        assertEquals(roundId, store.summary(bank).path("roundId").asText()); assertEquals(1, store.history("bank", bank.id(), null).path("records").size());
        ObjectNode finishRequest = finish("finish-manual"), completed = store.finish(bank, finishRequest); assertEquals(3.5, completed.path("score").asDouble()); assertEquals(8, completed.path("maxScore").asInt());
        assertEquals(1, completed.path("gradedCount").asInt()); assertEquals(0, completed.path("pendingCount").asInt());
        ObjectNode frozen = store.history("bank", bank.id(), roundId); assertEquals("completed", frozen.path("status").asText()); assertJsonEquals(regraded, frozen.at("/questions/0/payload"));
        assertFalse(question("q1").at("/capabilities/canReview").asBoolean());
        assertEquals("REVIEW_UNAVAILABLE", assertThrows(ApiException.class, () -> save("q1", act("review-after", "q1", 3, "review", review(4)))).code);
        store = new StateStore(root, engine); assertEquals(frozen, store.history("bank", bank.id(), roundId)); assertJsonEquals(completed, store.finish(bank, finishRequest));
    }

    @Test void reviewRequiresSubmissionFromCurrentActiveRoundAndValidRange() throws Exception {
        assertEquals("REVIEW_UNAVAILABLE", assertThrows(ApiException.class, () -> save("q1", act("review-empty", "q1", 0, "review", review(1)))).code);
        save("q1", act("first-answer", "q1", 0, "submit", answer("First")));
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> save("q1", act("out-of-range", "q1", 1, "review", review(5.5)))).code);
        save("q1", act("first-review", "q1", 1, "review", review(5))); store.finish(bank, finish("first-finish"));
        save("q2", act("second-answer", "q2", 0, "submit", answer("Second")));
        assertEquals("REVIEW_UNAVAILABLE", assertThrows(ApiException.class, () -> save("q1", act("old-answer", "q1", 2, "review", review(4)))).code);
        String id = store.summary(bank).path("roundId").asText(); store.deleteHistory("bank", bank.id(), id);
        assertEquals("REVIEW_UNAVAILABLE", assertThrows(ApiException.class, () -> save("q2", act("deleted-round", "q2", 1, "review", review(2)))).code);
    }

    @Test void failedReviewWritePreservesCurrentAndFrozenAnswerTogether() throws Exception {
        ObjectNode pending = save("q1", act("atomic-answer", "q1", 0, "submit", answer("First")));
        String id = store.summary(bank).path("roundId").asText(); ObjectNode history = store.history("bank", bank.id(), id);
        Path state = stateFile(), backup = root.resolve(".state/atomic-backup.json"); byte[] original = Files.readAllBytes(state);
        Files.move(state, backup); Files.createDirectory(state); ObjectNode request = act("atomic-review", "q1", 1, "review", review(2.5));
        try { assertEquals("STATE_WRITE_FAILED", assertThrows(ApiException.class, () -> save("q1", request)).code); assertEquals(pending, question("q1")); assertArrayEquals(original, Files.readAllBytes(backup)); }
        finally { Files.delete(state); Files.move(backup, state); }
        assertEquals(history, store.history("bank", bank.id(), id)); save("q1", request); assertEquals(2.5, store.history("bank", bank.id(), id).path("score").asDouble());
    }

    @Test void editorDraftVersionSurvivesRestartAndChangesWithTitle() throws Exception {
        ObjectNode before = store.editor(library, bank, bank.question("q1")); assertTrue(before.path("draftVersion").asText().matches("[a-f0-9]{64}"));
        store = new StateStore(root, engine); ObjectNode after = store.editor(library, bank, bank.question("q1"));
        assertEquals(before.path("draftVersion"), after.path("draftVersion")); assertNotEquals(before.path("contentVersion"), after.path("contentVersion"));
        Library.Question current = bank.question("q1"), renamed = new Library.Question(current.id(), "Renamed", current.data(), current.fingerprint());
        assertNotEquals(after.path("draftVersion"), store.editor(library, bank, renamed).path("draftVersion"));
    }
}
