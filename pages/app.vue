<script setup lang="ts">
useHead({ title: 'BrandMe AI — Personal Brand Video' })

const showProjectMenu = ref(false)

// ── Types ──────────────────────────────────────────────────────────────────
interface Scene {
  id?: string
  title: string
  narration: string
  imagePrompt: string
  duration: number
  mood: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  suggestCreate?: boolean
}

interface DbScene {
  id: string; session_id: string; position: number
  title: string; narration: string; image_prompt: string
  duration: number; mood: string; image_key: string | null
}

interface DbSession {
  id: string; title: string | null; topic: string | null
  messages: { id: string; role: string; content: string }[]
  scenes: DbScene[]
}

interface VideoScriptJson {
  title?: string
  topic?: string
  characterDescription?: string
  scenes?: Scene[]
}

// ── LLM JSON helpers ────────────────────────────────────────────────────────
function parseJsonFromLlm(raw: string): VideoScriptJson {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in response')
  let depth = 0; let inString = false; let escape = false; let end = -1
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') inString = false; continue }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new SyntaxError('Incomplete JSON — response may have been cut off. Try again.')
  return JSON.parse(text.slice(start, end + 1)) as VideoScriptJson
}

function looksLikeVideoScriptJson(text: string) {
  const t = text.trim()
  return (t.startsWith('{') || t.includes('```json') || t.includes('"scenes"')) && /"scenes"\s*:/.test(t)
}

function formatScriptPreview(script: VideoScriptJson) {
  const scenes = script.scenes ?? []
  const lines = scenes.map((s, i) => `${i + 1}. **${s.title}** — ${(s.narration || '').slice(0, 80)}…`)
  return [
    `**Script ready** — "${script.title || 'Your video'}"`,
    '',
    lines.join('\n') || '_No scenes yet._',
    '',
    'Say **"create video"** or tap **Create Script** to load it.',
  ].join('\n')
}

function sanitizeChatReply(text: string) {
  if (!looksLikeVideoScriptJson(text)) return text
  try { return formatScriptPreview(parseJsonFromLlm(text)) } catch {
    return text
      .replace(/```(?:json)?\s*[\s\S]*?```/gi, '\n\n_Script details hidden — tap **Create Script** to open it._\n\n')
      .replace(/\{[\s\S]*"scenes"[\s\S]*\}/g, (m) =>
        m.length > 280 ? '\n\n_Script details hidden — tap **Create Script** to open it._\n\n' : m)
  }
}

function displayChatContent(msg: Message) {
  if (msg.role !== 'assistant') return msg.content
  return sanitizeChatReply(msg.content)
}

function stripScriptJsonFromContext(text: string) {
  if (!looksLikeVideoScriptJson(text)) return text
  try { return formatScriptPreview(parseJsonFromLlm(text)) } catch { return '[Earlier script draft omitted]' }
}

function buildChatMessagesForScript() {
  return messages.value.map(m => ({
    role: m.role,
    content: m.role === 'assistant' ? stripScriptJsonFromContext(m.content) : m.content,
  }))
}

function findScriptInChat(): VideoScriptJson | null {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.role !== 'assistant' || !looksLikeVideoScriptJson(m.content)) continue
    try { const s = parseJsonFromLlm(m.content); if (s.scenes?.length) return s } catch { /* try older */ }
  }
  return null
}

// ── State ───────────────────────────────────────────────────────────────────
const screen = ref<'chat'>('chat')
const aiTyping = ref(false)
const inputText = ref('')
const messagesWrap = ref<HTMLElement | null>(null)
const chatInputEl = ref<HTMLTextAreaElement | null>(null)
const appLoading = ref(true)
const toast = reactive({ show: false, message: '', type: 'success' })

const profile = reactive({
  name: '',
  niche: '',
  elevenVoiceId: null as string | null,
})

const showVoiceWidget = ref(false)
const isRecording = ref(false)
const cloningVoice = ref(false)
const recordingSeconds = ref(0)
let mediaRecorderRef: MediaRecorder | null = null
let audioChunks: BlobPart[] = []
let recordingTimer: ReturnType<typeof setInterval> | null = null

const messages = ref<Message[]>([])
const videoProject = reactive({ title: '', topic: '', characterDescription: '', scenes: [] as Scene[] })
const userId = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const projectSetup = reactive({ videoType: '', projectTitle: '', projectPurpose: '' })

