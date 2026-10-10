package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP workflows: presentation edits keep practice; incomplete grading never commits. */
class DevelopmentRuntimeWorkflowTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    static final String SAMPLE = "/api/collections/development/work-dev";
    static final String QUESTION = SAMPLE + "/questions/q1";

    @BeforeEach void prepare() throws Exception {
        fixture.root = root; fixture.prepare();
        Path original = root.resolve("extensions/generic"), copyRoot = root.resolve("extensions/work-dev");
        try (var paths = Files.walk(original)) {
            for (Path file : paths.toList()) {
                Path copy = copyRoot.resolve(original.relativize(file));
                if (Files.isDirectory(file)) Files.createDirectories(copy); else Files.copy(file, copy);
            }
        }
        ObjectNode manifest = (ObjectNode) Json.read(copyRoot.resolve("manifest.json"), 256 * 1024);
        manifest.put("version", "1.1.0"); fixture.write("extensions/work-dev/manifest.json", manifest.toString());
        ObjectNode examples = (ObjectNode) Json.read(copyRoot.resolve("examples.json"), 8 * 1024 * 1024);
        ((ObjectNode) examples.path("extension")).put("version", "1.1.0");
        fixture.write("extensions/work-dev/examples.json", examples.toString());
        fixture.write("extensions/work-dev/development.json", "{}");
    }

    @AfterEach void close() { fixture.close(); }
    void start() throws Exception {
        fixture.start(null);
        var enabled = fixture.call("PUT", "/api/settings/development", "{\"enabled\":true}", null,
                "http://127.0.0.1:" + fixture.server.port());
        assertEquals(200, enabled.status(), enabled.body().toString());
    }
    JsonNode get(String path) throws Exception {
        var reply = fixture.get(path); assertEquals(200, reply.status(), reply.body().toString()); return reply.body();
    }
    JsonNode act(String path, String id, long revision, String action, JsonNode data) throws Exception {
        var reply = fixture.post(path + "/actions", fixture.action(id, revision, action, data));
        assertEquals(200, reply.status(), reply.body().toString()); return reply.body();
    }
    Map<String, byte[]> formalFiles() throws Exception {
        var files = new HashMap<String, byte[]>();
        try (var paths = Files.walk(root.resolve("extensions/generic"))) {
            for (Path file : paths.filter(Files::isRegularFile).toList()) files.put(file.toString(), Files.readAllBytes(file));
        }
        files.put("bank", Files.readAllBytes(root.resolve("question-banks/bank.json"))); return files;
    }

    @Test void layoutRefreshKeepsSavedAnswerInkAndFrozenHistoryWhileRuleChangeInvalidatesCurrentPractice() throws Exception {
        var originals = formalFiles(); start();
        JsonNode formal = act(ServerTest.QUESTION, "formal-before-development", 0, "submit", fixture.answer("yes"));
        ObjectNode ink = Json.object().set("draft", Json.MAPPER.readTree("""
                {"schemaVersion":1,"viewport":{"x":24,"y":8,"zoom":1.2},"strokes":[],"paper":{"color":"#ffffff","pattern":"plain"}}
                """));
        act(QUESTION, "development-ink", 0, "whiteboard", ink);
        JsonNode saved = act(QUESTION, "development-submit", 1, "submit", fixture.answer("yes"));
        String historyId = get(SAMPLE + "/history").at("/records/0/id").asText();
        assertFalse(historyId.isBlank()); JsonNode frozen = get(SAMPLE + "/history/" + historyId);
        String beforeRefresh = get("/api/development/extensions/work-dev/revision").path("revision").asText();

        fixture.write("extensions/work-dev/page.css", "article{color:#987654;padding:12px}");
        fixture.write("extensions/work-dev/page.js", "QF.page.register({onLoad(){document.body.dataset.layout='updated'}})");
        assertNotEquals(beforeRefresh, get("/api/development/extensions/work-dev/revision").path("revision").asText());
        JsonNode afterLayout = get(QUESTION);
        assertEquals(saved.path("state"), afterLayout.path("state"));
        assertEquals(ink.path("draft"), afterLayout.path("draft"));
        assertEquals(frozen, get(SAMPLE + "/history/" + historyId));
        assertEquals(formal.path("state"), get(ServerTest.QUESTION).path("state"));

        Path rules = root.resolve("extensions/work-dev/rules.js");
        fixture.write("extensions/work-dev/rules.js", Files.readString(rules).replace("maxScore:1", "maxScore:2"));
        assertEquals("unanswered", get(QUESTION).at("/state/status").asText());
        JsonNode interrupted = get(SAMPLE + "/history/" + historyId);
        assertEquals("interrupted", interrupted.path("status").asText());
        assertEquals("development-content-edited", interrupted.path("interruptionReason").asText());
        assertEquals(frozen.path("id"), interrupted.path("id"));
        assertEquals(frozen.path("questions"), interrupted.path("questions"));
        assertEquals(frozen.path("page"), interrupted.path("page"));
        assertEquals(frozen.path("collection"), interrupted.path("collection"));
        assertEquals(formal.path("state"), get(ServerTest.QUESTION).path("state"));
        for (var file : originals.entrySet()) assertArrayEquals(file.getValue(), file.getKey().equals("bank")
                ? Files.readAllBytes(root.resolve("question-banks/bank.json")) : Files.readAllBytes(Path.of(file.getKey())));
    }

    @Test void addingRealGradeAfterAnUnfinishedAttemptCreatesOnlyOneRealHistoryRound() throws Exception {
        String originalRules = Files.readString(root.resolve("extensions/work-dev/rules.js"));
        fixture.write("extensions/work-dev/rules.js", "QF.defineType({project(data){return {public:data.public};},getScore(){return {score:0,maxScore:1};}});");
        start(); JsonNode visible = get(QUESTION); assertEquals("visible", visible.at("/question/data/public").asText());
        var rejected = fixture.post(QUESTION + "/actions", fixture.action("unfinished-submit", 0, "submit", fixture.answer("yes")));
        assertEquals(422, rejected.status(), rejected.body().toString());
        assertEquals("DEVELOPMENT_NOT_IMPLEMENTED", rejected.body().at("/error/code").asText());
        assertEquals("unanswered", get(QUESTION).at("/state/status").asText());
        assertEquals(0, get(SAMPLE + "/history").path("records").size());
        assertEquals(200, fixture.get(ServerTest.QUESTION).status(), "An unfinished development extension cannot break a formal bank.");

        fixture.write("extensions/work-dev/rules.js", originalRules);
        JsonNode submitted = act(QUESTION, "finished-real-submit", 0, "submit", fixture.answer("yes"));
        assertEquals(1, submitted.at("/state/result/score").asInt());
        assertEquals(1, get(SAMPLE + "/history").path("records").size());
    }
}
