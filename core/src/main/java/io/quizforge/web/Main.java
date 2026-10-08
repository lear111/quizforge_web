package io.quizforge.web;

import java.nio.file.Path;

public final class Main {
    private Main() { }
    public static void main(String[] args) throws Exception {
        Path root = Path.of("."); String host = "127.0.0.1", token = null, node = "node"; int port = 8080; boolean upgradeShortAnswer = false;
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--upgrade-short-answer")) { upgradeShortAnswer = true; continue; }
            if (args[i].equals("--help")) { System.out.println("java -jar quizforge-web-1.0.0.jar [--root DIRECTORY] [--host ADDRESS] [--port 8080] [--token TOKEN] [--node EXECUTABLE] [--upgrade-short-answer]"); return; }
            if (i + 1 >= args.length) throw new IllegalArgumentException("Missing value for " + args[i]); String value = args[++i];
            switch (args[i - 1]) { case "--root" -> root = Path.of(value); case "--host" -> host = value; case "--port" -> port = Integer.parseInt(value); case "--token" -> token = value; case "--node" -> node = value; default -> throw new IllegalArgumentException("Unknown option: " + args[i - 1]); }
        }
        if (port < 0 || port > 65535) throw new IllegalArgumentException("Invalid port");
        QuizForgeServer server = new QuizForgeServer(root, host, port, token, node); Runtime.getRuntime().addShutdownHook(new Thread(server::close));
        // Bind the selected main port before upgrading; normal duplicate launches cannot write.
        try { if (upgradeShortAnswer) System.out.println("Short-answer banks upgraded: " + server.upgradeShortAnswerBanks()); server.start(); }
        catch (Exception failure) { server.close(); throw failure; }
        System.out.println("QuizForge Web listening on http://" + (host.contains(":") ? "[" + host + "]" : host) + ":" + server.port());
        System.out.println("Local administrator supplied extensions only; Node restrictions are not a full hostile-code sandbox.");
    }
}
