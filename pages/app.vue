<script setup lang="ts">
import {
  REPLICATE_MODELS, imageDataUri, pickPollOutput,
  buildHeroPrompt, buildSceneEstablishPromptKontext, buildPoseEditPrompt,
} from '~/utils/imageGeneration'

useHead({ title: 'BrandMe AI — Personal Brand Video' })

const showProjectMenu = ref(false)

// ── Types ───────────────────────────────────────────────────────────────────
interface Scene {
  id?: string
  title: string
  narration: string
  imagePrompt: string
  duration: number
  mood: string
  frameUrls: string[]       // [0] = opening, [1] = ending
  audioUrl: string | null   // TTS narration audio
  videoUrl: string | null   // lip-synced video clip
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
  frame_keys?: string | null; video_key?: string | null; audio_key?: string | null
}

interface DbSession {
  id: string; title: string | null; topic: string | null
  messages: { id: string; role: string; content: string }[]
  scenes: DbScene[]
}

interface VideoScriptJson {
  title?: string; topic?: string; characterDescription?: string; scenes?: Scene[]
}

// ── LLM JSON helpers ─────────────────────────────────────────────────────────
function parseJsonFromLlm(raw: string): VideoScriptJson {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  if (start < 0) throw new Error('No JSON object found in response')
  let depth = 0; let inStr = false; let esc = false; let end = -1
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new SyntaxError('Incomplete JSON. Try again.')
  return JSON.parse(text.slice(start, end + 1)) as VideoScriptJson
}

function looksLikeScript(text: string) {
  return (text.trim().startsWith('{') || text.includes('"scenes"')) && /"scenes"\s*:/.test(text)
}

function formatScriptPreview(script: VideoScriptJson) {
  const scenes = script.scenes ?? []
  return [
    `**Script ready** — "${script.title || 'Your video'}"`,
    '',
    scenes.map((s, i) => `${i + 1}. **${s.title}** — ${(s.narration || '').slice(0, 80)}…`).join('\n') || '_No scenes._',
    '',
    'Tap **Create Script** to load it into the editor.',
  ].join('\n')
}

function sanitizeChatReply(text: string) {
  if (!looksLikeScript(text)) return text
  try { return formatScriptPreview(parseJsonFromLlm(text)) } catch {
    return text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '\n_Script hidden — tap **Create Script**._\n')
  }
}

function displayChatContent(msg: Message) {
  return msg.role !== 'assistant' ? msg.content : sanitizeChatReply(msg.content)
}

function stripForContext(text: string) {
  if (!looksLikeScript(text)) return text
  try { return formatScriptPreview(parseJsonFromLlm(text)) } catch { return '[Script draft omitted]' }
}

function buildContextMessages() {
  return messages.value.map(m => ({ role: m.role, content: m.role === 'assistant' ? stripForContext(m.content) : m.content }))
}

function findScriptInChat(): VideoScriptJson | null {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.role !== 'assistant' || !looksLikeScript(m.content)) continue
    try { const s = parseJsonFromLlm(m.content); if (s.scenes?.length) return s } catch { /* try older */ }
  }
  return null
}

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_DUR = 3; const MAX_DUR = 15

const VIDEO_TYPE_CONFIG: Record<string, { label: string; persona: string; firstQuestion: string }> = {
  'story-telling':    { label: 'Story Telling',     persona: 'storytelling creator',    firstQuestion: '**What story do you want to tell?** Who is the main character and what transformation do they go through?' },
  'short-movie':      { label: 'Short Movie',        persona: 'short film director',      firstQuestion: '**What is the premise?** Describe the conflict and what you want viewers to feel.' },
  'promotional':      { label: 'Promotional Video',  persona: 'brand strategist',         firstQuestion: '**What are you promoting?** Tell me about it and your target audience.' },
  'personal-branding':{ label: 'Personal Branding',  persona: 'personal brand consultant',firstQuestion: '**What do you want to be known for?** Describe your expertise and target audience.' },
  'educational':      { label: 'Educational Video',  persona: 'educational creator',      firstQuestion: '**What will you teach?** Who is your audience and what should they do after watching?' },
}

// ── State ────────────────────────────────────────────────────────────────────
const appLoading = ref(true)
const aiTyping = ref(false)
const inputText = ref('')
const messagesWrap = ref<HTMLElement | null>(null)
const chatInputEl = ref<HTMLTextAreaElement | null>(null)
const toast = reactive({ show: false, message: '', type: 'success' })
const previewModal = ref<{ url: string; type: 'image' | 'video'; title: string } | null>(null)

const profile = reactive({
  name: '', niche: '',
  photoUrl: null as string | null,
  photoBase64: null as string | null,
  heroBase64: null as string | null,
  heroUrl: null as string | null,
  characterDescription: '',
  elevenVoiceId: null as string | null,
})

// Voice clone
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
const generatingAll = ref(false)

const hasScript = computed(() => videoProject.scenes.length > 0)
const totalDuration = computed(() => videoProject.scenes.reduce((s, sc) => s + (sc.duration || 5), 0))
const allVideosReady = computed(() => hasScript.value && videoProject.scenes.every(s => !!s.videoUrl))

// ── API helpers ──────────────────────────────────────────────────────────────
function clampDur(n: number) { return Math.round(Math.max(MIN_DUR, Math.min(MAX_DUR, n || 5))) }

async function dbPost(path: string, body: unknown) { return $fetch(path, { method: 'POST', body }) }
async function dbPatch(path: string, body: unknown) { return $fetch(path, { method: 'PATCH', body }) }

