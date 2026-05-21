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
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    replicateApiKey: process.env.REPLICATE_API_KEY,
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
