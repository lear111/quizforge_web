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
        for (String folder : new String[]{"extensions/short-answer", "extensions/short-answer-1.1.0", "extensions/short-answer-1.2.0", "extensions/short-answer-1.2.1", "extensions/short-answer-1.2.2", "shared/richtext/1.0.0", "shared/richtext/1.1.0", "shared/richtext/1.1.1", "shared/richtext/1.1.2", "question-banks/short-answer-demo"}) {
            Path source = folder.startsWith("extensions/") || folder.startsWith("question-banks/") ? Path.of("..").resolve(folder) : Path.of(folder);
            try (var walk = Files.walk(source)) { for (Path path : walk.toList()) {
                Path target = root.resolve(folder).resolve(source.relativize(path)); if (Files.isDirectory(path)) Files.createDirectories(target); else Files.copy(path, target);
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
    void prepareMixed(String version) throws Exception {
        prepare(ShortAnswerUpgrade.TARGET_VERSION);
        Path source=Path.of("../extensions/single-choice");
        try(var paths=Files.walk(source)){for(Path path:paths.toList()){
            Path target=root.resolve("extensions/single-choice").resolve(source.relativize(path));
            if(Files.isDirectory(path))Files.createDirectories(target);else Files.copy(path,target);
        }}
        ObjectNode raw=(ObjectNode)Json.read(Path.of("../question-banks/mixed-demo/bank.json"),8*1024*1024);
        ((ObjectNode)raw.at("/questions/1/extension")).put("version",version);
        raw.put("formatVersion",1).put("customMetadata","preserve author metadata");
        Files.createDirectories(root.resolve("question-banks/mixed-demo"));
        Files.write(root.resolve("question-banks/mixed-demo/bank.json"),Json.MAPPER.writeValueAsBytes(raw));
        var engine=new RuleEngine(root,"node",Duration.ofSeconds(4));library=new Library(root,engine);states=new StateStore(root,engine);
        bank=library.collection("bank","mixed-demo");
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
        assertEquals("1.2.2",bank.extension().version());var q1After=states.question(bank,bank.question(q1));var q2After=states.question(bank,bank.question(q2));
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

    @Test void previousLatestVersionUpgradesWithoutChangingQuestionDataOrItsCompletedHistory() throws Exception {
        prepare("1.2.1");String qid=bank.questions().get(0).id();var dataBefore=bank.question(qid).data().deepCopy();
        act(qid,"submit",answer("保留此前简答题版本的回答。"));act(qid,"review",Json.object().set("review",Json.object().put("score",2.5)));
        var before=states.question(bank,bank.question(qid));String historyId=states.summary(bank).path("roundId").asText();
        var frozen=states.history("bank",bank.id(),historyId).deepCopy();Path source=oldStateFile();byte[] sourceBytes=Files.readAllBytes(source);
        assertEquals(1,ShortAnswerUpgrade.run(library,states));bank=library.collection("bank",bank.id());
        assertEquals("1.2.2",bank.extension().version());assertEquals("1.1.2",bank.extension().dependencies().get(0).version());
        assertEquals(dataBefore,bank.question(qid).data());assertEquals(before.at("/state/answer"),states.question(bank,bank.question(qid)).at("/state/answer"));
        assertEquals(before.at("/state/result"),states.question(bank,bank.question(qid)).at("/state/result"));
        assertEquals(frozen,states.history("bank",bank.id(),historyId));assertArrayEquals(sourceBytes,Files.readAllBytes(source));
    }

    @Test void mixedUpgradeKeepsOtherTypesAndAnswersAndBacksUpExactOldBytes() throws Exception {
        prepareMixed("1.2.0");String automatic="mixed-integer-division",manual="mixed-cache-boundary";
        act(automatic,"submit",Json.object().set("answer",Json.object().put("selectedOptionId","A")));
        act(manual,"submit",answer("使用缓存减少重复读取，原数据改变时更新缓存。"));act(manual,"review",Json.object().set("review",Json.object().put("score",2.5)));
        var ink=Json.object().put("schemaVersion",1);ink.putObject("viewport").put("x",3).put("y",7).put("zoom",1);ink.putArray("strokes");ink.putObject("paper").put("color","#ffffff").put("pattern","plain");
        act(manual,"whiteboard",Json.object().set("draft",ink));
        ObjectNode oldChoice=states.question(bank,bank.question(automatic)),oldManual=states.question(bank,bank.question(manual));
        var oldQuestionData=bank.question(manual).data().deepCopy();String historyId=states.summary(bank).path("roundId").asText();var oldHistory=states.history("bank",bank.id(),historyId).deepCopy();
        Path source=oldStateFile(),bankFile=root.resolve("question-banks/mixed-demo/bank.json");byte[] oldBytes=Files.readAllBytes(source),oldBankBytes=Files.readAllBytes(bankFile);
        assertEquals(1,ShortAnswerUpgrade.run(library,states));bank=library.collection("bank",bank.id());
        assertNull(bank.extension());assertEquals("bank:mixed-demo:mixed",bank.stateKey());
        assertEquals("1.2.2",bank.extensionFor(bank.question(manual)).version());assertEquals("1.0.0",bank.extensionFor(bank.question(automatic)).version());
        assertEquals(oldQuestionData,bank.question(manual).data());assertEquals(oldChoice.path("state"),states.question(bank,bank.question(automatic)).path("state"));
        ObjectNode current=states.question(bank,bank.question(manual));assertEquals(oldManual.at("/state/answer"),current.at("/state/answer"));assertEquals(oldManual.at("/state/result"),current.at("/state/result"));assertEquals(oldManual.path("draft"),current.path("draft"));
        ObjectNode history=states.history("bank",bank.id(),historyId);assertEquals(oldHistory.path("pages"),history.path("pages"));assertEquals(oldHistory.path("questions"),history.path("questions"));assertEquals("interrupted",history.path("status").asText());
        assertEquals(3.5,states.summary(bank).path("score").asDouble());assertEquals(7,states.summary(bank).path("maxScore").asInt());
        assertEquals("preserve author metadata",Json.read(bankFile,8*1024*1024).path("customMetadata").asText());
        try(var backups=Files.list(root.resolve(".state/upgrade-backups"))){Path backup=backups.findFirst().orElseThrow();assertArrayEquals(oldBytes,Files.readAllBytes(backup.resolve("state.json")));assertArrayEquals(oldBankBytes,Files.readAllBytes(backup.resolve("bank.json")));}
        var engine=new RuleEngine(root,"node",Duration.ofSeconds(4));library=new Library(root,engine);states=new StateStore(root,engine);bank=library.collection("bank",bank.id());
        assertEquals(current.path("state"),states.question(bank,bank.question(manual)).path("state"));assertEquals(history,states.history("bank",bank.id(),historyId));assertEquals(0,ShortAnswerUpgrade.run(library,states));
    }

    @Test void normalMixedLoadingDoesNotUpgradeBindingsOrRewriteState() throws Exception {
        prepareMixed("1.2.1");act("mixed-cache-boundary","draft",answer("读取不应迁移。"));
        Path state=oldStateFile(),bankFile=root.resolve("question-banks/mixed-demo/bank.json");byte[] oldState=Files.readAllBytes(state),oldBank=Files.readAllBytes(bankFile);
        var engine=new RuleEngine(root,"node",Duration.ofSeconds(4));library=new Library(root,engine);states=new StateStore(root,engine);bank=library.collection("bank",bank.id());
        assertEquals("1.2.1",bank.extensionFor(bank.question("mixed-cache-boundary")).version());states.question(bank,bank.question("mixed-cache-boundary"));
        assertArrayEquals(oldState,Files.readAllBytes(state));assertArrayEquals(oldBank,Files.readAllBytes(bankFile));assertFalse(Files.exists(root.resolve(".state/upgrade-backups")));
    }

    @Test void failedMixedBackupCannotChangeBankOrLiveState() throws Exception {
        prepareMixed("1.2.1");act("mixed-cache-boundary","draft",answer("备份失败时保留回答。"));
        Path state=oldStateFile(),bankFile=root.resolve("question-banks/mixed-demo/bank.json");byte[] oldState=Files.readAllBytes(state),oldBank=Files.readAllBytes(bankFile);
        Files.writeString(root.resolve(".state/upgrade-backups"),"unrelated file");
        assertThrows(java.io.IOException.class,()->ShortAnswerUpgrade.run(library,states));
        assertArrayEquals(oldState,Files.readAllBytes(state));assertArrayEquals(oldBank,Files.readAllBytes(bankFile));assertFalse(Files.exists(root.resolve(".state/.edit-journal.json")));
    }

    @Test void mixedTargetStateWithDifferentSavedSignatureIsNotOverwritten() throws Exception {
        prepareMixed("1.2.1");act("mixed-cache-boundary","draft",answer("原有状态。"));
        Path state=oldStateFile(),bankFile=root.resolve("question-banks/mixed-demo/bank.json");ObjectNode saved=(ObjectNode)Json.read(state,32*1024*1024);saved.put("extensionFingerprint","a".repeat(64));Files.write(state,Json.MAPPER.writeValueAsBytes(saved));
        byte[] oldState=Files.readAllBytes(state),oldBank=Files.readAllBytes(bankFile);
        assertEquals("UPGRADE_STATE_CHANGED",assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states)).code);
        assertArrayEquals(oldState,Files.readAllBytes(state));assertArrayEquals(oldBank,Files.readAllBytes(bankFile));
    }

    @Test void changedEditorDraftBlocksUpgradeAndPreservesItAndPractice() throws Exception {
        prepareMixed("1.2.1");String qid="mixed-cache-boundary";act(qid,"draft",answer("练习中的回答。"));
        var drafts=new EditorDraftStore(root);ObjectNode request=Json.object().put("contentVersion","a".repeat(64)).put("changed",true);
        request.set("draft",Json.object().put("pendingStem","尚未保存的题干"));drafts.put(bank.id(),qid,request);ObjectNode beforeDraft=drafts.get(bank.id(),qid);
        Path state=oldStateFile(),bankFile=root.resolve("question-banks/mixed-demo/bank.json");byte[] oldState=Files.readAllBytes(state),oldBank=Files.readAllBytes(bankFile);
        assertEquals("UPGRADE_EDITOR_DRAFT_PENDING",assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states)).code);
        assertEquals(beforeDraft,drafts.get(bank.id(),qid));assertArrayEquals(oldState,Files.readAllBytes(state));assertArrayEquals(oldBank,Files.readAllBytes(bankFile));
        assertFalse(Files.exists(root.resolve(".state/upgrade-backups")));
    }

    @Test void emptyExistingMixedTargetStateIsNeverOverwritten() throws Exception {
        prepareMixed("1.2.1");var plan=library.prepareShortAnswerUpgrade(bank);
        Path state=root.resolve(".state").resolve(ResourceStore.hash(bank.stateKey().getBytes(java.nio.charset.StandardCharsets.UTF_8))+".json");
        ObjectNode existing=Json.object().put("schemaVersion",1).put("collection",bank.stateKey()).put("extensionFingerprint",plan.collection().extensionFingerprint());existing.putObject("questions");
        Files.write(state,Json.MAPPER.writeValueAsBytes(existing));byte[] oldState=Files.readAllBytes(state),oldBank=Files.readAllBytes(plan.path());
        states=new StateStore(root,new RuleEngine(root,"node",Duration.ofSeconds(4)));
        assertEquals("UPGRADE_STATE_EXISTS",assertThrows(ApiException.class,()->states.upgradeShortAnswer(bank,plan)).code);
        assertArrayEquals(oldState,Files.readAllBytes(state));assertArrayEquals(oldBank,Files.readAllBytes(plan.path()));
    }

    @Test void pinnedAdvancedSdkSurvivesChangedSourcesAndUpgradePreservesItsHistoryAndState() throws Exception {
        prepare("1.2.0"); String qid=bank.questions().get(0).id();
        act(qid,"submit",answer("旧版本回答。"));act(qid,"review",Json.object().set("review",Json.object().put("score",2.5)));
        ObjectNode questionBefore=states.question(bank,bank.question(qid));var dataBefore=bank.question(qid).data().deepCopy();
        String historyId=states.history("bank",bank.id(),null).path("records").get(0).path("id").asText();var historyBefore=states.history("bank",bank.id(),historyId).deepCopy();
        Path stateBefore=oldStateFile(),archive=root.resolve(".state/sdk/quizforge.richtext/1.1.0/sdk.json");
        byte[] stateBytes=Files.readAllBytes(stateBefore),archiveBytes=Files.readAllBytes(archive);
        ObjectNode frozenSdk=(ObjectNode)Json.MAPPER.readTree(archiveBytes);
        var sourceBytes=new java.util.LinkedHashMap<Path,byte[]>();
        for(String asset:new String[]{"richtext.js","richtext-editor.js","richtext.css"}){
            Path source=root.resolve("shared/richtext/1.1.0/"+asset);
            Files.writeString(source,Files.readString(source)+"\n/* changed source must not replace a pinned SDK */\n");sourceBytes.put(source,Files.readAllBytes(source));
        }
        var engine=new RuleEngine(root,"node",Duration.ofSeconds(4));library=new Library(root,engine);bank=library.collection("bank",bank.id());
        assertEquals(frozenSdk.path("script"),library.sdk("quizforge.richtext","1.1.0").path("script"));
        assertEquals(frozenSdk.path("style"),library.sdk("quizforge.richtext","1.1.0").path("style"));
        assertEquals(frozenSdk.path("editorScript"),library.sdk("quizforge.richtext","1.1.0",true).path("script"));
        assertEquals(1,ShortAnswerUpgrade.run(library,states));bank=library.collection("bank",bank.id());
        assertEquals("1.2.2",bank.extension().version());assertEquals(dataBefore,bank.question(qid).data(),"1.2.0 already has the unified stem; no title may be added");
        assertEquals("1.1.2",bank.extension().dependencies().get(0).version());
        ObjectNode newSdk=library.sdk("quizforge.richtext","1.1.2");
        assertEquals(Files.readString(root.resolve("shared/richtext/1.1.2/richtext.js")),newSdk.path("script").asText());
        assertEquals(Files.readString(root.resolve("shared/richtext/1.1.2/richtext.css")),newSdk.path("style").asText());
        assertEquals(Files.readString(root.resolve("shared/richtext/1.1.2/richtext-editor.js")),library.sdk("quizforge.richtext","1.1.2",true).path("script").asText());
        assertNotEquals(frozenSdk.path("script"),newSdk.path("script"));
        ObjectNode expectedState=(ObjectNode)questionBefore.path("state").deepCopy();expectedState.put("revision",expectedState.path("revision").asLong()+1);
        assertEquals(expectedState,states.question(bank,bank.question(qid)).path("state"));
        assertEquals(historyBefore,states.history("bank",bank.id(),historyId));assertArrayEquals(stateBytes,Files.readAllBytes(stateBefore));assertArrayEquals(archiveBytes,Files.readAllBytes(archive));
        for(var source:sourceBytes.entrySet())assertArrayEquals(source.getValue(),Files.readAllBytes(source.getKey()));
        var restarted=new Library(root,new RuleEngine(root,"node",Duration.ofSeconds(4)));
        assertEquals("1.2.2",restarted.collection("bank",bank.id()).extension().version());assertEquals(0,ShortAnswerUpgrade.run(restarted,states));
    }

    @Test void missingUpgradeTargetReportsItsExactVersionWithoutChangingTheBank() throws Exception {
        prepare();Path target=root.resolve("extensions/short-answer-1.2.2");
        try(var paths=Files.walk(target)){for(Path path:paths.sorted(java.util.Comparator.reverseOrder()).toList())Files.delete(path);}
        byte[] before=Files.readAllBytes(root.resolve("question-banks/short-answer-demo/bank.json"));
        ApiException failure=assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states));
        assertEquals("MISSING_EXTENSION",failure.code);assertTrue(failure.getMessage().contains("1.2.2"));assertTrue(failure.getMessage().contains("not installed"));
        assertArrayEquals(before,Files.readAllBytes(root.resolve("question-banks/short-answer-demo/bank.json")));
    }

    @Test void invalidUpgradeDependencyPreservesManifestIdentityAndApiFailure() throws Exception {
        prepare();Path manifest=root.resolve("extensions/short-answer-1.2.2/manifest.json");
        ObjectNode raw=(ObjectNode)Json.MAPPER.readTree(Files.readAllBytes(manifest));((ObjectNode)raw.path("dependencies").get(0)).put("id","unsupported.sdk");Files.write(manifest,Json.MAPPER.writeValueAsBytes(raw));
        var target=java.util.stream.StreamSupport.stream(library.catalog().path("extensions").spliterator(),false).filter(row->row.path("id").asText().equals("quizforge.short-answer")&&row.path("version").asText().equals("1.2.2")).findFirst().orElseThrow();
        assertEquals("SDK_UNAVAILABLE",target.path("errorCode").asText());assertEquals("Unsupported public SDK package or version",target.path("error").asText());
        ApiException failure=assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states));assertEquals("SDK_UNAVAILABLE",failure.code);assertEquals(404,failure.status);
        assertTrue(failure.getMessage().contains("Unsupported public SDK package or version"));assertFalse(failure.getMessage().contains("not installed"));
    }

    @Test void missingUpgradeAssetReportsInvalidExtensionRatherThanMissingInstallation() throws Exception {
        prepare();Files.delete(root.resolve("extensions/short-answer-1.2.2/practice.html"));
        var target=java.util.stream.StreamSupport.stream(library.catalog().path("extensions").spliterator(),false).filter(row->row.path("id").asText().equals("quizforge.short-answer")&&row.path("version").asText().equals("1.2.2")).findFirst().orElseThrow();
        assertEquals("INVALID_EXTENSION",target.path("errorCode").asText());assertTrue(target.path("error").asText().contains("Invalid asset path"));
        ApiException failure=assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states));assertEquals("INVALID_EXTENSION",failure.code);assertFalse(failure.getMessage().contains("not installed"));
    }

    @Test void invalidPinnedTargetSdkIsReportedAndNeverReplacedFromSource() throws Exception {
        prepare();Path archive=root.resolve(".state/sdk/quizforge.richtext/1.1.2/sdk.json");Files.writeString(archive,"{}");
        byte[] bankBefore=Files.readAllBytes(root.resolve("question-banks/short-answer-demo/bank.json"));
        library=new Library(root,new RuleEngine(root,"node",Duration.ofSeconds(4)));
        ApiException failure=assertThrows(ApiException.class,()->ShortAnswerUpgrade.run(library,states));
        assertEquals("SDK_UNAVAILABLE",failure.code);assertTrue(failure.getMessage().contains("Invalid SDK archive"));assertFalse(failure.getMessage().contains("not installed"));
        assertEquals("{}",Files.readString(archive));assertArrayEquals(bankBefore,Files.readAllBytes(root.resolve("question-banks/short-answer-demo/bank.json")));
    }
}