async function ensureUser() {
  if (!userId.value) return
  await dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche })
}
async function ensureSession() {
  if (sessionId.value) return
  const d = await dbPost('/api/sessions', { user_id: userId.value, title: projectSetup.projectTitle || null, topic: projectSetup.projectPurpose || null }) as { id: string }
  sessionId.value = d.id
}
function syncMessages(msgs: { role: string; content: string }[]) {
  if (!sessionId.value) return
  $fetch(`/api/sessions/${sessionId.value}/messages`, { method: 'POST', body: { messages: msgs } }).catch(() => {})
}
async function syncScenes(scenes: object[]) {
  if (!sessionId.value) return
  return $fetch(`/api/sessions/${sessionId.value}/scenes`, { method: 'POST', body: { scenes } })
}
async function uploadAsset(remoteUrl: string, type: 'hero' | 'scene_image' | 'photo' | 'video') {
  if (!userId.value) return { assetUrl: remoteUrl, key: null as string | null }
  try {
    const res = await $fetch<{ assetUrl: string; key: string | null }>('/api/upload', {
      method: 'POST', body: { url: remoteUrl, type, user_id: userId.value, session_id: sessionId.value },
    })
    if (res.assetUrl) return res
  } catch { /* fall through */ }
  return { assetUrl: remoteUrl, key: null }
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
function absUrl(url: string) {
  return url.startsWith('http') ? url : `${window.location.origin}${url}`
}
function parseFrameKeys(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const k = JSON.parse(raw) as string[]; return Array.isArray(k) ? k.map(x => `/api/assets/${x}`) : [] } catch { return [] }
}
async function persistSceneMedia(sceneIdx: number) {
  if (!sessionId.value) return
  const s = videoProject.scenes[sceneIdx]
  const keys = s.frameUrls.filter(u => u.startsWith('/api/assets/')).map(u => u.replace(/^\/api\/assets\//, ''))
  if (!keys.length) return
  await dbPatch(`/api/sessions/${sessionId.value}/scenes`, {
    position: sceneIdx, image_key: keys[0], frame_keys: JSON.stringify(keys),
  })
}
async function persistSceneVideo(sceneIdx: number, videoKey: string) {
  if (!sessionId.value) return
  await dbPatch(`/api/sessions/${sessionId.value}/scenes`, { position: sceneIdx, video_key: videoKey })
}

// ── Load session ──────────────────────────────────────────────────────────────
async function loadSession(id: string) {
  try {
    const data = await $fetch<DbSession>(`/api/sessions/${id}`)
    if (!data) return false
    videoProject.title = data.title ?? ''
    videoProject.topic = data.topic ?? ''
    if (data.title) projectSetup.projectTitle = data.title
    if (data.topic) projectSetup.projectPurpose = data.topic
    messages.value = data.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content, suggestCreate: false }))
    videoProject.scenes = data.scenes.map((s) => {
      const frameUrls = parseFrameKeys((s as DbScene).frame_keys)
      let ip = s.image_prompt
      try { const p = JSON.parse(ip); if (p?.imagePrompt) ip = p.imagePrompt } catch { /* plain */ }
      const vk = (s as DbScene).video_key
      return {
        id: s.id, title: s.title, narration: s.narration, imagePrompt: ip,
        duration: clampDur(s.duration), mood: s.mood,
        frameUrls: frameUrls.length ? frameUrls : (s.image_key ? [`/api/assets/${s.image_key}`] : []),
        audioUrl: null,
        videoUrl: vk ? `/api/assets/${vk}` : null,
        generating: false, generatingLabel: null,
      }
    })
    return true
  } catch { localStorage.removeItem('bm_active_session'); return false }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || aiTyping.value) return
  inputText.value = ''; resetTextarea()
  messages.value.push({ role: 'user', content: text, suggestCreate: false })
  syncMessages([{ role: 'user', content: text }])
  scrollToBottom(); aiTyping.value = true
  try {
    const reply = await callClaude(buildContextMessages())
    const suggestCreate = /\bcreate\b.*\bscript\b|\bscript\b.*\bready\b|\bshall i\b.*\bcreate\b/i.test(reply)
    messages.value.push({ role: 'assistant', content: reply, suggestCreate })
    syncMessages([{ role: 'assistant', content: reply }])
    scrollToBottom()
  } catch (e: unknown) {
    showToastMsg((e as Error).message || 'AI error', 'error')
  } finally { aiTyping.value = false }
}

async function callClaude(msgs: { role: string; content: string }[], systemOverride?: string, opts?: { max_tokens?: number }) {
  const cfg = projectSetup.videoType ? VIDEO_TYPE_CONFIG[projectSetup.videoType] : null
  const activeTitle = videoProject.title || projectSetup.projectTitle
  const activeTopic = videoProject.topic || projectSetup.projectPurpose
  const sceneCtx = videoProject.scenes.length
    ? `\nCURRENT SCRIPT (${videoProject.scenes.length} scenes):\n${videoProject.scenes.map((s, i) => `  ${i + 1}. "${s.title}": ${s.narration.slice(0, 100)}`).join('\n')}`
    : ''
  const system = systemOverride || [
    cfg ? `You are an expert ${cfg.persona} creating personal brand video content.` : `You are an expert personal brand video strategist.`,
    [activeTitle && `Project: "${activeTitle}"`, activeTopic && `Goal: ${activeTopic}`, cfg && `Type: ${cfg.label}`].filter(Boolean).join(' | '),
    `\nWork ONLY on this project.${sceneCtx}\n\nYOUR ROLE:\n1. Ask ONE focused question at a time\n2. Guide toward a compelling narrative\n3. After 3-5 exchanges, suggest "Create Script"\n4. Never output raw JSON. Be concise.`,
  ].join('\n')
  const data = await $fetch<{ content: { text: string }[] }>('/api/chat', {
    method: 'POST', body: { model: 'claude-sonnet-4-6', max_tokens: opts?.max_tokens ?? 1500, system, messages: msgs },
  })
  return data.content[0].text
}

