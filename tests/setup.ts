import '@testing-library/jest-dom/vitest'

// Tests must never reach a real model provider, a real mailbox, or the real
// clock. The fake ModelProvider is wired explicitly by each test; these guards
// exist so an accidental real-credential read fails loudly instead of silently
// making a paid API call.
process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-credential'
process.env.MOMENTUM_ENV = 'test'

// Integration tests run against a throwaway in-memory database. Set before any
// module imports the client, so no test can touch the developer's real
// momentum.db.
process.env.DATABASE_URL = ':memory:'
