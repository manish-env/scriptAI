<script setup lang="ts">
useHead({ title: 'BrandMe AI — Create Your Video' })

const route = useRoute()
const showProjectMenu = ref(false)

// ── Types ──────────────────────────────────────────────────────────────────
interface Scene {
  id?: string
  title: string
  narration: string
  imagePrompt: string
  /** Three flipbook pages per scene — same background, character pose changes (from script JSON). */
  framePrompts?: string[]
  duration: number
  mood: string
  imageUrl: string | null
  frameUrls: string[]
  generating: boolean
  generatingLabel: string | null
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
  frame_keys?: string | null
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

// ── LLM JSON helpers (robust parse, hide raw JSON in chat) ───────────────────
function parseJsonFromLlm(raw: string): VideoScriptJson {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  const start = text.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in response')

  let depth = 0
  let inString = false
  let escape = false
  let end = -1
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) {
    throw new SyntaxError('Incomplete JSON — response may have been cut off. Try again.')
  }
  return JSON.parse(text.slice(start, end + 1)) as VideoScriptJson
}

function looksLikeVideoScriptJson(text: string) {
  const t = text.trim()
  return (t.startsWith('{') || t.includes('```json') || t.includes('"scenes"'))
    && /"scenes"\s*:/.test(t)
}

function formatScriptPreview(script: VideoScriptJson) {
  const scenes = script.scenes ?? []
  const lines = scenes.map((s, i) => `${i + 1}. **${s.title}** — ${(s.narration || '').slice(0, 80)}…`)
  return [
    `**Script outline** — "${script.title || 'Your video'}"`,
    '',
    lines.join('\n') || '_No scenes yet._',
    '',
    'Say **"create video"** or tap **Create My Video** to load this into your storyboard.',
  ].join('\n')
}

function sanitizeChatReply(text: string) {
  if (!looksLikeVideoScriptJson(text)) return text
  try {
    return formatScriptPreview(parseJsonFromLlm(text))
  } catch {
    return text
      .replace(/```(?:json)?\s*[\s\S]*?```/gi, '\n\n_Script details hidden — use **Create My Video** to open the storyboard._\n\n')
      .replace(/\{[\s\S]*"scenes"[\s\S]*\}/g, (m) =>
        m.length > 280 ? '\n\n_Script details hidden — use **Create My Video** to open the storyboard._\n\n' : m,
      )
  }
}

function displayChatContent(msg: Message) {
  if (msg.role !== 'assistant') return msg.content
  return sanitizeChatReply(msg.content)
}

function stripScriptJsonFromContext(text: string) {
  if (!looksLikeVideoScriptJson(text)) return text
  try {
    const script = parseJsonFromLlm(text)
    return formatScriptPreview(script)
  } catch {
    return '[Earlier script draft omitted from context]'
  }
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
    try {
      const script = parseJsonFromLlm(m.content)
      if (script.scenes?.length) return script
    } catch { /* try older message */ }
  }
  return null
}

async function normalizeScriptScenes(script: VideoScriptJson) {
  for (const scene of script.scenes ?? []) {
    scene.duration = clampSceneDuration(scene.duration)
    if (!hasValidFramePrompts(scene)) {
      scene.framePrompts = await generateFramePromptsForScene(scene)
    }
  }
  return script
}

// ── State ──────────────────────────────────────────────────────────────────
type Screen = 'onboard' | 'chat' | 'preview'
const screen = ref<Screen>('onboard')
const showVideoPanel = ref(false)
const aiTyping = ref(false)
const generatingAll = ref(false)
const renderingVideo = ref(false)
const videoUrl = ref<string | null>(null)
const inputText = ref('')
const messagesWrap = ref<HTMLElement | null>(null)
const previewContent = ref<HTMLElement | null>(null)
const photoInputEl = ref<HTMLInputElement | null>(null)
const chatInputEl = ref<HTMLTextAreaElement | null>(null)

const profile = reactive({
  name: '',
  niche: '',
  photoUrl: null as string | null,
  photoBase64: null as string | null,
  heroUrl: null as string | null,
  heroBase64: null as string | null,
  characterDescription: '',
  elevenVoiceId: null as string | null,
})

// ── Voice cloning state ────────────────────────────────────────────────────
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
const projectMode = ref<'image' | 'video'>('image')
const toast = reactive({ show: false, message: '', type: 'success' })

const projectSetup = reactive({ videoType: '', projectTitle: '', projectPurpose: '' })
// Prevents the onboard form from flashing with personal data while init is running.
// Starts true and is cleared once we know which screen to show.
const appLoading = ref(true)

const sceneVideoUrls = ref<Record<number, string>>({})
const sceneVideoLoading = ref(-1)
const sceneVideoModal = ref<{ index: number; url: string } | null>(null)
const savedVideoKey = ref<string | null>(null)
const savedVideoUrl = computed(() => savedVideoKey.value ? `/api/assets/${savedVideoKey.value}` : null)
const showGallery = ref(false)

const VIDEO_TYPE_CONFIG: Record<string, { label: string; persona: string; firstQuestion: string }> = {
  'personal-brand': {
    label: 'Personal Brand Story',
    persona: 'personal branding strategist who has helped thousands of professionals build online authority through compelling video stories',
    firstQuestion: '**Who is your ideal audience** and what\'s the one transformation or result you help them achieve?',
  },
  'educational': {
    label: 'Educational Tutorial',
    persona: 'expert educational content creator specializing in online courses, tutorials, and explainer videos that make complex topics simple',
    firstQuestion: '**What\'s the exact skill or concept** you\'re teaching, and what\'s the most common mistake your learners make before they understand it?',
  },
  'motivational': {
    label: 'Motivational / Inspirational',
    persona: 'top motivational content creator known for viral inspirational videos that drive people to take immediate action',
    firstQuestion: '**What\'s the pivotal struggle or turning point** in your story that will resonate most deeply with your audience?',
  },
  'product-demo': {
    label: 'Product Demo',
    persona: 'product marketing expert specializing in compelling demo and showcase videos that convert viewers into customers',
    firstQuestion: '**What\'s the #1 problem** your product solves, and who is the specific person it\'s designed for?',
  },
  'how-to': {
    label: 'How-To Guide',
    persona: 'expert how-to content creator known for clear, actionable step-by-step videos with high completion rates',
    firstQuestion: '**What\'s the exact outcome** someone achieves after following your guide — be as specific as possible.',
  },
  'case-study': {
    label: 'Case Study / Success Story',
    persona: 'business storyteller specializing in case study and success story videos that build trust and credibility',
    firstQuestion: '**What\'s the before/after transformation?** Where did your client/subject start, and exactly where did they end up?',
  },
  'thought-leadership': {
    label: 'Thought Leadership',
    persona: 'thought leadership content strategist who helps executives and industry experts share insights that establish authority',
    firstQuestion: '**What\'s your contrarian take or the one thing** most people in your industry get completely wrong?',
  },
  'course-teaser': {
    label: 'Course / Program Teaser',
    persona: 'online course marketing expert specializing in compelling course preview videos that drive enrollments',
    firstQuestion: '**Who is your ideal student** and what\'s the single biggest result they\'ll achieve from your course?',
  },
}

// ── Computed ───────────────────────────────────────────────────────────────
const canStart = computed(() => profile.name.trim() && profile.niche.trim())
const FRAMES_PER_SCENE = 3
// In video mode only 2 images per scene (first + last pose); image mode uses all 3
const neededImages = computed(() => projectMode.value === 'video' ? 2 : FRAMES_PER_SCENE)
const allImagesReady = computed(() =>
  videoProject.scenes.length > 0
  && videoProject.scenes.every(s => s.frameUrls.length >= neededImages.value || !!s.imageUrl),
)
const totalDuration = computed(() => videoProject.scenes.reduce((sum, s) => sum + (s.duration || 5), 0))
const selectedSceneIndex = ref(0)
const timelineTrackRef = ref<HTMLElement | null>(null)

const MIN_SCENE_DURATION = 2
const MAX_SCENE_DURATION = 10

function clampSceneDuration(seconds: number) {
  return Math.round(Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, seconds || MAX_SCENE_DURATION)))
}

function timelineWidth(scene: Scene) {
  const total = totalDuration.value || 1
  return `${((scene.duration || 5) / total) * 100}%`
}

let persistScenesTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersistScenes() {
  if (persistScenesTimer) clearTimeout(persistScenesTimer)
  persistScenesTimer = setTimeout(() => {
    // Include current R2 image keys from client memory so the server's
    // DELETE+INSERT never loses them due to a race with a concurrent PATCH.
    syncScenes(videoProject.scenes.map(s => {
      const r2Keys = s.frameUrls
        .filter(u => u.startsWith('/api/assets/'))
        .map(u => u.replace(/^\/api\/assets\//, ''))
      return {
        title: s.title,
        narration: s.narration,
        imagePrompt: s.framePrompts?.length
          ? JSON.stringify({ imagePrompt: s.imagePrompt, framePrompts: s.framePrompts })
          : s.imagePrompt,
        duration: s.duration,
        mood: s.mood,
        image_key: r2Keys[0] ?? null,
        frame_keys: r2Keys.length ? JSON.stringify(r2Keys) : null,
      }
    }))
  }, 600)
}

function setSceneDuration(index: number, seconds: number) {
  const scene = videoProject.scenes[index]
  if (!scene) return
  scene.duration = clampSceneDuration(seconds)
  schedulePersistScenes()
}

type DurationDrag = { index: number; startX: number; startDuration: number; pxPerSec: number }
let durationDrag: DurationDrag | null = null

function onDurationResizeStart(e: MouseEvent, index: number) {
  e.preventDefault()
  e.stopPropagation()
  selectedSceneIndex.value = index
  const track = timelineTrackRef.value
  const total = totalDuration.value || 1
  if (!track) return
  durationDrag = {
    index,
    startX: e.clientX,
    startDuration: videoProject.scenes[index].duration || 5,
    pxPerSec: track.clientWidth / total,
  }
  document.addEventListener('mousemove', onDurationResizeMove)
  document.addEventListener('mouseup', onDurationResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onDurationResizeMove(e: MouseEvent) {
  if (!durationDrag) return
  const { index, startX, startDuration, pxPerSec } = durationDrag
  const scene = videoProject.scenes[index]
  if (!scene) return
  const deltaSec = (e.clientX - startX) / pxPerSec
  scene.duration = clampSceneDuration(startDuration + deltaSec)
}

function onDurationResizeEnd() {
  if (durationDrag) schedulePersistScenes()
  durationDrag = null
  document.removeEventListener('mousemove', onDurationResizeMove)
  document.removeEventListener('mouseup', onDurationResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function closeProjectMenu() {
  showProjectMenu.value = false
}

onUnmounted(() => {
  onDurationResizeEnd()
  if (persistScenesTimer) clearTimeout(persistScenesTimer)
  document.removeEventListener('click', closeProjectMenu)
})

// ── API helpers ────────────────────────────────────────────────────────────
async function dbPost(path: string, body: unknown) {
  try { await $fetch(path, { method: 'POST', body }) } catch (e) { console.warn('sync failed', e) }
}
async function dbPatch(path: string, body: unknown) {
  try { await $fetch(path, { method: 'PATCH', body }) } catch (e) { console.warn('sync failed', e) }
}

async function ensureUser() {
  await dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche })
}

async function ensureSession() {
  if (!sessionId.value) {
    const res = await $fetch<{ id: string }>('/api/sessions', { method: 'POST', body: { user_id: userId.value } }).catch(() => null)
    if (res?.id) {
      sessionId.value = res.id
      localStorage.setItem('bm_active_session', res.id)
    }
  }
}

function syncMessages(msgs: { role: string; content: string }[]) {
  if (!sessionId.value) return
  dbPost(`/api/sessions/${sessionId.value}/messages`, { messages: msgs })
}

async function syncScenes(scenes: Scene[]) {
  if (!sessionId.value) return
  try {
    const rows = await $fetch<{ id: string; position: number }[]>(
      `/api/sessions/${sessionId.value}/scenes`,
      { method: 'POST', body: { scenes } },
    )
    // Update scene IDs so subsequent PATCH calls (persistSceneFrames) hit the right rows
    if (Array.isArray(rows)) {
      rows.forEach(row => {
        const s = videoProject.scenes[row.position]
        if (s) s.id = row.id
      })
    }
  } catch (e) { console.warn('sync scenes failed', e) }
  dbPatch(`/api/sessions/${sessionId.value}`, { title: videoProject.title, topic: videoProject.topic })
}

async function uploadAsset(replicateUrl: string, type: 'hero' | 'scene_image' | 'photo') {
  if (!userId.value) return { assetUrl: replicateUrl, key: null as string | null }
  try {
    const res = await $fetch<{ assetUrl: string; key: string | null }>('/api/upload', {
      method: 'POST',
      body: { url: replicateUrl, type, user_id: userId.value, session_id: sessionId.value },
    })
    if (res.assetUrl) return res
  } catch { /* fall through */ }
  return { assetUrl: replicateUrl, key: null }
}

async function assetUrlToBase64(url: string) {
  const res = await fetch(url.startsWith('http') ? url : `${window.location.origin}${url}`)
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function parseFrameKeys(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const keys = JSON.parse(raw) as string[]
    return Array.isArray(keys) ? keys.map(k => `/api/assets/${k}`) : []
  } catch {
    return []
  }
}

async function persistSceneFrames(sceneIndex: number) {
  if (!sessionId.value) return
  const scene = videoProject.scenes[sceneIndex]
  if (!scene?.frameUrls.length) return
  // Only persist R2 URLs — Replicate URLs expire and are useless on reload
  const keys = scene.frameUrls
    .filter(u => u.startsWith('/api/assets/'))
    .map(u => u.replace(/^\/api\/assets\//, ''))
  if (!keys.length) return
  // Use position (index) not scene.id — position is always stable, no race condition
  await dbPatch(`/api/sessions/${sessionId.value}/scenes`, {
    position: sceneIndex,
    image_key: keys[0],
    frame_keys: JSON.stringify(keys),
  })
}

// ── Load existing session from D1 ──────────────────────────────────────────
async function loadSession(id: string) {
  try {
    const storedMode = localStorage.getItem(`bm_session_mode_${id}`)
    if (storedMode === 'video') projectMode.value = 'video'
    const data = await $fetch<DbSession>(`/api/sessions/${id}`)
    if (!data) return false

    videoProject.title = data.title ?? ''
    videoProject.topic = data.topic ?? ''
    // Keep projectSetup in sync so the AI system prompt always reflects this
    // project, not a stale setup from a previously opened project.
    if (data.title) projectSetup.projectTitle = data.title
    if (data.topic) projectSetup.projectPurpose = data.topic
    messages.value = data.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      suggestCreate: false,
    }))
    videoProject.scenes = data.scenes.map((s) => {
      const frameUrls = parseFrameKeys((s as DbScene & { frame_keys?: string }).frame_keys)
      const fallback = s.image_key ? `/api/assets/${s.image_key}` : null
      let framePrompts: string[] | undefined
      try {
        const parsed = JSON.parse(s.image_prompt)
        if (parsed?.imagePrompt) {
          framePrompts = parsed.framePrompts
          return {
            id: s.id,
            title: s.title,
            narration: s.narration,
            imagePrompt: parsed.imagePrompt,
            framePrompts,
            duration: clampSceneDuration(s.duration),
            mood: s.mood,
            frameUrls: frameUrls.length ? frameUrls : (fallback ? [fallback] : []),
            imageUrl: frameUrls[0] ?? fallback,
            generating: false,
            generatingLabel: null,
          }
        }
      } catch { /* plain image_prompt */ }
      return {
        id: s.id,
        title: s.title,
        narration: s.narration,
        imagePrompt: s.image_prompt,
        duration: clampSceneDuration(s.duration),
        mood: s.mood,
        frameUrls: frameUrls.length ? frameUrls : (fallback ? [fallback] : []),
        imageUrl: frameUrls[0] ?? fallback,
        generating: false,
        generatingLabel: null,
      }
    })
    if (videoProject.scenes.length) showVideoPanel.value = true
    const sessionMeta = data as DbSession & { video_key?: string | null }
    if (sessionMeta.video_key) savedVideoKey.value = sessionMeta.video_key
    return true
  } catch {
    localStorage.removeItem('bm_active_session')
    return false
  }
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
    profile.heroUrl = null
    profile.heroBase64 = null
  }
  reader.readAsDataURL(file)
}

async function startChat() {
  if (!userId.value) {
    userId.value = crypto.randomUUID()
    localStorage.setItem('bm_user_id', userId.value)
  }
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

  if (/\b(create|make|generate|build)\b.*\b(video|film|content)\b/i.test(text)
    || /\b(video|film)\b.*\b(create|make|generate|build)\b/i.test(text)) {
    await triggerVideoCreation()
    return
  }

  aiTyping.value = true
  scrollToBottom()
  try {
    const rawReply = await callClaude(buildChatMessages())
    const reply = sanitizeChatReply(rawReply)
    aiTyping.value = false
    const suggestCreate = /ready to create|shall i create|want me to create|should i build/i.test(reply)
      || looksLikeVideoScriptJson(rawReply)
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

async function callClaude(
  msgs: { role: string; content: string }[],
  systemOverride?: string,
  opts?: { max_tokens?: number },
) {
  const cfg = projectSetup.videoType ? VIDEO_TYPE_CONFIG[projectSetup.videoType] : null

  // Build project-specific context from what's actually in this project right now.
  // This anchors the AI firmly to the current project so it never bleeds content
  // from a different project the user may have worked on previously.
  const activeTitle = videoProject.title || projectSetup.projectTitle
  const activeTopic = videoProject.topic || projectSetup.projectPurpose
  const sceneContext = videoProject.scenes.length
    ? `\nCURRENT STORYBOARD (${videoProject.scenes.length} scenes already created):\n${
        videoProject.scenes.map((s, i) =>
          `  Scene ${i + 1} — "${s.title}": ${s.narration.slice(0, 100)}${s.narration.length > 100 ? '…' : ''}`
        ).join('\n')
      }\nWhen answering questions, always refer specifically to these scenes and their narration.`
    : ''

  const system = systemOverride || [
    cfg
      ? `You are an expert ${cfg.persona} specializing in faceless illustrated brand videos.`
      : `You are an expert personal brand video strategist specializing in faceless illustrated brand videos.`,
    [
      profile.name && `Creator: ${profile.name}`,
      profile.niche && `Niche: ${profile.niche}`,
      activeTitle && `Project: "${activeTitle}"`,
      activeTopic && `Goal: ${activeTopic}`,
      cfg && `Video type: ${cfg.label}`,
    ].filter(Boolean).join(' | '),
    `
IMPORTANT: You are working EXCLUSIVELY on the project described above. Do not reference, blend, or borrow content from any other project. Every response must relate only to this specific project.
${sceneContext}
VIDEO FORMAT: Each scene is a DIFFERENT location (office, stage, outdoors, etc.). Within a scene, ${FRAMES_PER_SCENE} illustrated flipbook pages share the SAME background — only the character's pose changes per page.

YOUR ROLE:
1. Ask ONE focused question at a time to deeply understand their story, audience, and message
2. Be an expert in ${cfg?.label ?? 'video'} content — guide them toward a compelling narrative arc
3. When you have enough detail (3-5 exchanges), say you're ready and suggest "Create My Video"
4. Same illustrated character in every scene; different environment per scene

NEVER output raw JSON, code blocks, or script schemas. Be concise, expert, and ask one question at a time.`,
  ].join('\n')

  const data = await $fetch<{ content: { text: string }[] }>('/api/chat', {
    method: 'POST',
    body: {
      model: 'claude-sonnet-4-6',
      max_tokens: opts?.max_tokens ?? 1500,
      system,
      messages: msgs,
    },
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
  profile.characterDescription = videoProject.characterDescription
  videoProject.scenes = scriptJson.scenes.map((s: Scene) => ({
    ...s,
    duration: clampSceneDuration(s.duration),
    imageUrl: null,
    frameUrls: [],
    generating: false,
    generatingLabel: null,
  }))
  aiTyping.value = false
  const summary = `**Video script created!** "${scriptJson.title}"\n\n**${scriptJson.scenes.length} scenes** (each in its own setting):\n${scriptJson.scenes.map((s: Scene, i: number) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}\n\nOpen the storyboard and **Generate** — each scene gets **${FRAMES_PER_SCENE} flipbook pages** (same location, character moves as you flip). Ready?`
  messages.value.push({ role: 'assistant', content: summary, suggestCreate: false })
  scrollToBottom()
  // Await so that scene IDs are written back before the user can click Generate.
  // persistSceneFrames needs scene.id to save image keys to D1.
  await syncScenes(videoProject.scenes.map(s => ({
    title: s.title,
    narration: s.narration,
    imagePrompt: s.framePrompts?.length
      ? JSON.stringify({ imagePrompt: s.imagePrompt, framePrompts: s.framePrompts })
      : s.imagePrompt,
    duration: s.duration,
    mood: s.mood,
    image_key: null,
    frame_keys: null,
  })))
  syncMessages([{ role: 'assistant', content: summary }])
}

async function generateVideoScript() {
  const fromChat = findScriptInChat()
  if (fromChat) return normalizeScriptScenes(fromChat)

  const cfg = projectSetup.videoType ? VIDEO_TYPE_CONFIG[projectSetup.videoType] : null
  const activeTitle2 = videoProject.title || projectSetup.projectTitle
  const activePurpose2 = videoProject.topic || projectSetup.projectPurpose
  const system = `You are a professional video script writer for illustrated faceless brand videos.
Creator: ${profile.name || 'the creator'}${profile.niche ? ` — ${profile.niche}` : ''}.
${activeTitle2 ? `Project: "${activeTitle2}"` : ''}${cfg ? `\nVideo type: ${cfg.label}` : ''}${activePurpose2 ? `\nGoal: ${activePurpose2}` : ''}
You are writing the script ONLY for this specific project. Do not blend content from other projects.

Based on the conversation and content complexity, decide the best:
- Number of scenes: 4–8 (choose what best tells this story)
- Duration per scene: ${MIN_SCENE_DURATION}–${MAX_SCENE_DURATION} seconds (choose based on how much narration each scene needs)

FLIPBOOK MODEL: Each scene = a different location. Within a scene, exactly ${FRAMES_PER_SCENE} flipbook pages share the SAME background; only the character pose changes. characterDescription is identical in every scene; imagePrompt MUST differ per scene.

RESPOND ONLY with valid JSON (no markdown, no extra text). Schema:
{
  "title": "Video title",
  "topic": "One sentence topic",
  "characterDescription": "Fixed character look: realistic face features, exact hair color and style, skin tone, outfit details — semi-realistic digital illustration style, NOT cartoonish — never changes",
  "scenes": [
    {
      "title": "Scene title",
      "narration": "Voiceover sentence — must fit comfortably within this scene's duration",
      "imagePrompt": "UNIQUE location for this scene — specific room/place, props, lighting. Must differ from every other scene.",
      "framePrompts": ["pose 1", "pose 2", "pose 3"],
      "duration": 5,
      "mood": "inspiring"
    }
  ]
}

Rules:
- duration: integer between ${MIN_SCENE_DURATION} and ${MAX_SCENE_DURATION} — choose naturally based on narration length
- Every scene MUST have a clearly different location in imagePrompt
- framePrompts: exactly ${FRAMES_PER_SCENE} strings — character pose/expression only, no background mention
- One person only. Visual style: semi-realistic digital illustration — cinematic 3D shading, realistic face proportions, detailed environments. NOT cartoon, NOT flat vector art.`

  const msgs = [
    ...buildChatMessagesForScript(),
    { role: 'user', content: 'Based on our conversation, create the video script JSON now. Respond ONLY with the JSON object, no markdown.' },
  ]
  const raw = await callClaude(msgs, system, { max_tokens: 8192 })
  const script = parseJsonFromLlm(raw)
  if (!script.scenes?.length) throw new Error('Script has no scenes')
  return normalizeScriptScenes(script)
}

// ── Frame prompts (AI per scene, no hardcoded poses) ───────────────────────
function hasValidFramePrompts(scene: Scene) {
  return Array.isArray(scene.framePrompts)
    && scene.framePrompts.length === FRAMES_PER_SCENE
    && scene.framePrompts.every(p => typeof p === 'string' && p.trim().length > 0)
}

async function generateFramePromptsForScene(scene: Scene) {
  const system = `You write flipbook page poses for ONE scene. The background is already fixed in imagePrompt — pages only move the character.
Respond ONLY with valid JSON: {"framePrompts":["...","...","..."]}
Exactly ${FRAMES_PER_SCENE} strings: body pose, hands, expression only — never mention background, room, or props.
Progression: page 1 still → page 2 mid-action → page 3 reaction. Match this scene's narration.`

  const raw = await callClaude(
    [{ role: 'user', content: JSON.stringify({
      title: scene.title,
      narration: scene.narration,
      mood: scene.mood,
      imagePrompt: scene.imagePrompt,
    }) }],
    system,
  )
  const parsed = parseJsonFromLlm(raw) as { framePrompts?: unknown }
  if (!Array.isArray(parsed.framePrompts) || parsed.framePrompts.length !== FRAMES_PER_SCENE) {
    throw new Error('AI returned invalid frame prompts')
  }
  return parsed.framePrompts.map(p => String(p).trim())
}

async function ensureSceneFramePrompts(scene: Scene) {
  if (hasValidFramePrompts(scene)) return
  scene.framePrompts = await generateFramePromptsForScene(scene)
  schedulePersistScenes()
}

let framePromptRegenTimer: ReturnType<typeof setTimeout> | null = null
function onSceneVisualPromptInput(index: number) {
  schedulePersistScenes()
  const scene = videoProject.scenes[index]
  if (!scene?.imagePrompt?.trim()) return
  if (framePromptRegenTimer) clearTimeout(framePromptRegenTimer)
  framePromptRegenTimer = setTimeout(async () => {
    try {
      scene.framePrompts = await generateFramePromptsForScene(scene)
      schedulePersistScenes()
    } catch (e: unknown) {
      showToastMsg((e as Error).message || 'Could not update frame poses', 'error')
    }
  }, 900)
}

function characterDescriptionForPrompt() {
  return profile.characterDescription
    || videoProject.characterDescription
    || `${profile.name}, ${profile.niche} professional, semi-realistic digital illustration style`
}

function requirePhotoBase64() {
  if (!profile.photoBase64) {
    throw new Error('Upload a clear face photo in Profile — we use it to keep the same character in every scene')
  }
  return profile.photoBase64
}

// ── Image Generation (Flux Kontext + Consistent Character) ───────────────────

async function ensureHeroCaricature() {
  if (profile.heroBase64) return
  if (!profile.photoBase64 && !profile.photoUrl) return

  showToastMsg('Creating your character look…')
  const replicateUrl = await runKontextEdit(
    buildHeroPrompt(profile.name, profile.niche, characterDescriptionForPrompt()),
    requirePhotoBase64(),
    'image/jpeg',
  )
  const { assetUrl, key } = await uploadAsset(replicateUrl, 'hero')
  profile.heroUrl = assetUrl
  profile.heroBase64 = await assetUrlToBase64(assetUrl)
  if (userId.value) {
    await dbPost('/api/user', {
      id: userId.value,
      name: profile.name,
      niche: profile.niche,
      hero_key: key,
    })
  }
}

async function generateAllImages() {
  generatingAll.value = true
  try {
    await ensureHeroCaricature()
    for (const [i, scene] of videoProject.scenes.entries()) {
      if (scene.frameUrls.length < neededImages.value) await generateSceneFrames(i)
    }
    showToastMsg(projectMode.value === 'video' ? 'All scene images ready!' : 'All scene pages ready!')
  } catch (e: unknown) {
    showToastMsg((e as Error).message || 'Generation failed', 'error')
  } finally {
    generatingAll.value = false
  }
}

async function generateSceneFrames(index: number) {
  const scene = videoProject.scenes[index]
  const needed = neededImages.value
  if (scene.generating || scene.frameUrls.length >= needed) return
  scene.generating = true
  scene.frameUrls = []
  scene.imageUrl = null
  try {
    await ensureHeroCaricature()
    const photoB64 = requirePhotoBase64()
    scene.generatingLabel = 'Planning poses…'
    await ensureSceneFramePrompts(scene) // always generates 3 AI pose prompts
    let scenePageRef: string | null = null
    const charDesc = characterDescriptionForPrompt()
    // image mode: render all 3 poses [0,1,2]; video mode: render only first+last [0,2]
    const poseIndices = projectMode.value === 'video' ? [0, 2] : [0, 1, 2]
    for (let i = 0; i < poseIndices.length; i++) {
      const fi = poseIndices[i]
      const pose = scene.framePrompts?.[fi]?.trim()
      if (!pose) throw new Error('Frame prompts missing for this scene')
      if (projectMode.value === 'video') {
        scene.generatingLabel = i === 0 ? 'Opening shot…' : 'Final pose…'
      } else {
        scene.generatingLabel = i === 0 ? `Page 1/${FRAMES_PER_SCENE} (new scene)` : `Page ${i + 1}/${FRAMES_PER_SCENE} (pose)`
      }
      let replicateUrl: string
      if (i === 0) {
        // Use hero caricature as style reference; fall back to raw photo
        const refB64 = profile.heroBase64 ?? photoB64
        replicateUrl = await runKontextEdit(
          buildSceneEstablishPromptKontext(scene.imagePrompt, charDesc, pose, scene.mood),
          refB64,
          'image/jpeg',
        )
      } else {
        replicateUrl = await runKontextEdit(buildPoseEditPrompt(pose), scenePageRef!)
      }
      const { assetUrl } = await uploadAsset(replicateUrl, 'scene_image')
      scene.frameUrls.push(assetUrl)
      scene.imageUrl = scene.frameUrls[0]
      if (i === 0) scenePageRef = await assetUrlToBase64(assetUrl)
      await persistSceneFrames(index)
    }
    const label = projectMode.value === 'video' ? '2 images' : `${FRAMES_PER_SCENE} pages`
    showToastMsg(`Scene ${index + 1}: ${label} ready`)
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    scene.generating = false
    scene.generatingLabel = null
  }
}

async function startImagePrediction(body: { model: string; input: Record<string, unknown> }) {
  const res = await $fetch<{ id: string }>('/api/image', { method: 'POST', body })
  return res.id
}

async function pollReplicatePrediction(
  id: string,
  pollPath: string,
  failLabel: string,
  max = 90,
) {
  for (let i = 0; i < max; i++) {
    await sleep(2000)
    const data = await $fetch<{ status: string; output: string | string[]; error?: string }>(pollPath)
    if (data.status === 'succeeded') return pickPollOutput(data.output)
    if (data.status === 'failed') throw new Error(data.error || failLabel)
  }
  throw new Error(`${failLabel} (timed out)`)
}

async function pollReplicate(id: string, max = 90) {
  return pollReplicatePrediction(id, `/api/image/${id}`, 'Image generation failed', max)
}

async function runKontextEdit(
  prompt: string,
  imageBase64: string,
  mime: 'image/jpeg' | 'image/png' = 'image/png',
) {
  const id = await startImagePrediction({
    model: REPLICATE_MODELS.kontext,
    input: {
      prompt,
      input_image: imageDataUri(imageBase64, mime),
      aspect_ratio: '16:9',
      output_format: 'png',
      safety_tolerance: 2,
    },
  })
  return pollReplicate(id)
}

// ── Narration (TTS — ElevenLabs cloned voice or Replicate fallback) ─────────
async function callTts(text: string) {
  if (profile.elevenVoiceId && userId.value) {
    const res = await $fetch<{ audioUrl: string }>('/api/voice/tts', {
      method: 'POST',
      body: { text, voice_id: profile.elevenVoiceId, user_id: userId.value },
    })
    return res.audioUrl
  }
  const res = await $fetch<{ id: string }>('/api/tts', {
    method: 'POST',
    body: { text },
  })
  return pollReplicatePrediction(res.id, `/api/tts/${res.id}`, 'Voice generation failed', 45)
}

async function fetchAudioBuffer(ctx: AudioContext, url: string) {
  const res = await fetch(url.startsWith('http') ? url : `${window.location.origin}${url}`)
  const data = await res.arrayBuffer()
  return ctx.decodeAudioData(data.slice(0))
}

async function generateSceneNarration(scenes: Scene[]) {
  const ctx = new AudioContext()
  const buffers: AudioBuffer[] = []
  try {
    for (let i = 0; i < scenes.length; i++) {
      const line = scenes[i].narration?.trim()
      if (!line) {
        buffers.push(ctx.createBuffer(1, 1, ctx.sampleRate))
        continue
      }
      showToastMsg(`Voiceover ${i + 1}/${scenes.length}…`)
      const audioUrl = await callTts(line)
      buffers.push(await fetchAudioBuffer(ctx, audioUrl))
    }
    return buffers
  } finally {
    await ctx.close()
  }
}

function sceneDurationSeconds(scene: Scene) {
  return clampSceneDuration(scene.duration)
}

function pickVideoMimeTypeWithAudio() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || pickVideoMimeType()
}

// ── Video Assembly (cinematic compositor) ───────────────────────────────────
const VIDEO_W = 1280
const VIDEO_H = 720
const VIDEO_FPS = 30
const VIDEO_BITRATE = 10_000_000
const CROSSFADE_FRAMES = 24          // 0.8s at 30fps — smooth scene-to-scene dissolve
const FLIPBOOK_PAGE_FADE_FRAMES = 8  // 0.27s crossfade between flipbook pages (was 2-frame hard cut)
const MOTION_PRESETS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'drift-up'] as const
type MotionPreset = typeof MOTION_PRESETS[number]

async function assembleVideo() {
  if (!allImagesReady.value || renderingVideo.value) return
  renderingVideo.value = true
  showToastMsg('Generating voiceover…')
  try {
    let narrationBuffers: AudioBuffer[] = []
    try {
      narrationBuffers = await generateSceneNarration(videoProject.scenes)
    } catch (e: unknown) {
      showToastMsg(`Voiceover skipped: ${(e as Error).message}`, 'error')
    }
    showToastMsg('Rendering video…')
    const url = await buildVideoFromImages(videoProject.scenes, narrationBuffers)
    videoUrl.value = url
    showToastMsg(narrationBuffers.length ? 'Video with voiceover ready!' : 'Video ready!')
    nextTick(() => { if (previewContent.value) previewContent.value.scrollTop = 0 })
    // Auto-save to R2 so the video persists on reload
    saveRenderedVideo(url).catch(() => {})
  } catch (e: unknown) {
    showToastMsg('Assembly failed: ' + (e as Error).message, 'error')
  } finally {
    renderingVideo.value = false
  }
}

async function saveRenderedVideo(blobUrl: string) {
  if (!userId.value || !sessionId.value) return
  const blob = await fetch(blobUrl).then(r => r.blob())
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const res = await $fetch<{ key: string; assetUrl: string }>('/api/upload', {
    method: 'POST',
    body: { base64, type: 'video', user_id: userId.value, session_id: sessionId.value },
  })
  savedVideoKey.value = res.key
  await dbPatch(`/api/sessions/${sessionId.value}`, { video_key: res.key })
  showToastMsg('Video saved to cloud')
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

function pickVideoMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

async function waitVideoFrame(stream: MediaStream, fps: number, frameStartMs = performance.now()) {
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  track?.requestFrame?.()
  // Subtract actual draw time so total frame duration stays close to 1/fps.
  // Without this each frame takes draw_time + 1/fps ms, making audio arrive early.
  const elapsed = performance.now() - frameStartMs
  const remaining = Math.max(0, 1000 / fps - elapsed)
  await new Promise<void>(r => setTimeout(r, remaining))
}

const LETTERBOX_RATIO = 0.055  // 5.5% each side — classic 2.35:1 cinematic crop

function drawLetterbox(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const barH = Math.round(H * LETTERBOX_RATIO)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, barH)
  ctx.fillRect(0, H - barH, W, barH)
}

function drawSceneFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  progress: number, // 0→1 eased, drives Ken Burns
  motion: MotionPreset,
) {
  ctx.fillStyle = '#050508'
  ctx.fillRect(0, 0, W, H)

  const ir = img.width / img.height
  const cr = W / H
  let dw: number
  let dh: number
  if (ir > cr) { dh = H; dw = H * ir }
  else { dw = W; dh = W / ir }

  // Subtle range — 6% zoom / 3% pan so motion is felt not seen
  let zoom0 = 1.0
  let zoom1 = 1.06
  let panX0 = 0
  let panX1 = 0
  let panY0 = 0
  let panY1 = 0

  switch (motion) {
    case 'zoom-out':  zoom0 = 1.07; zoom1 = 1.0; break
    case 'pan-left':  panX1 = -0.03 * dw; zoom0 = 1.01; zoom1 = 1.05; break
    case 'pan-right': panX0 = -0.03 * dw; zoom0 = 1.01; zoom1 = 1.05; break
    case 'drift-up':  panY1 = -0.02 * dh; zoom0 = 1.01; zoom1 = 1.05; break
    default: break // zoom-in: 1.0 → 1.06
  }

  const zoom = zoom0 + (zoom1 - zoom0) * progress
  const panX = panX0 + (panX1 - panX0) * progress
  const panY = panY0 + (panY1 - panY0) * progress
  const sw = dw * zoom
  const sh = dh * zoom
  const x = (W - sw) / 2 + panX
  const y = (H - sh) / 2 + panY

  ctx.drawImage(img, x, y, sw, sh)
  drawVignette(ctx, W, H)
  drawColorGrade(ctx, W, H)
}

function sceneFrameUrls(scene: Scene): string[] {
  if (scene.frameUrls.length) return scene.frameUrls
  if (scene.imageUrl) return [scene.imageUrl]
  return []
}

/** Render each flipbook page with live Ken Burns, then crossfade to the next page. */
async function renderSceneFlipbook(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  imgs: HTMLImageElement[],
  W: number,
  H: number,
  FPS: number,
  totalFrames: number,
  stream: MediaStream,
  startGlobalFrame: number,
) {
  const n = imgs.length
  const totalFadeFrames = FLIPBOOK_PAGE_FADE_FRAMES * Math.max(0, n - 1)
  const holdPerPage = Math.max(FPS, Math.floor((totalFrames - totalFadeFrames) / n))
  let globalF = startGlobalFrame

  for (let seg = 0; seg < n; seg++) {
    // Each page gets a different motion preset so consecutive pages feel distinct
    const motion = MOTION_PRESETS[seg % MOTION_PRESETS.length]

    // Animate Ken Burns across the hold (progress 0→1 with easing)
    for (let f = 0; f < holdPerPage; f++) {
      const t0 = performance.now()
      const p = easeInOutCubic(f / Math.max(holdPerPage - 1, 1))
      drawSceneFrame(ctx, imgs[seg], W, H, p, motion)
      drawLetterbox(ctx, W, H)
      drawSceneOverlays(ctx, scene, W, H, globalF, totalFrames)
      globalF++
      await waitVideoFrame(stream, FPS, t0)
    }

    // Smooth crossfade to next page (no hard cut)
    if (seg < n - 1) {
      const nextMotion = MOTION_PRESETS[(seg + 1) % MOTION_PRESETS.length]
      for (let f = 0; f < FLIPBOOK_PAGE_FADE_FRAMES; f++) {
        const t0 = performance.now()
        const blend = easeInOutCubic(f / FLIPBOOK_PAGE_FADE_FRAMES)
        drawSceneFrame(ctx, imgs[seg], W, H, 1, motion)
        ctx.save()
        ctx.globalAlpha = blend
        drawSceneFrame(ctx, imgs[seg + 1], W, H, 0, nextMotion)
        ctx.restore()
        drawLetterbox(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, globalF, totalFrames)
        globalF++
        await waitVideoFrame(stream, FPS, t0)
      }
    }
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function drawColorGrade(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = 'rgba(18,12,32,0.08)'
  ctx.fillRect(0, 0, W, H)
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawTitleCard(ctx: CanvasRenderingContext2D, title: string, W: number, H: number, alpha: number) {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  const x = W * 0.06
  const y = H * 0.08
  ctx.font = `800 ${Math.round(W * 0.038)}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 16
  ctx.fillStyle = '#ffffff'
  ctx.fillText(title.toUpperCase(), x, y)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(124,92,252,0.95)'
  ctx.fillRect(x, y + W * 0.048, W * 0.14, 4)
  ctx.restore()
}

function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  text: string,
  W: number,
  H: number,
  reveal: number,
) {
  if (reveal <= 0) return
  const fontSize = Math.round(W * 0.030)
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
  const maxW = W * 0.80

  // Word-by-word typewriter: show words progressively based on reveal
  const words = text.split(' ')
  const visibleWordCount = Math.min(words.length, Math.ceil(reveal * words.length * 1.1))
  const visibleText = words.slice(0, visibleWordCount).join(' ')

  // Use full text for stable background width so it doesn't jump as words appear
  const allLines = wrapText(ctx, text, maxW)
  const visibleLines = wrapText(ctx, visibleText, maxW)

  const lineH = fontSize * 1.45
  const padX = 26
  const padY = 16
  const blockW = Math.min(
    maxW + padX * 2,
    Math.max(...allLines.map(l => ctx.measureText(l).width), 0) + padX * 2,
  )
  const blockH = allLines.length * lineH + padY * 2
  const blockX = (W - blockW) / 2
  // Position above the letterbox bar with a small gap
  const barH = Math.round(H * LETTERBOX_RATIO)
  const blockY = H - blockH - barH - Math.round(H * 0.025)

  // Quick fade-in (first 15% of reveal), then full opacity
  const fade = easeOutCubic(Math.min(1, reveal * 7))

  ctx.save()
  ctx.globalAlpha = fade * 0.97
  // Dark semi-transparent pill background
  ctx.fillStyle = 'rgba(6,6,10,0.82)'
  roundRect(ctx, blockX, blockY, blockW, blockH, 12)
  ctx.fill()
  // Left accent bar
  ctx.fillStyle = 'rgba(124,92,252,0.9)'
  ctx.fillRect(blockX, blockY + 10, 3, blockH - 20)

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.65)'
  ctx.shadowBlur = 8
  visibleLines.forEach((l, i) => {
    ctx.fillText(l, W / 2, blockY + padY + i * lineH)
  })
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawSceneOverlays(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  W: number,
  H: number,
  frame: number,
  totalFrames: number,
) {
  const titleFrames = VIDEO_FPS * 1.8
  if (frame < titleFrames) {
    const titleAlpha = frame < VIDEO_FPS * 0.4
      ? frame / (VIDEO_FPS * 0.4)
      : 1 - (frame - VIDEO_FPS * 1.2) / (VIDEO_FPS * 0.6)
    drawTitleCard(ctx, scene.title, W, H, Math.max(0, Math.min(1, titleAlpha)))
  }

  const captionStart = VIDEO_FPS * 0.35
  const captionEnd = totalFrames - VIDEO_FPS * 0.4
  if (frame > captionStart && frame < captionEnd) {
    const captionReveal = (frame - captionStart) / (captionEnd - captionStart)
    drawCaptionOverlay(ctx, scene.narration, W, H, captionReveal)
  }
}

async function buildVideoFromImages(scenes: Scene[], narrationBuffers: AudioBuffer[] = []) {
  const W = VIDEO_W
  const H = VIDEO_H
  const FPS = VIDEO_FPS
  const sceneImages = await Promise.all(
    scenes.map(s => Promise.all(sceneFrameUrls(s).map(url => loadImage(url)))),
  )
  // Scene duration is narration-driven: ensure audio always fits without speed adjustment.
  // If narration is longer than the user-set duration we expand the scene; never shrink.
  const sceneDurationsSec = scenes.map((s, si) => {
    const buf = narrationBuffers[si]
    if (buf && buf.duration > 0.5) {
      const needed = Math.ceil(buf.duration + 0.6)  // 0.6s breathing room after narration
      return Math.min(MAX_SCENE_DURATION, Math.max(sceneDurationSeconds(s), needed))
    }
    return sceneDurationSeconds(s)
  })

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const videoStream = canvas.captureStream(FPS)
  const hasNarration = narrationBuffers.some(b => b.duration > 0.05)
  let audioCtx: AudioContext | null = null
  let audioDest: MediaStreamAudioDestinationNode | null = null
  let recorderStream: MediaStream = videoStream

  if (hasNarration) {
    audioCtx = new AudioContext()
    await audioCtx.resume()
    audioDest = audioCtx.createMediaStreamDestination()
    recorderStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ])
  }

  const mimeType = hasNarration ? pickVideoMimeTypeWithAudio() : pickVideoMimeType()
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(recorderStream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: VIDEO_BITRATE,
    audioBitsPerSecond: hasNarration ? 128_000 : undefined,
    bitsPerSecond: VIDEO_BITRATE,
  } as MediaRecorderOptions)
  recorder.ondataavailable = e => {
    if ((e as BlobEvent).data.size > 0) chunks.push((e as BlobEvent).data)
  }

  const done = new Promise<string>((resolve) => {
    recorder.onstop = () => {
      audioCtx?.close()
      resolve(URL.createObjectURL(new Blob(chunks, { type: mimeType || 'video/webm' })))
    }
  })

  recorder.start(100)
  if (hasNarration && audioCtx) await sleep(80)

  // Fire each scene's narration INSIDE the render loop, immediately before the
  // first content frame is captured. This ties audio to the actual video timeline
  // (wall-clock render speed) rather than an assumed 30 fps — eliminating the
  // cumulative drift that pre-scheduling caused when canvas rendering runs at
  // ~25–27 fps instead of the target 30 fps.
  function startSceneAudio(si: number) {
    if (!audioCtx || !audioDest) return
    const buf = narrationBuffers[si]
    if (!buf || buf.duration < 0.05) return
    const src = audioCtx.createBufferSource()
    src.buffer = buf
    // Scene duration was already expanded to cover the narration — always 1× speed.
    src.connect(audioDest)
    src.start(audioCtx.currentTime)
  }

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si]
    const imgs = sceneImages[si]
    if (!imgs.length) continue
    const motion = MOTION_PRESETS[si % MOTION_PRESETS.length]
    const hasCrossfade = si > 0
    // Add CROSSFADE_FRAMES as additive overhead for non-first scenes so the crossfade
    // transition does NOT eat into the narration budget. Without this, each scene after
    // the first loses 0.8s of content time, causing audio to bleed into the next scene.
    const totalFrames = Math.max(FPS * 2, Math.floor(sceneDurationsSec[si] * FPS) + (hasCrossfade ? CROSSFADE_FRAMES : 0))

    // Crossfade transition from previous scene (audio NOT fired yet)
    if (hasCrossfade) {
      const prevImgs = sceneImages[si - 1]
      const prevImg = prevImgs[prevImgs.length - 1] ?? imgs[0]
      for (let f = 0; f < CROSSFADE_FRAMES; f++) {
        const t0 = performance.now()
        const blend = easeInOutCubic(f / CROSSFADE_FRAMES)
        const prevMotion = MOTION_PRESETS[(si - 1) % MOTION_PRESETS.length]
        drawSceneFrame(ctx, prevImg, W, H, 1, prevMotion)
        ctx.save()
        ctx.globalAlpha = blend
        drawSceneFrame(ctx, imgs[0], W, H, 0, motion)
        ctx.restore()
        drawLetterbox(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, f, totalFrames)
        await waitVideoFrame(videoStream, FPS, t0)
      }
    }

    // Fire audio exactly here — crossfade done, first content frame is next.
    // audioCtx.currentTime is real wall-clock, matching the video frame timestamp.
    startSceneAudio(si)

    const contentFrames = hasCrossfade ? totalFrames - CROSSFADE_FRAMES : totalFrames

    // Render scene content frames
    if (imgs.length >= FRAMES_PER_SCENE) {
      await renderSceneFlipbook(ctx, scene, imgs, W, H, FPS, contentFrames, videoStream, hasCrossfade ? CROSSFADE_FRAMES : 0)
    } else {
      const startF = hasCrossfade ? CROSSFADE_FRAMES : 0
      for (let f = startF; f < totalFrames; f++) {
        const t0 = performance.now()
        const localF = f - startF
        const progress = easeInOutCubic(localF / Math.max(contentFrames - 1, 1))
        drawSceneFrame(ctx, imgs[0], W, H, progress, motion)
        drawLetterbox(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, f, totalFrames)
        await waitVideoFrame(videoStream, FPS, t0)
      }
    }
  }

  recorder.stop()
  return done
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = reject; img.src = src
  })
}

// ── Session Management ─────────────────────────────────────────────────────
async function clearProjectMedia() {
  if (!sessionId.value) return
  if (!confirm('Clear all scene images and rendered video? Your script and chat history will stay.')) return
  try {
    await $fetch(`/api/sessions/${sessionId.value}/clear-media`, { method: 'POST' })
    videoUrl.value = null
    savedVideoKey.value = null
    for (const s of videoProject.scenes) {
      s.imageUrl = null
      s.frameUrls = []
    }
    showProjectMenu.value = false
    showToastMsg('Images and video cleared')
  } catch {
    showToastMsg('Could not clear media', 'error')
  }
}

async function restoreImages() {
  if (!sessionId.value) return
  showToastMsg('Restoring saved images…')
  try {
    const data = await $fetch<{ scenes: { id: string; position: number; frame_keys: string | null; image_key: string | null }[] }>(
      `/api/sessions/${sessionId.value}`,
    )
    let restored = 0
    ;(data.scenes ?? []).forEach((dbScene) => {
      const scene = videoProject.scenes[dbScene.position]
      if (!scene) return
      if (dbScene.id) scene.id = dbScene.id
      const urls = parseFrameKeys(dbScene.frame_keys)
      if (urls.length) {
        scene.frameUrls = urls
        scene.imageUrl = urls[0]
        restored++
      } else if (dbScene.image_key) {
        const url = `/api/assets/${dbScene.image_key}`
        scene.frameUrls = [url]
        scene.imageUrl = url
        restored++
      }
    })
    showToastMsg(restored ? `Restored ${restored} scene(s)` : 'No saved images found — generate first', restored ? 'success' : 'error')
  } catch {
    showToastMsg('Could not reach server', 'error')
  }
}

async function assembleSceneVideo(index: number) {
  const scene = videoProject.scenes[index]
  if (!scene || !scene.frameUrls.length) {
    showToastMsg('Generate images for this scene first', 'error')
    return
  }
  // Already rendered — just reopen the modal, no re-render needed
  if (sceneVideoUrls.value[index]) {
    sceneVideoModal.value = { index, url: sceneVideoUrls.value[index] }
    return
  }
  if (sceneVideoLoading.value !== -1) return
  sceneVideoLoading.value = index
  showToastMsg(`Scene ${index + 1}: generating voiceover…`)
  try {
    let buffers: AudioBuffer[] = []
    try { buffers = await generateSceneNarration([scene]) } catch { /* narration optional */ }
    showToastMsg(`Scene ${index + 1}: rendering clip…`)
    const url = await buildVideoFromImages([scene], buffers)
    sceneVideoUrls.value = { ...sceneVideoUrls.value, [index]: url }
    sceneVideoModal.value = { index, url }
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    sceneVideoLoading.value = -1
  }
}

async function generateSceneActualVideo(index: number) {
  const scene = videoProject.scenes[index]
  if (!scene || !scene.frameUrls.length) {
    showToastMsg('Generate images for this scene first', 'error')
    return
  }
  if (sceneVideoUrls.value[index]) {
    sceneVideoModal.value = { index, url: sceneVideoUrls.value[index] }
    return
  }
  if (sceneVideoLoading.value !== -1) return
  sceneVideoLoading.value = index
  showToastMsg(`Scene ${index + 1}: generating AI video…`)
  try {
    const frameUrl = scene.frameUrls[0]
    const absoluteUrl = frameUrl.startsWith('http')
      ? frameUrl
      : `${window.location.origin}${frameUrl}`
    const id = await startImagePrediction({
      model: REPLICATE_MODELS.videoI2V,
      input: {
        prompt: `${scene.narration} ${scene.mood} mood, cinematic motion`,
        first_frame_image: absoluteUrl,
      },
    })
    const videoClipUrl = await pollReplicatePrediction(id, `/api/image/${id}`, 'Video generation failed', 180)
    sceneVideoUrls.value = { ...sceneVideoUrls.value, [index]: videoClipUrl }
    sceneVideoModal.value = { index, url: videoClipUrl }
    showToastMsg(`Scene ${index + 1}: video ready!`)
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    sceneVideoLoading.value = -1
  }
}

async function regenerateSceneFrames(index: number) {
  const scene = videoProject.scenes[index]
  if (!scene || scene.generating) return
  scene.frameUrls = []
  scene.imageUrl = null
  await generateSceneFrames(index)
}

// ── Voice cloning ──────────────────────────────────────────────────────────
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []
    mediaRecorderRef = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    mediaRecorderRef.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data) }
    mediaRecorderRef.start(250)
    isRecording.value = true
    recordingSeconds.value = 0
    recordingTimer = setInterval(() => { recordingSeconds.value++ }, 1000)
  } catch {
    showToastMsg('Microphone access denied', 'error')
  }
}

async function stopVoiceRecording() {
  if (!mediaRecorderRef) return
  isRecording.value = false
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null }

  await new Promise<void>(resolve => {
    mediaRecorderRef!.onstop = () => resolve()
    mediaRecorderRef!.stop()
    mediaRecorderRef!.stream.getTracks().forEach(t => t.stop())
  })

  if (recordingSeconds.value < 5) {
    showToastMsg('Recording too short — speak for at least 5 seconds', 'error')
    return
  }

  const blob = new Blob(audioChunks, { type: 'audio/webm' })
  await submitVoiceSample(blob)
}

async function submitVoiceSample(blob: Blob) {
  cloningVoice.value = true
  showToastMsg('Cloning your voice…')
  try {
    const reader = new FileReader()
    const b64 = await new Promise<string>((res, rej) => {
      reader.onload = () => res(reader.result as string)
      reader.onerror = rej
      reader.readAsDataURL(blob)
    })
    const data = await $fetch<{ voice_id: string }>('/api/voice/clone', {
      method: 'POST',
      body: { audio_base64: b64, user_id: userId.value, name: profile.name || 'My Voice' },
    })
    profile.elevenVoiceId = data.voice_id
    showVoiceWidget.value = false
    showToastMsg('Voice cloned! Voiceovers will now use your voice.')
  } catch (e: unknown) {
    showToastMsg((e as Error).message || 'Voice clone failed', 'error')
  } finally {
    cloningVoice.value = false
  }
}

async function deleteClonedVoice() {
  if (!profile.elevenVoiceId || !userId.value) return
  if (!confirm('Remove your cloned voice? Future voiceovers will use the default AI voice.')) return
  try {
    await $fetch('/api/voice/clone', {
      method: 'DELETE',
      body: { voice_id: profile.elevenVoiceId, user_id: userId.value },
    })
    profile.elevenVoiceId = null
    showToastMsg('Cloned voice removed')
  } catch {
    showToastMsg('Could not remove voice', 'error')
  }
}

function apiErrorMessage(e: unknown) {
  const err = e as { data?: { message?: string }; statusMessage?: string; message?: string }
  return err.data?.message || err.statusMessage || err.message || 'Request failed'
}

async function deleteProjectById(id: string) {
  try {
    await $fetch(`/api/sessions/${id}/delete`, { method: 'POST' })
  } catch {
    await $fetch(`/api/sessions/${id}`, { method: 'DELETE' })
  }
}

async function deleteProject() {
  if (!sessionId.value) return
  if (!confirm('Delete this project permanently? This cannot be undone.')) return
  try {
    await deleteProjectById(sessionId.value)
    localStorage.removeItem('bm_active_session')
    showProjectMenu.value = false
    navigateTo('/projects')
  } catch (e: unknown) {
    showToastMsg(apiErrorMessage(e), 'error')
  }
}

function clearSession() {
  if (!confirm('Start a new video? This will clear the current chat and script.')) return
  localStorage.removeItem('bm_active_session')
  sessionId.value = null
  messages.value = []
  videoProject.title = ''; videoProject.topic = ''; videoProject.characterDescription = ''; videoProject.scenes = []
  videoUrl.value = null; showVideoPanel.value = false

  if (profile.name && profile.niche) {
    screen.value = 'chat'
    const greeting = `Welcome back, ${profile.name}! Ready to create another brand video? Tell me about your next idea!`
    messages.value = [{ role: 'assistant', content: greeting, suggestCreate: false }]
    ensureSession()
  } else {
    screen.value = 'onboard'
  }
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

// ── New project chat start ─────────────────────────────────────────────────
async function startNewProjectChat() {
  await ensureUser()
  await ensureSession()
  if (sessionId.value) {
    localStorage.setItem(`bm_session_mode_${sessionId.value}`, projectMode.value)
  }
  screen.value = 'chat'
  messages.value = []

  const cfg = VIDEO_TYPE_CONFIG[projectSetup.videoType]
  const namePart = profile.name ? `Hi ${profile.name}! ` : ''
  const purposeBlock = projectSetup.projectPurpose
    ? `\n\nYour goal: *${projectSetup.projectPurpose}*\n`
    : ''

  const greeting = [
    `${namePart}I'm your AI **${cfg?.label ?? 'video'} creator** — let's make "${projectSetup.projectTitle}" exceptional.`,
    purposeBlock,
    `I'll ask you a few focused questions to fully understand your story before we build the script.\n\n${cfg?.firstQuestion ?? '**What\'s the core message** you want viewers to take away?'}`,
  ].join('')

  messages.value.push({ role: 'assistant', content: greeting, suggestCreate: false })
  syncMessages([{ role: 'assistant', content: greeting }])
}

// ── Init ───────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', closeProjectMenu)
  const uid = localStorage.getItem('bm_user_id')
  const activeSession = localStorage.getItem('bm_active_session')
  const newProjectRaw = localStorage.getItem('bm_new_project')

  if (!uid) {
    // No user — show onboard form immediately
    appLoading.value = false
    return
  }

  // User exists — keep loading screen up until we know which route to take.
  // This prevents the onboard form (with the user's name/niche) from flashing
  // for ~500ms while the profile fetch is in flight.
  try {
    userId.value = uid

    // Load user profile from D1
    const user = await $fetch<{ id: string; name: string; niche: string; photo_key: string | null; hero_key?: string | null; eleven_voice_id?: string | null } | null>(
      `/api/user?id=${uid}`
    ).catch(() => null)

    if (user?.name) {
      profile.name = user.name
      profile.niche = user.niche ?? ''
      if (user.photo_key) {
        profile.photoUrl = `/api/assets/${user.photo_key}`
        try { profile.photoBase64 = await assetUrlToBase64(profile.photoUrl) } catch { /* lazy load */ }
      }
      if (user.hero_key) {
        profile.heroUrl = `/api/assets/${user.hero_key}`
        try { profile.heroBase64 = await assetUrlToBase64(profile.heroUrl) } catch { /* lazy load */ }
      }
      if (user.eleven_voice_id) profile.elevenVoiceId = user.eleven_voice_id
    }

    if (route.query.setup === 'profile') {
      navigateTo('/profile')
      return
    }

    // ── New project from modal form ──────────────────────────────────────────
    if (newProjectRaw) {
      localStorage.removeItem('bm_new_project')
      try {
        const setup = JSON.parse(newProjectRaw) as {
          videoType: string; title: string; purpose: string; photoBase64: string | null; mode?: string
        }
        projectMode.value = setup.mode === 'video' ? 'video' : 'image'
        projectSetup.videoType = setup.videoType
        projectSetup.projectTitle = setup.title
        projectSetup.projectPurpose = setup.purpose
        videoProject.title = setup.title
        if (setup.photoBase64) {
          // Project-specific photo always wins — character is built from this image,
          // not the global profile photo, so each project can have its own look.
          profile.photoBase64 = setup.photoBase64
          profile.photoUrl = `data:image/jpeg;base64,${setup.photoBase64}`
          profile.heroUrl = null
          profile.heroBase64 = null
        }
      } catch { /* ignore parse errors */ }
      await startNewProjectChat()
      return
    }

    // Load existing session if one was set from projects page
    if (activeSession) {
      sessionId.value = activeSession
      const loaded = await loadSession(activeSession)
      if (loaded && messages.value.length) {
        screen.value = 'chat'
        nextTick(scrollToBottom)
        return
      }
    }

    if (user?.name && !user?.niche) {
      navigateTo('/profile')
      return
    }

    // Profile exists — skip onboard, start a fresh chat
    if (user?.name && user?.niche) {
      screen.value = 'chat'
      const greeting = `Welcome back, ${user.name}! Ready to create another video? Tell me about your next idea.`
      messages.value = [{ role: 'assistant', content: greeting, suggestCreate: false }]
      await ensureSession()
    }
  } finally {
    appLoading.value = false
  }
})
</script>

<template>
  <div class="app-shell" :class="{ 'has-scenes': videoProject.scenes.length > 0 && screen !== 'onboard' }">

    <!-- ── INIT LOADING (prevents onboard form flashing with user data) ── -->
    <div v-if="appLoading" class="app-init-loading">
      <div class="app-init-spinner" />
    </div>

    <!-- ── ONBOARD ── -->
    <div v-else-if="screen === 'onboard'" class="screen onboard-screen">
      <div class="onboard-hero">
        <NuxtLink to="/profile" class="back-link">
          <Icon name="fa6-solid:arrow-left" size="14" /> Profile
        </NuxtLink>
        <BrandLogo :size="52" :wordmark="false" class="logo-mark" />
        <h1>BrandMe <span class="gradient-text">AI</span></h1>
      </div>
      <div class="onboard-form card">
        <h2>Quick start</h2>
        <p class="onboard-note">For photo & niche, use your <NuxtLink to="/profile">profile page</NuxtLink> — one place for all account settings.</p>
        <div class="field">
          <label>Your Name</label>
          <input v-model="profile.name" type="text" placeholder="e.g. Sarah Johnson" />
        </div>
        <div class="field">
          <label>Your Niche / Industry</label>
          <input v-model="profile.niche" type="text" placeholder="e.g. Digital Marketing, Fitness, Finance" />
        </div>
        <button class="btn btn-primary btn-full" :disabled="!canStart" @click="startChat">
          <Icon name="fa6-solid:wand-magic-sparkles" size="16" /> Start Creating
        </button>
      </div>
    </div>

    <!-- ── CHAT + PREVIEW (desktop split layout) ── -->
    <div v-else-if="screen === 'chat' || screen === 'preview'" class="workspace">

      <!-- LEFT: Chat panel -->
      <div class="chat-panel" :class="{ 'mobile-hidden': screen === 'preview' }">
        <header class="chat-header">
          <NuxtLink to="/projects" class="icon-btn" title="All projects"><Icon name="fa6-solid:arrow-left" size="18" /></NuxtLink>
          <div class="chat-header-info">
            <div class="avatar-sm">{{ profile.name[0] }}</div>
            <div>
              <div class="chat-title">{{ videoProject.title || 'Brand Video Chat' }}</div>
              <div class="chat-sub">AI Video Strategist</div>
            </div>
          </div>
          <button class="icon-btn" title="New video" @click="clearSession"><Icon name="fa6-solid:plus" size="18" /></button>
          <div v-if="sessionId" class="project-menu-wrap">
            <button class="icon-btn" title="Project options" @click.stop="showProjectMenu = !showProjectMenu">
              <Icon name="fa6-solid:ellipsis-vertical" size="18" />
            </button>
            <div v-if="showProjectMenu" class="project-menu" @click.stop>
              <button type="button" @click="clearProjectMedia">
                <Icon name="fa6-solid:ban" size="16" /> Clear images & video
              </button>
              <button type="button" class="danger" @click="deleteProject">
                <Icon name="fa6-solid:trash" size="16" /> Delete project
              </button>
            </div>
          </div>
          <NuxtLink to="/profile" class="icon-btn desktop-only" title="Profile"><Icon name="fa6-solid:user" size="18" /></NuxtLink>
          <button class="icon-btn mobile-only" :class="{ active: showVideoPanel }" @click="showVideoPanel = !showVideoPanel">
            <Icon name="fa6-solid:video" size="18" />
          </button>
        </header>

        <!-- Mobile video panel -->
        <Transition name="slide-down">
          <div v-if="showVideoPanel && screen === 'chat'" class="video-panel mobile-only">
            <div class="video-panel-inner">
              <div v-if="!videoProject.scenes.length" class="empty-panel">
                <Icon name="fa6-solid:film" size="32" />
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
                        <span class="status-dot" :class="s.frameUrls.length >= neededImages ? 'done' : s.generating ? 'loading' : 'pending'" />
                        {{ s.frameUrls.length >= neededImages ? 'Ready' : s.generating ? 'Generating…' : 'Pending' }}
                      </div>
                    </div>
                  </div>
                </div>
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
                  <button class="btn btn-sm btn-primary" @click="triggerVideoCreation">
                    <Icon name="fa6-solid:video" size="14" /> Create My Video
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
            <Icon v-if="aiTyping" name="fa6-solid:spinner" size="18" class="spin" />
            <Icon v-else name="fa6-solid:paper-plane" size="18" />
          </button>
        </div>
      </div>

      <!-- RIGHT: Storyboard / video editor panel -->
      <div class="preview-panel" :class="{ 'mobile-active': screen === 'preview' }">
        <header class="storyboard-toolbar">
          <button class="icon-btn mobile-only" @click="screen = 'chat'"><Icon name="fa6-solid:arrow-left" size="18" /></button>
          <div class="toolbar-brand">
            <Icon name="fa6-solid:clapperboard" size="18" class="toolbar-icon" />
            <div class="toolbar-titles">
              <div class="chat-title">{{ videoProject.title || 'Storyboard' }}</div>
              <div class="chat-sub">
                {{ videoProject.scenes.length }} scenes · {{ totalDuration }}s total
                <span v-if="videoProject.scenes.length" class="mode-badge" :class="projectMode">
                  {{ projectMode === 'video' ? 'Video Mode' : 'Image Mode' }}
                </span>
              </div>
            </div>
          </div>
          <div class="toolbar-actions">
            <!-- Voice clone badge / record button -->
            <button
              v-if="profile.elevenVoiceId"
              class="btn btn-sm btn-ghost voice-badge"
              title="Your voice is cloned — click to manage"
              @click="showVoiceWidget = !showVoiceWidget"
            >
              <Icon name="fa6-solid:microphone" size="13" class="voice-icon-active" /> My Voice
            </button>
            <button
              v-else
              class="btn btn-sm btn-ghost"
              title="Record your voice to use it for all narrations"
              @click="showVoiceWidget = !showVoiceWidget"
            >
              <Icon name="fa6-solid:microphone" size="13" /> Clone Voice
            </button>
            <button
              v-if="sessionId && videoProject.scenes.length && !allImagesReady"
              class="btn btn-sm btn-ghost"
              title="Reload saved images from cloud without regenerating"
              @click="restoreImages"
            >
              <Icon name="fa6-solid:rotate" size="14" /> Restore saved
            </button>
            <button
              v-if="!allImagesReady && videoProject.scenes.length"
              class="btn btn-sm btn-outline"
              :disabled="generatingAll"
              @click="generateAllImages"
            >
              <Icon name="fa6-solid:wand-magic-sparkles" size="14" />
              {{ generatingAll ? 'Generating…' : projectMode === 'video' ? 'Generate all (2 images per scene)' : `Generate all (${FRAMES_PER_SCENE} pages per scene)` }}
            </button>
            <button
              v-if="videoProject.scenes.some(s => s.frameUrls.length > 0)"
              class="btn btn-sm btn-ghost"
              :class="{ active: showGallery }"
              @click="showGallery = !showGallery"
            >
              <Icon name="fa6-solid:images" size="14" /> Gallery
            </button>
            <button v-if="allImagesReady" class="btn btn-sm btn-primary" :disabled="renderingVideo" @click="assembleVideo">
              <Icon :name="renderingVideo ? 'fa6-solid:spinner' : (videoUrl || savedVideoUrl) ? 'fa6-solid:rotate' : 'fa6-solid:film'" size="14" :class="{ spin: renderingVideo }" />
              {{ renderingVideo ? 'Rendering…' : (videoUrl || savedVideoUrl) ? 'Re-render' : 'Render with voiceover' }}
            </button>
          </div>
        </header>

        <!-- Voice clone widget -->
        <Transition name="slide-down">
          <div v-if="showVoiceWidget" class="voice-widget">
            <div class="voice-widget-inner">
              <div v-if="profile.elevenVoiceId" class="voice-ready">
                <div class="voice-ready-icon"><Icon name="fa6-solid:microphone" size="20" /></div>
                <div>
                  <div class="voice-ready-label">Your voice is cloned</div>
                  <div class="voice-ready-sub">All voiceovers will use your voice automatically</div>
                </div>
                <button class="btn btn-sm btn-ghost" style="margin-left:auto;color:var(--error)" @click="deleteClonedVoice">
                  <Icon name="fa6-solid:trash" size="13" /> Remove
                </button>
              </div>
              <div v-else class="voice-record-ui">
                <div class="voice-instructions">
                  <strong>Record 15–60 seconds</strong> of yourself speaking naturally — read anything aloud. Your voice will be cloned using AI and used for all narrations.
                </div>
                <div class="voice-controls">
                  <button
                    v-if="!isRecording"
                    class="btn btn-sm btn-primary"
                    :disabled="cloningVoice"
                    @click="startVoiceRecording"
                  >
                    <Icon name="fa6-solid:microphone" size="14" /> Start Recording
                  </button>
                  <template v-else>
                    <div class="recording-indicator">
                      <span class="rec-dot" />
                      <span>Recording {{ recordingSeconds }}s</span>
                    </div>
                    <button class="btn btn-sm btn-outline" @click="stopVoiceRecording">
                      <Icon name="fa6-solid:square" size="13" /> Stop & Clone
                    </button>
                  </template>
                  <div v-if="cloningVoice" class="cloning-status">
                    <div class="spinner" style="width:16px;height:16px;border-width:2px" />
                    Cloning voice…
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- ── Saved / Rendered Video Bar ── -->
        <div v-if="videoUrl || savedVideoUrl" class="video-bar">
          <div class="video-bar-player">
            <video :src="videoUrl || savedVideoUrl!" controls class="video-preview-mini" />
            <div v-if="savedVideoKey" class="video-cloud-badge">
              <Icon name="fa6-solid:cloud-arrow-up" size="11" /> Saved to cloud
            </div>
          </div>
          <div class="video-bar-actions">
            <a :href="videoUrl || savedVideoUrl!" download="brand-video.webm" class="btn btn-outline btn-sm">
              <Icon name="fa6-solid:download" size="13" /> Download
            </a>
            <button class="btn btn-outline btn-sm" @click="showGallery = !showGallery">
              <Icon name="fa6-solid:images" size="13" /> {{ showGallery ? 'Hide gallery' : 'Gallery' }}
            </button>
          </div>
        </div>

        <!-- ── Project Gallery ── -->
        <Transition name="slide-down">
          <div v-if="showGallery" class="gallery-panel">
            <div class="gallery-panel-header">
              <Icon name="fa6-solid:images" size="14" class="gallery-icon" />
              <span>Project Media</span>
              <span class="gallery-count">{{ videoProject.scenes.reduce((n, s) => n + s.frameUrls.length, 0) }} images{{ savedVideoUrl ? ' · 1 video' : '' }}</span>
              <button class="icon-btn" style="margin-left:auto" @click="showGallery = false"><Icon name="fa6-solid:xmark" size="14" /></button>
            </div>

            <!-- Saved video card -->
            <div v-if="savedVideoUrl" class="gallery-video-row">
              <div class="gallery-video-card">
                <video :src="savedVideoUrl" controls class="gallery-video" />
                <div class="gallery-video-meta">
                  <span class="gallery-video-title">{{ videoProject.title || 'Rendered Video' }}</span>
                  <a :href="savedVideoUrl" download="brand-video.webm" class="btn btn-sm btn-primary">
                    <Icon name="fa6-solid:download" size="12" /> Download
                  </a>
                </div>
              </div>
            </div>

            <!-- Scene images grid -->
            <div class="gallery-grid">
              <template v-for="(scene, si) in videoProject.scenes" :key="si">
                <div
                  v-for="(url, fi) in scene.frameUrls"
                  :key="`${si}-${fi}`"
                  class="gallery-img-cell"
                  :title="`Scene ${si + 1} · ${scene.title} · Frame ${fi + 1}`"
                >
                  <img :src="url" class="gallery-img" :alt="`Scene ${si + 1} frame ${fi + 1}`" />
                  <div class="gallery-img-label">S{{ si + 1 }} · F{{ fi + 1 }}</div>
                </div>
              </template>
            </div>
          </div>
        </Transition>

        <div v-if="!videoProject.scenes.length" class="preview-empty">
          <div class="preview-empty-icon"><Icon name="fa6-solid:film" size="36" /></div>
          <p>Chat with AI and say <strong>"create video"</strong> to build your storyboard here.</p>
        </div>

        <div v-else class="storyboard-workspace">
          <div ref="previewContent" class="filmstrip-scroll">
            <div class="filmstrip-ruler">
              <span class="ruler-label">Storyboard</span>
              <span class="ruler-meta">Scroll frames · drag timeline edges to adjust duration</span>
            </div>
            <div class="filmstrip-track">
              <div
                v-for="(scene, i) in videoProject.scenes"
                :key="i"
                class="storyboard-frame"
                :class="{ active: selectedSceneIndex === i, done: scene.frameUrls.length >= neededImages, loading: scene.generating }"
                @click="selectedSceneIndex = i"
              >
                <div class="frame-connector" v-if="i > 0" />
                <div class="frame-head">
                  <span class="frame-num">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="frame-title">{{ scene.title }}</span>
                  <span class="frame-status" :class="scene.frameUrls.length >= neededImages ? 'done' : scene.generating ? 'loading' : 'pending'">
                    <span class="status-dot" />
                  </span>
                </div>
                <div
                  class="frame-viewport"
                  @click.stop="scene.frameUrls.length < neededImages && !scene.generating && generateSceneFrames(i)"
                >
                  <!-- Video mode: first + last image side by side -->
                  <template v-if="projectMode === 'video' && scene.frameUrls.length">
                    <div class="frame-split">
                      <div class="frame-split-half">
                        <img :src="scene.frameUrls[0]" class="frame-split-img" alt="" />
                        <div class="frame-split-label">Opening</div>
                      </div>
                      <div class="frame-split-half">
                        <img :src="scene.frameUrls[scene.frameUrls.length - 1]" class="frame-split-img" alt="" />
                        <div class="frame-split-label">Finale</div>
                      </div>
                    </div>
                  </template>
                  <!-- Image mode: single frame + thumbnail strip -->
                  <template v-else-if="scene.frameUrls.length">
                    <img :src="scene.frameUrls[scene.frameUrls.length - 1]" class="frame-img" alt="" />
                    <div class="frame-strip">
                      <img
                        v-for="(fu, fi) in scene.frameUrls"
                        :key="fi"
                        :src="fu"
                        class="frame-thumb"
                        :class="{ active: fi === scene.frameUrls.length - 1 }"
                        alt=""
                      />
                    </div>
                  </template>
                  <div v-else-if="scene.generating" class="frame-placeholder">
                    <div class="spinner" />
                    <span>{{ scene.generatingLabel || 'Creating images…' }}</span>
                  </div>
                  <div v-else class="frame-placeholder clickable">
                    <Icon name="fa6-solid:layer-group" size="26" />
                    <span>{{ projectMode === 'video' ? 'Generate 2 images' : `Generate ${FRAMES_PER_SCENE} pages` }}</span>
                  </div>
                  <span class="frame-duration">{{ scene.duration }}s · {{ scene.frameUrls.length || 0 }}/{{ neededImages }}</span>
                </div>
                <div class="frame-script-track">
                  <Icon name="fa6-solid:microphone" size="12" class="track-icon" />
                  <p class="frame-narration">{{ scene.narration }}</p>
                </div>
                <div class="frame-tags">
                  <span class="scene-tag">{{ scene.mood }}</span>
                </div>
                <div class="frame-actions" @click.stop>
                  <button
                    class="scene-action-btn"
                    :disabled="scene.generating || generatingAll || sceneVideoLoading !== -1"
                    @click="scene.frameUrls.length >= neededImages ? regenerateSceneFrames(i) : generateSceneFrames(i)"
                  >
                    <Icon :name="scene.generating ? 'fa6-solid:spinner' : 'fa6-solid:image'" size="11" :class="{ spin: scene.generating }" />
                    {{ scene.generating ? (scene.generatingLabel || 'Generating…') : scene.frameUrls.length >= neededImages ? 'Regenerate' : 'Generate images' }}
                  </button>
                  <!-- Video mode: generate actual AI video clip -->
                  <button
                    v-if="projectMode === 'video' && scene.frameUrls.length"
                    class="scene-action-btn accent"
                    :disabled="sceneVideoLoading !== -1"
                    @click="generateSceneActualVideo(i)"
                  >
                    <Icon :name="sceneVideoLoading === i ? 'fa6-solid:spinner' : sceneVideoUrls[i] ? 'fa6-solid:circle-play' : 'fa6-solid:film'" size="11" :class="{ spin: sceneVideoLoading === i }" />
                    {{ sceneVideoLoading === i ? 'Generating…' : sceneVideoUrls[i] ? 'Play video' : 'Generate video' }}
                  </button>
                  <!-- Image mode: preview canvas clip -->
                  <button
                    v-else-if="scene.frameUrls.length"
                    class="scene-action-btn accent"
                    :disabled="sceneVideoLoading === i"
                    @click="assembleSceneVideo(i)"
                  >
                    <Icon :name="sceneVideoLoading === i ? 'fa6-solid:spinner' : sceneVideoUrls[i] ? 'fa6-solid:circle-play' : 'fa6-solid:play'" size="11" :class="{ spin: sceneVideoLoading === i }" />
                    {{ sceneVideoLoading === i ? 'Rendering…' : sceneVideoUrls[i] ? 'Play clip' : 'Preview clip' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="timeline-panel">
            <div class="timeline-header">
              <span class="timeline-label"><Icon name="fa6-solid:stopwatch" size="13" /> Timeline</span>
              <span class="timeline-total">{{ totalDuration }}s</span>
            </div>
            <div ref="timelineTrackRef" class="timeline-track">
              <div
                v-for="(scene, i) in videoProject.scenes"
                :key="'tl-' + i"
                class="timeline-clip"
                :style="{ flex: `0 0 ${timelineWidth(scene)}` }"
                :class="{ active: selectedSceneIndex === i, done: scene.frameUrls.length >= neededImages }"
                @click="selectedSceneIndex = i"
              >
                <span class="clip-num">{{ i + 1 }}</span>
                <span class="clip-dur">{{ scene.duration }}s</span>
                <div
                  class="clip-resize-handle"
                  title="Drag to adjust duration"
                  @mousedown="onDurationResizeStart($event, i)"
                />
              </div>
            </div>
          </div>

          <div v-if="videoProject.scenes[selectedSceneIndex]" class="inspector-panel">
            <div class="inspector-head">
              <span class="inspector-badge">Scene {{ selectedSceneIndex + 1 }}</span>
              <strong>{{ videoProject.scenes[selectedSceneIndex].title }}</strong>
            </div>
            <p class="inspector-narration">{{ videoProject.scenes[selectedSceneIndex].narration }}</p>
            <div class="inspector-duration">
              <label class="scene-prompt-label">Duration</label>
              <div class="duration-controls">
                <input
                  type="range"
                  class="duration-slider"
                  :min="MIN_SCENE_DURATION"
                  :max="MAX_SCENE_DURATION"
                  :value="videoProject.scenes[selectedSceneIndex].duration"
                  @input="setSceneDuration(selectedSceneIndex, Number(($event.target as HTMLInputElement).value))"
                />
                <span class="duration-value">{{ videoProject.scenes[selectedSceneIndex].duration }}s</span>
              </div>
            </div>
            <div class="inspector-prompt">
              <label class="scene-prompt-label">Scene setting (unique per scene)</label>
              <textarea
                v-model="videoProject.scenes[selectedSceneIndex].imagePrompt"
                class="inspector-prompt-input"
                rows="3"
                placeholder="Where is this scene? e.g. rooftop at sunset, open-plan office, coffee shop…"
                @input="onSceneVisualPromptInput(selectedSceneIndex)"
              />
            </div>
            <div v-if="videoProject.scenes[selectedSceneIndex].framePrompts?.length" class="inspector-frames">
              <label class="scene-prompt-label">Flipbook poses (same background)</label>
              <ul class="frame-prompt-list">
                <li
                  v-for="(fp, fi) in videoProject.scenes[selectedSceneIndex].framePrompts"
                  :key="fi"
                >
                  <span class="frame-prompt-num">{{ fi + 1 }}</span>
                  {{ fp }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="toast" :class="toast.type">{{ toast.message }}</div>
    </Transition>

    <!-- Per-scene video preview modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="sceneVideoModal" class="scene-modal-overlay" @click.self="sceneVideoModal = null">
          <div class="scene-modal">
            <div class="scene-modal-header">
              <div>
                <span class="inspector-badge">Scene {{ sceneVideoModal.index + 1 }}</span>
                <strong style="margin-left:8px;font-size:14px;">{{ videoProject.scenes[sceneVideoModal.index]?.title }}</strong>
              </div>
              <button class="icon-btn" @click="sceneVideoModal = null"><Icon name="fa6-solid:xmark" size="16" /></button>
            </div>
            <video :src="sceneVideoModal.url" controls autoplay loop class="scene-modal-video" />
            <div class="scene-modal-footer">
              <a :href="sceneVideoModal.url" :download="`scene-${sceneVideoModal.index + 1}.webm`" class="btn btn-primary" style="flex:1">
                <Icon name="fa6-solid:download" size="14" /> Download Clip
              </a>
              <button class="btn btn-outline" @click="sceneVideoModal = null">Close</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
/* ── Shell ── */
.app-shell {
  height: 100dvh;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

/* ── Init loading (hides onboard flash) ── */
.app-init-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.app-init-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

/* ── Onboard ── */
.screen { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
.onboard-screen { overflow-y: auto; padding-bottom: 32px; max-width: 500px; width: 100%; margin: 0 auto; }
.onboard-hero { background: linear-gradient(160deg,#1a1030 0%,var(--bg) 60%); padding: 48px 24px 36px; text-align: center; position: relative; }
.onboard-hero::after { content:''; position:absolute; bottom:-1px; left:0; right:0; height:32px; background:var(--bg); border-radius:50% 50% 0 0/32px 32px 0 0; }
.back-link { position:absolute; top:16px; left:16px; color:var(--text2); text-decoration:none; font-size:14px; display:flex;align-items:center;gap:6px; }
.logo-mark { margin-bottom:10px; }
.onboard-hero h1 { font-size:30px; font-weight:800; }
.onboard-form { margin:24px 16px 0; background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:24px; }
.onboard-form h2 { font-size:18px; font-weight:700; margin-bottom:12px; }
.onboard-note { font-size:13px; color:var(--text2); line-height:1.5; margin-bottom:20px; }
.onboard-note a { color:var(--accent); font-weight:600; }
.field { margin-bottom:18px; }
.field label { display:block; font-size:12px; font-weight:600; color:var(--text2); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; }
.hint { text-transform:none; font-weight:400; letter-spacing:0; }
.field input { width:100%; background:var(--bg3); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); font-size:15px; padding:12px 14px; outline:none; transition:border-color 0.2s; font-family:var(--font); box-sizing:border-box; }
.field input:focus { border-color:var(--accent); }
.photo-upload { width:100%; height:130px; background:var(--bg3); border:2px dashed var(--border); border-radius:var(--radius-sm); display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; transition:border-color 0.2s; }
.photo-upload.has-photo, .photo-upload:hover { border-color:var(--accent); }
.photo-placeholder { display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--text2); font-size:14px; }
.photo-preview { width:100%; height:100%; object-fit:cover; }

/* ── Workspace (chat + preview) ── */
.workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── Chat Panel ── */
.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  border-right: 1px solid var(--border);
  min-width: 0;
}

/* ── Preview / Storyboard Panel ── */
.preview-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  width: 0;
  overflow: hidden;
  background: #0a0a0c;
}

@media (min-width: 768px) {
  .app-shell.has-scenes .chat-panel {
    flex: 0 0 25%;
    width: 25%;
    max-width: none;
  }
  .app-shell.has-scenes .preview-panel {
    flex: 0 0 75%;
    width: 75%;
    min-width: 0;
  }
  .mobile-only { display: none !important; }
}

@media (max-width: 767px) {
  .workspace { position: relative; }
  .chat-panel { position: absolute; inset: 0; background: var(--bg); z-index: 1; }
  .preview-panel { position: absolute; inset: 0; background: var(--bg); z-index: 2; width: 100%; transform: translateX(100%); transition: transform 0.3s ease; }
  .preview-panel.mobile-active { transform: translateX(0); }
  .chat-panel.mobile-hidden { z-index: 0; }
  /* Hide desktop-only elements on mobile */
  .desktop-only { display: none !important; }
}

/* Preview empty state */
.preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 40px 32px;
  text-align: center;
  color: var(--text2);
}
.preview-empty-icon {
  width: 72px; height: 72px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
}
.preview-empty p { font-size: 14px; max-width: 280px; line-height: 1.6; }
.preview-empty strong { color: var(--accent); }

/* Chat header */
.chat-header { display:flex; align-items:center; gap:10px; padding:12px 16px; background:var(--bg2); border-bottom:1px solid var(--border); flex-shrink:0; z-index:10; }
.chat-header-info { flex:1; display:flex; align-items:center; gap:10px; min-width: 0; }
.avatar-sm { width:36px; height:36px; background:linear-gradient(135deg,var(--accent),var(--accent2)); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; flex-shrink:0; }
.chat-title { font-weight:700; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.chat-sub { font-size:12px; color:var(--text2); }
.icon-btn { background:var(--bg3); border:1px solid var(--border); color:var(--text); width:36px; height:36px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s; text-decoration:none; }
.icon-btn:hover, .icon-btn.active { border-color:var(--accent); background:rgba(124,92,252,0.1); }
.project-menu-wrap { position: relative; }
.project-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  z-index: 100;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.project-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}
.project-menu button:hover { background: var(--bg3); }
.project-menu button.danger { color: var(--error); }
.project-menu button.danger:hover { background: rgba(239, 68, 68, 0.1); }

/* Mobile video panel */
.video-panel { background:var(--bg2); border-bottom:1px solid var(--border); max-height:260px; overflow-y:auto; flex-shrink:0; }
.video-panel-inner { padding:16px; }
.empty-panel { display:flex; flex-direction:column; align-items:center; gap:10px; padding:12px; color:var(--text2); font-size:14px; text-align:center; }
.panel-header { display:flex; align-items:center; justify-content:space-between; font-weight:600; font-size:14px; margin-bottom:12px; }
.scenes-mini { display:flex; flex-direction:column; gap:8px; }
.scene-mini-card { display:flex; align-items:center; gap:12px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:10px 12px; cursor:pointer; transition:border-color 0.2s; }
.scene-mini-card:hover { border-color:var(--accent); }
.scene-num { width:28px; height:28px; background:var(--accent); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; color:#fff; }
.scene-mini-title { font-size:13px; font-weight:600; }
.scene-mini-status { font-size:11px; color:var(--text2); display:flex; align-items:center; gap:5px; margin-top:2px; }
.status-dot { width:7px; height:7px; border-radius:50%; display:inline-block; background: var(--border); }
.done .status-dot, .status-dot.done { background:var(--success); }
.loading .status-dot, .status-dot.loading { background:var(--warn); animation:pulse 1s infinite; }

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

/* Storyboard toolbar */
.storyboard-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.toolbar-brand { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.toolbar-icon { color: var(--accent); flex-shrink: 0; }
.toolbar-titles { min-width: 0; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ── Video bar ── */
.video-bar { flex-shrink: 0; background: var(--bg2); border-bottom: 1px solid var(--border); }
.video-bar-player { position: relative; }
.video-preview-mini { width: 100%; display: block; max-height: 220px; background: #000; object-fit: contain; }
.video-cloud-badge {
  position: absolute; bottom: 8px; right: 10px;
  background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);
  border: 1px solid rgba(124,92,252,0.4);
  color: rgba(124,92,252,0.95); font-size: 11px; font-weight: 600;
  padding: 3px 8px; border-radius: 20px;
  display: flex; align-items: center; gap: 5px;
}
.video-bar-actions {
  display: flex; gap: 8px; padding: 10px 14px;
  border-top: 1px solid var(--border);
}

/* ── Gallery panel ── */
.gallery-panel {
  flex-shrink: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  max-height: 420px;
  overflow-y: auto;
}
.gallery-panel-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  font-size: 13px; font-weight: 600;
  background: var(--bg2); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 2;
}
.gallery-icon { color: var(--accent); }
.gallery-count { font-size: 11px; color: var(--text2); font-weight: 400; }
.gallery-video-row { padding: 12px 14px 0; }
.gallery-video-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.gallery-video { width: 100%; max-height: 180px; display: block; background: #000; }
.gallery-video-meta {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; gap: 8px;
}
.gallery-video-title { font-size: 13px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 6px;
  padding: 12px 14px;
}
.gallery-img-cell {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg3);
  border: 1px solid var(--border);
  cursor: zoom-in;
  transition: border-color 0.15s;
}
.gallery-img-cell:hover { border-color: var(--accent); }
.gallery-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gallery-img-label {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: rgba(0,0,0,0.65); color: rgba(255,255,255,0.75);
  font-size: 9px; font-weight: 600; text-align: center; padding: 2px;
  letter-spacing: 0.3px;
}
.mt-sm { margin-top: 12px; }

/* Storyboard workspace */
.storyboard-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.filmstrip-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: auto;
  padding: 12px 16px 8px;
  background:
    linear-gradient(90deg, rgba(124, 92, 252, 0.03) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px) 0 0 / 24px 24px,
    #0a0a0c;
}

.filmstrip-ruler {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 4px;
}
.ruler-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.ruler-meta { font-size: 11px; color: var(--text2); }

.filmstrip-track {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding-bottom: 8px;
  min-width: min-content;
}

.storyboard-frame {
  position: relative;
  flex: 0 0 280px;
  width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 2px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
  margin-left: 12px;
}
.storyboard-frame:first-child { margin-left: 0; }
.storyboard-frame:hover { border-color: rgba(124, 92, 252, 0.45); }
.storyboard-frame.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 8px 32px rgba(124, 92, 252, 0.2);
  transform: translateY(-2px);
}
.storyboard-frame.done .frame-viewport { border-bottom-color: rgba(34, 197, 94, 0.35); }

.frame-connector {
  position: absolute;
  left: -12px;
  top: 50%;
  width: 12px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--border));
  transform: translateY(-50%);
}
.frame-connector::after {
  content: '';
  position: absolute;
  right: -3px;
  top: 50%;
  width: 6px;
  height: 6px;
  border: 2px solid var(--border);
  border-radius: 50%;
  transform: translateY(-50%);
  background: var(--bg);
}

.frame-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.frame-num {
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  letter-spacing: 0.05em;
}
.frame-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.frame-status { flex-shrink: 0; }
.frame-status .status-dot { width: 8px; height: 8px; }
.frame-status.done .status-dot { background: var(--success); }
.frame-status.loading .status-dot { background: var(--warn); animation: pulse 1s infinite; }
.frame-status.pending .status-dot { background: var(--border); }

.frame-viewport {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
  overflow: hidden;
  border-bottom: 2px solid var(--border);
}
.frame-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.frame-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text2);
  font-size: 12px;
  background: var(--bg3);
}
.frame-placeholder.clickable { cursor: pointer; transition: background 0.2s, color 0.2s; }
.frame-placeholder.clickable:hover { background: rgba(124, 92, 252, 0.08); color: var(--accent); }
.frame-strip {
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: flex;
  gap: 4px;
  z-index: 2;
}
.frame-thumb {
  width: 36px;
  height: 22px;
  object-fit: cover;
  border-radius: 3px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  opacity: 0.65;
}
.frame-thumb.active {
  border-color: var(--accent);
  opacity: 1;
}
.frame-duration {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 2;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
}

.frame-script-track {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid var(--border);
  min-height: 52px;
}
.track-icon { color: var(--accent2); flex-shrink: 0; margin-top: 2px; opacity: 0.8; }
.frame-narration {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.frame-tags { padding: 6px 10px 8px; display: flex; gap: 6px; }
.scene-tag {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10px;
  color: var(--text2);
  text-transform: capitalize;
}

/* Timeline rail */
.timeline-panel {
  flex-shrink: 0;
  padding: 10px 16px 12px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  position: relative;
}
.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.timeline-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text2);
}
.timeline-total { font-size: 11px; color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
.timeline-track {
  display: flex;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg3);
  border: 1px solid var(--border);
}
.timeline-clip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 40px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(124, 92, 252, 0.12), rgba(124, 92, 252, 0.04));
  cursor: pointer;
  transition: background 0.15s, filter 0.15s;
}
.clip-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
  background: linear-gradient(90deg, transparent, rgba(196, 113, 245, 0.35));
  border-radius: 0 4px 4px 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.timeline-clip:hover .clip-resize-handle,
.timeline-clip.active .clip-resize-handle {
  opacity: 1;
}
.clip-resize-handle:hover {
  background: linear-gradient(90deg, transparent, rgba(196, 113, 245, 0.55));
}
.timeline-clip:last-child { border-right: none; }
.timeline-clip:hover { filter: brightness(1.15); }
.timeline-clip.active {
  background: linear-gradient(180deg, rgba(124, 92, 252, 0.35), rgba(124, 92, 252, 0.15));
  box-shadow: inset 0 -2px 0 var(--accent);
}
.timeline-clip.done { background: linear-gradient(180deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.06)); }
.clip-num { font-size: 11px; font-weight: 800; color: var(--text); }
.clip-dur { font-size: 10px; color: var(--text2); font-variant-numeric: tabular-nums; }

/* Inspector (selected scene detail) */
.inspector-panel {
  flex-shrink: 0;
  max-height: 200px;
  overflow-y: auto;
  padding: 12px 16px 14px;
  background: #111116;
  border-top: 1px solid var(--border);
}
.inspector-duration { margin-bottom: 10px; }
.duration-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.duration-slider {
  flex: 1;
  height: 6px;
  accent-color: var(--accent);
  cursor: pointer;
}
.duration-value {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  min-width: 32px;
  text-align: right;
}
.inspector-prompt-input {
  width: 100%;
  margin-top: 6px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font);
  font-size: 12px;
  line-height: 1.5;
  padding: 10px 12px;
  resize: vertical;
  min-height: 72px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.inspector-prompt-input:focus {
  border-color: var(--accent);
}
.inspector-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.inspector-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  background: rgba(124, 92, 252, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
}
.inspector-head strong { font-size: 13px; }
.inspector-narration { font-size: 12px; line-height: 1.5; color: var(--text2); margin-bottom: 8px; }
.inspector-prompt { border-left: 2px solid var(--border); padding-left: 10px; }
.inspector-frames { margin-top: 12px; border-left: 2px solid var(--accent); padding-left: 10px; }
.frame-prompt-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.frame-prompt-list li { font-size: 11px; color: var(--text2); line-height: 1.4; display: flex; gap: 8px; align-items: flex-start; }
.frame-prompt-num {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--bg3);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scene-prompt-label { font-size: 10px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 3px; display: block; }
.scene-prompt-text { font-size: 11px; color: var(--text2); line-height: 1.45; font-style: italic; }

/* Voice clone widget */
.voice-widget {
  flex-shrink: 0;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.voice-widget-inner { padding: 14px 16px; }
.voice-ready {
  display: flex;
  align-items: center;
  gap: 12px;
}
.voice-ready-icon {
  width: 40px; height: 40px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--success);
  flex-shrink: 0;
}
.voice-ready-label { font-size: 13px; font-weight: 700; color: var(--success); }
.voice-ready-sub { font-size: 11px; color: var(--text2); margin-top: 2px; }
.voice-instructions { font-size: 13px; color: var(--text2); line-height: 1.5; margin-bottom: 12px; }
.voice-instructions strong { color: var(--text); }
.voice-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.recording-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--error);
  font-variant-numeric: tabular-nums;
}
.rec-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--error);
  animation: pulse 1s infinite;
}
.cloning-status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text2); }
.voice-badge { color: var(--success) !important; border-color: rgba(34, 197, 94, 0.35) !important; }
.voice-icon-active { color: var(--success); }

/* Mode badge in toolbar */
.mode-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: 8px;
  vertical-align: middle;
}
.mode-badge.image { background: rgba(124,92,252,0.14); color: var(--accent); }
.mode-badge.video { background: rgba(239,68,68,0.14); color: var(--error); }

/* Video mode: split frame view (first + last image side by side) */
.frame-split {
  width: 100%;
  height: 100%;
  display: flex;
}
.frame-split-half {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.frame-split-half:first-child { border-right: 1px solid rgba(255,255,255,0.1); }
.frame-split-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.frame-split-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.8);
  background: rgba(0,0,0,0.6);
  padding: 3px 0;
}

/* Per-scene action buttons */
.frame-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.18);
  border-top: 1px solid var(--border);
}
.scene-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 8px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text2);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 0;
}
.scene-action-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: rgba(124, 92, 252, 0.08); }
.scene-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.scene-action-btn.accent { border-color: rgba(124, 92, 252, 0.4); color: var(--accent2); }
.scene-action-btn.accent:hover:not(:disabled) { background: rgba(196, 113, 245, 0.12); border-color: var(--accent2); }

/* Scene video modal */
.scene-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(4px);
}
.scene-modal {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
  max-width: 720px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.65);
}
.scene-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.scene-modal-video {
  width: 100%;
  display: block;
  background: #000;
  max-height: 420px;
}
.scene-modal-footer {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

.spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }

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
