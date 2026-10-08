package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/** Group immutable question versions without starting one rule process per question. */
final class RuleBatches {
    private static final int MAX_ITEMS = 512, TARGET_BYTES = 512 * 1024;
    private record Group(Library.Extension extension, List<Integer> indexes) { }
    private RuleBatches() { }

    static void validate(RuleEngine rules, List<Library.Question> questions) {
        run(rules, questions, "validateBank", null, questions.stream().map(Library.Question::data).toList());
    }

    static ArrayNode run(RuleEngine rules, List<Library.Question> questions, String operation, String field, List<? extends JsonNode> inputs) {
        if (questions.size() != inputs.size()) throw ApiException.bad("Invalid batch alignment");
        var groups = new LinkedHashMap<String, Group>();
        for (int i = 0; i < questions.size(); i++) {
            Library.Extension extension = questions.get(i).extension();
            if (extension == null) throw ApiException.bad("Missing batch extension");
            String key = extension.id() + "@" + extension.version() + ":" + extension.fingerprint();
            groups.computeIfAbsent(key, unused -> new Group(extension, new ArrayList<>())).indexes().add(i);
        }
        ArrayNode result = Json.MAPPER.createArrayNode();
        for (int i = 0; i < questions.size(); i++) result.addNull();
        // Sequential chunks bound process fan-out and preserve the existing rule sandbox.
        var ordered = new ArrayList<>(groups.values());
        ordered.sort(java.util.Comparator.comparing(g -> g.extension().id() + "@" + g.extension().version() + ":" + g.extension().fingerprint()));
        for (Group group : ordered) {
            int cursor = 0;
            while (cursor < group.indexes().size()) {
                ArrayNode batch = Json.MAPPER.createArrayNode(); var indexes = new ArrayList<Integer>(); int bytes = 0;
                while (cursor < group.indexes().size() && batch.size() < MAX_ITEMS) {
                    int index = group.indexes().get(cursor); JsonNode input = inputs.get(index);
                    int encoded = size(input);
                    if (!batch.isEmpty() && (long) bytes + encoded > TARGET_BYTES) break;
                    batch.add(input); indexes.add(index); bytes += encoded; cursor++;
                }
                JsonNode response = rules.run(group.extension(), Json.object().put("op", operation).set("questions", batch));
                if (field != null) {
                    JsonNode values = response.path(field);
                    if (!values.isArray() || values.size() != indexes.size()) throw new ApiException(422, "RULE_BATCH_INVALID", "Extension returned an invalid batch result");
                    for (int i = 0; i < indexes.size(); i++) result.set(indexes.get(i), values.get(i));
                }
            }
        }
        return result;
    }

    private static int size(JsonNode value) {
        try { return Json.MAPPER.writeValueAsBytes(value).length + 1; }
        catch (java.io.IOException e) { throw new IllegalStateException(e); }
    }
}
