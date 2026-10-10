package io.quizforge.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class AiSettingsTest {
    @TempDir Path root;

    @Test void automaticGradingDefaultsOffAndLegacyStoredProfilesRemainOff() throws Exception {
        AiSettings settings = new AiSettings(root);
        assertFalse(settings.profile().autoGrade()); assertFalse(settings.status().path("autoGrade").asBoolean());
        settings.update(Json.object().put("autoGrade", true));
        Path file = root.resolve(".state/ai/profile.json"); ObjectNode legacy = (ObjectNode) Json.read(file, 32 * 1024);
        legacy.remove("autoGrade"); Files.writeString(file, legacy.toString());
        assertFalse(new AiSettings(root).profile().autoGrade());
        assertFalse(new AiSettings.Profile(false, null, "", "", false, "json", 2048, 60).autoGrade());
    }

    @Test void automaticGradingPersistsAndUnrelatedPartialUpdatesPreserveItWithoutExposingCredentials() throws Exception {
        AiSettings settings = new AiSettings(root);
        settings.update(Json.object().put("enabled", true).put("baseUrl", "https://example.test/v1").put("model", "test-model").put("apiKey", "fake-settings-key").put("autoGrade", true));
        assertTrue(settings.profile().autoGrade()); assertTrue(settings.status().path("autoGrade").asBoolean());
        assertFalse(settings.status().has("apiKey")); assertFalse(settings.status().toString().contains("fake-settings-key"));
        settings.update(Json.object().put("timeoutSeconds", 90));
        AiSettings restored = new AiSettings(root);
        assertTrue(restored.profile().autoGrade()); assertEquals(90, restored.profile().timeoutSeconds());
        assertEquals("fake-settings-key", restored.profile().apiKey());
        restored.update(Json.object().put("autoGrade", false));
        assertFalse(new AiSettings(root).profile().autoGrade());
    }

    @Test void invalidAutomaticGradingValuesRejectWithoutChangingSavedSettings() throws Exception {
        AiSettings settings = new AiSettings(root); settings.update(Json.object().put("autoGrade", true));
        Path file = root.resolve(".state/ai/profile.json"); byte[] saved = Files.readAllBytes(file);
        for (ObjectNode invalid : new ObjectNode[]{Json.object().putNull("autoGrade"), Json.object().put("autoGrade", "true"), Json.object().put("autoGrade", 1)}) {
            assertThrows(ApiException.class, () -> settings.update(invalid)); assertTrue(settings.profile().autoGrade());
            assertArrayEquals(saved, Files.readAllBytes(file));
        }
    }
}
