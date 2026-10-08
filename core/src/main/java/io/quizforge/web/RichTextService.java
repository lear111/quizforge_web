package io.quizforge.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Resolves a public document contract to an application-owned, immutable provider. */
final class RichTextService {
    record Resolution(List<Library.Dependency> dependencies, ObjectNode contentApi, String revision) {
        Resolution { dependencies = List.copyOf(dependencies); }
    }
    private record Profile(String id, Library.Dependency provider, List<String> capabilities, Set<String> legacyVersions) { }
    private record Registry(int major, int minor, int documentFormat, List<Profile> profiles) { }
    private record RegistryStamp(Object fileKey, long size, FileTime modified) { }
    private static final Set<String> PROFILES = Set.of("basic-v1", "advanced-v1");
    private static final Set<String> CAPABILITIES = Set.of("basic-formatting", "images", "advanced-formatting", "tables", "math", "image-resize");
    private final Path directory;
    private RegistryStamp cachedStamp;
    private Registry cachedRegistry;

    RichTextService(Path codeRoot) { directory = codeRoot.resolve("shared/richtext"); }
    Path registryPath() { return directory.resolve("service.json"); }

    Resolution resolve(JsonNode manifest) throws IOException {
        JsonNode requirement = manifest.get("requiresRichText"), dependencies = manifest.get("dependencies");
        if (requirement != null && dependencies != null)
            throw invalidRequirement("requiresRichText 与旧 dependencies 不能同时声明，请只声明富文本公共接口需求。");
        if (requirement != null) return required(requirement, registry(true));
        if (dependencies == null) return new Resolution(List.of(), null, "");
        if (!dependencies.isArray() || dependencies.size() > 4) throw ApiException.bad("Invalid SDK dependencies");
        var values = new ArrayList<Library.Dependency>(); var ids = new HashSet<String>();
        ObjectNode api = null; String revision = "";
        Registry registry = null;
        for (JsonNode value : dependencies) {
            if (!value.isObject() || value.size() != 2) throw ApiException.bad("Invalid SDK dependency");
            String id = Json.id(value, "id"), version = Json.id(value, "version");
            Library.validateSdk(id, version);
            if (!ids.add(id)) throw ApiException.bad("Duplicate SDK dependency");
            // Unregistered pins remain exact. A new provider is used only after the
            // application explicitly records this legacy version's compatible profile.
            if (registry == null) registry = registry(false);
            Profile profile = legacy(registry, version);
            if (profile == null) values.add(new Library.Dependency(id, version));
            else {
                values.add(profile.provider()); api = metadata(registry, profile); revision = revision(profile.provider(), api);
            }
        }
        return new Resolution(values, api, revision);
    }

    private Resolution required(JsonNode value, Registry registry) {
        if (!value.isObject() || !Set.of("major", "minMinor", "documentFormat", "documentProfile", "capabilities").containsAll(properties(value))
                || !integer(value.get("major"), 1) || !integer(value.get("minMinor"), 0) || !integer(value.get("documentFormat"), 1)
                || !value.path("documentProfile").isTextual())
            throw invalidRequirement("requiresRichText 必须声明整数 major、minMinor、documentFormat 以及 documentProfile，可选 capabilities。");
        if (value.path("major").asInt() != registry.major() || value.path("minMinor").asInt() > registry.minor())
            throw new ApiException(422, "UNSUPPORTED_RICHTEXT_API", "拓展需要的富文本接口版本尚未得到应用支持，请使用兼容拓展或升级应用；原题库未修改。");
        if (value.path("documentFormat").asInt() != registry.documentFormat())
            throw new ApiException(422, "UNSUPPORTED_RICHTEXT_DOCUMENT_FORMAT", "拓展需要的富文本文档格式尚未得到应用支持；原题库未修改。");
        Profile profile = registry.profiles().stream().filter(item -> item.id().equals(value.path("documentProfile").asText())).findFirst().orElseThrow(
                () -> new ApiException(422, "UNSUPPORTED_RICHTEXT_PROFILE", "应用不支持富文本文档配置「" + value.path("documentProfile").asText() + "」。请使用兼容拓展或向开发者反馈。"));
        List<String> requested = capabilities(value.get("capabilities"), "INVALID_RICHTEXT_REQUIREMENT");
        for (String capability : requested) if (!profile.capabilities().contains(capability))
            throw new ApiException(422, "UNSUPPORTED_RICHTEXT_CAPABILITY", "富文本文档配置「" + profile.id() + "」不支持能力「" + capability + "」。请使用兼容拓展或向开发者反馈。");
        ObjectNode api = metadata(registry, profile);
        return new Resolution(List.of(profile.provider()), api, revision(profile.provider(), api));
    }

