<script setup lang="ts">
useHead({ title: 'BrandMe AI — Personal Brand Videos Without Showing Your Face' })

const authModal = ref<'login' | 'signup' | null>(null)
const navOpen = ref(false)

function goToApp() {
  navigateTo('/app')
}

function handleLogin(e: Event) {
  e.preventDefault()
  navigateTo('/app')
}

function handleSignup(e: Event) {
  e.preventDefault()
  const name = (document.getElementById('signupName') as HTMLInputElement)?.value
  if (name) localStorage.setItem('bm_pending_name', name)
  navigateTo('/app')
}

// Close modal on overlay click
function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('modal-overlay')) authModal.value = null
}

// Sticky navbar on scroll
onMounted(() => {
  const navbar = document.getElementById('site-navbar')
  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 20)
  })
})
</script>

<template>
  <div class="landing">

    <!-- ── NAVBAR ── -->
    <header class="navbar" id="site-navbar">
      <div class="container nav-inner">
        <NuxtLink to="/" class="nav-logo">
          <BrandLogo />
        </NuxtLink>

        <nav class="nav-links" :class="{ open: navOpen }">
          <a href="#features" @click="navOpen = false">Features</a>
          <a href="#how" @click="navOpen = false">How It Works</a>
          <a href="#pricing" @click="navOpen = false">Pricing</a>
        </nav>

        <div class="nav-actions">
          <button class="btn btn-ghost" @click="authModal = 'login'">Log In</button>
          <button class="btn btn-primary" @click="authModal = 'signup'">
            Get Started <span>→</span>
          </button>
        </div>

        <button class="hamburger" :class="{ active: navOpen }" @click="navOpen = !navOpen">
          <span /><span /><span />
        </button>
      </div>
    </header>

    <!-- ── HERO ── -->
    <section class="hero">
      <div class="hero-glow" />
      <div class="container hero-inner">
        <div class="hero-badge">✦ AI-Powered Personal Branding</div>
        <h1 class="hero-headline">
          Build Your Brand.<br />
          <span class="gradient-text">No Camera Required.</span>
        </h1>
        <p class="hero-sub">
          Chat with AI about your story and we'll create a professional brand video — with custom caricature illustrations of you. No studio. No face on camera.
        </p>
        <div class="hero-cta">
          <button class="btn btn-primary btn-lg" @click="authModal = 'signup'">Start for Free</button>
          <a href="#how" class="btn btn-outline btn-lg">See How It Works</a>
        </div>
        <div class="hero-proof">
          <div class="proof-avatars">
            <div v-for="(a, i) in proofAvatars" :key="i" class="proof-avatar" :style="{ background: a.color }">{{ a.letter }}</div>
          </div>
          <span>Loved by <strong>5,000+</strong> creators worldwide</span>
        </div>

        <!-- App mockup -->
        <div class="hero-preview">
          <div class="preview-bar">
            <span class="dot r" /><span class="dot y" /><span class="dot g" />
            <span class="preview-url">app.brandme.ai</span>
          </div>
          <div class="preview-body">
            <div class="mock-chat">
              <div class="mock-msg ai">👋 Hi Sarah! What's the main story you want to tell in your video?</div>
              <div class="mock-msg user">I help women in tech gain confidence to lead teams…</div>
              <div class="mock-msg ai">Love that! Let's build a 5-scene video around your transformation framework. Ready? 🎬</div>
              <div class="mock-action">
                <button class="btn btn-primary btn-sm">Create My Video 🎬</button>
              </div>
            </div>
            <div class="mock-scenes">
              <div v-for="(s, i) in mockScenes" :key="i" class="mock-scene">
                <div class="mock-scene-img" :style="{ background: s.bg }">🎨</div>
                <div class="mock-scene-info">
                  <div class="mock-scene-title">{{ s.title }}</div>
                  <div class="mock-scene-status" :class="s.status === 'done' ? 'done' : 'gen'">
                    {{ s.status === 'done' ? '● Ready' : '◌ Generating' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── SOCIAL PROOF ── -->
    <section class="logos-section">
      <div class="container">
        <p class="logos-label">Used by creators from</p>
        <div class="logos-row">
          <span v-for="p in platforms" :key="p" class="logo-pill">{{ p }}</span>
        </div>
      </div>
    </section>

    <!-- ── FEATURES ── -->
    <section class="section" id="features">
      <div class="container">
        <div class="section-header">
          <div class="section-badge">Features</div>
          <h2>Everything you need to build a<br /><span class="gradient-text">powerful personal brand</span></h2>
          <p>From AI strategy to polished video — fully automated.</p>
        </div>
        <div class="features-grid">
          <div v-for="f in features" :key="f.title" class="feature-card">
            <div class="feature-icon">{{ f.icon }}</div>
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── HOW IT WORKS ── -->
    <section class="how section" id="how">
      <div class="container">
        <div class="section-header">
          <div class="section-badge">How It Works</div>
          <h2>From conversation to<br /><span class="gradient-text">published video in minutes</span></h2>
        </div>
        <div class="steps">
          <div v-for="(step, i) in steps" :key="i" class="step-wrapper">
            <div class="step">
              <div class="step-left">
                <div class="step-num">0{{ i + 1 }}</div>
                <div class="step-content">
                  <h3>{{ step.title }}</h3>
                  <p>{{ step.desc }}</p>
                </div>
              </div>
              <div class="step-visual" v-html="step.visual" />
            </div>
            <div v-if="i < steps.length - 1" class="step-divider">↓</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── TESTIMONIALS ── -->
    <section class="section testimonials-section">
      <div class="container">
        <div class="section-header">
          <div class="section-badge">Testimonials</div>
          <h2>Creators love <span class="gradient-text">BrandMe AI</span></h2>
        </div>
        <div class="testimonials-grid">
          <div v-for="t in testimonials" :key="t.name" class="testimonial-card" :class="{ featured: t.featured }">
            <div class="stars">★★★★★</div>
            <p>"{{ t.quote }}"</p>
            <div class="testimonial-author">
              <div class="t-avatar" :style="{ background: t.color }">{{ t.name[0] }}</div>
              <div>
                <strong>{{ t.name }}</strong><br />
                <span>{{ t.role }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── PRICING ── -->
    <section class="section" id="pricing">
      <div class="container">
        <div class="section-header">
          <div class="section-badge">Pricing</div>
          <h2>Simple, creator-friendly<br /><span class="gradient-text">pricing</span></h2>
          <p>No hidden fees. Cancel anytime.</p>
        </div>
        <div class="pricing-grid">
          <div v-for="plan in plans" :key="plan.name" class="pricing-card" :class="{ featured: plan.featured }">
            <div v-if="plan.featured" class="plan-badge">Most Popular</div>
            <div class="plan-name">{{ plan.name }}</div>
            <div class="plan-price">
              <span class="price-num">{{ plan.price }}</span>
              <span class="price-period">/month</span>
            </div>
            <p class="plan-desc">{{ plan.desc }}</p>
            <ul class="plan-features">
              <li v-for="f in plan.features" :key="f">{{ f }}</li>
            </ul>
            <button
              :class="plan.featured ? 'btn btn-primary btn-full' : 'btn btn-outline btn-full'"
              @click="authModal = 'signup'"
            >
              {{ plan.cta }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── FINAL CTA ── -->
    <section class="section final-cta-section">
      <div class="container">
        <div class="cta-box">
          <div class="cta-glow" />
          <h2>Ready to build your brand?</h2>
          <p>Join 5,000+ creators making professional brand videos — without a camera.</p>
          <button class="btn btn-primary btn-lg" @click="authModal = 'signup'">
            Start for Free — No Card Required
          </button>
        </div>
      </div>
    </section>

    <!-- ── FOOTER ── -->
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <NuxtLink to="/" class="nav-logo">
            <BrandLogo />
          </NuxtLink>
          <p>Turn your story into a stunning personal brand video — no camera needed.</p>
        </div>
        <div class="footer-links">
          <div v-for="col in footerLinks" :key="col.title" class="footer-col">
            <h4>{{ col.title }}</h4>
            <a v-for="l in col.links" :key="l.label" :href="l.href">{{ l.label }}</a>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="container footer-bottom-inner">
          <span>© 2025 BrandMe AI. All rights reserved.</span>
          <div class="footer-social">
            <a href="#" aria-label="Twitter">𝕏</a>
            <a href="#" aria-label="LinkedIn">in</a>
            <a href="#" aria-label="Instagram">◎</a>
          </div>
        </div>
      </div>
    </footer>

    <!-- ── AUTH MODAL ── -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="authModal" class="modal-overlay" @click="onOverlayClick">
          <div class="modal-box">
            <button class="modal-close" @click="authModal = null">✕</button>
            <div class="modal-logo">🎬</div>

            <!-- Login -->
            <template v-if="authModal === 'login'">
              <h2>Welcome back</h2>
              <p class="modal-sub">Sign in to your BrandMe AI account</p>
              <form @submit="handleLogin">
                <div class="form-field"><label>Email</label><input type="email" placeholder="you@example.com" required /></div>
                <div class="form-field"><label>Password</label><input type="password" placeholder="••••••••" required /></div>
                <button type="submit" class="btn btn-primary btn-full">Sign In</button>
              </form>
              <p class="modal-switch">Don't have an account? <button @click="authModal = 'signup'">Sign up free</button></p>
            </template>

            <!-- Signup -->
            <template v-else>
              <h2>Create your account</h2>
              <p class="modal-sub">Start building your personal brand today</p>
              <form @submit="handleSignup">
                <div class="form-field"><label>Full Name</label><input id="signupName" type="text" placeholder="Sarah Johnson" required /></div>
                <div class="form-field"><label>Email</label><input type="email" placeholder="you@example.com" required /></div>
                <div class="form-field"><label>Password</label><input type="password" placeholder="Create a password" required minlength="8" /></div>
                <button type="submit" class="btn btn-primary btn-full">Create Free Account →</button>
                <p class="terms">By signing up you agree to our <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a>.</p>
              </form>
              <p class="modal-switch">Already have an account? <button @click="authModal = 'login'">Sign in</button></p>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script lang="ts">
// ── Static data ────────────────────────────────────────────────────────────
const proofAvatars = [
  { color: '#7c5cfc', letter: 'S' }, { color: '#c471f5', letter: 'M' },
  { color: '#22c55e', letter: 'R' }, { color: '#f59e0b', letter: 'J' },
  { color: '#ef4444', letter: 'A' },
]

const platforms = ['LinkedIn', 'YouTube', 'Instagram', 'TikTok', 'Substack', 'Kajabi']

const mockScenes = [
  { title: 'Scene 1 — Hook', bg: 'linear-gradient(135deg,#1a1030,#3d2080)', status: 'done' },
  { title: 'Scene 2 — Problem', bg: 'linear-gradient(135deg,#0d1f30,#1a4060)', status: 'done' },
  { title: 'Scene 3 — Solution', bg: 'linear-gradient(135deg,#1a3020,#2d6040)', status: 'gen' },
]

const features = [
  { icon: '🤖', title: 'AI Strategy Chat', desc: 'Have a real conversation with Claude AI. It asks the right questions to build a compelling video concept tailored to your niche.' },
  { icon: '🎭', title: 'Caricature Illustrations', desc: 'Upload your photo once. AI generates a unique illustrated version of you for every scene — your face, your style, no camera.' },
  { icon: '📝', title: 'Auto Scene Scripting', desc: 'Claude analyzes your chat and writes a complete scene-by-scene script with narration, mood, and timing — ready to render.' },
  { icon: '🎬', title: 'Ken Burns Video Export', desc: 'Your scenes are stitched into a smooth video with cinematic pan/zoom effects, narration overlays, and scene transitions.' },
  { icon: '🔒', title: 'Privacy First', desc: 'Your profile stays on your device. No account required to start. Your data, your control.' },
  { icon: '☁️', title: 'Cloud Storage', desc: 'All generated images and videos are stored securely in Cloudflare R2 — accessible anywhere, anytime.' },
]

const steps = [
  {
    title: 'Chat About Your Brand',
    desc: 'Tell AI your story, your niche, your audience, and your message. The more you share, the better the video.',
    visual: `<div class="sv-bubble ai">What transformation do you help your clients achieve?</div>
             <div class="sv-bubble user">I help introverts build confident public speaking skills…</div>`,
  },
  {
    title: 'AI Writes Your Script',
    desc: 'Say "create video" and Claude generates a complete multi-scene script with narration, image prompts, and timing.',
    visual: `<div class="sv-scene"><span class="sv-n">1</span> Hook — "Most people think public speaking is a talent…"</div>
             <div class="sv-scene"><span class="sv-n">2</span> Problem — "The real issue is not skill, it's…"</div>
             <div class="sv-scene"><span class="sv-n">3</span> Solution — "Here's the 3-step framework I use…"</div>`,
  },
  {
    title: 'Generate & Download',
    desc: 'Illustrated images are created for each scene using your photo as reference, then combined into a ready-to-post video.',
    visual: `<div class="sv-download"><span class="dl-icon">📹</span><div><div class="dl-name">brand-video.webm</div><div class="dl-size">HD 1280×720 · 42 MB</div></div><span class="dl-btn">⬇</span></div>`,
  },
]

const testimonials = [
  { name: 'Sarah K.', role: 'Digital Marketing Coach', color: '#7c5cfc', featured: false, quote: "I've been avoiding video for 2 years because I hate being on camera. BrandMe AI solved that completely. My first video got 4,000 views." },
  { name: 'Marcus R.', role: 'Finance & Investing Creator', color: '#22c55e', featured: true, quote: "The AI asked me questions I'd never thought about. By the end of the chat I had a clearer brand message AND a video. Incredible product." },
  { name: 'Jenna T.', role: 'Wellness & Life Coach', color: '#f59e0b', featured: false, quote: "I used to spend $500 per video on a videographer. Now I create content every week for almost nothing. The illustrations look amazing." },
]

const plans = [
  { name: 'Free', price: '$0', desc: 'Perfect for trying it out', featured: false, cta: 'Get Started Free',
    features: ['✓ 3 videos per month', '✓ Up to 5 scenes per video', '✓ AI strategy chat', '✓ Basic illustrations', '✗ Cloud storage', '✗ HD export'] },
  { name: 'Pro', price: '$29', desc: 'For serious personal brands', featured: true, cta: 'Start Pro Trial',
    features: ['✓ Unlimited videos', '✓ Up to 10 scenes per video', '✓ Advanced AI chat', '✓ HD caricature illustrations', '✓ Cloud storage (10 GB)', '✓ HD export + download'] },
  { name: 'Business', price: '$99', desc: 'For teams and agencies', featured: false, cta: 'Contact Sales',
    features: ['✓ Everything in Pro', '✓ 5 team members', '✓ Brand kit & templates', '✓ Priority support', '✓ Cloud storage (100 GB)', '✓ Custom watermark'] },
]

const footerLinks = [
  { title: 'Product', links: [{ label: 'Features', href: '#features' }, { label: 'How It Works', href: '#how' }, { label: 'Pricing', href: '#pricing' }, { label: 'Launch App', href: '/app' }] },
  { title: 'Company', links: [{ label: 'About', href: '#' }, { label: 'Blog', href: '#' }, { label: 'Careers', href: '#' }, { label: 'Contact', href: '#' }] },
  { title: 'Legal', links: [{ label: 'Privacy Policy', href: '#' }, { label: 'Terms of Service', href: '#' }, { label: 'Cookie Policy', href: '#' }] },
]
</script>

<style scoped>
/* ── Navbar ── */
.navbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  transition: background 0.3s, border-color 0.3s;
  border-bottom: 1px solid transparent;
}
.navbar.scrolled {
  background: rgba(13,13,15,0.92);
  backdrop-filter: blur(12px);
  border-color: var(--border);
}
.nav-inner {
  display: flex;
  align-items: center;
  gap: 32px;
  height: 68px;
}
.nav-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  flex-shrink: 0;
}
.logo-icon { font-size: 24px; }
.nav-links {
  display: flex;
  gap: 32px;
  flex: 1;
}
.nav-links a {
  color: var(--text2);
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  transition: color 0.2s;
}
.nav-links a:hover { color: var(--text); }
.nav-actions { display: flex; gap: 10px; margin-left: auto; }
.hamburger {
  display: none;
  flex-direction: column;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  margin-left: auto;
}
.hamburger span {
  display: block;
  width: 22px;
  height: 2px;
  background: var(--text);
  border-radius: 2px;
  transition: all 0.3s;
}

/* ── Hero ── */
.hero {
  padding: 160px 0 100px;
  position: relative;
  overflow: hidden;
}
.hero-glow {
  position: absolute;
  top: -200px; left: 50%;
  transform: translateX(-50%);
  width: 900px; height: 600px;
  background: radial-gradient(ellipse, rgba(124,92,252,0.18) 0%, transparent 70%);
  pointer-events: none;
}
.hero-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(124,92,252,0.1);
  border: 1px solid rgba(124,92,252,0.25);
  color: var(--accent);
  border-radius: 20px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 24px;
  letter-spacing: 0.3px;
}
.hero-headline {
  font-size: clamp(38px, 6vw, 72px);
  font-weight: 900;
  letter-spacing: -1.5px;
  line-height: 1.1;
  margin-bottom: 24px;
}
.hero-sub {
  color: var(--text2);
  font-size: clamp(16px, 2vw, 19px);
  max-width: 560px;
  margin-bottom: 40px;
  line-height: 1.6;
}
.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; margin-bottom: 40px; }
.hero-proof {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text2);
  font-size: 14px;
  margin-bottom: 64px;
}
.proof-avatars { display: flex; }
.proof-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 2px solid var(--bg);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; color: #fff;
  margin-left: -8px;
}
.proof-avatars .proof-avatar:first-child { margin-left: 0; }

