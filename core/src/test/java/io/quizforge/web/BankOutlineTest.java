package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class BankOutlineTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    String originalRules;
    @BeforeEach void prepare() throws Exception {
        fixture.root = root; fixture.prepare(); originalRules = Files.readString(root.resolve("extensions/generic/rules.js"));
    }
    @AfterEach void close() { fixture.close(); }
    ObjectNode read(String path) throws Exception { return (ObjectNode) Json.read(root.resolve(path), 8 * 1024 * 1024); }
    Library library() throws IOException { return new Library(root, new RuleEngine(root, "node", Duration.ofSeconds(8))); }
    void declared() throws Exception {
        ObjectNode manifest = read("extensions/generic/manifest.json");
        manifest.putObject("requiresApi").put("major", 1).put("minMinor", 1).putArray("capabilities").add("practice").add("score").add("outline-items");
        fixture.write("extensions/generic/manifest.json", manifest.toString());
    }
    void bankAndExamples(ObjectNode bank) throws Exception {
        fixture.write("question-banks/bank.json", bank.toString());
        fixture.write("extensions/generic/examples.json", bank.deepCopy().put("id", "examples").toString());
    }
    ObjectNode questionOutline(String label) { return Json.object().put("level", "question").put("label", label); }
    ObjectNode partsOutline() {
        ObjectNode value = Json.object().put("level", "parts");
        value.putArray("items").addObject().put("id", "part-22").put("label", "22");
        value.withArray("items").addObject().put("id", "part-21").put("label", "21");
        return value;
    }

    @Test void explicitQuestionLabelsOverrideLegacyHookOnlyForConfiguredParents() throws Exception {
        declared(); ObjectNode bank = read("question-banks/bank.json");
        ((ObjectNode) bank.path("questions").get(0)).set("outline", questionOutline("三")); bankAndExamples(bank);
        fixture.write("extensions/generic/rules.js", originalRules.replace("QF.defineType({", "QF.defineType({getOutlineItems(data){if(data.public==='visible')throw Error('configured outline must not call hook');return [{id:'old-child',label:'(2)'}];},"));
        fixture.start(null); JsonNode overview = fixture.get("/api/collections/bank/bank").body();
        assertEquals("三", overview.at("/questions/0/outlineLabel").asText()); assertFalse(overview.path("questions").get(0).has("outlineItems"));
        assertEquals("old-child", overview.at("/questions/1/outlineItems/0/id").asText()); assertFalse(overview.path("questions").get(1).has("outlineLabel"));
        assertEquals(2, overview.path("states").size());
    }

    @Test void explicitPartsNeedOnlyNavigationCapabilityAndNeverRunOptionalGenerationHook() throws Exception {
        declared(); ObjectNode bank = read("question-banks/bank.json");
        ((ObjectNode) bank.path("questions").get(0)).set("outline", partsOutline());
        ((ObjectNode) bank.path("questions").get(1)).set("outline", questionOutline("二")); bankAndExamples(bank);
        String runner = Files.readString(root.resolve("server/rules-runner.cjs"));
        fixture.write("server/rules-runner.cjs", runner.replace("const request = JSON.parse(input);", "const request = JSON.parse(input);if(request.op==='outlineBatch')throw Error('explicit outline cannot generate from rules');"));
        fixture.start(null); var reply = fixture.get("/api/collections/bank/bank"); assertEquals(200, reply.status(), reply.body().toString());
        assertEquals(partsOutline().path("items"), reply.body().at("/questions/0/outlineItems"));
        assertFalse(reply.body().path("questions").get(0).has("outlineLabel")); assertEquals("二", reply.body().at("/questions/1/outlineLabel").asText());
        assertFalse(reply.body().toString().contains("answer-secret")); assertEquals(2, reply.body().path("states").size());
    }

    @Test void ordinaryLegacyApiQuestionCanUseAnExplicitParentLabel() throws Exception {
        ObjectNode bank = read("question-banks/bank.json"); ((ObjectNode) bank.path("questions").get(0)).set("outline", questionOutline("1.1"));
        fixture.write("question-banks/bank.json", bank.toString()); fixture.start(null);
        JsonNode overview = fixture.get("/api/collections/bank/bank").body(); assertEquals("1.1", overview.at("/questions/0/outlineLabel").asText());
        assertFalse(overview.path("questions").get(1).has("outlineLabel")); assertFalse(overview.path("questions").get(1).has("outlineItems"));
    }

    @Test void invalidConfigurationsAreRejectedWithoutWritingBankOrState() throws Exception {
        declared(); ObjectNode template = read("question-banks/bank.json"); Library library = library();
        for (String invalid : List.of("null", "{}", "[]", "{\"level\":\"both\",\"label\":\"1\"}",
                "{\"level\":\"question\",\"label\":\"1\",\"items\":[]}", "{\"level\":\"question\",\"items\":[]}",
                "{\"level\":\"question\",\"label\":\"\"}", "{\"level\":\"question\",\"label\":\"<b>1</b>\"}",
                "{\"level\":\"question\",\"label\":\" 1\"}", "{\"level\":\"parts\",\"items\":[]}",
                "{\"level\":\"parts\",\"items\":[{\"id\":\"same\",\"label\":\"1\"},{\"id\":\"same\",\"label\":\"2\"}]}",
                "{\"level\":\"parts\",\"items\":[{\"id\":\"x\",\"label\":\"1\",\"type\":\"other\"}]}",
                "{\"level\":\"parts\",\"items\":[{\"id\":\"x\",\"label\":\"1\"}],\"label\":\"三\"}")) {
            ObjectNode bank = template.deepCopy(); ((ObjectNode) bank.path("questions").get(0)).set("outline", Json.MAPPER.readTree(invalid));
            fixture.write("question-banks/bank.json", bank.toString()); byte[] before = Files.readAllBytes(root.resolve("question-banks/bank.json"));
            assertEquals("INVALID_OUTLINE_ITEMS", library.catalog().at("/banks/0/errorCode").asText(), invalid);
            assertArrayEquals(before, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        }
        ObjectNode tooMany = template.deepCopy(), outline = partsOutline(); ArrayNode items = outline.putArray("items");
        for (int i = 0; i < 101; i++) items.addObject().put("id", "p" + i).put("label", String.valueOf(i));
        ((ObjectNode) tooMany.path("questions").get(0)).set("outline", outline); fixture.write("question-banks/bank.json", tooMany.toString());
        assertEquals("INVALID_OUTLINE_ITEMS", library.catalog().at("/banks/0/errorCode").asText());
        assertFalse(Files.exists(root.resolve(".state")));
    }

    @Test void partsWithoutDeclaredCapabilityFailButDoNotRequireAGenerationHook() throws Exception {
        ObjectNode bank = read("question-banks/bank.json"); ((ObjectNode) bank.path("questions").get(0)).set("outline", partsOutline());
        fixture.write("question-banks/bank.json", bank.toString());
        assertEquals("OUTLINE_CAPABILITY_REQUIRED", library().catalog().at("/banks/0/errorCode").asText());
        declared(); assertEquals(2, library().collection("bank", "bank").question("q1").outlineItems().size());
    }

    @Test void mixedQuestionOwnersKeepExplicitEntriesInQuestionOrder() throws Exception {
        Path source = root.resolve("extensions/generic"), target = root.resolve("extensions/plain");
        try (var paths = Files.walk(source)) { for (Path file : paths.toList()) { Path copy = target.resolve(source.relativize(file)); if (Files.isDirectory(file)) Files.createDirectories(copy); else Files.copy(file, copy); } }
        ObjectNode manifest = read("extensions/plain/manifest.json"); manifest.put("id", "plain"); fixture.write("extensions/plain/manifest.json", manifest.toString());
        ObjectNode examples = read("extensions/plain/examples.json"); ((ObjectNode) examples.path("extension")).put("id", "plain"); fixture.write("extensions/plain/examples.json", examples.toString());
        declared(); ObjectNode bank = read("question-banks/bank.json");
        ((ObjectNode) bank.path("questions").get(0)).set("outline", partsOutline());
        ObjectNode second = (ObjectNode) bank.path("questions").get(1); second.putObject("extension").put("id", "plain").put("version", "1.0.0"); second.set("outline", questionOutline("四"));
        fixture.write("question-banks/bank.json", bank.toString()); fixture.start(null); JsonNode overview = fixture.get("/api/collections/bank/bank").body();
        assertTrue(overview.path("extension").isNull()); assertEquals("q1", overview.at("/questions/0/id").asText()); assertEquals("q2", overview.at("/questions/1/id").asText());
        assertEquals("generic", overview.at("/questions/0/type/id").asText()); assertEquals("plain", overview.at("/questions/1/type/id").asText());
        assertEquals(partsOutline().path("items"), overview.at("/questions/0/outlineItems")); assertEquals("四", overview.at("/questions/1/outlineLabel").asText());
    }

    @Test void layoutChangesPreserveAnswersAndFingerprintsWhileHistoryFreezesOriginalOutline() throws Exception {
        declared(); ObjectNode bank = read("question-banks/bank.json");
        ((ObjectNode) bank.path("questions").get(0)).set("outline", partsOutline()); ((ObjectNode) bank.path("questions").get(1)).set("outline", questionOutline("二")); bankAndExamples(bank);
        Library library = library(); Library.Collection before = library.collection("bank", "bank"); fixture.start(null);
        assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("outline-bank-submit", 0, "submit", fixture.answer("yes"))).status());
        JsonNode payload = fixture.get(ServerTest.QUESTION).body(), overview = fixture.get("/api/collections/bank/bank").body();
        String historyId = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText(), historyPath = "/api/collections/bank/bank/history/" + historyId;
        JsonNode history = fixture.get(historyPath).body(); byte[] stateBefore = Files.readAllBytes(fixture.savedFile());
        ((ObjectNode) bank.path("questions").get(0)).set("outline", questionOutline("阅读三")); ((ObjectNode) bank.path("questions").get(1)).remove("outline");
        fixture.write("question-banks/bank.json", bank.toString()); Library.Collection after = library.collection("bank", "bank");
        assertEquals(before.extensionFingerprint(), after.extensionFingerprint()); assertEquals(before.question("q1").fingerprint(), after.question("q1").fingerprint());
        JsonNode current = fixture.get("/api/collections/bank/bank").body(); assertEquals("阅读三", current.at("/questions/0/outlineLabel").asText()); assertFalse(current.path("questions").get(0).has("outlineItems"));
        assertEquals(overview.path("states"), current.path("states")); assertEquals(payload, fixture.get(ServerTest.QUESTION).body());
        assertEquals(history, fixture.get(historyPath).body()); assertArrayEquals(stateBefore, Files.readAllBytes(fixture.savedFile()));
        assertEquals(200, fixture.post("/api/collections/bank/bank/questions/q2/actions", fixture.action("outline-bank-next", 0, "submit", fixture.answer("no"))).status());
        JsonNode updatedHistory = fixture.get(historyPath).body(); assertEquals(partsOutline().path("items"), updatedHistory.at("/collection/questions/0/outlineItems")); assertEquals("二", updatedHistory.at("/collection/questions/1/outlineLabel").asText());
        assertEquals(2, updatedHistory.path("submittedCount").asInt());
        fixture.server.close(); fixture.server = null; fixture.start(null); assertEquals(updatedHistory, fixture.get(historyPath).body());
    }

    @Test void editingDataAndTitlePreservesExplicitConfigurationInsteadOfRegeneratingIt() throws Exception {
        declared(); ObjectNode bank = read("question-banks/bank.json"); ((ObjectNode) bank.path("questions").get(0)).set("outline", partsOutline()); bankAndExamples(bank);
        fixture.write("extensions/generic/rules.js", originalRules.replace("QF.defineType({", "QF.defineType({getOutlineItems(){return [{id:'rule-generated',label:'different'}];},"));
        fixture.start(null); JsonNode editor = fixture.get(ServerTest.QUESTION + "/editor").body(); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "Edited statement");
        var saved = fixture.post(ServerTest.QUESTION + "/edit", fixture.editRequest("explicit-outline-edit", editor, "Edited title", data)); assertEquals(200, saved.status(), saved.body().toString());
        ObjectNode persisted = read("question-banks/bank.json"); assertEquals(partsOutline(), persisted.at("/questions/0/outline")); assertEquals(bank.at("/questions/1"), persisted.at("/questions/1"));
        assertEquals(partsOutline().path("items"), saved.body().at("/collection/questions/0/outlineItems")); assertEquals("rule-generated", saved.body().at("/collection/questions/1/outlineItems/0/id").asText());
        assertEquals("Edited statement", persisted.at("/questions/0/data/public").asText());
    }

    @Test void frozenParentLabelsAreValidatedAndRemainExclusiveFromChildEntries() throws Exception {
        ObjectNode bank = read("question-banks/bank.json"); ((ObjectNode) bank.path("questions").get(0)).set("outline", questionOutline("三")); fixture.write("question-banks/bank.json", bank.toString());
        fixture.start(null); assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("frozen-label-submit", 0, "submit", fixture.answer("yes"))).status());
        ObjectNode original = (ObjectNode) readState().path("historyRounds").get(0); assertDoesNotThrow(() -> HistoryRounds.validate(original));
        for (String invalid : List.of("", "<b>1</b>", " 1", "1\n", "x".repeat(81))) {
            ObjectNode record = original.deepCopy(); ((ObjectNode) record.at("/collection/questions/0")).put("outlineLabel", invalid);
            assertThrows(IOException.class, () -> HistoryRounds.validate(record), invalid);
        }
        ObjectNode both = original.deepCopy(); ((ObjectNode) both.at("/collection/questions/0")).set("outlineItems", partsOutline().path("items")); assertThrows(IOException.class, () -> HistoryRounds.validate(both));
        ObjectNode old = original.deepCopy(); ((ObjectNode) old.at("/collection/questions/0")).remove("outlineLabel"); assertDoesNotThrow(() -> HistoryRounds.validate(old));
    }
    ObjectNode readState() throws Exception { return (ObjectNode) Json.read(fixture.savedFile(), 32 * 1024 * 1024); }
}
