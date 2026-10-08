package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Interleaved incompatible types exercise routing; all state stays in a temporary library. */
class MixedStateStoreTest {
    @TempDir Path root;
    RuleEngine engine;
    Library library;
    Library.Collection bank;
    StateStore store;

    @BeforeEach void prepare() throws Exception {
        ManualReviewTest fixture = new ManualReviewTest(); fixture.root = root; fixture.prepare(); engine = fixture.engine;
        Path manualRules = root.resolve("extensions/manual/rules.js");
        Files.writeString(manualRules, Files.readString(manualRules).replace("project(data,state)", """
                prepareAiGrading(data,answer){return {protocolVersion:1,question:[{type:'text',text:data.stem}],answer:[{type:'text',text:answer.text}],referenceAnswer:[{type:'text',text:data.reference}],rubric:[{type:'text',text:'Review'}],maxScore:data.maxScore,scoreStep:0.5};},
                project(data,state)
                """));
        write("extensions/manual/editor.json", "{\"entry\":\"editor.html\",\"script\":\"editor.js\",\"style\":\"editor.css\"}");
        write("extensions/manual/editor.html", "<article>Manual editor</article>"); write("extensions/manual/editor.js", "QF.editor.register({})"); write("extensions/manual/editor.css", "article{color:#456}");
        Files.createDirectories(root.resolve("extensions/automatic"));
        write("extensions/automatic/manifest.json", """
                {"id":"automatic","version":"2.0.0","name":"Automatic","entry":"page.html","script":"page.js","style":"page.css","rules":"rules.js","questionSchema":"question.json","answerSchema":"answer.json","examples":"examples.json"}
                """);
        write("extensions/automatic/page.html", "<article>Automatic frozen page</article>"); write("extensions/automatic/page.js", "QF.page.register({onLoad(){}})"); write("extensions/automatic/page.css", "article{color:#789}");
        write("extensions/automatic/question.json", """
                {"type":"object","required":["public","secret","expected"],"additionalProperties":false,"properties":{"public":{"type":"string"},"secret":{"type":"string"},"expected":{"type":"string"}}}
                """);
        write("extensions/automatic/answer.json", """
                {"type":"object","required":["value"],"additionalProperties":false,"properties":{"value":{"type":"string","maxLength":50}}}
                """);
        write("extensions/automatic/rules.js", """
                QF.defineType({
                  project(data,state){return state.submitted?{public:data.public,reveal:data.secret}:{public:data.public};},
                  grade(data,answer){const correct=answer.value===data.expected;return {score:correct?1:0,maxScore:1,correct,feedback:'automatic'};},
                  getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:1};}
                });
                """);
        write("extensions/automatic/examples.json", """
                {"id":"auto-examples","title":"Auto examples","extension":{"id":"automatic","version":"2.0.0"},"questions":[{"id":"a1","title":"Automatic","data":{"public":"Auto question","secret":"Auto secret","expected":"yes"}}]}
                """);
        write("question-banks/mixed.json", """
                {"id":"mixed-bank","title":"Mixed bank","questions":[
                  {"id":"m1","title":"Manual first","extension":{"id":"manual","version":"1.0.0"},"data":{"stem":"Manual first stem","reference":"First reference","maxScore":5}},
                  {"id":"a1","title":"Automatic middle","extension":{"id":"automatic","version":"2.0.0"},"data":{"public":"Auto question","secret":"Auto secret","expected":"yes"}},
                  {"id":"m2","title":"Manual last","extension":{"id":"manual","version":"1.0.0"},"data":{"stem":"Manual last stem","reference":"Last reference","maxScore":3}}
                ]}
                """);
        library = new Library(root, engine); bank = library.collection("bank", "mixed-bank"); store = new StateStore(root, engine);
    }

