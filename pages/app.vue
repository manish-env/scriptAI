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
  /** Three pose/visual beats for paper-flip animation (from script JSON). */
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
})
const messages = ref<Message[]>([])
const videoProject = reactive({ title: '', topic: '', characterDescription: '', scenes: [] as Scene[] })
const userId = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const toast = reactive({ show: false, message: '', type: 'success' })

// ── Computed ───────────────────────────────────────────────────────────────
const canStart = computed(() => profile.name.trim() && profile.niche.trim())
const FRAMES_PER_SCENE = 3
const allImagesReady = computed(() =>
  videoProject.scenes.length > 0
  && videoProject.scenes.every(s => s.frameUrls.length >= FRAMES_PER_SCENE || !!s.imageUrl),
)
const totalDuration = computed(() => videoProject.scenes.reduce((sum, s) => sum + (s.duration || 5), 0))
const selectedSceneIndex = ref(0)
const timelineTrackRef = ref<HTMLElement | null>(null)

const MIN_SCENE_DURATION = 2
const MAX_SCENE_DURATION = 45

function timelineWidth(scene: Scene) {
  const total = totalDuration.value || 1
  return `${((scene.duration || 5) / total) * 100}%`
}

let persistScenesTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersistScenes() {
  if (persistScenesTimer) clearTimeout(persistScenesTimer)
  persistScenesTimer = setTimeout(() => {
    syncScenes(videoProject.scenes.map(s => ({
      title: s.title,
      narration: s.narration,
      imagePrompt: s.framePrompts?.length
        ? JSON.stringify({ imagePrompt: s.imagePrompt, framePrompts: s.framePrompts })
        : s.imagePrompt,
      duration: s.duration,
      mood: s.mood,
    })))
  }, 600)
}

function setSceneDuration(index: number, seconds: number) {
  const scene = videoProject.scenes[index]
  if (!scene) return
  scene.duration = Math.round(Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, seconds)))
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
  scene.duration = Math.round(Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, startDuration + deltaSec)))
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

function syncScenes(scenes: Scene[]) {
  if (!sessionId.value) return
  dbPost(`/api/sessions/${sessionId.value}/scenes`, { scenes })
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

async function persistSceneFrames(scene: Scene) {
  if (!scene.id || !sessionId.value || !scene.frameUrls.length) return
  const keys = scene.frameUrls.map(u => u.replace(/^\/api\/assets\//, ''))
  await dbPatch(`/api/sessions/${sessionId.value}/scenes`, {
    scene_id: scene.id,
    image_key: keys[0],
    frame_keys: JSON.stringify(keys),
  })
}

// ── Load existing session from D1 ──────────────────────────────────────────
async function loadSession(id: string) {
  try {
    const data = await $fetch<DbSession>(`/api/sessions/${id}`)
    if (!data) return false

    videoProject.title = data.title ?? ''
    videoProject.topic = data.topic ?? ''
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
            duration: s.duration,
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
        duration: s.duration,
        mood: s.mood,
        frameUrls: frameUrls.length ? frameUrls : (fallback ? [fallback] : []),
        imageUrl: frameUrls[0] ?? fallback,
        generating: false,
        generatingLabel: null,
      }
    })
    if (videoProject.scenes.length) showVideoPanel.value = true
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
They create personal brand videos WITHOUT showing their face — using illustrated caricature scenes.

VIDEO FORMAT (important):
- Each video has 4-6 scenes.
- Each scene becomes ${FRAMES_PER_SCENE} illustrated images (paper-flip): same character, 3 scene-specific pose beats derived from that scene's story.
- On script creation you write imagePrompt plus framePrompts tailored to each scene's narration (not generic poses).

Your job is to:
1. Chat naturally; understand their message, audience, and story
2. Help them craft a compelling video concept
3. When they have enough info, suggest creating the video
4. Remember: visuals must keep the SAME character look in every scene

Be concise, warm, and actionable. Use markdown when helpful.`

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
    videoProject.characterDescription = scriptJson.characterDescription ?? ''
    profile.characterDescription = videoProject.characterDescription
    videoProject.scenes = scriptJson.scenes.map((s: Scene) => ({
      ...s,
      imageUrl: null,
      frameUrls: [],
      generating: false,
      generatingLabel: null,
    }))
    aiTyping.value = false
    const summary = `🎬 **Video script created!** "${scriptJson.title}"\n\nI've written **${scriptJson.scenes.length} scenes** for your video:\n${scriptJson.scenes.map((s: Scene, i: number) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}\n\nOpen the storyboard and **Generate** — each scene gets **${FRAMES_PER_SCENE} paper-flip frames** (same face, subtle pose changes) for a stop-motion feel. Ready?`
    messages.value.push({ role: 'assistant', content: summary, suggestCreate: false })
    scrollToBottom()
    syncScenes(videoProject.scenes.map(s => ({
      title: s.title,
      narration: s.narration,
      imagePrompt: s.framePrompts?.length
        ? JSON.stringify({ imagePrompt: s.imagePrompt, framePrompts: s.framePrompts })
        : s.imagePrompt,
      duration: s.duration,
      mood: s.mood,
    })))
    syncMessages([{ role: 'assistant', content: summary }])
  } catch (e: unknown) {
    aiTyping.value = false
    showToastMsg((e as Error).message || 'Script generation failed', 'error')
  }
}

