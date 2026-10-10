package io.quizforge.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class TransientAiGradingTest {
    @TempDir Path root;
    @Test void retryAutoScoringAndCommandReplayKeepAnswersAndAiTasksOnlyInMemory() throws Exception {
        ManualReviewTest fixture = new ManualReviewTest(); fixture.root = root; fixture.prepare();
        Path rules = root.resolve("extensions/manual/rules.js");
        Files.writeString(rules, Files.readString(rules).replace("project(data,state)", """
                prepareAiGrading(data,answer){return {protocolVersion:1,question:[{type:'text',text:data.stem}],answer:[{type:'text',text:answer.text}],referenceAnswer:[{type:'text',text:data.reference}],rubric:[{type:'text',text:'要点'}],maxScore:data.maxScore,scoreStep:0.5};},
                project(data,state)
                """));
        Path bankPath = root.resolve("question-banks/manual.json"); ObjectNode raw = (ObjectNode) Json.read(bankPath, 1024 * 1024);
        raw.set("features", Json.object().put("history", false)); Files.writeString(bankPath, raw.toString());
        fixture.bank = fixture.library.collection("bank", "manual-bank");
        Path transientRoot = root.resolve("page-memory"); fixture.store = StateStore.memory(root, fixture.engine, transientRoot);
        fixture.save("q1", fixture.act("memory-answer-first", "q1", 0, "submit", fixture.answer("Temporary answer")));
        AtomicInteger calls = new AtomicInteger();
        AiGateway gateway = request -> {
            if (calls.incrementAndGet() == 1) throw new AiProviderException("AI_UPSTREAM", true, 0);
            return new AiGateway.Response("{\"score\":3.5,\"feedback\":\"要点基本完整。\"}", "fake", "test", "memory-response", Json.object());
        };
        String taskId;
        try (AiGradingService service = AiGradingService.memory(root, fixture.store, fixture.library, gateway)) {
            ObjectNode command = Json.object().put("requestId", "memory-ai-command").put("contentVersion", fixture.store.stamp(fixture.bank, fixture.bank.question("q1")).path("contentVersion").asText());
            taskId = service.start(fixture.bank, fixture.bank.question("q1"), command).path("taskId").asText();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15); ObjectNode task;
            do {
                task = service.get(fixture.bank, fixture.bank.question("q1"), taskId);
                if (task.path("status").asText().equals("confirmed")) break;
                assertFalse(java.util.List.of("failed", "superseded").contains(task.path("status").asText()), task.toString());
                Thread.sleep(20);
            } while (System.nanoTime() < deadline);
            assertEquals("confirmed", task.path("status").asText(), task.toString());
            assertEquals(3.5, fixture.question("q1").at("/state/result/score").asDouble());
            assertTrue(fixture.question("q1").at("/state/result/feedback").asText().contains("最终得分：3.5"));
            assertEquals(taskId, service.start(fixture.bank, fixture.bank.question("q1"), command).path("taskId").asText());
            assertEquals(2, calls.get()); assertTrue(service.memoryBytes() > 0);
            assertFalse(Files.exists(root.resolve(".state/ai-grading"))); assertFalse(Files.exists(transientRoot));
        }
        StateStore nextPage = StateStore.memory(root, fixture.engine, transientRoot);
        assertEquals("unanswered", nextPage.question(fixture.bank, fixture.bank.question("q1")).at("/state/status").asText());
        try (AiGradingService nextService = AiGradingService.memory(root, nextPage, fixture.library, gateway)) {
            String priorId = taskId;
            assertEquals("AI_TASK_NOT_FOUND", assertThrows(ApiException.class, () -> nextService.get(fixture.bank, fixture.bank.question("q1"), priorId)).code);
        }
    }
}