// ── Video type config ────────────────────────────────────────────────────────
const VIDEO_TYPE_CONFIG: Record<string, { label: string; persona: string; firstQuestion: string }> = {
  'story-telling':    { label: 'Story Telling',     persona: 'storytelling video creator', firstQuestion: '**What story do you want to tell?** Who is the main character and what transformation do they go through?' },
  'short-movie':      { label: 'Short Movie',        persona: 'short film director',         firstQuestion: '**What is the premise of your short movie?** Describe the conflict and what you want viewers to feel.' },
  'promotional':      { label: 'Promotional Video',  persona: 'brand video strategist',      firstQuestion: '**What are you promoting?** Tell me about the product, service, or event and your target audience.' },
  'personal-branding':{ label: 'Personal Branding',  persona: 'personal brand consultant',   firstQuestion: '**What do you want to be known for?** Describe your expertise and the audience you want to attract.' },
  'educational':      { label: 'Educational Video',  persona: 'educational content creator', firstQuestion: '**What concept or skill will you teach?** Who is your audience and what should they be able to do after watching?' },
}

const MIN_SCENE_DURATION = 3
const MAX_SCENE_DURATION = 15

// ── Computed ─────────────────────────────────────────────────────────────────
const totalDuration = computed(() => videoProject.scenes.reduce((s, sc) => s + (sc.duration || 5), 0))
const hasScript = computed(() => videoProject.scenes.length > 0)

// ── API helpers ──────────────────────────────────────────────────────────────
async function dbPost(path: string, body: unknown) {
  return $fetch(path, { method: 'POST', body })
}
async function dbPatch(path: string, body: unknown) {
  return $fetch(path, { method: 'PATCH', body })
}
async function ensureUser() {
  if (!userId.value) return
  await dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche })
}
async function ensureSession() {
  if (sessionId.value) return
  const data = await dbPost('/api/sessions', {
    user_id: userId.value,
    title: projectSetup.projectTitle || null,
    topic: projectSetup.projectPurpose || null,
  }) as { id: string }
  sessionId.value = data.id
}
function syncMessages(msgs: { role: string; content: string }[]) {
  if (!sessionId.value) return
  $fetch(`/api/sessions/${sessionId.value}/messages`, { method: 'POST', body: { messages: msgs } }).catch(() => {})
}
async function syncScenes(scenes: Scene[]) {
  if (!sessionId.value) return
  return $fetch(`/api/sessions/${sessionId.value}/scenes`, { method: 'POST', body: { scenes } })
}

// ── Load session ─────────────────────────────────────────────────────────────
async function loadSession(id: string) {
  try {
    const data = await $fetch<DbSession>(`/api/sessions/${id}`)
    if (!data) return false
    videoProject.title = data.title ?? ''
    videoProject.topic = data.topic ?? ''
    if (data.title) projectSetup.projectTitle = data.title
    if (data.topic) projectSetup.projectPurpose = data.topic
    messages.value = data.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content, suggestCreate: false }))
    videoProject.scenes = data.scenes.map(s => {
      let ip = s.image_prompt
      try { const p = JSON.parse(ip); if (p?.imagePrompt) ip = p.imagePrompt } catch { /* plain */ }
      return { id: s.id, title: s.title, narration: s.narration, imagePrompt: ip, duration: clampDuration(s.duration), mood: s.mood }
    })
    return true
  } catch {
    localStorage.removeItem('bm_active_session')
    return false
  }
}

function clampDuration(n: number) {
  return Math.round(Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, n || 5)))
}

// ── Chat ─────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || aiTyping.value) return
  inputText.value = ''
  resetTextarea()
  messages.value.push({ role: 'user', content: text, suggestCreate: false })
  syncMessages([{ role: 'user', content: text }])
  scrollToBottom()
  aiTyping.value = true
  try {
    const reply = await callClaude(buildChatMessages())
    const suggestCreate = /\bcreate\b.*\bvideo\b|\bscript\b.*\bready\b|\bgenerate\b.*\bscript\b/i.test(reply)
    messages.value.push({ role: 'assistant', content: reply, suggestCreate })
    syncMessages([{ role: 'assistant', content: reply }])
    scrollToBottom()
  } catch (e: unknown) {
    showToastMsg((e as Error).message || 'AI error', 'error')
  } finally {
    aiTyping.value = false
  }
}

