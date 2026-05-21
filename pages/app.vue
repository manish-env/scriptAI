<script setup lang="ts">
useHead({ title: 'BrandMe AI — Create Your Video' })

// ── Types ──────────────────────────────────────────────────────────────────
interface Scene {
  id?: string
  title: string
  narration: string
  imagePrompt: string
  duration: number
  mood: string
  imageUrl: string | null
  generating: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  suggestCreate?: boolean
}

// ── Storage ────────────────────────────────────────────────────────────────
const LS = {
  get: <T>(k: string, fb: T) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb } catch { return fb } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /**/ } },
  del: (k: string) => localStorage.removeItem(k),
}

// ── State ──────────────────────────────────────────────────────────────────
type Screen = 'onboard' | 'chat' | 'preview'
const screen = ref<Screen>('onboard')
const showVideoPanel = ref(false)
const aiTyping = ref(false)
const generatingAll = ref(false)
const videoUrl = ref<string | null>(null)
const inputText = ref('')
const messagesWrap = ref<HTMLElement | null>(null)
const previewContent = ref<HTMLElement | null>(null)
const photoInputEl = ref<HTMLInputElement | null>(null)
const chatInputEl = ref<HTMLTextAreaElement | null>(null)

const profile = reactive({ name: '', niche: '', photoUrl: null as string | null, photoBase64: null as string | null })
const messages = ref<Message[]>([])
const videoProject = reactive({ title: '', topic: '', scenes: [] as Scene[] })
const userId = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const toast = reactive({ show: false, message: '', type: 'success' })

// ── Computed ───────────────────────────────────────────────────────────────
const canStart = computed(() => profile.name.trim() && profile.niche.trim())
const allImagesReady = computed(() => videoProject.scenes.length > 0 && videoProject.scenes.every(s => s.imageUrl))

// ── Persistence ────────────────────────────────────────────────────────────
function saveAll() {
  LS.set('bm_profile', { name: profile.name, niche: profile.niche, photoUrl: profile.photoUrl, photoBase64: profile.photoBase64 })
  LS.set('bm_messages', messages.value)
  LS.set('bm_project', { title: videoProject.title, topic: videoProject.topic, scenes: videoProject.scenes.map(s => ({ ...s, generating: false })) })
}

function loadAll() {
  const p = LS.get<typeof profile>('bm_profile', { name: '', niche: '', photoUrl: null, photoBase64: null })
  Object.assign(profile, p)
  const msgs = LS.get<Message[]>('bm_messages', [])
  if (msgs.length) { messages.value = msgs; screen.value = 'chat' }
  const proj = LS.get<{ title: string; topic: string; scenes: Scene[] }>('bm_project', { title: '', topic: '', scenes: [] })
  videoProject.title = proj.title; videoProject.topic = proj.topic
  videoProject.scenes = proj.scenes.map(s => ({ ...s, generating: false }))
  if (p.name && p.niche && !msgs.length) screen.value = 'chat'
  userId.value = LS.get<string>('bm_user_id', '')
  sessionId.value = LS.get<string>('bm_session_id', '')
}

// ── Cloud sync ─────────────────────────────────────────────────────────────
async function dbPost(path: string, body: unknown) {
  try { await $fetch(path, { method: 'POST', body }) } catch (e) { console.warn('sync failed', e) }
}
async function dbPatch(path: string, body: unknown) {
  try { await $fetch(path, { method: 'PATCH', body }) } catch (e) { console.warn('sync failed', e) }
}

async function ensureUser() {
  if (!userId.value) { userId.value = crypto.randomUUID(); LS.set('bm_user_id', userId.value) }
  await dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche })
}

async function ensureSession() {
  if (!sessionId.value) {
    const res = await $fetch<{ id: string }>('/api/sessions', { method: 'POST', body: { user_id: userId.value } }).catch(() => null)
    if (res?.id) { sessionId.value = res.id; LS.set('bm_session_id', sessionId.value) }
  }
}

