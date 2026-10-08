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
    private final Path root;
    private final String node;
    private final Duration deadline;
    private final boolean permissions;
    RuleEngine(Path root, String node, Duration deadline) throws IOException {
        this.root = root; this.node = node; this.deadline = deadline;
        ProcessBuilder probeBuilder = new ProcessBuilder(node, "--permission", "-e", "process.stdout.write('ok')"); sanitizeEnvironment(probeBuilder);
        Process probe = probeBuilder.start();
        try { permissions = probe.waitFor(3, TimeUnit.SECONDS) && probe.exitValue() == 0; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException("Node check interrupted", e); }
        finally { if (probe.isAlive()) probe.destroyForcibly(); }
        if (!permissions) System.err.println("Node filesystem permissions unavailable; install Node 24 for the supported restriction mode.");
    }
    JsonNode run(Library.Extension extension, ObjectNode request) {
        request.put("rules", extension.rules().toString()); request.put("questionSchema", extension.questionSchema().toString()); request.put("answerSchema", extension.answerSchema().toString());
        List<String> command = new ArrayList<>(List.of(node, "--max-old-space-size=96", "--disable-proto=throw"));
        Path runner = root.resolve("server/rules-runner.cjs");
        if (permissions) {
            command.add("--permission");
            for (Path allowed : List.of(runner, root.resolve("node_modules"), extension.rules(), extension.questionSchema(), extension.answerSchema())) command.add("--allow-fs-read=" + allowed);
        }
        command.add(runner.toString());
        Process process = null;
        try {
            byte[] input = Json.MAPPER.writeValueAsBytes(request);
            if (input.length > 8 * 1024 * 1024) throw new ApiException(413, "RULE_INPUT_TOO_LARGE", "Rule input exceeds the size limit");
            ProcessBuilder builder = new ProcessBuilder(command).directory(root.toFile());
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
            if (response != null && response.path("code").asText().equals("SCORE_UNAVAILABLE")) throw new ApiException(422, "SCORE_UNAVAILABLE", "题型拓展尚未提供有效的分值接口，请实现 getScore 并返回 score、maxScore。");
            if (process.exitValue() != 0 || response == null || !response.path("ok").asBoolean()) throw new ApiException(422, "RULE_REJECTED", "Extension rules rejected or could not process this data");
            return response.get("data");
        } catch (ApiException e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException(503, "RULE_UNAVAILABLE", "Rule execution interrupted"); }
        catch (Exception e) { throw new ApiException(503, "RULE_UNAVAILABLE", "Rule engine unavailable; verify Node and installed dependencies"); }
        finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
    }
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
