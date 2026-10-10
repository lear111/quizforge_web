package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.HashSet;
import java.util.Set;

/** Optional, extension-owned display states. They never contribute to score totals. */
final class OutlineStates {
    private static final Set<String> STATUSES = Set.of("unanswered", "correct", "incorrect");
    private OutlineStates() { }

    static void validate(JsonNode items, boolean submitted) {
        if (items == null || !items.isArray() || items.size() > 100) throw invalid();
        var ids = new HashSet<String>();
        for (JsonNode item : items) {
            String id = item.path("id").asText();
            if (!item.isObject() || item.size() != 2 || !item.path("id").isTextual() || !item.path("status").isTextual()
                    || id.isEmpty() || id.length() > 128 || !id.equals(id.strip()) || id.chars().anyMatch(c -> c <= 31 || c >= 127 && c <= 159 || c == '<' || c == '>')
                    || !ids.add(id) || !STATUSES.contains(item.path("status").asText())
                    || !submitted && !item.path("status").asText().equals("unanswered")) throw invalid();
        }
    }

    static ArrayNode visible(JsonNode items, Library.Question question, boolean submitted) {
        validate(items, submitted);
        var ids = new HashSet<String>(); question.outlineItems().forEach(item -> ids.add(item.id()));
        ArrayNode result = Json.MAPPER.createArrayNode();
        for (JsonNode item : items) if (ids.contains(item.path("id").asText())) result.add(item.deepCopy());
        return result;
    }

    private static ApiException invalid() {
        return new ApiException(422, "INVALID_OUTLINE_STATES", "题型拓展的 outlineStates 无效，请通过 getScore 返回唯一小题 id 与 unanswered/correct/incorrect，未提交时仅允许 unanswered。");
    }
}
