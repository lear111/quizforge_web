package io.quizforge.web;

import java.io.IOException;

/** Explicit schema-compatible transition to automatically saved short-answer scores. */
final class ShortAnswerAutoUpgrade {
    static final String SOURCE_VERSION = "1.2.2";
    static final String TARGET_VERSION = "1.3.0";

    private ShortAnswerAutoUpgrade() { }

    static boolean eligible(Library.Extension extension) {
        return extension != null && extension.id().equals("quizforge.short-answer")
                && extension.version().equals(SOURCE_VERSION);
    }

    static int run(Library library, StateStore states) throws IOException {
        int count = 0;
        for (var row : library.catalog().path("banks")) {
            if (row.has("error")) continue;
            Library.Collection bank = library.collection("bank", row.path("id").asText());
            if (bank.extensions().stream().noneMatch(ShortAnswerAutoUpgrade::eligible)) continue;
            states.upgradeShortAnswerAuto(bank, library.prepareShortAnswerAutoUpgrade(bank));
            count++;
        }
        return count;
    }
}
