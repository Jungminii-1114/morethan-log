import type { OptionsOfJSONResponseBody } from "got"

export const NOTION_GOT_OPTIONS: OptionsOfJSONResponseBody = {
  retry: {
    limit: 8,
    methods: ["POST"],
    statusCodes: [408, 429, 500, 502, 503, 504],
    errorCodes: [
      "ETIMEDOUT",
      "ECONNRESET",
      "EADDRINUSE",
      "ECONNREFUSED",
      "EPIPE",
      "ENOTFOUND",
      "ENETUNREACH",
      "EAI_AGAIN",
    ],
  },
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const withNotionRetry = async <T>(
  request: () => Promise<T>,
  label: string,
  attempts = 3
) => {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break

      const message =
        error instanceof Error ? error.message : "Unknown Notion API error"
      console.warn(
        `${label} failed; retrying (${attempt}/${attempts - 1})`,
        message
      )
      await delay(1000 * attempt)
    }
  }

  throw lastError
}
