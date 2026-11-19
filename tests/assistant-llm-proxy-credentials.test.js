import test from 'node:test'
import assert from 'node:assert/strict'

test('LLM proxy resolves only configured provider references over HTTPS', async () => {
  const { resolveAssistantLlmCredential } = await import('../scripts/dev-api.js')
  const url = new URL('https://api.example.test/v1')
  const key = { source: 'env', id: 'CLAWPANEL_TEST_PROVIDER_KEY' }
  const providers = { fixture: { baseUrl: 'https://api.example.test', apiKey: key } }
  process.env.CLAWPANEL_TEST_PROVIDER_KEY = 'fixture-credential'
  try {
    assert.equal(resolveAssistantLlmCredential(key, url, providers), 'fixture-credential')
    assert.equal(resolveAssistantLlmCredential('$CLAWPANEL_TEST_PROVIDER_KEY', url, providers), 'fixture-credential')
    assert.throws(() => resolveAssistantLlmCredential(key, url, {}), /not configured/)
    assert.throws(() => resolveAssistantLlmCredential(key, new URL('https://other.example.test'), providers), /not configured/)
    assert.throws(() => resolveAssistantLlmCredential('fixture-credential', new URL('http://api.example.test'), providers), /HTTPS/)
  } finally {
    delete process.env.CLAWPANEL_TEST_PROVIDER_KEY
  }
})
