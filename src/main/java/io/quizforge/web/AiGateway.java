package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** One complete model call. Retry and repair budgets belong to the grading service. */
interface AiGateway {
    record Request(ObjectNode gradingInput, boolean repair, String invalidOutput) { }
    record Response(String output, String provider, String model, String responseId, JsonNode usage) { }
    Response generate(Request request);
    default AiGateway freeze() { return this; }
    default ObjectNode testConnection() { throw new AiProviderException("AI_TEST_UNAVAILABLE", false, 0); }
}