function buildChatMessages() {
  return messages.value.map(m => ({ role: m.role, content: m.content }))
}

async function callClaude(msgs: { role: string; content: string }[], systemOverride?: string, opts?: { max_tokens?: number }) {
  const cfg = projectSetup.videoType ? VIDEO_TYPE_CONFIG[projectSetup.videoType] : null
  const activeTitle = videoProject.title || projectSetup.projectTitle
  const activeTopic = videoProject.topic || projectSetup.projectPurpose
  const sceneContext = videoProject.scenes.length
    ? `\nCURRENT SCRIPT (${videoProject.scenes.length} scenes):\n${videoProject.scenes.map((s, i) => `  ${i + 1}. "${s.title}": ${s.narration.slice(0, 100)}…`).join('\n')}\nWhen discussing, refer specifically to these scenes.`
    : ''
  const system = systemOverride || [
    cfg ? `You are an expert ${cfg.persona} specializing in personal brand video content.`
        : `You are an expert personal brand video strategist.`,
    [activeTitle && `Project: "${activeTitle}"`, activeTopic && `Goal: ${activeTopic}`, cfg && `Type: ${cfg.label}`].filter(Boolean).join(' | '),
    `\nIMPORTANT: Work ONLY on this project. Do not reference other projects.
${sceneContext}
YOUR ROLE:
1. Ask ONE focused question at a time to understand their story, audience, and message
2. Be an expert — guide them toward a compelling narrative
3. When ready (3-5 exchanges), suggest "Create Script"
4. Never output raw JSON or code blocks. Be concise.`,
  ].join('\n')

  const data = await $fetch<{ content: { text: string }[] }>('/api/chat', {
    method: 'POST',
    body: { model: 'claude-sonnet-4-6', max_tokens: opts?.max_tokens ?? 1500, system, messages: msgs },
  })
  return data.content[0].text
}

// ── Script generation ────────────────────────────────────────────────────────
async function triggerVideoCreation() {
  aiTyping.value = true
  scrollToBottom()
  try {
    const scriptJson = await generateVideoScript()
    await applyVideoScript(scriptJson)
  } catch (e: unknown) {
    aiTyping.value = false
    showToastMsg((e as Error).message || 'Script generation failed', 'error')
  }
}

async function applyVideoScript(scriptJson: VideoScriptJson) {
  if (!scriptJson.scenes?.length) throw new Error('Script has no scenes')
  videoProject.title = scriptJson.title ?? 'Untitled Video'
  videoProject.topic = scriptJson.topic ?? ''
  videoProject.characterDescription = scriptJson.characterDescription ?? ''
  videoProject.scenes = scriptJson.scenes.map(s => ({
    title: s.title,
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    duration: clampDuration(s.duration),
    mood: s.mood,
  }))
  aiTyping.value = false
  const summary = `**Script created!** "${scriptJson.title}"\n\n${scriptJson.scenes.map((s, i) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}`
  messages.value.push({ role: 'assistant', content: summary, suggestCreate: false })
  scrollToBottom()
  await syncScenes(videoProject.scenes.map(s => ({
    title: s.title, narration: s.narration, imagePrompt: s.imagePrompt, duration: s.duration, mood: s.mood, image_key: null, frame_keys: null,
  })))
  syncMessages([{ role: 'assistant', content: summary }])
}

