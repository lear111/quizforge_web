package io.quizforge.web;

import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/** Page-scoped practice. Expiry never replaces state belonging to a live request. */
final class PracticeSessions implements AutoCloseable {
    private static final int MAX_SESSIONS = 32;
    private static final long IDLE_NANOS = Duration.ofMinutes(30).toNanos();
    private static final long MAX_BYTES = 256L * 1024 * 1024, WRITE_HEADROOM = 32L * 1024 * 1024;
    interface Factory { Session create() throws IOException; }
    static final class Session implements AutoCloseable {
        final StateStore states;
        final ResourceStore resources, developmentResources;
        final AiGradingService ai, developmentAi;
        final CollectionRoutes routes, developmentRoutes;
        long touched = System.nanoTime(); int active;
        Session(StateStore states, ResourceStore resources, ResourceStore developmentResources, AiGradingService ai, AiGradingService developmentAi, CollectionRoutes routes, CollectionRoutes developmentRoutes) {
            this.states = states; this.resources = resources; this.developmentResources = developmentResources; this.ai = ai; this.developmentAi = developmentAi; this.routes = routes; this.developmentRoutes = developmentRoutes;
        }
        long bytes() { return states.memoryBytes() + resources.memoryBytes() + developmentResources.memoryBytes() + ai.memoryBytes() + developmentAi.memoryBytes(); }
        @Override public void close() { ai.close(); developmentAi.close(); states.clearMemory(); resources.clearMemory(); developmentResources.clearMemory(); }
    }
    final class Lease implements AutoCloseable {
        final Session session;
        Lease(Session session) { this.session = session; }
        @Override public void close() { synchronized (PracticeSessions.this) { session.active--; session.touched = System.nanoTime(); } }
    }
    private final Map<String, Session> sessions = new LinkedHashMap<>();
    private final Factory factory;
    PracticeSessions(Factory factory) { this.factory = factory; }
    synchronized Lease acquire(String id, boolean create, boolean writing) throws IOException {
        expire();
        if (id == null || id.isBlank()) { if (create) throw new ApiException(409, "PRACTICE_SESSION_REQUIRED", "Temporary practice requires this browser page's session ID"); return null; }
        if (!id.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")) throw ApiException.bad("Invalid practice session ID");
        Session value = sessions.get(id);
        if (writing && bytes() > MAX_BYTES - WRITE_HEADROOM) throw limit();
        if (value == null && create) {
            if (sessions.size() >= MAX_SESSIONS || bytes() > MAX_BYTES - WRITE_HEADROOM) throw limit();
            value = factory.create(); sessions.put(id, value);
        }
        if (value == null) return null;
        value.active++; value.touched = System.nanoTime(); return new Lease(value);
    }
    private long bytes() { long count = 0; for (Session value : sessions.values()) count += value.bytes(); return count; }
    private void expire() {
        long now = System.nanoTime(); var iterator = sessions.entrySet().iterator();
        while (iterator.hasNext()) { Session value = iterator.next().getValue(); if (value.active == 0 && now - value.touched > IDLE_NANOS) { iterator.remove(); value.close(); } }
    }
    private static ApiException limit() { return new ApiException(429, "PRACTICE_SESSION_LIMIT", "Temporary practice capacity is full; existing answers are preserved. Close idle pages and retry later"); }
    @Override public synchronized void close() { sessions.values().forEach(Session::close); sessions.clear(); }
}
