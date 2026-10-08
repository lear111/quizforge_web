package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class AiGradingServiceTest {
    @TempDir Path root;
    ManualReviewTest fixture;
    AiGradingService service;
    @BeforeEach void prepare() throws Exception {
        fixture = new ManualReviewTest(); fixture.root = root; fixture.prepare();
        Path rules = root.resolve("extensions/manual/rules.js"); String source = Files.readString(rules);
        Files.writeString(rules, source.replace("project(data,state)", """
                prepareAiGrading(data,answer){return {protocolVersion:1,question:[{type:'text',text:data.stem}],answer:[{type:'text',text:answer.text}],referenceAnswer:[{type:'text',text:data.reference}],rubric:[{type:'text',text:'按要点评分'}],maxScore:data.maxScore,scoreStep:0.5};},
                project(data,state)
                """));
        fixture.bank = fixture.library.collection("bank", "manual-bank"); fixture.save("q1", fixture.act("ai-answer-first", "q1", 0, "submit", fixture.answer("My answer")));
    }
    @AfterEach void close() { if (service != null) service.close(); }
    ObjectNode start(String requestId) { return service.start(fixture.bank, fixture.bank.question("q1"), Json.object().put("requestId", requestId).put("contentVersion", fixture.store.stamp(fixture.bank, fixture.bank.question("q1")).path("contentVersion").asText())); }
    ObjectNode get(String id) { return service.get(fixture.bank, fixture.bank.question("q1"), id); }
    ObjectNode await(String id, String status) throws Exception { long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15); ObjectNode task; do { task = get(id); if (task.path("status").asText().equals(status)) return task; if (ListTerminal(task.path("status").asText())) fail(task.toString()); Thread.sleep(20); } while (System.nanoTime() < deadline); fail("AI task did not reach " + status + ": " + task); return null; }
    boolean ListTerminal(String status) { return java.util.List.of("succeeded", "failed", "superseded", "confirmed").contains(status); }
    AiGateway.Response valid() { return new AiGateway.Response("{\"score\":3.5,\"feedback\":\"要点基本完整，示例欠缺。\"}", "fake", "local-test", "response-test", Json.object().put("total_tokens", 20)); }
    void manual(double score, String requestId) { long revision = fixture.question("q1").at("/state/revision").asLong(); fixture.save("q1", fixture.act(requestId, "q1", revision, "review", fixture.review(score))); }

    @Test void repairTransportRetriesShareThreeCallBudgetAndInkDoesNotExpireCandidate() throws Exception {
        AtomicInteger calls = new AtomicInteger(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        service = new AiGradingService(root, fixture.store, fixture.library, request -> {
            int call = calls.incrementAndGet();
            if (call == 1) { assertFalse(request.repair()); entered.countDown(); try { assertTrue(release.await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return new AiGateway.Response("{\"score\":2.25,\"feedback\":\"invalid precision\"}", "fake", "local-test", "", null); }
            assertTrue(request.repair()); assertTrue(request.invalidOutput().contains("0.5"));
            if (call == 2) throw new AiProviderException("AI_UPSTREAM", true, 0); return valid();
        });
        String id = start("ai-start-budget").path("taskId").asText(); assertTrue(entered.await(10, TimeUnit.SECONDS));
        ObjectNode paper = Json.object().put("schemaVersion", 1); paper.set("viewport", Json.object().put("x", 5).put("y", 10).put("zoom", 1)); paper.putArray("strokes"); paper.set("paper", Json.object().put("color", "#ffffff").put("pattern", "plain"));
        try { fixture.save("q1", fixture.act("ai-draw-during", "q1", 1, "whiteboard", Json.object().set("draft", paper))); } finally { release.countDown(); }
        ObjectNode ready = await(id, "succeeded"); assertEquals(3, calls.get()); assertEquals(3, ready.path("attempts").size()); assertTrue(ready.path("repairUsed").asBoolean()); assertTrue(fixture.question("q1").at("/state/result/score").isNull());
        assertEquals(2, fixture.question("q1").at("/state/revision").asLong());
        ObjectNode request = Json.object().put("requestId", "ai-confirm-budget").put("candidateVersion", ready.at("/candidate/version").asText()).put("score", 4);
        ObjectNode confirmed = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request); JsonNode result = confirmed.at("/payload/state/result");
        assertEquals(4, result.path("score").asInt()); assertEquals(3.5, result.at("/aiAssessment/score").asDouble()); assertEquals("ai-assisted", result.path("gradingSource").asText()); assertTrue(result.path("feedback").asText().contains("最终得分：4"));
        assertEquals(Json.MAPPER.readTree(confirmed.toString()), Json.MAPPER.readTree(service.confirm(fixture.bank, fixture.bank.question("q1"), id, request).toString()));
        manual(2, "ai-manual-adjust"); JsonNode adjusted = fixture.question("q1").at("/state/result"); assertEquals("manual", adjusted.path("gradingSource").asText()); assertTrue(adjusted.path("feedback").asText().contains("最终得分：2")); assertTrue(adjusted.path("feedback").asText().contains("要点基本完整"));
        ObjectNode finished = fixture.store.finish(fixture.bank, fixture.finish("ai-finish-round")); ObjectNode history = fixture.store.history("bank", fixture.bank.id(), finished.path("historyId").asText());
        assertEquals(2, history.at("/summary/score").asInt()); assertEquals("manual", history.at("/questions/0/payload/state/result/gradingSource").asText()); assertFalse(fixture.question("q1").at("/capabilities/canAiGrade").asBoolean());
    }

    @Test void manualReviewRetryAndTitleEditRejectOldCandidatesAndScopeIsChecked() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1); AtomicInteger calls = new AtomicInteger();
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { if (calls.incrementAndGet() == 1) { entered.countDown(); try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } } return valid(); });
        String first = start("ai-old-manual").path("taskId").asText(); assertTrue(entered.await(10, TimeUnit.SECONDS)); try { manual(1.5, "ai-human-wins"); } finally { release.countDown(); }
        await(first, "superseded"); assertEquals(1.5, fixture.question("q1").at("/state/result/score").asDouble());
        String second = start("ai-before-retry").path("taskId").asText(); await(second, "succeeded");
        long revision = fixture.question("q1").at("/state/revision").asLong(); fixture.save("q1", fixture.act("ai-answer-retry", "q1", revision, "retry", Json.object())); assertEquals("superseded", get(second).path("status").asText());
        revision = fixture.question("q1").at("/state/revision").asLong(); fixture.save("q1", fixture.act("ai-answer-again", "q1", revision, "submit", fixture.answer("My answer")));
        String third = start("ai-before-title").path("taskId").asText(); await(third, "succeeded");
        ObjectNode editor = fixture.store.editor(fixture.library, fixture.bank, fixture.bank.question("q1")); ObjectNode edit = Json.object().put("requestId", "ai-title-change").put("title", "New title").put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()); edit.set("data", fixture.bank.question("q1").data());
        fixture.store.edit(fixture.library, fixture.bank, fixture.bank.question("q1"), edit); fixture.bank = fixture.library.collection("bank", fixture.bank.id()); assertEquals("superseded", get(third).path("status").asText());
        assertEquals("AI_TASK_NOT_FOUND", assertThrows(ApiException.class, () -> service.get(fixture.bank, fixture.bank.question("q2"), third)).code);
        assertEquals("AI_CANDIDATE_UNAVAILABLE", assertThrows(ApiException.class, () -> service.confirm(fixture.bank, fixture.bank.question("q1"), third, Json.object().put("requestId", "ai-confirm-stale"))).code);
    }

    @Test void restartRestoresCandidateDeduplicatesStartAndRecoversConfirmationCrashReceipt() throws Exception {
        AtomicInteger calls = new AtomicInteger(); AiGateway fake = request -> { calls.incrementAndGet(); return valid(); };
        service = new AiGradingService(root, fixture.store, fixture.library, fake); String id = start("ai-restart-start").path("taskId").asText(); ObjectNode ready = await(id, "succeeded"); service.close();
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fake); assertEquals("succeeded", get(id).path("status").asText()); assertEquals(id, start("ai-restart-dedupe").path("taskId").asText()); assertEquals(1, calls.get());
        ObjectNode request = Json.object().put("requestId", "ai-restart-confirm").put("candidateVersion", ready.at("/candidate/version").asText()); ObjectNode confirmed = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request);
        Path taskFile = root.resolve(".state/ai-grading/" + id + ".json"); ObjectNode saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "succeeded"); saved.remove("confirmedAt"); Files.writeString(taskFile, saved.toString()); service.close();
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fake); assertEquals("confirmed", get(id).path("status").asText());
        assertEquals(Json.MAPPER.readTree(confirmed.path("payload").toString()), Json.MAPPER.readTree(service.confirm(fixture.bank, fixture.bank.question("q1"), id, request).path("payload").toString())); assertEquals(1, calls.get());
    }

    @Test void commandReplayRefreshesInterruptedOrUnboundJobsWithoutCallingTheProvider() throws Exception {
        AtomicInteger calls = new AtomicInteger(); AiGateway fake = request -> { calls.incrementAndGet(); return valid(); };
        service = new AiGradingService(root, fixture.store, fixture.library, fake);
        ObjectNode request = Json.object().put("requestId", "ai-interrupted-command");
        String id = service.start(fixture.bank, fixture.bank.question("q1"), request).path("taskId").asText(); await(id, "succeeded"); service.close();
        Path taskFile = root.resolve(".state/ai-grading/" + id + ".json"); ObjectNode saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "queued"); saved.remove("candidate"); Files.writeString(taskFile, saved.toString());
        service = new AiGradingService(root, fixture.store, fixture.library, fake);
        assertEquals("failed", service.start(fixture.bank, fixture.bank.question("q1"), request).path("status").asText()); assertEquals("AI_INTERRUPTED", get(id).at("/error/code").asText()); assertEquals(1, calls.get());
        ObjectNode nextRequest = Json.object().put("requestId", "ai-new-after-interrupted"); String next = service.start(fixture.bank, fixture.bank.question("q1"), nextRequest).path("taskId").asText(); await(next, "succeeded"); assertNotEquals(id, next); assertEquals(2, calls.get());
        manual(1, "ai-unbound-command"); service.close();
        Path nextFile = root.resolve(".state/ai-grading/" + next + ".json"); saved = (ObjectNode) Json.read(nextFile, 2 * 1024 * 1024); saved.put("status", "queued"); saved.remove("candidate"); Files.writeString(nextFile, saved.toString());
        service = new AiGradingService(root, fixture.store, fixture.library, fake);
        assertEquals("superseded", service.start(fixture.bank, fixture.bank.question("q1"), nextRequest).path("status").asText()); assertEquals(2, calls.get());
    }
}
