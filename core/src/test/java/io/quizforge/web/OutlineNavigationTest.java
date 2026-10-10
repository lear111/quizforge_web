package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class OutlineNavigationTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    String originalRules;
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); originalRules = Files.readString(root.resolve("extensions/generic/rules.js")); }
    @AfterEach void close() { fixture.close(); }
    ObjectNode read(String path) throws Exception { return (ObjectNode) Json.read(root.resolve(path), 8 * 1024 * 1024); }
    Library library() throws Exception { return new Library(root, new RuleEngine(root, "node", Duration.ofSeconds(8))); }
    void declared() throws Exception {
        ObjectNode manifest = read("extensions/generic/manifest.json"); manifest.putObject("requiresApi").put("major", 1).put("minMinor", 1).putArray("capabilities").add("practice").add("score").add("outline-items");
        fixture.write("extensions/generic/manifest.json", manifest.toString());
    }
    void hook(String expression) throws Exception {
        fixture.write("extensions/generic/rules.js", originalRules.replace("QF.defineType({", "QF.defineType({getOutlineItems(data){return " + expression + ";},"));
    }
    void composite() throws Exception {
        declared(); ObjectNode schema = read("extensions/generic/question.json"); ((ObjectNode) schema.path("properties")).set("sections", Json.object().put("type", "array").set("items", Json.object().put("type", "object")));
        fixture.write("extensions/generic/question.json", schema.toString());
        ObjectNode bank = read("question-banks/bank.json"); ArrayNode sections = ((ObjectNode) bank.at("/questions/0/data")).putArray("sections");
        sections.addObject().put("id", "read-2").put("label", "(2)").put("secret", "private-child-answer"); sections.addObject().put("id", "read-1").put("label", "(1)");
        sections.addObject().put("id", "读写题").put("label", "补充题");
        fixture.write("question-banks/bank.json", bank.toString()); bank.put("id", "examples"); fixture.write("extensions/generic/examples.json", bank.toString());
        hook("(data.sections||[]).map(item=>({id:item.id,label:item.label}))");
    }
    @Test void orderedMetadataIsCachedAndHistoryFreezesItWithoutCreatingChildAnswersOrScores() throws Exception {
        composite(); byte[] bankBefore = Files.readAllBytes(root.resolve("question-banks/bank.json")); fixture.start(null);
        JsonNode overview = fixture.get("/api/collections/bank/bank").body();
        assertEquals(2, overview.path("questions").size()); assertTrue(overview.path("states").has("q1")); assertTrue(overview.path("states").has("q2"));
        assertEquals(2, overview.path("states").size()); assertFalse(overview.path("states").has("read-2"));
        assertEquals("read-2", overview.at("/questions/0/outlineItems/0/id").asText()); assertEquals("read-1", overview.at("/questions/0/outlineItems/1/id").asText());
        assertEquals("读写题", overview.at("/questions/0/outlineItems/2/id").asText()); assertFalse(overview.path("questions").get(1).has("outlineItems")); assertFalse(overview.toString().contains("private-child-answer"));
        String runner = Files.readString(root.resolve("server/rules-runner.cjs")); fixture.write("server/rules-runner.cjs", runner.replace("const request = JSON.parse(input);", "const request = JSON.parse(input); if(request.op==='outlineBatch')throw Error('outline must be cached');"));
        assertEquals(overview, fixture.get("/api/collections/bank/bank").body());
        assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("outline-submit", 0, "submit", fixture.answer("yes"))).status());
        JsonNode summary = fixture.get("/api/collections/bank/bank/summary").body(); assertEquals(2, summary.path("questionCount").asInt()); assertEquals(1, summary.path("score").asInt()); assertEquals(2, summary.path("maxScore").asInt());
        fixture.finishCurrent("outline-finish"); String id = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText(); String historyPath = "/api/collections/bank/bank/history/" + id;
        JsonNode history = fixture.get(historyPath).body(); assertEquals(overview.at("/questions/0/outlineItems"), history.at("/collection/questions/0/outlineItems"));
        assertEquals(2, history.path("questions").size()); assertEquals(2, history.path("questionCount").asInt()); assertEquals(1, history.path("submittedCount").asInt());
        assertEquals(ExtensionApi.version(), history.at("/page/apiVersion")); byte[] stateBefore = Files.readAllBytes(fixture.savedFile()); fixture.server.close(); fixture.server = null;
        Files.delete(root.resolve("extensions/generic/rules.js")); fixture.write("server/rules-runner.cjs", "process.exit(2);"); fixture.start(null);
        assertEquals(history, fixture.get(historyPath).body()); assertArrayEquals(stateBefore, Files.readAllBytes(fixture.savedFile())); assertArrayEquals(bankBefore, Files.readAllBytes(root.resolve("question-banks/bank.json")));
    }
    @Test void missingOptionalHookAndUnchangedLegacyPackagesKeepTheirOriginalRows() throws Exception {
        Library old = library(); Library.Collection baseline = old.collection("bank", "bank"); assertTrue(baseline.questions().stream().allMatch(question -> question.outlineItems().isEmpty()));
        declared(); Library.Collection opted = library().collection("bank", "bank"); assertTrue(opted.questions().stream().allMatch(question -> question.outlineItems().isEmpty()));
        fixture.start(null); JsonNode overview = fixture.get("/api/collections/bank/bank").body(); for (JsonNode row : overview.path("questions")) assertFalse(row.has("outlineItems"));
    }
    @Test void undeclaredHookAndInvalidItemsAreRejectedBeforePublishingCollectionMetadata() throws Exception {
        hook("[{id:'part',label:'(1)'}]"); assertEquals("INVALID_OUTLINE_ITEMS", library().catalog().at("/extensions/0/errorCode").asText()); declared();
        Library library = library();
        for (String invalid : List.of("null", "{}", "[{id:'same',label:'1'},{id:'same',label:'2'}]", "[{id:'x',label:'<b>1</b>'}]", "[{id:' x',label:'1'}]", "[{id:'x',label:'1',extra:true}]", "[{id:'x',label:'\\n'}]", "[{id:'x'.repeat(129),label:'1'}]", "[{id:'x',label:'1'.repeat(81)}]", "Array.from({length:101},(_,i)=>({id:String(i),label:'1'}))", "undefined")) {
            hook(invalid); assertEquals("INVALID_OUTLINE_ITEMS", library.catalog().at("/extensions/0/errorCode").asText(), invalid);
        }
    }
    @Test void mixedCollectionMetadataRemainsWithItsParentAndFrozenPages() throws Exception {
        Path source = root.resolve("extensions/generic"), target = root.resolve("extensions/plain");
        try (var paths = Files.walk(source)) { for (Path file : paths.toList()) { Path copy = target.resolve(source.relativize(file)); if (Files.isDirectory(file)) Files.createDirectories(copy); else Files.copy(file, copy); } }
        ObjectNode plainManifest = read("extensions/plain/manifest.json"); plainManifest.put("id", "plain"); fixture.write("extensions/plain/manifest.json", plainManifest.toString());
        ObjectNode plainExamples = read("extensions/plain/examples.json"); ((ObjectNode) plainExamples.path("extension")).put("id", "plain"); fixture.write("extensions/plain/examples.json", plainExamples.toString());
        composite(); ObjectNode bank = read("question-banks/bank.json"); ((ObjectNode) bank.path("questions").get(1)).putObject("extension").put("id", "plain").put("version", "1.0.0"); fixture.write("question-banks/bank.json", bank.toString());
        fixture.start(null); JsonNode overview = fixture.get("/api/collections/bank/bank").body(); assertTrue(overview.path("extension").isNull());
        assertEquals(3, overview.at("/questions/0/outlineItems").size()); assertFalse(overview.path("questions").get(1).has("outlineItems"));
        JsonNode editor = fixture.get(ServerTest.QUESTION + "/editor").body(); ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); ((ObjectNode) data.path("sections").get(0)).put("label", "改后 (2)");
        var saved = fixture.post(ServerTest.QUESTION + "/edit", fixture.editRequest("outline-edit", editor, "Edited composite", data)); assertEquals(200, saved.status(), saved.body().toString());
        assertEquals("改后 (2)", saved.body().at("/collection/questions/0/outlineItems/0/label").asText());
        overview = fixture.get("/api/collections/bank/bank").body(); assertEquals(saved.body().path("collection"), overview); assertEquals(2, overview.path("states").size());
        assertEquals(200, fixture.post(ServerTest.QUESTION + "/actions", fixture.action("mixed-outline", saved.body().at("/payload/stamp/revision").asInt(), "submit", fixture.answer("yes"))).status());
        String id = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText(); JsonNode history = fixture.get("/api/collections/bank/bank/history/" + id).body();
        assertEquals(2, history.path("pages").size()); assertEquals(overview.at("/questions/0/outlineItems"), history.at("/collection/questions/0/outlineItems")); assertEquals(2, history.path("questions").size());
    }
    @Test void maximumUnicodeItemsAcrossTwentyFiveParentsAreSafelyChunked() throws Exception {
        declared(); hook("Array.from({length:100},(_,i)=>({id:String(i).padStart(3,'0')+'题'.repeat(125),label:'题'.repeat(80)}))");
        ObjectNode bank = read("question-banks/bank.json"); ObjectNode template = (ObjectNode) bank.path("questions").get(0); ArrayNode questions = bank.putArray("questions");
        for (int i = 0; i < 25; i++) questions.add(template.deepCopy().put("id", "q" + i)); fixture.write("question-banks/bank.json", bank.toString());
        Library.Collection collection = library().collection("bank", "bank"); assertEquals(25, collection.questions().size()); assertTrue(collection.questions().stream().allMatch(question -> question.outlineItems().size() == 100));
    }
    @Test void plainTextBoundsAndAggregateBudgetRejectUnsafeMetadataWithoutTruncation() throws Exception {
        assertEquals(OutlineItems.MAX_BYTES, OutlineItems.addBytes(OutlineItems.MAX_BYTES - 1, 1)); assertEquals("INVALID_OUTLINE_ITEMS", assertThrows(ApiException.class, () -> OutlineItems.addBytes(OutlineItems.MAX_BYTES, 1)).code);
        for (String invalid : List.of("\u00a0x", "x\u202f", "\ufeffx", "x\u0085")) {
            ArrayNode items = Json.MAPPER.createArrayNode(); items.addObject().put("id", invalid).put("label", "1"); assertEquals("INVALID_OUTLINE_ITEMS", assertThrows(ApiException.class, () -> OutlineItems.read(items)).code);
        }
        ArrayNode valid = Json.MAPPER.createArrayNode(); valid.addObject().put("id", "题号 1").put("label", "(1)"); assertEquals("题号 1", OutlineItems.read(valid).get(0).id());
    }
}