    void write(String relative, String text) throws IOException { Files.writeString(root.resolve(relative), text); }
    ObjectNode act(String questionId, String action, ObjectNode data) {
        Library.Question question = bank.question(questionId); ObjectNode stamp = store.stamp(bank, question);
        ObjectNode request = Json.object().put("requestId", java.util.UUID.randomUUID().toString()).put("revision", stamp.path("revision").asLong()).put("contentVersion", stamp.path("contentVersion").asText()).put("action", action);
        request.set("data", data); return store.act(bank, question, request);
    }
    ObjectNode manualAnswer(String text) { return Json.object().set("answer", Json.object().put("text", text)); }
    ObjectNode autoAnswer(String value) { return Json.object().set("answer", Json.object().put("value", value)); }
    ObjectNode review(double score) { return Json.object().set("review", Json.object().put("score", score)); }
    ObjectNode finish() {
        ObjectNode summary = store.summary(bank), request = Json.object().put("requestId", java.util.UUID.randomUUID().toString()).put("summaryVersion", summary.path("summaryVersion").asText());
        request.set("roundId", summary.path("roundId")); return store.finish(bank, request);
    }
    Path stateFile(Library.Collection collection) { return root.resolve(".state").resolve(ResourceStore.hash(collection.stateKey().getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".json"); }
    ObjectNode savedRound() throws IOException { return (ObjectNode) Json.read(stateFile(bank), 32 * 1024 * 1024).path("historyRounds").get(0); }

    @Test void incompatibleTypesKeepTheirProjectionScoresPagesAndStateAfterRestart() throws Exception {
        assertNull(bank.extension()); assertEquals("bank:mixed-bank:mixed", bank.stateKey());
        ObjectNode overview = store.overview(bank); assertTrue(overview.path("extension").isNull()); assertEquals(2, overview.path("extensions").size());
        assertEquals("manual", overview.at("/questions/0/type/id").asText()); assertEquals("automatic", overview.at("/questions/1/type/id").asText());
        assertEquals("Manual first stem", store.question(bank, bank.question("m1")).at("/question/data/stem").asText());
        assertFalse(store.question(bank, bank.question("a1")).at("/question/data").has("reveal"));
        assertEquals(store.stamp(bank, bank.question("m1")).path("packageVersion"), store.stamp(bank, bank.question("m2")).path("packageVersion"));
        assertNotEquals(store.stamp(bank, bank.question("m1")).path("packageVersion"), store.stamp(bank, bank.question("a1")).path("packageVersion"));
        assertTrue(store.editor(library, bank, bank.question("m1")).path("editor").isObject()); assertTrue(store.editor(library, bank, bank.question("a1")).path("editor").isNull());
        ObjectNode automatic = act("a1", "submit", autoAnswer("yes")); assertEquals("automatic", automatic.at("/extension/id").asText()); assertFalse(automatic.at("/capabilities/canAiGrade").asBoolean());
        act("m1", "submit", manualAnswer("First response"));
        ObjectNode pending = store.summary(bank); assertEquals(1, pending.path("score").asInt()); assertEquals(9, pending.path("maxScore").asInt()); assertEquals(1, pending.path("pendingCount").asInt());
        assertEquals("m1", pending.at("/questions/0/id").asText()); assertEquals("a1", pending.at("/questions/1/id").asText()); assertEquals("m2", pending.at("/questions/2/id").asText());
        ObjectNode manual = act("m1", "review", review(2.5)); assertEquals(3.5, store.summary(bank).path("score").asDouble());
        String roundId = store.summary(bank).path("roundId").asText(); ObjectNode history = store.history("bank", bank.id(), roundId);
        assertTrue(history.path("extension").isNull()); assertFalse(history.has("page")); assertEquals(2, history.path("pages").size());
        assertEquals(history.at("/questions/0/pageKey"), history.at("/questions/2/pageKey")); assertNotEquals(history.at("/questions/0/pageKey"), history.at("/questions/1/pageKey"));
        for (JsonNode entry : history.path("questions")) { assertFalse(entry.has("page")); assertTrue(history.path("pages").path(entry.path("pageKey").asText()).isObject()); }
        assertEquals("Manual last stem", history.at("/questions/2/payload/question/data/stem").asText()); assertEquals("Auto secret", history.at("/questions/1/payload/question/data/reveal").asText());
        assertFalse(store.history("bank", bank.id(), null).at("/records/0").has("pages"));
        HistoryRounds.validate(savedRound());
        store = new StateStore(root, engine); assertEquals(manual.path("state"), store.question(bank, bank.question("m1")).path("state")); assertEquals(history, store.history("bank", bank.id(), roundId));
        ObjectNode completed = finish(); assertEquals(3.5, completed.path("score").asDouble()); assertEquals(9, completed.path("maxScore").asInt());
        ObjectNode frozen = store.history("bank", bank.id(), roundId); assertEquals(history.path("pages"), frozen.path("pages")); HistoryRounds.validate(savedRound());
        write("extensions/automatic/page.html", "<article>Changed source page</article>"); store = new StateStore(root, engine);
        assertEquals(frozen, store.history("bank", bank.id(), roundId));
    }

    @Test void aiSnapshotTracksTheQuestionExtensionAndOtherTypesDoNotExpireIt() throws Exception {
        ObjectNode submitted = act("m1", "submit", manualAnswer("First response")); assertTrue(submitted.at("/capabilities/canAiGrade").asBoolean());
        Library.Question question = bank.question("m1"); StateStore.AiSnapshot snapshot = store.prepareAiGrading(bank, question, Json.object());
        assertEquals(bank.extensionFor(question).fingerprint(), snapshot.extensionFingerprint()); assertNotEquals(bank.extensionFingerprint(), snapshot.extensionFingerprint());
        assertEquals("Manual first stem", snapshot.gradingInput().at("/question/0/text").asText());
        String taskId = "a".repeat(64); store.bindAiTask(bank, question, snapshot, taskId); assertTrue(store.aiCurrent(bank, question, snapshot, taskId));
        act("a1", "submit", autoAnswer("yes")); assertTrue(store.aiCurrent(bank, question, snapshot, taskId));
        assertEquals("AI_GRADING_UNAVAILABLE", assertThrows(ApiException.class, () -> store.prepareAiGrading(bank, bank.question("a1"), Json.object())).code);
        store = new StateStore(root, engine); assertTrue(store.aiCurrent(bank, question, snapshot, taskId));
        act("m1", "review", review(3)); assertFalse(store.aiCurrent(bank, question, snapshot, taskId));
    }

    @Test void historyRejectsMissingPageWrongIdentityAndPerQuestionPageCopies() throws Exception {
        act("a1", "submit", autoAnswer("yes")); ObjectNode round = savedRound(); HistoryRounds.validate(round);
        ObjectNode missing = round.deepCopy(); ((ObjectNode) missing.path("pages")).remove(missing.at("/questions/1/pageKey").asText());
        assertThrows(IOException.class, () -> HistoryRounds.validate(missing));
        ObjectNode wrongReference = round.deepCopy(); ((ObjectNode) wrongReference.path("questions").get(1)).put("pageKey", round.at("/questions/0/pageKey").asText());
        assertThrows(IOException.class, () -> HistoryRounds.validate(wrongReference));
        ObjectNode wrongIdentity = round.deepCopy(); ((ObjectNode) wrongIdentity.at("/questions/1/payload/extension")).put("version", "9.0.0");
        assertThrows(IOException.class, () -> HistoryRounds.validate(wrongIdentity));
        ObjectNode duplicate = round.deepCopy(); ((ObjectNode) duplicate.path("questions").get(1)).set("page", round.path("pages").path(round.at("/questions/1/pageKey").asText()).deepCopy());
        assertThrows(IOException.class, () -> HistoryRounds.validate(duplicate));
        ObjectNode wrongKey = round.deepCopy(); ((ObjectNode) wrongKey.path("pages").path(round.at("/questions/1/pageKey").asText()).path("extension")).put("fingerprint", "0".repeat(64));
        assertThrows(IOException.class, () -> HistoryRounds.validate(wrongKey));
        Path file = stateFile(bank); byte[] original = Files.readAllBytes(file); ObjectNode saved = (ObjectNode) Json.read(file, 32 * 1024 * 1024);
        ((com.fasterxml.jackson.databind.node.ArrayNode) saved.path("historyRounds")).set(0, wrongReference); Files.write(file, Json.MAPPER.writeValueAsBytes(saved));
        try {
            StateStore restarted = new StateStore(root, engine);
            assertEquals("HISTORY_UNAVAILABLE", assertThrows(ApiException.class, () -> restarted.history("bank", bank.id(), round.path("id").asText())).code);
            assertEquals("STATE_UNAVAILABLE", assertThrows(ApiException.class, () -> restarted.question(bank, bank.question("a1"))).code);
        } finally { Files.write(file, original); }
    }

    @Test void mixedEditResetsOnlyTheEditedQuestionAndKeepsCompletedHistoryFrozen() throws Exception {
        ObjectNode automatic = act("a1", "submit", autoAnswer("yes")); act("m1", "draft", manualAnswer("Keep draft until edit"));
        ObjectNode ink = Json.object().put("schemaVersion", 1); ink.set("viewport", Json.object().put("x", 0).put("y", 0).put("zoom", 1)); ink.putArray("strokes"); ink.set("paper", Json.object().put("color", "#ffffff").put("pattern", "plain"));
        act("m1", "whiteboard", Json.object().set("draft", ink));
        String historyId = finish().path("historyId").asText(); ObjectNode frozen = store.history("bank", bank.id(), historyId);
        ObjectNode editor = store.editor(library, bank, bank.question("m1")); ObjectNode data = (ObjectNode) bank.question("m1").data().deepCopy(); data.put("stem", "Edited manual stem");
        ObjectNode request = Json.object().put("requestId", "mixed-edit-first").put("title", "Edited manual title").put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()); request.set("data", data);
        ObjectNode edited = store.edit(library, bank, bank.question("m1"), request); bank = library.collection("bank", bank.id());
        assertEquals("manual", edited.at("/payload/extension/id").asText()); assertEquals("Edited manual stem", edited.at("/payload/question/data/stem").asText());
        assertEquals("unanswered", edited.at("/payload/state/status").asText()); assertTrue(edited.at("/payload/state/answer").isNull()); assertTrue(edited.at("/payload/state/result").isNull()); assertTrue(edited.at("/payload/draft").isNull());
        assertEquals(automatic.path("state"), store.question(bank, bank.question("a1")).path("state")); assertEquals("Manual last stem", store.question(bank, bank.question("m2")).at("/question/data/stem").asText());
        assertEquals(frozen, store.history("bank", bank.id(), historyId));
        JsonNode raw = Json.read(root.resolve("question-banks/mixed.json"), 8 * 1024 * 1024); assertFalse(raw.has("extension"));
        assertEquals("manual", raw.at("/questions/0/extension/id").asText()); assertEquals("automatic", raw.at("/questions/1/extension/id").asText()); assertEquals("manual", raw.at("/questions/2/extension/id").asText());
        store = new StateStore(root, engine); assertEquals(edited.path("payload").path("state"), store.question(bank, bank.question("m1")).path("state")); assertEquals(frozen, store.history("bank", bank.id(), historyId));
    }

