package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

/** A lightweight instrumented child isolates routing/chunking from plugin implementations. */
class MixedCollectionTest {
    @TempDir Path root;
    RuleEngine rules;
    Library library;

    @BeforeEach void prepare() throws Exception {
        write("server/rules-runner.cjs", """
                const fs=require('node:fs'),crypto=require('node:crypto');let input='';
                process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
                  try{const r=JSON.parse(input),owner=fs.readFileSync(r.rules,'utf8').trim(),token=crypto.randomUUID();
                    for(const q of r.questions||[])if((q.data||q).owner!==owner)throw Error('Wrong extension route');
                    const data=r.op==='validateBank'?{valid:true}:{projected:r.questions.map(q=>({owner:q.data.owner,text:q.data.text,token}))};
                    process.stdout.write(JSON.stringify({ok:true,data}));
                  }catch(e){process.stdout.write(JSON.stringify({ok:false}));process.exitCode=1;}
                });
                """);
        for (String owner : List.of("alpha", "beta")) {
            String folder = "extensions/" + owner + "/";
            write(folder + "manifest.json", """
                    {"id":"%s","version":"1.0.0","name":"%s","entry":"page.html","script":"page.js","style":"page.css","rules":"rules.js","questionSchema":"question.json","answerSchema":"answer.json","examples":"examples.json"}
                    """.formatted(owner, owner));
            write(folder + "page.html", "<article>" + owner + "</article>"); write(folder + "page.js", "// " + owner); write(folder + "page.css", "article{}");
            write(folder + "rules.js", owner); write(folder + "question.json", "{}"); write(folder + "answer.json", "{}");
            ObjectNode example = Json.object().put("id", "examples").put("title", "Example"); example.set("extension", reference(owner));
            example.putArray("questions").add(question("example", owner, false)); write(folder + "examples.json", example.toString());
        }
        rules = new RuleEngine(root, "node", Duration.ofSeconds(8)); library = new Library(root, rules);
    }
    void write(String path, String text) throws Exception { Path file = root.resolve(path); Files.createDirectories(file.getParent()); Files.writeString(file, text); }
    ObjectNode reference(String owner) { return Json.object().put("id", owner).put("version", "1.0.0"); }
    ObjectNode question(String id, String owner, boolean explicit) {
        ObjectNode q = Json.object().put("id", id).put("title", id); q.set("data", Json.object().put("owner", owner).put("text", id));
        if (explicit) q.set("extension", reference(owner)); return q;
    }
    ObjectNode mixed() {
        ObjectNode bank = Json.object().put("id", "mixed-bank").put("title", "Mixed");
        bank.putArray("questions").add(question("q1", "alpha", true)).add(question("q2", "beta", true)).add(question("q3", "alpha", true)); return bank;
    }
    Library.Collection load(ObjectNode bank) throws Exception { write("question-banks/bank.json", bank.toString()); return library.collection("bank", bank.path("id").asText()); }

    @Test void perQuestionVersionsPreserveOrderAndGroupNonAdjacentQuestions() throws Exception {
        Library.Collection bank = load(mixed());
        assertNull(bank.extension()); assertEquals("bank:mixed-bank:mixed", bank.stateKey()); assertEquals(2, bank.extensions().size());
        assertEquals(List.of("alpha", "beta", "alpha"), bank.questions().stream().map(q -> bank.extensionFor(q).id()).toList());
        List<JsonNode> inputs = bank.questions().stream().map(q -> (JsonNode) Json.object().set("data", q.data())).toList();
        ArrayNode projected = RuleBatches.run(rules, bank.questions(), "projectBatch", "projected", inputs);
        assertEquals(List.of("q1", "q2", "q3"), List.of(projected.get(0).path("text").asText(), projected.get(1).path("text").asText(), projected.get(2).path("text").asText()));
        assertEquals(projected.get(0).path("token"), projected.get(2).path("token"));
        assertNotEquals(projected.get(0).path("token"), projected.get(1).path("token"));
        String fingerprint = bank.extensionFingerprint();
        ObjectNode reordered = mixed(); ArrayNode rows = (ArrayNode) reordered.path("questions"); JsonNode first = rows.remove(0); rows.add(first);
        assertEquals(fingerprint, load(reordered).extensionFingerprint());
    }
    @Test void legacyDefaultRetainsStateIdentityAndMayBeOverriddenPerQuestion() throws Exception {
        ObjectNode bank = Json.object().put("id", "legacy").put("title", "Legacy"); bank.set("extension", reference("alpha"));
        bank.putArray("questions").add(question("q1", "alpha", false));
        Library.Collection legacy = load(bank); assertEquals("bank:legacy:alpha:1.0.0", legacy.stateKey());
        assertEquals(legacy.extension().fingerprint(), legacy.extensionFingerprint());
        ((ArrayNode) bank.path("questions")).add(question("q2", "beta", true)); Library.Collection mixed = load(bank);
        assertNull(mixed.extension()); assertEquals("alpha", mixed.extensionFor(mixed.question("q1")).id()); assertEquals("beta", mixed.extensionFor(mixed.question("q2")).id());
    }
    @Test void missingOrMalformedReferencesRejectTheWholeBank() throws Exception {
        ObjectNode bank = mixed(); ((ObjectNode) bank.at("/questions/1/extension")).put("id", "absent");
        assertThrows(ApiException.class, () -> load(bank)); assertTrue(library.catalog().at("/banks/0/error").isTextual());
        ((ObjectNode) bank.at("/questions/1/extension")).put("id", "beta").put("version", 1);
        assertThrows(ApiException.class, () -> load(bank));
        ((ObjectNode) bank.at("/questions/1")).remove("extension"); assertThrows(ApiException.class, () -> load(bank));
    }
    @Test void largeGroupsUseBoundedChunksWithoutLosingOriginalIndexes() throws Exception {
        Library.Collection bank = load(mixed()); Library.Question source = bank.question("q1");
        var questions = new ArrayList<Library.Question>(); var inputs = new ArrayList<JsonNode>();
        for (int i = 0; i < 513; i++) {
            ObjectNode data = Json.object().put("owner", "alpha").put("text", "row-" + i);
            questions.add(new Library.Question("q" + i, "q" + i, data, source.fingerprint(), source.extension())); inputs.add(Json.object().set("data", data));
        }
        ArrayNode values = RuleBatches.run(rules, questions, "projectBatch", "projected", inputs);
        assertEquals(513, values.size()); assertEquals(values.get(0).path("token"), values.get(511).path("token")); assertNotEquals(values.get(0).path("token"), values.get(512).path("token"));
        assertEquals("row-512", values.get(512).path("text").asText());
        inputs.removeLast(); assertThrows(ApiException.class, () -> RuleBatches.run(rules, questions, "projectBatch", "projected", inputs));
    }
}
