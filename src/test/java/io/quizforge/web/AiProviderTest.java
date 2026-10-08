package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class AiProviderTest {
    @TempDir Path root;
    static final String KEY = "fake-test-key-never-a-real-credential";
    HttpServer mock; AiSettings settings; OpenAiCompatibleProvider gateway; ResourceStore resources;
    final AtomicInteger calls = new AtomicInteger(), status = new AtomicInteger(200);
    final AtomicReference<String> body = new AtomicReference<>(), authorization = new AtomicReference<>(), retryAfter = new AtomicReference<>();
    final AtomicReference<JsonNode> captured = new AtomicReference<>();
    @BeforeEach void prepare() throws Exception {
        Files.createDirectories(root.resolve(".state")); settings = new AiSettings(root); resources = new ResourceStore(root); gateway = new OpenAiCompatibleProvider(settings, resources);
        mock = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        mock.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet(); authorization.set(exchange.getRequestHeaders().getFirst("Authorization")); captured.set(Json.MAPPER.readTree(exchange.getRequestBody().readAllBytes()));
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8); exchange.getResponseHeaders().set("Content-Type", "application/json"); if (retryAfter.get() != null) exchange.getResponseHeaders().set("Retry-After", retryAfter.get()); exchange.sendResponseHeaders(status.get(), bytes.length);
            try { exchange.getResponseBody().write(bytes); } catch (java.io.IOException ignored) { } finally { exchange.close(); }
        }); mock.start(); reply("{\"score\":2.5,\"feedback\":\"理由\"}");
        settings.update(config());
    }
    @AfterEach void close() { if (mock != null) mock.stop(0); }
    ObjectNode config() { return Json.object().put("enabled", true).put("baseUrl", "http://127.0.0.1:" + mock.getAddress().getPort() + "/v1").put("model", "test-model").put("apiKey", KEY).put("vision", true).put("outputMode", "schema"); }
    ObjectNode input() {
        ObjectNode input = Json.object().put("protocolVersion", 1).put("maxScore", 5).put("scoreStep", 0.5);
        for (String field : new String[]{"question", "answer", "referenceAnswer", "rubric"}) input.putArray(field).add(Json.object().put("type", "text").put("text", field + " 内容")); return input;
    }
    void reply(String output) { ObjectNode result = Json.object().put("id", "response-test"); ObjectNode choice = Json.object().put("finish_reason", "stop"); choice.set("message", Json.object().put("content", output)); result.putArray("choices").add(choice); result.set("usage", Json.object().put("total_tokens", 10).put("unsafe_provider_metadata", KEY)); body.set(result.toString()); }
    AiGateway.Response generate(ObjectNode input) { return gateway.generate(new AiGateway.Request(input, false, null)); }
    @Test void credentialsAreMaskedRetainedClearedAndProtectedAcrossRestart() throws Exception {
        assertTrue(settings.status().path("apiKeyConfigured").asBoolean()); assertFalse(settings.status().toString().contains(KEY)); assertFalse(settings.profile().toString().contains(KEY));
        settings.update(Json.object().put("apiKey", "")); assertEquals(KEY, settings.profile().apiKey()); assertEquals(KEY, new AiSettings(root).profile().apiKey());
        Path directory = root.resolve(".state/ai"), file = directory.resolve("profile.json");
        var posix = Files.getFileAttributeView(file, PosixFileAttributeView.class);
        if (posix != null) assertEquals(PosixFilePermissions.fromString("rw-------"), posix.readAttributes().permissions());
        else {
            var owner = Files.getOwner(file); var acl = Files.getFileAttributeView(file, AclFileAttributeView.class);
            assertTrue(acl.getAcl().stream().filter(entry -> entry.type() == AclEntryType.ALLOW && entry.permissions().contains(AclEntryPermission.READ_DATA)).allMatch(entry -> entry.principal().equals(owner)));
        }
        settings.update(Json.object().put("clearApiKey", true)); assertFalse(settings.status().path("apiKeyConfigured").asBoolean()); assertEquals("", new AiSettings(root).profile().apiKey());
        byte[] before = Files.readAllBytes(file);
        for (String url : new String[]{"http://8.8.8.8/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=value", "https://example.com/v1#fragment", "file:///tmp/config", "https://example.com/a/../v1"}) assertThrows(ApiException.class, () -> settings.update(Json.object().put("baseUrl", url)));
        assertArrayEquals(before, Files.readAllBytes(file));
        Files.writeString(file, "{\"apiKey\":\"" + KEY + "\",invalid}"); java.io.IOException error = assertThrows(java.io.IOException.class, () -> new AiSettings(root)); assertFalse(error.getMessage().contains(KEY)); assertNull(error.getCause());
    }
    @Test void singleCallUsesServerPromptSchemaAndImmutableLocalImageData() throws Exception {
        byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=");
        String image = resources.upload(Json.object().put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(png))).path("id").asText();
        ObjectNode input = input(); ((ArrayNode) input.path("answer")).add(Json.object().put("type", "image").put("assetId", image).put("alt", "学生图片"));
        reply("{\"score\":2.5,\"feedback\":\"理由 " + KEY + "\"}"); AiGateway.Response response = generate(input);
        assertEquals(1, calls.get()); assertEquals("Bearer " + KEY, authorization.get()); assertFalse(captured.get().path("stream").asBoolean(true)); assertEquals("test-model", captured.get().path("model").asText()); assertEquals("json_schema", captured.get().at("/response_format/type").asText());
        assertTrue(captured.get().at("/messages/0/content").asText().contains("JSON")); assertFalse(captured.get().toString().contains(image));
        boolean found = false; for (JsonNode part : captured.get().at("/messages/1/content")) if (part.path("type").asText().equals("image_url")) { found = true; assertEquals("data:image/png;base64," + Base64.getEncoder().encodeToString(png), part.at("/image_url/url").asText()); } assertTrue(found);
        assertFalse(response.output().contains(KEY)); assertEquals("openai-compatible", response.provider()); assertEquals(10, response.usage().path("total_tokens").asInt()); assertFalse(response.usage().has("unsafe_provider_metadata"));
        generate(input); assertEquals(2, calls.get(), "Provider performs one call per invocation");
    }
    @Test void invalidImageReferencesVisionAndInputBudgetsFailBeforeCallingModel() throws Exception {
        ObjectNode withImage = input(); ((ArrayNode) withImage.path("question")).add(Json.object().put("type", "image").put("assetId", "a".repeat(64)));
        settings.update(Json.object().put("vision", false)); assertEquals("AI_VISION_UNSUPPORTED", assertThrows(AiProviderException.class, () -> generate(withImage)).code);
        settings.update(Json.object().put("vision", true)); assertEquals("AI_IMAGE_UNAVAILABLE", assertThrows(AiProviderException.class, () -> generate(withImage)).code);
        ((ObjectNode) withImage.path("question").get(1)).put("url", "https://untrusted.example/image.png"); assertEquals("AI_CONFIG", assertThrows(AiProviderException.class, () -> generate(withImage)).code);
        ObjectNode large = input(); ((ObjectNode) large.path("question").get(0)).put("text", "x".repeat(OpenAiCompatibleProvider.MAX_TEXT)); assertEquals("AI_INPUT_LIMIT", assertThrows(AiProviderException.class, () -> generate(large)).code);
        assertEquals(0, calls.get());
    }
    @Test void upstreamErrorsAreClassifiedWithoutSecretsOrProviderMessagesAndNeverRetried() {
        body.set("{\"error\":{\"code\":\"invalid_request\",\"message\":\"" + KEY + " internal detail\"}}");
        for (int code : new int[]{400, 401, 403, 404, 429, 500, 503}) {
            status.set(code); retryAfter.set("9999"); int before = calls.get(); AiProviderException error = assertThrows(AiProviderException.class, () -> generate(input()));
            assertEquals(before + 1, calls.get()); assertFalse(error.getMessage().contains(KEY)); assertFalse(error.getMessage().contains("internal detail")); assertEquals(code == 429 || code >= 500, error.retryable); assertTrue(error.retryAfterMillis <= 5000);
        }
        for (String quotaCode : new String[]{"insufficient_quota", "Arrearage", "allocation_quota_exceeded", "AllocationQuota.FreeTierOnly", "BudgetLimitExceeded"}) { status.set(quotaCode.equals("AllocationQuota.FreeTierOnly") ? 403 : 429); body.set("{\"error\":{\"code\":\"" + quotaCode + "\",\"message\":\"" + KEY + "\"}}"); AiProviderException quota = assertThrows(AiProviderException.class, () -> generate(input())); assertEquals("AI_QUOTA", quota.code); assertFalse(quota.retryable); }
        status.set(429); body.set("{\"error\":{\"code\":\"Throttling.AllocationQuota\"}}"); AiProviderException rate = assertThrows(AiProviderException.class, () -> generate(input())); assertEquals("AI_RATE_LIMIT", rate.code); assertTrue(rate.retryable);
    }
    @Test void boundedCompleteResponsesAndExplicitConnectionTestReturnOnlySafeMetadata() throws Exception {
        body.set("x".repeat(OpenAiCompatibleProvider.MAX_RESPONSE_BYTES + 1)); assertEquals("AI_RESPONSE_LIMIT", assertThrows(AiProviderException.class, () -> generate(input())).code);
        for (String invalid : new String[]{"{", "", "null", "[]"}) { body.set(invalid); assertEquals("AI_RESPONSE_INVALID", assertThrows(AiProviderException.class, () -> generate(input())).code); }
        reply("{\"score\":0,\"feedback\":\"连接正常\"}"); settings.update(Json.object().put("enabled", false).put("outputMode", "json")); int before = calls.get();
        ObjectNode tested = gateway.testConnection(); assertEquals(before + 1, calls.get()); assertTrue(tested.path("ok").asBoolean()); assertFalse(tested.toString().contains(KEY)); assertFalse(tested.has("output")); assertEquals("json_object", captured.get().at("/response_format/type").asText()); assertFalse(captured.get().toString().contains("answer 内容"));
        assertEquals("AI_NOT_CONFIGURED", assertThrows(AiProviderException.class, () -> generate(input())).code);
    }
    @Test void repairIsOneSeparateCallAndUsesInvalidOutputAsData() {
        gateway.generate(new AiGateway.Request(input(), true, "```not valid JSON```")); assertEquals(1, calls.get()); assertTrue(captured.get().toString().contains("not valid JSON"));
        assertEquals("AI_INPUT_LIMIT", assertThrows(AiProviderException.class, () -> gateway.generate(new AiGateway.Request(input(), true, "x".repeat(24001)))).code); assertEquals(1, calls.get());
    }
    @Test void truncatedOrFilteredCompletionCannotBecomeCandidateAndFrozenTaskKeepsItsProfile() throws Exception {
        reply("{\"score\":2.5,\"feedback\":\"完整JSON也不能接受截断标记\"}"); body.set(body.get().replace("\"stop\"", "\"length\"")); assertEquals("AI_RESPONSE_INVALID", assertThrows(AiProviderException.class, () -> generate(input())).code);
        body.set(body.get().replace("\"length\"", "\"content_filter\"")); assertEquals("AI_REFUSED", assertThrows(AiProviderException.class, () -> generate(input())).code);
        reply("{\"score\":2.5,\"feedback\":\"正常\"}"); AiGateway frozen = gateway.freeze(); settings.update(Json.object().put("model", "changed-model").put("apiKey", "replacement-fake-key"));
        AiGateway.Response response = frozen.generate(new AiGateway.Request(input(), false, null)); assertEquals("test-model", captured.get().path("model").asText()); assertEquals("Bearer " + KEY, authorization.get()); assertEquals("test-model", response.model());
        generate(input()); assertEquals("changed-model", captured.get().path("model").asText()); assertEquals("Bearer replacement-fake-key", authorization.get());
    }
}
