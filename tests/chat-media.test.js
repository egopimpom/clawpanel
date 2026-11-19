import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as media from '../src/lib/chat-media.js'

const image = 'data:image/png;base64,AAAA'
const imageUrl = 'https://example.test/render?id=123'
const content = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
const sources = message => media.collectChatImages(message).map(media.attachmentImageSource)

test('normalizes user attachments, model output and structured tool results', () => {
  assert.deepEqual(sources({ attachments: [{ category: 'image', content: 'AAAA' }] }), [image])
  assert.deepEqual(sources({ content: [null, { type: 'image_url', image_url: { url: imageUrl } }] }), [imageUrl])
  assert.deepEqual(sources({ content: [{ type: 'output_image', image_url: imageUrl }] }), [imageUrl])
  assert.deepEqual(sources({ output: [{ type: 'image_generation_call', result: 'AAAA' }] }), [image])
  assert.deepEqual(sources({ content: [{ type: 'tool_result', content: [content] }] }), [image])
  assert.deepEqual(sources({ result: { data: [{ b64_json: 'AAAA' }] } }), [image])
  assert.deepEqual(sources({ partialResult: { images: [{ url: imageUrl }] } }), [imageUrl])
})

test('deduplicates repeated media without reading tool inputs or non-image attachments', () => {
  assert.deepEqual(sources({ args: { content: [content] }, attachments: [{ type: 'audio', url: imageUrl }] }), [])
  assert.deepEqual(sources({ content: [content], result: { attachments: [{ type: 'image', url: image }] } }), [image])
  const [omitted] = media.collectChatImages({ content: [{ type: 'image', omitted: true }] })
  assert.equal(omitted.omitted, true)
  assert.equal(media.attachmentImageSource(omitted), '')
})

test('rejects unsupported URLs and falls back from bad URLs to usable bytes', () => {
  for (const candidate of ['javascript:alert(1)', 'file:///tmp/a.png', '//example.test/a.png',
    '/\\example.test/a.png', 'https://u:p@example.test/a.png', 'data:image/svg+xml;base64,AAAA']) {
    assert.equal(media.imageSource(candidate), '')
  }
  assert.equal(media.attachmentImageSource({ url: 'file:///tmp/x', content: 'AAAA' }), image)
  assert.equal(media.imageSource('/api/image.png'), '/api/image.png')
})

test('resolves Gateway identity avatars and initials for absent or unsupported avatars', () => {
  assert.deepEqual(media.agentAvatar({ identity: { name: 'Анна Петрова', avatarUrl: image } }, 'worker'), { src: image, initials: 'АП' })
  assert.deepEqual(media.agentAvatar({ identity: { avatar: 'avatars/local.png' } }, 'code-review'), { src: '', initials: 'CR' })
  assert.deepEqual(media.agentAvatar(null, '🦅'), { src: '', initials: '🦅' })
})

test('live and history paths include media-only tool/model messages and keep distinct user images', () => {
  const source = readFileSync(new URL('../src/pages/chat.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
  const context = vm.createContext({ ...media })
  vm.runInContext(source, context)
  const tool = { role: 'toolResult', name: 'image', content: [content] }
  const live = context.extractChatContent(tool)
  const history = context.extractContent(tool)
  assert.equal(media.attachmentImageSource(live.images[0]), image)
  assert.equal(media.attachmentImageSource(history.images[0]), image)
  assert.equal(history.tools[0].name, 'image')
  const messages = context.dedupeHistory([
    { role: 'user', content: [content] },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }] },
    tool,
    { role: 'assistant', content: 'Here it is', images: [{ url: imageUrl }] },
  ])
  assert.equal(messages.length, 3)
  assert.equal(messages[2].images.length, 2)
  assert.equal(context.historyCacheMessage({ ...tool, id: 'tool-image' }).attachments.length, 1)
})

test('Markdown images preserve signed URLs and use no inline error handler', async () => {
  globalThis.window = {}
  try {
    const { renderMarkdown } = await import('../src/lib/markdown.js')
    const html = renderMarkdown('![A "caption"](https://example.test/foo_bar_baz.png?a=1&b=2)')
    assert.match(html, /foo_bar_baz\.png\?a=1&amp;b=2/)
    assert.match(html, /alt="A &quot;caption&quot;"/)
    assert.doesNotMatch(html, /onerror=/)
    assert.match(renderMarkdown('**![x](/image.png)**'), /<strong><img[^>]+><\/strong>/)
    assert.doesNotMatch(renderMarkdown('![x](javascript:alert(1))'), /src=/)
  } finally {
    delete globalThis.window
  }
})

test('avatar updates do not bypass Gateway model confirmation or rebind chat state', async () => {
  let confirmModel
  const storage = new Map()
  const avatar = {}
  const context = vm.createContext({
    ...media, avatar, t: key => key, toast() {},
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    isGatewayOfficialModel: () => false,
    wsClient: {
      gatewayReady: true,
      requestCompat: async method => {
        assert.equal(method, 'agents.list')
        return { agents: [{ id: 'main', identity: { avatarUrl: image } }] }
      },
      sessionsSetModel: (session, model) => {
        assert.equal(session, 'agent:main:main')
        assert.equal(model, 'test/new')
        return new Promise(resolve => { confirmModel = resolve })
      },
    },
  })
  const source = readFileSync(new URL('../src/pages/chat.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
  vm.runInContext(source + `
    _sessionKey = 'agent:main:main';
    _page = { querySelector: id => id === '#chat-title-avatar' ? avatar : null };
    _modelSelectEl = {};
    _sendBtn = { dataset: {} };
    _textarea = { value: 'draft' };
    _availableModels = ['test/old', 'test/new'];
    _selectedModel = 'test/old';
    globalThis.readState = () => [_selectedModel, _sendBtn.disabled, _modelSelectEl.disabled].join(',');
  `, context)
  const pending = context.applySelectedModel('test/new')
  await context.refreshChatAgents()
  assert.match(avatar.innerHTML, /data:image\/png;base64,AAAA/)
  assert.equal(context.readState(), 'test/old,true,true')
  confirmModel()
  await pending
  assert.equal(context.readState(), 'test/new,false,false')
  assert.equal(storage.get('clawpanel-chat-selected-model'), 'test/new')
})
