const RASTER_MIME = 'image/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon)'
const DATA_IMAGE = new RegExp(`^data:${RASTER_MIME};base64,[a-z0-9+/]+={0,2}$`, 'i')
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|heic|avif|bmp|svg)(?:[?#]|$)/i

export function imageSource(value) {
  if (typeof value !== 'string') return ''
  const src = value.trim()
  if (DATA_IMAGE.test(src)) return src
  if (/^\/(?![/\\])/.test(src) && !/[\\\u0000-\u0020]/.test(src)) return src
  if (!/^https?:\/\//i.test(src)) return ''
  try {
    const url = new URL(src)
    return url.username || url.password ? '' : url.href
  } catch { return '' }
}

export function imageAttachment(image) {
  const firstString = (...values) => values.find(value => typeof value === 'string' && value) || ''
  return {
    category: 'image',
    mimeType: firstString(image.mediaType, image.mimeType, image.media_type, image.source?.media_type, 'image/png'),
    content: firstString(image.data, image.b64_json, image.source?.data, image.content),
    url: firstString(image.url, image.source?.url, image.image_url?.url, image.image_url),
    fileName: firstString(image.fileName, image.name, image.alt),
    omitted: !!image.omitted,
  }
}

export function attachmentImageSource(image) {
  const { mimeType, content, url, omitted } = imageAttachment(image)
  if (omitted) return ''
  return imageSource(url) || (typeof content === 'string' && content
    ? imageSource(content.startsWith('data:') ? content : `data:${mimeType};base64,${content}`)
    : '')
}

export function mergeChatImages(...lists) {
  const seen = new Set()
  return lists.flat().filter(image => {
    const key = attachmentImageSource(image) || `${image.omitted}:${image.fileName || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Hash media content without keeping another copy of the entire history as a string.
export function chatImageFingerprint(images) {
  let hash = 2166136261
  for (const image of images) {
    for (const field of [image.url, image.content, image.mimeType, image.fileName, String(image.omitted)]) {
      hash = Math.imul(hash ^ (field?.length || 0), 16777619)
      for (let i = 0; i < field?.length; i++) hash = Math.imul(hash ^ field.charCodeAt(i), 16777619)
    }
  }
  return `${images.length}:${hash >>> 0}`
}

export function isImagePath(url) {
  return typeof url === 'string' && (IMAGE_PATH.test(url) || /^data:image\//i.test(url))
}

/** Only inspect declared media and known result containers, not tool inputs. */
export function collectChatImages(message) {
  const images = []
  const visited = new Set()
  function visit(value, depth = 0, collection) {
    if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (collection === 'images' && typeof item === 'string') images.push(imageAttachment({ url: item }))
        else visit(item, depth + 1, collection)
      })
      return
    }
    const kind = value.category || value.type
    const mime = value.mimeType || value.mediaType || value.media_type
    const declared = ['image', 'image_url', 'input_image', 'output_image', 'image_generation_call'].includes(kind) ||
      (typeof mime === 'string' && mime.startsWith('image/')) ||
      typeof value.b64_json === 'string' || collection === 'images' || (collection === 'attachments' && isImagePath(value.url))
    if (declared && !['audio', 'video', 'voice'].includes(kind)) {
      const image = imageAttachment(value)
      if (kind === 'image_generation_call' && typeof value.result === 'string') image.content ||= value.result
      images.push(image)
      return
    }
    const urls = Array.isArray(value.mediaUrls) ? value.mediaUrls : [value.mediaUrl]
    urls.filter(isImagePath).forEach(url => images.push(imageAttachment({ url })))
    visit(value.attachments, depth + 1, 'attachments')
    visit(value.images, depth + 1, 'images')
    if (Array.isArray(value.data)) visit(value.data, depth + 1)
    visit(value.content, depth + 1)
    visit(value.partialResult, depth + 1)
    if (typeof value.result === 'object') visit(value.result, depth + 1)
    if (typeof value.output === 'object') visit(value.output, depth + 1)
    visit(value.toolResults || value.tool_results, depth + 1)
  }
  visit(message)
  return mergeChatImages(images)
}

export function avatarInitials(label) {
  return String(label || '?').trim().split(/[\s_-]+/u).filter(Boolean).slice(0, 2)
    .map(part => [...part][0]).join('').toUpperCase() || '?'
}

export function agentAvatar(agent, id) {
  const identity = agent?.identity
  const configured = identity?.avatar || agent?.avatar
  return {
    src: imageSource(identity?.avatarUrl) || imageSource(agent?.avatarUrl) ||
      (typeof configured === 'string' && !configured.startsWith('/') ? imageSource(configured) : ''),
    initials: avatarInitials(identity?.name || agent?.identityName || agent?.name || id),
  }
}