    private Registry registry(boolean required) throws IOException {
        Path path = registryPath();
        if (Files.isSymbolicLink(directory.getParent()) || Files.isSymbolicLink(directory) || Files.isSymbolicLink(path)) throw invalidRegistry();
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            cachedStamp = null; cachedRegistry = null;
            if (required) throw new ApiException(422, "RICHTEXT_SERVICE_UNAVAILABLE", "应用未安装富文本公共服务，无法满足拓展的 requiresRichText 声明。");
            return null;
        }
        BasicFileAttributes attributes = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile()) throw invalidRegistry();
        RegistryStamp stamp = new RegistryStamp(attributes.fileKey(), attributes.size(), attributes.lastModifiedTime());
        if (stamp.equals(cachedStamp)) return cachedRegistry;
        JsonNode value;
        try { value = Json.read(path, 64 * 1024); }
        catch (IOException e) { throw invalidRegistry(); }
        if (!value.isObject() || !Set.of("schemaVersion", "api", "defaultProfile", "profiles").equals(properties(value))
                || !integer(value.get("schemaVersion"), 1) || value.path("schemaVersion").asInt() != 1) throw invalidRegistry();
        JsonNode api = value.path("api");
        if (!api.isObject() || !Set.of("major", "minor", "documentFormat").equals(properties(api))
                || !integer(api.get("major"), 1) || !integer(api.get("minor"), 0) || !integer(api.get("documentFormat"), 1)
                || api.path("major").asInt() != 1 || api.path("minor").asInt() != 0 || api.path("documentFormat").asInt() != 1)
            throw invalidRegistry();
        JsonNode profiles = value.path("profiles");
        if (!profiles.isArray() || profiles.isEmpty() || profiles.size() > 2 || !value.path("defaultProfile").isTextual()) throw invalidRegistry();
        var result = new ArrayList<Profile>(); var ids = new HashSet<String>(); var versions = new HashSet<String>();
        for (JsonNode profile : profiles) {
            if (!profile.isObject() || !Set.of("id", "provider", "capabilities", "legacyVersions").equals(properties(profile))
                    || !profile.path("id").isTextual() || !PROFILES.contains(profile.path("id").asText()) || !ids.add(profile.path("id").asText())) throw invalidRegistry();
            JsonNode provider = profile.path("provider");
            if (!provider.isObject() || !Set.of("id", "version").equals(properties(provider)) || !provider.path("id").isTextual() || !provider.path("version").isTextual()
                    || !provider.path("id").asText().equals("quizforge.richtext") || !provider.path("version").asText().matches("[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}")) throw invalidRegistry();
            List<String> supported = capabilities(profile.get("capabilities"), "INVALID_RICHTEXT_SERVICE");
            if (supported.isEmpty() || !CAPABILITIES.containsAll(supported)) throw invalidRegistry();
            // Profiles are separate document schemas, not a promise that all old
            // rule validators can consume every new editing feature.
            if (profile.path("id").asText().equals("basic-v1") && supported.stream().anyMatch(item -> !Set.of("basic-formatting", "images").contains(item))) throw invalidRegistry();
            JsonNode legacy = profile.path("legacyVersions"); if (!legacy.isArray() || legacy.size() > 100) throw invalidRegistry();
            var aliases = new HashSet<String>();
            for (JsonNode item : legacy) if (!item.isTextual() || !item.asText().matches("[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}") || !aliases.add(item.asText()) || !versions.add(item.asText())) throw invalidRegistry();
            result.add(new Profile(profile.path("id").asText(), new Library.Dependency(provider.path("id").asText(), provider.path("version").asText()), supported, Set.copyOf(aliases)));
        }
        if (!ids.contains(value.path("defaultProfile").asText())) throw invalidRegistry();
        Registry resultRegistry = new Registry(api.path("major").asInt(), api.path("minor").asInt(), api.path("documentFormat").asInt(), List.copyOf(result));
        cachedStamp = stamp; cachedRegistry = resultRegistry;
        return resultRegistry;
    }
    private static Profile legacy(Registry registry, String version) {
        if (registry == null) return null;
        return registry.profiles().stream().filter(profile -> profile.legacyVersions().contains(version)).findFirst().orElse(null);
    }
    private static ObjectNode metadata(Registry registry, Profile profile) {
        ObjectNode api = Json.object().put("major", registry.major()).put("minor", registry.minor()).put("documentFormat", registry.documentFormat()).put("documentProfile", profile.id());
        for (String capability : profile.capabilities()) api.withArray("capabilities").add(capability);
        return api;
    }
    private static String revision(Library.Dependency provider, ObjectNode api) {
        ObjectNode value = Json.object().put("id", provider.id()).put("version", provider.version()); value.set("api", api);
        return Json.fingerprint(value, "quizforge-richtext-service-v1");
    }
    private static List<String> capabilities(JsonNode values, String code) {
        if (values == null) return List.of();
        if (!values.isArray() || values.size() > 100) throw new ApiException(422, code, "富文本 capabilities 必须是能力名称数组。");
        var result = new ArrayList<String>(); var seen = new HashSet<String>();
        for (JsonNode item : values) {
            if (!item.isTextual() || item.asText().isBlank() || item.asText().length() > 100 || !seen.add(item.asText())) throw new ApiException(422, code, "富文本 capabilities 必须包含不重复的非空字符串。");
            result.add(item.asText());
        }
        return List.copyOf(result);
    }
    private static boolean integer(JsonNode value, int minimum) {
        return value != null && value.isIntegralNumber() && value.canConvertToInt() && value.intValue() >= minimum;
    }
    private static Set<String> properties(JsonNode value) { var result = new HashSet<String>(); value.fieldNames().forEachRemaining(result::add); return result; }
    private static ApiException invalidRequirement(String message) { return new ApiException(422, "INVALID_RICHTEXT_REQUIREMENT", message); }
    private static ApiException invalidRegistry() { return new ApiException(422, "INVALID_RICHTEXT_SERVICE", "应用的富文本公共服务配置无效，请修复或重新安装应用；题库和拓展原文件未修改。"); }
}
