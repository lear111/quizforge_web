package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Provider-independent validation and host-owned final grading feedback. */
final class AiGradingProtocol {
    private AiGradingProtocol() { }
    static ObjectNode decorateReview(ObjectNode evaluated, JsonNode previous, ObjectNode trusted) {
        JsonNode assessment = trusted != null ? trusted.path("assessment") : previous.path("aiAssessment"); if (!assessment.isObject()) return evaluated;
        ObjectNode result = evaluated.deepCopy(); result.set("aiAssessment", assessment.deepCopy()); result.put("gradedAt", java.time.Instant.now().toString());
        boolean adjusted = result.path("score").decimalValue().compareTo(assessment.path("score").decimalValue()) != 0;
        String source = trusted == null ? "manual" : adjusted ? "ai-assisted" : "ai"; result.put("gradingSource", source);
        StringBuilder feedback = new StringBuilder("最终得分：").append(result.path("score").asText()).append(" / ").append(result.path("maxScore").asText()).append(" 分");
        if (source.equals("manual") || adjusted) feedback.append("\n人工调整；AI 建议：").append(assessment.path("score").asText()).append(" / ").append(result.path("maxScore").asText()).append(" 分");
        if (assessment.path("feedback").isTextual() && !assessment.path("feedback").asText().isBlank()) feedback.append("\n\nAI 评分依据：\n").append(assessment.path("feedback").asText());
        if (trusted == null && evaluated.path("feedback").isTextual() && !evaluated.path("feedback").asText().isBlank()) feedback.append("\n\n人工评语：\n").append(evaluated.path("feedback").asText());
        if (feedback.length() > 20000) throw ApiException.bad("Combined grading feedback exceeds limit"); result.put("feedback", feedback.toString()); return result;
    }
    static void validateInput(JsonNode value, JsonNode submittedMax, JsonNode scoringMax) {
        if (!value.isObject() || value.path("protocolVersion").asInt() != 1 || !value.path("protocolVersion").isIntegralNumber()) throw new ApiException(422, "INVALID_AI_INPUT", "题型拓展的 AI 评分协议无效。");
        var allowed = java.util.Set.of("protocolVersion", "question", "answer", "referenceAnswer", "rubric", "maxScore", "scoreStep"); value.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分输入含未声明字段。"); });
        JsonNode max = value.path("maxScore"), step = value.path("scoreStep");
        if (!max.isNumber() || !Double.isFinite(max.asDouble()) || max.asDouble() <= 0 || !step.isNumber() || !Double.isFinite(step.asDouble()) || step.asDouble() <= 0
                || !scoringMax.isNumber() || submittedMax.decimalValue().compareTo(max.decimalValue()) != 0 || scoringMax.decimalValue().compareTo(max.decimalValue()) != 0
                || max.decimalValue().remainder(step.decimalValue()).signum() != 0) throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分满分、精度与题型分值接口不一致。");
        int chars = 0, images = 0;
        for (String key : List.of("question", "answer", "referenceAnswer", "rubric")) {
            JsonNode blocks = value.path(key); if (!blocks.isArray() || blocks.size() > 2000 || ((key.equals("question") || key.equals("answer") || key.equals("rubric")) && blocks.isEmpty())) throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分内容无效。");
            for (JsonNode block : blocks) {
                if (!block.isObject()) throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分内容块无效。");
                String type = block.path("type").asText();
                if (type.equals("text")) {
                    if (!block.path("text").isTextual() || block.size() != 2 || (chars += block.path("text").asText().length()) > 400000) throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分文字无效或超出限制。");
                } else if (type.equals("image")) {
                    var fields = java.util.Set.of("type", "assetId", "alt"); block.fieldNames().forEachRemaining(field -> { if (!fields.contains(field)) throw new ApiException(422, "INVALID_AI_INPUT", "AI 图片不接受 URL 或路径。"); });
                    if (!block.path("assetId").asText().matches("[a-f0-9]{64}") || ++images > 40 || (block.has("alt") && (!block.path("alt").isTextual() || block.path("alt").asText().length() > 500))) throw new ApiException(422, "INVALID_AI_INPUT", "AI 图片引用无效。");
                } else throw new ApiException(422, "INVALID_AI_INPUT", "AI 评分内容块类型无效。");
            }
        }
        try {
            if (Json.MAPPER.writeValueAsBytes(value).length > 1024 * 1024) throw new ApiException(413, "AI_INPUT_TOO_LARGE", "AI 评分输入超出大小限制。");
        } catch (java.io.IOException error) { throw ApiException.bad("AI 评分输入无法编码。"); }
    }
}
