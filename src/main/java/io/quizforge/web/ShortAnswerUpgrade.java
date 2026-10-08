package io.quizforge.web;

import java.io.IOException;

/** Known compatible short-answer transitions; arbitrary plugin migrations remain unsupported. */
final class ShortAnswerUpgrade {
    private ShortAnswerUpgrade() { }
    static int run(Library library, StateStore states) throws IOException {
        int count = 0;
        for (var row : library.catalog().path("banks")) {
            if (row.has("error") || !row.at("/extension/id").asText().equals("quizforge.short-answer") || !java.util.Set.of("1.0.0", "1.1.0").contains(row.at("/extension/version").asText())) continue;
            Library.Collection bank = library.collection("bank", row.path("id").asText());
            states.upgradeShortAnswer(bank, library.prepareShortAnswerUpgrade(bank)); count++;
        }
        return count;
    }
}
