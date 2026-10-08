package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

class ServerTest {
    @TempDir Path root;
    QuizForgeServer server;
    final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    static final String QUESTION = "/api/collections/bank/bank/questions/q1";
    static final String TOKEN = "test-token-at-least-16-characters";
    record Reply(int status, JsonNode body, HttpResponse<String> response) { }
    @BeforeEach void prepare() throws IOException {
        Files.createDirectories(root.resolve("server")); Files.copy(Path.of("server/rules-runner.cjs"), root.resolve("server/rules-runner.cjs"));
        for (String dependency : java.util.List.of("ajv", "fast-uri", "fast-deep-equal", "json-schema-traverse", "require-from-string")) {
            try (var paths = Files.walk(Path.of("node_modules", dependency))) { for (Path path : paths.toList()) { Path target = root.resolve(path); if (Files.isDirectory(path)) Files.createDirectories(target); else Files.copy(path, target); } }
        }
        Files.createDirectories(root.resolve("extensions/generic")); Files.createDirectories(root.resolve("question-banks")); Files.createDirectories(root.resolve("web"));
        write("web/index.html", "<!doctype html><title>QuizForge test</title>"); write("web/app.js", "console.log('test');");
        write("extensions/generic/manifest.json", """
                {"id":"generic","version":"1.0.0","name":"Generic type","description":"Tests","entry":"page.html","script":"page.js","style":"page.css","rules":"rules.js","questionSchema":"question.json","answerSchema":"answer.json","examples":"examples.json"}
                """);
        write("extensions/generic/page.html", "<article>Example</article>"); write("extensions/generic/page.js", "QF.page.register({onLoad(){}})"); write("extensions/generic/page.css", "article{color:#123}");
        write("extensions/generic/question.json", """
                {"type":"object","required":["public","secret","expected"],"additionalProperties":false,"properties":{"public":{"type":"string"},"secret":{"type":"string"},"expected":{"type":"string"}}}
                """);
        write("extensions/generic/answer.json", """
                {"type":"object","required":["value"],"additionalProperties":false,"properties":{"value":{"type":"string","maxLength":50}}}
                """);
        write("extensions/generic/rules.js", """
                QF.defineType({
                  project(data,state){return state.submitted ? {public:data.public,reveal:data.secret} : {public:data.public};},
                  validateQuestion(data){return data.public.length > 0;},
                  validateAnswer(answer,data){return answer.value !== 'invalid';},
                  getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:1};},
                  grade(data,answer){const correct=answer.value===data.expected;return {score:correct?1:0,maxScore:1,correct,feedback:correct?'right':'wrong'};}
                });
                """);
        String bank = """
                {"id":"bank","title":"Test bank","extension":{"id":"generic","version":"1.0.0"},"questions":[{"id":"q1","title":"Question 1","data":{"public":"visible","secret":"answer-secret","expected":"yes"}},{"id":"q2","title":"Question 2","data":{"public":"other","secret":"second-secret","expected":"no"}}]}
                """;
        write("question-banks/bank.json", bank); write("extensions/generic/examples.json", bank.replace("\"id\":\"bank\"", "\"id\":\"examples\""));
    }
    @AfterEach void close() { if (server != null) server.close(); }
    void start(String token) throws IOException { server = new QuizForgeServer(root, "127.0.0.1", 0, token, "node"); server.start(); }
    void write(String relative, String value) throws IOException { Files.writeString(root.resolve(relative), value); }
    Reply get(String path) throws Exception { return call("GET", path, null, null, null); }
    Reply post(String path, JsonNode body) throws Exception { return call("POST", path, body.toString(), null, "http://127.0.0.1:" + server.port()); }
    Reply delete(String path) throws Exception { return call("DELETE", path, null, null, "http://127.0.0.1:" + server.port()); }
    Reply call(String method, String path, String body, String token, String origin) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + path)).timeout(Duration.ofSeconds(15));
        if (token != null) builder.header("X-QuizForge-Token", token); if (origin != null) builder.header("Origin", origin);
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode parsed = response.headers().firstValue("Content-Type").orElse("").startsWith("application/json") ? Json.MAPPER.readTree(response.body()) : null;
        return new Reply(response.statusCode(), parsed, response);
    }
    ObjectNode action(String id, long revision, String name, JsonNode data) { ObjectNode body = Json.object().put("requestId", id).put("revision", revision).put("action", name); body.set("data", data); return body; }
    ObjectNode answer(String value) { ObjectNode data = Json.object(); data.set("answer", Json.object().put("value", value)); return data; }
    void finishCurrent(String requestId) throws Exception {
        JsonNode summary = get("/api/collections/bank/bank/summary").body;
        ObjectNode request = Json.object().put("requestId", requestId).put("summaryVersion", summary.path("summaryVersion").asText()); request.set("roundId", summary.path("roundId"));
        assertEquals(200, post("/api/collections/bank/bank/finish", request).status);
    }
    @Test void actionRevisionReplayProjectionAndRestartPersistence() throws Exception {
        start(null); Reply first = get(QUESTION); assertEquals(200, first.status); assertEquals("unanswered", first.body.at("/state/status").asText()); assertFalse(first.body.path("question").path("data").has("secret")); assertFalse(first.body.toString().contains("answer-secret"));
        ObjectNode draft = action("draft-0001", 0, "draft", answer("yes")); Reply saved = post(QUESTION + "/actions", draft); assertEquals(200, saved.status); assertEquals(1, saved.body.at("/state/revision").asLong()); assertEquals("draft", saved.body.at("/state/status").asText());
        ObjectNode submit = action("submit-001", 1, "submit", answer("yes")); Reply submitted = post(QUESTION + "/actions", submit); assertEquals(200, submitted.status); assertEquals("submitted", submitted.body.at("/state/status").asText()); assertEquals(1, submitted.body.at("/state/result/score").asInt()); assertEquals("answer-secret", submitted.body.at("/question/data/reveal").asText());
        assertEquals(submitted.body, post(QUESTION + "/actions", submit).body);
        assertEquals("REQUEST_ID_REUSED", post(QUESTION + "/actions", action("submit-001", 1, "submit", answer("no"))).body.at("/error/code").asText());
        Reply stale = post(QUESTION + "/actions", action("stale-0001", 1, "retry", Json.object())); assertEquals(409, stale.status); assertEquals("REVISION_CONFLICT", stale.body.at("/error/code").asText());
        ObjectNode whiteboard = (ObjectNode) Json.MAPPER.readTree("""
                {"schemaVersion":1,"viewport":{"x":3,"y":-4,"zoom":1.2},"strokes":[{"id":"stroke-1","color":"#123456","width":2,"points":[{"x":10,"y":20,"pressure":0.5}]}],"paper":{"color":"#ffffff","pattern":"grid"}}
                """);
        ObjectNode data = Json.object(); data.set("draft", whiteboard); Reply ink = post(QUESTION + "/actions", action("ink-00001", 2, "whiteboard", data)); assertEquals(200, ink.status); assertEquals(3, ink.body.at("/state/revision").asInt()); assertEquals(whiteboard, ink.body.get("draft"));
        assertEquals("unanswered", get("/api/collections/extension/generic/questions/q1").body.at("/state/status").asText());
        server.close(); server = null; start(null); Reply restored = get(QUESTION);
        ObjectNode priorData = ((ObjectNode) ink.body).deepCopy(), restoredData = ((ObjectNode) restored.body).deepCopy(); priorData.remove("stamp"); restoredData.remove("stamp");
        assertEquals(priorData, restoredData); assertNotEquals(ink.body.at("/stamp/contentVersion"), restored.body.at("/stamp/contentVersion"));
        assertNotEquals(ink.body.at("/stamp/packageVersion"), restored.body.at("/stamp/packageVersion")); assertEquals(restored.body.get("stamp"), get(QUESTION + "/stamp").body);
        assertEquals(submitted.body, post(QUESTION + "/actions", submit).body);
        Reply retry = post(QUESTION + "/actions", action("retry-001", 3, "retry", Json.object())); assertEquals(200, retry.status); assertEquals("unanswered", retry.body.at("/state/status").asText()); assertTrue(retry.body.at("/state/answer").isNull()); assertEquals(whiteboard, retry.body.get("draft")); assertFalse(retry.body.path("question").path("data").has("reveal"));
    }
    @Test void malformedEntriesAreIsolatedAndDirectoryRefreshIsLive() throws Exception {
        write("question-banks/broken.json", "{"); Files.createDirectories(root.resolve("extensions/unsafe")); write("extensions/unsafe/manifest.json", "{\"id\":\"unsafe\",\"version\":\"1\",\"entry\":\"../../question-banks/bank.json\"}");
        start(null); Reply catalog = get("/api/catalog"); assertEquals(200, catalog.status); assertEquals(2, catalog.body.path("banks").size()); assertTrue(catalog.body.path("banks").get(1).has("error")); assertEquals(200, get(QUESTION).status); assertTrue(catalog.body.path("extensions").get(1).has("error"));
        Files.delete(root.resolve("question-banks/broken.json")); assertEquals(1, get("/api/catalog").body.path("banks").size());
        write("question-banks/bank.json", Files.readString(root.resolve("question-banks/bank.json")).replace("\"visible\"", "13"));
        assertTrue(get("/api/catalog").body.path("banks").get(0).has("error")); assertEquals(404, get(QUESTION).status);
    }
    @Test void tokenOriginAssetsAndJsonAreGuarded() throws Exception {
        start(TOKEN); assertEquals(200, get("/").status); assertEquals(401, get("/api/health").status); assertEquals(200, call("GET", "/api/health", null, TOKEN, null).status);
        assertEquals(401, get(QUESTION + "/stamp").status);
        assertEquals(403, call("POST", QUESTION + "/actions", action("draft-001", 0, "draft", answer("yes")).toString(), TOKEN, "https://other.example").status);
        assertEquals(400, call("POST", QUESTION + "/actions", "{", TOKEN, "http://127.0.0.1:" + server.port()).status);
        assertEquals(400, call("POST", QUESTION + "/actions", "{} {}", TOKEN, null).status);
        for (String path : new String[]{"/question-banks/bank.json", "/extensions/generic/rules.js", "/.state/", "/%2e%2e/question-banks/bank.json", "/server/rules-runner.cjs"}) assertEquals(404, get(path).status, path);
        Reply assets = call("GET", "/api/extensions/generic/1.0.0/page", null, TOKEN, null); assertEquals(200, assets.status); assertEquals(4, assets.body.size()); assertEquals(ExtensionApi.version(), assets.body.path("apiVersion")); assertFalse(assets.body.toString().contains("grade("));
        assertEquals("no-store", assets.response.headers().firstValue("Cache-Control").orElse(""));
    }
    @Test void invalidAnswersAndWhiteboardDoNotChangeRevision() throws Exception {
        start(null);
        Reply rejected = post(QUESTION + "/actions", action("bad-00001", 0, "draft", answer("invalid"))); assertEquals(422, rejected.status);
        assertEquals(422, post(QUESTION + "/actions", action("bad-00002", 0, "submit", answer("invalid"))).status);
        ObjectNode data = Json.object(); data.set("draft", Json.MAPPER.readTree("{\"schemaVersion\":1,\"viewport\":{\"x\":0,\"y\":0,\"zoom\":100},\"strokes\":[],\"paper\":{\"color\":\"#ffffff\",\"pattern\":\"grid\"}}"));
        assertEquals(400, post(QUESTION + "/actions", action("bad-00003", 0, "whiteboard", data)).status); assertEquals(0, get(QUESTION).body.at("/state/revision").asLong());
    }
    @Test void concurrentWritesHaveOneWinner() throws Exception {
        start(null); get(QUESTION);
        var a = java.util.concurrent.CompletableFuture.supplyAsync(() -> { try { return post(QUESTION + "/actions", action("race-0001", 0, "draft", answer("yes"))); } catch (Exception e) { throw new RuntimeException(e); } });
        var b = java.util.concurrent.CompletableFuture.supplyAsync(() -> { try { return post(QUESTION + "/actions", action("race-0002", 0, "draft", answer("no"))); } catch (Exception e) { throw new RuntimeException(e); } });
        var statuses = java.util.List.of(a.get().status, b.get().status); assertTrue(statuses.contains(200)); assertTrue(statuses.contains(409)); assertEquals(1, get(QUESTION).body.at("/state/revision").asInt());
    }
    @Test void corruptStateIsPreservedAndReported() throws Exception {
        start(null); post(QUESTION + "/actions", action("save-0001", 0, "draft", answer("yes"))); server.close(); server = null;
        Path state; try (var files = Files.list(root.resolve(".state"))) { state = files.filter(p -> p.toString().endsWith(".json")).findFirst().orElseThrow(); } Files.writeString(state, "{");
        start(null); assertEquals(503, get(QUESTION).status); assertEquals("{", Files.readString(state));
    }
    @Test void ruleDeadlineAndLargeOutputFailWithoutWriting() throws Exception {
        String rules = Files.readString(root.resolve("extensions/generic/rules.js")); write("extensions/generic/rules.js", rules.replace("return state.submitted ?", "while(true){} return state.submitted ?"));
        start(null); long before = System.nanoTime(); Reply timeout = get(QUESTION); assertEquals(422, timeout.status); assertTrue(Duration.ofNanos(System.nanoTime() - before).toSeconds() < 10);
        write("extensions/generic/rules.js", rules.replace("{public:data.public};", "{public:'x'.repeat(2200000)};")); assertEquals(422, get(QUESTION).status);
        try (var files = Files.list(root.resolve(".state"))) { assertEquals(0, files.filter(Files::isRegularFile).count()); }
    }
    @Test void parentTerminatesStuckChildBoundsOutputAndDoesNotInheritSecrets() throws Exception {
        Path extensionDirectory = root.resolve("extensions/generic");
        Library.Extension extension = new Library.Extension("generic", "1.0.0", "Generic", "", extensionDirectory,
                extensionDirectory.resolve("page.html"), extensionDirectory.resolve("page.js"), extensionDirectory.resolve("page.css"), extensionDirectory.resolve("rules.js"), extensionDirectory.resolve("question.json"), extensionDirectory.resolve("answer.json"), extensionDirectory.resolve("examples.json"), "0".repeat(64));
        write("server/rules-runner.cjs", "setInterval(() => {}, 100);");
        RuleEngine timed = new RuleEngine(root, "node", Duration.ofMillis(400)); long start = System.nanoTime();
        ApiException timeout = assertThrows(ApiException.class, () -> timed.run(extension, Json.object())); assertEquals("RULE_TIMEOUT", timeout.code); assertTrue(Duration.ofNanos(System.nanoTime() - start).toSeconds() < 3);
        write("server/rules-runner.cjs", "process.stdout.write('x'.repeat(3*1024*1024));");
        RuleEngine bounded = new RuleEngine(root, "node", Duration.ofSeconds(4)); ApiException oversized = assertThrows(ApiException.class, () -> bounded.run(extension, Json.object())); assertEquals("RULE_OUTPUT_LIMIT", oversized.code);
        write("server/rules-runner.cjs", "const allow=['SYSTEMROOT','WINDIR','PATH','TEMP','TMP','COMSPEC','PATHEXT']; process.stdout.write(JSON.stringify({ok:true,data:{unexpected:Object.keys(process.env).filter(k=>!allow.includes(k.toUpperCase())).length}}));");
        assertEquals(0, bounded.run(extension, Json.object()).path("unexpected").asInt());
    }
    Path savedFile() throws IOException { try (var files = Files.list(root.resolve(".state"))) { return files.filter(p -> p.toString().endsWith(".json")).findFirst().orElseThrow(); } }
    @Test void changedQuestionRefusesStoredGradeAndReplayWithoutChangingStateBytes() throws Exception {
        start(null); ObjectNode submittedRequest = action("submit-001", 0, "submit", answer("yes")); Reply submitted = post(QUESTION + "/actions", submittedRequest); assertEquals(200, submitted.status);
        Path state = savedFile(); byte[] originalBytes = Files.readAllBytes(state);
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 1024 * 1024);
        ((ObjectNode) bank.path("questions").get(0)).put("title", "Renamed title"); bank.put("title", "Renamed bank");
        var questions = (com.fasterxml.jackson.databind.node.ArrayNode) bank.get("questions"); JsonNode first = questions.remove(0); questions.add(first); write("question-banks/bank.json", bank.toString());
        assertEquals(200, get(QUESTION).status); assertEquals(submitted.body.path("state"), get(QUESTION).body.path("state")); assertArrayEquals(originalBytes, Files.readAllBytes(state));
        ObjectNode raw = (ObjectNode) first.get("data"); raw.put("secret", "changed-answer-secret"); raw.put("expected", "no"); write("question-banks/bank.json", bank.toString());
        Reply changed = get(QUESTION); assertEquals(409, changed.status); assertEquals("COLLECTION_CHANGED", changed.body.at("/error/code").asText()); assertFalse(changed.body.toString().contains("changed-answer-secret"));
        assertEquals("COLLECTION_CHANGED", get(QUESTION + "/stamp").body.at("/error/code").asText());
        assertEquals(409, get("/api/collections/bank/bank").status); assertEquals(409, post(QUESTION + "/actions", submittedRequest).status); assertArrayEquals(originalBytes, Files.readAllBytes(state));
        assertFalse(get("/api/catalog").body.path("banks").get(0).has("error"));
        server.close(); server = null; start(null); assertEquals(409, get(QUESTION).status); assertArrayEquals(originalBytes, Files.readAllBytes(state));
    }
    @Test void sameVersionRulesSchemasAndPageChangesRefuseExistingState() throws Exception {
        start(null); assertEquals(200, post(QUESTION + "/actions", action("save-0001", 0, "draft", answer("yes"))).status); Path state = savedFile(); byte[] originalBytes = Files.readAllBytes(state);
        for (String asset : new String[]{"rules.js", "question.json", "answer.json", "page.js", "page.html", "page.css", "manifest.json"}) {
            Path path = root.resolve("extensions/generic/" + asset); String original = Files.readString(path); Files.writeString(path, original + "\n ");
            Reply changed = get(QUESTION); assertEquals(409, changed.status, asset); assertEquals("COLLECTION_CHANGED", changed.body.at("/error/code").asText()); assertArrayEquals(originalBytes, Files.readAllBytes(state));
            assertEquals(409, get(QUESTION + "/stamp").status, asset);
            Files.writeString(path, original); assertEquals(200, get(QUESTION).status, asset);
        }
    }
    @Test void legacyUnfingerprintedStateIsRefusedAndPreserved() throws Exception {
        start(null); assertEquals(200, post(QUESTION + "/actions", action("save-0001", 0, "draft", answer("yes"))).status); Path state = savedFile(); server.close(); server = null;
        ObjectNode legacy = (ObjectNode) Json.read(state, 1024 * 1024); legacy.remove("extensionFingerprint"); ((ObjectNode) legacy.path("questions").get("q1")).remove("fingerprint"); Files.writeString(state, legacy.toString()); byte[] legacyBytes = Files.readAllBytes(state);
        start(null); Reply refused = get(QUESTION); assertEquals(409, refused.status); assertEquals("COLLECTION_CHANGED", refused.body.at("/error/code").asText()); assertArrayEquals(legacyBytes, Files.readAllBytes(state));
    }
    @Test void cachedQuestionStampSkipsProjectionAndReportsGenericType() throws Exception {
        start(null); Reply full = get(QUESTION); assertEquals(200, full.status);
        Reply stamp = get(QUESTION + "/stamp"); assertEquals(200, stamp.status); assertEquals(full.body.get("stamp"), stamp.body); assertEquals(3, stamp.body.size());
        assertTrue(stamp.body.path("contentVersion").asText().matches("[a-f0-9]{64}")); assertFalse(stamp.body.toString().contains("answer-secret"));
        assertEquals("no-store", stamp.response.headers().firstValue("Cache-Control").orElse(""));
        JsonNode row = get("/api/collections/bank/bank").body.path("questions").get(0);
        assertEquals("generic", row.at("/type/id").asText()); assertEquals("1.0.0", row.at("/type/version").asText()); assertEquals("Generic type", row.at("/type/name").asText());
        assertEquals(stamp.body.path("packageVersion"), get("/api/collections/bank/bank/questions/q2/stamp").body.path("packageVersion"));
        assertEquals(stamp.body.path("packageVersion"), get("/api/collections/extension/generic/questions/q1/stamp").body.path("packageVersion"));
        write("server/rules-runner.cjs", "throw new Error('projection must not run for a warm stamp');");
        assertEquals(stamp.body, get(QUESTION + "/stamp").body); assertEquals(422, get(QUESTION).status);
    }
    @Test void questionStampsTrackWritesWithoutInvalidatingStaticContent() throws Exception {
        start(null); JsonNode original = get(QUESTION + "/stamp").body;
        String content = original.path("contentVersion").asText(), page = original.path("packageVersion").asText();
        String[] actions = {"draft", "submit", "retry"};
        for (int i = 0; i < actions.length; i++) {
            Reply saved = post(QUESTION + "/actions", action("cached-000" + i, i, actions[i], actions[i].equals("retry") ? Json.object() : answer("yes")));
            assertEquals(200, saved.status); assertEquals(i + 1, saved.body.at("/stamp/revision").asInt());
            assertEquals(content, saved.body.at("/stamp/contentVersion").asText()); assertEquals(page, saved.body.at("/stamp/packageVersion").asText());
            assertEquals(saved.body.get("stamp"), get(QUESTION + "/stamp").body);
        }
    }
    @Test void unsavedContentAndTitleChangesInvalidateOnlyRelevantCaches() throws Exception {
        start(null); JsonNode first = get(QUESTION + "/stamp").body;
        ObjectNode bank = (ObjectNode) Json.read(root.resolve("question-banks/bank.json"), 1024 * 1024);
        ((ObjectNode) bank.path("questions").get(1).path("data")).put("secret", "replacement-second-secret"); write("question-banks/bank.json", bank.toString());
        assertEquals(first, get(QUESTION + "/stamp").body);
        ((ObjectNode) bank.path("questions").get(0)).put("title", "A renamed unsaved question"); write("question-banks/bank.json", bank.toString());
        JsonNode renamed = get(QUESTION + "/stamp").body; assertNotEquals(first.path("contentVersion"), renamed.path("contentVersion")); assertEquals(first.path("packageVersion"), renamed.path("packageVersion"));
        ((ObjectNode) bank.path("questions").get(0).path("data")).put("secret", "replacement-answer-secret"); write("question-banks/bank.json", bank.toString());
        JsonNode changed = get(QUESTION + "/stamp").body; assertNotEquals(renamed.path("contentVersion"), changed.path("contentVersion")); assertEquals(0, changed.path("revision").asInt()); assertFalse(changed.toString().contains("replacement-answer-secret"));
        write("extensions/generic/page.css", "article{color:#456;background:#eee}");
        JsonNode packageChanged = get(QUESTION + "/stamp").body; assertNotEquals(changed.path("packageVersion"), packageChanged.path("packageVersion")); assertNotEquals(changed.path("contentVersion"), packageChanged.path("contentVersion"));
        assertEquals(packageChanged.path("packageVersion"), get("/api/collections/bank/bank/questions/q2/stamp").body.path("packageVersion"));
    }
    @Test void bankExtensionReferenceChangeReturnsAuthoritativePackageMetadata() throws Exception {
        start(null); Reply first = get(QUESTION); assertEquals("1.0.0", first.body.at("/extension/version").asText());
        Files.createDirectories(root.resolve("extensions/generic-v2"));
        try (var paths = Files.list(root.resolve("extensions/generic"))) {
            for (Path path : paths.toList()) write("extensions/generic-v2/" + path.getFileName(), Files.readString(path).replace("\"version\":\"1.0.0\"", "\"version\":\"2.0.0\""));
        }
        write("extensions/generic-v2/page.js", "QF.page.register({onLoad(){document.body.textContent='Version two';}})");
        write("question-banks/bank.json", Files.readString(root.resolve("question-banks/bank.json")).replace("\"version\":\"1.0.0\"", "\"version\":\"2.0.0\"").replace("\"visible\"", "\"version two visible\""));
        Reply changed = get(QUESTION); assertEquals(200, changed.status); assertEquals("generic", changed.body.at("/extension/id").asText()); assertEquals("2.0.0", changed.body.at("/extension/version").asText()); assertEquals("Generic type", changed.body.at("/extension/name").asText());
        assertEquals("version two visible", changed.body.at("/question/data/public").asText()); assertNotEquals(first.body.at("/stamp/packageVersion"), changed.body.at("/stamp/packageVersion"));
        assertTrue(get("/api/extensions/generic/2.0.0/page").body.path("script").asText().contains("Version two"));
        Reply saved = post(QUESTION + "/actions", action("version-002", 0, "draft", answer("yes"))); assertEquals(changed.body.path("extension"), saved.body.path("extension"));
    }
    @Test void staleContentWriteIsRefusedBeforeRulesAndReceiptReplaySurvivesRestart() throws Exception {
        start(null); String oldVersion = get(QUESTION + "/stamp").body.path("contentVersion").asText();
        write("question-banks/bank.json", Files.readString(root.resolve("question-banks/bank.json")).replace("\"visible\"", "\"new unsaved content\""));
        String newVersion = get(QUESTION + "/stamp").body.path("contentVersion").asText(); assertNotEquals(oldVersion, newVersion);
        ObjectNode staleRequest = action("content-001", 0, "draft", answer("invalid")); staleRequest.put("contentVersion", oldVersion);
        Reply stale = post(QUESTION + "/actions", staleRequest); assertEquals(409, stale.status); assertEquals("CONTENT_CONFLICT", stale.body.at("/error/code").asText());
        try (var paths = Files.list(root.resolve(".state"))) { assertEquals(0, paths.count()); }
        ObjectNode freshRequest = action("content-002", 0, "draft", answer("yes")); freshRequest.put("contentVersion", newVersion);
        Reply saved = post(QUESTION + "/actions", freshRequest); assertEquals(200, saved.status); Path state = savedFile(); byte[] savedBytes = Files.readAllBytes(state);
        server.close(); server = null; start(null);
        assertEquals(saved.body, post(QUESTION + "/actions", freshRequest).body);
        ObjectNode afterRestart = action("content-003", 1, "draft", answer("no")); afterRestart.put("contentVersion", newVersion);
        assertEquals("CONTENT_CONFLICT", post(QUESTION + "/actions", afterRestart).body.at("/error/code").asText()); assertArrayEquals(savedBytes, Files.readAllBytes(state));
        afterRestart.put("contentVersion", get(QUESTION + "/stamp").body.path("contentVersion").asText()); assertEquals(200, post(QUESTION + "/actions", afterRestart).status);
        ObjectNode malformed = action("content-004", 2, "draft", answer("yes")); malformed.put("contentVersion", "invalid-token"); assertEquals(400, post(QUESTION + "/actions", malformed).status);
        assertEquals(2, get(QUESTION + "/stamp").body.path("revision").asInt());
    }
    @Test void stateCacheEvictsLeastRecentlyUsedCollectionsAndReloadsStateAndReceipts() throws Exception {
        String bank = Files.readString(root.resolve("question-banks/bank.json"));
        for (int i = 1; i <= 8; i++) write("question-banks/other" + i + ".json", bank.replace("\"id\":\"bank\"", "\"id\":\"other" + i + "\""));
        start(null); ObjectNode savedRequest = action("eviction-001", 0, "draft", answer("yes")); Reply saved = post(QUESTION + "/actions", savedRequest); assertEquals(200, saved.status);
        Path state = savedFile(); byte[] stateBytes = Files.readAllBytes(state);
        for (int i = 1; i <= 7; i++) assertEquals(200, get("/api/collections/bank/other" + i + "/questions/q1/stamp").status);
        assertEquals(200, get(QUESTION + "/stamp").status); // Refresh its LRU position before loading a ninth collection.
        assertEquals(200, get("/api/collections/bank/other8/questions/q1/stamp").status);
        Files.writeString(state, "{"); assertEquals(200, get(QUESTION + "/stamp").status); // Recent original state is still in memory.
        for (int i = 1; i <= 8; i++) assertEquals(200, get("/api/collections/bank/other" + i + "/questions/q1/stamp").status);
        Reply evicted = get(QUESTION + "/stamp"); assertEquals(503, evicted.status); assertEquals("STATE_UNAVAILABLE", evicted.body.at("/error/code").asText()); assertEquals("{", Files.readString(state));
        Files.write(state, stateBytes); assertEquals(saved.body, get(QUESTION).body); assertEquals(saved.body, post(QUESTION + "/actions", savedRequest).body); assertArrayEquals(stateBytes, Files.readAllBytes(state));
    }
    ObjectNode editRequest(String requestId, JsonNode editor, String title, JsonNode data) {
        ObjectNode request = Json.object().put("requestId", requestId).put("revision", editor.path("revision").asLong()).put("contentVersion", editor.path("contentVersion").asText()).put("title", title); request.set("data", data.deepCopy()); return request;
    }
    @Test void historyGroupsCollectionSubmissionsWithoutDuplicateReplayAndSurvivesRemoval() throws Exception {
        start(null); assertEquals(0, get("/api/collections/bank/bank/history").body.path("records").size());
        ObjectNode submittedRequest = action("history-001", 0, "submit", answer("yes")); Reply submitted = post(QUESTION + "/actions", submittedRequest); assertEquals(200, submitted.status);
        JsonNode firstList = get("/api/collections/bank/bank/history").body.path("records"); assertEquals(1, firstList.size()); String id = firstList.get(0).path("id").asText();
        assertEquals("Test bank", firstList.get(0).path("collectionTitle").asText()); assertEquals(1, firstList.get(0).path("score").asInt()); assertFalse(firstList.get(0).has("questions")); assertEquals("in-progress", firstList.get(0).path("status").asText());
        String endpoint = "/api/collections/bank/bank/history/" + id; JsonNode partial = get(endpoint).body; assertEquals(submitted.body, partial.at("/questions/0/payload")); assertEquals("<article>Example</article>", partial.at("/page/html").asText());
        assertEquals(2, partial.path("questions").size()); assertEquals("unanswered", partial.at("/questions/1/payload/state/status").asText()); assertFalse(partial.toString().contains("second-secret")); assertFalse(partial.has("fingerprints"));
        assertEquals(submitted.body, post(QUESTION + "/actions", submittedRequest).body); assertEquals(1, get("/api/collections/bank/bank/history").body.path("records").size());
        assertEquals(200, post("/api/collections/bank/bank/questions/q2/actions", action("history-other", 0, "submit", answer("no"))).status);
        finishCurrent("history-finish");
        JsonNode frozen = get(endpoint).body; assertEquals("completed", frozen.path("status").asText()); assertEquals(2, frozen.path("submittedCount").asInt()); assertEquals(2, frozen.path("score").asInt()); assertEquals(1, get("/api/collections/bank/bank/history").body.path("records").size());
        assertEquals(200, post(QUESTION + "/actions", action("history-retry", 1, "retry", Json.object())).status);
        assertEquals(200, post(QUESTION + "/actions", action("history-002", 2, "submit", answer("no"))).status);
        JsonNode secondList = get("/api/collections/bank/bank/history").body.path("records"); assertEquals(2, secondList.size()); assertEquals(0, secondList.get(0).path("score").asInt()); assertNotEquals(id, secondList.get(0).path("id").asText()); assertEquals(frozen, get(endpoint).body);
        JsonNode newRound = get("/api/collections/bank/bank/history/" + secondList.get(0).path("id").asText()).body;
        assertEquals(1, newRound.path("submittedCount").asInt()); assertEquals("draft", newRound.at("/questions/1/payload/state/status").asText()); assertTrue(newRound.at("/questions/1/payload/state/result").isNull()); assertFalse(newRound.at("/questions/1/payload/question/data").has("reveal"));
        server.close(); server = null; Files.delete(root.resolve("question-banks/bank.json")); Files.delete(root.resolve("extensions/generic/page.js")); start(null);
        assertEquals(404, get(QUESTION).status); assertEquals(frozen, get(endpoint).body); assertEquals(2, get("/api/collections/bank/bank/history").body.path("records").size());
        assertEquals(404, get("/api/collections/bank/bank/history/absent-record").status);
        assertEquals(404, post(endpoint, Json.object()).status);
    }
    @Test void genericEditorSidecarLeavesPracticeFingerprintAndExistingStateUntouched() throws Exception {
        start(null); assertEquals(200, post(QUESTION + "/actions", action("editor-save", 0, "draft", answer("yes"))).status); JsonNode stamp = get(QUESTION + "/stamp").body; byte[] before = Files.readAllBytes(savedFile());
        JsonNode noEditor = get(QUESTION + "/editor").body; assertTrue(noEditor.path("editor").isNull()); assertEquals("answer-secret", noEditor.at("/question/data/secret").asText()); assertEquals(1, noEditor.path("revision").asInt());
        write("extensions/generic/editor.json", "{\"entry\":\"editor.html\",\"script\":\"editor.js\",\"style\":\"editor.css\"}"); write("extensions/generic/editor.html", "<textarea>editor</textarea>"); write("extensions/generic/editor.js", "QF.editor.register({onLoad(){}})"); write("extensions/generic/editor.css", "textarea{color:#123}");
        Reply editor = get(QUESTION + "/editor"); assertEquals(200, editor.status); assertEquals(4, editor.body.path("editor").size()); assertEquals(ExtensionApi.version(), editor.body.at("/editor/apiVersion")); assertEquals(stamp, get(QUESTION + "/stamp").body); assertArrayEquals(before, Files.readAllBytes(savedFile()));
        write("extensions/generic/editor.json", "{\"entry\":\"../../question-banks/bank.json\",\"script\":\"editor.js\",\"style\":\"editor.css\"}"); assertEquals("INVALID_EDITOR", get(QUESTION + "/editor").body.at("/error/code").asText()); assertEquals(stamp, get(QUESTION + "/stamp").body);
        assertEquals("READ_ONLY_COLLECTION", get("/api/collections/extension/generic/questions/q1/editor").body.at("/error/code").asText());
    }
    @Test void validatedEditResetsOnlyModifiedQuestionAndPreservesReadonlyHistory() throws Exception {
        start(null); assertEquals(200, post(QUESTION + "/actions", action("edit-submit", 0, "submit", answer("yes"))).status);
        String other = "/api/collections/bank/bank/questions/q2"; Reply untouched = post(other + "/actions", action("other-draft", 0, "draft", answer("no"))); assertEquals(200, untouched.status);
        JsonNode oldRecord = get("/api/collections/bank/bank/history").body.path("records").get(0); String historyPath = "/api/collections/bank/bank/history/" + oldRecord.path("id").asText(); JsonNode frozen = get(historyPath).body;
        JsonNode editor = get(QUESTION + "/editor").body; ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "edited prompt").put("secret", "edited-secret").put("expected", "no");
        ObjectNode edit = editRequest("editing-001", editor, "Edited question", data); Reply saved = post(QUESTION + "/edit", edit); assertEquals(200, saved.status, saved.body.toString());
        assertEquals("Edited question", saved.body.at("/payload/question/title").asText()); assertEquals("edited prompt", saved.body.at("/payload/question/data/public").asText()); assertFalse(saved.body.toString().contains("edited-secret"));
        assertEquals("unanswered", saved.body.at("/payload/state/status").asText()); assertEquals(2, saved.body.at("/payload/state/revision").asInt()); assertTrue(saved.body.at("/payload/state/answer").isNull()); assertTrue(saved.body.at("/payload/state/result").isNull()); assertTrue(saved.body.at("/payload/draft").isNull());
        assertEquals(untouched.body, get(other).body); JsonNode ended = get(historyPath).body; assertEquals(frozen.path("questions"), ended.path("questions")); assertEquals("interrupted", ended.path("status").asText()); assertEquals("content-edited", ended.path("interruptionReason").asText()); assertEquals(1, get("/api/collections/bank/bank/history").body.path("records").size());
        assertEquals("edited-secret", Json.read(root.resolve("question-banks/bank.json"), 1024 * 1024).at("/questions/0/data/secret").asText()); assertEquals(saved.body.path("collection"), get("/api/collections/bank/bank").body);
        assertEquals(200, post(QUESTION + "/actions", action("new-submit", 2, "submit", answer("no"))).status); assertEquals(2, get("/api/collections/bank/bank/history").body.path("records").size()); assertEquals(ended, get(historyPath).body);
    }
    @Test void editsValidateConflictReplayAndTitleOnlyPreservesAnswerAndInk() throws Exception {
        start(null); assertEquals(200, post(QUESTION + "/actions", action("title-draft", 0, "draft", answer("yes"))).status);
        ObjectNode ink = (ObjectNode) Json.MAPPER.readTree("{\"schemaVersion\":1,\"viewport\":{\"x\":10,\"y\":20,\"zoom\":1},\"strokes\":[],\"paper\":{\"color\":\"#ffffff\",\"pattern\":\"grid\"}}"); ObjectNode inkData = Json.object(); inkData.set("draft", ink); post(QUESTION + "/actions", action("title-ink", 1, "whiteboard", inkData));
        JsonNode editor = get(QUESTION + "/editor").body; ObjectNode valid = editRequest("title-edit", editor, "New title", editor.at("/question/data"));
        byte[] bankBefore = Files.readAllBytes(root.resolve("question-banks/bank.json")), stateBefore = Files.readAllBytes(savedFile());
        ObjectNode invalid = valid.deepCopy(); invalid.put("requestId", "edit-invalid"); ((ObjectNode) invalid.path("data")).put("public", ""); assertEquals(422, post(QUESTION + "/edit", invalid).status);
        ObjectNode stale = valid.deepCopy(); stale.put("requestId", "edit-conflict").put("contentVersion", "0".repeat(64)); assertEquals("CONTENT_CONFLICT", post(QUESTION + "/edit", stale).body.at("/error/code").asText());
        stale.put("contentVersion", valid.path("contentVersion").asText()).put("revision", 0); assertEquals("REVISION_CONFLICT", post(QUESTION + "/edit", stale).body.at("/error/code").asText());
        assertArrayEquals(bankBefore, Files.readAllBytes(root.resolve("question-banks/bank.json"))); assertArrayEquals(stateBefore, Files.readAllBytes(savedFile()));
        Reply saved = post(QUESTION + "/edit", valid); assertEquals(200, saved.status); assertEquals("draft", saved.body.at("/payload/state/status").asText()); assertEquals("yes", saved.body.at("/payload/state/answer/value").asText()); assertEquals(ink, saved.body.at("/payload/draft")); assertEquals(3, saved.body.at("/payload/state/revision").asInt());
        assertEquals(saved.body, post(QUESTION + "/edit", valid).body); ObjectNode reused = valid.deepCopy(); reused.put("title", "Another title"); assertEquals("REQUEST_ID_REUSED", post(QUESTION + "/edit", reused).body.at("/error/code").asText());
        byte[] after = Files.readAllBytes(savedFile()); server.close(); server = null; start(null); assertEquals(saved.body, post(QUESTION + "/edit", valid).body); assertArrayEquals(after, Files.readAllBytes(savedFile()));
        assertEquals(403, call("POST", QUESTION + "/edit", valid.toString(), null, "https://other.example").status);
        assertEquals("READ_ONLY_COLLECTION", post("/api/collections/extension/generic/questions/q1/edit", valid).body.at("/error/code").asText());
    }
    ObjectNode journal(Path state, byte[] bankBefore, byte[] bankAfter, byte[] stateBefore, byte[] stateAfter) {
        ObjectNode journal = Json.object().put("schemaVersion", 1).put("bank", "question-banks/bank.json").put("state", state.getFileName().toString());
        for (var field : java.util.Map.of("bankBefore", bankBefore, "bankAfter", bankAfter, "stateBefore", stateBefore, "stateAfter", stateAfter).entrySet()) { journal.putArray(field.getKey()).add(java.util.Base64.getEncoder().encodeToString(field.getValue())); try { journal.put(field.getKey() + "Digest", java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(field.getValue()))); } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); } } return journal;
    }
    @Test void interruptedEditJournalRecoversExactBankStateHistoryAndReceiptOnRestart() throws Exception {
        start(null); post(QUESTION + "/actions", action("journal-submit", 0, "submit", answer("yes"))); Path state = savedFile(); byte[] bankBefore = Files.readAllBytes(root.resolve("question-banks/bank.json")), stateBefore = Files.readAllBytes(state);
        JsonNode editor = get(QUESTION + "/editor").body; ObjectNode data = (ObjectNode) editor.at("/question/data").deepCopy(); data.put("public", "journal edit"); ObjectNode request = editRequest("journal-edit", editor, "Journal title", data); Reply edited = post(QUESTION + "/edit", request); assertEquals(200, edited.status);
        byte[] bankAfter = Files.readAllBytes(root.resolve("question-banks/bank.json")), stateAfter = Files.readAllBytes(state); JsonNode history = get("/api/collections/bank/bank/history").body;
        server.close(); server = null; Files.write(state, stateBefore); write(".state/.edit-journal.json", journal(state, bankBefore, bankAfter, stateBefore, stateAfter).toString()); start(null);
        assertArrayEquals(bankAfter, Files.readAllBytes(root.resolve("question-banks/bank.json"))); assertArrayEquals(stateAfter, Files.readAllBytes(state)); assertFalse(Files.exists(root.resolve(".state/.edit-journal.json"))); assertEquals(history, get("/api/collections/bank/bank/history").body); assertEquals(edited.body, post(QUESTION + "/edit", request).body);
    }
    @Test void interruptedEditRefusesRecoveryOverUnrelatedManualChanges() throws Exception {
        start(null); post(QUESTION + "/actions", action("journal-draft", 0, "draft", answer("yes"))); Path state = savedFile(); byte[] stateBytes = Files.readAllBytes(state), bankBytes = Files.readAllBytes(root.resolve("question-banks/bank.json")); server.close(); server = null;
        byte[] planned = new String(bankBytes, java.nio.charset.StandardCharsets.UTF_8).replace("Question 1", "Planned question").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        write(".state/.edit-journal.json", journal(state, bankBytes, planned, stateBytes, stateBytes).toString()); byte[] unexpected = new String(bankBytes, java.nio.charset.StandardCharsets.UTF_8).replace("Question 1", "Manual question").getBytes(java.nio.charset.StandardCharsets.UTF_8); Files.write(root.resolve("question-banks/bank.json"), unexpected);
        assertThrows(IOException.class, () -> start(null)); assertArrayEquals(unexpected, Files.readAllBytes(root.resolve("question-banks/bank.json"))); assertArrayEquals(stateBytes, Files.readAllBytes(state)); assertTrue(Files.exists(root.resolve(".state/.edit-journal.json")));
    }
    @Test void failedSubmissionPersistKeepsPriorPracticeAndHistoryTogether() throws Exception {
        start(null); post(QUESTION + "/actions", action("failure-first", 0, "submit", answer("yes"))); post("/api/collections/bank/bank/questions/q2/actions", action("failure-other", 0, "submit", answer("no"))); finishCurrent("failure-finish"); post(QUESTION + "/actions", action("failure-retry", 1, "retry", Json.object()));
        JsonNode history = get("/api/collections/bank/bank/history").body, practice = get(QUESTION).body; Path state = savedFile(), backup = root.resolve(".state/preserved.bak"); byte[] before = Files.readAllBytes(state);
        Files.move(state, backup); Files.createDirectory(state);
        try { Reply failed = post(QUESTION + "/actions", action("failure-second", 2, "submit", answer("no"))); assertEquals(503, failed.status); assertEquals("STATE_WRITE_FAILED", failed.body.at("/error/code").asText()); assertArrayEquals(before, Files.readAllBytes(backup)); }
        finally { Files.delete(state); Files.move(backup, state); }
        assertEquals(practice, get(QUESTION).body); assertEquals(history, get("/api/collections/bank/bank/history").body); assertArrayEquals(before, Files.readAllBytes(state));
        assertEquals(200, post(QUESTION + "/actions", action("failure-second", 2, "submit", answer("no"))).status); assertEquals(2, get("/api/collections/bank/bank/history").body.path("records").size());
    }
    @Test void editDetectsExternalSameMetadataRewriteBeforeSavingAnyBytes() throws Exception {
        start(null); post(QUESTION + "/actions", action("metadata-draft", 0, "draft", answer("yes"))); JsonNode editor = get(QUESTION + "/editor").body;
        Path bank = root.resolve("question-banks/bank.json"), state = savedFile(); var modifiedAt = Files.getLastModifiedTime(bank); byte[] stateBefore = Files.readAllBytes(state);
        String changed = Files.readString(bank).replace("\"other\"", "\"newer\""); Files.writeString(bank, changed); Files.setLastModifiedTime(bank, modifiedAt); byte[] bankBefore = Files.readAllBytes(bank);
        Reply rejected = post(QUESTION + "/edit", editRequest("metadata-edit", editor, "Attempted edit", editor.at("/question/data"))); assertEquals(409, rejected.status); assertEquals("CONTENT_CONFLICT", rejected.body.at("/error/code").asText());
        assertArrayEquals(bankBefore, Files.readAllBytes(bank)); assertArrayEquals(stateBefore, Files.readAllBytes(state)); assertFalse(Files.exists(root.resolve(".state/.edit-journal.json")));
    }
    @Test void unfinishedRoundCanReplaceOneSubmissionAndReplayDoesNotUpdateItsTimestamp() throws Exception {
        start(null); String other = "/api/collections/bank/bank/questions/q2";
        post(other + "/actions", action("round-draft", 0, "draft", answer("no")));
        ObjectNode first = action("round-first", 0, "submit", answer("yes")); Reply response = post(QUESTION + "/actions", first); assertEquals(200, response.status);
        JsonNode list = get("/api/collections/bank/bank/history").body.path("records"); String endpoint = "/api/collections/bank/bank/history/" + list.get(0).path("id").asText(); JsonNode before = get(endpoint).body;
        assertEquals("draft", before.at("/questions/1/payload/state/status").asText()); assertEquals("no", before.at("/questions/1/payload/state/answer/value").asText());
        assertEquals(response.body, post(QUESTION + "/actions", first).body); assertEquals(before, get(endpoint).body);
        post(QUESTION + "/actions", action("round-retry", 1, "retry", Json.object())); assertEquals(before, get(endpoint).body);
        ObjectNode replacement = action("round-again", 2, "submit", answer("no")); assertEquals(200, post(QUESTION + "/actions", replacement).status);
        JsonNode updated = get(endpoint).body; assertEquals(1, get("/api/collections/bank/bank/history").body.path("records").size()); assertEquals(1, updated.path("submittedCount").asInt()); assertEquals(0, updated.path("score").asInt());
        assertEquals("no", updated.at("/questions/0/payload/state/answer/value").asText()); assertEquals(before.path("createdAt"), updated.path("createdAt"));
        server.close(); server = null; start(null); assertEquals(200, post(QUESTION + "/actions", replacement).status); assertEquals(updated, get(endpoint).body);
        assertEquals(200, post(other + "/actions", action("round-finish", 1, "submit", answer("no"))).status);
        assertEquals("in-progress", get(endpoint).body.path("status").asText()); finishCurrent("round-complete");
        JsonNode completed = get(endpoint).body; assertEquals("completed", completed.path("status").asText()); assertEquals(1, completed.path("score").asInt()); assertEquals(2, completed.path("maxScore").asInt());
    }
    ObjectNode legacySnapshot(String id, String time, JsonNode payload, JsonNode page) {
        ObjectNode value = Json.object().put("id", id).put("createdAt", time).put("questionId", payload.at("/question/id").asText()).put("questionTitle", payload.at("/question/title").asText()).put("collectionTitle", "Original legacy bank");
        value.set("extension", payload.path("extension").deepCopy()); value.set("score", payload.at("/state/result/score").deepCopy()); value.set("maxScore", payload.at("/state/result/maxScore").deepCopy()); value.set("correct", payload.at("/state/result/correct").deepCopy()); value.set("payload", payload.deepCopy()); value.set("page", page.deepCopy()); return value;
    }
    @Test void legacyDistinctSubmissionsAreGroupedUntilRepeatedQuestionWithoutChangingSavedBytes() throws Exception {
        start(null); JsonNode first = post(QUESTION + "/actions", action("legacy-first", 0, "submit", answer("yes"))).body;
        JsonNode second = post("/api/collections/bank/bank/questions/q2/actions", action("legacy-other", 0, "submit", answer("no"))).body;
        JsonNode page = get("/api/extensions/generic/1.0.0/page").body; Path stateFile = savedFile(); ObjectNode state = (ObjectNode) Json.read(stateFile, 32 * 1024 * 1024); server.close(); server = null;
        state.remove("historyRounds"); var history = state.putArray("history");
        history.add(legacySnapshot("legacy-first-1", "2026-10-07T01:00:00Z", first, page)); history.add(legacySnapshot("legacy-other-1", "2026-10-07T01:00:01Z", second, ((ObjectNode) page).deepCopy().put("html", "<article>Old second page</article>")));
        history.add(legacySnapshot("legacy-first-2", "2026-10-07T01:00:02Z", first, page)); history.add(legacySnapshot("legacy-other-2", "2026-10-07T01:00:03Z", second, page)); Files.writeString(stateFile, state.toString()); byte[] before = Files.readAllBytes(stateFile);
        Files.delete(root.resolve("question-banks/bank.json")); Files.delete(root.resolve("extensions/generic/page.js")); start(null);
        JsonNode records = get("/api/collections/bank/bank/history").body.path("records"); assertEquals(2, records.size()); assertEquals("legacy-first-2", records.get(0).path("id").asText());
        for (JsonNode record : records) { assertEquals("legacy", record.path("status").asText()); assertTrue(record.path("incomplete").asBoolean()); assertFalse(record.path("questionCountKnown").asBoolean()); assertEquals(2, record.path("questionCount").asInt()); assertEquals(2, record.path("score").asInt()); assertFalse(record.has("legacyIds")); }
        JsonNode old = get("/api/collections/bank/bank/history/legacy-first-1").body; assertEquals(first, old.at("/questions/0/payload")); assertEquals(second, old.at("/questions/1/payload")); assertEquals("<article>Old second page</article>", old.at("/questions/1/page/html").asText());
        assertEquals(old, get("/api/collections/bank/bank/history/legacy-other-1").body); assertArrayEquals(before, Files.readAllBytes(stateFile));
    }
    @Test void titleOnlyEditDoesNotInterruptRoundOrReplaceItsFrozenTitle() throws Exception {
        start(null); post(QUESTION + "/actions", action("frozen-title", 0, "submit", answer("yes"))); String id = get("/api/collections/bank/bank/history").body.path("records").get(0).path("id").asText(); String endpoint = "/api/collections/bank/bank/history/" + id;
        JsonNode before = get(endpoint).body, editor = get(QUESTION + "/editor").body;
        assertEquals(200, post(QUESTION + "/edit", editRequest("rename-round", editor, "Renamed in live bank", editor.at("/question/data"))).status);
        assertEquals(before, get(endpoint).body); assertEquals(200, post("/api/collections/bank/bank/questions/q2/actions", action("rename-other", 0, "submit", answer("no"))).status);
        finishCurrent("rename-finish");
        JsonNode completed = get(endpoint).body; assertEquals("completed", completed.path("status").asText()); assertEquals("Question 1", completed.at("/questions/0/payload/question/title").asText()); assertEquals("Question 1", completed.at("/collection/questions/0/title").asText()); assertEquals(1, get("/api/collections/bank/bank/history").body.path("records").size());
    }
    @Test void failedBatchSnapshotPreservesPriorPracticeAndHistoryBytes() throws Exception {
        String rules = Files.readString(root.resolve("extensions/generic/rules.js")); write("extensions/generic/rules.js", rules.replace("{public:data.public};", "{public:data.public === 'other' ? 'x'.repeat(2200000) : data.public};"));
        start(null); assertEquals(200, post(QUESTION + "/actions", action("batch-draft", 0, "draft", answer("yes"))).status); Path state = savedFile(); byte[] before = Files.readAllBytes(state); JsonNode practice = get(QUESTION).body;
        Reply rejected = post(QUESTION + "/actions", action("batch-submit", 1, "submit", answer("yes"))); assertEquals(422, rejected.status); assertEquals(practice, get(QUESTION).body); assertArrayEquals(before, Files.readAllBytes(state)); assertEquals(0, get("/api/collections/bank/bank/history").body.path("records").size());
    }
    @Test void deletingCompletedRoundPreservesCurrentPracticeOtherHistoryAndSurvivesRestart() throws Exception {
        start(null); String history = "/api/collections/bank/bank/history", other = "/api/collections/bank/bank/questions/q2";
        post(QUESTION + "/actions", action("delete-first", 0, "submit", answer("yes"))); post(other + "/actions", action("delete-other", 0, "submit", answer("no")));
        finishCurrent("delete-finish");
        String completedId = get(history).body.path("records").get(0).path("id").asText();
        post(QUESTION + "/actions", action("delete-retry", 1, "retry", Json.object())); post(QUESTION + "/actions", action("delete-again", 2, "submit", answer("no")));
        String activeId = get(history).body.path("records").get(0).path("id").asText(); JsonNode active = get(history + "/" + activeId).body;
        ObjectNode ink = (ObjectNode) Json.MAPPER.readTree("{\"schemaVersion\":1,\"viewport\":{\"x\":3,\"y\":4,\"zoom\":1},\"strokes\":[],\"paper\":{\"color\":\"#ffffff\",\"pattern\":\"grid\"}}");
        post(QUESTION + "/actions", action("delete-ink", 3, "whiteboard", Json.object().set("draft", ink)));
        JsonNode practice = get(QUESTION).body, untouched = get(other).body; Path file = savedFile(); JsonNode questions = Json.read(file, 32 * 1024 * 1024).path("questions");
        Reply deleted = delete(history + "/" + completedId); assertEquals(200, deleted.status); assertEquals(completedId, deleted.body.path("deleted").asText());
        assertEquals(404, get(history + "/" + completedId).status); assertEquals(1, get(history).body.path("records").size()); assertEquals(active, get(history + "/" + activeId).body);
        assertEquals(practice, get(QUESTION).body); assertEquals(untouched, get(other).body); assertEquals(questions, Json.read(file, 32 * 1024 * 1024).path("questions"));
        byte[] after = Files.readAllBytes(file); assertEquals(404, delete(history + "/" + completedId).status); assertEquals(404, delete("/api/collections/extension/generic/history/" + activeId).status); assertArrayEquals(after, Files.readAllBytes(file));
        server.close(); server = null; start(null); assertEquals(404, get(history + "/" + completedId).status); assertEquals(active, get(history + "/" + activeId).body); assertEquals(ink, get(QUESTION).body.path("draft"));
        Files.delete(root.resolve("question-banks/bank.json")); Files.delete(root.resolve("extensions/generic/page.js"));
        assertEquals(200, delete(history + "/" + activeId).status); assertEquals(0, get(history).body.path("records").size()); assertEquals(questions, Json.read(file, 32 * 1024 * 1024).path("questions"));
    }
    @Test void deletingActiveRoundStartsFreshOnNextSubmitAndReplayCannotResurrectIt() throws Exception {
        start(null); String history = "/api/collections/bank/bank/history", other = "/api/collections/bank/bank/questions/q2";
        ObjectNode originalRequest = action("delete-active", 0, "submit", answer("yes")); Reply original = post(QUESTION + "/actions", originalRequest);
        String deletedId = get(history).body.path("records").get(0).path("id").asText(); JsonNode practice = get(QUESTION).body;
        assertEquals(200, delete(history + "/" + deletedId).status); assertEquals(practice, get(QUESTION).body);
        assertEquals(original.body, post(QUESTION + "/actions", originalRequest).body); assertEquals(0, get(history).body.path("records").size());
        assertEquals(200, post(other + "/actions", action("delete-next", 0, "submit", answer("no"))).status);
        JsonNode records = get(history).body.path("records"); assertEquals(1, records.size()); String freshId = records.get(0).path("id").asText(); assertNotEquals(deletedId, freshId);
        JsonNode fresh = get(history + "/" + freshId).body; assertEquals("in-progress", fresh.path("status").asText()); assertEquals(1, fresh.path("submittedCount").asInt());
        assertNotEquals("submitted", fresh.at("/questions/0/payload/state/status").asText()); assertTrue(fresh.at("/questions/0/payload/state/result").isNull()); assertEquals("submitted", get(QUESTION).body.at("/state/status").asText());
    }
    @Test void deletingLegacyGroupedRoundThroughAliasKeepsSurvivingBoundariesAndIds() throws Exception {
        start(null); JsonNode first = post(QUESTION + "/actions", action("legacy-del-a", 0, "submit", answer("yes"))).body;
        JsonNode second = post("/api/collections/bank/bank/questions/q2/actions", action("legacy-del-b", 0, "submit", answer("no"))).body;
        JsonNode page = get("/api/extensions/generic/1.0.0/page").body; Path file = savedFile(); ObjectNode state = (ObjectNode) Json.read(file, 32 * 1024 * 1024); JsonNode questions = state.path("questions").deepCopy(); server.close(); server = null;
        state.remove("historyRounds"); var legacy = state.putArray("history");
        legacy.add(legacySnapshot("legacy-before", "2026-10-07T01:00:00Z", first, page));
        legacy.add(legacySnapshot("legacy-middle-a", "2026-10-07T01:00:01Z", first, page)); legacy.add(legacySnapshot("legacy-middle-b", "2026-10-07T01:00:02Z", second, page));
        legacy.add(legacySnapshot("legacy-after", "2026-10-07T01:00:03Z", second, page)); Files.writeString(file, state.toString()); start(null);
        String history = "/api/collections/bank/bank/history"; assertEquals(3, get(history).body.path("records").size()); JsonNode before = get(history + "/legacy-before").body, after = get(history + "/legacy-after").body;
        assertEquals(200, delete(history + "/legacy-middle-b").status); JsonNode retained = get(history).body.path("records"); assertEquals(2, retained.size());
        assertEquals("legacy-after", retained.get(0).path("id").asText()); assertEquals("legacy-before", retained.get(1).path("id").asText());
        assertEquals(before, get(history + "/legacy-before").body); assertEquals(after, get(history + "/legacy-after").body); assertEquals(404, get(history + "/legacy-middle-a").status); assertEquals(404, get(history + "/legacy-middle-b").status);
        JsonNode persisted = Json.read(file, 32 * 1024 * 1024); assertEquals(questions, persisted.path("questions")); assertEquals(2, persisted.path("history").size());
        server.close(); server = null; start(null); assertEquals(before, get(history + "/legacy-before").body); assertEquals(after, get(history + "/legacy-after").body);
        assertEquals(200, delete(history + "/legacy-before").status); assertEquals(after, get(history + "/legacy-after").body); assertEquals(200, delete(history + "/legacy-after").status); assertEquals(0, get(history).body.path("records").size());
    }
    @Test void historyDeletionRequiresTokenAndSameOrigin() throws Exception {
        start(TOKEN); String history = "/api/collections/bank/bank/history/absent-record";
        assertEquals(401, delete(history).status); assertEquals(403, call("DELETE", history, null, TOKEN, "https://other.example").status);
        assertEquals(404, call("DELETE", history, null, TOKEN, "http://127.0.0.1:" + server.port()).status);
    }
    @Test void explicitFinishFreezesFullFractionalSummaryRejectsStaleRequestAndReplaysAfterRestart() throws Exception {
        String rules = Files.readString(root.resolve("extensions/generic/rules.js"));
        write("extensions/generic/rules.js", rules.replace("grade(data,answer)", "getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:data.public==='visible'?1.25:2.5};}, grade(data,answer)")
                .replace("score:correct?1:0,maxScore:1", "score:correct?0.625:0,maxScore:1.25"));
        start(null); String base = "/api/collections/bank/bank", other = base + "/questions/q2";
        assertEquals(200, post(QUESTION + "/actions", action("score-submit", 0, "submit", answer("yes"))).status);
        JsonNode initial = get(base + "/summary").body;
        assertEquals(0.625, initial.path("score").asDouble()); assertEquals(3.75, initial.path("maxScore").asDouble()); assertEquals(1, initial.path("submittedCount").asInt()); assertFalse(initial.path("finished").asBoolean());
        assertEquals("in-progress", get(base + "/history").body.at("/records/0/status").asText());
        ObjectNode request = Json.object().put("requestId", "finish-request").put("summaryVersion", initial.path("summaryVersion").asText()); request.set("roundId", initial.path("roundId"));
        post(other + "/actions", action("score-draft", 0, "draft", answer("no")));
        assertEquals(409, post(base + "/finish", request).status);
        JsonNode latest = get(base + "/summary").body; request.put("summaryVersion", latest.path("summaryVersion").asText());
        Reply finished = post(base + "/finish", request); assertEquals(200, finished.status); assertTrue(finished.body.path("finished").asBoolean());
        String history = base + "/history/" + finished.body.path("historyId").asText(); JsonNode frozen = get(history).body;
        assertEquals("completed", frozen.path("status").asText()); assertEquals(3.75, frozen.at("/summary/maxScore").asDouble()); assertEquals(0, frozen.at("/summary/questions/1/score").asInt());
        assertEquals("draft", frozen.at("/questions/1/payload/state/status").asText()); assertEquals("no", frozen.at("/questions/1/payload/state/answer/value").asText());
        assertEquals(finished.body, post(base + "/finish", request).body); assertEquals(1, get(base + "/history").body.path("records").size());
        server.close(); server = null; start(null); assertEquals(frozen, get(history).body); assertEquals(finished.body, post(base + "/finish", request).body);
        post(QUESTION + "/actions", action("score-retry", 1, "retry", Json.object()));
        assertEquals(0, get(base + "/summary").body.path("score").asInt()); assertFalse(get(base + "/summary").body.path("finished").asBoolean());
        post(QUESTION + "/actions", action("score-new", 2, "submit", answer("no")));
        assertEquals(2, get(base + "/history").body.path("records").size()); assertEquals(frozen, get(history).body);
    }
    @Test void emptyPracticeCanFinishThroughGenericProjectionScoreFallbackAndMissingScoresAreReported() throws Exception {
        String originalRules = Files.readString(root.resolve("extensions/generic/rules.js")); write("extensions/generic/rules.js", originalRules.replace("getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:1};},", ""));
        start(null); String base = "/api/collections/bank/bank";
        Reply unavailable = get(base + "/summary"); assertEquals(422, unavailable.status); assertEquals("SCORE_UNAVAILABLE", unavailable.body.at("/error/code").asText());
        assertEquals(200, get(QUESTION).status); server.close(); server = null;
        String rules = Files.readString(root.resolve("extensions/generic/rules.js")); write("extensions/generic/rules.js", rules.replace("{public:data.public};", "{public:data.public,maxScore:1.5};"));
        start(null); JsonNode summary = get(base + "/summary").body; assertTrue(summary.path("roundId").isNull()); assertEquals(0, summary.path("score").asInt()); assertEquals(3, summary.path("maxScore").asInt());
        ObjectNode request = Json.object().put("requestId", "finish-empty").put("summaryVersion", summary.path("summaryVersion").asText()).putNull("roundId");
        Reply finished = post(base + "/finish", request); assertEquals(200, finished.status); assertTrue(get(base + "/summary").body.path("finished").asBoolean());
        JsonNode saved = get(base + "/history/" + finished.body.path("historyId").asText()).body; assertEquals(2, saved.path("questions").size()); assertEquals(0, saved.path("submittedCount").asInt()); assertEquals(3, saved.path("maxScore").asInt());
        assertTrue(saved.at("/questions/0/payload/state/result").isNull()); assertEquals("unanswered", get(QUESTION).body.at("/state/status").asText());
        server.close(); server = null; start(null); assertEquals(saved, get(base + "/history/" + finished.body.path("historyId").asText()).body); assertTrue(get(base + "/summary").body.path("finished").asBoolean());
    }
    @Test void oldAutomaticCompletionGetsSummaryWithoutDuplicatingOrChangingQuestionSnapshots() throws Exception {
        start(null); String base = "/api/collections/bank/bank";
        post(QUESTION + "/actions", action("old-score-one", 0, "submit", answer("yes")));
        post(base + "/questions/q2/actions", action("old-score-two", 0, "submit", answer("no")));
        Path file = savedFile(); ObjectNode state = (ObjectNode) Json.read(file, 32 * 1024 * 1024); ObjectNode round = (ObjectNode) state.path("historyRounds").get(0);
        round.remove("explicitCompletion"); round.put("status", "completed"); String id = round.path("id").asText(); JsonNode questions = round.path("questions").deepCopy();
        server.close(); server = null; Files.writeString(file, state.toString()); start(null);
        JsonNode summary = get(base + "/summary").body; assertEquals(id, summary.path("roundId").asText()); assertEquals(2, summary.path("score").asInt());
        finishCurrent("finish-old-round"); assertEquals(1, get(base + "/history").body.path("records").size());
        JsonNode saved = get(base + "/history/" + id).body; assertEquals(questions, saved.path("questions")); assertTrue(saved.at("/summary/finished").asBoolean()); assertEquals(2, saved.at("/summary/maxScore").asInt());
    }
    @Test void deletedHistoryRetainsCurrentScoresAndCanFinishIntoNewFullSnapshot() throws Exception {
        start(null); String base = "/api/collections/bank/bank";
        post(QUESTION + "/actions", action("orphan-submit-one", 0, "submit", answer("yes")));
        post(base + "/questions/q2/actions", action("orphan-submit-two", 0, "submit", answer("no")));
        String deletedId = get(base + "/history").body.at("/records/0/id").asText(); assertEquals(200, delete(base + "/history/" + deletedId).status);
        assertEquals("submitted", get(QUESTION).body.at("/state/status").asText());
        JsonNode summary = get(base + "/summary").body; assertTrue(summary.path("roundId").isNull()); assertEquals(2, summary.path("submittedCount").asInt()); assertEquals(2, summary.path("score").asInt()); assertEquals(2, summary.path("maxScore").asInt());
        ObjectNode request = Json.object().put("requestId", "finish-orphan").put("summaryVersion", summary.path("summaryVersion").asText()).putNull("roundId");
        Reply finished = post(base + "/finish", request); assertEquals(200, finished.status); String id = finished.body.path("historyId").asText(); assertNotEquals(deletedId, id);
        JsonNode snapshot = get(base + "/history/" + id).body; assertEquals(2, snapshot.at("/summary/submittedCount").asInt()); assertEquals(2, snapshot.at("/summary/score").asInt()); assertEquals("submitted", snapshot.at("/questions/1/payload/state/status").asText());
        assertEquals("answer-secret", snapshot.at("/questions/0/payload/question/data/reveal").asText()); assertEquals(1, get(base + "/history").body.path("records").size());
        server.close(); server = null; start(null); assertEquals(snapshot, get(base + "/history/" + id).body); assertEquals(2, get(base + "/summary").body.path("score").asInt()); assertTrue(get(base + "/summary").body.path("finished").asBoolean());
    }
}
