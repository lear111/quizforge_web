package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class RichTextServiceTest {
    @TempDir Path root;
    final ServerTest fixture = new ServerTest();
    @BeforeEach void prepare() throws Exception { fixture.root = root; fixture.prepare(); }
    @AfterEach void close() { fixture.close(); }
    void provider(String version, String content) throws Exception {
        Files.createDirectories(root.resolve("shared/richtext/" + version));
        for (String file : List.of("richtext.js", "richtext-editor.js", "richtext.css")) fixture.write("shared/richtext/" + version + "/" + file, content + ":" + file);
    }
    ObjectNode manifest() throws Exception { return (ObjectNode) Json.read(root.resolve("extensions/generic/manifest.json"), 256 * 1024); }
    void saveManifest(ObjectNode value) throws Exception { fixture.write("extensions/generic/manifest.json", value.toString()); }
    void legacy(String version) throws Exception {
        ObjectNode value = manifest(); value.putArray("dependencies").add(Json.object().put("id", "quizforge.richtext").put("version", version)); saveManifest(value);
    }
    ObjectNode registry(String advanced) {
        ObjectNode value = Json.object().put("schemaVersion", 1).put("defaultProfile", "advanced-v1");
        value.putObject("api").put("major", 1).put("minor", 0).put("documentFormat", 1);
        var profiles = value.putArray("profiles");
        ObjectNode basic = profiles.addObject().put("id", "basic-v1"); basic.putObject("provider").put("id", "quizforge.richtext").put("version", "1.0.0");
        basic.putArray("capabilities").add("basic-formatting").add("images"); basic.putArray("legacyVersions").add("1.0.0");
        ObjectNode richer = profiles.addObject().put("id", "advanced-v1"); richer.putObject("provider").put("id", "quizforge.richtext").put("version", advanced);
        richer.putArray("capabilities").add("basic-formatting").add("images").add("advanced-formatting").add("tables").add("math").add("image-resize");
        richer.putArray("legacyVersions").add("1.1.0").add("1.1.1").add("1.1.2");
        return value;
    }
    void registry(ObjectNode value) throws Exception { Files.createDirectories(root.resolve("shared/richtext")); fixture.write("shared/richtext/service.json", value.toString()); }
    ObjectNode requirement(String profile) {
        return Json.object().put("major", 1).put("minMinor", 0).put("documentFormat", 1).put("documentProfile", profile);
    }
    @Test void compatibleProviderPatchRefreshesPagesWithoutResettingAnswersDraftsOrHistory() throws Exception {
        provider("1.1.1", "old-provider"); provider("1.1.2", "new-provider"); registry(registry("1.1.1")); legacy("1.1.0");
        byte[] bankBefore = Files.readAllBytes(root.resolve("question-banks/bank.json")), extensionBefore = Files.readAllBytes(root.resolve("extensions/generic/manifest.json"));
        fixture.start(null);
        JsonNode pageBefore = fixture.get("/api/extensions/generic/1.0.0/page").body(); assertEquals("1.1.1", pageBefore.at("/dependencies/0/version").asText());
        assertEquals("advanced-v1", pageBefore.at("/contentApi/documentProfile").asText());
        var submitted = fixture.post(ServerTest.QUESTION + "/actions", fixture.action("provider-before", 0, "submit", fixture.answer("yes"))); assertEquals(200, submitted.status());
        fixture.finishCurrent("provider-finish");
        String historyId = fixture.get("/api/collections/bank/bank/history").body().at("/records/0/id").asText();
        String historyEndpoint = "/api/collections/bank/bank/history/" + historyId;
        JsonNode historyBefore = fixture.get(historyEndpoint).body(), stateBefore = fixture.get(ServerTest.QUESTION).body(), editorBefore = fixture.get(ServerTest.QUESTION + "/editor").body();
        ObjectNode draft = Json.object().put("contentVersion", editorBefore.path("draftVersion").asText()).put("changed", true); draft.putObject("draft").put("title", "Unfinished change");
        assertEquals(200, fixture.call("PUT", "/api/editor-drafts/bank/q1", draft.toString(), null, null).status());
        Path sdkArchive = root.resolve(".state/sdk/quizforge.richtext/1.1.1/sdk.json"); byte[] archiveBefore = Files.readAllBytes(sdkArchive), stateBytes = Files.readAllBytes(fixture.savedFile());
        registry(registry("1.1.2"));
        JsonNode pageAfter = fixture.get("/api/extensions/generic/1.0.0/page").body(), stateAfter = fixture.get(ServerTest.QUESTION).body(), editorAfter = fixture.get(ServerTest.QUESTION + "/editor").body();
        assertEquals("1.1.2", pageAfter.at("/dependencies/0/version").asText()); assertEquals(pageBefore.path("contentApi"), pageAfter.path("contentApi"));
        assertEquals(stateBefore.path("state"), stateAfter.path("state")); assertEquals(stateBefore.at("/stamp/contentVersion"), stateAfter.at("/stamp/contentVersion"));
        assertNotEquals(stateBefore.at("/stamp/packageVersion"), stateAfter.at("/stamp/packageVersion")); assertEquals(editorBefore.path("draftVersion"), editorAfter.path("draftVersion"));
        assertEquals(draft, fixture.get("/api/editor-drafts/bank/q1").body()); assertEquals(historyBefore, fixture.get(historyEndpoint).body());
        assertEquals(pageBefore.path("dependencies"), historyBefore.at("/page/dependencies")); assertEquals(pageBefore.path("contentApi"), historyBefore.at("/page/contentApi"));
        assertArrayEquals(bankBefore, Files.readAllBytes(root.resolve("question-banks/bank.json"))); assertArrayEquals(extensionBefore, Files.readAllBytes(root.resolve("extensions/generic/manifest.json")));
        assertArrayEquals(archiveBefore, Files.readAllBytes(sdkArchive)); assertArrayEquals(stateBytes, Files.readAllBytes(fixture.savedFile()));
        assertTrue(fixture.get("/api/sdk/quizforge.richtext/1.1.2").body().path("script").asText().startsWith("new-provider"));
        for (String file : List.of("richtext.js", "richtext-editor.js", "richtext.css")) Files.delete(root.resolve("shared/richtext/1.1.1/" + file));
        fixture.server.close(); fixture.server = null; fixture.start(null);
        assertEquals(historyBefore, fixture.get(historyEndpoint).body()); assertTrue(fixture.get("/api/sdk/quizforge.richtext/1.1.1").body().path("script").asText().startsWith("old-provider"));
        assertEquals("submitted", fixture.get(ServerTest.QUESTION).body().at("/state/status").asText());
    }
    @Test void publicRequirementResolvesProviderWithoutPinningItsImplementationVersion() throws Exception {
        provider("1.0.0", "basic"); provider("1.1.2", "advanced"); registry(registry("1.1.2"));
        ObjectNode value = manifest(); ObjectNode request = requirement("advanced-v1"); request.putArray("capabilities").add("tables").add("image-resize"); value.set("requiresRichText", request); saveManifest(value);
        fixture.start(null); JsonNode page = fixture.get("/api/extensions/generic/1.0.0/page").body();
        assertEquals("1.1.2", page.at("/dependencies/0/version").asText()); assertEquals(2, page.at("/dependencies/0").size());
        assertEquals("advanced-v1", page.at("/contentApi/documentProfile").asText()); assertEquals(6, page.at("/contentApi/capabilities").size());
        provider("1.1.3", "patch"); registry(registry("1.1.3"));
        assertEquals("1.1.3", fixture.get("/api/extensions/generic/1.0.0/page").body().at("/dependencies/0/version").asText());
        assertFalse(manifest().path("requiresRichText").has("version")); assertFalse(manifest().has("dependencies"));
    }
    @Test void legacyBasicSchemaNeverReceivesAdvancedProvider() throws Exception {
        provider("1.0.0", "basic"); provider("1.1.2", "advanced"); registry(registry("1.1.2")); legacy("1.0.0"); fixture.start(null);
        JsonNode page = fixture.get("/api/extensions/generic/1.0.0/page").body(); assertEquals("1.0.0", page.at("/dependencies/0/version").asText());
        assertEquals("basic-v1", page.at("/contentApi/documentProfile").asText()); assertEquals(2, page.at("/contentApi/capabilities").size());
        provider("1.1.3", "advanced-patch"); registry(registry("1.1.3")); assertEquals(page, fixture.get("/api/extensions/generic/1.0.0/page").body());
    }
    @Test void unknownLegacyPinKeepsItsExactSdkAndDoesNotInheritUnverifiedProfile() throws Exception {
        provider("1.0.1", "unregistered"); provider("1.1.2", "advanced"); registry(registry("1.1.2")); legacy("1.0.1"); fixture.start(null);
        JsonNode page = fixture.get("/api/extensions/generic/1.0.0/page").body(); assertEquals("1.0.1", page.at("/dependencies/0/version").asText()); assertFalse(page.has("contentApi"));
    }
    @Test void unsupportedContractCapabilitiesProfileAndAmbiguousDeclarationsFailClearly() throws Exception {
        provider("1.1.2", "advanced"); registry(registry("1.1.2"));
        RichTextService service = new RichTextService(root); ObjectNode value = manifest(), request = requirement("advanced-v1"); value.set("requiresRichText", request);
        request.put("major", 2); assertEquals("UNSUPPORTED_RICHTEXT_API", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.put("major", 1).put("minMinor", 1); assertEquals("UNSUPPORTED_RICHTEXT_API", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.put("minMinor", 0).put("documentFormat", 2); assertEquals("UNSUPPORTED_RICHTEXT_DOCUMENT_FORMAT", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.put("documentFormat", 1).put("documentProfile", "future-v2"); assertEquals("UNSUPPORTED_RICHTEXT_PROFILE", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.put("documentProfile", "basic-v1"); request.putArray("capabilities").add("tables"); assertEquals("UNSUPPORTED_RICHTEXT_CAPABILITY", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.putArray("capabilities").add("images").add("images"); assertEquals("INVALID_RICHTEXT_REQUIREMENT", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        request.remove("capabilities"); value.putArray("dependencies"); assertEquals("INVALID_RICHTEXT_REQUIREMENT", assertThrows(ApiException.class, () -> service.resolve(value)).code);
    }
    @Test void missingOrInvalidRegistryCannotSilentlyEnableAProvider() throws Exception {
        RichTextService service = new RichTextService(root); ObjectNode value = manifest(); value.set("requiresRichText", requirement("advanced-v1"));
        assertEquals("RICHTEXT_SERVICE_UNAVAILABLE", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        ObjectNode invalid = registry("1.1.2"); ((ObjectNode) invalid.at("/profiles/0/provider")).put("version", "../../unsafe"); registry(invalid);
        assertEquals("INVALID_RICHTEXT_SERVICE", assertThrows(ApiException.class, () -> service.resolve(value)).code);
        invalid = registry("1.1.2"); ((ObjectNode) invalid.at("/profiles/0")).withArray("capabilities").add("tables"); registry(invalid);
        assertEquals("INVALID_RICHTEXT_SERVICE", assertThrows(ApiException.class, () -> service.resolve(value)).code);
    }
}
