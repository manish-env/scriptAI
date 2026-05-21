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

onMounted(async () => {
  const userId = localStorage.getItem('bm_user_id')
  if (!userId) { navigateTo('/'); return }

  const [user, sessions] = await Promise.all([
    $fetch<UserProfile | null>(`/api/user?id=${userId}`).catch(() => null),
    $fetch<ProjectSummary[]>(`/api/sessions?user_id=${userId}`).catch(() => []),
  ])

  if (!user?.name) { navigateTo('/'); return }

  profile.value = user
  projects.value = sessions ?? []
  loading.value = false
})

function newProject() {
  localStorage.removeItem('bm_active_session')
  navigateTo('/app')
}

function openProject(id: string) {
  localStorage.setItem('bm_active_session', id)
  navigateTo('/app')
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
  <div class="projects-page">

    <!-- Header -->
    <header class="projects-header">
      <div class="container header-inner">
        <NuxtLink to="/" class="header-logo">
          <BrandLogo />
        </NuxtLink>

        <div class="header-right">
          <div v-if="profile" class="user-chip">
            <div class="user-avatar">{{ profile.name?.[0] ?? '?' }}</div>
            <span class="user-name">{{ profile.name }}</span>
          </div>
          <NuxtLink to="/" class="btn btn-ghost btn-sm">Sign out</NuxtLink>
        </div>
      </div>
    </header>

    <main class="container projects-main">

      <!-- Top bar -->
      <div class="top-bar">
        <div>
          <h1>My Projects</h1>
          <p class="top-sub">{{ projects.length }} video{{ projects.length !== 1 ? 's' : '' }} created</p>
        </div>
        <button class="btn btn-primary" @click="newProject">
          <Icon name="lucide:plus" size="16" /> New Project
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="empty-state">
        <div class="empty-spinner" />
      </div>

      <!-- Empty state -->
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

      <!-- Projects grid -->
      <div v-else class="projects-grid">
        <!-- New project card -->
        <div class="project-card new-card" @click="newProject">
          <div class="new-card-inner">
            <div class="new-icon"><Icon name="lucide:plus" size="28" /></div>
            <span>New Project</span>
          </div>
        </div>

        <!-- Existing projects -->
        <div
          v-for="p in projects"
          :key="p.id"
          class="project-card"
          @click="openProject(p.id)"
        >
          <!-- Thumbnail -->
          <div class="project-thumb">
            <img v-if="thumbUrl(p.thumbnail_key)" :src="thumbUrl(p.thumbnail_key)!" class="thumb-img" />
            <div v-else class="thumb-placeholder">
              <Icon name="lucide:film" size="32" />
            </div>
            <div class="thumb-overlay">
              <Icon name="lucide:play" size="20" />
            </div>
          </div>

          <!-- Info -->
          <div class="project-info">
            <div class="project-title">{{ p.title || 'Untitled Project' }}</div>
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

    </main>
  </div>
</template>

<style scoped>
.projects-page {
  min-height: 100dvh;
  background: var(--bg);
}

/* Header */
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
}
.user-avatar {
  width: 28px; height: 28px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; color: #fff;
}
.user-name { font-size: 14px; font-weight: 600; }

/* Main */
.projects-main { padding: 40px 24px 80px; }

/* Top bar */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
}
.top-bar h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
.top-sub { color: var(--text2); font-size: 14px; margin-top: 4px; }

/* Empty state */
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

/* Grid */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

/* Card */
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

/* New card */
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
  transition: color 0.2s;
}
.new-icon {
  width: 52px; height: 52px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.new-card:hover .new-card-inner { color: var(--accent); }
.new-card:hover .new-icon { border-color: var(--accent); background: rgba(124,92,252,0.1); }

/* Thumbnail */
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

/* Info */
.project-info { padding: 14px 16px; }
.project-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
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

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .top-bar { flex-direction: column; align-items: flex-start; gap: 16px; }
  .projects-grid { grid-template-columns: 1fr 1fr; }
  .header-right .user-name { display: none; }
}
</style>