async function generateVideoScript() {
  const fromChat = findScriptInChat()
  if (fromChat) {
    fromChat.scenes = fromChat.scenes?.map(s => ({ ...s, duration: clampDuration(s.duration) }))
    return fromChat
  }
  const cfg = projectSetup.videoType ? VIDEO_TYPE_CONFIG[projectSetup.videoType] : null
  const activeTitle = videoProject.title || projectSetup.projectTitle
  const activePurpose = videoProject.topic || projectSetup.projectPurpose
  const system = `You are a professional video script writer for illustrated personal brand videos.
${activeTitle ? `Project: "${activeTitle}"` : ''}${cfg ? `\nType: ${cfg.label}` : ''}${activePurpose ? `\nGoal: ${activePurpose}` : ''}
Write the script ONLY for this project.

Choose: 4–8 scenes. Duration: ${MIN_SCENE_DURATION}–${MAX_SCENE_DURATION}s per scene based on narration length.

RESPOND ONLY with valid JSON (no markdown). Schema:
{
  "title": "Video title",
  "topic": "One sentence topic",
  "characterDescription": "Character appearance for illustrations",
  "scenes": [{
    "title": "Scene title",
    "narration": "Voiceover sentence",
    "imagePrompt": "Unique location/setting for this scene",
    "duration": 5,
    "mood": "inspiring"
  }]
}
Rules: duration integer ${MIN_SCENE_DURATION}–${MAX_SCENE_DURATION}, every scene different location, no raw JSON in narration.`

  const msgs = buildChatMessagesForScript()
  const raw = await callClaude(msgs, system, { max_tokens: 3000 })
  return parseJsonFromLlm(raw)
}

// ── Voice cloning ─────────────────────────────────────────────────────────────
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorderRef = new MediaRecorder(stream)
    audioChunks = []
    mediaRecorderRef.ondataavailable = e => audioChunks.push(e.data)
    mediaRecorderRef.start(250)
    isRecording.value = true
    recordingSeconds.value = 0
    recordingTimer = setInterval(() => { recordingSeconds.value++ }, 1000)
  } catch { showToastMsg('Could not access microphone', 'error') }
}
async function stopVoiceRecording() {
  if (!mediaRecorderRef) return
  clearInterval(recordingTimer!)
  mediaRecorderRef.stream.getTracks().forEach(t => t.stop())
  mediaRecorderRef.stop()
  mediaRecorderRef.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' })
    isRecording.value = false
    await submitVoiceSample(blob)
  }
}
async function submitVoiceSample(blob: Blob) {
  cloningVoice.value = true
  try {
    const reader = new FileReader()
    const b64 = await new Promise<string>((res, rej) => { reader.onload = () => res((reader.result as string).split(',')[1]); reader.onerror = rej; reader.readAsDataURL(blob) })
    const data = await $fetch<{ voice_id: string }>('/api/voice/clone', { method: 'POST', body: { audio_base64: b64, user_id: userId.value, name: profile.name || 'My Voice' } })
    profile.elevenVoiceId = data.voice_id
    if (userId.value) await dbPatch('/api/user', { id: userId.value, eleven_voice_id: data.voice_id })
    showToastMsg('Voice cloned successfully!')
  } catch { showToastMsg('Voice cloning failed', 'error') }
  cloningVoice.value = false
}
async function deleteClonedVoice() {
  if (!profile.elevenVoiceId || !userId.value) return
  try {
    await $fetch('/api/voice/clone', { method: 'DELETE', body: { voice_id: profile.elevenVoiceId, user_id: userId.value } })
    profile.elevenVoiceId = null
  } catch { showToastMsg('Could not remove voice', 'error') }
}

// ── Session management ────────────────────────────────────────────────────────
function apiErrorMessage(e: unknown) {
  const err = e as { data?: { message?: string }; statusMessage?: string; message?: string }
  return err.data?.message || err.statusMessage || err.message || 'Request failed'
}
async function deleteProject() {
  if (!sessionId.value || !confirm('Delete this project permanently?')) return
  try {
    await $fetch(`/api/sessions/${sessionId.value}/delete`, { method: 'POST' }).catch(() =>
      $fetch(`/api/sessions/${sessionId.value}`, { method: 'DELETE' }))
    localStorage.removeItem('bm_active_session')
    showProjectMenu.value = false
    navigateTo('/projects')
  } catch (e: unknown) { showToastMsg(apiErrorMessage(e), 'error') }
}
function clearSession() {
  sessionId.value = null
  messages.value = []
  videoProject.title = ''; videoProject.topic = ''; videoProject.scenes = []
  localStorage.removeItem('bm_active_session')
  navigateTo('/projects')
}

// ── Script export ─────────────────────────────────────────────────────────────
function copyScript() {
  const text = videoProject.scenes.map((s, i) =>
    `Scene ${i + 1}: ${s.title}\n${s.narration}\n`
  ).join('\n')
  navigator.clipboard.writeText(`${videoProject.title}\n\n${text}`)
  showToastMsg('Script copied to clipboard!')
}

