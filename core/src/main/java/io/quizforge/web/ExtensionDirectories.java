package io.quizforge.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Folders organize installed single-type extensions; they never become identities. */
final class ExtensionDirectories {
    private static final int MAX_GROUP_DEPTH = 4, MAX_DIRECTORIES = 1000, MAX_EXTENSIONS = 200;
    private ExtensionDirectories() { }
    static List<Path> scan(Path directory) {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return List.of();
        try {
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Extensions must be a normal directory");
            Path base = directory.toRealPath(); if (!base.equals(directory.toAbsolutePath().normalize())) throw new IOException("Extensions cannot be a redirected directory");
            var leaves = new ArrayList<Path>(); int[] visited = {0};
            walk(base, base, 0, visited, leaves); return List.copyOf(leaves);
        } catch (IOException error) { throw new ApiException(422, "INVALID_EXTENSION_DIRECTORIES", error.getMessage()); }
    }
    private static void walk(Path base, Path directory, int depth, int[] visited, List<Path> leaves) throws IOException {
        if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS) || !directory.toRealPath().equals(directory) || !directory.startsWith(base)) throw new IOException("Extension groups cannot contain links or redirected directories");
        if (depth > 0 && (Files.exists(directory.resolve("manifest.json"), LinkOption.NOFOLLOW_LINKS) || Files.exists(directory.resolve("development.json"), LinkOption.NOFOLLOW_LINKS))) {
            if (depth > MAX_GROUP_DEPTH + 1 || leaves.size() >= MAX_EXTENSIONS) throw new IOException("Extension directory depth or count exceeds the limit");
            leaves.add(directory); return;
        }
        if (depth > MAX_GROUP_DEPTH) throw new IOException("Extension groups may be nested at most four levels");
        try (var entries = Files.list(directory)) {
            List<Path> children = entries.filter(path -> Files.isSymbolicLink(path) || Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)).sorted(Comparator.naturalOrder()).limit(MAX_DIRECTORIES + 1L).toList();
            for (Path child : children) {
                if (++visited[0] > MAX_DIRECTORIES) throw new IOException("Too many extension directories");
                if (!Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(child)) throw new IOException("Extension groups cannot contain links or redirected directories");
                walk(base, child, depth + 1, visited, leaves);
            }
        }
    }
    static String group(Path extensions, Path directory) {
        try { return extensions.toRealPath().relativize(directory.toRealPath().getParent()).toString().replace('\\', '/'); }
        catch (IOException error) { throw new ApiException(422, "INVALID_EXTENSION_DIRECTORIES", "Extension group cannot be read"); }
    }
}
