<script setup lang="ts">
defineProps<{ size?: number; wordmark?: boolean }>()
</script>

<template>
  <div class="brand-logo">
    <!-- Mark -->
    <svg
      :width="size ?? 36"
      :height="size ?? 36"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="logo-mark"
    >
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#7c5cfc" />
          <stop offset="100%" stop-color="#c471f5" />
        </linearGradient>
        <linearGradient id="lg2" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#e8d5ff" stop-opacity="0.9" />
        </linearGradient>
      </defs>

      <!-- Background square with rounded corners -->
      <rect width="36" height="36" rx="10" fill="url(#lg1)" />

      <!-- Film strip holes top -->
      <rect x="4" y="3.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="10" y="3.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="22" y="3.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="28" y="3.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />

      <!-- Film strip holes bottom -->
      <rect x="4" y="29.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="10" y="29.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="22" y="29.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />
      <rect x="28" y="29.5" width="3.5" height="3" rx="0.8" fill="url(#lg2)" opacity="0.7" />

      <!-- Play triangle -->
      <path d="M14 12.5L25.5 18L14 23.5V12.5Z" fill="url(#lg2)" />

      <!-- Sparkle dot -->
      <circle cx="27.5" cy="11" r="2" fill="white" opacity="0.9" />
      <circle cx="27.5" cy="11" r="1" fill="white" />
    </svg>

    <!-- Wordmark -->
    <span v-if="wordmark !== false" class="logo-wordmark">
      Brand<strong>Me</strong> <span class="logo-ai">AI</span>
    </span>
  </div>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--text);
  user-select: none;
}

.logo-mark {
  flex-shrink: 0;
  filter: drop-shadow(0 2px 8px rgba(124, 92, 252, 0.4));
}

.logo-wordmark {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.3px;
  color: var(--text);
  line-height: 1;
}

.logo-wordmark strong {
  font-weight: 800;
}

.logo-ai {
  background: linear-gradient(135deg, #7c5cfc, #c471f5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 800;
}
</style>