// ── Script generation ─────────────────────────────────────────────────────────
async function triggerVideoCreation() {
  aiTyping.value = true; scrollToBottom()
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
  videoProject.title = scriptJson.title ?? 'Untitled'
  videoProject.topic = scriptJson.topic ?? ''
  videoProject.characterDescription = scriptJson.characterDescription ?? ''
  profile.characterDescription = videoProject.characterDescription
  videoProject.scenes = scriptJson.scenes.map(s => ({
    title: s.title, narration: s.narration, imagePrompt: s.imagePrompt,
    duration: clampDur(s.duration), mood: s.mood,
    frameUrls: [], audioUrl: null, videoUrl: null, generating: false, generatingLabel: null,
  }))
  aiTyping.value = false
  const summary = `**Script created!** "${scriptJson.title}"\n\n${scriptJson.scenes.map((s, i) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}\n\nOpen the **Video Editor** to generate images and lip-synced video.`
  messages.value.push({ role: 'assistant', content: summary, suggestCreate: false })
  scrollToBottom()
  await syncScenes(videoProject.scenes.map(s => ({
    title: s.title, narration: s.narration, imagePrompt: s.imagePrompt, duration: s.duration, mood: s.mood, image_key: null, frame_keys: null,
  })))
  syncMessages([{ role: 'assistant', content: summary }])
}

async function generateVideoScript() {
  const fromChat = findScriptInChat()
  if (fromChat) { fromChat.scenes = fromChat.scenes?.map(s => ({ ...s, duration: clampDur(s.duration), frameUrls: [], audioUrl: null, videoUrl: null, generating: false, generatingLabel: null })); return fromChat }
  const cfg = VIDEO_TYPE_CONFIG[projectSetup.videoType]
  const system = `You are a professional video script writer for illustrated personal brand videos.
${projectSetup.projectTitle ? `Project: "${projectSetup.projectTitle}"` : ''}${cfg ? `\nType: ${cfg.label}` : ''}${projectSetup.projectPurpose ? `\nGoal: ${projectSetup.projectPurpose}` : ''}
Write ONLY for this project. 4–8 scenes, ${MIN_DUR}–${MAX_DUR}s each.

RESPOND ONLY with valid JSON:
{
  "title": "Video title",
  "topic": "One sentence topic",
  "characterDescription": "Exact character appearance: face features, hair, skin tone, outfit",
  "scenes": [{"title":"","narration":"voiceover text","imagePrompt":"unique location/setting","duration":5,"mood":"inspiring"}]
}
Rules: every scene must have a different location in imagePrompt.`
  const raw = await callClaude(buildContextMessages(), system, { max_tokens: 3000 })
  return parseJsonFromLlm(raw)
}

// ── Image generation ──────────────────────────────────────────────────────────
function requirePhoto() {
  if (!profile.photoBase64) throw new Error('Upload your photo in Profile first — it\'s used to generate your character.')
  return profile.photoBase64
}

function characterDesc() {
  return profile.characterDescription || videoProject.characterDescription
    || `${profile.name}, personal brand creator, semi-realistic digital illustration style`
}

async function ensureHero() {
  if (profile.heroBase64) return
  const photo = requirePhoto()
  showToastMsg('Generating your character illustration…')
  const id = await startPrediction({ model: REPLICATE_MODELS.kontext, input: { prompt: buildHeroPrompt(profile.name, profile.niche, characterDesc()), input_image: imageDataUri(photo, 'image/jpeg'), aspect_ratio: '9:16', output_format: 'png', safety_tolerance: 2 } })
  const url = await pollPrediction(id, 90)
  const { assetUrl, key } = await uploadAsset(url, 'hero')
  profile.heroUrl = assetUrl; profile.heroBase64 = await assetUrlToBase64(assetUrl)
  if (key && userId.value) await dbPatch('/api/user', { id: userId.value, hero_key: key })
}

async function generateSceneImages(index: number) {
  const scene = videoProject.scenes[index]
  if (!scene || scene.generating) return
  scene.generating = true; scene.frameUrls = []; scene.audioUrl = null; scene.videoUrl = null
  try {
    requirePhoto()
    await ensureHero()
    const charDesc = characterDesc()
    const refB64 = profile.heroBase64!

    scene.generatingLabel = 'Opening shot…'
    const id1 = await startPrediction({ model: REPLICATE_MODELS.kontext, input: {
      prompt: buildSceneEstablishPromptKontext(scene.imagePrompt, charDesc, 'standing confidently, looking into camera with a warm engaging expression', scene.mood),
      input_image: imageDataUri(refB64, 'image/jpeg'), aspect_ratio: '9:16', output_format: 'png', safety_tolerance: 2,
    } })
    const url1 = await pollPrediction(id1, 90)
    const { assetUrl: a1 } = await uploadAsset(url1, 'scene_image')
    scene.frameUrls.push(a1)

    scene.generatingLabel = 'Ending pose…'
    const refBase64Img = await assetUrlToBase64(a1)
    const id2 = await startPrediction({ model: REPLICATE_MODELS.kontext, input: {
      prompt: buildPoseEditPrompt('gesturing expressively toward the viewer, slightly leaning forward, animated and passionate expression'),
      input_image: imageDataUri(refBase64Img), aspect_ratio: '9:16', output_format: 'png', safety_tolerance: 2,
    } })
    const url2 = await pollPrediction(id2, 90)
    const { assetUrl: a2 } = await uploadAsset(url2, 'scene_image')
    scene.frameUrls.push(a2)

    await persistSceneMedia(index)
    showToastMsg(`Scene ${index + 1}: images ready`)
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    scene.generating = false; scene.generatingLabel = null
  }
}

// ── Audio generation ──────────────────────────────────────────────────────────
async function generateSceneAudio(index: number): Promise<string> {
  const scene = videoProject.scenes[index]
  if (scene.audioUrl) return scene.audioUrl

  scene.generatingLabel = 'Generating voice…'

  // ElevenLabs (cloned voice)
  if (profile.elevenVoiceId && userId.value) {
    const res = await $fetch<{ audioUrl: string }>('/api/voice/tts', {
      method: 'POST', body: { text: scene.narration, voice_id: profile.elevenVoiceId, user_id: userId.value },
    })
    scene.audioUrl = res.audioUrl
    return res.audioUrl
  }

  // Replicate TTS fallback
  const predRes = await $fetch<{ id: string }>('/api/tts', { method: 'POST', body: { text: scene.narration } })
  const audioUrl = await pollPrediction(predRes.id, 60, '/api/tts/')
  scene.audioUrl = audioUrl
  return audioUrl
}

