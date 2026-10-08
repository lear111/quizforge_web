package io.quizforge.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ShortAnswerUpgradeTest {
    @TempDir Path root;
    Library library; StateStore states; Library.Collection bank;
    void prepare() throws Exception {
        prepare("1.0.0");
    }
    void prepare(String version) throws Exception {
        ServerTest fixture = new ServerTest(); fixture.root = root; fixture.prepare();
        for (String folder : new String[]{"extensions/short-answer", "extensions/short-answer-1.1.0", "extensions/short-answer-1.2.0", "shared/richtext/1.0.0", "shared/richtext/1.1.0", "question-banks/short-answer-demo"}) {
            Path source = Path.of(folder);
            try (var walk = Files.walk(source)) { for (Path path : walk.toList()) {
                Path target = root.resolve(path); if (Files.isDirectory(path)) Files.createDirectories(target); else Files.copy(path, target);
            } }
        }
        Path bankFile = root.resolve("question-banks/short-answer-demo/bank.json");
        ObjectNode raw = (ObjectNode) Json.MAPPER.readTree(Files.readAllBytes(bankFile));
        ((ObjectNode) raw.path("extension")).put("version", version);
        Files.write(bankFile, Json.MAPPER.writeValueAsBytes(raw));
        var engine = new RuleEngine(root, "node", Duration.ofSeconds(4)); library = new Library(root, engine); states = new StateStore(root, engine);
        bank = library.collection("bank", "short-answer-demo");
    }
    ObjectNode answer(String text) {
        var answer = Json.object().put("formatVersion",1); answer.putObject("document").put("type","doc").putArray("content").addObject().put("type","paragraph").putArray("content").addObject().put("type","text").put("text",text);
        return Json.object().set("answer",answer);
    }
    ObjectNode act(String qid,String action,ObjectNode data) {
        var state = states.question(bank,bank.question(qid)).path("state");
        ObjectNode request = Json.object().put("requestId",java.util.UUID.randomUUID().toString()).put("revision",state.path("revision").asLong()).put("action",action);
        request.set("data",data);return states.act(bank,bank.question(qid),request);
    }
    Path oldStateFile() throws Exception {
        try(var paths=Files.list(root.resolve(".state"))){return paths.filter(path->path.getFileName().toString().matches("[a-f0-9]{64}\\.json")).findFirst().orElseThrow();}
    }
    @Test void runningPracticeKeepsAnswerInkGradesAndFrozenOldHistoryAndSupportsAi() throws Exception {
        prepare();String q1=bank.questions().get(0).id(),q2=bank.questions().get(1).id();
        act(q1,"submit",answer("输入是水果；处理是搅拌；输出为果汁。"));act(q2,"draft",answer("缓存复用已读取的数据。"));
        var ink = Json.object().put("schemaVersion",1); ink.putObject("viewport").put("x",12).put("y",8).put("zoom",1);ink.putArray("strokes");ink.putObject("paper").put("color","#ffffff").put("pattern","plain");
        act(q1,"whiteboard",Json.object().set("draft",ink));
        var q1Before=states.question(bank,bank.question(q1));var q2Before=states.question(bank,bank.question(q2));
        String historyId=states.history("bank",bank.id(),null).path("records").get(0).path("id").asText();
        var frozen=states.history("bank",bank.id(),historyId).deepCopy();Path oldFile=oldStateFile();byte[] oldBytes=Files.readAllBytes(oldFile);
        byte[] oldPackage=Files.readAllBytes(root.resolve("extensions/short-answer/rules.js"));
        assertEquals(1,ShortAnswerUpgrade.run(library,states));bank=library.collection("bank",bank.id());
        assertEquals("1.2.0",bank.extension().version());var q1After=states.question(bank,bank.question(q1));var q2After=states.question(bank,bank.question(q2));
        assertEquals(q1Before.at("/question/title").asText(), bank.question(q1).data().at("/stem/content/0/content/0/text").asText());
        assertEquals(q1Before.at("/state/answer"),q1After.at("/state/answer"));assertEquals(q1Before.at("/state/result"),q1After.at("/state/result"));assertEquals(q1Before.path("draft"),q1After.path("draft"));
        assertEquals(q2Before.at("/state/answer"),q2After.at("/state/answer"));assertEquals("draft",q2After.at("/state/status").asText());assertTrue(q1After.at("/capabilities/canAiGrade").asBoolean());
        var snapshot=states.prepareAiGrading(bank,bank.question(q1),Json.object());assertEquals(0.5,snapshot.gradingInput().path("scoreStep").asDouble());assertTrue(snapshot.gradingInput().path("answer").toString().contains("果汁"));
        assertEquals(frozen,states.history("bank",bank.id(),historyId));assertArrayEquals(oldBytes,Files.readAllBytes(oldFile));assertArrayEquals(oldPackage,Files.readAllBytes(root.resolve("extensions/short-answer/rules.js")));
        assertEquals(0,ShortAnswerUpgrade.run(library,states));
        assertEquals(1,java.util.stream.StreamSupport.stream(library.catalog().path("extensions").spliterator(),false).filter(row->row.path("id").asText().equals("quizforge.short-answer")).count());
        var restored = new StateStore(root,new RuleEngine(root,"node",Duration.ofSeconds(4)));var restoredQuestion=restored.question(bank,bank.question(q1));
        assertEquals(q1After.path("state"),restoredQuestion.path("state"));assertEquals(q1After.path("draft"),restoredQuestion.path("draft"));
    }
    @Test void completedAnswersBecomeNewRoundDraftsAndOldFinalScoreRemainsFrozen() throws Exception {
        prepare();String qid=bank.questions().get(1).id();act(qid,"submit",answer("缓存减少重复读取，但编辑后需更新。"));act(qid,"review",Json.object().set("review",Json.object().put("score",3.5)));
        var summary=states.summary(bank);var finish=Json.object().put("requestId","finish-before-upgrade").put("summaryVersion",summary.path("summaryVersion").asText());finish.set("roundId",summary.path("roundId"));states.finish(bank,finish);
        String historyId=states.history("bank",bank.id(),null).path("records").get(0).path("id").asText();var frozen=states.history("bank",bank.id(),historyId).deepCopy();
        ShortAnswerUpgrade.run(library,states);bank=library.collection("bank",bank.id());var current=states.question(bank,bank.question(qid));
        assertEquals("draft",current.at("/state/status").asText());assertTrue(current.at("/state/answer/document").toString().contains("缓存"));assertTrue(current.at("/state/result").isNull());assertEquals(frozen,states.history("bank",bank.id(),historyId));
    }
    @Test void existingNewVersionStateIsNeverOverwritten() throws Exception {
        prepare();var plan=library.prepareShortAnswerUpgrade(bank);String hash=ResourceStore.hash(plan.collection().stateKey().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Path collision=root.resolve(".state").resolve(hash+".json");Files.writeString(collision,"keep-new-state");byte[] original=plan.before();
        assertEquals("UPGRADE_STATE_EXISTS",assertThrows(ApiException.class,()->states.upgradeShortAnswer(bank,plan)).code);
        assertArrayEquals(original,Files.readAllBytes(plan.path()));assertEquals("keep-new-state",Files.readString(collision));
    }
    @Test void aiVersionRetainsConfirmedGradeAndRestoresHistoryAcrossRestart() throws Exception {
        prepare("1.1.0"); String qid=bank.questions().get(0).id();
        act(qid,"submit",answer("输入、处理、输出组成完整过程。"));act(qid,"review",Json.object().set("review",Json.object().put("score",2.5)));
        var before=states.question(bank,bank.question(qid));String historyId=states.history("bank",bank.id(),null).path("records").get(0).path("id").asText();var frozen=states.history("bank",bank.id(),historyId).deepCopy();
        Path oldFile=oldStateFile();byte[] oldBytes=Files.readAllBytes(oldFile);
        assertEquals(1,ShortAnswerUpgrade.run(library,states));bank=library.collection("bank",bank.id());
        var after=states.question(bank,bank.question(qid));assertEquals(before.at("/state/answer"),after.at("/state/answer"));assertEquals(before.at("/state/result"),after.at("/state/result"));assertArrayEquals(oldBytes,Files.readAllBytes(oldFile));
        var engine=new RuleEngine(root,"node",Duration.ofSeconds(4));var restartedLibrary=new Library(root,engine);var restartedStates=new StateStore(root,engine);
        assertEquals(0,ShortAnswerUpgrade.run(restartedLibrary,restartedStates));assertEquals(frozen,restartedStates.history("bank",bank.id(),historyId));
        assertEquals(after.path("state"),restartedStates.question(restartedLibrary.collection("bank",bank.id()),restartedLibrary.collection("bank",bank.id()).question(qid)).path("state"));
    }
}
