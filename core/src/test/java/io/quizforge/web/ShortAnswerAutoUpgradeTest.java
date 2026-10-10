package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ShortAnswerAutoUpgradeTest {
    @TempDir Path root;
    Library library;
    StateStore states;
    Library.Collection bank;

    void prepare(boolean mixed) throws Exception {
        ServerTest fixture = new ServerTest(); fixture.root = root; fixture.prepare();
        for (String folder : new String[]{"extensions/short-answer-1.2.2", "extensions/short-answer-1.3.0", "shared/richtext/1.1.2"}) {
            Path source = folder.equals("extensions/short-answer-1.2.2")
                    ? Path.of("test/fixtures/legacy-extensions/short-answer-1.2.2")
                    : folder.startsWith("extensions/") ? InstalledExtensionFixtures.find("quizforge.short-answer", "1.3.0") : Path.of(folder);
            try (var walk = Files.walk(source)) {
                for (Path path : walk.toList()) {
                    Path target = root.resolve(folder).resolve(source.relativize(path));
                    if (Files.isDirectory(path)) Files.createDirectories(target); else Files.copy(path, target);
                }
            }
        }
        Files.copy(Path.of("shared/richtext/service.json"), root.resolve("shared/richtext/service.json"));
        ObjectNode raw = (ObjectNode) Json.read(Path.of("test/fixtures/legacy-extensions/short-answer-1.2.2/examples.json"), 8 * 1024 * 1024);
        raw.put("formatVersion", 1).put("id", "auto-upgrade").put("title", "自动评分升级测试").put("customMetadata", "preserve author metadata");
        ArrayNode questions = Json.MAPPER.createArrayNode();
        for (int i = 0; i < (mixed ? 2 : 3); i++) questions.add(raw.path("questions").get(i).deepCopy());
        if (mixed) {
            JsonNode reference = raw.remove("extension");
            for (JsonNode question : questions) ((ObjectNode) question).set("extension", reference.deepCopy());
            ObjectNode ordinary = Json.object().put("id", "generic-question").put("title", "其他题型");
            ordinary.set("extension", Json.object().put("id", "generic").put("version", "1.0.0"));
            ordinary.set("data", Json.object().put("public", "visible").put("secret", "frozen answer").put("expected", "yes"));
            questions.add(ordinary);
        }
        raw.set("questions", questions);
        Files.createDirectories(root.resolve("question-banks/auto-upgrade"));
        Files.write(bankFile(), Json.MAPPER.writeValueAsBytes(raw));
        restart();
    }

    void restart() throws Exception {
        RuleEngine engine = new RuleEngine(root, "node", Duration.ofSeconds(4));
        library = new Library(root, engine); states = new StateStore(root, engine);
        bank = library.collection("bank", "auto-upgrade");
    }

    Path bankFile() { return root.resolve("question-banks/auto-upgrade/bank.json"); }
    Path stateFile(Library.Collection collection) {
        return root.resolve(".state").resolve(ResourceStore.hash(collection.stateKey().getBytes(StandardCharsets.UTF_8)) + ".json");
    }
    ObjectNode answer(String text) {
        ObjectNode answer = Json.object().put("formatVersion", 1);
        answer.putObject("document").put("type", "doc").putArray("content").addObject().put("type", "paragraph")
                .putArray("content").addObject().put("type", "text").put("text", text);
        return Json.object().set("answer", answer);
    }
    ObjectNode act(String id, String action, ObjectNode data) {
        JsonNode current = states.question(bank, bank.question(id)).path("state");
        ObjectNode request = Json.object().put("requestId", java.util.UUID.randomUUID().toString())
                .put("revision", current.path("revision").asLong()).put("action", action);
        request.set("data", data); return states.act(bank, bank.question(id), request);
    }
    ObjectNode ink() {
        ObjectNode value = Json.object().put("schemaVersion", 1);
        value.putObject("viewport").put("x", 3).put("y", 7).put("zoom", 1);
        value.putArray("strokes"); value.putObject("paper").put("color", "#ffffff").put("pattern", "plain");
        return value;
    }
    Map<String, ObjectNode> questionSnapshots() {
        Map<String, ObjectNode> result = new LinkedHashMap<>();
        for (Library.Question question : bank.questions()) result.put(question.id(), states.question(bank, question));
        return result;
    }

    @Test void activePracticePreservesGradesDraftsInkAndOldHistoryWhilePendingSubmissionBecomesZero() throws Exception {
        prepare(false);
        String pending = bank.questions().get(0).id(), graded = bank.questions().get(1).id(), draft = bank.questions().get(2).id();
        act(pending, "submit", answer("尚未人工判分的已提交答案。"));
        act(graded, "submit", answer("已经保存正式评分的答案。"));
        act(graded, "review", Json.object().set("review", Json.object().put("score", 2.5).put("feedback", "保留评分理由")));
        act(draft, "draft", answer("尚未提交的练习草稿。"));
        act(graded, "whiteboard", Json.object().set("draft", ink()));
        Map<String, ObjectNode> before = questionSnapshots();
        String historyId = states.summary(bank).path("roundId").asText();
        ObjectNode historyBefore = states.history("bank", bank.id(), historyId).deepCopy();
        Path oldFile = stateFile(bank); byte[] oldBytes = Files.readAllBytes(oldFile);
        byte[] oldPackage = Files.readAllBytes(root.resolve("extensions/short-answer-1.2.2/practice-ai.js"));
        JsonNode rawBefore = Json.read(bankFile(), 8 * 1024 * 1024);

        assertEquals(1, ShortAnswerAutoUpgrade.run(library, states));
        bank = library.collection("bank", bank.id()); assertEquals("1.3.0", bank.extension().version());
        Map<String, ObjectNode> after = questionSnapshots();
        for (Library.Question question : bank.questions()) {
            assertEquals(before.get(question.id()).at("/state/answer"), after.get(question.id()).at("/state/answer"));
            assertEquals(before.get(question.id()).path("draft"), after.get(question.id()).path("draft"));
            assertEquals(rawBefore.path("questions").get(bank.questions().indexOf(question)).path("data"), question.data());
        }
        assertEquals("submitted", after.get(pending).at("/state/status").asText());
        assertEquals("graded", after.get(pending).at("/state/result/gradingStatus").asText());
        assertEquals(0, after.get(pending).at("/state/result/score").asInt());
        assertFalse(after.get(pending).at("/state/result/correct").asBoolean());
        assertEquals(before.get(graded).at("/state/result"), after.get(graded).at("/state/result"));
        assertEquals("draft", after.get(draft).at("/state/status").asText()); assertTrue(after.get(draft).at("/state/result").isNull());
        assertEquals(0, states.summary(bank).path("pendingCount").asInt()); assertEquals(2.5, states.summary(bank).path("score").asDouble());
        assertEquals(historyBefore, states.history("bank", bank.id(), historyId));
        assertArrayEquals(oldBytes, Files.readAllBytes(oldFile));
        assertArrayEquals(oldPackage, Files.readAllBytes(root.resolve("extensions/short-answer-1.2.2/practice-ai.js")));
        assertEquals("preserve author metadata", Json.read(bankFile(), 8 * 1024 * 1024).path("customMetadata").asText());

        restart(); assertEquals(0, ShortAnswerAutoUpgrade.run(library, states));
        assertEquals(historyBefore, states.history("bank", bank.id(), historyId));
        for (Library.Question question : bank.questions()) assertEquals(after.get(question.id()).path("state"), states.question(bank, question).path("state"));
    }

    @Test void completedPracticeKeepsSubmittedAnswerAndSavedScoreInsteadOfTurningItIntoADraft() throws Exception {
        prepare(false); String id = bank.questions().get(0).id();
        act(id, "submit", answer("已完成练习的答案。")); act(id, "review", Json.object().set("review", Json.object().put("score", 3.5)));
        ObjectNode summary = states.summary(bank), finish = Json.object().put("requestId", "finish-before-auto-upgrade")
                .put("summaryVersion", summary.path("summaryVersion").asText()); finish.set("roundId", summary.path("roundId"));
        states.finish(bank, finish);
        ObjectNode before = states.question(bank, bank.question(id));
        ObjectNode frozen = states.history("bank", bank.id(), summary.path("roundId").asText()).deepCopy();
        int historyCount = states.history("bank", bank.id(), null).path("records").size();
        assertEquals(1, ShortAnswerAutoUpgrade.run(library, states)); bank = library.collection("bank", bank.id());
        ObjectNode current = states.question(bank, bank.question(id));
        assertEquals("submitted", current.at("/state/status").asText());
        assertEquals(before.at("/state/answer"), current.at("/state/answer")); assertEquals(before.at("/state/result"), current.at("/state/result"));
        assertTrue(states.summary(bank).path("finished").asBoolean());
        assertEquals(historyCount, states.history("bank", bank.id(), null).path("records").size(), "Completed history must not gain a migration duplicate");
        assertEquals(frozen, states.history("bank", bank.id(), summary.path("roundId").asText()));
        act(id, "whiteboard", Json.object().set("draft", ink()));
        assertTrue(states.summary(bank).path("finished").asBoolean(), "Adding ink cannot restart completed practice");
        assertEquals(3.5, states.summary(bank).path("score").asDouble());
        restart(); assertTrue(states.summary(bank).path("finished").asBoolean());
        assertEquals(before.at("/state/result"), states.question(bank, bank.question(id)).at("/state/result"));
        assertEquals(historyCount, states.history("bank", bank.id(), null).path("records").size());
        assertEquals(frozen, states.history("bank", bank.id(), summary.path("roundId").asText()));
        states.deleteHistory("bank", bank.id(), summary.path("roundId").asText());
        ObjectNode finished = states.summary(bank), again = Json.object().put("requestId", "finish-after-history-delete")
                .put("summaryVersion", finished.path("summaryVersion").asText()); again.set("roundId", finished.path("roundId"));
        assertTrue(states.finish(bank, again).path("historyId").isNull(), "Deleting history must not return a missing record ID");
        assertEquals(3.5, states.summary(bank).path("score").asDouble());
    }

    @Test void mixedUpgradeLeavesOtherTypesAndFrozenHistoryUntouchedAndBacksUpOriginalBytes() throws Exception {
        prepare(true); String manual = bank.questions().get(0).id();
        act(manual, "submit", answer("需要评分的组合题库答案。"));
        act("generic-question", "submit", Json.object().set("answer", Json.object().put("value", "yes")));
        ObjectNode otherBefore = states.question(bank, bank.question("generic-question"));
        String historyId = states.summary(bank).path("roundId").asText(); ObjectNode frozen = states.history("bank", bank.id(), historyId).deepCopy();
        Path oldFile = stateFile(bank); byte[] oldBytes = Files.readAllBytes(oldFile), bankBytes = Files.readAllBytes(bankFile());
        assertEquals(1, ShortAnswerAutoUpgrade.run(library, states)); bank = library.collection("bank", bank.id());
        assertNull(bank.extension()); assertEquals("1.3.0", bank.extensionFor(bank.question(manual)).version());
        assertEquals("1.0.0", bank.extensionFor(bank.question("generic-question")).version());
        assertEquals(otherBefore.path("state"), states.question(bank, bank.question("generic-question")).path("state"));
        assertEquals(frozen, states.history("bank", bank.id(), historyId));
        try (var paths = Files.list(root.resolve(".state/upgrade-backups"))) {
            Path backup = paths.findFirst().orElseThrow();
            assertArrayEquals(oldBytes, Files.readAllBytes(backup.resolve("state.json")));
            assertArrayEquals(bankBytes, Files.readAllBytes(backup.resolve("bank.json")));
        }
        restart(); assertEquals(0, ShortAnswerAutoUpgrade.run(library, states));
        assertEquals(frozen, states.history("bank", bank.id(), historyId));
    }

    @Test void pendingEditorDraftBlocksUpgradeAndLeavesEverySavedFileUnchanged() throws Exception {
        prepare(false); String id = bank.questions().get(0).id(); act(id, "draft", answer("保留练习答案。"));
        EditorDraftStore drafts = new EditorDraftStore(root);
        ObjectNode request = Json.object().put("contentVersion", "a".repeat(64)).put("changed", true);
        request.set("draft", Json.object().put("pendingStem", "尚未保存的编辑草稿")); drafts.put(bank.id(), id, request);
        ObjectNode draftBefore = drafts.get(bank.id(), id); byte[] stateBefore = Files.readAllBytes(stateFile(bank)), bankBefore = Files.readAllBytes(bankFile());
        assertEquals("UPGRADE_EDITOR_DRAFT_PENDING", assertThrows(ApiException.class, () -> ShortAnswerAutoUpgrade.run(library, states)).code);
        assertEquals(draftBefore, drafts.get(bank.id(), id)); assertArrayEquals(stateBefore, Files.readAllBytes(stateFile(bank))); assertArrayEquals(bankBefore, Files.readAllBytes(bankFile()));
    }

    @Test void existingTargetPracticeCannotBeOverwritten() throws Exception {
        prepare(false); Library.EditPlan plan = library.prepareShortAnswerAutoUpgrade(bank);
        Path target = stateFile(plan.collection()); Files.writeString(target, "keep-target-practice");
        byte[] before = Files.readAllBytes(bankFile());
        assertEquals("UPGRADE_STATE_EXISTS", assertThrows(ApiException.class, () -> ShortAnswerAutoUpgrade.run(library, states)).code);
        assertArrayEquals(before, Files.readAllBytes(bankFile())); assertEquals("keep-target-practice", Files.readString(target));
    }
}
