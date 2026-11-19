import { attachmentImageSource } from '../lib/chat-media.js'

export function appendChatImage(container, image, t) {
  const src = attachmentImageSource(image)
  if (!src) {
    const error = document.createElement('span')
    error.className = 'chat-image-error'
    error.textContent = t(image.omitted ? 'chat.imageHistoryHint' : 'chat.imageUnavailable')
    container.append(error)
    return
  }
  const img = document.createElement('img')
  img.className = 'msg-img'
  img.tabIndex = 0
  img.setAttribute('role', 'button')
  img.alt = image.fileName || image.alt || t('chat.imageGallery')
  img.loading = 'lazy'
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.src = src
  container.append(img)
}

export function bindChatGallery(root, t) {
  let dialog
  const selector = 'img.msg-img'
  root.addEventListener('error', event => {
    if (!event.target.matches?.(selector)) return
    const error = document.createElement('span')
    error.className = 'chat-image-error'
    error.textContent = t('chat.imageUnavailable')
    event.target.replaceWith(error)
  }, true)

  function open(trigger) {
    const images = [...root.querySelectorAll(selector)].filter(img => img.getAttribute('src'))
    let index = images.indexOf(trigger)
    if (index < 0 || dialog?.open) return

    const gallery = document.createElement('dialog')
    dialog = gallery
    gallery.className = 'chat-lightbox'
    gallery.setAttribute('closedby', 'any')
    gallery.setAttribute('aria-label', t('chat.imageGallery'))
    const toolbar = document.createElement('div')
    toolbar.className = 'chat-lightbox-toolbar'
    const status = document.createElement('span')
    status.setAttribute('aria-live', 'polite')
    const viewport = document.createElement('div')
    viewport.className = 'chat-lightbox-viewport'
    const button = (label, text, action) => {
      const control = document.createElement('button')
      control.type = 'button'
      control.className = 'btn btn-sm btn-secondary'
      control.title = t(label)
      control.setAttribute('aria-label', t(label))
      control.textContent = text
      control.onclick = action
      return control
    }

    const previous = button('chat.imagePrevious', '←', () => move(-1))
    const next = button('chat.imageNext', '→', () => move(1))
    const zoom = button('chat.imageZoom', '+', () => {
      const enabled = viewport.classList.toggle('zoomed')
      zoom.setAttribute('aria-pressed', String(enabled))
      zoom.textContent = enabled ? '−' : '+'
    })
    const close = button('common.close', '×', () => gallery.close())
    close.autofocus = true
    const multiple = images.length > 1
    previous.hidden = next.hidden = !multiple
    toolbar.append(previous, status, next, zoom, close)
    gallery.append(toolbar, viewport)

    function showImage() {
      const source = images[index]
      const img = document.createElement('img')
      img.className = 'chat-lightbox-img'
      img.alt = source.alt || t('chat.imageGallery')
      img.referrerPolicy = 'no-referrer'
      zoom.disabled = false
      viewport.classList.remove('zoomed')
      viewport.scrollTop = viewport.scrollLeft = 0
      zoom.setAttribute('aria-pressed', 'false')
      zoom.textContent = '+'
      status.textContent = `${index + 1} / ${images.length}`
      img.onerror = () => {
        if (img.parentNode !== viewport) return
        viewport.textContent = t('chat.imageUnavailable')
        zoom.disabled = true
      }
      viewport.replaceChildren(img)
      img.src = source.currentSrc || source.src
    }

    function move(offset) {
      if (!multiple) return
      index = (index + offset + images.length) % images.length
      showImage()
    }

    gallery.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (viewport.classList.contains('zoomed')) return
        event.preventDefault()
        move(event.key === 'ArrowLeft' ? -1 : 1)
      }
    })
    if (!('closedBy' in gallery)) {
      gallery.addEventListener('click', event => {
        if (event.target !== gallery) return
        const rect = gallery.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) gallery.close()
      })
    }
    gallery.addEventListener('close', () => {
      gallery.remove()
      if (dialog === gallery) {
        dialog = null
        if (trigger.isConnected) trigger.focus()
      }
    }, { once: true })
    document.body.append(gallery)
    showImage()
    gallery.showModal()
  }

  root.addEventListener('click', event => {
    if (event.target.matches?.(selector)) open(event.target)
  })
  root.addEventListener('keydown', event => {
    if (event.target.matches?.(selector) && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      open(event.target)
    }
  })
  return () => { if (dialog?.open) dialog.close() }
}
