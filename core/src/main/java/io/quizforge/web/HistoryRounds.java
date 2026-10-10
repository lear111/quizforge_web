package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** Frozen public documents, grouped by one attempt at a collection. */
final class HistoryRounds {
    private HistoryRounds() { }

    static List<ObjectNode> legacy(JsonNode history, String kind, String collectionId) {
        var rounds = new ArrayList<ObjectNode>(); ObjectNode round = null; var ids = new HashSet<String>();
        for (JsonNode record : history) {
            String questionId = record.path("questionId").asText();
            String savedRoundId = record.path("legacyRoundId").asText();
            if (round == null || (!savedRoundId.isEmpty() && !savedRoundId.equals(round.path("id").asText())) || !ids.add(questionId)) {
                round = Json.object().put("schemaVersion", 2).put("id", record.path("id").asText())
                        .put("createdAt", record.path("createdAt").asText()).put("status", "legacy")
                        .put("legacy", true).put("incomplete", true).put("questionCountKnown", false)
                        .put("collectionTitle", record.path("collectionTitle").asText());
                round.set("extension", record.path("extension").deepCopy()); round.set("page", record.path("page").deepCopy());
                round.putArray("questions"); round.putArray("legacyIds");
                ObjectNode collection = round.putObject("collection").put("id", collectionId).put("kind", kind).put("title", record.path("collectionTitle").asText());
                collection.set("extension", record.path("extension").deepCopy()); collection.putArray("questions"); collection.putObject("states");
                rounds.add(round); ids.clear(); ids.add(questionId);
            }
            ObjectNode entry = Json.object(); entry.set("payload", record.path("payload").deepCopy());
            if (!record.path("page").equals(round.path("page"))) entry.set("page", record.path("page").deepCopy());
            ((ArrayNode) round.path("questions")).add(entry); ((ArrayNode) round.path("legacyIds")).add(record.path("id").asText());
            ObjectNode row = Json.object().put("id", questionId).put("title", record.path("questionTitle").asText()); row.set("type", record.path("extension").deepCopy());
            ((ArrayNode) round.at("/collection/questions")).add(row); round.put("updatedAt", record.path("createdAt").asText()); summarize(round);
        }
        return rounds;
    }

    /** Freeze surviving boundaries before removing old entries, so formerly separated rounds never merge. */
    static void deleteLegacy(ObjectNode state, List<ObjectNode> rounds, ObjectNode deleted) {
        var roundIds = new java.util.HashMap<String, String>();
        for (ObjectNode round : rounds) if (round != deleted) for (JsonNode id : round.path("legacyIds")) roundIds.put(id.asText(), round.path("id").asText());
        ArrayNode retained = Json.MAPPER.createArrayNode();
        for (JsonNode record : state.path("history")) {
            String roundId = roundIds.get(record.path("id").asText());
            if (roundId != null) { ObjectNode copy = (ObjectNode) record.deepCopy(); copy.put("legacyRoundId", roundId); retained.add(copy); }
        }
        state.set("history", retained);
    }

    static void summarize(ObjectNode round) {
        BigDecimal score = BigDecimal.ZERO, maxScore = BigDecimal.ZERO; int submitted = 0, graded = 0, pending = 0;
        ObjectNode states = Json.object();
        for (JsonNode entry : round.path("questions")) {
            JsonNode payload = entry.path("payload"), state = payload.path("state"); states.set(payload.at("/question/id").asText(), state.deepCopy());
            if (state.path("status").asText().equals("submitted")) {
                submitted++; if (gradingStatus(state.path("result")).equals("pending")) pending++;
                else { graded++; score = score.add(state.at("/result/score").decimalValue()); }
                maxScore = maxScore.add(state.at("/result/maxScore").decimalValue());
            }
        }
        if (round.path("summary").isObject()) { score = round.at("/summary/score").decimalValue(); maxScore = round.at("/summary/maxScore").decimalValue(); }
        round.put("questionCount", round.path("questions").size()).put("submittedCount", submitted).put("gradedCount", graded).put("pendingCount", pending).put("score", score).put("maxScore", maxScore);
        ((ObjectNode) round.path("collection")).set("states", states);
        if (!round.path("explicitCompletion").asBoolean() && round.path("status").asText().equals("in-progress") && submitted == round.path("questions").size() && pending == 0) round.put("status", "completed");
    }