// ── New project start ─────────────────────────────────────────────────────────
async function startNewProjectChat() {
  const stored = localStorage.getItem('bm_new_project')
  if (!stored) return false
  localStorage.removeItem('bm_new_project')
  try {
    const setup = JSON.parse(stored)
    projectSetup.videoType = setup.videoType ?? ''
    projectSetup.projectTitle = setup.title ?? ''
    projectSetup.projectPurpose = setup.purpose ?? ''
  } catch { return false }

  await ensureUser()
  await ensureSession()

  const cfg = VIDEO_TYPE_CONFIG[projectSetup.videoType]
  const greeting = [
    `I'm your AI **${cfg?.label ?? 'video'} creator** — let's make **"${projectSetup.projectTitle}"** exceptional.`,
    projectSetup.projectPurpose ? `\nGoal: *${projectSetup.projectPurpose}*\n` : '',
    `\n${cfg?.firstQuestion ?? "**What's the core message** you want viewers to take away?"}`,
  ].join('')
  messages.value.push({ role: 'assistant', content: greeting, suggestCreate: false })
  syncMessages([{ role: 'assistant', content: greeting }])
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function scrollToBottom() {
  nextTick(() => { if (messagesWrap.value) messagesWrap.value.scrollTop = messagesWrap.value.scrollHeight })
}
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
function resetTextarea() { if (chatInputEl.value) chatInputEl.value.style.height = 'auto' }
function showToastMsg(message: string, type = 'success') {
  toast.message = message; toast.type = type; toast.show = true
  setTimeout(() => { toast.show = false }, 3000)
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function renderMd(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^-\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
}
function moodColor(mood: string) {
  const map: Record<string, string> = {
    inspiring: '#7c5cfc', energetic: '#f59e0b', calm: '#10b981',
    professional: '#3b82f6', emotional: '#ec4899', bold: '#ef4444',
    exciting: '#f97316', confident: '#8b5cf6',
  }
  return map[mood?.toLowerCase()] ?? '#6b7280'
}

// ── Init ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', () => { showProjectMenu.value = false })

  const uid = localStorage.getItem('bm_user_id')
  const activeSession = localStorage.getItem('bm_active_session')
  const newProject = localStorage.getItem('bm_new_project')

  if (uid) {
    userId.value = uid
  } else {
    userId.value = crypto.randomUUID()
    localStorage.setItem('bm_user_id', userId.value)
  }

  try {
    const user = await $fetch<{ id: string; name: string; niche: string; eleven_voice_id?: string | null } | null>(
      `/api/user?id=${userId.value}`)
    if (user) {
      profile.name = user.name
      profile.niche = user.niche ?? ''
      profile.elevenVoiceId = user.eleven_voice_id ?? null
    }
  } catch { /* no user yet */ }

  if (newProject) {
    await startNewProjectChat()
    appLoading.value = false
    return
  }

  if (activeSession) {
    const ok = await loadSession(activeSession)
    if (ok) {
      sessionId.value = activeSession
      appLoading.value = false
      return
    }
  }

  messages.value = [{ role: 'assistant', content: 'Welcome back! Ready to create a new video? Tell me about your next idea.', suggestCreate: false }]
  await ensureSession()
  appLoading.value = false
})
</script>