function syncMessages(msgs: { role: string; content: string }[]) {
  if (!sessionId.value) return
  dbPost(`/api/sessions/${sessionId.value}/messages`, { messages: msgs })
}
function syncScenes(scenes: Scene[]) {
  if (!sessionId.value) return
  dbPost(`/api/sessions/${sessionId.value}/scenes`, { scenes })
  dbPatch(`/api/sessions/${sessionId.value}`, { title: videoProject.title, topic: videoProject.topic })
}
async function uploadSceneImage(replicateUrl: string, sceneId?: string) {
  if (!userId.value || !sessionId.value) return replicateUrl
  try {
    const res = await $fetch<{ assetUrl: string; key: string }>('/api/upload', {
      method: 'POST', body: { url: replicateUrl, type: 'scene_image', user_id: userId.value, session_id: sessionId.value },
    })
    if (res.assetUrl) {
      if (sceneId) dbPatch(`/api/sessions/${sessionId.value}/scenes`, { scene_id: sceneId, image_key: res.key })
      return res.assetUrl
    }
  } catch { /* fall through */ }
  return replicateUrl
}

// ── Onboarding ─────────────────────────────────────────────────────────────
function triggerPhotoUpload() { photoInputEl.value?.click() }

function onPhotoSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    profile.photoUrl = ev.target?.result as string
    profile.photoBase64 = (ev.target?.result as string).split(',')[1]
  }
  reader.readAsDataURL(file)
}

async function startChat() {
  screen.value = 'chat'
  messages.value = []
  const greeting = `Hi ${profile.name}! 👋 I'm your AI brand strategist. I'll help you create a stunning personal brand video in the **${profile.niche}** space — without showing your face on camera.\n\nLet's start: **What's the main message or story you want your audience to take away from this video?**\n\nFeel free to share your ideas, your audience, what transformation you offer — the more you tell me, the better your video will be!`
  messages.value.push({ role: 'assistant', content: greeting, suggestCreate: false })
  await ensureUser()
  await ensureSession()
}

// ── Chat ───────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || aiTyping.value) return
  inputText.value = ''
  resetTextarea()
  messages.value.push({ role: 'user', content: text })
  scrollToBottom()

  if (/\b(create|make|generate|build)\s+(the\s+)?(video|film|content)\b/i.test(text)) {
    await triggerVideoCreation()
    return
  }

  aiTyping.value = true
  scrollToBottom()
  try {
    const reply = await callClaude(buildChatMessages())
    aiTyping.value = false
    const suggestCreate = /ready to create|shall i create|want me to create|should i build/i.test(reply)
    messages.value.push({ role: 'assistant', content: reply, suggestCreate })
    scrollToBottom()
    syncMessages([{ role: 'user', content: text }, { role: 'assistant', content: reply }])
  } catch (e: unknown) {
    aiTyping.value = false
    showToastMsg((e as Error).message || 'API error', 'error')
  }
}

function buildChatMessages() {
  return messages.value.map(m => ({ role: m.role, content: m.content }))
}

async function callClaude(msgs: { role: string; content: string }[], systemOverride?: string) {
  const system = systemOverride || `You are an expert personal brand video strategist and content creator.
The user is ${profile.name}, working in the ${profile.niche} niche.
They want to create personal brand videos WITHOUT showing their face — using illustrated caricature-style images.
Your job is to:
1. Chat naturally, ask questions to understand their message, audience, and story
2. Help them craft a compelling video concept
3. When they ask to create a video (or when you have enough info), suggest creating it
4. When creating a video script, structure scenes clearly
Be concise, warm, and actionable. Use markdown for formatting when helpful.`

  const data = await $fetch<{ content: { text: string }[] }>('/api/chat', {
    method: 'POST',
    body: { model: 'claude-opus-4-7', max_tokens: 1500, system, messages: msgs },
  })
  return data.content[0].text
}

