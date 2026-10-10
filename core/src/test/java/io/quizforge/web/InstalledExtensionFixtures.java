package io.quizforge.web;

import java.nio.file.Path;

final class InstalledExtensionFixtures {
    private InstalledExtensionFixtures() { }
    static Path find(String id, String version) throws Exception {
        for (Path directory : ExtensionDirectories.scan(Path.of("../extensions"))) {
            if (DevelopmentExtensions.marked(directory)) continue;
            try {
                var manifest = Json.read(directory.resolve("manifest.json"), 256 * 1024);
                if (manifest.path("id").asText().equals(id) && manifest.path("version").asText().equals(version)) return directory;
            } catch (java.io.IOException ignored) { }
        }
        throw new java.io.IOException("Installed test source unavailable: " + id + "@" + version);
    }
}
