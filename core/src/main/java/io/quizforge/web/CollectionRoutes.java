package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;

/** Collection HTTP dispatch. Authentication and write validation stay at the server boundary. */
final class CollectionRoutes {
    interface Writes {
        JsonNode read(HttpExchange exchange) throws IOException;
        void validateOrigin(HttpExchange exchange);
    }
    private final Library library;
    private final StateStore states;
    private final AiGradingService aiGrading;
    private final Writes writes;
    CollectionRoutes(Library library, StateStore states, AiGradingService aiGrading, Writes writes) {
        this.library = library; this.states = states; this.aiGrading = aiGrading; this.writes = writes;
    }
    JsonNode route(HttpExchange exchange, String method, String[] parts) throws IOException {
            states.recover();
            String kind = parts[2]; String id = routeId(parts[3]);
            if (!kind.equals("bank") && !kind.equals("extension")) throw ApiException.bad("Invalid collection kind");
            if (parts.length == 4 && method.equals("GET")) return states.overview(library.collection(kind, id));
            if (parts.length == 5 && parts[4].equals("summary") && method.equals("GET")) return states.summary(library.collection(kind, id));
            if (parts.length == 5 && parts[4].equals("finish") && method.equals("POST")) { JsonNode request = writes.read(exchange); return states.finish(library.collection(kind, id), request); }
            if (parts.length == 5 && parts[4].equals("history") && method.equals("GET")) return states.history(kind, id, null);
            if (parts.length == 6 && parts[4].equals("history") && method.equals("GET")) return states.history(kind, id, routeId(parts[5]));
            if (parts.length == 6 && parts[4].equals("history") && method.equals("DELETE")) { writes.validateOrigin(exchange); return states.deleteHistory(kind, id, routeId(parts[5])); }
            if (parts.length >= 6 && parts[4].equals("questions")) {
                String qid = routeId(parts[5]);
                if (parts.length == 6 && method.equals("GET")) { Library.Collection collection = library.collection(kind, id); Library.Question question = collection.question(qid); var response = states.question(collection, question); var task = aiGrading.current(collection, question); if (task != null) response.set("aiTask", task); return response; }
                if (parts.length == 7 && parts[6].equals("stamp") && method.equals("GET")) { Library.Collection collection = library.collection(kind, id); return states.stamp(collection, collection.question(qid)); }
                if (parts.length == 7 && parts[6].equals("editor") && method.equals("GET")) { Library.Collection collection = library.collection(kind, id); return states.editor(library, collection, collection.question(qid)); }
                if (parts.length == 7 && parts[6].equals("edit") && method.equals("POST")) { JsonNode request = writes.read(exchange); Library.Collection collection = library.collection(kind, id); return states.edit(library, collection, collection.question(qid), request); }
                if (parts.length == 7 && parts[6].equals("actions") && method.equals("POST")) {
                    JsonNode request = writes.read(exchange);
                    Library.Collection collection = library.collection(kind, id); return states.act(collection, collection.question(qid), request);
                }
                if (parts.length >= 8 && parts[6].equals("ai")) {
                    Library.Collection collection = library.collection(kind, id); Library.Question question = collection.question(qid);
                    if (parts.length == 8 && parts[7].equals("current") && method.equals("GET")) { var response = Json.object(); var task = aiGrading.current(collection, question); if (task == null) response.putNull("task"); else response.set("task", task); return response; }
                    if (parts.length == 8 && parts[7].equals("grade") && method.equals("POST")) return aiGrading.start(collection, question, writes.read(exchange));
                    if (parts.length >= 9 && parts[7].equals("tasks")) {
                        String taskId = routeId(parts[8]);
                        if (parts.length == 9 && method.equals("GET")) return aiGrading.get(collection, question, taskId);
                        if (parts.length == 10 && method.equals("POST")) {
                            if (parts[9].equals("retry")) return aiGrading.retry(collection, question, taskId, writes.read(exchange));
                            if (parts[9].equals("confirm")) return aiGrading.confirm(collection, question, taskId, writes.read(exchange));
                        }
                    }
                }
            }
        throw new ApiException(404, "NOT_FOUND", "Endpoint not found");
    }
    private static String routeId(String value) { if (!value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}")) throw ApiException.bad("Invalid resource ID"); return value; }
}