    static ObjectNode publicRecord(JsonNode source, boolean summary) {
        ObjectNode value = (ObjectNode) source.deepCopy(); value.remove(List.of("fingerprints", "extensionFingerprint", "legacyIds", "completionVersions"));
        ExtensionApi.normalizeHistory(value);
        if (!value.has("gradedCount")) value.put("gradedCount", value.path("submittedCount").asInt());
        if (!value.has("pendingCount")) value.put("pendingCount", 0);
        if (summary) value.remove(List.of("questions", "collection", "page", "pages")); return value;
    }

    static String pageKey(String id, String version, String fingerprint) {
        return pageKey(id, version, null, fingerprint);
    }
    // Read-only compatibility for frozen records made during the retired multi-type preview.
    static String pageKey(String id, String version, String typeId, String fingerprint) {
        ObjectNode identity = Json.object().put("id", id).put("version", version); if (typeId != null) identity.put("typeId", typeId);
        return Json.fingerprint(identity, fingerprint);
    }

    private static String frozenIdentity(JsonNode extension) {
        String typeId = extension.path("typeId").asText(null);
        return extension.path("id").asText() + "@" + extension.path("version").asText() + (typeId == null ? "" : ":" + typeId);
    }

    private static void validateExtension(JsonNode extension) throws IOException {
        if (!extension.isObject() || !extension.path("id").isTextual() || !extension.path("id").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
                || !extension.path("version").isTextual() || !extension.path("version").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw new IOException("Invalid frozen extension");
        if (extension.has("typeId") && (!extension.path("typeId").isTextual() || !extension.path("typeId").asText().matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}"))) throw new IOException("Invalid frozen typeId");
    }

    private static boolean sameExtension(JsonNode left, JsonNode right) {
        return left.path("id").equals(right.path("id")) && left.path("version").equals(right.path("version")) && left.path("typeId").equals(right.path("typeId"));
    }

    private static void validatePage(JsonNode page) throws IOException {
        if (!page.isObject()) throw new IOException("Invalid frozen page");
        ExtensionApi.requireHistory(page);
        for (String asset : List.of("html", "script", "style")) if (!page.path(asset).isTextual()) throw new IOException("Invalid frozen page");
    }

    static boolean matchesId(JsonNode record, String id) {
        if (record.path("id").asText().equals(id)) return true;
        for (JsonNode old : record.path("legacyIds")) if (old.asText().equals(id)) return true; return false;
    }

    static String gradingStatus(JsonNode result) { return result.path("gradingStatus").asText("graded"); }

    static void validateResult(JsonNode result) throws IOException {
        String status = gradingStatus(result);
        if (!result.isObject() || !List.of("pending", "graded").contains(status) || (result.has("gradingStatus") && !result.path("gradingStatus").isTextual())
                || !result.path("maxScore").isNumber() || !Double.isFinite(result.path("maxScore").asDouble()) || result.path("maxScore").decimalValue().signum() < 0) throw new IOException("Invalid grade result");
        if (status.equals("pending")) {
            if (!result.has("score") || !result.path("score").isNull() || !result.has("correct") || !result.path("correct").isNull()) throw new IOException("Invalid pending grade result");
        } else if (!result.path("score").isNumber() || !Double.isFinite(result.path("score").asDouble()) || result.path("score").decimalValue().signum() < 0
                || result.path("score").decimalValue().compareTo(result.path("maxScore").decimalValue()) > 0 || !result.path("correct").isBoolean()) throw new IOException("Invalid grade result");
    }

    static void validate(JsonNode record) throws IOException {
        ExtensionApi.requireHistory(record);
        boolean mixed = record.has("pages");
        if (!record.isObject() || record.path("schemaVersion").asInt() != 2 || !record.path("id").isTextual()
                || !record.path("id").asText().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
                || !List.of("in-progress", "completed", "interrupted").contains(record.path("status").asText())
                || !record.path("collectionTitle").isTextual() || !record.path("collection").isObject()
                || (mixed ? !record.path("extension").isNull() || !record.path("pages").isObject() || record.path("pages").isEmpty()
                    || !record.at("/collection/extension").isNull() || !record.path("extensions").isArray() || record.path("extensions").isEmpty()
                    : !record.path("extension").isObject() || !record.path("page").isObject())
                || !record.path("questions").isArray() || record.path("questions").isEmpty() || record.path("questions").size() > 10000
                || !record.path("fingerprints").isObject() || !record.path("extensionFingerprint").asText().matches("[a-f0-9]{64}")) throw new IOException("Invalid history round");
        for (String key : List.of("createdAt", "updatedAt")) try { Instant.parse(record.path(key).asText()); } catch (java.time.DateTimeException e) { throw new IOException("Invalid round timestamp"); }
        var pageKeys = new HashSet<String>();
        if (mixed) {
            var declared = new HashSet<String>();
            for (JsonNode extension : record.path("extensions")) {
                validateExtension(extension); if (!declared.add(frozenIdentity(extension))) throw new IOException("Duplicate frozen extension");
            }
            var identities = new HashSet<String>(); var pages = record.path("pages").fields();
            while (pages.hasNext()) {
                var entry = pages.next(); JsonNode page = entry.getValue(), extension = page.path("extension"); validatePage(page); validateExtension(extension);
                String typeId = extension.path("typeId").asText(null);
                String fingerprint = extension.path("fingerprint").asText(), identity = frozenIdentity(extension);
                if (!fingerprint.matches("[a-f0-9]{64}") || !entry.getKey().equals(pageKey(extension.path("id").asText(), extension.path("version").asText(), typeId, fingerprint))
                        || !identities.add(identity) || !declared.contains(identity)) throw new IOException("Invalid frozen page identity");
            }
            if (!identities.equals(declared) || !record.path("extensions").equals(record.at("/collection/extensions"))) throw new IOException("Frozen extension outline mismatch");
        } else validatePage(record.path("page"));
        var ids = new HashSet<String>(); int submitted = 0, graded = 0, pending = 0; BigDecimal score = BigDecimal.ZERO, maxScore = BigDecimal.ZERO;
        JsonNode outline = record.at("/collection/questions"); if (!outline.isArray() || outline.size() != record.path("questions").size()) throw new IOException("Invalid frozen outline");
        for (int i = 0; i < outline.size(); i++) {
            if (outline.get(i).has("outlineLabel")) try {
                OutlineItems.readLabel(outline.get(i).get("outlineLabel"));
                if (outline.get(i).has("outlineItems")) throw new IOException("Mutually exclusive frozen outline entries");
            } catch (ApiException e) { throw new IOException("Invalid frozen outline label"); }
            if (outline.get(i).has("outlineItems")) try { OutlineItems.read(outline.get(i).get("outlineItems")); }
            catch (ApiException e) { throw new IOException("Invalid frozen outline items"); }
            JsonNode entry = record.path("questions").get(i), payload = entry.path("payload"), state = payload.path("state"); String id = payload.at("/question/id").asText();
            if (entry.has("page")) validatePage(entry.path("page"));
            if (!payload.isObject() || !id.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}") || !ids.add(id) || !id.equals(outline.get(i).path("id").asText())
                    || !payload.at("/question/title").isTextual() || !payload.path("question").has("data") || !payload.path("extension").isObject()
                    || !List.of("unanswered", "draft", "submitted").contains(state.path("status").asText()) || !state.has("answer") || !state.has("result")
                    || !payload.has("draft") || !record.path("fingerprints").path(id).asText().matches("[a-f0-9]{64}")) throw new IOException("Invalid frozen question");
            if (mixed || entry.has("pageKey")) {
                validateExtension(payload.path("extension"));
                String key = entry.path("pageKey").asText(); JsonNode page = record.path("pages").path(key);
                if (!entry.path("pageKey").isTextual() || !key.matches("[a-f0-9]{64}") || !page.isObject() || !sameExtension(payload.path("extension"), page.path("extension"))
                        || !sameExtension(payload.path("extension"), outline.get(i).path("type")) || entry.has("page")) throw new IOException("Invalid frozen question page reference");
                pageKeys.add(key);
            }
            if (!payload.path("draft").isNull()) StateStore.validateDraft(payload.path("draft"));
            validateOutlineStates(state, state.path("status").asText().equals("submitted"));
            if (state.path("status").asText().equals("submitted")) {
                JsonNode result = state.path("result");
                validateResult(result);
                submitted++; if (gradingStatus(result).equals("pending")) pending++;
                else { graded++; score = score.add(result.path("score").decimalValue()); }
                maxScore = maxScore.add(result.path("maxScore").decimalValue());
            } else if (!state.path("result").isNull()) throw new IOException("Unsubmitted question has a result");
            if (!state.equals(record.at("/collection/states").path(id))) throw new IOException("Frozen outline state mismatch");
        }
        if (mixed && pageKeys.size() != record.path("pages").size()) throw new IOException("Unused frozen page");
        if (record.has("summary")) {
            JsonNode summary = record.path("summary"); java.math.BigDecimal summaryScore = java.math.BigDecimal.ZERO, summaryMax = java.math.BigDecimal.ZERO;
            if (!summary.isObject() || !summary.path("questions").isArray() || summary.path("questions").size() != outline.size()
                    || summary.path("questionCount").asInt(-1) != outline.size() || summary.path("submittedCount").asInt(-1) != submitted
                    || pending > 0 || (summary.has("pendingCount") && summary.path("pendingCount").asInt(-1) != 0)
                    || (summary.has("gradedCount") && summary.path("gradedCount").asInt(-1) != graded)
                    || !summary.path("roundId").asText().equals(record.path("id").asText()) || !summary.path("finished").asBoolean()
                    || !record.path("status").asText().equals("completed") || !record.path("finishedAt").isTextual()) throw new IOException("Invalid frozen score summary");
            try { Instant.parse(record.path("finishedAt").asText()); } catch (java.time.DateTimeException e) { throw new IOException("Invalid completion timestamp"); }
            for (int i = 0; i < outline.size(); i++) {
                JsonNode row = summary.path("questions").get(i); boolean answered = record.path("questions").get(i).at("/payload/state/status").asText().equals("submitted");
                validateOutlineStates(row, answered);
                if (!row.path("id").asText().equals(outline.get(i).path("id").asText()) || !row.path("score").isNumber() || !row.path("maxScore").isNumber()
                        || !row.path("submitted").isBoolean() || row.path("submitted").asBoolean() != answered
                        || (row.has("gradingStatus") && !row.path("gradingStatus").asText().equals(answered ? "graded" : "unsubmitted"))
                        || row.path("score").decimalValue().signum() < 0 || row.path("maxScore").decimalValue().signum() < 0
                        || row.path("score").decimalValue().compareTo(row.path("maxScore").decimalValue()) > 0 || (!answered && row.path("score").decimalValue().signum() != 0)) throw new IOException("Invalid frozen question score");
                summaryScore = summaryScore.add(row.path("score").decimalValue()); summaryMax = summaryMax.add(row.path("maxScore").decimalValue());
            }
            if (!summary.path("score").isNumber() || !summary.path("maxScore").isNumber() || summary.path("score").decimalValue().compareTo(summaryScore) != 0
                    || summary.path("maxScore").decimalValue().compareTo(summaryMax) != 0) throw new IOException("Invalid frozen summary totals");
            score = summaryScore; maxScore = summaryMax;
        }
        if (record.path("questionCount").asInt(-1) != outline.size() || record.path("submittedCount").asInt(-1) != submitted
                || (record.has("gradedCount") && record.path("gradedCount").asInt(-1) != graded) || (record.has("pendingCount") && record.path("pendingCount").asInt(-1) != pending)
                || (record.path("status").asText().equals("completed") && pending > 0)
                || !record.path("score").isNumber() || record.path("score").decimalValue().compareTo(score) != 0
                || !record.path("maxScore").isNumber() || record.path("maxScore").decimalValue().compareTo(maxScore) != 0
                || (record.path("explicitCompletion").asBoolean() ? (record.path("status").asText().equals("completed") && !record.has("summary"))
                    : (record.path("status").asText().equals("completed") != (submitted == outline.size() && pending == 0)))) throw new IOException("Invalid round totals");
    }
    private static void validateOutlineStates(JsonNode value, boolean submitted) throws IOException {
        if (value.has("outlineStates")) try { OutlineStates.validate(value.get("outlineStates"), submitted); }
        catch (ApiException e) { throw new IOException("Invalid frozen outline states", e); }
    }
}
