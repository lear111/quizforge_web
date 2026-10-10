package io.quizforge.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Real host HTTP -> provider HTTP -> review/history, with no external model or user data. */
class AiHttpTest {
    @TempDir Path root;
    @Test void boundedRepairAutomaticScoreAndHistoryAreHostOwned() throws Exception {
        ServerTest fixture = new ServerTest(); fixture.root = root; fixture.prepare();
        fixture.write("extensions/generic/rules.js", """
                QF.defineType({
                  project(data,state){return {public:data.public};},
                  grade(){return {gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:null};},
                  review(data,answer,r){if(!Number.isInteger(r.score*2))throw new Error('step');return {gradingStatus:'graded',score:r.score,maxScore:5,correct:r.score===5,feedback:r.feedback??null};},
                  getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:5,gradingStatus:state.submitted?state.result.gradingStatus:'graded'};},
                  prepareAiGrading(data,answer){return {protocolVersion:1,question:[{type:'text',text:data.public}],answer:[{type:'text',text:answer.value}],referenceAnswer:[{type:'text',text:data.secret}],rubric:[{type:'text',text:'5 points total'}],maxScore:5,scoreStep:0.5};}
                });
                """);
        AtomicInteger calls = new AtomicInteger();
        HttpServer model = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        model.createContext("/v1/chat/completions", exchange -> {
            var prompt = Json.MAPPER.readTree(exchange.getRequestBody());
            assertEquals("mock-validation", prompt.path("model").asText());
            assertTrue(prompt.toString().contains("answer-secret"));
            int number = calls.incrementAndGet();
            int status = number == 1 ? 503 : 200;
            var body = Json.object();
            if(status == 503) body.putObject("error").put("code","service_unavailable");
            else {
                var content = Json.object().put("score", number == 2 ? 4.2 : 3.5).put("feedback","已说明主要概念，缺少缓存失效条件。");
                body.put("id","mock-response-"+number).put("model","mock-validation");
                var choice=body.putArray("choices").addObject().put("finish_reason","stop");choice.putObject("message").put("content",content.toString());
                body.putObject("usage").put("total_tokens",100);
            }
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });
        model.start();
        try {
            fixture.start(null);
            ObjectNode settings=Json.object().put("enabled",true).put("baseUrl","http://127.0.0.1:"+model.getAddress().getPort()+"/v1").put("model","mock-validation").put("apiKey","dummy-test-secret").put("outputMode","json");
            assertEquals(403,fixture.call("PUT","/api/settings/ai",settings.toString(),null,"http://foreign.example").status());
            var saved=fixture.call("PUT","/api/settings/ai",settings.toString(),null,"http://127.0.0.1:"+fixture.server.port());
            assertEquals(200,saved.status(),saved.body().toString());assertFalse(saved.body().toString().contains("dummy-test-secret"));assertFalse(saved.body().has("apiKey"));
            var submitted=fixture.post(ServerTest.QUESTION+"/actions",fixture.action("ai-submit-0001",0,"submit",fixture.answer("yes")));
            assertEquals(200,submitted.status(),submitted.body().toString());assertTrue(submitted.body().at("/capabilities/canAiGrade").asBoolean());
            var command=Json.object().put("requestId","ai-start-0001").put("contentVersion",submitted.body().at("/stamp/contentVersion").asText());
            var begun=fixture.post(ServerTest.QUESTION+"/ai/grade",command);assertEquals(200,begun.status(),begun.body().toString());
            String taskId=begun.body().path("taskId").asText(),taskPath=ServerTest.QUESTION+"/ai/tasks/"+taskId;
            assertEquals(taskId,fixture.post(ServerTest.QUESTION+"/ai/grade",command).body().path("taskId").asText());
            var task=begun.body();
            long end=System.nanoTime()+java.time.Duration.ofSeconds(20).toNanos();
            while(java.util.List.of("queued","running").contains(task.path("status").asText())&&System.nanoTime()<end){Thread.sleep(40);task=fixture.get(taskPath).body();}
            assertEquals("confirmed",task.path("status").asText(),task.toString());assertEquals(3,calls.get());assertEquals(3.5,task.at("/candidate/score").asDouble());
            var automaticallyGraded=fixture.get(ServerTest.QUESTION).body();assertEquals("graded",automaticallyGraded.at("/state/result/gradingStatus").asText());assertEquals(3.5,automaticallyGraded.at("/state/result/score").asDouble());
            assertEquals(404,fixture.get("/api/collections/bank/bank/questions/q2/ai/tasks/"+taskId).status());
            var confirmed=fixture.post(taskPath+"/confirm",Json.object().put("requestId","ai-confirm-0001").put("candidateVersion",task.at("/candidate/version").asText()));
            assertEquals(200,confirmed.status(),confirmed.body().toString());var payload=confirmed.body().path("payload");assertEquals(3.5,payload.at("/state/result/score").asDouble());
            assertTrue(payload.at("/state/result/feedback").asText().contains("最终得分：3.5 / 5"));
            var conflicting=fixture.post(taskPath+"/confirm",Json.object().put("requestId","ai-confirm-change").put("candidateVersion",task.at("/candidate/version").asText()).put("score",4));assertEquals(409,conflicting.status());assertEquals("AI_CANDIDATE_CONFLICT",conflicting.body().at("/error/code").asText());
            var reviewed=fixture.post(ServerTest.QUESTION+"/actions",fixture.action("ai-manual-0001",payload.at("/state/revision").asLong(),"review",Json.object().set("review",Json.object().put("score",2))));
            assertEquals(200,reviewed.status(),reviewed.body().toString());assertTrue(reviewed.body().at("/state/result/feedback").asText().contains("最终得分：2 / 5"));assertTrue(reviewed.body().at("/state/result/feedback").asText().contains("3.5"));
            fixture.finishCurrent("ai-finish-0001");
            var history=fixture.get("/api/collections/bank/bank/history").body();String roundId=history.path("records").get(0).path("id").asText();
            var frozen=fixture.get("/api/collections/bank/bank/history/"+roundId).body();assertEquals(2,frozen.at("/summary/score").asDouble());assertTrue(frozen.toString().contains("最终得分：2 / 5"));assertFalse(frozen.toString().contains("dummy-test-secret"));
            assertEquals(3,calls.get());
        } finally {fixture.close();model.stop(0);}
    }
}
