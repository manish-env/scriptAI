import { existsSync, readFileSync } from 'node:fs'

// Wrangler uses .dev.vars; load into process.env so `nuxt dev` sees the same keys.
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (name && process.env[name] === undefined) process.env[name] = value
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  nitro: {
    preset: 'cloudflare-pages',
  },

  modules: ['@pinia/nuxt', '@nuxt/icon'],

  icon: {
    serverBundle: { collections: ['lucide'] },
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    anthropicApiKey: process.env.NUXT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    replicateApiKey: process.env.NUXT_REPLICATE_API_KEY || process.env.REPLICATE_API_KEY,
  },

  app: {
    head: {
      title: 'BrandMe AI',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Personal brand videos without showing your face.' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap' },
      ],
    },
  },
})
