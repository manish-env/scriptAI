<script setup lang="ts">
useHead({ title: 'Profile — BrandMe AI' })

interface UserRow {
  id: string
  name: string
  niche: string | null
  photo_key: string | null
  hero_key?: string | null
}

const userId = ref<string | null>(null)
const user = ref<UserRow | null>(null)
const loading = ref(true)
const saving = ref(false)
const toast = ref('')

const form = reactive({ name: '', niche: '' })
const photoInputEl = ref<HTMLInputElement | null>(null)
const photoPreview = ref<string | null>(null)
const photoBase64 = ref<string | null>(null)
const photoChanged = ref(false)

onMounted(async () => {
  const uid = localStorage.getItem('bm_user_id')
  if (!uid) {
    navigateTo('/')
    return
  }
  userId.value = uid
  const row = await $fetch<UserRow | null>(`/api/user?id=${uid}`).catch(() => null)
  if (!row?.name) {
    navigateTo('/app?setup=profile')
    return
  }
  user.value = row
  form.name = row.name
  form.niche = row.niche ?? ''
  if (row.photo_key) photoPreview.value = `/api/assets/${row.photo_key}`
  loading.value = false
})

function triggerPhoto() {
  photoInputEl.value?.click()
}

function onPhotoSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    photoPreview.value = ev.target?.result as string
    photoBase64.value = (ev.target?.result as string).split(',')[1]
    photoChanged.value = true
  }
  reader.readAsDataURL(file)
}

async function uploadPhotoIfNeeded() {
  if (!photoBase64.value || !userId.value) return user.value?.photo_key ?? null
  const res = await $fetch<{ key: string | null }>('/api/upload', {
    method: 'POST',
    body: { base64: photoBase64.value, type: 'photo', user_id: userId.value },
  })
  return res.key
}

async function saveProfile() {
  if (!form.name.trim() || !userId.value) return
  saving.value = true
  toast.value = ''
  try {
    let photo_key = user.value?.photo_key ?? null
    const clearedHero = photoChanged.value
    if (clearedHero && photoBase64.value) {
      photo_key = await uploadPhotoIfNeeded()
    }
    await $fetch('/api/user', {
      method: 'POST',
      body: {
        id: userId.value,
        name: form.name.trim(),
        niche: form.niche.trim() || null,
        photo_key,
        hero_key: clearedHero ? null : user.value?.hero_key ?? null,
      },
    })
    photoChanged.value = false
    toast.value = 'Profile saved'
    user.value = {
      id: userId.value,
      name: form.name.trim(),
      niche: form.niche.trim() || null,
      photo_key,
      hero_key: clearedHero ? null : user.value?.hero_key ?? null,
    }
    if (photo_key) photoPreview.value = `/api/assets/${photo_key}`
  } catch {
    toast.value = 'Could not save profile'
  } finally {
    saving.value = false
    setTimeout(() => { toast.value = '' }, 3000)
  }
}

function openOnboarding() {
  navigateTo('/app?setup=profile')
}

function signOut() {
  localStorage.removeItem('bm_user_id')
  localStorage.removeItem('bm_active_session')
  navigateTo('/')
}
</script>

<template>
  <div class="profile-page">
    <header class="profile-header">
      <div class="container header-inner">
        <NuxtLink to="/projects" class="back-btn">
          <Icon name="lucide:arrow-left" size="16" /> Projects
        </NuxtLink>
        <BrandLogo />
      </div>
    </header>

    <main class="container profile-main">
      <div v-if="loading" class="loading-state"><div class="spinner" /></div>

      <template v-else>
        <h1>Your profile</h1>
        <p class="sub">Update how the AI portrays you across all videos.</p>

        <div class="profile-card card">
          <div class="photo-block">
            <div class="photo-upload" :class="{ 'has-photo': photoPreview }" @click="triggerPhoto">
              <img v-if="photoPreview" :src="photoPreview" class="photo-preview" alt="" />
              <div v-else class="photo-placeholder">
                <Icon name="lucide:camera" size="28" />
                <span>Add photo</span>
              </div>
            </div>
            <input ref="photoInputEl" type="file" accept="image/*" hidden @change="onPhotoSelected" />
            <p class="photo-hint">Changing your photo resets your character look — regenerate scene frames after.</p>
          </div>

          <div class="field">
            <label>Name</label>
            <input v-model="form.name" type="text" placeholder="Your name" />
          </div>
          <div class="field">
            <label>Niche / industry</label>
            <input v-model="form.niche" type="text" placeholder="e.g. Marketing, Fitness" />
          </div>

          <button class="btn btn-primary btn-full" :disabled="saving || !form.name.trim()" @click="saveProfile">
            {{ saving ? 'Saving…' : 'Save profile' }}
          </button>
        </div>

        <div class="actions-card card">
          <h2>Account</h2>
          <button class="action-row" @click="openOnboarding">
            <Icon name="lucide:user-cog" size="18" />
            <span>
              <strong>Full setup wizard</strong>
              <small>Name, photo & niche step-by-step</small>
            </span>
            <Icon name="lucide:chevron-right" size="18" class="chev" />
          </button>
          <button class="action-row" @click="navigateTo('/projects')">
            <Icon name="lucide:folder" size="18" />
            <span>
              <strong>My projects</strong>
              <small>View, delete, or clear project media</small>
            </span>
            <Icon name="lucide:chevron-right" size="18" class="chev" />
          </button>
          <button class="action-row danger" @click="signOut">
            <Icon name="lucide:log-out" size="18" />
            <span>
              <strong>Sign out</strong>
              <small>Clear this device session</small>
            </span>
          </button>
        </div>

        <p v-if="toast" class="toast-msg">{{ toast }}</p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.profile-page { min-height: 100dvh; background: var(--bg); }
.profile-header {
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
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text2);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}
.back-btn:hover { color: var(--text); }
.profile-main {
  max-width: 520px;
  padding: 40px 24px 80px;
}
.profile-main h1 { font-size: 28px; font-weight: 800; }
.sub { color: var(--text2); margin: 8px 0 28px; font-size: 14px; }
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 20px;
}
.field { margin-bottom: 18px; }
.field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.field input {
  width: 100%;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 15px;
  padding: 12px 14px;
  outline: none;
  font-family: var(--font);
  box-sizing: border-box;
}
.field input:focus { border-color: var(--accent); }
.photo-upload {
  width: 100%;
  max-width: 200px;
  aspect-ratio: 1;
  margin: 0 auto 12px;
  background: var(--bg3);
  border: 2px dashed var(--border);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}
.photo-upload.has-photo { border-color: var(--accent); }
.photo-preview { width: 100%; height: 100%; object-fit: cover; }
.photo-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text2);
  font-size: 13px;
}
.photo-hint { font-size: 12px; color: var(--text2); text-align: center; line-height: 1.5; }
.actions-card h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.action-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border: none;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
}
.action-row:first-of-type { border-top: none; }
.action-row span { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.action-row strong { font-size: 14px; }
.action-row small { font-size: 12px; color: var(--text2); font-weight: 400; }
.action-row .chev { color: var(--text2); }
.action-row:hover { color: var(--accent); }
.action-row.danger:hover { color: var(--error); }
.loading-state { display: flex; justify-content: center; padding: 80px; }
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.toast-msg {
  text-align: center;
  color: var(--success);
  font-size: 14px;
  font-weight: 600;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
