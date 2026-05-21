<script setup lang="ts">
useHead({ title: 'My Projects — BrandMe AI' })

interface ProjectSummary {
  id: string
  title: string | null
  updated_at: string
  scene_count: number
  thumbnail_key: string | null
}

interface UserProfile {
  id: string
  name: string
  niche: string | null
}

const profile = ref<UserProfile | null>(null)
const projects = ref<ProjectSummary[]>([])
const loading = ref(true)
const openMenuId = ref<string | null>(null)
const toast = ref('')

// ── New Project Modal ──────────────────────────────────────────────────────
const showNewModal = ref(false)
const creating = ref(false)
const newPhotoInputEl = ref<HTMLInputElement | null>(null)
const newPhotoPreview = ref<string | null>(null)
const newPhotoBase64 = ref<string | null>(null)
const form = reactive({ videoType: '', title: '', purpose: '' })

const VIDEO_TYPES = [
  { value: 'personal-brand',    label: '🎯 Personal Brand Story' },
  { value: 'educational',       label: '📚 Educational Tutorial' },
  { value: 'motivational',      label: '🔥 Motivational / Inspirational' },
  { value: 'product-demo',      label: '🛍️ Product Demo' },
  { value: 'how-to',            label: '🔧 How-To Guide' },
  { value: 'case-study',        label: '📈 Case Study / Success Story' },
  { value: 'thought-leadership',label: '💡 Thought Leadership' },
  { value: 'course-teaser',     label: '🎓 Course / Program Teaser' },
]

function openNewProject() {
  form.videoType = ''; form.title = ''; form.purpose = ''
  newPhotoPreview.value = null; newPhotoBase64.value = null
  showNewModal.value = true
}

function onNewPhotoSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    newPhotoPreview.value = ev.target?.result as string
    newPhotoBase64.value = (ev.target?.result as string).split(',')[1]
  }
  reader.readAsDataURL(file)
}

function createProject() {
  if (!form.videoType || !form.title.trim() || !form.purpose.trim()) return
  creating.value = true
  localStorage.setItem('bm_new_project', JSON.stringify({
    videoType: form.videoType,
    title: form.title.trim(),
    purpose: form.purpose.trim(),
    photoBase64: newPhotoBase64.value,
  }))
  localStorage.removeItem('bm_active_session')
  navigateTo('/app')
}

onMounted(async () => {
  const userId = localStorage.getItem('bm_user_id')
  if (!userId) { navigateTo('/'); return }

  const [user, sessions] = await Promise.all([
    $fetch<UserProfile | null>(`/api/user?id=${userId}`).catch(() => null),
    $fetch<ProjectSummary[]>(`/api/sessions?user_id=${userId}`).catch(() => []),
  ])

  if (!user?.name || !user?.niche) { navigateTo('/profile'); return }

  profile.value = user
  projects.value = sessions ?? []
  loading.value = false
})

function newProject() { openNewProject() }

function openProject(id: string) {
  localStorage.setItem('bm_active_session', id)
  navigateTo('/app')
}

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