async function generateVideoScript() {
  const system = `You are a professional video script writer for illustrated personal-brand videos.
Creator: ${profile.name} (${profile.niche} niche).
Output: short video script, 60-90 seconds total, 4-6 scenes.

ANIMATION MODEL: Each scene becomes exactly ${FRAMES_PER_SCENE} images of the SAME character (paper-flip). The character's face, hair, skin tone, and outfit must match characterDescription in every frame.

IMPORTANT: Respond ONLY with valid JSON (no markdown). Schema:
{
  "title": "Video title",
  "topic": "One sentence topic",
  "characterDescription": "Fixed look for ${profile.name || 'the creator'} used in ALL scenes and frames: face, hair, skin, outfit, caricature art style — never change",
  "scenes": [
    {
      "title": "Scene title",
      "narration": "Voiceover, 2-3 sentences",
      "imagePrompt": "Scene setting, background, props, and what the character is doing — do NOT redefine the face each scene",
      "framePrompts": ["pose/expression for beat 1", "pose/expression for beat 2", "pose/expression for beat 3"],
      "duration": 10,
      "mood": "inspiring"
    }
  ]
}

Rules:
- framePrompts MUST be exactly ${FRAMES_PER_SCENE} strings per scene, written for THAT scene's narration (setup → key moment → payoff). Never use generic copy-paste poses across scenes.
- imagePrompt = shared environment/action; framePrompts = pose, hands, and expression only (no background).
- Do not describe different people across scenes.`

  const msgs = [...buildChatMessages(), { role: 'user', content: 'Based on our conversation, create the video script JSON now. Respond ONLY with the JSON object.' }]
  const raw = await callClaude(msgs, system)
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse video script')
  const script = JSON.parse(match[0]) as { scenes?: Scene[] }
  for (const scene of script.scenes ?? []) {
    if (!hasValidFramePrompts(scene)) {
      scene.framePrompts = await generateFramePromptsForScene(scene)
    }
  }
  return script
}

// ── Frame prompts (AI per scene, no hardcoded poses) ───────────────────────
function hasValidFramePrompts(scene: Scene) {
  return Array.isArray(scene.framePrompts)
    && scene.framePrompts.length === FRAMES_PER_SCENE
    && scene.framePrompts.every(p => typeof p === 'string' && p.trim().length > 0)
}

