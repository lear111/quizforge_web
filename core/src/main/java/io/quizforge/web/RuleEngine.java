package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class RuleEngine {
    private final Path codeRoot;
    private final String node;
    private final Duration deadline;
    private final boolean permissions;
    RuleEngine(Path codeRoot, String node, Duration deadline) throws IOException {
        this.codeRoot = codeRoot; this.node = node; this.deadline = deadline;
        ProcessBuilder probeBuilder = new ProcessBuilder(node, "--permission", "-e", "process.stdout.write('ok')"); sanitizeEnvironment(probeBuilder);
        Process probe = probeBuilder.start();
        try { permissions = probe.waitFor(3, TimeUnit.SECONDS) && probe.exitValue() == 0; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException("Node check interrupted", e); }
        finally { if (probe.isAlive()) probe.destroyForcibly(); }
        if (!permissions) System.err.println("Node filesystem permissions unavailable; install Node 24 for the supported restriction mode.");
    }
    JsonNode run(Library.Extension extension, ObjectNode request) {
        boolean development = DevelopmentExtensions.runtimeMetadata(extension) != null;
        request.put("development", development);
        if (development && extension.rules() == null) return developmentProjection(request);
        request.set("apiVersion", ExtensionApi.version());
        request.put("outlineItemsDeclared", extension.outlineItemsDeclared());
        request.put("rules", extension.rules().toString());
        if (extension.questionSchema() == null) request.putNull("questionSchema"); else request.put("questionSchema", extension.questionSchema().toString());
        if (extension.answerSchema() == null) request.putNull("answerSchema"); else request.put("answerSchema", extension.answerSchema().toString());
        List<String> command = new ArrayList<>(List.of(node, "--max-old-space-size=96", "--disable-proto=throw"));
        Path runner = codeRoot.resolve("server/rules-runner.cjs");
        if (permissions) {
            command.add("--permission");
            for (Path allowed : new Path[]{runner, codeRoot.resolve("node_modules"), extension.rules(), extension.questionSchema(), extension.answerSchema()}) if (allowed != null) command.add("--allow-fs-read=" + allowed);
        }
        command.add(runner.toString());
        Process process = null;
        try {
            byte[] input = Json.MAPPER.writeValueAsBytes(request);
            if (input.length > 8 * 1024 * 1024) throw new ApiException(413, "RULE_INPUT_TOO_LARGE", "Rule input exceeds the size limit");
            ProcessBuilder builder = new ProcessBuilder(command).directory(codeRoot.toFile());
            // Explicit allowlist: no inherited tokens, provider keys, NODE_OPTIONS, or user secrets.
            sanitizeEnvironment(builder);
            process = builder.start();
            final Process child = process;
            AtomicBoolean overflow = new AtomicBoolean();
            CompletableFuture<byte[]> output = CompletableFuture.supplyAsync(() -> readBounded(child.getInputStream(), 2 * 1024 * 1024, child, overflow));
            CompletableFuture<byte[]> error = CompletableFuture.supplyAsync(() -> readBounded(child.getErrorStream(), 64 * 1024, child, overflow));
            CompletableFuture<Void> write = CompletableFuture.runAsync(() -> { try (var stream = child.getOutputStream()) { stream.write(input); } catch (IOException ignored) { } });
            if (!process.waitFor(deadline.toMillis(), TimeUnit.MILLISECONDS)) { process.destroyForcibly(); throw new ApiException(422, "RULE_TIMEOUT", "Extension rules exceeded their execution deadline"); }
            byte[] bytes = output.get(2, TimeUnit.SECONDS); error.get(2, TimeUnit.SECONDS); write.get(2, TimeUnit.SECONDS);
            if (overflow.get()) throw new ApiException(422, "RULE_OUTPUT_LIMIT", "Extension rules exceeded their output limit");
            JsonNode response = Json.MAPPER.readTree(bytes);
            if (development && response != null && response.path("code").asText().equals("DEVELOPMENT_NOT_IMPLEMENTED")) throw notImplemented();
            if (response != null && response.path("code").asText().equals("SCORE_UNAVAILABLE")) throw new ApiException(422, "SCORE_UNAVAILABLE", "题型拓展尚未提供有效的分值接口，请实现 getScore 并返回 score、maxScore。");
            if (response != null && response.path("code").asText().equals("INVALID_OUTLINE_ITEMS")) throw new ApiException(422, "INVALID_OUTLINE_ITEMS", "题型拓展的小题目录无效，请检查 outline-items 声明及 getOutlineItems 返回的唯一 id 和纯文本 label。");
            if (response != null && response.path("code").asText().equals("INVALID_OUTLINE_STATES")) throw new ApiException(422, "INVALID_OUTLINE_STATES", "题型拓展的 getScore 返回了无效的小题状态，请检查 outlineStates 的唯一 id 和 status。");
            if (process.exitValue() != 0 || response == null || !response.path("ok").asBoolean()) throw new ApiException(422, "RULE_REJECTED", "Extension rules rejected or could not process this data");
            return response.get("data");
        } catch (ApiException e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException(503, "RULE_UNAVAILABLE", "Rule execution interrupted"); }
        catch (Exception e) { throw new ApiException(503, "RULE_UNAVAILABLE", "Rule engine unavailable; verify Node and installed dependencies"); }
        finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
    }
    private static ObjectNode developmentProjection(ObjectNode request) {
        ObjectNode value = Json.object(); String operation = request.path("op").asText();
        switch (operation) {
            case "validateBank" -> value.put("valid", true);
            case "project" -> value.set("projected", request.path("data").deepCopy());
            case "projectBatch" -> { var projected = value.putArray("projected"); for (JsonNode question : request.path("questions")) projected.add(question.path("data").deepCopy()); }
            case "outlineBatch" -> { var items = value.putArray("outlineItems"); for (JsonNode ignored : request.path("questions")) items.addArray(); }
            case "capabilities" -> { value.put("canAiGrade", false); value.put("canOutlineItems", false); }
            default -> throw notImplemented();
        }
        if (request.path("withCapabilities").asBoolean()) value.set("capabilities", Json.object().put("canAiGrade", false).put("canOutlineItems", false));
        try { if (Json.MAPPER.writeValueAsBytes(value).length > 2 * 1024 * 1024) throw new ApiException(422, "RULE_OUTPUT_LIMIT", "Development projection exceeded the rule output limit"); }
        catch (IOException error) { throw new ApiException(503, "RULE_UNAVAILABLE", "Development projection could not be encoded"); }
        return value;
    }
    private static ApiException notImplemented() { return new ApiException(422, "DEVELOPMENT_NOT_IMPLEMENTED", "开发版拓展尚未实现当前操作，请补齐对应规则、数据结构或评分接口；当前输入已保留。"); }
    private static void sanitizeEnvironment(ProcessBuilder builder) {
        var environment = builder.environment(); var previous = new java.util.HashMap<>(environment); environment.clear();
        for (var entry : previous.entrySet()) if (List.of("SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT").contains(entry.getKey().toUpperCase(java.util.Locale.ROOT))) environment.put(entry.getKey(), entry.getValue());
    }
    private static byte[] readBounded(InputStream stream, int max, Process child, AtomicBoolean overflow) {
        try (stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int size;
            while ((size = stream.read(buffer)) != -1) { if (output.size() + size > max) { overflow.set(true); child.destroyForcibly(); return new byte[0]; } output.write(buffer, 0, size); }
            return output.toByteArray();
        } catch (IOException e) { return new byte[0]; }
    }
}