async function clearProjectMedia(id: string, title: string | null) {
  if (!confirm(`Clear all images and video for "${title || 'Untitled'}"? Script and chat will stay.`)) return
  try {
    await $fetch(`/api/sessions/${id}/clear-media`, { method: 'POST' })
    const p = projects.value.find(x => x.id === id)
    if (p) p.thumbnail_key = null
    openMenuId.value = null
    toast.value = 'Media cleared'
  } catch {
    toast.value = 'Could not clear media'
  }
  setTimeout(() => { toast.value = '' }, 3000)
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

async function deleteProject(id: string, title: string | null) {
  if (!confirm(`Delete "${title || 'Untitled'}" permanently?`)) return
  try {
    await deleteProjectById(id)
    projects.value = projects.value.filter(p => p.id !== id)
    if (localStorage.getItem('bm_active_session') === id) {
      localStorage.removeItem('bm_active_session')
    }
    openMenuId.value = null
    toast.value = 'Project deleted'
  } catch (e: unknown) {
    toast.value = apiErrorMessage(e)
  }
  setTimeout(() => { toast.value = '' }, 3000)
}

function signOut() {
  localStorage.removeItem('bm_user_id')
  localStorage.removeItem('bm_active_session')
  navigateTo('/')
}

function thumbUrl(key: string | null) {
  return key ? `/api/assets/${key}` : null
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
</script>

<template>
  <div class="projects-page" @click="openMenuId = null">

    <header class="projects-header">
      <div class="container header-inner">
        <NuxtLink to="/" class="header-logo">
          <BrandLogo />
        </NuxtLink>

        <div class="header-right">
          <NuxtLink to="/profile" class="user-chip">
            <div class="user-avatar">{{ profile?.name?.[0] ?? '?' }}</div>
            <span class="user-name">{{ profile?.name }}</span>
          </NuxtLink>
          <button type="button" class="btn btn-ghost btn-sm" @click="signOut">Sign out</button>
        </div>
      </div>
    </header>

    <main class="container projects-main">

      <div class="top-bar">
        <div>
          <h1>My Projects</h1>
          <p class="top-sub">{{ projects.length }} video{{ projects.length !== 1 ? 's' : '' }} created</p>
        </div>
        <div class="top-actions">
          <NuxtLink to="/profile" class="btn btn-outline btn-sm">
            <Icon name="lucide:user" size="14" /> Profile
          </NuxtLink>
          <button class="btn btn-primary" @click="newProject">
            <Icon name="lucide:plus" size="16" /> New Project
          </button>
        </div>
      </div>

      <div v-if="loading" class="empty-state">
        <div class="empty-spinner" />
      </div>

      <div v-else-if="!projects.length" class="empty-state">
        <div class="empty-icon">
          <Icon name="lucide:video" size="40" />
        </div>
        <h2>No projects yet</h2>
        <p>Start a conversation with AI and create your first brand video.</p>
        <button class="btn btn-primary btn-lg" @click="newProject">
          <Icon name="lucide:plus" size="16" /> Create Your First Video
        </button>
      </div>

      <div v-else class="projects-grid">
        <div class="project-card new-card" @click="newProject">
          <div class="new-card-inner">
            <div class="new-icon"><Icon name="lucide:plus" size="28" /></div>
            <span>New Project</span>
          </div>
        </div>

        <div
          v-for="p in projects"
          :key="p.id"
          class="project-card"
          @click="openProject(p.id)"
        >
          <div class="project-thumb">
            <img v-if="thumbUrl(p.thumbnail_key)" :src="thumbUrl(p.thumbnail_key)!" class="thumb-img" alt="" />
            <div v-else class="thumb-placeholder">
              <Icon name="lucide:film" size="32" />
            </div>
            <div class="thumb-overlay">
              <Icon name="lucide:play" size="20" />
            </div>
          </div>

          <div class="project-info">
            <div class="project-info-row">
              <div class="project-title">{{ p.title || 'Untitled Project' }}</div>
              <button
                type="button"
                class="card-menu-btn"
                aria-label="Project options"
                @click.stop="toggleMenu(p.id)"
              >
                <Icon name="lucide:more-vertical" size="16" />
              </button>
            </div>
            <div v-if="openMenuId === p.id" class="card-menu" @click.stop>
              <button type="button" @click="clearProjectMedia(p.id, p.title)">
                <Icon name="lucide:image-off" size="14" /> Clear images & video
              </button>
              <button type="button" class="danger" @click="deleteProject(p.id, p.title)">
                <Icon name="lucide:trash-2" size="14" /> Delete project
              </button>
            </div>
            <div class="project-meta">
              <span class="meta-chip">
                <Icon name="lucide:layout-list" size="11" />
                {{ p.scene_count }} scene{{ p.scene_count !== 1 ? 's' : '' }}
              </span>
              <span class="meta-time">
                <Icon name="lucide:clock" size="11" />
                {{ timeAgo(p.updated_at) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <p v-if="toast" class="page-toast">{{ toast }}</p>
    </main>

    <!-- ── New Project Modal ── -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showNewModal" class="np-overlay" @click.self="showNewModal = false">
          <div class="np-box">
            <button class="np-close" @click="showNewModal = false">✕</button>
            <div class="np-head">
              <h2>New Project</h2>
              <p>Tell us about your video — AI will become your expert creator for this type.</p>
            </div>

            <form class="np-form" @submit.prevent="createProject">

              <div class="np-field">
                <label>Video Type <span class="req">*</span></label>
                <div class="type-grid">
                  <button
                    v-for="t in VIDEO_TYPES" :key="t.value"
                    type="button"
                    class="type-chip"
                    :class="{ active: form.videoType === t.value }"
                    @click="form.videoType = t.value"
                  >{{ t.label }}</button>
                </div>
              </div>

              <div class="np-field">
                <label>Project Title <span class="req">*</span></label>
                <input v-model="form.title" type="text" placeholder="e.g. My Brand Story 2025" required />
              </div>

              <div class="np-field">
                <label>Purpose / Goal <span class="req">*</span></label>
                <textarea
                  v-model="form.purpose"
                  placeholder="What should viewers feel, know, or do after watching? Be specific."
                  rows="3"
                  required
                />
              </div>

              <div class="np-field">
                <label>Your Photo <span class="optional">(optional — can add in profile)</span></label>
                <div class="photo-zone" @click="newPhotoInputEl?.click()">
                  <img v-if="newPhotoPreview" :src="newPhotoPreview" class="photo-thumb" alt="" />
                  <div v-else class="photo-empty">
                    <Icon name="lucide:camera" size="22" />
                    <span>Upload your face photo</span>
                    <small>Used to generate your illustrated character</small>
                  </div>
                </div>
                <input ref="newPhotoInputEl" type="file" accept="image/*" style="display:none" @change="onNewPhotoSelected" />
              </div>

              <button
                type="submit"
                class="btn btn-primary btn-full"
                :disabled="creating || !form.videoType || !form.title.trim() || !form.purpose.trim()"
              >
                <Icon name="lucide:sparkles" size="16" />
                {{ creating ? 'Starting…' : 'Start Creating with AI →' }}
              </button>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.projects-page {
  min-height: 100dvh;
  background: var(--bg);
}

.projects-header {
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  position: sticky;
  top: 0;
  z-index: 50;
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}
.header-logo { text-decoration: none; }
.header-right { display: flex; align-items: center; gap: 12px; }
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 12px 4px 4px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s;
}
.user-chip:hover { border-color: var(--accent); }
.user-avatar {
  width: 28px; height: 28px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; color: #fff;
}
.user-name { font-size: 14px; font-weight: 600; }

.projects-main { padding: 40px 24px 80px; }

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  gap: 16px;
}
.top-bar h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
.top-sub { color: var(--text2); font-size: 14px; margin-top: 4px; }
.top-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 24px;
  text-align: center;
}
.empty-icon {
  width: 72px; height: 72px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text2);
}
.empty-state h2 { font-size: 22px; font-weight: 700; }
.empty-state p { color: var(--text2); font-size: 15px; max-width: 340px; }
.empty-spinner {
  width: 36px; height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

.project-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.project-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(124, 92, 252, 0.12);
}

