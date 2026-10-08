package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.LinkedHashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

final class StateStore {
    private final Path directory;
    private final RuleEngine rules;
    private final EditJournal edits;
    private record CachedState(ObjectNode value, long encodedBytes) { }
    private final Map<String, CachedState> cache = new LinkedHashMap<>(8, 0.75f, true);
    private long cachedBytes;
    private final Map<String, Boolean> aiSupport = new LinkedHashMap<>(16, 0.75f, true);
    record AiSnapshot(String stateKey, String roundId, String questionFingerprint, String extensionFingerprint,
                      String answerHash, long submissionGeneration, long gradingGeneration, ObjectNode gradingInput) { }
    private final byte[] stampKey = new byte[32];
    StateStore(Path root, RuleEngine rules) throws IOException {
        directory = root.resolve(".state"); this.rules = rules;
        new SecureRandom().nextBytes(stampKey);
        if (Files.isSymbolicLink(directory)) throw new IOException("State directory cannot be a symlink"); Files.createDirectories(directory);
        edits = new EditJournal(root); edits.recover();
    }
    synchronized ObjectNode overview(Library.Collection collection) {
        return overviewValue(collection, load(collection));
    }
    synchronized ObjectNode stamp(Library.Collection collection, Library.Question question) {
        return stamp(collection, question, questionState(load(collection), collection, question));
    }
    synchronized ObjectNode question(Library.Collection collection, Library.Question question) {
        return response(collection, question, questionState(load(collection), collection, question), null);
    }
    synchronized ObjectNode summary(Library.Collection collection) {
        ObjectNode persisted = load(collection), round = summaryRound(persisted, collection);
        ObjectNode result = scoreSummary(collection, persisted, round);
        result.put("summaryVersion", summaryVersion(collection, persisted, result)); return result;
    }
    synchronized ObjectNode finish(Library.Collection collection, JsonNode request) {
        if (request == null || !request.isObject()) throw ApiException.bad("Finish request must be an object");
        String requestId = Json.id(request, "requestId"); if (requestId.length() < 8) throw ApiException.bad("requestId must have at least 8 characters");
        ObjectNode persisted = load(collection);
        for (JsonNode receipt : persisted.path("finishReceipts")) if (receipt.path("id").asText().equals(requestId)) {
            if (!receipt.path("request").equals(request)) throw new ApiException(409, "REQUEST_ID_REUSED", "Request ID was already used with different data");
            return (ObjectNode) receipt.path("response").deepCopy();
        }
        ObjectNode current = summary(collection);
        if (!request.has("roundId") || !(request.path("roundId").isNull() || request.path("roundId").isTextual())) throw ApiException.bad("Invalid roundId");
        if (!request.path("roundId").equals(current.path("roundId")) || !Json.text(request, "summaryVersion", 64).equals(current.path("summaryVersion").asText()))
            throw new ApiException(409, "SUMMARY_CONFLICT", "练习内容已改变，请刷新分值卡后再完成练习。");
        if (current.path("finished").asBoolean()) return current.put("historyId", current.path("roundId").asText());
        if (current.path("pendingCount").asInt() > 0) throw new ApiException(409, "PENDING_REVIEW", "还有已提交的题目等待评分，请确认评分后再完成练习。");
        ObjectNode replacement = persisted.deepCopy(), round = summaryRound(replacement, collection);
        if (round == null) {
            interruptRound(replacement, "collection-changed");
            round = freezeRound(collection, replacement, summaryStates(replacement, collection, null));
            ArrayNode rounds = replacement.has("historyRounds") ? (ArrayNode) replacement.get("historyRounds") : replacement.putArray("historyRounds"); rounds.add(round);
        } else if (round.path("status").asText().equals("in-progress")) {
            // Preserve the round's submitted answers; capture any newer saved choices and ink.
            for (int i = 0; i < collection.questions().size(); i++) {
                ObjectNode payload = (ObjectNode) round.path("questions").get(i).path("payload");
                ObjectNode state = questionState(replacement, collection, collection.questions().get(i));
                if (!payload.at("/state/status").asText().equals("submitted")) payload.set("state", publicState(unsubmittedState(state)));
                payload.set("draft", state.path("draft").deepCopy());
            }
        }
        String now = java.time.Instant.now().toString(); round.put("explicitCompletion", true).put("status", "completed").put("finishedAt", now).put("updatedAt", now);
        ObjectNode versions = round.putObject("completionVersions");
        for (Library.Question question : collection.questions()) versions.put(question.id(), questionState(replacement, collection, question).path("revision").asLong());
        ObjectNode saved = current.deepCopy(); saved.remove("summaryVersion"); saved.put("roundId", round.path("id").asText()).put("finished", true).put("status", "completed"); round.set("summary", saved);
        HistoryRounds.summarize(round);
        ObjectNode result = saved.deepCopy().put("historyId", round.path("id").asText()); result.put("summaryVersion", summaryVersion(collection, replacement, saved));
        ArrayNode receipts = replacement.has("finishReceipts") ? (ArrayNode) replacement.get("finishReceipts") : replacement.putArray("finishReceipts");
        ObjectNode receipt = Json.object().put("id", requestId); receipt.set("request", request.deepCopy()); receipt.set("response", result.deepCopy()); receipts.add(receipt);
        while (receipts.size() > 32) receipts.remove(0);
        long bytes = persist(collection, replacement); remember(collection, replacement, bytes); return result;
    }
    private ObjectNode scoreSummary(Library.Collection collection, ObjectNode persisted, ObjectNode round) {
        if (round != null && round.path("finishedAt").isTextual() && round.path("summary").isObject()) {
            ObjectNode saved = (ObjectNode) round.path("summary").deepCopy();
            if (!saved.has("gradedCount")) saved.put("gradedCount", saved.path("submittedCount").asInt());
            if (!saved.has("pendingCount")) saved.put("pendingCount", 0);
            for (JsonNode row : saved.path("questions")) if (!row.has("gradingStatus")) ((ObjectNode) row).put("gradingStatus", row.path("submitted").asBoolean() ? "graded" : "unsubmitted");
            return saved;
        }
        var states = summaryStates(persisted, collection, round); var input = new java.util.ArrayList<JsonNode>();
        for (int i = 0; i < collection.questions().size(); i++) { ObjectNode question = Json.object(); question.set("data", collection.questions().get(i).data()); question.set("state", publicState(states.get(i))); input.add(question); }
        JsonNode scores = runBatch(collection, collection.questions(), "scoreBatch", "scores", input);
        if (!scores.isArray() || scores.size() != input.size()) throw new ApiException(422, "SCORE_UNAVAILABLE", "题型拓展返回的分值无效。");
        ObjectNode summary = Json.object().put("questionCount", input.size()).put("submittedCount", 0).put("finished", false).put("status", "in-progress");
        if (round == null) summary.putNull("roundId"); else summary.put("roundId", round.path("id").asText());
        java.math.BigDecimal score = java.math.BigDecimal.ZERO, maxScore = java.math.BigDecimal.ZERO; int submitted = 0, graded = 0, pending = 0; ArrayNode rows = summary.putArray("questions");
        for (int i = 0; i < input.size(); i++) {
            JsonNode value = scores.get(i); boolean answered = states.get(i).path("status").asText().equals("submitted");
            String gradingStatus = answered ? HistoryRounds.gradingStatus(states.get(i).path("result")) : "unsubmitted";
            boolean awaiting = gradingStatus.equals("pending");
            java.math.BigDecimal earned = answered && !awaiting ? value.path("score").decimalValue() : java.math.BigDecimal.ZERO;
            score = score.add(earned); maxScore = maxScore.add(value.path("maxScore").decimalValue()); if (answered) { submitted++; if (awaiting) pending++; else graded++; }
            ObjectNode row = Json.object().put("id", collection.questions().get(i).id()).put("maxScore", value.path("maxScore").decimalValue()).put("submitted", answered).put("gradingStatus", gradingStatus);
            if (awaiting) row.putNull("score"); else row.put("score", earned); rows.add(row);
        }
        return summary.put("score", score).put("maxScore", maxScore).put("submittedCount", submitted).put("gradedCount", graded).put("pendingCount", pending);
    }
    private static java.util.List<ObjectNode> summaryStates(ObjectNode persisted, Library.Collection collection, ObjectNode round) {
        var states = new java.util.ArrayList<ObjectNode>();
        boolean noHistory = round == null && persisted.path("historyRounds").isEmpty() && persisted.path("history").isEmpty();
        for (int i = 0; i < collection.questions().size(); i++) {
            ObjectNode current = questionState(persisted, collection, collection.questions().get(i));
            JsonNode frozen = round == null ? null : round.path("questions").get(i).at("/payload/state");
            states.add(frozen != null && frozen.path("status").asText().equals("submitted") ? (ObjectNode) frozen.deepCopy() : noHistory ? current.deepCopy() : unsubmittedState(current));
        } return states;
    }
    private static ObjectNode summaryRound(ObjectNode persisted, Library.Collection collection) {
        ObjectNode active = activeRound(persisted); if (active != null) return roundCompatible(active, collection) ? active : null;
        JsonNode rounds = persisted.path("historyRounds"); if (!rounds.isArray() || rounds.isEmpty()) return null;
        ObjectNode last = (ObjectNode) rounds.get(rounds.size() - 1);
        if (!last.path("status").asText().equals("completed") || !roundCompatible(last, collection)) return null;
        for (int i = 0; i < collection.questions().size(); i++) {
            Library.Question question = collection.questions().get(i); ObjectNode current = questionState(persisted, collection, question);
            if (last.path("completionVersions").isObject()) {
                if (last.path("completionVersions").path(question.id()).asLong(-1) != current.path("revision").asLong()) return null;
            } else {
                JsonNode payload = last.path("questions").get(i).path("payload");
                JsonNode frozen = payload.path("state");
                if (frozen.path("revision").asLong(-1) != current.path("revision").asLong() || !frozen.path("status").asText().equals(current.path("status").asText())
                        || !frozen.path("answer").equals(current.path("answer")) || !frozen.path("result").equals(current.path("result"))
                        || !payload.path("draft").equals(current.path("draft"))) return null;
            }
        } return last;
    }
    private String summaryVersion(Library.Collection collection, ObjectNode persisted, ObjectNode summary) {
        StringBuilder versions = new StringBuilder(collection.extensionFingerprint());
        for (Library.Question question : collection.questions()) versions.append(':').append(question.id()).append(':').append(question.title()).append(':').append(question.fingerprint()).append(':').append(questionState(persisted, collection, question).path("revision").asLong());
        return opaqueVersion("summary", collection.stateKey(), versions.toString(), summary.toString());
    }
    synchronized ObjectNode editor(Library library, Library.Collection collection, Library.Question question) {
        if (!collection.kind().equals("bank")) throw new ApiException(409, "READ_ONLY_COLLECTION", "Extension examples cannot be edited as a bank");
        ObjectNode state = questionState(load(collection), collection, question), result = Json.object();
        ObjectNode raw = Json.object().put("id", question.id()).put("title", question.title()); raw.set("data", question.data().deepCopy()); result.set("question", raw);
        Library.Extension extension = collection.extensionFor(question);
        result.set("extension", extensionMetadata(extension)); result.put("revision", state.path("revision").asLong()).put("contentVersion", stamp(collection, question, state).path("contentVersion").asText());
        result.put("draftVersion", Json.fingerprint(raw, extension.fingerprint()));
        ObjectNode editor = library.editorPage(extension); if (editor == null) result.putNull("editor"); else result.set("editor", editor); return result;
    }
    synchronized ObjectNode edit(Library library, Library.Collection collection, Library.Question question, JsonNode request) {
        if (!collection.kind().equals("bank")) throw new ApiException(409, "READ_ONLY_COLLECTION", "Extension examples cannot be edited as a bank");
        if (request == null || !request.isObject()) throw ApiException.bad("Edit must be an object");
        String requestId = Json.id(request, "requestId"); if (requestId.length() < 8) throw ApiException.bad("requestId must have at least 8 characters");
        ObjectNode persisted = load(collection), current = questionState(persisted, collection, question);
        for (JsonNode receipt : persisted.path("editReceipts")) if (receipt.path("id").asText().equals(requestId)) {
            if (!receipt.path("questionId").asText().equals(question.id()) || !receipt.path("request").equals(request)) throw new ApiException(409, "REQUEST_ID_REUSED", "Request ID was already used with different data");
            return (ObjectNode) receipt.path("response").deepCopy();
        }
        JsonNode revision = request.get("revision"); if (revision == null || !revision.isIntegralNumber() || !revision.canConvertToLong() || revision.asLong() < 0) throw ApiException.bad("Invalid revision");
        String version = Json.text(request, "contentVersion", 64); if (!version.matches("[a-f0-9]{64}")) throw ApiException.bad("Invalid contentVersion");
        if (!version.equals(stamp(collection, question, current).path("contentVersion").asText())) throw new ApiException(409, "CONTENT_CONFLICT", "Question content changed; reload the editor before saving");
        if (revision.asLong() != current.path("revision").asLong()) throw new ApiException(409, "REVISION_CONFLICT", "Question practice changed; reload the editor before saving");
        if (revision.asLong() == Long.MAX_VALUE) throw new ApiException(409, "REVISION_LIMIT", "Question revision limit reached");
        String title = Json.text(request, "title", 300); if (!request.has("data")) throw ApiException.bad("Missing question data");
        Library.EditPlan plan = library.prepareEdit(collection, question.id(), title, request.get("data"));
        boolean changed = !question.data().equals(plan.question().data());
        ObjectNode replacement = persisted.deepCopy(), next = current.deepCopy();
        if (changed) { next.put("status", "unanswered"); next.putNull("answer"); next.putNull("result"); next.putNull("draft"); next.set("receipts", Json.MAPPER.createArrayNode()); }
        next.put("gradingGeneration", generation(current, "gradingGeneration") + 1); next.putNull("aiTaskId");
        if (changed) next.put("submissionGeneration", generation(current, "submissionGeneration") + 1);
        if (changed) interruptRound(replacement, "content-edited");
        next.put("revision", revision.asLong() + 1).put("fingerprint", plan.question().fingerprint()); ((ObjectNode) replacement.path("questions")).set(question.id(), next);
        ObjectNode result = Json.object(); result.set("payload", response(plan.collection(), plan.question(), next, null)); result.set("collection", overviewValue(plan.collection(), replacement));
        ArrayNode receipts = replacement.has("editReceipts") ? (ArrayNode) replacement.get("editReceipts") : replacement.putArray("editReceipts");
        ObjectNode receipt = Json.object().put("id", requestId).put("questionId", question.id()); receipt.set("request", request.deepCopy()); receipt.set("response", result.deepCopy()); receipts.add(receipt);
        while (receipts.size() > 32 || (receipts.size() > 1 && encodedSize(receipts) > 16 * 1024 * 1024)) receipts.remove(0);
        try { byte[] bytes = stateBytes(replacement); edits.commit(plan, file(collection), bytes); remember(plan.collection(), replacement, bytes.length); }
        catch (IOException e) { cache.clear(); cachedBytes = 0; throw new ApiException(503, "EDIT_PENDING", "Edit could not finish. Recovery journal is preserved; retry the same request after storage is available"); }
        return result;
    }
    synchronized ObjectNode history(String kind, String id, String historyId) {
        recoverEdits(); var records = new java.util.ArrayList<JsonNode>(); String prefix = kind + ":" + id + ":";
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(path -> path.getFileName().toString().matches("[a-f0-9]{64}\\.json")).sorted().toList()) {
                JsonNode saved = Json.read(file, 32 * 1024 * 1024);
                if (saved == null || !saved.isObject() || saved.path("schemaVersion").asInt() != 1 || !saved.path("collection").isTextual() || !saved.path("questions").isObject()) throw new IOException("Invalid saved history state");
                if (!saved.path("collection").asText().startsWith(prefix)) continue;
                if (saved.has("history") && !saved.path("history").isArray()) throw new IOException("Invalid saved history list");
                for (JsonNode record : saved.path("history")) validateHistory(record);
                var fileRecords = new java.util.ArrayList<JsonNode>(HistoryRounds.legacy(saved.path("history"), kind, id));
                if (saved.has("historyRounds") && !saved.path("historyRounds").isArray()) throw new IOException("Invalid saved history rounds");
                for (JsonNode record : saved.path("historyRounds")) { HistoryRounds.validate(record); fileRecords.add(record); }
                for (JsonNode record : fileRecords) { if (historyId != null && HistoryRounds.matchesId(record, historyId)) return HistoryRounds.publicRecord(record, false); records.add(record); }
            }
        } catch (IOException | RuntimeException e) { throw new ApiException(503, "HISTORY_UNAVAILABLE", "Saved history cannot be read; preserve the state directory for recovery"); }
        if (historyId != null) throw new ApiException(404, "HISTORY_NOT_FOUND", "History record does not exist");
        records.sort(java.util.Comparator.comparing((JsonNode record) -> java.time.Instant.parse(record.path("updatedAt").asText())).reversed()); ArrayNode summaries = Json.MAPPER.createArrayNode();
        for (JsonNode record : records) summaries.add(HistoryRounds.publicRecord(record, true));
        ObjectNode result = Json.object(); result.set("records", summaries); return result;
    }
    synchronized ObjectNode deleteHistory(String kind, String id, String historyId) {
        recoverEdits(); String prefix = kind + ":" + id + ":"; Path target = null; ObjectNode replacement = null;
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(path -> path.getFileName().toString().matches("[a-f0-9]{64}\\.json")).sorted().toList()) {
                JsonNode saved = Json.read(file, 32 * 1024 * 1024);
                if (saved == null || !saved.isObject() || saved.path("schemaVersion").asInt() != 1 || !saved.path("collection").isTextual() || !saved.path("questions").isObject()) throw new IOException("Invalid saved history state");
                if (!saved.path("collection").asText().startsWith(prefix)) continue;
                for (JsonNode state : saved.path("questions")) validateStoredState(state);
                if (saved.has("history") && !saved.path("history").isArray()) throw new IOException("Invalid saved history list");
                for (JsonNode record : saved.path("history")) validateHistory(record);
                if (saved.has("historyRounds") && !saved.path("historyRounds").isArray()) throw new IOException("Invalid saved history rounds");
                for (JsonNode record : saved.path("historyRounds")) HistoryRounds.validate(record);
                var legacy = HistoryRounds.legacy(saved.path("history"), kind, id);
                for (ObjectNode record : legacy) if (HistoryRounds.matchesId(record, historyId)) {
                    replacement = (ObjectNode) saved.deepCopy(); HistoryRounds.deleteLegacy(replacement, legacy, record); target = file; break;
                }
                if (target == null) for (int i = 0; i < saved.path("historyRounds").size(); i++) {
                    if (!HistoryRounds.matchesId(saved.path("historyRounds").get(i), historyId)) continue;
                    replacement = (ObjectNode) saved.deepCopy(); ((ArrayNode) replacement.path("historyRounds")).remove(i); target = file; break;
                }
                if (target != null) break;
            }
        } catch (IOException | RuntimeException e) { throw new ApiException(503, "HISTORY_UNAVAILABLE", "Saved history cannot be read; preserve the state directory for recovery"); }
        if (target == null) throw new ApiException(404, "HISTORY_NOT_FOUND", "History record does not exist");
        long encodedBytes = persist(target, replacement); remember(replacement.path("collection").asText(), replacement, encodedBytes);
        return Json.object().put("deleted", historyId);
    }
    synchronized void recover() { recoverEdits(); }
    /** Explicit compatible upgrade: old version state/history remain untouched. */
    synchronized void upgradeShortAnswer(Library.Collection previous, Library.EditPlan plan) throws IOException {
        ObjectNode old = load(previous); Library.Collection replacement = plan.collection();
        Path target = file(replacement);
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) throw new ApiException(409, "UPGRADE_STATE_EXISTS", "Target version already has saved practice; preserve both versions instead of overwriting");
        ObjectNode next = Json.object().put("schemaVersion", 1).put("collection", replacement.stateKey()).put("extensionFingerprint", replacement.extensionFingerprint());
        next.put("upgradedFrom", previous.stateKey()); ObjectNode questions = next.putObject("questions");
        ObjectNode oldSummary = summaryRound(old, previous);
        boolean completed = oldSummary != null && oldSummary.has("finishedAt");
        var states = new java.util.ArrayList<ObjectNode>(); boolean submitted = false;
        for (Library.Question question : replacement.questions()) {
            ObjectNode state = questionState(old, previous, previous.question(question.id())).deepCopy();
            // Completed history stays frozen; saved answers become drafts for a new practice round.
            if (completed) state = unsubmittedState(state);
            if (state.path("revision").asLong() == Long.MAX_VALUE) throw new ApiException(409, "REVISION_LIMIT", "Saved revision cannot be upgraded");
            state.put("revision", state.path("revision").asLong() + 1).put("fingerprint", question.fingerprint());
            state.set("receipts", Json.MAPPER.createArrayNode()); state.remove("aiTaskId");
            if (!state.path("answer").isNull()) {
                ObjectNode input = Json.object().put("op", "validateAnswer"); input.set("data", question.data()); input.set("answer", state.path("answer"));
                rules.run(replacement.extensionFor(question), input);
            }
            states.add(state); questions.set(question.id(), state); submitted |= state.path("status").asText().equals("submitted");
        }
        if (submitted) {
            ObjectNode round = freezeRound(replacement, next, states); round.put("upgradedFrom", previous.stateKey());
            next.putArray("historyRounds").add(round);
        }
        // A bank + new-version state use the existing durable recovery transaction.
        byte[] bytes = stateBytes(next); edits.commit(plan, target, bytes); remember(replacement, next, bytes.length);
    }
    synchronized ObjectNode act(Library.Collection collection, Library.Question question, JsonNode action) {
        return act(collection, question, action, null);
    }
    private ObjectNode act(Library.Collection collection, Library.Question question, JsonNode action, ObjectNode trustedAi) {
        if (action == null || !action.isObject()) throw ApiException.bad("Action must be an object");
        String requestId = Json.id(action, "requestId");
        if (requestId.length() < 8) throw ApiException.bad("requestId must have at least 8 characters");
        JsonNode revision = action.get("revision");
        if (revision == null || !revision.isIntegralNumber() || !revision.canConvertToLong() || revision.asLong() < 0) throw ApiException.bad("Invalid revision");
        String name = Json.text(action, "action", 30); JsonNode data = action.get("data");
        if (data == null || !data.isObject()) throw ApiException.bad("Action data must be an object");
        ObjectNode persisted = load(collection), current = questionState(persisted, collection, question);
        ArrayNode receipts = (ArrayNode) current.get("receipts");
        for (JsonNode receipt : receipts) if (receipt.path("id").asText().equals(requestId)) {
            if (!receipt.path("request").equals(action)) throw new ApiException(409, "REQUEST_ID_REUSED", "Request ID was already used with different data");
            return (ObjectNode) receipt.path("response").deepCopy();
        }
        JsonNode contentVersion = action.get("contentVersion");
        if (contentVersion != null) {
            if (!contentVersion.isTextual() || !contentVersion.asText().matches("[a-f0-9]{64}")) throw ApiException.bad("Invalid contentVersion");
            if (!contentVersion.asText().equals(stamp(collection, question, current).path("contentVersion").asText())) throw new ApiException(409, "CONTENT_CONFLICT", "题目内容或题型拓展已更新，请刷新题目后重试；本次修改未保存。");
        }
        if (revision.asLong() != current.path("revision").asLong()) throw new ApiException(409, "REVISION_CONFLICT", "Question changed; reload its latest state");
        if (current.path("revision").asLong() == Long.MAX_VALUE) throw new ApiException(409, "REVISION_LIMIT", "Question revision limit reached");
        ObjectNode next = current.deepCopy(); JsonNode projected = null;
        switch (name) {
            case "draft", "submit" -> {
                if (current.path("status").asText().equals("submitted")) throw new ApiException(409, "ALREADY_SUBMITTED", "Retry before changing a submitted answer");
                if (!data.has("answer")) throw ApiException.bad("Missing answer");
                ObjectNode request = Json.object().put("op", name.equals("submit") ? "submit" : "validateAnswer").put("withCapabilities", true); request.set("data", question.data()); request.set("answer", data.get("answer"));
                JsonNode evaluated = rules.run(collection.extensionFor(question), request);
                rememberAiSupport(collection.extensionFor(question), evaluated);
                next.set("answer", data.get("answer").deepCopy()); next.put("status", name.equals("submit") ? "submitted" : "draft");
                if (name.equals("submit")) { next.set("result", evaluated.get("result")); projected = evaluated.get("projected"); next.put("submissionGeneration", generation(current, "submissionGeneration") + 1).put("gradingGeneration", generation(current, "gradingGeneration") + 1).putNull("aiTaskId"); }
                else next.putNull("result");
            }
            case "retry" -> { next.put("status", "unanswered"); next.putNull("answer"); next.putNull("result"); next.put("submissionGeneration", generation(current, "submissionGeneration") + 1).put("gradingGeneration", generation(current, "gradingGeneration") + 1).putNull("aiTaskId"); }
            case "review" -> {
                if (!reviewAvailable(collection, question, current, persisted))
                    throw new ApiException(409, "REVIEW_UNAVAILABLE", "只能调整当前未完成练习中已提交题目的评分。");
                JsonNode review = data.get("review"); if (review == null || !review.isObject()) throw ApiException.bad("Missing review");
                finite(review, "score", 0, current.at("/result/maxScore").asDouble());
                ObjectNode request = Json.object().put("op", "review").put("withCapabilities", true); request.set("data", question.data()); request.set("answer", current.path("answer")); request.set("review", review);
                JsonNode evaluated = rules.run(collection.extensionFor(question), request); rememberAiSupport(collection.extensionFor(question), evaluated); next.set("result", AiGradingProtocol.decorateReview((ObjectNode) evaluated.get("result"), current.path("result"), trustedAi)); projected = evaluated.get("projected");
                next.put("gradingGeneration", generation(current, "gradingGeneration") + 1); if (trustedAi == null) next.putNull("aiTaskId");
            }
            case "whiteboard" -> { JsonNode draft = data.get("draft"); validateDraft(draft); next.set("draft", draft.deepCopy()); }
            default -> throw ApiException.bad("Unknown action");
        }
        next.put("revision", current.path("revision").asLong() + 1);
        ObjectNode result = response(collection, question, next, projected);
        ObjectNode replacement = persisted.deepCopy(); replacement.put("extensionFingerprint", collection.extensionFingerprint()); ((ObjectNode) replacement.get("questions")).set(question.id(), next);
        // A submission creates/updates its active round below. Freeze the same capability
        // that will be returned to the caller, while historical frames remain read-only.
        result.set("capabilities", name.equals("submit") ? Json.object().put("canReview", manualResult(next)).put("canAiGrade", manualResult(next) && supportsAi(collection.extensionFor(question))) : reviewCapabilities(collection, question, next, replacement));
        if (name.equals("submit")) recordSubmission(collection, question, replacement, result);
        if (name.equals("review")) recordReview(collection, question, replacement, result);
        result.set("capabilities", reviewCapabilities(collection, question, next, replacement));
        ArrayNode nextReceipts = (ArrayNode) next.get("receipts"); ObjectNode receipt = Json.object().put("id", requestId); receipt.set("request", action.deepCopy()); receipt.set("response", result.deepCopy()); nextReceipts.add(receipt);
        if (trustedAi != null) receipt.set("aiConfirmation", trustedAi.path("confirmation").deepCopy());
        // Full response receipts preserve exactly the confirmed result after a restart.
        while (nextReceipts.size() > 32 || (nextReceipts.size() > 1 && encodedSize(nextReceipts) > 16 * 1024 * 1024)) nextReceipts.remove(0);
        long encodedBytes = persist(collection, replacement); remember(collection, replacement, encodedBytes); return result;
    }
    private ObjectNode response(Library.Collection collection, Library.Question question, ObjectNode state, JsonNode projected) {
        if (projected == null) {
            ObjectNode request = Json.object().put("op", "project").put("withCapabilities", true); request.set("data", question.data());
            ObjectNode ruleState = Json.object().put("submitted", state.path("status").asText().equals("submitted")); ruleState.set("result", state.get("result")); request.set("state", ruleState);
            JsonNode evaluated = rules.run(collection.extensionFor(question), request); rememberAiSupport(collection.extensionFor(question), evaluated); projected = evaluated.get("projected");
        }
        ObjectNode result = Json.object(); ObjectNode publicQuestion = Json.object().put("id", question.id()).put("title", question.title()); publicQuestion.set("data", projected);
        result.set("question", publicQuestion); result.set("state", publicState(state)); result.set("draft", state.get("draft")); result.set("stamp", stamp(collection, question, state));
        CachedState loaded = cache.get(collection.stateKey());
        result.set("capabilities", loaded == null ? Json.object().put("canReview", false).put("canAiGrade", false) : reviewCapabilities(collection, question, state, loaded.value()));
        if (state.path("aiTaskId").isTextual()) result.set("aiTask", Json.object().put("taskId", state.path("aiTaskId").asText())); else result.putNull("aiTask");
        result.set("extension", extensionMetadata(collection.extensionFor(question))); return result;
    }
    private static boolean reviewAvailable(Library.Collection collection, Library.Question question, ObjectNode state, ObjectNode persisted) {
        ObjectNode active = activeRound(persisted);
        if (!state.path("status").asText().equals("submitted") || active == null || !roundCompatible(active, collection)) return false;
        for (JsonNode entry : active.path("questions")) if (entry.at("/payload/question/id").asText().equals(question.id())) {
            JsonNode frozen = entry.at("/payload/state"); return frozen.path("status").asText().equals("submitted") && frozen.path("answer").equals(state.path("answer"));
        }
        return false;
    }
    private ObjectNode reviewCapabilities(Library.Collection collection, Library.Question question, ObjectNode state, ObjectNode persisted) {
        boolean allowed = manualResult(state) && reviewAvailable(collection, question, state, persisted);
        return Json.object().put("canReview", allowed).put("canAiGrade", allowed && supportsAi(collection.extensionFor(question)));
    }
    private static boolean manualResult(ObjectNode state) { return List.of("pending", "graded").contains(state.at("/result/gradingStatus").asText()); }
    private static long generation(ObjectNode state, String key) {
        long value = state.path(key).asLong(); if (value == Long.MAX_VALUE) throw new ApiException(409, "REVISION_LIMIT", "Question grading generation limit reached"); return value;
    }
    private void rememberAiSupport(Library.Extension extension, JsonNode evaluated) {
        if (!evaluated.path("capabilities").path("canAiGrade").isBoolean()) return;
        aiSupport.put(extension.fingerprint(), evaluated.at("/capabilities/canAiGrade").asBoolean());
        while (aiSupport.size() > 32) aiSupport.remove(aiSupport.keySet().iterator().next());
    }
    private boolean supportsAi(Library.Extension extension) {
        Boolean known = aiSupport.get(extension.fingerprint()); if (known != null) return known;
        boolean value = rules.run(extension, Json.object().put("op", "capabilities")).path("canAiGrade").asBoolean();
        aiSupport.put(extension.fingerprint(), value); while (aiSupport.size() > 32) aiSupport.remove(aiSupport.keySet().iterator().next()); return value;
    }
    synchronized String currentAiTaskId(Library.Collection collection, Library.Question question) {
        JsonNode value = questionState(load(collection), collection, question).path("aiTaskId"); return value.isTextual() ? value.asText() : null;
    }
    synchronized AiSnapshot prepareAiGrading(Library.Collection collection, Library.Question question, JsonNode request) {
        ObjectNode persisted = load(collection), state = questionState(persisted, collection, question);
        if (!reviewAvailable(collection, question, state, persisted) || !supportsAi(collection.extensionFor(question))) throw new ApiException(409, "AI_GRADING_UNAVAILABLE", "当前题目不能进行 AI 评分，请先提交答案。");
        if (request != null && request.has("contentVersion") && !request.path("contentVersion").asText().equals(stamp(collection, question, state).path("contentVersion").asText())) throw new ApiException(409, "CONTENT_CONFLICT", "题目已更新，请重新打开后评分。");
        ObjectNode input = Json.object().put("op", "prepareAiGrading"); input.set("data", question.data()); input.set("answer", state.path("answer"));
        ObjectNode ruleState = publicState(state); ruleState.put("submitted", true); input.set("state", ruleState);
        JsonNode prepared = rules.run(collection.extensionFor(question), input); JsonNode document = prepared.path("gradingInput");
        AiGradingProtocol.validateInput(document, state.at("/result/maxScore"), prepared.path("maxScore"));
        return new AiSnapshot(collection.stateKey(), activeRound(persisted).path("id").asText(), question.fingerprint(), collection.extensionFor(question).fingerprint(),
                Json.fingerprint(state.path("answer"), "quizforge-ai-answer-v1"), generation(state, "submissionGeneration"), generation(state, "gradingGeneration"), (ObjectNode) document.deepCopy());
    }
    synchronized void bindAiTask(Library.Collection collection, Library.Question question, AiSnapshot snapshot, String taskId) {
        assertAiCurrent(collection, question, snapshot, null); ObjectNode persisted = load(collection), replacement = persisted.deepCopy(), next = questionState(replacement, collection, question).deepCopy();
        next.put("aiTaskId", taskId); ((ObjectNode) replacement.path("questions")).set(question.id(), next); long bytes = persist(collection, replacement); remember(collection, replacement, bytes);
    }
    synchronized boolean aiCurrent(Library.Collection collection, Library.Question question, AiSnapshot snapshot, String taskId) {
        try { assertAiCurrent(collection, question, snapshot, taskId); return true; } catch (ApiException error) { if (List.of("AI_RESULT_STALE", "COLLECTION_CHANGED").contains(error.code)) return false; throw error; }
    }
    private void assertAiCurrent(Library.Collection collection, Library.Question question, AiSnapshot snapshot, String taskId) {
        ObjectNode persisted = load(collection), state = questionState(persisted, collection, question), active = activeRound(persisted);
        if (!collection.stateKey().equals(snapshot.stateKey()) || !question.fingerprint().equals(snapshot.questionFingerprint()) || !collection.extensionFor(question).fingerprint().equals(snapshot.extensionFingerprint())
                || active == null || !active.path("id").asText().equals(snapshot.roundId()) || !reviewAvailable(collection, question, state, persisted)
                || generation(state, "submissionGeneration") != snapshot.submissionGeneration() || generation(state, "gradingGeneration") != snapshot.gradingGeneration()
                || !Json.fingerprint(state.path("answer"), "quizforge-ai-answer-v1").equals(snapshot.answerHash()) || (taskId != null && !state.path("aiTaskId").asText().equals(taskId)))
            throw new ApiException(409, "AI_RESULT_STALE", "题目、答案或评分已变化，这份 AI 建议不能覆盖当前结果。");
    }
    synchronized ObjectNode confirmAi(Library.Collection collection, Library.Question question, AiSnapshot snapshot, String taskId,
                                      String requestId, String candidateVersion, double score, ObjectNode assessment) {
        ObjectNode confirmation = Json.object().put("taskId", taskId).put("candidateVersion", candidateVersion).put("score", score);
        ObjectNode current = questionState(load(collection), collection, question);
        for (JsonNode receipt : current.path("receipts")) if (receipt.path("id").asText().equals(requestId)) {
            if (!receipt.path("aiConfirmation").equals(confirmation)) throw new ApiException(409, "REQUEST_ID_REUSED", "Request ID was already used with different confirmation data");
            return (ObjectNode) receipt.path("response").deepCopy();
        }
        assertAiCurrent(collection, question, snapshot, taskId);
        ObjectNode action = Json.object().put("requestId", requestId).put("revision", current.path("revision").asLong()).put("action", "review");
        action.put("contentVersion", stamp(collection, question, current).path("contentVersion").asText());
        ObjectNode review = Json.object().put("score", score); if (assessment.path("feedback").isTextual()) review.put("feedback", assessment.path("feedback").asText());
        action.set("data", Json.object().set("review", review)); ObjectNode trusted = Json.object(); trusted.set("confirmation", confirmation); trusted.set("assessment", assessment.deepCopy());
        return act(collection, question, action, trusted);
    }
    synchronized ObjectNode confirmedAiReceipt(Library.Collection collection, Library.Question question, String taskId, String candidateVersion) {
        for (JsonNode receipt : questionState(load(collection), collection, question).path("receipts")) {
            JsonNode proof = receipt.path("aiConfirmation"); if (proof.path("taskId").asText().equals(taskId) && proof.path("candidateVersion").asText().equals(candidateVersion)) return (ObjectNode) receipt.path("response").deepCopy();
        }
        return null;
    }
    private void recordReview(Library.Collection collection, Library.Question question, ObjectNode persisted, ObjectNode reviewed) {
        ObjectNode active = activeRound(persisted);
        for (JsonNode entry : active.path("questions")) if (entry.at("/payload/question/id").asText().equals(question.id())) {
            ObjectNode oldPayload = (ObjectNode) entry.path("payload"), frozen = reviewed.deepCopy();
            ((ObjectNode) frozen.path("question")).put("title", oldPayload.at("/question/title").asText()); ((ObjectNode) entry).set("payload", frozen); break;
        }
        active.put("updatedAt", java.time.Instant.now().toString()); HistoryRounds.summarize(active);
    }
    private void recordSubmission(Library.Collection collection, Library.Question question, ObjectNode persisted, ObjectNode submitted) {
        ObjectNode active = activeRound(persisted);
        if (active != null && !roundCompatible(active, collection)) { interruptRound(persisted, "collection-changed"); active = null; }
        String now = java.time.Instant.now().toString();
        if (active == null) {
            active = Json.object().put("schemaVersion", 2).put("id", java.util.UUID.randomUUID().toString()).put("createdAt", now)
                    .put("updatedAt", now).put("status", "in-progress").put("legacy", false).put("incomplete", false).put("questionCountKnown", true)
                    .put("collectionTitle", collection.title()).put("extensionFingerprint", collection.extensionFingerprint());
            freezePages(active, collection);
            ObjectNode outline = overviewValue(collection, persisted); outline.set("states", Json.object()); active.set("collection", outline);
            ObjectNode fingerprints = active.putObject("fingerprints"); ArrayNode entries = active.putArray("questions");
            var input = new java.util.ArrayList<JsonNode>(); var projectionQuestions = new java.util.ArrayList<Library.Question>(); var states = new java.util.ArrayList<ObjectNode>();
            for (Library.Question item : collection.questions()) {
                fingerprints.put(item.id(), item.fingerprint()); ObjectNode state = unsubmittedState(questionState(persisted, collection, item)); states.add(state);
                if (!item.id().equals(question.id())) { ObjectNode request = Json.object(); request.set("data", item.data()); request.set("state", Json.object().put("submitted", false).putNull("result")); input.add(request); projectionQuestions.add(item); }
            }
            JsonNode projections = runBatch(collection, projectionQuestions, "projectBatch", "projected", input);
            if (!projections.isArray() || projections.size() != input.size()) throw new ApiException(422, "INVALID_PROJECTION", "History projections are invalid; submission was not saved");
            int projectionIndex = 0;
            for (int i = 0; i < collection.questions().size(); i++) {
                Library.Question item = collection.questions().get(i); ObjectNode entry = historyEntry(collection, item);
                entry.set("payload", item.id().equals(question.id()) ? submitted.deepCopy() : response(collection, item, states.get(i), projections.get(projectionIndex++))); entries.add(entry);
            }
            ArrayNode rounds = persisted.has("historyRounds") ? (ArrayNode) persisted.get("historyRounds") : persisted.putArray("historyRounds"); rounds.add(active);
        } else {
            for (JsonNode entry : active.path("questions")) {
                ObjectNode oldPayload = (ObjectNode) entry.path("payload"); String id = oldPayload.at("/question/id").asText();
                if (id.equals(question.id())) {
                    ObjectNode frozen = submitted.deepCopy(); ((ObjectNode) frozen.path("question")).put("title", oldPayload.at("/question/title").asText()); ((ObjectNode) entry).set("payload", frozen);
                } else if (!oldPayload.at("/state/status").asText().equals("submitted")) {
                    ObjectNode state = unsubmittedState(questionState(persisted, collection, collection.question(id))); oldPayload.set("state", publicState(state)); oldPayload.set("draft", state.path("draft").deepCopy());
                }
            }
            active.put("updatedAt", now);
        }
        active.put("explicitCompletion", true); HistoryRounds.summarize(active);
    }
    private ObjectNode freezeRound(Library.Collection collection, ObjectNode persisted, java.util.List<ObjectNode> states) {
        String now = java.time.Instant.now().toString();
        ObjectNode round = Json.object().put("schemaVersion", 2).put("id", java.util.UUID.randomUUID().toString()).put("createdAt", now)
                .put("updatedAt", now).put("status", "in-progress").put("explicitCompletion", true).put("legacy", false).put("incomplete", false).put("questionCountKnown", true)
                .put("collectionTitle", collection.title()).put("extensionFingerprint", collection.extensionFingerprint());
        freezePages(round, collection); round.set("collection", overviewValue(collection, persisted));
        ObjectNode fingerprints = round.putObject("fingerprints"); var input = new java.util.ArrayList<JsonNode>(); ArrayNode entries = round.putArray("questions");
        for (int i = 0; i < collection.questions().size(); i++) {
            Library.Question question = collection.questions().get(i); fingerprints.put(question.id(), question.fingerprint());
            ObjectNode item = Json.object(); item.set("data", question.data()); item.set("state", Json.object().put("submitted", states.get(i).path("status").asText().equals("submitted")).set("result", states.get(i).path("result"))); input.add(item);
        }
        JsonNode projected = runBatch(collection, collection.questions(), "projectBatch", "projected", input);
        if (!projected.isArray() || projected.size() != input.size()) throw new ApiException(422, "INVALID_PROJECTION", "History projections are invalid");
        for (int i = 0; i < input.size(); i++) entries.add(historyEntry(collection, collection.questions().get(i)).set("payload", response(collection, collection.questions().get(i), states.get(i), projected.get(i))));
        HistoryRounds.summarize(round); return round;
    }
    private JsonNode runBatch(Library.Collection collection, List<Library.Question> questions, String op, String field, List<? extends JsonNode> inputs) {
        var effective = new java.util.ArrayList<Library.Question>(questions.size());
        for (Library.Question question : questions) effective.add(question.extension() == null ? new Library.Question(question.id(), question.title(), question.data(), question.fingerprint(), collection.extensionFor(question)) : question);
        return RuleBatches.run(rules, effective, op, field, inputs);
    }
    private static void freezePages(ObjectNode round, Library.Collection collection) {
        collectionMetadata(round, collection);
        try {
            if (collection.extension() != null) round.set("page", Library.snapshotPage(collection.extension()));
            else {
                ObjectNode pages = round.putObject("pages");
                for (Library.Extension extension : collection.extensions()) {
                    ObjectNode page = Library.snapshotPage(extension); page.set("extension", extensionMetadata(extension).put("fingerprint", extension.fingerprint()));
                    pages.set(HistoryRounds.pageKey(extension.id(), extension.version(), extension.fingerprint()), page);
                }
            }
        } catch (IOException e) { throw new ApiException(422, "INVALID_EXTENSION", "Practice page cannot be frozen for history; submission was not saved"); }
    }
    private static ObjectNode historyEntry(Library.Collection collection, Library.Question question) {
        ObjectNode entry = Json.object();
        if (collection.extension() == null) { Library.Extension extension = collection.extensionFor(question); entry.put("pageKey", HistoryRounds.pageKey(extension.id(), extension.version(), extension.fingerprint())); }
        return entry;
    }
    private static ObjectNode unsubmittedState(ObjectNode state) {
        ObjectNode value = state.deepCopy(); value.put("status", value.path("answer").isNull() ? "unanswered" : "draft"); value.putNull("result"); return value;
    }
    private static ObjectNode activeRound(ObjectNode persisted) {
        JsonNode rounds = persisted.path("historyRounds"); if (!rounds.isArray() || rounds.isEmpty()) return null;
        JsonNode last = rounds.get(rounds.size() - 1); return last.path("status").asText().equals("in-progress") ? (ObjectNode) last : null;
    }
    private static void interruptRound(ObjectNode persisted, String reason) {
        ObjectNode active = activeRound(persisted); if (active != null) active.put("status", "interrupted").put("interruptionReason", reason).put("closedAt", java.time.Instant.now().toString());
    }
    private static boolean roundCompatible(ObjectNode round, Library.Collection collection) {
        if (!round.path("extensionFingerprint").asText().equals(collection.extensionFingerprint()) || round.path("questions").size() != collection.questions().size()) return false;
        for (int i = 0; i < collection.questions().size(); i++) { Library.Question question = collection.questions().get(i);
            if (!round.path("questions").get(i).at("/payload/question/id").asText().equals(question.id()) || !round.path("fingerprints").path(question.id()).asText().equals(question.fingerprint())) return false;
        } return true;
    }
    private ObjectNode stamp(Library.Collection collection, Library.Question question, ObjectNode state) {
        // An unkeyed raw-data digest could let clients guess a hidden multiple-choice answer.
        // The in-memory key also invalidates browser caches after a service restart.
        Library.Extension extension = collection.extensionFor(question);
        return Json.object().put("revision", state.path("revision").asLong())
                .put("contentVersion", opaqueVersion("question", collection.stateKey(), question.id(), question.title(), question.fingerprint()))
                .put("packageVersion", opaqueVersion("package", extension.id(), extension.version(), extension.fingerprint()));
    }
    private String opaqueVersion(String... fields) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(stampKey, "HmacSHA256"));
            for (String field : fields) { byte[] bytes = field.getBytes(StandardCharsets.UTF_8); mac.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.length).array()); mac.update(bytes); }
            return HexFormat.of().formatHex(mac.doFinal());
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    private ObjectNode load(Library.Collection collection) {
        recoverEdits();
        CachedState present = cache.get(collection.stateKey()); if (present != null) { verifyCompatibility(present.value(), collection); return present.value(); }
        Path file = file(collection);
        try {
            ObjectNode loaded; long encodedBytes;
            if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) { loaded = Json.object().put("schemaVersion", 1).put("collection", collection.stateKey()).put("extensionFingerprint", collection.extensionFingerprint()); loaded.set("questions", Json.object()); encodedBytes = encodedSize(loaded); }
            else {
                JsonNode value = Json.read(file, 32 * 1024 * 1024);
                if (value == null || !value.isObject() || value.path("schemaVersion").asInt() != 1 || !value.path("collection").asText().equals(collection.stateKey()) || !value.path("questions").isObject()) throw new IOException("Invalid state");
                loaded = (ObjectNode) value;
                for (JsonNode state : loaded.path("questions")) validateStoredState(state);
                if (loaded.has("history")) { if (!loaded.path("history").isArray()) throw new IOException("Invalid history"); for (JsonNode record : loaded.path("history")) validateHistory(record); }
                if (loaded.has("historyRounds")) { if (!loaded.path("historyRounds").isArray()) throw new IOException("Invalid history rounds"); for (JsonNode record : loaded.path("historyRounds")) HistoryRounds.validate(record); }
                if (loaded.has("editReceipts")) { if (!loaded.path("editReceipts").isArray() || loaded.path("editReceipts").size() > 32) throw new IOException("Invalid edit receipts"); for (JsonNode receipt : loaded.path("editReceipts")) if (!receipt.path("id").isTextual() || !receipt.path("questionId").isTextual() || !receipt.path("request").isObject() || !receipt.path("response").isObject()) throw new IOException("Invalid edit receipt"); }
                if (loaded.has("finishReceipts")) { if (!loaded.path("finishReceipts").isArray() || loaded.path("finishReceipts").size() > 32) throw new IOException("Invalid finish receipts"); for (JsonNode receipt : loaded.path("finishReceipts")) if (!receipt.path("id").isTextual() || !receipt.path("request").isObject() || !receipt.path("response").isObject()) throw new IOException("Invalid finish receipt"); }
                encodedBytes = Files.size(file);
            }
            verifyCompatibility(loaded, collection); remember(collection, loaded, encodedBytes); return loaded;
        } catch (ApiException e) { if (e.code.equals("COLLECTION_CHANGED")) throw e; throw new ApiException(503, "STATE_UNAVAILABLE", "Saved state cannot be read; preserve the state directory for recovery"); }
        catch (IOException | RuntimeException e) { throw new ApiException(503, "STATE_UNAVAILABLE", "Saved state cannot be read; preserve the state directory for recovery"); }
    }
    private void remember(Library.Collection collection, ObjectNode value, long encodedBytes) {
        remember(collection.stateKey(), value, encodedBytes);
    }
    private void remember(String key, ObjectNode value, long encodedBytes) {
        CachedState previous = cache.put(key, new CachedState(value, encodedBytes));
        cachedBytes += encodedBytes - (previous == null ? 0 : previous.encodedBytes());
        while (cache.size() > 8 || cachedBytes > 64L * 1024 * 1024) {
            var iterator = cache.entrySet().iterator(); var oldest = iterator.next(); cachedBytes -= oldest.getValue().encodedBytes(); iterator.remove();
        }
    }
    private static void verifyCompatibility(ObjectNode state, Library.Collection collection) {
        JsonNode questions = state.path("questions"); if (questions.isEmpty()) return;
        if (!state.path("extensionFingerprint").isTextual() || !state.path("extensionFingerprint").asText().matches("[a-f0-9]{64}")) throw changed("已保存练习来自不含内容签名的旧版，无法确认与当前题库一致。原数据仍保留，请为题库使用新的 ID 后重新打开。");
        if (!state.path("extensionFingerprint").asText().equals(collection.extensionFingerprint())) throw changed("同一版本的题型拓展内容已更改，原练习数据仍保留。请为修改后的拓展使用新的版本号后重新打开。");
        for (Library.Question question : collection.questions()) {
            JsonNode saved = questions.get(question.id()); if (saved == null) continue;
            if (!saved.path("fingerprint").isTextual() || !saved.path("fingerprint").asText().equals(question.fingerprint())) throw changed("题库中已有练习的题目内容已更改，原练习数据仍保留。请为修改后的题库使用新的 ID 后重新打开。");
        }
    }
    private static ApiException changed(String message) { return new ApiException(409, "COLLECTION_CHANGED", message); }
    private static void validateStoredState(JsonNode state) throws IOException {
        if (!state.isObject() || !List.of("unanswered", "draft", "submitted").contains(state.path("status").asText()) || !state.path("revision").isIntegralNumber() || !state.path("revision").canConvertToLong() || state.path("revision").asLong() < 0 || !state.has("answer") || !state.has("result") || !state.has("draft") || !state.path("receipts").isArray() || state.path("receipts").size() > 32) throw new IOException("Invalid state");
        if (!state.path("draft").isNull()) validateDraft(state.path("draft"));
        for (String key : List.of("submissionGeneration", "gradingGeneration")) if (state.has(key) && (!state.path(key).isIntegralNumber() || !state.path(key).canConvertToLong() || state.path(key).asLong() < 0)) throw new IOException("Invalid grading generation");
        if (state.has("aiTaskId") && !state.path("aiTaskId").isNull() && (!state.path("aiTaskId").isTextual() || !state.path("aiTaskId").asText().matches("[a-f0-9]{64}"))) throw new IOException("Invalid AI task ID");
        if (state.path("status").asText().equals("submitted")) HistoryRounds.validateResult(state.path("result"));
        else if (!state.path("result").isNull()) throw new IOException("Unsubmitted question has a result");
        for (JsonNode receipt : state.path("receipts")) if (!receipt.path("id").isTextual() || !receipt.path("request").isObject() || !receipt.path("response").isObject()) throw new IOException("Invalid receipt");
    }
    private static ObjectNode questionState(ObjectNode persisted, Library.Collection collection, Library.Question question) {
        JsonNode present = persisted.path("questions").get(question.id()); if (present != null) return (ObjectNode) present;
        ObjectNode value = Json.object().put("status", "unanswered").put("revision", 0).put("fingerprint", question.fingerprint()); value.putNull("answer"); value.putNull("result"); value.putNull("draft"); value.set("receipts", Json.MAPPER.createArrayNode()); return value;
    }
    private static ObjectNode publicState(ObjectNode state) { ObjectNode value = Json.object().put("status", state.path("status").asText()).put("revision", state.path("revision").asLong()); value.set("answer", state.get("answer")); value.set("result", state.get("result")); return value; }
    private Path file(Library.Collection collection) { try { return directory.resolve(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(collection.stateKey().getBytes(java.nio.charset.StandardCharsets.UTF_8))) + ".json"); } catch (Exception e) { throw new IllegalStateException(e); } }
    private long persist(Library.Collection collection, ObjectNode state) {
        return persist(file(collection), state);
    }
    private long persist(Path target, ObjectNode state) {
        Path temporary = null;
        try {
            byte[] bytes = stateBytes(state);
            temporary = Files.createTempFile(directory, ".write-", ".tmp");
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) { java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true); }
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return bytes.length;
        } catch (ApiException e) { throw e; }
        catch (IOException e) { throw new ApiException(503, "STATE_WRITE_FAILED", "Could not persist practice state"); }
        finally { if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { } }
    }
    private static int encodedSize(JsonNode value) { try { return Json.MAPPER.writeValueAsBytes(value).length; } catch (IOException e) { throw new IllegalStateException(e); } }
    private static byte[] stateBytes(ObjectNode state) throws IOException { byte[] bytes = Json.MAPPER.writeValueAsBytes(state); if (bytes.length > 32 * 1024 * 1024) throw new ApiException(413, "STATE_SIZE_LIMIT", "Collection state and retained history exceed the size limit; previous data is preserved"); return bytes; }
    private void recoverEdits() { try { if (edits.recover()) { cache.clear(); cachedBytes = 0; } } catch (IOException | RuntimeException e) { throw new ApiException(503, "EDIT_RECOVERY_REQUIRED", "Pending edit cannot be recovered safely; preserve the bank and state directories for recovery"); } }
    private static ObjectNode extensionMetadata(Library.Extension extension) { return Json.object().put("id", extension.id()).put("version", extension.version()).put("name", extension.name()); }
    private static void collectionMetadata(ObjectNode value, Library.Collection collection) {
        if (collection.extension() != null) value.set("extension", extensionMetadata(collection.extension())); else value.putNull("extension");
        ArrayNode extensions = value.putArray("extensions"); for (Library.Extension extension : collection.extensions()) extensions.add(extensionMetadata(extension));
    }
    private ObjectNode overviewValue(Library.Collection collection, ObjectNode persisted) {
        ObjectNode result = Json.object().put("id", collection.id()).put("title", collection.title()).put("kind", collection.kind()); collectionMetadata(result, collection);
        ArrayNode questions = result.putArray("questions"); ObjectNode states = result.putObject("states");
        for (Library.Question question : collection.questions()) { ObjectNode row = Json.object().put("id", question.id()).put("title", question.title()); row.set("type", extensionMetadata(collection.extensionFor(question))); questions.add(row); states.set(question.id(), publicState(questionState(persisted, collection, question))); } return result;
    }
    private static void validateHistory(JsonNode record) throws IOException {
        if (record.has("legacyRoundId") && (!record.path("legacyRoundId").isTextual() || !record.path("legacyRoundId").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}"))) throw new IOException("Invalid legacy history boundary");
        if (!record.isObject() || !record.path("id").isTextual() || !record.path("id").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}") || !record.path("createdAt").isTextual() || !record.path("questionId").isTextual() || !record.path("questionTitle").isTextual() || !record.path("collectionTitle").isTextual() || !record.path("extension").isObject() || !record.path("score").isNumber() || !record.path("maxScore").isNumber() || !record.path("correct").isBoolean() || !record.path("payload").isObject() || !record.at("/payload/state/status").asText().equals("submitted") || !record.path("page").isObject()) throw new IOException("Invalid history snapshot");
        for (String asset : List.of("html", "script", "style")) if (!record.path("page").path(asset).isTextual()) throw new IOException("Invalid frozen page");
        try { java.time.Instant.parse(record.path("createdAt").asText()); } catch (java.time.DateTimeException e) { throw new IOException("Invalid history timestamp"); }
    }
    static void validateDraft(JsonNode draft) {
        if (draft == null || !draft.isObject() || !draft.path("schemaVersion").isIntegralNumber() || draft.path("schemaVersion").asInt() != 1) throw ApiException.bad("Invalid whiteboard schema");
        JsonNode viewport = draft.path("viewport"), strokes = draft.path("strokes"), paper = draft.path("paper");
        if (!viewport.isObject() || !strokes.isArray() || strokes.size() > 2000 || !paper.isObject()) throw ApiException.bad("Invalid whiteboard draft");
        finite(viewport, "x", -1e6, 1e6); finite(viewport, "y", -1e6, 1e6); finite(viewport, "zoom", 0.25, 4);
        color(paper, "color"); String pattern = Json.text(paper, "pattern", 30); if (!List.of("plain", "none", "grid", "dots", "ruled", "lines", "lined").contains(pattern)) throw ApiException.bad("Invalid paper pattern");
        int points = 0; var ids = new java.util.HashSet<String>();
        for (JsonNode stroke : strokes) {
            if (!stroke.isObject() || !ids.add(Json.id(stroke, "id"))) throw ApiException.bad("Invalid stroke ID"); color(stroke, "color"); finite(stroke, "width", 0.5, 32);
            JsonNode values = stroke.path("points"); if (!values.isArray() || values.isEmpty() || values.size() > 10000 || (points += values.size()) > 100000) throw ApiException.bad("Invalid whiteboard points");
            for (JsonNode point : values) { if (!point.isObject()) throw ApiException.bad("Invalid point"); finite(point, "x", -1e6, 1e6); finite(point, "y", -1e6, 1e6); finite(point, "pressure", 0, 1); }
        }
        if (encodedSize(draft) > 8 * 1024 * 1024) throw new ApiException(413, "DRAFT_SIZE_LIMIT", "Whiteboard draft exceeds the size limit");
    }
    private static void finite(JsonNode object, String key, double min, double max) { JsonNode value = object.get(key); if (value == null || !value.isNumber() || !Double.isFinite(value.asDouble()) || value.asDouble() < min || value.asDouble() > max) throw ApiException.bad("Invalid " + key); }
    private static void color(JsonNode object, String key) { if (!Json.text(object, key, 40).matches("#[A-Fa-f0-9]{3,8}")) throw ApiException.bad("Invalid color"); }
}