// ── Video Creation ─────────────────────────────────────────────────────────
async function triggerVideoCreation() {
  aiTyping.value = true
  showVideoPanel.value = true
  scrollToBottom()
  try {
    const scriptJson = await generateVideoScript()
    videoProject.title = scriptJson.title
    videoProject.topic = scriptJson.topic
    videoProject.scenes = scriptJson.scenes.map((s: Scene) => ({ ...s, imageUrl: null, generating: false }))
    aiTyping.value = false
    const summary = `🎬 **Video script created!** "${scriptJson.title}"\n\nI've written **${scriptJson.scenes.length} scenes** for your video:\n${scriptJson.scenes.map((s: Scene, i: number) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}\n\nTap the **🎬 button** above to see your scenes and generate illustrated images for each one. Ready?`
    messages.value.push({ role: 'assistant', content: summary, suggestCreate: false })
    scrollToBottom()
    syncScenes(scriptJson.scenes)
    syncMessages([{ role: 'assistant', content: summary }])
  } catch (e: unknown) {
    aiTyping.value = false
    showToastMsg((e as Error).message || 'Script generation failed', 'error')
  }
}

async function generateVideoScript() {
  const system = `You are a professional video script writer specializing in personal brand videos.
The creator is ${profile.name} in the ${profile.niche} niche.
Based on the conversation, create a compelling short video script (60-90 seconds total, 4-6 scenes).

IMPORTANT: Respond ONLY with valid JSON, no markdown, no explanation. Format:
{"title":"Video title","topic":"One sentence topic","scenes":[{"title":"Scene title","narration":"Voiceover text (2-3 sentences)","imagePrompt":"Detailed caricature illustration prompt of ${profile.name || 'the creator'} — warm cartoon style. Describe pose, expression, background, action.","duration":15,"mood":"inspiring"}]}`

  const msgs = [...buildChatMessages(), { role: 'user', content: 'Based on our conversation, create the video script JSON now. Respond ONLY with the JSON object.' }]
  const raw = await callClaude(msgs, system)
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse video script')
  return JSON.parse(match[0])
}

// ── Image Generation ───────────────────────────────────────────────────────
async function generateAllImages() {
  generatingAll.value = true
  for (const [i, scene] of videoProject.scenes.entries()) {
    if (!scene.imageUrl) await generateSceneImage(i)
  }
  generatingAll.value = false
  showToastMsg('All images generated!')
}

async function generateSceneImage(index: number) {
  const scene = videoProject.scenes[index]
  if (scene.imageUrl || scene.generating) return
  scene.generating = true
  try {
    const replicateUrl = await callReplicate(scene.imagePrompt)
    scene.imageUrl = await uploadSceneImage(replicateUrl, scene.id)
    scene.generating = false
  } catch (e: unknown) {
    scene.generating = false
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  }
}