async function generateFramePromptsForScene(scene: Scene) {
  const system = `You write pose-only cues for a ${FRAMES_PER_SCENE}-frame paper-flip animation of one illustrated video scene.
Respond ONLY with valid JSON: {"framePrompts":["...","...","..."]}
Exactly ${FRAMES_PER_SCENE} strings. Each string: body pose, hand position, and facial expression only — no background, props, or wardrobe.
The three beats must follow this scene's narration (opening → emphasis → closing). Make them specific to the story beat, not generic templates.`

  const raw = await callClaude(
    [{ role: 'user', content: JSON.stringify({
      title: scene.title,
      narration: scene.narration,
      mood: scene.mood,
      imagePrompt: scene.imagePrompt,
    }) }],
    system,
  )
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not generate frame prompts')
  const parsed = JSON.parse(match[0]) as { framePrompts?: unknown }
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

function buildFramePrompt(scene: Scene, poseIndex: number) {
  const char = profile.characterDescription
    || videoProject.characterDescription
    || `caricature of ${profile.name}, ${profile.niche} creator`
  const poseHint = scene.framePrompts?.[poseIndex]?.trim()
  if (!poseHint) throw new Error('Frame prompts missing for this scene')
  return [
    char,
    'Same character as reference image, identical face, hair, skin tone, and outfit.',
    scene.imagePrompt,
    `Pose for frame ${poseIndex + 1} of ${FRAMES_PER_SCENE}: ${poseHint}.`,
    'Paper-cut flat illustration, soft paper texture edge, warm colors, 16:9.',
  ].join(' ')
}

// ── Image Generation (hero + 3 paper-flip frames per scene) ─────────────────

async function ensureHeroCaricature() {
  if (profile.heroBase64) return
  if (!profile.photoBase64 && !profile.photoUrl) return

  showToastMsg('Creating your character…')
  const prompt = [
    `Professional caricature portrait of ${profile.name}, ${profile.niche} expert,`,
    'warm friendly cartoon, front-facing, neutral smile, clean soft background,',
    'paper-cut illustration style, consistent character design, 16:9, high quality',
  ].join(' ')
  const replicateUrl = await callReplicate(prompt, { usePhoto: true, strength: 0.55 })
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
      if (scene.frameUrls.length < FRAMES_PER_SCENE) await generateSceneFrames(i)
    }
    showToastMsg('All scene animations ready!')
  } catch (e: unknown) {
    showToastMsg((e as Error).message || 'Generation failed', 'error')
  } finally {
    generatingAll.value = false
  }
}

async function generateSceneFrames(index: number) {
  const scene = videoProject.scenes[index]
  if (scene.generating || scene.frameUrls.length >= FRAMES_PER_SCENE) return
  scene.generating = true
  scene.frameUrls = []
  scene.imageUrl = null
  try {
    await ensureHeroCaricature()
    if (!profile.heroBase64 && !profile.photoBase64) {
      throw new Error('Upload a photo first so we can lock your character look')
    }
    scene.generatingLabel = 'Planning poses…'
    await ensureSceneFramePrompts(scene)
    for (let fi = 0; fi < FRAMES_PER_SCENE; fi++) {
      scene.generatingLabel = `Frame ${fi + 1}/${FRAMES_PER_SCENE}`
      const replicateUrl = await callReplicate(buildFramePrompt(scene, fi), { strength: 0.38 })
      const { assetUrl } = await uploadAsset(replicateUrl, 'scene_image')
      scene.frameUrls.push(assetUrl)
      scene.imageUrl = scene.frameUrls[0]
    }
    await persistSceneFrames(scene)
    showToastMsg(`Scene ${index + 1}: ${FRAMES_PER_SCENE} frames ready`)
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    scene.generating = false
    scene.generatingLabel = null
  }
}

/** @deprecated use generateSceneFrames */
async function generateSceneImage(index: number) {
  return generateSceneFrames(index)
}