/* Mock preview */
.hero-preview {
  width: 100%;
  max-width: 720px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0,0,0,0.5);
}
.preview-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot.r { background: #ef4444; }
.dot.y { background: #f59e0b; }
.dot.g { background: #22c55e; }
.preview-url {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text2);
  font-family: monospace;
}
.preview-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
.mock-chat {
  padding: 20px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mock-msg {
  border-radius: 14px;
  padding: 10px 13px;
  font-size: 13px;
  line-height: 1.45;
  max-width: 88%;
}
.mock-msg.ai {
  background: var(--bg3);
  color: var(--text);
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}
.mock-msg.user {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: #fff;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.mock-action { margin-top: 4px; }
.mock-scenes { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.mock-scene { display: flex; gap: 10px; align-items: center; }
.mock-scene-img {
  width: 48px; height: 48px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.mock-scene-title { font-size: 12px; font-weight: 600; margin-bottom: 3px; }
.mock-scene-status { font-size: 11px; }
.mock-scene-status.done { color: var(--success); }
.mock-scene-status.gen { color: var(--warn); }

/* ── Social proof ── */
.logos-section {
  padding: 32px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.logos-label { text-align: center; color: var(--text2); font-size: 13px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
.logos-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.logo-pill {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 6px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text2);
}

/* ── Features ── */
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.feature-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px;
  transition: border-color 0.2s, transform 0.2s;
}
.feature-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.feature-icon { font-size: 32px; margin-bottom: 16px; }
.feature-card h3 { font-size: 17px; font-weight: 700; margin-bottom: 10px; }
.feature-card p { color: var(--text2); font-size: 14px; line-height: 1.6; }

/* ── How it works ── */
.how { background: var(--bg2); }
.steps { display: flex; flex-direction: column; gap: 0; max-width: 840px; margin: 0 auto; }
.step-wrapper { display: flex; flex-direction: column; align-items: center; }
.step {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
}
.step-left { display: flex; flex-direction: column; gap: 16px; }
.step-num {
  font-size: 48px;
  font-weight: 900;
  color: transparent;
  -webkit-text-stroke: 2px var(--accent);
  line-height: 1;
}
.step-content h3 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.step-content p { color: var(--text2); font-size: 14px; line-height: 1.6; }
.step-visual {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step-divider {
  font-size: 24px;
  color: var(--accent);
  padding: 12px 0;
}
.sv-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.45;
}
.sv-bubble.ai { background: var(--bg2); color: var(--text); align-self: flex-start; max-width: 90%; }
.sv-bubble.user { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; align-self: flex-end; max-width: 90%; }
.sv-scene {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.sv-scene:last-child { border-bottom: none; }
.sv-n {
  background: var(--accent);
  color: #fff;
  width: 20px; height: 20px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  flex-shrink: 0;
}
.sv-download {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg2);
  border: 1px solid var(--success);
  border-radius: 10px;
  padding: 14px;
}
.dl-icon { font-size: 28px; }
.dl-name { font-size: 14px; font-weight: 600; }
.dl-size { font-size: 12px; color: var(--text2); margin-top: 2px; }
.dl-btn {
  margin-left: auto;
  background: var(--success);
  color: #fff;
  width: 32px; height: 32px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
}

/* ── Testimonials ── */
.testimonials-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.testimonial-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px;
}
.testimonial-card.featured {
  border-color: var(--accent);
  background: linear-gradient(135deg, rgba(124,92,252,0.08), rgba(196,113,245,0.05));
}
.stars { color: var(--warn); font-size: 16px; margin-bottom: 14px; }
.testimonial-card p { color: var(--text2); font-size: 14px; line-height: 1.65; font-style: italic; margin-bottom: 20px; }
.testimonial-author { display: flex; align-items: center; gap: 12px; }
.t-avatar {
  width: 40px; height: 40px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: #fff;
  font-size: 16px;
  flex-shrink: 0;
}
.testimonial-author strong { font-size: 14px; }
.testimonial-author span { font-size: 12px; color: var(--text2); }

/* ── Pricing ── */
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  align-items: start;
}
.pricing-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  position: relative;
}
.pricing-card.featured {
  border-color: var(--accent);
  background: linear-gradient(180deg, rgba(124,92,252,0.07) 0%, var(--card) 60%);
  transform: scale(1.03);
}
.plan-badge {
  position: absolute;
  top: -12px; left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: #fff;
  border-radius: 20px;
  padding: 4px 14px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.plan-name { font-size: 17px; font-weight: 700; margin-bottom: 12px; }
.plan-price { display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px; }
.price-num { font-size: 42px; font-weight: 900; letter-spacing: -1px; }
.price-period { color: var(--text2); font-size: 15px; }
.plan-desc { color: var(--text2); font-size: 14px; margin-bottom: 24px; }
.plan-features {
  list-style: none;
  margin-bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.plan-features li { font-size: 14px; color: var(--text2); }
.plan-features li:first-child,
.plan-features li:nth-child(2),
.plan-features li:nth-child(3),
.plan-features li:nth-child(4) { color: var(--text); }

/* ── Final CTA ── */
.final-cta-section { background: var(--bg2); }
.cta-box {
  position: relative;
  text-align: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 72px 48px;
  overflow: hidden;
}
.cta-glow {
  position: absolute;
  top: -100px; left: 50%;
  transform: translateX(-50%);
  width: 600px; height: 300px;
  background: radial-gradient(ellipse, rgba(124,92,252,0.2) 0%, transparent 70%);
  pointer-events: none;
}
.cta-box h2 { font-size: 40px; font-weight: 800; margin-bottom: 16px; position: relative; }
.cta-box p { color: var(--text2); font-size: 17px; margin-bottom: 36px; position: relative; }
.cta-box .btn { position: relative; }

/* ── Footer ── */
.site-footer { background: var(--bg2); border-top: 1px solid var(--border); padding-top: 64px; }
.footer-inner {
  display: grid;
  grid-template-columns: 2fr 3fr;
  gap: 64px;
  padding-bottom: 48px;
}
.footer-brand p { color: var(--text2); font-size: 14px; margin-top: 14px; max-width: 280px; line-height: 1.6; }
.footer-links { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }
.footer-col h4 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text2); margin-bottom: 16px; }
.footer-col a { display: block; color: var(--text2); text-decoration: none; font-size: 14px; margin-bottom: 10px; transition: color 0.2s; }
.footer-col a:hover { color: var(--text); }
.footer-bottom {
  border-top: 1px solid var(--border);
  padding: 20px 0;
}
.footer-bottom-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text2);
}
.footer-social { display: flex; gap: 16px; }
.footer-social a { color: var(--text2); text-decoration: none; font-size: 16px; transition: color 0.2s; }
.footer-social a:hover { color: var(--text); }

/* ── Auth modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 16px;
}
.modal-box {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 40px 36px;
  width: 100%;
  max-width: 420px;
  position: relative;
}
.modal-close {
  position: absolute;
  top: 16px; right: 16px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text2);
  width: 32px; height: 32px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.modal-logo { font-size: 36px; text-align: center; margin-bottom: 12px; }
.modal-box h2 { font-size: 22px; font-weight: 800; text-align: center; margin-bottom: 6px; }
.modal-sub { color: var(--text2); font-size: 14px; text-align: center; margin-bottom: 28px; }
.modal-switch { text-align: center; color: var(--text2); font-size: 14px; margin-top: 20px; }
.modal-switch button { background: none; border: none; color: var(--accent); font-size: 14px; cursor: pointer; font-weight: 600; }
.terms { font-size: 12px; color: var(--text2); text-align: center; margin-top: 12px; }
.terms a { color: var(--accent); text-decoration: none; }

/* ── Modal transition ── */
.modal-enter-active, .modal-leave-active { transition: opacity 0.25s, transform 0.25s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal-box, .modal-leave-to .modal-box { transform: scale(0.95) translateY(10px); }

/* ── Responsive ── */
@media (max-width: 900px) {
  .features-grid { grid-template-columns: repeat(2, 1fr); }
  .testimonials-grid { grid-template-columns: 1fr; }
  .pricing-grid { grid-template-columns: 1fr; }
  .pricing-card.featured { transform: none; }
  .footer-inner { grid-template-columns: 1fr; gap: 40px; }
  .footer-links { grid-template-columns: repeat(2, 1fr); }
  .preview-body { grid-template-columns: 1fr; }
  .mock-scenes { display: none; }
  .step { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .nav-links { display: none; position: absolute; top: 68px; left: 0; right: 0; background: var(--bg2); border-bottom: 1px solid var(--border); flex-direction: column; padding: 16px 24px; gap: 20px; }
  .nav-links.open { display: flex; }
  .nav-actions { display: none; }
  .hamburger { display: flex; }
  .features-grid { grid-template-columns: 1fr; }
  .cta-box { padding: 40px 24px; }
  .cta-box h2 { font-size: 28px; }
  .footer-links { grid-template-columns: 1fr; }
  .hero { padding: 120px 0 60px; }
}
</style>
