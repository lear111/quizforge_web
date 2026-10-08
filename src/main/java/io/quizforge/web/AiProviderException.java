package io.quizforge.web;

/** Safe classification only: no provider response text, endpoint, headers, or credentials. */
final class AiProviderException extends RuntimeException {
    final String code;
    final boolean retryable;
    final long retryAfterMillis;
    AiProviderException(String code, boolean retryable, long retryAfterMillis) {
        super(message(code)); this.code = code; this.retryable = retryable; this.retryAfterMillis = Math.max(0, Math.min(5000, retryAfterMillis));
    }
    private static String message(String code) {
        return switch (code) {
            case "AI_NOT_CONFIGURED" -> "请先在本机设置中配置并启用 AI 模型。";
            case "AI_AUTH" -> "模型认证失败，请检查 API 密钥。";
            case "AI_QUOTA" -> "模型配额或余额不足，请检查供应商配置或账户。";
            case "AI_CONFIG" -> "模型地址、名称或能力配置不匹配。";
            case "AI_VISION_UNSUPPORTED" -> "本题含图片，请使用已启用图片能力的模型配置。";
            case "AI_INPUT_LIMIT" -> "评分内容或图片超过本次调用上限。";
            case "AI_IMAGE_UNAVAILABLE" -> "评分所需的图片资源无法读取。";
            case "AI_RATE_LIMIT" -> "模型暂时限制请求，请稍后重试。";
            case "AI_UPSTREAM" -> "模型服务暂时不可用。";
            case "AI_TIMEOUT" -> "模型调用等待超时。";
            case "AI_NETWORK" -> "无法连接模型服务。";
            case "AI_RESPONSE_LIMIT" -> "模型响应超过允许的大小。";
            case "AI_RESPONSE_INVALID" -> "模型没有返回完整可用的响应。";
            case "AI_REFUSED" -> "模型未提供评分结果。";
            default -> "AI 调用未能完成。";
        };
    }
}
