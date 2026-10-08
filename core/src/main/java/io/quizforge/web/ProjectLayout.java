package io.quizforge.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

/** Code may live in core; banks, extensions and persisted data always stay at dataRoot. */
record ProjectLayout(Path dataRoot, Path codeRoot) {
    static ProjectLayout resolve(Path requestedRoot) throws IOException {
        Path dataRoot = requestedRoot.toRealPath();
        Path core = dataRoot.resolve("core");
        if (!Files.exists(core, LinkOption.NOFOLLOW_LINKS)) return new ProjectLayout(dataRoot, dataRoot);
        if (Files.isSymbolicLink(core) || !Files.isDirectory(core, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Core code directory must be a normal directory");
        return new ProjectLayout(dataRoot, core);
    }
}
