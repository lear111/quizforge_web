package io.quizforge.web;

import java.io.IOException;

/** Known compatible short-answer transitions; arbitrary plugin migrations remain unsupported. */
final class ShortAnswerUpgrade {
    static final String TARGET_VERSION = "1.2.2";
    private static final java.util.Set<String> SOURCE_VERSIONS = java.util.Set.of("1.0.0", "1.1.0", "1.2.0", "1.2.1");
    private ShortAnswerUpgrade() { }
    static boolean eligible(Library.Extension extension) {
        return extension != null && extension.id().equals("quizforge.short-answer") && SOURCE_VERSIONS.contains(extension.version());
    }
    static int run(Library library, StateStore states) throws IOException {
        int count = 0;
        for (var row : library.catalog().path("banks")) {
            if (row.has("error")) continue;
            Library.Collection bank = library.collection("bank", row.path("id").asText());
            if (bank.extensions().stream().noneMatch(ShortAnswerUpgrade::eligible)) continue;
            states.upgradeShortAnswer(bank, library.prepareShortAnswerUpgrade(bank)); count++;
        }
        return count;
    }
}