async function callReplicate(prompt: string, opts?: { usePhoto?: boolean; strength?: number }) {
  const fullPrompt = `${prompt}, caricature illustration style, digital art, vibrant colors, warm professional personal brand, high quality`
  const input: Record<string, unknown> = {
    prompt: fullPrompt,
    negative_prompt: 'realistic photo, photography, blurry, low quality, different face, different person, nsfw',
    width: 1280,
    height: 720,
    num_outputs: 1,
    scheduler: 'K_EULER',
    num_inference_steps: 30,
    guidance_scale: 7.5,
  }
  const ref = opts?.usePhoto
    ? profile.photoBase64
    : (profile.heroBase64 || profile.photoBase64)
  const strength = opts?.strength ?? (profile.heroBase64 ? 0.38 : 0.5)
  if (ref) {
    input.image = `data:image/jpeg;base64,${ref}`
    input.strength = strength
  }

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

// ── Video Assembly (cinematic compositor) ───────────────────────────────────
const VIDEO_W = 1280
const VIDEO_H = 720
const VIDEO_FPS = 30
const VIDEO_BITRATE = 10_000_000
const CROSSFADE_FRAMES = 18
const FLIP_TRANSITION_FRAMES = 14
const MOTION_PRESETS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'drift-up'] as const
type MotionPreset = typeof MOTION_PRESETS[number]

async function assembleVideo() {
  if (!allImagesReady.value || renderingVideo.value) return
  renderingVideo.value = true
  showToastMsg('Rendering cinematic video…')
  try {
    const url = await buildVideoFromImages(videoProject.scenes)
    videoUrl.value = url
    showToastMsg('Video ready!')
    nextTick(() => { if (previewContent.value) previewContent.value.scrollTop = 0 })
  } catch (e: unknown) {
    showToastMsg('Assembly failed: ' + (e as Error).message, 'error')
  } finally {
    renderingVideo.value = false
  }
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

async function waitVideoFrame(stream: MediaStream, fps: number) {
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  track?.requestFrame?.()
  await new Promise<void>(r => setTimeout(r, 1000 / fps))
}

function drawPaperBorder(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 3
  ctx.strokeRect(10, 10, W - 20, H - 20)
}

function drawPaperFlipTransition(
  ctx: CanvasRenderingContext2D,
  imgA: HTMLImageElement,
  imgB: HTMLImageElement,
  blend: number,
  W: number,
  H: number,
  motion: MotionPreset,
) {
  ctx.fillStyle = '#f4efe6'
  ctx.fillRect(0, 0, W, H)
  if (blend < 0.5) {
    const t = blend * 2
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(Math.max(0.12, 1 - t * 0.88), 1)
    ctx.translate(-W / 2, -H / 2)
    drawSceneFrame(ctx, imgA, W, H, 1, motion, 0)
    ctx.restore()
  } else {
    const t = (blend - 0.5) * 2
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(Math.min(1, t * 0.88 + 0.12), 1)
    ctx.translate(-W / 2, -H / 2)
    drawSceneFrame(ctx, imgB, W, H, 0, motion, 0)
    ctx.restore()
  }
}

function drawSceneFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  progress: number,
  motion: MotionPreset,
  wiggle = 0,
) {
  ctx.fillStyle = '#050508'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  if (wiggle) {
    ctx.translate(W / 2, H / 2)
    ctx.rotate(wiggle)
    ctx.translate(-W / 2, -H / 2)
  }

  const ir = img.width / img.height
  const cr = W / H
  let dw: number
  let dh: number
  if (ir > cr) {
    dh = H
    dw = H * ir
  } else {
    dw = W
    dh = W / ir
  }

  let zoom0 = 1.02
  let zoom1 = 1.12
  let panX0 = 0
  let panX1 = 0
  let panY0 = 0
  let panY1 = 0

  switch (motion) {
    case 'zoom-out':
      zoom0 = 1.14
      zoom1 = 1.03
      break
    case 'pan-left':
      panX0 = 0
      panX1 = -0.06 * dw
      zoom1 = 1.1
      break
    case 'pan-right':
      panX0 = -0.06 * dw
      panX1 = 0
      zoom1 = 1.1
      break
    case 'drift-up':
      panY0 = 0
      panY1 = -0.04 * dh
      zoom1 = 1.08
      break
    default:
      zoom1 = 1.13
  }

  const zoom = zoom0 + (zoom1 - zoom0) * progress
  const panX = panX0 + (panX1 - panX0) * progress
  const panY = panY0 + (panY1 - panY0) * progress
  const sw = dw * zoom
  const sh = dh * zoom
  const x = (W - sw) / 2 + panX
  const y = (H - sh) / 2 + panY

  ctx.drawImage(img, x, y, sw, sh)
  ctx.restore()
  drawVignette(ctx, W, H)
  drawColorGrade(ctx, W, H)
}

