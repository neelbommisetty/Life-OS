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
    }
}