<template>
  <div class="app-shell">

    <!-- Init loading -->
    <div v-if="appLoading" class="init-loading">
      <div class="init-spinner" />
    </div>

    <div v-else class="workspace">

      <!-- ── LEFT: Chat ── -->
      <div class="chat-panel">
        <header class="chat-header">
          <NuxtLink to="/projects" class="icon-btn" title="All projects">
            <Icon name="fa6-solid:arrow-left" size="16" />
          </NuxtLink>
          <div class="chat-header-center">
            <div class="project-title">{{ videoProject.title || projectSetup.projectTitle || 'Brand Video' }}</div>
            <div class="project-type" v-if="projectSetup.videoType">
              {{ VIDEO_TYPE_CONFIG[projectSetup.videoType]?.label }}
            </div>
          </div>
          <div class="header-actions">
            <button
              class="icon-btn voice-btn"
              :class="{ active: profile.elevenVoiceId }"
              :title="profile.elevenVoiceId ? 'Voice cloned' : 'Clone your voice'"
              @click="showVoiceWidget = !showVoiceWidget"
            >
              <Icon name="fa6-solid:microphone" size="15" />
            </button>
            <div class="project-menu-wrap">
              <button class="icon-btn" @click.stop="showProjectMenu = !showProjectMenu">
                <Icon name="fa6-solid:ellipsis-vertical" size="16" />
              </button>
              <Transition name="fade">
                <div v-if="showProjectMenu" class="project-menu">
                  <NuxtLink to="/profile" class="menu-item">
                    <Icon name="fa6-solid:user" size="13" /> Profile
                  </NuxtLink>
                  <button class="menu-item danger" @click="deleteProject">
                    <Icon name="fa6-solid:trash" size="13" /> Delete project
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </header>

        <!-- Voice widget -->
        <Transition name="slide-down">
          <div v-if="showVoiceWidget" class="voice-widget">
            <div v-if="profile.elevenVoiceId" class="voice-ready">
              <div class="voice-ready-icon"><Icon name="fa6-solid:microphone" size="18" /></div>
              <div>
                <div class="voice-label">Voice cloned</div>
                <div class="voice-sub">Narrations will use your voice</div>
              </div>
              <button class="btn-danger-sm" @click="deleteClonedVoice">Remove</button>
            </div>
            <div v-else class="voice-record">
              <p class="voice-hint">Record 30–60 seconds of your voice to clone it for narrations.</p>
              <div class="voice-controls">
                <button v-if="!isRecording" class="btn-record" :disabled="cloningVoice" @click="startVoiceRecording">
                  <Icon name="fa6-solid:circle" size="12" class="rec-dot" />
                  {{ cloningVoice ? 'Cloning…' : 'Start Recording' }}
                </button>
                <button v-else class="btn-record recording" @click="stopVoiceRecording">
                  <Icon name="fa6-solid:stop" size="12" />
                  Stop ({{ recordingSeconds }}s)
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
                <div class="msg-text" v-html="renderMd(displayChatContent(msg))" />
                <div v-if="msg.role === 'assistant' && msg.suggestCreate" class="msg-action">
                  <button class="btn-create" @click="triggerVideoCreation">
                    <Icon name="fa6-solid:wand-magic-sparkles" size="13" />
                    Create Script
                  </button>
                </div>
              </div>
            </div>
            <div v-if="aiTyping" class="msg-row assistant">
              <div class="msg-bubble assistant typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        </div>

        <div class="input-bar">
          <textarea
            ref="chatInputEl"
            v-model="inputText"
            placeholder="Share your ideas, ask questions…"
            rows="1"
            @keydown.enter.exact.prevent="sendMessage"
            @input="autoResize"
          />
          <button class="send-btn" :disabled="!inputText.trim() || aiTyping" @click="sendMessage">
            <Icon v-if="aiTyping" name="fa6-solid:spinner" size="16" class="spin" />
            <Icon v-else name="fa6-solid:paper-plane" size="16" />
          </button>
        </div>
      </div>

      <!-- ── RIGHT: Script panel ── -->
      <div class="script-panel">
        <header class="script-header">
          <div class="script-header-left">
            <Icon name="fa6-solid:scroll" size="14" class="script-icon" />
            <span>Script</span>
            <span v-if="hasScript" class="scene-count">{{ videoProject.scenes.length }} scenes · {{ totalDuration }}s</span>
          </div>
          <button v-if="hasScript" class="btn-copy" @click="copyScript">
            <Icon name="fa6-solid:copy" size="12" /> Copy
          </button>
        </header>

        <!-- Empty state -->
        <div v-if="!hasScript" class="script-empty">
          <div class="script-empty-icon">
            <Icon name="fa6-solid:scroll" size="28" />
          </div>
          <p>Your script will appear here once the AI generates it.</p>
          <p class="script-empty-hint">Chat with the AI and say <strong>"create video"</strong> when ready.</p>
        </div>

        <!-- Script cards -->
        <div v-else class="script-scroll">
          <div class="script-title-card">
            <div class="script-title">{{ videoProject.title }}</div>
            <div v-if="videoProject.topic" class="script-topic">{{ videoProject.topic }}</div>
          </div>

          <div v-for="(scene, i) in videoProject.scenes" :key="i" class="scene-card">
            <div class="scene-card-header">
              <div class="scene-num">{{ i + 1 }}</div>
              <div class="scene-title">{{ scene.title }}</div>
              <div class="scene-meta">
                <span class="duration-badge">{{ scene.duration }}s</span>
                <span v-if="scene.mood" class="mood-badge" :style="{ background: moodColor(scene.mood) + '22', color: moodColor(scene.mood), borderColor: moodColor(scene.mood) + '44' }">
                  {{ scene.mood }}
                </span>
              </div>
            </div>
            <p class="scene-narration">{{ scene.narration }}</p>
            <p v-if="scene.imagePrompt" class="scene-setting">
              <Icon name="fa6-solid:location-dot" size="10" />
              {{ scene.imagePrompt }}
            </p>
          </div>
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
/* ── Shell ── */
.app-shell {
  height: 100dvh;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.init-loading { flex:1; display:flex; align-items:center; justify-content:center; }
.init-spinner { width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.75s linear infinite; }

/* ── Workspace ── */
.workspace { flex:1; display:flex; overflow:hidden; }

/* ── Chat panel ── */
.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 0 0 50%;
  width: 50%;
  min-width: 320px;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

/* ── Chat header ── */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.chat-header-center { flex: 1; min-width: 0; }
.project-title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-type { font-size: 11px; color: var(--accent); font-weight: 600; margin-top: 1px; }
.header-actions { display: flex; align-items: center; gap: 6px; }
.icon-btn {
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text);
  width: 34px; height: 34px;
  border-radius: 9px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
  text-decoration: none;
}
.icon-btn:hover { border-color: var(--accent); background: rgba(124,92,252,0.08); color: var(--accent); }
.voice-btn.active { border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.08); }