    @Test void oldSingleExtensionStateAndRoundRemainReadableAndUnchanged() throws Exception {
        Library.Collection old = library.collection("bank", "manual-bank");
        assertNotNull(old.extension()); assertEquals("bank:manual-bank:manual:1.0.0", old.stateKey());
        ObjectNode request = Json.object().put("requestId", "legacy-submission").put("revision", 0).put("action", "submit"); request.set("data", manualAnswer("Old answer"));
        store.act(old, old.question("q1"), request); String id = store.summary(old).path("roundId").asText();
        Path statePath = stateFile(old); ObjectNode saved = (ObjectNode) Json.read(statePath, 32 * 1024 * 1024);
        // Reproduce the historical round shape, which predates the extensions array.
        ObjectNode oldRound = (ObjectNode) saved.path("historyRounds").get(0); oldRound.remove("extensions"); ((ObjectNode) oldRound.path("collection")).remove("extensions");
        Files.write(statePath, Json.MAPPER.writeValueAsBytes(saved)); byte[] before = Files.readAllBytes(statePath); HistoryRounds.validate(oldRound);
        ObjectNode frozen = store.history("bank", old.id(), id); assertTrue(frozen.path("page").isObject()); assertFalse(frozen.has("pages")); assertFalse(frozen.at("/questions/0").has("pageKey"));
        store = new StateStore(root, engine); assertEquals("submitted", store.question(old, old.question("q1")).at("/state/status").asText());
        assertEquals(frozen, store.history("bank", old.id(), id)); assertArrayEquals(before, Files.readAllBytes(statePath));
    }
}