.new-card {
  border-style: dashed;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.new-card-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text2);
  font-size: 14px;
  font-weight: 600;
}
.new-icon {
  width: 52px; height: 52px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
}
.new-card:hover .new-card-inner { color: var(--accent); }
.new-card:hover .new-icon { border-color: var(--accent); background: rgba(124,92,252,0.1); }

.project-thumb {
  width: 100%;
  aspect-ratio: 16/9;
  background: var(--bg3);
  position: relative;
  overflow: hidden;
}
.thumb-img { width: 100%; height: 100%; object-fit: cover; }
.thumb-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text2);
  background: linear-gradient(135deg, var(--bg2), var(--bg3));
}
.thumb-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s;
}
.project-card:hover .thumb-overlay { opacity: 1; }

.project-info { padding: 14px 16px; position: relative; }
.project-info-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.project-title {
  font-size: 14px;
  font-weight: 700;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-menu-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.card-menu-btn:hover { background: var(--bg3); color: var(--text); }
.card-menu {
  position: absolute;
  right: 12px;
  bottom: 52px;
  min-width: 180px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  z-index: 20;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
}
.card-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}
.card-menu button:hover { background: var(--bg3); }
.card-menu button.danger { color: var(--error); }
.card-menu button.danger:hover { background: rgba(239, 68, 68, 0.1); }

.project-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.meta-chip, .meta-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text2);
}

.page-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg2);
  border: 1px solid var(--success);
  color: var(--success);
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  z-index: 200;
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .top-bar { flex-direction: column; align-items: flex-start; }
  .projects-grid { grid-template-columns: 1fr 1fr; }
  .header-right .user-name { display: none; }
}

/* ── New Project Modal ── */
.np-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; padding: 16px;
}
.np-box {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 36px 32px;
  width: 100%; max-width: 520px;
  position: relative;
  max-height: 90dvh;
  overflow-y: auto;
}
.np-close {
  position: absolute; top: 14px; right: 14px;
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--text2); width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.np-head { margin-bottom: 24px; }
.np-head h2 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
.np-head p { color: var(--text2); font-size: 14px; line-height: 1.5; }
.np-form { display: flex; flex-direction: column; gap: 20px; }
.np-field { display: flex; flex-direction: column; gap: 8px; }
.np-field label { font-size: 13px; font-weight: 600; color: var(--text); }
.np-field input, .np-field textarea {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 14px;
  color: var(--text); font-family: var(--font); font-size: 14px;
  width: 100%; outline: none; resize: vertical;
  transition: border-color 0.2s;
}
.np-field input:focus, .np-field textarea:focus { border-color: var(--accent); }
.req { color: var(--accent); }
.optional { color: var(--text2); font-weight: 400; font-size: 12px; }

.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.type-chip {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px;
  color: var(--text2); font-size: 13px; font-weight: 500;
  cursor: pointer; text-align: left;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.type-chip:hover { border-color: var(--accent); color: var(--text); }
.type-chip.active {
  border-color: var(--accent);
  background: rgba(124,92,252,0.1);
  color: var(--text);
}

.photo-zone {
  background: var(--bg3); border: 1px dashed var(--border);
  border-radius: 12px; cursor: pointer;
  min-height: 90px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; transition: border-color 0.2s;
}
.photo-zone:hover { border-color: var(--accent); }
.photo-thumb { width: 100%; max-height: 160px; object-fit: cover; }
.photo-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px; color: var(--text2); padding: 20px;
}
.photo-empty span { font-size: 13px; font-weight: 500; }
.photo-empty small { font-size: 11px; }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .np-box, .modal-leave-to .np-box { transform: scale(0.96) translateY(8px); }

@media (max-width: 480px) {
  .type-grid { grid-template-columns: 1fr; }
  .np-box { padding: 24px 18px; }
}
</style>
