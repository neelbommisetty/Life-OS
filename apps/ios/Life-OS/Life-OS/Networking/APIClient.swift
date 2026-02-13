import Foundation

struct APIClient {
    func request(path: String, method: String = "GET", body: [String: String]? = nil) async throws -> Data {
        if APIEnvironment.useMockAPI {
            let mockResponse = await IOSMockAPI.shared.request(
                path: path,
                method: method,
                body: body
            )

            if mockResponse.statusCode == 401 {
                let message = parseMessage(from: mockResponse.data) ?? "Unauthorized"
                throw AppNetworkError.unauthorized(message)
            }

            guard (200 ..< 300).contains(mockResponse.statusCode) else {
                let message = parseMessage(from: mockResponse.data) ?? "Request failed with status \(mockResponse.statusCode)"
                throw AppNetworkError.server(status: mockResponse.statusCode, message: message)
            }

            return mockResponse.data
        }

        let url = try resolveURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.httpShouldHandleCookies = true

        if let cookieHeader = await inMemoryCookieJar.cookieHeader(for: url) {
            request.setValue(cookieHeader, forHTTPHeaderField: "cookie")
        }

        if let body {
            guard JSONSerialization.isValidJSONObject(body) else {
                throw AppNetworkError.invalidBody
            }

            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppNetworkError.invalidResponse
        }

        await inMemoryCookieJar.ingest(response: httpResponse, for: url)

        if httpResponse.statusCode == 401 {
            let message = parseMessage(from: data) ?? "Unauthorized"
            throw AppNetworkError.unauthorized(message)
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let message = parseMessage(from: data) ?? "Request failed with status \(httpResponse.statusCode)"
            throw AppNetworkError.server(status: httpResponse.statusCode, message: message)
        }

        return data
    }

    private func resolveURL(path: String) throws -> URL {
        let normalized = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let base = APIEnvironment.baseURL.absoluteString.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)

        guard let url = URL(string: "\(base)/\(normalized)") else {
            throw AppNetworkError.invalidURL
        }

        return url
    }

    private func parseMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
        return payload?.message ?? payload?.error
    }

    func clearAllCookies() {
        let storage = HTTPCookieStorage.shared
        storage.cookies?.forEach(storage.deleteCookie)
        Task {
            await inMemoryCookieJar.clear()
        }
    }

    private var inMemoryCookieJar: InMemoryCookieJar {
        APIClient.cookieJar
    }

    private static let cookieJar = InMemoryCookieJar()
}

actor InMemoryCookieJar {
    private var cookiesByHost: [String: [String: String]] = [:]

    func ingest(response: HTTPURLResponse, for url: URL) {
        guard let host = normalizedHost(for: url) else {
            return
        }

        let cookiePairs = parseSetCookiePairs(from: response.allHeaderFields)
        guard !cookiePairs.isEmpty else {
            return
        }

        var hostCookies = cookiesByHost[host] ?? [:]
        for (cookieName, cookieValue) in cookiePairs {
            if cookieValue.isEmpty {
                hostCookies.removeValue(forKey: cookieName)
            } else {
                hostCookies[cookieName] = cookieValue
            }
        }

        cookiesByHost[host] = hostCookies
    }

    func cookieHeader(for url: URL) -> String? {
        guard
            let host = normalizedHost(for: url),
            let hostCookies = cookiesByHost[host],
            !hostCookies.isEmpty
        else {
            return nil
        }

        return hostCookies
            .sorted(by: { $0.key < $1.key })
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "; ")
    }

    func clear() {
        cookiesByHost.removeAll()
    }

    private func normalizedHost(for url: URL) -> String? {
        url.host?.lowercased()
    }

    private func parseSetCookiePairs(
        from headerFields: [AnyHashable: Any]
    ) -> [(String, String)] {
        var pairs: [(String, String)] = []

        for (rawKey, rawValue) in headerFields {
            guard
                let key = rawKey as? String,
                key.caseInsensitiveCompare("set-cookie") == .orderedSame
            else {
                continue
            }

            let headerValue: String
            if let stringValue = rawValue as? String {
                headerValue = stringValue
            } else {
                headerValue = "\(rawValue)"
            }

            // Multiple cookies can be collapsed into one header string.
            let cookieChunks = headerValue.split(separator: ",")
            for chunk in cookieChunks {
                let segment = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !segment.isEmpty else {
                    continue
                }

                let pairSegment = segment.split(separator: ";", maxSplits: 1).first ?? Substring()
                guard let equalsIndex = pairSegment.firstIndex(of: "=") else {
                    continue
                }

                let name = pairSegment[..<equalsIndex]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let value = pairSegment[pairSegment.index(after: equalsIndex)...]
                    .trimmingCharacters(in: .whitespacesAndNewlines)

                guard !name.isEmpty else {
                    continue
                }

                pairs.append((name, value))
            }
        }

        return pairs
    }
}
