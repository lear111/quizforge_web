package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Public host contracts are independent of the application release version. */
final class ExtensionApi {
    private record Contract(int minor, Set<String> capabilities) { }
    // A new major requires its own implementation and compatibility tests before registration.
    private static final Map<Integer, Contract> CONTRACTS = Map.of(1, new Contract(0, Set.of(
            "practice", "editor", "editor-drafts", "score", "manual-review", "ai-grading",
            "resources", "richtext", "navigation", "lifecycle")));
    private ExtensionApi() { }

    static ObjectNode version() { return Json.object().put("major", 1).put("minor", 0); }

    static void requireManifest(JsonNode manifest) {
        JsonNode requirement = manifest.get("requiresApi");
        if (requirement == null) return; // Unchanged pre-contract packages use v1.0.
        if (!requirement.isObject() || !integer(requirement.get("major"), 1) || !integer(requirement.get("minMinor"), 0)
                || !Set.of("major", "minMinor", "capabilities").containsAll(properties(requirement)))
            throw new ApiException(422, "INVALID_API_REQUIREMENT", "拓展 requiresApi 必须包含整数 major 和 minMinor，且仅允许 major、minMinor、capabilities 字段；旧拓展可省略该声明并使用 API v1.0。");
        int major = requirement.path("major").asInt(), minor = requirement.path("minMinor").asInt();
        Contract contract = CONTRACTS.get(major);
        if (contract == null || minor > contract.minor())
            throw new ApiException(422, "UNSUPPORTED_EXTENSION_API", "拓展需要 API v" + major + "." + minor + "，本应用支持 API v1.0。请安装兼容的拓展版本，或在应用支持该接口后再升级。");
        JsonNode capabilities = requirement.get("capabilities");
        if (capabilities == null) return;
        if (!capabilities.isArray() || capabilities.size() > 100)
            throw new ApiException(422, "INVALID_API_REQUIREMENT", "requiresApi.capabilities 必须是能力名称数组，请修正拓展声明。");
        var seen = new HashSet<String>();
        for (JsonNode capability : capabilities) {
            if (!capability.isTextual() || capability.asText().isBlank() || !seen.add(capability.asText()))
                throw new ApiException(422, "INVALID_API_REQUIREMENT", "requiresApi.capabilities 必须包含不重复的非空字符串，请修正拓展声明。");
            if (!contract.capabilities().contains(capability.asText()))
                throw new ApiException(422, "UNSUPPORTED_API_CAPABILITY", "本应用的 API v" + major + " 不支持能力「" + capability.asText() + "」。请使用兼容拓展，或向开发者反馈所需能力。");
        }
    }

    static void requireBank(JsonNode bank) {
        JsonNode value = bank.get("formatVersion");
        if (value == null) return;
        if (!integer(value, 1)) throw new ApiException(422, "INVALID_BANK_FORMAT", "题库 formatVersion 必须为正整数；现有题库可省略并按格式 v1 读取。原文件未修改。");
        if (value.asInt() != 1) throw new ApiException(422, "UNSUPPORTED_BANK_FORMAT", "题库使用格式 v" + value.asText() + "，本应用仅支持 v1。请安装支持该格式的应用，或由制作者导出兼容格式；原文件未修改。");
    }

    static void requireHistory(JsonNode document) {
        JsonNode value = document.get("apiVersion");
        if (value == null) return; // Old frozen documents use the original v1 contract.
        if (!value.isObject() || !integer(value.get("major"), 1) || !integer(value.get("minor"), 0))
            throw new ApiException(409, "INVALID_HISTORY_API", "历史记录的 apiVersion 声明无效，无法安全打开。原记录保留，请从备份恢复或向开发者反馈。");
        Contract contract = CONTRACTS.get(value.path("major").asInt());
        if (contract == null || value.path("minor").asInt() > contract.minor())
            throw new ApiException(409, "UNSUPPORTED_HISTORY_API", "历史记录需要 API v" + value.path("major").asText() + "." + value.path("minor").asText() + "，本应用仅支持 v1.0。请使用支持该接口的应用打开；原记录未修改。");
    }

    static ObjectNode declare(ObjectNode document) { document.set("apiVersion", version()); return document; }
    static void normalizeHistory(ObjectNode document) {
        requireHistory(document); if (!document.has("apiVersion")) declare(document);
        normalizePage(document.get("page"));
        for (JsonNode page : document.path("pages")) normalizePage(page);
        for (JsonNode question : document.path("questions")) normalizePage(question.get("page"));
    }
    private static void normalizePage(JsonNode page) {
        if (page != null && page.isObject()) { requireHistory(page); if (!page.has("apiVersion")) declare((ObjectNode) page); }
    }
    static boolean historyFailure(ApiException failure) { return failure.code.equals("INVALID_HISTORY_API") || failure.code.equals("UNSUPPORTED_HISTORY_API"); }
    private static boolean integer(JsonNode value, int minimum) {
        return value != null && value.isNumber() && value.canConvertToInt() && value.intValue() >= minimum
                && value.decimalValue().compareTo(java.math.BigDecimal.valueOf(value.intValue())) == 0;
    }
    private static Set<String> properties(JsonNode object) {
        var names = new HashSet<String>(); object.fieldNames().forEachRemaining(names::add); return names;
    }
}
