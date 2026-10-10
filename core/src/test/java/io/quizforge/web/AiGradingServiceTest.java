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
    ObjectNode await(String id, String status) throws Exception { long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15); ObjectNode task; do { task = get(id); if (task.path("status").asText().equals(status)) return task; if (ListTerminal(task.path("status").asText()) && !(status.equals("confirmed") && task.path("status").asText().equals("succeeded"))) fail(task.toString()); Thread.sleep(20); } while (System.nanoTime() < deadline); fail("AI task did not reach " + status + ": " + task); return null; }
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
        ObjectNode ready = await(id, "confirmed"); assertEquals(3, calls.get()); assertEquals(3, ready.path("attempts").size()); assertTrue(ready.path("repairUsed").asBoolean()); assertEquals(3.5, fixture.question("q1").at("/state/result/score").asDouble());
        assertEquals(3, fixture.question("q1").at("/state/revision").asLong()); assertFalse(ready.has("autoApply"));
        ObjectNode request = Json.object().put("requestId", "ai-confirm-budget").put("candidateVersion", ready.at("/candidate/version").asText());
        ObjectNode confirmed = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request); JsonNode result = confirmed.at("/payload/state/result");
        assertEquals(3.5, result.path("score").asDouble()); assertEquals(3.5, result.at("/aiAssessment/score").asDouble()); assertEquals("ai", result.path("gradingSource").asText()); assertTrue(result.path("feedback").asText().contains("最终得分：3.5"));
        assertEquals(Json.MAPPER.readTree(confirmed.toString()), Json.MAPPER.readTree(service.confirm(fixture.bank, fixture.bank.question("q1"), id, request).toString()));
        assertEquals("AI_CANDIDATE_CONFLICT", assertThrows(ApiException.class, () -> service.confirm(fixture.bank, fixture.bank.question("q1"), id, request.deepCopy().put("requestId", "ai-confirm-different-score").put("score", 4))).code);
        assertEquals("REQUEST_ID_REUSED", assertThrows(ApiException.class, () -> service.confirm(fixture.bank, fixture.bank.question("q1"), id, request.deepCopy().put("requestId", "auto-" + id).put("score", 4))).code);
        manual(2, "ai-manual-adjust"); JsonNode adjusted = fixture.question("q1").at("/state/result"); assertEquals("manual", adjusted.path("gradingSource").asText()); assertTrue(adjusted.path("feedback").asText().contains("最终得分：2")); assertTrue(adjusted.path("feedback").asText().contains("要点基本完整"));
        assertEquals("AI_RESULT_STALE", assertThrows(ApiException.class, () -> service.confirm(fixture.bank, fixture.bank.question("q1"), id, request.deepCopy().put("requestId", "ai-ack-after-manual"))).code);
        ObjectNode replay = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request.deepCopy().put("requestId", "auto-" + id)); assertEquals(3.5, replay.at("/payload/state/result/score").asDouble()); assertEquals(2, fixture.question("q1").at("/state/result/score").asInt());
        ObjectNode finished = fixture.store.finish(fixture.bank, fixture.finish("ai-finish-round")); ObjectNode history = fixture.store.history("bank", fixture.bank.id(), finished.path("historyId").asText());
        assertEquals(2, history.at("/summary/score").asInt()); assertEquals("manual", history.at("/questions/0/payload/state/result/gradingSource").asText()); assertFalse(fixture.question("q1").at("/capabilities/canAiGrade").asBoolean());
    }

    @Test void successfulJobCommitsWithoutAnyBrowserTaskPollAndUpdatesActiveHistory() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { calls.incrementAndGet(); return valid(); });
        String roundId = fixture.store.summary(fixture.bank).path("roundId").asText(), id = start("ai-background-only").path("taskId").asText();
        Path taskFile = root.resolve(".state/ai-grading/" + id + ".json"); long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        JsonNode saved;
        do { saved = Json.read(taskFile, 2 * 1024 * 1024); if (saved.path("status").asText().equals("confirmed")) break; Thread.sleep(20); } while (System.nanoTime() < end);
        assertEquals("confirmed", saved.path("status").asText(), saved.toString()); assertTrue(saved.path("autoApply").asBoolean()); assertEquals(1, calls.get());
        assertEquals(3.5, fixture.question("q1").at("/state/result/score").asDouble());
        JsonNode history = fixture.store.history("bank", fixture.bank.id(), roundId);
        assertEquals(3.5, history.at("/questions/0/payload/state/result/score").asDouble()); assertEquals(0, history.path("pendingCount").asInt());
        assertEquals("ai", history.at("/questions/0/payload/state/result/gradingSource").asText());
        long revision = fixture.question("q1").at("/state/revision").asLong(); ObjectNode paper = Json.object().put("schemaVersion", 1); paper.set("viewport", Json.object().put("x", 25).put("y", 40).put("zoom", 1)); paper.putArray("strokes"); paper.set("paper", Json.object().put("color", "#ffffff").put("pattern", "plain"));
        fixture.save("q1", fixture.act("ai-ink-after-auto", "q1", revision, "whiteboard", Json.object().set("draft", paper)));
        ObjectNode acknowledged = service.confirm(fixture.bank, fixture.bank.question("q1"), id, Json.object().put("requestId", "ai-fresh-ack-current"));
        assertEquals(revision + 1, acknowledged.at("/payload/state/revision").asLong()); assertEquals(paper, acknowledged.at("/payload/draft")); assertEquals(fixture.question("q1"), acknowledged.path("payload"));
    }

    @Test void restartAppliesNewPersistedCandidateOnceButDoesNotApplyLegacyCandidate() throws Exception {
        AtomicInteger calls = new AtomicInteger(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AiGateway fast = request -> { calls.incrementAndGet(); return valid(); };
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { calls.incrementAndGet(); entered.countDown(); try { assertTrue(release.await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return valid(); });
        String id = start("ai-uncommitted-auto").path("taskId").asText(); assertTrue(entered.await(10, TimeUnit.SECONDS));
        Path stateFile = fixture.stateFile(), taskFile = root.resolve(".state/ai-grading/" + id + ".json"); byte[] boundState = Files.readAllBytes(stateFile); release.countDown(); await(id, "confirmed"); service.close();
        ObjectNode saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "succeeded"); saved.remove("confirmedAt"); Files.writeString(taskFile, saved.toString()); Files.write(stateFile, boundState);
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fast);
        assertEquals("confirmed", get(id).path("status").asText()); assertEquals(3.5, fixture.question("q1").at("/state/result/score").asDouble());
        long revision = fixture.question("q1").at("/state/revision").asLong(); assertEquals("confirmed", get(id).path("status").asText()); assertEquals(revision, fixture.question("q1").at("/state/revision").asLong()); assertEquals(1, calls.get()); service.close();

        manual(1, "ai-before-legacy"); CountDownLatch legacyEntered = new CountDownLatch(1), legacyRelease = new CountDownLatch(1);
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { calls.incrementAndGet(); legacyEntered.countDown(); try { assertTrue(legacyRelease.await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return valid(); });
        String legacy = start("ai-legacy-candidate").path("taskId").asText(); assertTrue(legacyEntered.await(10, TimeUnit.SECONDS)); boundState = Files.readAllBytes(stateFile); legacyRelease.countDown(); await(legacy, "confirmed"); service.close();
        taskFile = root.resolve(".state/ai-grading/" + legacy + ".json"); saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "succeeded"); saved.remove(java.util.List.of("autoApply", "confirmedAt")); Files.writeString(taskFile, saved.toString()); Files.write(stateFile, boundState);
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fast);
        assertEquals("succeeded", get(legacy).path("status").asText()); assertEquals("succeeded", service.current(fixture.bank, fixture.bank.question("q1")).path("status").asText());
        assertEquals(1, fixture.question("q1").at("/state/result/score").asDouble()); assertEquals(legacy, start("ai-legacy-deduplicated").path("taskId").asText()); assertEquals(2, calls.get());
        ObjectNode confirmed = service.confirm(fixture.bank, fixture.bank.question("q1"), legacy, Json.object().put("requestId", "ai-legacy-confirm").put("score", 4));
        assertEquals(4, confirmed.at("/payload/state/result/score").asDouble()); assertEquals("confirmed", get(legacy).path("status").asText()); assertEquals(2, calls.get());
    }

    @Test void manualReviewRetryAndTitleEditRejectOldCandidatesAndScopeIsChecked() throws Exception {
        CountDownLatch[] entered = {new CountDownLatch(1), new CountDownLatch(1), new CountDownLatch(1)}, release = {new CountDownLatch(1), new CountDownLatch(1), new CountDownLatch(1)}; AtomicInteger calls = new AtomicInteger();
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { int index = calls.getAndIncrement(); entered[index].countDown(); try { assertTrue(release[index].await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return valid(); });
        String first = start("ai-old-manual").path("taskId").asText(); assertTrue(entered[0].await(10, TimeUnit.SECONDS)); try { manual(1.5, "ai-human-wins"); } finally { release[0].countDown(); }
        await(first, "superseded"); assertEquals(1.5, fixture.question("q1").at("/state/result/score").asDouble());
        String second = start("ai-before-retry").path("taskId").asText(); assertTrue(entered[1].await(10, TimeUnit.SECONDS));
        long revision = fixture.question("q1").at("/state/revision").asLong(); try { fixture.save("q1", fixture.act("ai-answer-retry", "q1", revision, "retry", Json.object())); } finally { release[1].countDown(); } await(second, "superseded");
        assertEquals("unanswered", fixture.question("q1").at("/state/status").asText()); assertTrue(fixture.question("q1").at("/state/result").isNull());
        revision = fixture.question("q1").at("/state/revision").asLong(); fixture.save("q1", fixture.act("ai-answer-again", "q1", revision, "submit", fixture.answer("My answer")));
        String third = start("ai-before-title").path("taskId").asText(); assertTrue(entered[2].await(10, TimeUnit.SECONDS));
        ObjectNode editor = fixture.store.editor(fixture.library, fixture.bank, fixture.bank.question("q1")); ObjectNode edit = Json.object().put("requestId", "ai-title-change").put("title", "New title").put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()); edit.set("data", fixture.bank.question("q1").data());
        try { fixture.store.edit(fixture.library, fixture.bank, fixture.bank.question("q1"), edit); fixture.bank = fixture.library.collection("bank", fixture.bank.id()); } finally { release[2].countDown(); } await(third, "superseded");
        assertEquals("AI_TASK_NOT_FOUND", assertThrows(ApiException.class, () -> service.get(fixture.bank, fixture.bank.question("q2"), third)).code);
        assertEquals("AI_CANDIDATE_UNAVAILABLE", assertThrows(ApiException.class, () -> service.confirm(fixture.bank, fixture.bank.question("q1"), third, Json.object().put("requestId", "ai-confirm-stale"))).code);
    }

    @Test void replacingCurrentTaskPreventsDelayedResultFromWriting() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1); AtomicInteger calls = new AtomicInteger();
        service = new AiGradingService(root, fixture.store, fixture.library, request -> {
            if (calls.incrementAndGet() == 1) { entered.countDown(); try { assertTrue(release.await(10, TimeUnit.SECONDS)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return new AiGateway.Response("{\"score\":1.5,\"feedback\":\"Old evaluation\"}", "fake", "local-test", "response-old", null); }
            return valid();
        });
        String first = start("ai-task-before-replacement").path("taskId").asText(); assertTrue(entered.await(10, TimeUnit.SECONDS));
        String second; try { second = service.start(fixture.bank, fixture.bank.question("q1"), Json.object().put("requestId", "ai-task-forced-new").put("force", true)).path("taskId").asText(); } finally { release.countDown(); }
        assertNotEquals(first, second); await(second, "confirmed"); assertEquals("superseded", get(first).path("status").asText());
        JsonNode result = fixture.question("q1").at("/state/result"); assertEquals(3.5, result.path("score").asDouble()); assertEquals(second, result.at("/aiAssessment/taskId").asText()); assertEquals(2, calls.get());
    }

    @Test void restartRestoresCandidateDeduplicatesStartAndRecoversConfirmationCrashReceipt() throws Exception {
        AtomicInteger calls = new AtomicInteger(); AiGateway fake = request -> { calls.incrementAndGet(); return valid(); };
        service = new AiGradingService(root, fixture.store, fixture.library, fake); ObjectNode command = Json.object().put("requestId", "ai-restart-start").put("contentVersion", fixture.store.stamp(fixture.bank, fixture.bank.question("q1")).path("contentVersion").asText()); String id = service.start(fixture.bank, fixture.bank.question("q1"), command).path("taskId").asText(); ObjectNode ready = await(id, "confirmed"); service.close();
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fake); assertEquals("confirmed", get(id).path("status").asText()); assertEquals(id, service.start(fixture.bank, fixture.bank.question("q1"), command).path("taskId").asText()); assertEquals(1, calls.get());
        ObjectNode request = Json.object().put("requestId", "auto-" + id).put("candidateVersion", ready.at("/candidate/version").asText()); ObjectNode confirmed = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request);
        Path taskFile = root.resolve(".state/ai-grading/" + id + ".json"); ObjectNode saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "succeeded"); saved.remove("confirmedAt"); Files.writeString(taskFile, saved.toString()); service.close();
        fixture.store = new StateStore(root, fixture.engine); service = new AiGradingService(root, fixture.store, fixture.library, fake); assertEquals("confirmed", get(id).path("status").asText());
        assertEquals(Json.MAPPER.readTree(confirmed.path("payload").toString()), Json.MAPPER.readTree(service.confirm(fixture.bank, fixture.bank.question("q1"), id, request).path("payload").toString())); assertEquals(1, calls.get());
        ObjectNode fresh = service.confirm(fixture.bank, fixture.bank.question("q1"), id, request.deepCopy().put("requestId", "ai-restart-fresh-ack")); assertEquals(fixture.question("q1").path("stamp"), fresh.at("/payload/stamp"));
    }

    @Test void commandReplayRefreshesInterruptedOrUnboundJobsWithoutCallingTheProvider() throws Exception {
        AtomicInteger calls = new AtomicInteger(); CountDownLatch entered = new CountDownLatch(1); AiGateway fake = request -> { calls.incrementAndGet(); return valid(); };
        service = new AiGradingService(root, fixture.store, fixture.library, request -> { calls.incrementAndGet(); entered.countDown(); try { new CountDownLatch(1).await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiProviderException("AI_INTERRUPTED", false, 0); } return valid(); });
        ObjectNode request = Json.object().put("requestId", "ai-interrupted-command");
        String id = service.start(fixture.bank, fixture.bank.question("q1"), request).path("taskId").asText(); assertTrue(entered.await(10, TimeUnit.SECONDS)); service.close(); await(id, "failed");
        Path taskFile = root.resolve(".state/ai-grading/" + id + ".json"); ObjectNode saved = (ObjectNode) Json.read(taskFile, 2 * 1024 * 1024); saved.put("status", "queued"); saved.remove("candidate"); Files.writeString(taskFile, saved.toString());
        service = new AiGradingService(root, fixture.store, fixture.library, fake);
        assertEquals("failed", service.start(fixture.bank, fixture.bank.question("q1"), request).path("status").asText()); assertEquals("AI_INTERRUPTED", get(id).at("/error/code").asText()); assertEquals(1, calls.get());
        ObjectNode nextRequest = Json.object().put("requestId", "ai-new-after-interrupted"); String next = service.start(fixture.bank, fixture.bank.question("q1"), nextRequest).path("taskId").asText(); await(next, "confirmed"); assertNotEquals(id, next); assertEquals(2, calls.get());
        manual(1, "ai-unbound-command"); service.close();
        Path nextFile = root.resolve(".state/ai-grading/" + next + ".json"); saved = (ObjectNode) Json.read(nextFile, 2 * 1024 * 1024); saved.put("status", "queued"); saved.remove("candidate"); Files.writeString(nextFile, saved.toString());
        service = new AiGradingService(root, fixture.store, fixture.library, fake);
        assertEquals("superseded", service.start(fixture.bank, fixture.bank.question("q1"), nextRequest).path("status").asText()); assertEquals(2, calls.get());
    }
}
