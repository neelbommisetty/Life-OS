const allowedScopes = [
  "web",
  "api",
  "ios",
  "db",
  "ai",
  "logger",
  "repo",
  "docs",
  "tooling",
  "monorepo",
]

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "scope-enum-multi": ({ scope }, _when, value = []) => {
          if (!scope) {
            return [false, "scope may not be empty"]
          }

          const scopes = scope
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)

          if (scopes.length === 0) {
            return [false, "scope may not be empty"]
          }

          const invalidScopes = scopes.filter((item) => !value.includes(item))
          if (invalidScopes.length > 0) {
            return [
              false,
              `invalid scope(s): ${invalidScopes.join(", ")}. Allowed scopes: ${value.join(", ")}`,
            ]
          }

          return [true]
        },
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "scope-empty": [2, "never"],
    "scope-enum": [0],
    "scope-enum-multi": [
      2,
      "always",
      allowedScopes,
    ],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
    "body-leading-blank": [2, "always"],
    "body-empty": [2, "never"],
  },
}