/* ── Project menu ── */
.project-menu-wrap { position: relative; }
.project-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  min-width: 180px; background: var(--bg2); border: 1px solid var(--border);
  border-radius: 10px; padding: 4px; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 9px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text); background: none; border: none;
  cursor: pointer; text-decoration: none; transition: background 0.15s;
}
.menu-item:hover { background: var(--bg3); }
.menu-item.danger { color: var(--error); }
.menu-item.danger:hover { background: rgba(239,68,68,0.1); }

/* ── Voice widget ── */
.voice-widget {
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  padding: 16px;
  flex-shrink: 0;
}
.voice-ready { display: flex; align-items: center; gap: 12px; }
.voice-ready-icon { width:36px; height:36px; background:rgba(16,185,129,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; color:#10b981; flex-shrink:0; }
.voice-label { font-size: 13px; font-weight: 600; color: #10b981; }
.voice-sub { font-size: 11px; color: var(--text2); margin-top: 2px; }
.btn-danger-sm { margin-left: auto; background: none; border: 1px solid var(--error); color: var(--error); padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.voice-record { display: flex; flex-direction: column; gap: 12px; }
.voice-hint { font-size: 13px; color: var(--text2); margin: 0; line-height: 1.5; }
.voice-controls { display: flex; gap: 8px; }
.btn-record { display:flex; align-items:center; gap:8px; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid var(--border); background:var(--bg3); color:var(--text); transition:all 0.2s; }
.btn-record:hover { border-color:var(--accent); }
.btn-record.recording { border-color:#ef4444; color:#ef4444; background:rgba(239,68,68,0.08); }
.rec-dot { color: #ef4444; }

/* ── Messages ── */
.messages-wrap { flex: 1; overflow-y: auto; padding: 16px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.messages { display: flex; flex-direction: column; gap: 12px; min-height: 100%; justify-content: flex-end; }
.msg-row { display: flex; }
.msg-row.user { justify-content: flex-end; }
.msg-row.assistant { justify-content: flex-start; }
.msg-bubble {
  max-width: 82%;
  padding: 11px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
}
.msg-bubble.user {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg-bubble.assistant {
  background: var(--bg2);
  border: 1px solid var(--border);
  color: var(--text);
  border-bottom-left-radius: 4px;
}
.msg-text :deep(strong) { font-weight: 700; }
.msg-text :deep(li) { margin-left: 16px; list-style: disc; }
.msg-text :deep(p) { margin: 6px 0; }
.msg-text :deep(p:first-child) { margin-top: 0; }
.msg-text :deep(p:last-child) { margin-bottom: 0; }

/* Typing indicator */
.typing { display: flex; align-items: center; gap: 5px; padding: 14px 18px; }
.typing span { width: 7px; height: 7px; background: var(--text2); border-radius: 50%; animation: bounce 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

/* Create script button */
.msg-action { margin-top: 10px; }
.btn-create {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--accent); color: #fff;
  border: none; border-radius: 8px;
  padding: 9px 16px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s;
}
.btn-create:hover { opacity: 0.88; }

/* ── Input bar ── */
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
}
.input-bar textarea {
  flex: 1;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 14px;
  padding: 10px 14px;
  outline: none;
  resize: none;
  font-family: var(--font);
  line-height: 1.5;
  max-height: 160px;
  transition: border-color 0.2s;
}
.input-bar textarea:focus { border-color: var(--accent); }
.send-btn {
  width: 38px; height: 38px;
  background: var(--accent); color: #fff;
  border: none; border-radius: 10px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: opacity 0.2s;
}
.send-btn:hover { opacity: 0.85; }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Script panel ── */
.script-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: var(--bg);
}
.script-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
}
.script-header-left { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text); }
.script-icon { color: var(--accent); }
.scene-count { font-size: 11px; font-weight: 400; color: var(--text2); }
.btn-copy {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--text2); padding: 5px 12px; border-radius: 7px;
  font-size: 12px; cursor: pointer; transition: all 0.2s;
}
.btn-copy:hover { border-color: var(--accent); color: var(--accent); }

/* Script empty */
.script-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 32px; text-align: center; color: var(--text2); gap: 12px;
}
.script-empty-icon {
  width: 64px; height: 64px; background: var(--bg3); border: 1px solid var(--border);
  border-radius: 18px; display: flex; align-items: center; justify-content: center;
  color: var(--text2); margin-bottom: 4px;
}
.script-empty p { font-size: 14px; line-height: 1.6; max-width: 260px; margin: 0; }
.script-empty strong { color: var(--accent); }
.script-empty-hint { font-size: 13px; color: var(--text3, var(--text2)); }

/* Script scroll */
.script-scroll { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

/* Script title card */
.script-title-card {
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(124,92,252,0.12), rgba(124,92,252,0.04));
  border: 1px solid rgba(124,92,252,0.25);
  border-radius: 12px;
  margin-bottom: 4px;
}
.script-title { font-size: 17px; font-weight: 800; color: var(--text); }
.script-topic { font-size: 13px; color: var(--text2); margin-top: 4px; line-height: 1.5; }

/* Scene card */
.scene-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  transition: border-color 0.2s;
}
.scene-card:hover { border-color: rgba(124,92,252,0.35); }
.scene-card-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.scene-num {
  width: 26px; height: 26px; flex-shrink: 0;
  background: rgba(124,92,252,0.15); color: var(--accent);
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
}
.scene-title { flex: 1; font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.3; }
.scene-meta { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
.duration-badge {
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--text2); font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 20px;
}
.mood-badge {
  font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 20px; border: 1px solid;
  text-transform: capitalize;
}
.scene-narration {
  font-size: 13px; line-height: 1.6; color: var(--text);
  margin: 0 0 8px; padding-left: 36px;
}
.scene-setting {
  display: flex; align-items: flex-start; gap: 5px;
  font-size: 11px; color: var(--text2); margin: 0;
  padding-left: 36px; line-height: 1.4;
}

/* ── Animations ── */
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }

.slide-down-enter-active, .slide-down-leave-active { transition: all 0.2s ease; }
.slide-down-enter-from, .slide-down-leave-to { opacity: 0; transform: translateY(-8px); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(10px) translateX(-50%); }

/* ── Toast ── */
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: var(--bg2); border: 1px solid var(--border);
  color: var(--text); padding: 10px 20px; border-radius: 10px;
  font-size: 13px; font-weight: 600; z-index: 9999;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  white-space: nowrap;
}
.toast.error { border-color: var(--error); color: var(--error); }
.toast.success { border-color: var(--accent); color: var(--accent); }

/* ── Mobile ── */
@media (max-width: 767px) {
  .chat-panel { flex: 0 0 100%; width: 100%; border-right: none; }
  .script-panel { display: none; }
}
</style>