// ── Lip sync (SadTalker) ──────────────────────────────────────────────────────
async function generateSceneVideo(index: number) {
  const scene = videoProject.scenes[index]
  if (!scene || scene.generating) return
  if (!scene.frameUrls.length) { showToastMsg('Generate images for this scene first', 'error'); return }

  // Show existing video
  if (scene.videoUrl) { previewModal.value = { url: scene.videoUrl, type: 'video', title: scene.title }; return }

  scene.generating = true
  try {
    const audioUrl = await generateSceneAudio(index)
    scene.generatingLabel = 'Lip sync…'

    const imageUrl = absUrl(scene.frameUrls[0])
    const absAudioUrl = absUrl(audioUrl)

    const id = await startPrediction({
      model: REPLICATE_MODELS.lipSync,
      input: {
        source_image: imageUrl,
        driven_audio: absAudioUrl,
        preprocess: 'full',
        still: true,
        use_enhancer: false,
        size: 256,
        pose_style: 0,
        batch_size: 2,
      },
    })
    const videoUrl = await pollPrediction(id, 300)
    const { assetUrl, key } = await uploadAsset(videoUrl, 'video')
    scene.videoUrl = assetUrl
    if (key) await persistSceneVideo(index, key)
    previewModal.value = { url: assetUrl, type: 'video', title: scene.title }
    showToastMsg(`Scene ${index + 1}: video ready!`)
  } catch (e: unknown) {
    showToastMsg(`Scene ${index + 1}: ${(e as Error).message}`, 'error')
  } finally {
    scene.generating = false; scene.generatingLabel = null
  }
}

async function generateAllScenes() {
  if (generatingAll.value) return
  generatingAll.value = true
  try {
    for (let i = 0; i < videoProject.scenes.length; i++) {
      if (!videoProject.scenes[i].frameUrls.length) await generateSceneImages(i)
    }
    for (let i = 0; i < videoProject.scenes.length; i++) {
      if (!videoProject.scenes[i].videoUrl) await generateSceneVideo(i)
    }
    showToastMsg('All scenes generated!')
  } catch (e: unknown) {
    showToastMsg((e as Error).message, 'error')
  } finally { generatingAll.value = false }
}

// ── Replicate helpers ─────────────────────────────────────────────────────────
async function startPrediction(body: { model?: string; version?: string; input: Record<string, unknown> }) {
  const res = await $fetch<{ id: string }>('/api/image', { method: 'POST', body })
  return res.id
}

async function pollPrediction(id: string, maxTries = 90, basePath = '/api/image/') {
  for (let i = 0; i < maxTries; i++) {
    await sleep(2000)
    const data = await $fetch<{ status: string; output: string | string[]; error?: string }>(`${basePath}${id}`)
    if (data.status === 'succeeded') return pickPollOutput(data.output)
    if (data.status === 'failed') throw new Error(data.error || 'Generation failed')
  }
  throw new Error('Timed out')
}

// ── Voice cloning ─────────────────────────────────────────────────────────────
async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorderRef = new MediaRecorder(stream); audioChunks = []
    mediaRecorderRef.ondataavailable = e => audioChunks.push(e.data)
    mediaRecorderRef.start(250); isRecording.value = true; recordingSeconds.value = 0
    recordingTimer = setInterval(() => { recordingSeconds.value++ }, 1000)
  } catch { showToastMsg('Microphone access denied', 'error') }
}
async function stopVoiceRecording() {
  if (!mediaRecorderRef) return
  clearInterval(recordingTimer!); mediaRecorderRef.stream.getTracks().forEach(t => t.stop())
  mediaRecorderRef.stop()
  mediaRecorderRef.onstop = async () => {
    isRecording.value = false
    await submitVoiceSample(new Blob(audioChunks, { type: 'audio/webm' }))
  }
}
async function submitVoiceSample(blob: Blob) {
  cloningVoice.value = true
  try {
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob) })
    const data = await $fetch<{ voice_id: string }>('/api/voice/clone', { method: 'POST', body: { audio_base64: b64, user_id: userId.value, name: profile.name || 'My Voice' } })
    profile.elevenVoiceId = data.voice_id
    if (userId.value) await dbPatch('/api/user', { id: userId.value, eleven_voice_id: data.voice_id })
    showToastMsg('Voice cloned!')
  } catch { showToastMsg('Voice cloning failed', 'error') } finally { cloningVoice.value = false }
}
async function deleteClonedVoice() {
  if (!profile.elevenVoiceId || !userId.value) return
  try {
    await $fetch('/api/voice/clone', { method: 'DELETE', body: { voice_id: profile.elevenVoiceId, user_id: userId.value } })
    profile.elevenVoiceId = null
  } catch { showToastMsg('Could not remove voice', 'error') }
}

// ── Session management ────────────────────────────────────────────────────────
async function deleteProject() {
  if (!sessionId.value || !confirm('Delete this project permanently?')) return
  try {
    await $fetch(`/api/sessions/${sessionId.value}/delete`, { method: 'POST' }).catch(() =>
      $fetch(`/api/sessions/${sessionId.value}`, { method: 'DELETE' }))
    localStorage.removeItem('bm_active_session'); navigateTo('/projects')
  } catch (e: unknown) { showToastMsg((e as { message?: string }).message || 'Error', 'error') }
}
function clearSession() { localStorage.removeItem('bm_active_session'); navigateTo('/projects') }

