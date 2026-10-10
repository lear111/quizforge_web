package io.quizforge.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class TransientResourceTest {
    @TempDir Path root;
    private static ObjectNode image(int marker) {
        byte[] png = new byte[24]; png[0] = (byte) 0x89;
        System.arraycopy(new byte[]{'P','N','G',13,10,26,10}, 0, png, 1, 7);
        System.arraycopy(new byte[]{'I','H','D','R'}, 0, png, 12, 4); png[23] = (byte) marker;
        return Json.object().put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(png));
    }
    @Test void practiceImagesArePageScopedWithoutWritingFiles() throws Exception {
        ResourceStore store = ResourceStore.memory(root, null);
        ObjectNode uploaded = store.upload(image(1)); String id = uploaded.path("id").asText();
        assertEquals(24, store.read(id).bytes().length); assertEquals(24, store.memoryBytes());
        store.upload(image(1)); assertEquals(24, store.memoryBytes());
        byte[] bytes = store.read(id).bytes(); bytes[23] = 2;
        assertEquals(1, store.read(id).bytes()[23]);
        assertFalse(Files.exists(root.resolve(".state")));
        ResourceStore nextPage = ResourceStore.memory(root, null);
        assertEquals("RESOURCE_NOT_FOUND", assertThrows(ApiException.class, () -> nextPage.read(id)).code);
        store.clearMemory(); assertEquals(0, store.memoryBytes());
        assertEquals("RESOURCE_NOT_FOUND", assertThrows(ApiException.class, () -> store.read(id)).code);
    }
    @Test void memoryReadsExistingQuestionImagesButCannotLeakAnotherPagesUploads() throws Exception {
        ResourceStore durable = new ResourceStore(root);
        String questionImage = durable.upload(image(1)).path("id").asText();
        ResourceStore page = ResourceStore.memory(root, durable);
        assertEquals(1, page.read(questionImage).bytes()[23]);
        String answerImage = page.upload(image(2)).path("id").asText();
        assertEquals(2, page.read(answerImage).bytes()[23]);
        assertEquals("RESOURCE_NOT_FOUND", assertThrows(ApiException.class, () -> durable.read(answerImage)).code);
        assertEquals("RESOURCE_NOT_FOUND", assertThrows(ApiException.class, () -> ResourceStore.memory(root, durable).read(answerImage)).code);
    }
}
