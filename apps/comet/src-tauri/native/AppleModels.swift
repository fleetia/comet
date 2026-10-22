import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

private func encoded(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8) else {
        return "{\"error\":\"Apple 모델 응답을 읽지 못했어요.\"}"
    }
    return text
}

private func availability() -> String {
    guard #available(macOS 26.0, *) else { return "unsupportedOs" }
    #if canImport(FoundationModels)
    switch SystemLanguageModel.default.availability {
    case .available:
        return SystemLanguageModel.default.supportsLocale(Locale(identifier: "ko-KR"))
            ? "available" : "unsupportedLanguage"
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return "deviceNotEligible"
        case .appleIntelligenceNotEnabled: return "appleIntelligenceNotEnabled"
        case .modelNotReady: return "modelNotReady"
        @unknown default: return "unknown"
        }
    @unknown default: return "unknown"
    }
    #else
    return "bridgeUnavailable"
    #endif
}

// All task/response access is synchronous under this lock; no lock crosses an await.
private final class Requests: @unchecked Sendable {
    let lock = NSLock()
    var tasks: [String: Task<Void, Never>] = [:]
    var responses: [String: String] = [:]

    func finish(_ id: String, _ response: String) {
        lock.lock()
        defer { lock.unlock() }
        guard tasks[id] != nil else { return }
        responses[id] = response
    }
}

private let requests = Requests()

@_cdecl("comet_apple_status")
public func cometAppleStatus() -> UnsafeMutablePointer<CChar>? {
    strdup(availability())
}

@_cdecl("comet_apple_poll")
public func cometApplePoll(_ idPointer: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let id = String(cString: idPointer)
    requests.lock.lock()
    defer { requests.lock.unlock() }
    guard let response = requests.responses.removeValue(forKey: id) else { return nil }
    requests.tasks.removeValue(forKey: id)
    return strdup(response)
}

@_cdecl("comet_apple_cancel")
public func cometAppleCancel(_ idPointer: UnsafePointer<CChar>) {
    let id = String(cString: idPointer)
    requests.lock.lock()
    let task = requests.tasks.removeValue(forKey: id)
    requests.responses.removeValue(forKey: id)
    requests.lock.unlock()
    task?.cancel()
}

@_cdecl("comet_apple_start")
public func cometAppleStart(
    _ idPointer: UnsafePointer<CChar>, _ requestPointer: UnsafePointer<CChar>
) {
    let id = String(cString: idPointer)
    let input = String(cString: requestPointer)
    requests.lock.lock()
    defer { requests.lock.unlock() }
    requests.tasks[id] = Task {
        let response: String
        do {
            try Task.checkCancellation()
            #if canImport(FoundationModels)
            if #available(macOS 26.0, *) {
                response = try await generate(input)
            } else {
                response = encoded(["error": "Apple 온디바이스 AI는 macOS 26 이상에서 사용할 수 있어요."])
            }
            #else
            response = encoded(["error": "이 앱 빌드에는 Apple Foundation Models 연결이 포함되지 않았어요."])
            #endif
        } catch is CancellationError {
            response = encoded(["error": "취소됨"])
        } catch {
            response = encoded(["error": "Apple 온디바이스 AI 생성에 실패했어요: \(error.localizedDescription)"])
        }
        requests.finish(id, response)
    }
}

#if canImport(FoundationModels)
private struct Request: Decodable {
    struct Message: Decodable {
        let role: String
        let content: String
    }
    let messages: [Message]
    let schema: String
    let outputTokens: Int
}