// ── New project start ─────────────────────────────────────────────────────────
async function startNewProjectChat() {
  const stored = localStorage.getItem('bm_new_project')
  if (!stored) return false
  localStorage.removeItem('bm_new_project')
  try {
    const setup = JSON.parse(stored)
    projectSetup.videoType = setup.videoType ?? ''; projectSetup.projectTitle = setup.title ?? ''; projectSetup.projectPurpose = setup.purpose ?? ''
  } catch { return false }
  await ensureUser(); await ensureSession()
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
function scrollToBottom() { nextTick(() => { if (messagesWrap.value) messagesWrap.value.scrollTop = messagesWrap.value.scrollHeight }) }
function autoResize(e: Event) { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` }
function resetTextarea() { if (chatInputEl.value) chatInputEl.value.style.height = 'auto' }
function showToastMsg(message: string, type = 'success') { toast.message = message; toast.type = type; toast.show = true; setTimeout(() => { toast.show = false }, 3500) }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function renderMd(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#+\s+(.+)$/gm, '<strong>$1</strong>').replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^-\s+(.+)$/gm, '<li>$1</li>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')
}
function moodColor(mood: string) {
  const m: Record<string, string> = { inspiring: '#7c5cfc', energetic: '#f59e0b', calm: '#10b981', professional: '#3b82f6', emotional: '#ec4899', bold: '#ef4444', exciting: '#f97316', confident: '#8b5cf6' }
  return m[mood?.toLowerCase()] ?? '#6b7280'
}

// ── Init ──────────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', () => { showProjectMenu.value = false })
  const uid = localStorage.getItem('bm_user_id')
  userId.value = uid ?? crypto.randomUUID()
  if (!uid) localStorage.setItem('bm_user_id', userId.value!)

  try {
    const user = await $fetch<{ id: string; name: string; niche: string; photo_key: string | null; hero_key?: string | null; eleven_voice_id?: string | null } | null>(`/api/user?id=${userId.value}`)
    if (user) {
      profile.name = user.name; profile.niche = user.niche ?? ''; profile.elevenVoiceId = user.eleven_voice_id ?? null
      if (user.photo_key) profile.photoUrl = `/api/assets/${user.photo_key}`
      if (user.hero_key) { profile.heroUrl = `/api/assets/${user.hero_key}`; profile.heroBase64 = await assetUrlToBase64(`/api/assets/${user.hero_key}`).catch(() => null) as string | null }
    }
  } catch { /* no user yet */ }

  if (localStorage.getItem('bm_new_project')) { await startNewProjectChat(); appLoading.value = false; return }

  const activeSession = localStorage.getItem('bm_active_session')
  if (activeSession) {
    const ok = await loadSession(activeSession)
    if (ok) { sessionId.value = activeSession; appLoading.value = false; return }
  }

  messages.value = [{ role: 'assistant', content: 'Welcome back! Ready to create a new video? Tell me about your next idea.', suggestCreate: false }]
  await ensureSession(); appLoading.value = false
})
</script>

<template>
  <div class="app-shell">
    <!-- Init loading -->
    <div v-if="appLoading" class="init-loading"><div class="init-spinner" /></div>

    <div v-else class="workspace">

      <!-- ══ LEFT: Chat ══ -->
      <div class="chat-panel">
        <header class="chat-header">
          <NuxtLink to="/projects" class="icon-btn" title="Projects">
            <Icon name="fa6-solid:arrow-left" size="15" />
          </NuxtLink>
          <div class="header-center">
            <div class="project-name">{{ videoProject.title || projectSetup.projectTitle || 'Brand Video' }}</div>
            <div class="project-type-label">{{ VIDEO_TYPE_CONFIG[projectSetup.videoType]?.label ?? 'Personal Brand' }}</div>
          </div>
          <button class="icon-btn" :class="{ 'voice-active': profile.elevenVoiceId }" @click.stop="showVoiceWidget = !showVoiceWidget" title="Voice clone">
            <Icon name="fa6-solid:microphone" size="15" />
          </button>
          <div class="menu-wrap" @click.stop>
            <button class="icon-btn" @click="showProjectMenu = !showProjectMenu">
              <Icon name="fa6-solid:ellipsis-vertical" size="15" />
            </button>
            <Transition name="fade">
              <div v-if="showProjectMenu" class="dropdown">
                <NuxtLink to="/profile" class="drop-item"><Icon name="fa6-solid:user" size="12" /> Profile</NuxtLink>
                <button class="drop-item danger" @click="deleteProject"><Icon name="fa6-solid:trash" size="12" /> Delete project</button>
              </div>
            </Transition>
          </div>
        </header>

        <!-- Voice widget -->
        <Transition name="slide-down">
          <div v-if="showVoiceWidget" class="voice-widget">
            <div v-if="profile.elevenVoiceId" class="voice-cloned">
              <div class="voice-icon-wrap"><Icon name="fa6-solid:microphone" size="16" /></div>
              <div><div class="voice-ok">Voice cloned ✓</div><div class="voice-sub">Narrations use your voice</div></div>
              <button class="btn-rm" @click="deleteClonedVoice">Remove</button>
            </div>
            <div v-else>
              <p class="voice-hint">Record 30–60s of your voice to clone it for narrations.</p>
              <button v-if="!isRecording" class="btn-rec" :disabled="cloningVoice" @click="startVoiceRecording">
                <span class="rec-dot" />{{ cloningVoice ? 'Cloning…' : 'Start recording' }}
              </button>
              <button v-else class="btn-rec stop" @click="stopVoiceRecording">
                <Icon name="fa6-solid:stop" size="11" /> Stop ({{ recordingSeconds }}s)
              </button>
            </div>
          </div>
        </Transition>

        <!-- Messages -->
        <div ref="messagesWrap" class="messages-wrap">
          <div class="messages">
            <div v-for="(msg, i) in messages" :key="i" class="msg-row" :class="msg.role">
              <div class="bubble" :class="msg.role">
                <div v-html="renderMd(displayChatContent(msg))" />
                <div v-if="msg.role === 'assistant' && msg.suggestCreate" class="msg-cta">
                  <button class="btn-create" @click="triggerVideoCreation">
                    <Icon name="fa6-solid:wand-magic-sparkles" size="12" /> Create Script
                  </button>
                </div>
              </div>
            </div>
            <div v-if="aiTyping" class="msg-row assistant">
              <div class="bubble assistant typing"><span /><span /><span /></div>
            </div>
          </div>
        </div>

        <div class="input-bar">
          <textarea ref="chatInputEl" v-model="inputText" placeholder="Share your ideas…" rows="1"
            @keydown.enter.exact.prevent="sendMessage" @input="autoResize" />
          <button class="send-btn" :disabled="!inputText.trim() || aiTyping" @click="sendMessage">
            <Icon v-if="aiTyping" name="fa6-solid:spinner" size="15" class="spin" />
            <Icon v-else name="fa6-solid:paper-plane" size="15" />
          </button>
        </div>
      </div>

      <!-- ══ RIGHT: Video Editor ══ -->
      <div class="editor-panel">
        <header class="editor-header">
          <div class="editor-header-left">
            <Icon name="fa6-solid:clapperboard" size="14" class="editor-icon" />
            <span>Video Editor</span>
            <span v-if="hasScript" class="scene-pill">{{ videoProject.scenes.length }} scenes · {{ totalDuration }}s</span>
          </div>
          <button v-if="hasScript && !allVideosReady" class="btn-gen-all" :disabled="generatingAll" @click="generateAllScenes">
            <Icon :name="generatingAll ? 'fa6-solid:spinner' : 'fa6-solid:wand-magic-sparkles'" size="12" :class="{ spin: generatingAll }" />
            {{ generatingAll ? 'Generating…' : 'Generate All' }}
          </button>
          <div v-else-if="allVideosReady" class="all-ready-badge">
            <Icon name="fa6-solid:check-circle" size="13" /> All ready
          </div>
        </header>

        <!-- Empty state -->
        <div v-if="!hasScript" class="editor-empty">
          <div class="editor-empty-icon"><Icon name="fa6-solid:clapperboard" size="30" /></div>
          <p>Chat with the AI and tap <strong>Create Script</strong> to start building your video.</p>
        </div>

        <!-- No photo warning -->
        <div v-else-if="!profile.photoUrl && !profile.photoBase64" class="editor-warn">
          <Icon name="fa6-solid:triangle-exclamation" size="16" />
          <span>Upload your photo in <NuxtLink to="/profile" class="warn-link">Profile</NuxtLink> to generate character images.</span>
        </div>

        <!-- Scenes list -->
        <div v-else class="scenes-scroll">
          <div v-for="(scene, i) in videoProject.scenes" :key="i" class="scene-card">

            <!-- Scene header -->
            <div class="sc-head">
              <div class="sc-num">{{ i + 1 }}</div>
              <div class="sc-title">{{ scene.title }}</div>
              <div class="sc-badges">
                <span class="badge-dur">{{ scene.duration }}s</span>
                <span v-if="scene.mood" class="badge-mood" :style="{ background: moodColor(scene.mood) + '22', color: moodColor(scene.mood) }">{{ scene.mood }}</span>
                <span v-if="scene.videoUrl" class="badge-done">✓ Video</span>
                <span v-else-if="scene.frameUrls.length" class="badge-img">✓ Images</span>
              </div>
            </div>

            <!-- Images row -->
            <div class="sc-images">
              <!-- Opening image -->
              <div class="img-slot" :class="{ filled: scene.frameUrls[0] }" @click="scene.frameUrls[0] && (previewModal = { url: scene.frameUrls[0], type: 'image', title: scene.title + ' — Opening' })">
                <img v-if="scene.frameUrls[0]" :src="scene.frameUrls[0]" alt="" />
                <div v-else class="img-placeholder">
                  <Icon name="fa6-solid:image" size="18" />
                  <span>Opening</span>
                </div>
              </div>
              <!-- Ending image -->
              <div class="img-slot" :class="{ filled: scene.frameUrls[1] }" @click="scene.frameUrls[1] && (previewModal = { url: scene.frameUrls[1], type: 'image', title: scene.title + ' — Ending' })">
                <img v-if="scene.frameUrls[1]" :src="scene.frameUrls[1]" alt="" />
                <div v-else class="img-placeholder">
                  <Icon name="fa6-solid:image" size="18" />
                  <span>Ending</span>
                </div>
              </div>
              <!-- Video preview thumbnail -->
              <div v-if="scene.videoUrl" class="img-slot video-slot filled" @click="previewModal = { url: scene.videoUrl, type: 'video', title: scene.title }">
                <video :src="scene.videoUrl" muted />
                <div class="play-overlay"><Icon name="fa6-solid:play" size="16" /></div>
              </div>
            </div>

            <!-- Narration -->
            <p class="sc-narration">{{ scene.narration }}</p>

            <!-- Setting -->
            <p class="sc-setting"><Icon name="fa6-solid:location-dot" size="9" /> {{ scene.imagePrompt }}</p>

            <!-- Actions -->
            <div class="sc-actions">
              <div v-if="scene.generating" class="generating-status">
                <Icon name="fa6-solid:spinner" size="12" class="spin" />
                {{ scene.generatingLabel || 'Working…' }}
              </div>
              <template v-else>
                <!-- No images: show Generate Images -->
                <button v-if="!scene.frameUrls.length" class="btn-scene-primary" @click="generateSceneImages(i)">
                  <Icon name="fa6-solid:image" size="12" /> Generate Images
                </button>
                <!-- Images but no video: show Generate Video -->
                <button v-else-if="!scene.videoUrl" class="btn-scene-primary btn-video" @click="generateSceneVideo(i)">
                  <Icon name="fa6-solid:film" size="12" /> Generate Video
                </button>
                <!-- Video ready: show Play -->
                <button v-else class="btn-scene-play" @click="previewModal = { url: scene.videoUrl, type: 'video', title: scene.title }">
                  <Icon name="fa6-solid:circle-play" size="12" /> Play Video
                </button>
                <!-- Regenerate (if images exist) -->
                <button v-if="scene.frameUrls.length" class="btn-scene-ghost" @click="generateSceneImages(i)">
                  <Icon name="fa6-solid:rotate" size="11" /> Redo
                </button>
              </template>
            </div>

          </div>
        </div>
      </div>

    </div>

    <!-- Preview modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="previewModal" class="modal-overlay" @click.self="previewModal = null">
          <div class="modal-box">
            <div class="modal-head">
              <span>{{ previewModal.title }}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <a :href="previewModal.url" :download="previewModal.title" class="btn-dl">
                  <Icon name="fa6-solid:download" size="12" /> Download
                </a>
                <button class="icon-btn" @click="previewModal = null"><Icon name="fa6-solid:xmark" size="15" /></button>
              </div>
            </div>
            <video v-if="previewModal.type === 'video'" :src="previewModal.url" controls autoplay loop class="modal-media" />
            <img v-else :src="previewModal.url" class="modal-media" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast"><div v-if="toast.show" class="toast" :class="toast.type">{{ toast.message }}</div></Transition>
  </div>
</template>

<style scoped>
/* ── Shell ── */
.app-shell { height: 100dvh; background: var(--bg); display: flex; flex-direction: column; overflow: hidden; }
.init-loading { flex:1; display:flex; align-items:center; justify-content:center; }
.init-spinner { width:28px; height:28px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.75s linear infinite; }
.workspace { flex:1; display:flex; overflow:hidden; }

/* ── Chat panel (left 42%) ── */
.chat-panel { display:flex; flex-direction:column; flex:0 0 42%; min-width:300px; overflow:hidden; border-right:1px solid var(--border); }

/* ── Chat header ── */
.chat-header { display:flex; align-items:center; gap:8px; padding:12px 14px; background:var(--bg2); border-bottom:1px solid var(--border); flex-shrink:0; }
.header-center { flex:1; min-width:0; }
.project-name { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.project-type-label { font-size:11px; color:var(--accent); font-weight:600; }
.icon-btn { width:34px; height:34px; background:var(--bg3); border:1px solid var(--border); color:var(--text); border-radius:9px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s; text-decoration:none; }
.icon-btn:hover { border-color:var(--accent); color:var(--accent); }
.voice-active { border-color:#10b981 !important; color:#10b981 !important; background:rgba(16,185,129,0.08) !important; }
.menu-wrap { position:relative; }
.dropdown { position:absolute; top:calc(100% + 6px); right:0; min-width:160px; background:var(--bg2); border:1px solid var(--border); border-radius:10px; padding:4px; z-index:200; box-shadow:0 8px 24px rgba(0,0,0,0.5); }
.drop-item { display:flex; align-items:center; gap:8px; width:100%; padding:8px 12px; border-radius:6px; font-size:13px; color:var(--text); background:none; border:none; cursor:pointer; text-decoration:none; transition:background 0.15s; }
.drop-item:hover { background:var(--bg3); }
.drop-item.danger { color:var(--error); }
.drop-item.danger:hover { background:rgba(239,68,68,0.1); }

/* ── Voice widget ── */
.voice-widget { padding:14px 16px; border-bottom:1px solid var(--border); background:var(--bg2); flex-shrink:0; }
.voice-cloned { display:flex; align-items:center; gap:10px; }
.voice-icon-wrap { width:32px; height:32px; background:rgba(16,185,129,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; color:#10b981; flex-shrink:0; }
.voice-ok { font-size:13px; font-weight:600; color:#10b981; }
.voice-sub { font-size:11px; color:var(--text2); margin-top:1px; }
.btn-rm { margin-left:auto; background:none; border:1px solid var(--error); color:var(--error); padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; }
.voice-hint { font-size:13px; color:var(--text2); margin:0 0 10px; line-height:1.5; }
.btn-rec { display:flex; align-items:center; gap:7px; padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid var(--border); background:var(--bg3); color:var(--text); transition:all 0.15s; }
.btn-rec:hover { border-color:var(--accent); }
.btn-rec.stop { border-color:#ef4444; color:#ef4444; }
.rec-dot { width:8px; height:8px; background:#ef4444; border-radius:50%; animation:pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

/* ── Messages ── */
.messages-wrap { flex:1; overflow-y:auto; padding:16px; scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
.messages { display:flex; flex-direction:column; gap:10px; min-height:100%; justify-content:flex-end; }
.msg-row { display:flex; }
.msg-row.user { justify-content:flex-end; }
.bubble { max-width:84%; padding:10px 14px; border-radius:14px; font-size:14px; line-height:1.55; }
.bubble.user { background:var(--accent); color:#fff; border-bottom-right-radius:3px; }
.bubble.assistant { background:var(--bg2); border:1px solid var(--border); border-bottom-left-radius:3px; }
.bubble :deep(strong) { font-weight:700; }
.bubble :deep(li) { margin-left:16px; list-style:disc; }
.bubble :deep(p) { margin:5px 0; }
.bubble :deep(p:first-child) { margin-top:0; }
.bubble :deep(p:last-child) { margin-bottom:0; }
.typing { display:flex; align-items:center; gap:5px; padding:14px 18px; }
.typing span { width:6px; height:6px; background:var(--text2); border-radius:50%; animation:bounce 1.2s infinite; }
.typing span:nth-child(2) { animation-delay:.2s; }
.typing span:nth-child(3) { animation-delay:.4s; }
@keyframes bounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-5px); } }
.msg-cta { margin-top:10px; }
.btn-create { display:inline-flex; align-items:center; gap:6px; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-create:hover { opacity:.88; }

/* ── Input bar ── */
.input-bar { display:flex; align-items:flex-end; gap:8px; padding:10px 12px; border-top:1px solid var(--border); background:var(--bg2); flex-shrink:0; }
.input-bar textarea { flex:1; background:var(--bg3); border:1px solid var(--border); border-radius:10px; color:var(--text); font-size:14px; padding:9px 12px; outline:none; resize:none; font-family:var(--font); line-height:1.5; max-height:140px; transition:border-color 0.2s; }
.input-bar textarea:focus { border-color:var(--accent); }
.send-btn { width:36px; height:36px; background:var(--accent); color:#fff; border:none; border-radius:9px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.send-btn:hover { opacity:.85; }
.send-btn:disabled { opacity:.4; cursor:not-allowed; }

/* ── Editor panel (right 58%) ── */
.editor-panel { display:flex; flex-direction:column; flex:1; min-width:0; overflow:hidden; background:var(--bg); }

/* ── Editor header ── */
.editor-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); background:var(--bg2); flex-shrink:0; }
.editor-header-left { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; }
.editor-icon { color:var(--accent); }
.scene-pill { font-size:11px; font-weight:400; color:var(--text2); }
.btn-gen-all { display:flex; align-items:center; gap:6px; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-gen-all:hover { opacity:.88; }
.btn-gen-all:disabled { opacity:.5; cursor:not-allowed; }
.all-ready-badge { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#10b981; }

/* ── Editor empty / warn ── */
.editor-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:40px 32px; text-align:center; color:var(--text2); }
.editor-empty-icon { width:64px; height:64px; background:var(--bg3); border:1px solid var(--border); border-radius:18px; display:flex; align-items:center; justify-content:center; }
.editor-empty p { font-size:14px; line-height:1.6; max-width:280px; margin:0; }
.editor-empty strong { color:var(--accent); }
.editor-warn { display:flex; align-items:center; gap:10px; padding:14px 18px; background:rgba(245,158,11,0.08); border-bottom:1px solid rgba(245,158,11,0.2); font-size:13px; color:#f59e0b; flex-shrink:0; }
.warn-link { color:#f59e0b; font-weight:600; }

/* ── Scenes scroll ── */
.scenes-scroll { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; scrollbar-width:thin; scrollbar-color:var(--border) transparent; }

/* ── Scene card ── */
.scene-card { background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:14px 16px; transition:border-color 0.2s; }
.scene-card:hover { border-color:rgba(124,92,252,0.3); }
.sc-head { display:flex; align-items:flex-start; gap:10px; margin-bottom:12px; }
.sc-num { width:26px; height:26px; background:rgba(124,92,252,0.15); color:var(--accent); border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; flex-shrink:0; }
.sc-title { flex:1; font-size:14px; font-weight:700; line-height:1.3; }
.sc-badges { display:flex; align-items:center; gap:5px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; }
.badge-dur { background:var(--bg3); border:1px solid var(--border); color:var(--text2); font-size:10px; font-weight:600; padding:2px 7px; border-radius:20px; }
.badge-mood { font-size:10px; font-weight:600; padding:2px 7px; border-radius:20px; }
.badge-done { background:rgba(16,185,129,0.12); color:#10b981; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; }
.badge-img { background:rgba(124,92,252,0.12); color:var(--accent); font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; }

/* ── Images row ── */
.sc-images { display:flex; gap:8px; margin-bottom:12px; }
.img-slot {
  flex:1; aspect-ratio:9/16; max-height:180px; background:var(--bg3);
  border:1px solid var(--border); border-radius:10px; overflow:hidden;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  transition:border-color 0.15s;
}
.img-slot.filled { cursor:zoom-in; border-color:var(--border); }
.img-slot.filled:hover { border-color:var(--accent); }
.img-slot img, .img-slot video { width:100%; height:100%; object-fit:cover; display:block; }
.img-placeholder { display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--text2); font-size:11px; font-weight:600; }
.video-slot { position:relative; cursor:pointer; }
.play-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.35); color:#fff; opacity:0; transition:opacity 0.15s; }
.video-slot:hover .play-overlay { opacity:1; }

/* ── Narration + setting ── */
.sc-narration { font-size:13px; line-height:1.6; color:var(--text); margin:0 0 6px; }
.sc-setting { display:flex; align-items:flex-start; gap:5px; font-size:11px; color:var(--text2); margin:0 0 12px; line-height:1.4; }

/* ── Scene actions ── */
.sc-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.generating-status { display:flex; align-items:center; gap:7px; font-size:13px; color:var(--text2); }
.btn-scene-primary { display:flex; align-items:center; gap:6px; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-scene-primary:hover { opacity:.88; }
.btn-scene-primary.btn-video { background:#f59e0b; }
.btn-scene-play { display:flex; align-items:center; gap:6px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-scene-ghost { display:flex; align-items:center; gap:5px; background:var(--bg3); border:1px solid var(--border); color:var(--text2); border-radius:8px; padding:7px 12px; font-size:12px; cursor:pointer; }
.btn-scene-ghost:hover { border-color:var(--accent); color:var(--accent); }

/* ── Modal ── */
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; z-index:1000; padding:20px; }
.modal-box { background:var(--bg2); border:1px solid var(--border); border-radius:16px; overflow:hidden; max-width:480px; width:100%; max-height:90vh; display:flex; flex-direction:column; }
.modal-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--border); font-size:14px; font-weight:600; gap:8px; }
.modal-media { width:100%; max-height:calc(90vh - 70px); object-fit:contain; display:block; background:#000; }
.btn-dl { display:flex; align-items:center; gap:5px; background:var(--accent); color:#fff; border:none; border-radius:7px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; text-decoration:none; }

/* ── Animations ── */
@keyframes spin { to { transform:rotate(360deg); } }
.spin { animation:spin 0.7s linear infinite; }
.fade-enter-active,.fade-leave-active { transition:opacity 0.15s; }
.fade-enter-from,.fade-leave-to { opacity:0; }
.slide-down-enter-active,.slide-down-leave-active { transition:all 0.2s ease; }
.slide-down-enter-from,.slide-down-leave-to { opacity:0; transform:translateY(-8px); }
.modal-fade-enter-active,.modal-fade-leave-active { transition:all 0.2s ease; }
.modal-fade-enter-from,.modal-fade-leave-to { opacity:0; transform:scale(0.95); }
.toast-enter-active,.toast-leave-active { transition:all 0.25s ease; }
.toast-enter-from,.toast-leave-to { opacity:0; transform:translateY(8px) translateX(-50%); }

/* ── Toast ── */
.toast { position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:var(--bg2); border:1px solid var(--border); color:var(--text); padding:10px 20px; border-radius:10px; font-size:13px; font-weight:600; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,0.4); white-space:nowrap; }
.toast.error { border-color:var(--error); color:var(--error); }
.toast.success { border-color:var(--accent); color:var(--accent); }

/* ── Mobile ── */
@media (max-width:767px) {
  .chat-panel { flex:0 0 100%; border-right:none; }
  .editor-panel { display:none; }
}
</style>