async function callReplicate(prompt: string) {
  const fullPrompt = `${prompt}, caricature illustration style, digital art, vibrant colors, warm and professional, personal brand, high quality, 16:9 aspect ratio`
  const input: Record<string, unknown> = {
    prompt: fullPrompt,
    negative_prompt: 'realistic photo, photography, blurry, low quality, nsfw',
    width: 1280, height: 720, num_outputs: 1,
    scheduler: 'K_EULER', num_inference_steps: 30, guidance_scale: 7.5,
  }
  if (profile.photoBase64) { input.image = `data:image/jpeg;base64,${profile.photoBase64}`; input.strength = 0.65 }

  const res = await $fetch<{ id: string }>('/api/image', {
    method: 'POST',
    body: { version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b', input },
  })
  return pollReplicate(res.id)
}

async function pollReplicate(id: string, max = 60) {
  for (let i = 0; i < max; i++) {
    await sleep(2000)
    const data = await $fetch<{ status: string; output: string | string[]; error?: string }>(`/api/image/${id}`)
    if (data.status === 'succeeded') return Array.isArray(data.output) ? data.output[0] : data.output
    if (data.status === 'failed') throw new Error(data.error || 'Image generation failed')
  }
  throw new Error('Image generation timed out')
}

// ── Video Assembly ─────────────────────────────────────────────────────────
async function assembleVideo() {
  if (!allImagesReady.value) return
  showToastMsg('Assembling video…')
  try {
    const url = await buildVideoFromImages(videoProject.scenes)
    videoUrl.value = url
    showToastMsg('Video ready!')
    nextTick(() => { if (previewContent.value) previewContent.value.scrollTop = 0 })
  } catch (e: unknown) {
    showToastMsg('Assembly failed: ' + (e as Error).message, 'error')
  }
}

async function buildVideoFromImages(scenes: Scene[]) {
  const W = 1280, H = 720, FPS = 30
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(FPS)
  const chunks: BlobPart[] = []
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || ''
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
  recorder.ondataavailable = e => { if ((e as BlobEvent).data.size > 0) chunks.push((e as BlobEvent).data) }
  recorder.start()

  for (const scene of scenes) {
    const img = await loadImage(scene.imageUrl!)
    const frames = Math.floor((scene.duration || 5) * FPS)
    for (let f = 0; f < frames; f++) {
      const p = f / frames
      const scale = 1 + 0.05 * p
      ctx.save()
      ctx.translate(-(W * (scale - 1)) / 2 * 0.3 * p, -(H * (scale - 1)) / 2)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, W, H)
      ctx.restore()
      drawTextOverlay(ctx, scene.narration, W, H)
      if (f < FPS * 2) {
        const alpha = Math.min(1, f / (FPS * 0.5)) * (1 - Math.max(0, (f - FPS * 1.5) / (FPS * 0.5)))
        drawSceneTitle(ctx, scene.title, W, H, alpha)
      }
      await sleep(1000 / FPS)
    }
    for (let f = 0; f < FPS * 0.5; f++) {
      ctx.fillStyle = `rgba(0,0,0,${f / (FPS * 0.5)})`
      ctx.fillRect(0, 0, W, H)
      await sleep(1000 / FPS)
    }
  }
  recorder.stop()
  return new Promise<string>(resolve => {
    recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: mimeType || 'video/webm' })))
  })
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, text: string, W: number, H: number) {
  const g = ctx.createLinearGradient(0, H * 0.6, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.font = `bold ${W * 0.027}px Inter, system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.textAlign = 'center'
  const maxW = W * 0.8, words = text.split(' '), lines: string[] = []
  let line = ''
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t }
  if (line) lines.push(line)
  const lineH = W * 0.033, startY = H - 60 - lines.length * lineH
  lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lineH))
}

function drawSceneTitle(ctx: CanvasRenderingContext2D, title: string, W: number, H: number, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(124,92,252,0.85)'; ctx.fillRect(0, H * 0.08 - 24, W * 0.6, 48)
  ctx.font = `bold ${W * 0.025}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
  ctx.fillText(title, W * 0.025, H * 0.08 + 8); ctx.restore()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = reject; img.src = src
  })
}

// ── Session Management ─────────────────────────────────────────────────────
function clearSession() {
  if (!confirm('Start a new video? This will clear the current chat and script.')) return
  LS.del('bm_messages'); LS.del('bm_project'); LS.del('bm_session_id')
  sessionId.value = null; messages.value = []
  videoProject.title = ''; videoProject.topic = ''; videoProject.scenes = []
  videoUrl.value = null; showVideoPanel.value = false
  startChat()
}

// ── Markdown renderer ──────────────────────────────────────────────────────
function renderMd(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^-\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
}

