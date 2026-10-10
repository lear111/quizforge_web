package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** Public navigation metadata only; each item belongs to its existing parent question. */
final class OutlineItems {
    static final long MAX_BYTES = 8L * 1024 * 1024;
    private OutlineItems() { }
    static List<Library.OutlineItem> read(JsonNode values) {
        if (values == null || !values.isArray() || values.size() > 100) throw invalid();
        var items = new ArrayList<Library.OutlineItem>(); var ids = new HashSet<String>();
        for (JsonNode value : values) {
            if (!value.isObject() || value.size() != 2 || !plain(value.get("id"), 128) || !plain(value.get("label"), 80) || !ids.add(value.path("id").asText())) throw invalid();
            items.add(new Library.OutlineItem(value.path("id").asText(), value.path("label").asText()));
        }
        return List.copyOf(items);
    }
    static Library.Outline readConfiguration(JsonNode value, Library.Extension extension) {
        if (value == null || !value.isObject() || value.size() != 2 || !value.path("level").isTextual()) throw invalidConfiguration();
        if (value.path("level").asText().equals("question")) {
            return new Library.Outline("question", readLabel(value.get("label")), List.of());
        }
        if (!value.path("level").asText().equals("parts") || !value.has("items")) throw invalidConfiguration();
        List<Library.OutlineItem> items = read(value.get("items"));
        if (items.isEmpty()) throw invalidConfiguration();
        if (!extension.outlineItemsDeclared()) throw new ApiException(422, "OUTLINE_CAPABILITY_REQUIRED", "题库显式小题目录需要所属拓展声明 API 1.1 outline-items 定位能力；题库与拓展均未修改。");
        return new Library.Outline("parts", null, items);
    }
    static String readLabel(JsonNode value) {
        if (!plain(value, 80)) throw invalidConfiguration();
        return value.asText();
    }
    static void attach(ObjectNode row, Library.Question question) {
        if (question.outline() != null && question.outline().level().equals("question")) row.put("outlineLabel", question.outline().label());
        attach(row, question.outlineItems());
    }
    static void attach(ObjectNode row, List<Library.OutlineItem> values) {
        if (values.isEmpty()) return;
        for (Library.OutlineItem value : values) row.withArray("outlineItems").add(Json.object().put("id", value.id()).put("label", value.label()));
    }
    static long addBytes(long current, long additional) {
        if (additional < 0 || current > MAX_BYTES - additional) throw new ApiException(422, "INVALID_OUTLINE_ITEMS", "题库的小题目录超过 8 MiB 限制，请缩短目录标签或拆分题库；原题库未修改。");
        return current + additional;
    }
    private static boolean plain(JsonNode value, int maximum) {
        if (value == null || !value.isTextual()) return false;
        String text = value.asText();
        return !text.isEmpty() && text.length() <= maximum && !space(text.charAt(0)) && !space(text.charAt(text.length() - 1))
                && text.chars().noneMatch(character -> Character.isISOControl(character) || character == '<' || character == '>');
    }
    private static boolean space(int character) { return Character.isWhitespace(character) || Character.isSpaceChar(character) || character == 0xfeff; }
    private static ApiException invalid() { return new ApiException(422, "INVALID_OUTLINE_ITEMS", "小题目录必须为最多 100 项的有序数组，每项仅含唯一 id 和纯文本 label。"); }
    private static ApiException invalidConfiguration() { return new ApiException(422, "INVALID_OUTLINE_ITEMS", "题目 outline 仅允许 {level:question,label:纯文本编号} 或 {level:parts,items:1 至 100 项有序小题目录}，不能同时列出大题和小题。"); }
}