@available(macOS 26.0, *)
private func dynamicSchema(_ value: [String: Any], name: String) throws -> DynamicGenerationSchema {
    let description = value["description"] as? String
    switch value["type"] as? String {
    case "object":
        let properties = value["properties"] as? [String: [String: Any]] ?? [:]
        let required = value["required"] as? [String] ?? []
        return DynamicGenerationSchema(
            name: name, description: description,
            properties: try properties.keys.sorted().map { key in
                DynamicGenerationSchema.Property(
                    name: key,
                    description: properties[key]?["description"] as? String,
                    schema: try dynamicSchema(properties[key]!, name: "\(name)_\(key)"),
                    isOptional: !required.contains(key)
                )
            }
        )
    case "array":
        guard let items = value["items"] as? [String: Any] else { throw BridgeError.schema }
        return DynamicGenerationSchema(
            arrayOf: try dynamicSchema(items, name: "\(name)_item"),
            minimumElements: value["minItems"] as? Int,
            maximumElements: value["maxItems"] as? Int
        )
    case "string":
        let choices = value["enum"] as? [String]
        return DynamicGenerationSchema(type: String.self, guides: choices.map { [.anyOf($0)] } ?? [])
    case "boolean": return DynamicGenerationSchema(type: Bool.self)
    case "integer": return DynamicGenerationSchema(type: Int.self)
    case "number": return DynamicGenerationSchema(type: Double.self)
    default: throw BridgeError.schema
    }
}

private enum BridgeError: LocalizedError {
    case schema, context, unavailable
    var errorDescription: String? {
        switch self {
        case .schema: return "Apple 모델에서 지원하지 않는 응답 형식이에요."
        case .context: return "Apple 모델의 짧은 문맥 범위를 넘었어요. 입력을 줄이거나 다른 AI를 직접 선택해 주세요."
        case .unavailable: return "Apple 모델의 준비 상태가 바뀌었어요. 설정에서 다시 확인해 주세요."
        }
    }
}

@available(macOS 26.0, *)
private func generate(_ input: String) async throws -> String {
    guard availability() == "available" else { throw BridgeError.unavailable }
    let request = try JSONDecoder().decode(Request.self, from: Data(input.utf8))
    let rawSchema = try JSONSerialization.jsonObject(with: Data(request.schema.utf8))
    guard let rawSchema = rawSchema as? [String: Any] else { throw BridgeError.schema }
    let schema = try GenerationSchema(root: dynamicSchema(rawSchema, name: "CometResponse"), dependencies: [])
    let instructions = request.messages.filter { $0.role == "system" }.map(\.content).joined(separator: "\n")
    // Keep every selected turn and its role. Each request has a fresh session, so no
    // hidden native transcript accumulates across cancellations or user changes.
    let turns = request.messages.filter { $0.role != "system" }.map {
        ["role": $0.role, "content": $0.content]
    }
    let promptData = try JSONSerialization.data(withJSONObject: turns, options: [.sortedKeys])
    let prompt = String(decoding: promptData, as: UTF8.self)
    var inputTokens = instructions.utf8.count + prompt.utf8.count + request.schema.utf8.count
    #if COMET_APPLE_TOKEN_COUNT
    if #available(macOS 26.4, *) {
        let model = SystemLanguageModel.default
        let instructionCount = try await model.tokenCount(for: Instructions { instructions })
        let promptCount = try await model.tokenCount(for: Prompt { prompt })
        let schemaCount = try await model.tokenCount(for: schema)
        inputTokens = instructionCount + promptCount + schemaCount
    }
    #endif
    // The baseline 26.0 API has no tokenizer; UTF-8 bytes conservatively bound
    // its input. The extra reserve covers framework framing and system tokens.
    guard inputTokens + request.outputTokens + 512 <= 4096 else { throw BridgeError.context }
    let session = LanguageModelSession(model: .default, instructions: instructions)
    var options = GenerationOptions()
    options.maximumResponseTokens = request.outputTokens
    do {
        let response = try await session.respond(
            to: prompt, schema: schema,
            options: options
        )
        try Task.checkCancellation()
        guard response.content.isComplete else { throw BridgeError.context }
        return encoded(["result": response.content.jsonString])
    } catch LanguageModelSession.GenerationError.exceededContextWindowSize(_) {
        throw BridgeError.context
    }
}
#endif