// ── Helpers ────────────────────────────────────────────────────────────────
function scrollToBottom() {
  nextTick(() => { if (messagesWrap.value) messagesWrap.value.scrollTop = messagesWrap.value.scrollHeight })
}
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}
function resetTextarea() { if (chatInputEl.value) chatInputEl.value.style.height = 'auto' }
function showToastMsg(message: string, type = 'success') {
  toast.message = message; toast.type = type; toast.show = true
  setTimeout(() => { toast.show = false }, 3500)
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Init ───────────────────────────────────────────────────────────────────
onMounted(() => {
  loadAll()
  const pending = localStorage.getItem('bm_pending_name')
  if (pending) { profile.name = pending; localStorage.removeItem('bm_pending_name') }
  watch([() => ({ ...profile }), messages, () => ({ ...videoProject, scenes: videoProject.scenes.map(s => ({ ...s })) })], saveAll, { deep: true })
})
</script>

<template>
  <div class="app-shell">

    <!-- ── ONBOARD ── -->
    <div v-if="screen === 'onboard'" class="screen onboard-screen">
      <div class="onboard-hero">
        <NuxtLink to="/" class="back-link"><Icon name="lucide:arrow-left" size="14" /> Back</NuxtLink>
        <BrandLogo :size="52" :wordmark="false" class="logo-mark" />
        <h1>BrandMe <span class="gradient-text">AI</span></h1>
      </div>
      <div class="onboard-form card">
        <h2>Let's start with you</h2>
        <div class="field">
          <label>Your Name</label>
          <input v-model="profile.name" type="text" placeholder="e.g. Sarah Johnson" />
        </div>
        <div class="field">
          <label>Your Photo <span class="hint">(we'll create a caricature)</span></label>
          <div class="photo-upload" :class="{ 'has-photo': profile.photoUrl }" @click="triggerPhotoUpload">
            <img v-if="profile.photoUrl" :src="profile.photoUrl" class="photo-preview" />
            <div v-else class="photo-placeholder">
              <Icon name="lucide:camera" size="30" class="upload-icon" />
              <span>Tap to upload photo</span>
            </div>
          </div>
          <input ref="photoInputEl" type="file" accept="image/*" style="display:none" @change="onPhotoSelected" />
        </div>
        <div class="field">
          <label>Your Niche / Industry</label>
          <input v-model="profile.niche" type="text" placeholder="e.g. Digital Marketing, Fitness, Finance" />
        </div>
        <button class="btn btn-primary btn-full" :disabled="!canStart" @click="startChat">
          <Icon name="lucide:sparkles" size="16" /> Start Creating
        </button>
      </div>
    </div>

    <!-- ── CHAT ── -->
    <div v-if="screen === 'chat'" class="screen chat-screen">
      <header class="chat-header">
        <button class="icon-btn" @click="screen = 'onboard'"><Icon name="lucide:arrow-left" size="18" /></button>
        <div class="chat-header-info">
          <div class="avatar-sm">{{ profile.name[0] }}</div>
          <div>
            <div class="chat-title">Brand Video Chat</div>
            <div class="chat-sub">AI Video Strategist</div>
          </div>
        </div>
        <button class="icon-btn" title="New video" @click="clearSession"><Icon name="lucide:plus" size="18" /></button>
        <button class="icon-btn" :class="{ active: showVideoPanel }" @click="showVideoPanel = !showVideoPanel">
          <Icon name="lucide:video" size="18" />
        </button>
      </header>

      <!-- Video panel -->
      <Transition name="slide-down">
        <div v-if="showVideoPanel" class="video-panel">
          <div class="video-panel-inner">
            <div v-if="!videoProject.scenes.length" class="empty-panel">
              <Icon name="lucide:film" size="32" />
              <p>Chat about your topic, then say <strong>"create video"</strong> to generate your script.</p>
            </div>
            <div v-else>
              <div class="panel-header">
                <span>{{ videoProject.title || 'Untitled Video' }}</span>
                <button class="btn btn-sm btn-outline" @click="screen = 'preview'">Preview →</button>
              </div>
              <div class="scenes-mini">
                <div v-for="(s, i) in videoProject.scenes" :key="i" class="scene-mini-card" @click="screen = 'preview'">
                  <div class="scene-num">{{ i + 1 }}</div>
                  <div class="scene-mini-info">
                    <div class="scene-mini-title">{{ s.title }}</div>
                    <div class="scene-mini-status">
                      <span class="status-dot" :class="s.imageUrl ? 'done' : s.generating ? 'loading' : 'pending'" />
                      {{ s.imageUrl ? 'Ready' : s.generating ? 'Generating…' : 'Pending' }}
                    </div>
                  </div>
                </div>
              </div>
              <button v-if="allImagesReady" class="btn btn-primary btn-full mt-sm" @click="screen = 'preview'">
                <Icon name="lucide:play" size="15" /> Assemble Video
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Messages -->
      <div ref="messagesWrap" class="messages-wrap">
        <div class="messages">
          <div v-for="(msg, i) in messages" :key="i" class="msg-row" :class="msg.role">
            <div class="msg-bubble" :class="msg.role">
              <div class="msg-text" v-html="renderMd(msg.content)" />
              <div v-if="msg.role === 'assistant' && msg.suggestCreate" class="msg-action">
                <button class="btn btn-sm btn-primary" @click="triggerVideoCreation">
                  <Icon name="lucide:video" size="14" /> Create My Video
                </button>
              </div>
            </div>
          </div>
          <div v-if="aiTyping" class="msg-row assistant">
            <div class="msg-bubble assistant typing-indicator">
              <span /><span /><span />
            </div>
          </div>
        </div>
      </div>

      <div class="input-bar">
        <textarea
          ref="chatInputEl"
          v-model="inputText"
          placeholder="Ask about your video, share ideas…"
          rows="1"
          @keydown.enter.exact.prevent="sendMessage"
          @input="autoResize"
        />
        <button class="send-btn" :disabled="!inputText.trim() || aiTyping" @click="sendMessage">
          <Icon v-if="aiTyping" name="lucide:loader" size="18" class="spin" />
          <Icon v-else name="lucide:send" size="18" />
        </button>
      </div>
    </div>

    <!-- ── PREVIEW ── -->
    <div v-if="screen === 'preview'" class="screen preview-screen">
      <header class="chat-header">
        <button class="icon-btn" @click="screen = 'chat'"><Icon name="lucide:arrow-left" size="18" /></button>
        <div class="chat-header-info">
          <div>
            <div class="chat-title">{{ videoProject.title || 'Your Video' }}</div>
            <div class="chat-sub">{{ videoProject.scenes.length }} scenes</div>
          </div>
        </div>
        <button v-if="allImagesReady && !videoUrl" class="btn btn-sm btn-primary" @click="assembleVideo">Render</button>
      </header>

      <!-- Download bar -->
      <div v-if="videoUrl" class="download-bar">
        <video :src="videoUrl" controls class="video-preview-mini" />
        <a :href="videoUrl" download="brand-video.webm" class="btn btn-primary btn-full mt-sm">
          <Icon name="lucide:download" size="16" /> Download Video
        </a>
      </div>

      <div ref="previewContent" class="preview-content">
        <div class="scenes-list">
          <div v-for="(scene, i) in videoProject.scenes" :key="i" class="scene-card">
            <div class="scene-card-header">
              <div class="scene-badge">Scene {{ i + 1 }}</div>
              <div class="scene-card-title">{{ scene.title }}</div>
            </div>
            <div class="scene-image-wrap">
              <img v-if="scene.imageUrl" :src="scene.imageUrl" class="scene-img" />
              <div v-else-if="scene.generating" class="scene-img-placeholder generating">
                <div class="spinner" /><span>Generating image…</span>
              </div>
              <div v-else class="scene-img-placeholder" @click="generateSceneImage(i)">
                <Icon name="lucide:image" size="28" /><span>Tap to generate</span>
              </div>
            </div>
            <div class="scene-script">
              <p class="scene-narration">{{ scene.narration }}</p>
              <div class="scene-meta">
                <span class="scene-tag">{{ scene.duration }}s</span>
                <span class="scene-tag">{{ scene.mood }}</span>
              </div>
              <div class="scene-prompt-label">Image prompt</div>
              <p class="scene-prompt-text">{{ scene.imagePrompt }}</p>
            </div>
          </div>
        </div>
        <div v-if="!allImagesReady && videoProject.scenes.length" class="generate-all-wrap">
          <button class="btn btn-primary btn-full" :disabled="generatingAll" @click="generateAllImages">
            {{ generatingAll ? 'Generating Images…' : '🎨 Generate All Scene Images' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="toast" :class="toast.type">{{ toast.message }}</div>
    </Transition>

  </div>
</template>

<style scoped>
.app-shell {
  height: 100dvh;
  max-width: 480px;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }

/* Onboard */
.onboard-screen { overflow-y: auto; padding-bottom: 32px; }
.onboard-hero { background: linear-gradient(160deg,#1a1030 0%,var(--bg) 60%); padding: 48px 24px 36px; text-align: center; position: relative; }
.onboard-hero::after { content:''; position:absolute; bottom:-1px; left:0; right:0; height:32px; background:var(--bg); border-radius:50% 50% 0 0/32px 32px 0 0; }
.back-link { position:absolute; top:16px; left:16px; color:var(--text2); text-decoration:none; font-size:14px; }
.logo-mark { margin-bottom:10px; }
.onboard-hero h1 { font-size:30px; font-weight:800; }
.onboard-form { margin:24px 16px 0; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:24px; }
.onboard-form h2 { font-size:18px; font-weight:700; margin-bottom:20px; }
.field { margin-bottom:18px; }
.field label { display:block; font-size:12px; font-weight:600; color:var(--text2); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; }
.hint { text-transform:none; font-weight:400; letter-spacing:0; }
.field input { width:100%; background:var(--bg3); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); font-size:15px; padding:12px 14px; outline:none; transition:border-color 0.2s; font-family:var(--font); }
.field input:focus { border-color:var(--accent); }
.photo-upload { width:100%; height:130px; background:var(--bg3); border:2px dashed var(--border); border-radius:var(--radius-sm); display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; transition:border-color 0.2s; }
.photo-upload.has-photo, .photo-upload:hover { border-color:var(--accent); }
.photo-placeholder { display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--text2); font-size:14px; }
.upload-icon { font-size:30px; }
.photo-preview { width:100%; height:100%; object-fit:cover; }

/* Chat header */
.chat-header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--bg2); border-bottom:1px solid var(--border); flex-shrink:0; z-index:10; }
.chat-header-info { flex:1; display:flex; align-items:center; gap:10px; }
.avatar-sm { width:36px; height:36px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; flex-shrink:0; }
.chat-title { font-weight:700; font-size:15px; }
.chat-sub { font-size:12px; color:var(--text2); }
.icon-btn { background:var(--bg3); border:1px solid var(--border); color:var(--text); width:36px; height:36px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; transition:all 0.2s; }
.icon-btn:hover, .icon-btn.active { border-color:var(--accent); background:rgba(124,92,252,0.1); }

/* Video panel */
.video-panel { background:var(--bg2); border-bottom:1px solid var(--border); max-height:260px; overflow-y:auto; flex-shrink:0; }
.video-panel-inner { padding:16px; }
.empty-panel { display:flex; flex-direction:column; align-items:center; gap:10px; padding:12px; color:var(--text2); font-size:14px; text-align:center; }
.empty-panel span { font-size:30px; }
.panel-header { display:flex; align-items:center; justify-content:space-between; font-weight:600; font-size:14px; margin-bottom:12px; }
.scenes-mini { display:flex; flex-direction:column; gap:8px; }
.scene-mini-card { display:flex; align-items:center; gap:12px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:10px 12px; cursor:pointer; transition:border-color 0.2s; }
.scene-mini-card:hover { border-color:var(--accent); }
.scene-num { width:28px; height:28px; background:var(--accent); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
.scene-mini-title { font-size:13px; font-weight:600; }
.scene-mini-status { font-size:11px; color:var(--text2); display:flex; align-items:center; gap:5px; margin-top:2px; }
.status-dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
.status-dot.done { background:var(--success); }
.status-dot.loading { background:var(--warn); animation:pulse 1s infinite; }
.status-dot.pending { background:var(--border); }
.mt-sm { margin-top:12px; }

/* Messages */
.messages-wrap { flex:1; overflow-y:auto; padding:16px 16px 8px; scroll-behavior:smooth; }
.messages { display:flex; flex-direction:column; gap:12px; }
.msg-row { display:flex; }
.msg-row.user { justify-content:flex-end; }
.msg-row.assistant { justify-content:flex-start; }
.msg-bubble { max-width:82%; border-radius:18px; padding:12px 16px; font-size:14.5px; line-height:1.55; }
.msg-bubble.user { background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; border-bottom-right-radius:4px; }
.msg-bubble.assistant { background:var(--bg3); border:1px solid var(--border); color:var(--text); border-bottom-left-radius:4px; }
.msg-text :deep(p) { margin-bottom:6px; }
.msg-text :deep(p:last-child) { margin-bottom:0; }
.msg-text :deep(strong) { color:var(--accent2); }
.msg-text :deep(ul), .msg-text :deep(ol) { padding-left:18px; margin:6px 0; }
.msg-action { margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
.typing-indicator { display:flex; align-items:center; gap:5px; padding:14px 18px; }
.typing-indicator span { width:8px; height:8px; background:var(--text2); border-radius:50%; animation:bounce 1.2s infinite; }
.typing-indicator span:nth-child(2) { animation-delay:0.2s; }
.typing-indicator span:nth-child(3) { animation-delay:0.4s; }

/* Input */
.input-bar { display:flex; align-items:flex-end; gap:10px; padding:12px 16px; background:var(--bg2); border-top:1px solid var(--border); flex-shrink:0; }
.input-bar textarea { flex:1; background:var(--bg3); border:1px solid var(--border); border-radius:14px; color:var(--text); font-family:var(--font); font-size:15px; padding:11px 14px; outline:none; resize:none; max-height:120px; line-height:1.4; transition:border-color 0.2s; }
.input-bar textarea:focus { border-color:var(--accent); }
.send-btn { width:44px; height:44px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border:none; border-radius:50%; color:#fff; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s; }
.send-btn:hover:not(:disabled) { transform:scale(1.08); }
.send-btn:disabled { opacity:0.45; cursor:not-allowed; }

/* Preview */
.preview-screen { background:var(--bg); }
.download-bar { flex-shrink:0; padding:12px 16px; background:var(--bg2); border-bottom:1px solid var(--border); }
.video-preview-mini { width:100%; border-radius:var(--radius-sm); display:block; max-height:200px; background:#000; }
.preview-content { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px; }
.scenes-list { display:flex; flex-direction:column; gap:16px; }
.scene-card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
.scene-card-header { display:flex; align-items:center; gap:10px; padding:14px 16px 10px; }
.scene-badge { background:rgba(124,92,252,0.15); color:var(--accent); border-radius:6px; padding:3px 8px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
.scene-card-title { font-weight:600; font-size:14px; }
.scene-image-wrap { width:100%; aspect-ratio:16/9; background:var(--bg3); overflow:hidden; }
.scene-img { width:100%; height:100%; object-fit:cover; }
.scene-img-placeholder { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:var(--text2); font-size:13px; cursor:pointer; }
.scene-img-placeholder.generating { cursor:default; }
.scene-img-placeholder span:first-child { font-size:30px; }
.scene-script { padding:14px 16px; }
.scene-narration { font-size:14px; line-height:1.6; margin-bottom:10px; }
.scene-meta { display:flex; gap:6px; margin-bottom:10px; }
.scene-tag { background:var(--bg3); border:1px solid var(--border); border-radius:6px; padding:3px 8px; font-size:11px; color:var(--text2); }
.scene-prompt-label { font-size:11px; color:var(--text2); text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:4px; }
.scene-prompt-text { font-size:12px; color:var(--text2); line-height:1.5; font-style:italic; }
.generate-all-wrap { margin-top:8px; }
.spinner { width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }

/* Toast */
.toast { position:fixed; bottom:90px; left:50%; transform:translateX(-50%); background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:12px 20px; font-size:14px; z-index:200; white-space:nowrap; box-shadow:0 4px 24px rgba(0,0,0,0.4); }
.toast.success { border-color:var(--success); color:var(--success); }
.toast.error { border-color:var(--error); color:var(--error); }

/* Transitions */
.slide-down-enter-active, .slide-down-leave-active { transition:all 0.3s ease; overflow:hidden; }
.slide-down-enter-from, .slide-down-leave-to { max-height:0; opacity:0; }
.slide-down-enter-to, .slide-down-leave-from { max-height:260px; opacity:1; }
.toast-enter-active, .toast-leave-active { transition:all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity:0; transform:translateX(-50%) translateY(10px); }

@keyframes bounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-6px); } }
@keyframes spin { to { transform:rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
.spin { animation:spin 1s linear infinite; }
</style>
