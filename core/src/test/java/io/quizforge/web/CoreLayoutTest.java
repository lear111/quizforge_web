package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class CoreLayoutTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }

    void moveFixtureCode() throws Exception {
        Path core = Files.createDirectory(root.resolve("core"));
        for (String directory : java.util.List.of("server", "node_modules", "web", "shared")) {
            Path source = root.resolve(directory);
            if (Files.exists(source)) Files.move(source, core.resolve(directory));
        }
    }
    Path stateFile() throws Exception {
        try (var files = Files.list(root.resolve(".state"))) {
            return files.filter(file -> file.getFileName().toString().matches("[a-f0-9]{64}\\.json")).findFirst().orElseThrow();
        }
    }
    void sdkSource(String prefix, String version, int value) throws Exception {
        Files.createDirectories(root.resolve(prefix + "/richtext/" + version));
        fixture.write(prefix + "/richtext/" + version + "/richtext.js", "window.staticVersion = " + value + ";");
        fixture.write(prefix + "/richtext/" + version + "/richtext-editor.js", "window.editorVersion = " + value + ";");
        fixture.write(prefix + "/richtext/" + version + "/richtext.css", ".richtext{opacity:" + (value == 1 ? "1" : "0.9") + "}");
    }

    @Test void coreServesPagesAndRulesWhilePracticeDataRemainsAtProjectRoot() throws Exception {
        byte[] bankBytes = Files.readAllBytes(root.resolve("question-banks/bank.json"));
        moveFixtureCode();
        // An obsolete outer copy must not override the selected core code directory.
        Files.createDirectories(root.resolve("web")); fixture.write("web/index.html", "<title>Obsolete outer page</title>");
        fixture.start(null);
        assertTrue(fixture.get("/").response().body().contains("QuizForge test"));
        assertFalse(fixture.get("/").response().body().contains("Obsolete outer page"));
        var first = fixture.get(ServerTest.QUESTION); assertEquals(200, first.status()); assertFalse(first.body().toString().contains("answer-secret"));
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("core-submit-001", 0, "submit", fixture.answer("yes")));
        assertEquals(200, submitted.status(), submitted.body().toString()); assertEquals(1, submitted.body().at("/state/result/score").asInt());
        byte[] savedBytes = Files.readAllBytes(stateFile());
        assertFalse(Files.exists(root.resolve("core/.state"))); assertFalse(Files.exists(root.resolve("core/extensions"))); assertFalse(Files.exists(root.resolve("core/question-banks")));
        assertArrayEquals(bankBytes, Files.readAllBytes(root.resolve("question-banks/bank.json")));
        fixture.server.close(); fixture.server = null; fixture.start(null);
        var restored = fixture.get(ServerTest.QUESTION); assertEquals(200, restored.status()); assertEquals(submitted.body().path("state"), restored.body().path("state"));
        assertArrayEquals(savedBytes, Files.readAllBytes(stateFile())); assertFalse(Files.exists(root.resolve("core/.state")));
    }

    @Test void movingCodePreservesPublishedSdkAndFrozenHistoryAndPublishesNewSdkAtDataRoot() throws Exception {
        sdkSource("shared", "1.0.0", 1);
        ObjectNode manifest = (ObjectNode) Json.read(root.resolve("extensions/generic/manifest.json"), 1024 * 1024);
        manifest.putArray("dependencies").add(Json.object().put("id", "quizforge.richtext").put("version", "1.0.0")); fixture.write("extensions/generic/manifest.json", manifest.toString());
        fixture.start(null);
        String sdkEndpoint = "/api/sdk/quizforge.richtext/1.0.0"; JsonNode oldSdk = fixture.get(sdkEndpoint).body();
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("layout-history-001", 0, "submit", fixture.answer("yes"))); assertEquals(200, submitted.status(), submitted.body().toString());
        fixture.finishCurrent("layout-finish-001");
        String historyId = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText();
        String historyEndpoint = "/api/collections/bank/bank/history/" + historyId; JsonNode history = fixture.get(historyEndpoint).body();
        Path archive = root.resolve(".state/sdk/quizforge.richtext/1.0.0/sdk.json"); byte[] archiveBytes = Files.readAllBytes(archive), savedBytes = Files.readAllBytes(stateFile());
        fixture.server.close(); fixture.server = null;
        moveFixtureCode(); sdkSource("core/shared", "1.0.0", 99); sdkSource("core/shared", "1.0.1", 2);
        fixture.start(null);
        assertEquals(oldSdk, fixture.get(sdkEndpoint).body()); assertEquals(history, fixture.get(historyEndpoint).body());
        var current = fixture.get(ServerTest.QUESTION); assertEquals(200, current.status()); assertEquals("submitted", current.body().at("/state/status").asText());
        JsonNode newSdk = fixture.get("/api/sdk/quizforge.richtext/1.0.1").body(); assertEquals("window.staticVersion = 2;", newSdk.path("script").asText());
        assertTrue(Files.exists(root.resolve(".state/sdk/quizforge.richtext/1.0.1/sdk.json")));
        assertArrayEquals(archiveBytes, Files.readAllBytes(archive)); assertArrayEquals(savedBytes, Files.readAllBytes(stateFile())); assertFalse(Files.exists(root.resolve("core/.state")));
    }
}