function sceneFrameUrls(scene: Scene): string[] {
  if (scene.frameUrls.length) return scene.frameUrls
  if (scene.imageUrl) return [scene.imageUrl]
  return []
}

async function renderScenePaperFlip(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  imgs: HTMLImageElement[],
  W: number,
  H: number,
  FPS: number,
  totalFrames: number,
  motion: MotionPreset,
  stream: MediaStream,
  startGlobalFrame: number,
) {
  const n = imgs.length
  const flips = FLIP_TRANSITION_FRAMES * Math.max(0, n - 1)
  const holdFrames = Math.max(FPS, Math.floor((totalFrames - flips) / n))
  let globalF = startGlobalFrame

  for (let seg = 0; seg < n; seg++) {
    for (let f = 0; f < holdFrames; f++) {
      const wiggle = Math.sin(f * 0.14 + seg * 1.2) * 0.016
      const progress = easeInOutCubic(f / Math.max(holdFrames - 1, 1)) * 0.25 + 0.4
      drawSceneFrame(ctx, imgs[seg], W, H, progress, motion, wiggle)
      drawPaperBorder(ctx, W, H)
      drawSceneOverlays(ctx, scene, W, H, globalF, totalFrames)
      globalF++
      await waitVideoFrame(stream, FPS)
    }
    if (seg < n - 1) {
      for (let f = 0; f < FLIP_TRANSITION_FRAMES; f++) {
        const blend = easeInOutCubic(f / FLIP_TRANSITION_FRAMES)
        drawPaperFlipTransition(ctx, imgs[seg], imgs[seg + 1], blend, W, H, motion)
        drawPaperBorder(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, globalF, totalFrames)
        globalF++
        await waitVideoFrame(stream, FPS)
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
  const fontSize = Math.round(W * 0.028)
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
  const maxW = W * 0.78
  const lines = wrapText(ctx, text, maxW)
  const lineH = fontSize * 1.38
  const padX = 22
  const padY = 14
  const blockH = lines.length * lineH + padY * 2
  const blockW = Math.min(
    maxW + padX * 2,
    Math.max(...lines.map(l => ctx.measureText(l).width), 0) + padX * 2,
  )
  const blockX = (W - blockW) / 2
  const blockY = H - blockH - H * 0.07

  ctx.save()
  ctx.globalAlpha = easeOutCubic(Math.min(1, reveal)) * 0.96
  ctx.fillStyle = 'rgba(8,8,12,0.72)'
  roundRect(ctx, blockX, blockY, blockW, blockH, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  roundRect(ctx, blockX, blockY, blockW, blockH, 10)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6
  const visibleLines = Math.ceil(lines.length * Math.min(1, reveal * 1.15))
  lines.slice(0, visibleLines).forEach((l, i) => {
    const lineAlpha = Math.min(1, (reveal * lines.length - i) * 1.4)
    ctx.globalAlpha = easeOutCubic(lineAlpha) * 0.96
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

async function buildVideoFromImages(scenes: Scene[]) {
  const W = VIDEO_W
  const H = VIDEO_H
  const FPS = VIDEO_FPS
  const sceneImages = await Promise.all(
    scenes.map(s => Promise.all(sceneFrameUrls(s).map(url => loadImage(url)))),
  )

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const stream = canvas.captureStream(FPS)
  const mimeType = pickVideoMimeType()
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: VIDEO_BITRATE,
    bitsPerSecond: VIDEO_BITRATE,
  } as MediaRecorderOptions)
  recorder.ondataavailable = e => {
    if ((e as BlobEvent).data.size > 0) chunks.push((e as BlobEvent).data)
  }

  const done = new Promise<string>((resolve) => {
    recorder.onstop = () => {
      resolve(URL.createObjectURL(new Blob(chunks, { type: mimeType || 'video/webm' })))
    }
  })

  recorder.start(100)

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si]
    const imgs = sceneImages[si]
    if (!imgs.length) continue
    const motion = MOTION_PRESETS[si % MOTION_PRESETS.length]
    const frames = Math.max(FPS * 2, Math.floor((scene.duration || 5) * FPS))

    if (si > 0 && imgs.length) {
      const prevImgs = sceneImages[si - 1]
      const prevImg = prevImgs[prevImgs.length - 1] ?? imgs[0]
      for (let f = 0; f < CROSSFADE_FRAMES; f++) {
        const blend = easeInOutCubic(f / CROSSFADE_FRAMES)
        const prevMotion = MOTION_PRESETS[(si - 1) % MOTION_PRESETS.length]
        drawSceneFrame(ctx, prevImg, W, H, 1, prevMotion, 0)
        ctx.save()
        ctx.globalAlpha = blend
        drawSceneFrame(ctx, imgs[0], W, H, 0, motion, 0)
        ctx.restore()
        drawPaperBorder(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, f, frames)
        await waitVideoFrame(stream, FPS)
      }
      const paperFrames = frames - CROSSFADE_FRAMES
      if (imgs.length >= FRAMES_PER_SCENE) {
        await renderScenePaperFlip(ctx, scene, imgs, W, H, FPS, paperFrames, motion, stream, CROSSFADE_FRAMES)
      } else {
        for (let f = CROSSFADE_FRAMES; f < frames; f++) {
          const localF = f - CROSSFADE_FRAMES
          const progress = easeInOutCubic(localF / Math.max(frames - CROSSFADE_FRAMES - 1, 1))
          const wiggle = Math.sin(f * 0.12) * 0.012
          drawSceneFrame(ctx, imgs[0], W, H, progress, motion, wiggle)
          drawPaperBorder(ctx, W, H)
          drawSceneOverlays(ctx, scene, W, H, f, frames)
          await waitVideoFrame(stream, FPS)
        }
      }
    } else if (imgs.length >= FRAMES_PER_SCENE) {
      await renderScenePaperFlip(ctx, scene, imgs, W, H, FPS, frames, motion, stream, 0)
    } else {
      for (let f = 0; f < frames; f++) {
        const progress = easeInOutCubic(f / Math.max(frames - 1, 1))
        const wiggle = Math.sin(f * 0.12) * 0.012
        drawSceneFrame(ctx, imgs[0], W, H, progress, motion, wiggle)
        drawPaperBorder(ctx, W, H)
        drawSceneOverlays(ctx, scene, W, H, f, frames)
        await waitVideoFrame(stream, FPS)
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

// ── Init ───────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', closeProjectMenu)
  const uid = localStorage.getItem('bm_user_id')
  const activeSession = localStorage.getItem('bm_active_session')

  if (!uid) return // stay on onboard

  userId.value = uid

  // Load user profile from D1
  const user = await $fetch<{ id: string; name: string; niche: string; photo_key: string | null; hero_key?: string | null } | null>(
    `/api/user?id=${uid}`
  ).catch(() => null)

  if (user?.name) {
    profile.name = user.name
    profile.niche = user.niche ?? ''
    if (user.photo_key) profile.photoUrl = `/api/assets/${user.photo_key}`
    if (user.hero_key) {
      profile.heroUrl = `/api/assets/${user.hero_key}`
      try { profile.heroBase64 = await assetUrlToBase64(profile.heroUrl) } catch { /* lazy load */ }
    }
  }

  if (route.query.setup === 'profile') {
    navigateTo('/profile')
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

  // If profile exists, skip onboard and start a fresh chat
  if (user?.name && user?.niche) {
    screen.value = 'chat'
    const greeting = `Welcome back, ${user.name}! Ready to create another brand video? Tell me about your next idea!`
    messages.value = [{ role: 'assistant', content: greeting, suggestCreate: false }]
    await ensureSession()
  }
})
</script>

<template>
  <div class="app-shell" :class="{ 'has-scenes': videoProject.scenes.length > 0 && screen !== 'onboard' }">

    <!-- ── ONBOARD ── -->
    <div v-if="screen === 'onboard'" class="screen onboard-screen">
      <div class="onboard-hero">
        <NuxtLink to="/profile" class="back-link">
          <Icon name="lucide:arrow-left" size="14" /> Profile
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
          <Icon name="lucide:sparkles" size="16" /> Start Creating
        </button>
      </div>
    </div>

    <!-- ── CHAT + PREVIEW (desktop split layout) ── -->
    <div v-if="screen === 'chat' || screen === 'preview'" class="workspace">

      <!-- LEFT: Chat panel -->
      <div class="chat-panel" :class="{ 'mobile-hidden': screen === 'preview' }">
        <header class="chat-header">
          <NuxtLink to="/projects" class="icon-btn" title="All projects"><Icon name="lucide:arrow-left" size="18" /></NuxtLink>
          <div class="chat-header-info">
            <div class="avatar-sm">{{ profile.name[0] }}</div>
            <div>
              <div class="chat-title">{{ videoProject.title || 'Brand Video Chat' }}</div>
              <div class="chat-sub">AI Video Strategist</div>
            </div>
          </div>
          <button class="icon-btn" title="New video" @click="clearSession"><Icon name="lucide:plus" size="18" /></button>
          <div v-if="sessionId" class="project-menu-wrap">
            <button class="icon-btn" title="Project options" @click.stop="showProjectMenu = !showProjectMenu">
              <Icon name="lucide:more-vertical" size="18" />
            </button>
            <div v-if="showProjectMenu" class="project-menu" @click.stop>
              <button type="button" @click="clearProjectMedia">
                <Icon name="lucide:image-off" size="16" /> Clear images & video
              </button>
              <button type="button" class="danger" @click="deleteProject">
                <Icon name="lucide:trash-2" size="16" /> Delete project
              </button>
            </div>
          </div>
          <NuxtLink to="/profile" class="icon-btn desktop-only" title="Profile"><Icon name="lucide:user" size="18" /></NuxtLink>
          <button class="icon-btn mobile-only" :class="{ active: showVideoPanel }" @click="showVideoPanel = !showVideoPanel">
            <Icon name="lucide:video" size="18" />
          </button>
        </header>

        <!-- Mobile video panel -->
        <Transition name="slide-down">
          <div v-if="showVideoPanel && screen === 'chat'" class="video-panel mobile-only">
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
                        <span class="status-dot" :class="s.frameUrls.length >= FRAMES_PER_SCENE ? 'done' : s.generating ? 'loading' : 'pending'" />
                        {{ s.frameUrls.length >= FRAMES_PER_SCENE ? 'Ready' : s.generating ? 'Generating…' : 'Pending' }}
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

      <!-- RIGHT: Storyboard / video editor panel -->
      <div class="preview-panel" :class="{ 'mobile-active': screen === 'preview' }">
        <header class="storyboard-toolbar">
          <button class="icon-btn mobile-only" @click="screen = 'chat'"><Icon name="lucide:arrow-left" size="18" /></button>
          <div class="toolbar-brand">
            <Icon name="lucide:clapperboard" size="18" class="toolbar-icon" />
            <div class="toolbar-titles">
              <div class="chat-title">{{ videoProject.title || 'Storyboard' }}</div>
              <div class="chat-sub">
                {{ videoProject.scenes.length }} scenes · {{ totalDuration }}s total
              </div>
            </div>
          </div>
          <div class="toolbar-actions">
            <button
              v-if="!allImagesReady && videoProject.scenes.length"
              class="btn btn-sm btn-outline"
              :disabled="generatingAll"
              @click="generateAllImages"
            >
              <Icon name="lucide:sparkles" size="14" />
              {{ generatingAll ? 'Generating…' : `Generate all (${FRAMES_PER_SCENE} frames each)` }}
            </button>
            <button v-if="allImagesReady && !videoUrl" class="btn btn-sm btn-primary" :disabled="renderingVideo" @click="assembleVideo">
              <Icon :name="renderingVideo ? 'lucide:loader' : 'lucide:film'" size="14" :class="{ spin: renderingVideo }" />
              {{ renderingVideo ? 'Rendering…' : 'Render' }}
            </button>
          </div>
        </header>

        <div v-if="videoUrl" class="download-bar">
          <video :src="videoUrl" controls class="video-preview-mini" />
          <a :href="videoUrl" download="brand-video.webm" class="btn btn-primary btn-full mt-sm">
            <Icon name="lucide:download" size="16" /> Download Video
          </a>
        </div>

        <div v-if="!videoProject.scenes.length" class="preview-empty">
          <div class="preview-empty-icon"><Icon name="lucide:film" size="36" /></div>
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
                :class="{ active: selectedSceneIndex === i, done: scene.frameUrls.length >= FRAMES_PER_SCENE, loading: scene.generating }"
                @click="selectedSceneIndex = i"
              >
                <div class="frame-connector" v-if="i > 0" />
                <div class="frame-head">
                  <span class="frame-num">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="frame-title">{{ scene.title }}</span>
                  <span class="frame-status" :class="scene.frameUrls.length >= FRAMES_PER_SCENE ? 'done' : scene.generating ? 'loading' : 'pending'">
                    <span class="status-dot" />
                  </span>
                </div>
                <div
                  class="frame-viewport"
                  @click.stop="scene.frameUrls.length < FRAMES_PER_SCENE && !scene.generating && generateSceneFrames(i)"
                >
                  <template v-if="scene.frameUrls.length">
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
                    <span>{{ scene.generatingLabel || 'Creating frames…' }}</span>
                  </div>
                  <div v-else class="frame-placeholder clickable">
                    <Icon name="lucide:layers" size="26" />
                    <span>Generate {{ FRAMES_PER_SCENE }} frames</span>
                  </div>
                  <span class="frame-duration">{{ scene.duration }}s · {{ scene.frameUrls.length || 0 }}/{{ FRAMES_PER_SCENE }}</span>
                </div>
                <div class="frame-script-track">
                  <Icon name="lucide:mic" size="12" class="track-icon" />
                  <p class="frame-narration">{{ scene.narration }}</p>
                </div>
                <div class="frame-tags">
                  <span class="scene-tag">{{ scene.mood }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="timeline-panel">
            <div class="timeline-header">
              <span class="timeline-label"><Icon name="lucide:timer" size="13" /> Timeline</span>
              <span class="timeline-total">{{ totalDuration }}s</span>
            </div>
            <div ref="timelineTrackRef" class="timeline-track">
              <div
                v-for="(scene, i) in videoProject.scenes"
                :key="'tl-' + i"
                class="timeline-clip"
                :style="{ flex: `0 0 ${timelineWidth(scene)}` }"
                :class="{ active: selectedSceneIndex === i, done: scene.frameUrls.length >= FRAMES_PER_SCENE }"
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
              <label class="scene-prompt-label">Visual prompt</label>
              <textarea
                v-model="videoProject.scenes[selectedSceneIndex].imagePrompt"
                class="inspector-prompt-input"
                rows="3"
                placeholder="Describe the illustration for this scene…"
                @input="onSceneVisualPromptInput(selectedSceneIndex)"
              />
            </div>
            <div v-if="videoProject.scenes[selectedSceneIndex].framePrompts?.length" class="inspector-frames">
              <label class="scene-prompt-label">Frame poses (AI)</label>
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

.download-bar { flex-shrink: 0; padding: 12px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.video-preview-mini { width: 100%; border-radius: var(--radius-sm); display: block; max-height: 200px; background: #000; }
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
