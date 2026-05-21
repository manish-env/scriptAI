const { createApp, ref, reactive, computed, watch, nextTick, onMounted } = Vue;

// ── Storage helpers ────────────────────────────────────────────────────────
const LS = {
  get: (k, fallback = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { console.warn('localStorage full'); } },
  del: (k) => localStorage.removeItem(k),
};

createApp({
  setup() {
    // ── State ──────────────────────────────────────────────────────────────
    const screen = ref('onboard');
    const showVideoPanel = ref(false);
    const aiTyping = ref(false);
    const generatingAll = ref(false);
    const videoUrl = ref(null);
    const selectedScene = ref(0);
    const inputText = ref('');
    const photoInput = ref(null);
    const chatInput = ref(null);
    const messagesWrap = ref(null);
    const previewContent = ref(null);

    const profile = reactive({ name: '', niche: '', photoUrl: null, photoBase64: null });
    const messages = ref([]);
    const toast = reactive({ show: false, message: '', type: 'success' });

    const videoProject = reactive({ title: '', topic: '', scenes: [] });

    // IDs for cloud sync (generated once, persisted in localStorage)
    const userId = ref(LS.get('bm_user_id') || null);
    const sessionId = ref(LS.get('bm_session_id') || null);

    // ── Computed ───────────────────────────────────────────────────────────
    const canStart = computed(() => profile.name.trim() && profile.niche.trim());

    const allImagesReady = computed(() =>
      videoProject.scenes.length > 0 && videoProject.scenes.every(s => s.imageUrl)
    );

    // ── Persistence ────────────────────────────────────────────────────────
    function saveAll() {
      LS.set('bm_profile', { name: profile.name, niche: profile.niche, photoUrl: profile.photoUrl, photoBase64: profile.photoBase64 });
      LS.set('bm_messages', messages.value);
      LS.set('bm_project', { title: videoProject.title, topic: videoProject.topic, scenes: videoProject.scenes.map(s => ({ ...s, generating: false })) });
    }

    function loadAll() {
      const p = LS.get('bm_profile');
      if (p) { profile.name = p.name || ''; profile.niche = p.niche || ''; profile.photoUrl = p.photoUrl || null; profile.photoBase64 = p.photoBase64 || null; }

      const msgs = LS.get('bm_messages');
      if (msgs?.length) { messages.value = msgs; screen.value = 'chat'; }

      const proj = LS.get('bm_project');
      if (proj) { videoProject.title = proj.title || ''; videoProject.topic = proj.topic || ''; videoProject.scenes = (proj.scenes || []).map(s => ({ ...s, generating: false })); }

      // If profile is filled but no messages yet, still skip onboard
      if (p?.name && p?.niche && !msgs?.length) screen.value = 'chat';
    }

    function clearSession() {
      if (!confirm('Start a new video? This will clear the current chat and script.')) return;
      LS.del('bm_messages');
      LS.del('bm_project');
      LS.del('bm_session_id');
      sessionId.value = null;
      messages.value = [];
      videoProject.title = '';
      videoProject.topic = '';
      videoProject.scenes = [];
      videoUrl.value = null;
      showVideoPanel.value = false;
      screen.value = 'chat';
      startChat();
    }

    // ── Cloud sync (fire-and-forget — never blocks the UI) ─────────────────
    async function dbPost(path, body) {
      try {
        await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) { console.warn('DB sync failed', path, e); }
    }

    async function dbPatch(path, body) {
      try {
        await fetch(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) { console.warn('DB sync failed', path, e); }
    }

    async function ensureUser() {
      if (!userId.value) {
        userId.value = crypto.randomUUID();
        LS.set('bm_user_id', userId.value);
      }
      await dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche });
    }

    async function ensureSession() {
      if (!sessionId.value) {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: userId.value }),
        }).then(r => r.json()).catch(() => null);
        if (res?.id) {
          sessionId.value = res.id;
          LS.set('bm_session_id', sessionId.value);
        }
      }
    }

    function syncMessages(msgs) {
      if (!sessionId.value) return;
      dbPost(`/api/sessions/${sessionId.value}/messages`, { messages: msgs.map(m => ({ role: m.role, content: m.content })) });
    }

    function syncScenes(scenes) {
      if (!sessionId.value) return;
      dbPost(`/api/sessions/${sessionId.value}/scenes`, { scenes });
      dbPatch(`/api/sessions/${sessionId.value}`, { title: videoProject.title, topic: videoProject.topic });
    }

    async function uploadSceneImage(replicateUrl, sceneId) {
      if (!userId.value || !sessionId.value) return replicateUrl;
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: replicateUrl, type: 'scene_image', user_id: userId.value, session_id: sessionId.value }),
        }).then(r => r.json());
        if (res.assetUrl) {
          dbPatch(`/api/sessions/${sessionId.value}/scenes`, { scene_id: sceneId, image_key: res.key });
          return res.assetUrl;
        }
      } catch (e) { console.warn('R2 upload failed, using Replicate URL', e); }
      return replicateUrl;
    }

    async function uploadUserPhoto(base64) {
      if (!userId.value || !base64) return;
      try {
        const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
        const dataUrl = URL.createObjectURL(blob);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: dataUrl, type: 'photo', user_id: userId.value }),
        }).then(r => r.json());
        if (res.key) dbPost('/api/user', { id: userId.value, name: profile.name, niche: profile.niche, photo_key: res.key });
      } catch (e) { console.warn('Photo upload failed', e); }
    }

    // ── Onboarding ─────────────────────────────────────────────────────────
    function triggerPhotoUpload() {
      photoInput.value?.click();
    }

    function onPhotoSelected(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        profile.photoUrl = ev.target.result;
        profile.photoBase64 = ev.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    }

    async function startChat() {
      screen.value = 'chat';
      messages.value = [];
      const greeting = `Hi ${profile.name}! 👋 I'm your AI brand strategist. I'll help you create an amazing personal brand video in the **${profile.niche}** space — without showing your face on camera.

Let's start: **What's the main message or story you want your audience to take away from this video?**

Feel free to share your ideas, your audience, what transformation you offer — the more you tell me, the better your video will be!`;
      messages.value.push({ role: 'assistant', content: greeting, suggestCreate: false });

      // Cloud sync — fire and forget
      await ensureUser();
      await ensureSession();
      if (profile.photoBase64) uploadUserPhoto(profile.photoBase64);
    }

    // ── Chat ───────────────────────────────────────────────────────────────
    async function sendMessage() {
      const text = inputText.value.trim();
      if (!text || aiTyping.value) return;
      inputText.value = '';
      resetTextarea();

      messages.value.push({ role: 'user', content: text });
      scrollToBottom();

      // Check if user wants to create video
      const wantsVideo = /\b(create|make|generate|build)\s+(the\s+)?(video|film|content)\b/i.test(text);
      if (wantsVideo) {
        await triggerVideoCreation();
        return;
      }

      aiTyping.value = true;
      scrollToBottom();

      try {
        const reply = await callClaude(buildChatMessages());
        aiTyping.value = false;

        // Detect if AI suggests creating video
        const suggestCreate = /ready to create|shall i create|want me to create|should i build/i.test(reply);
        messages.value.push({ role: 'assistant', content: reply, suggestCreate });
        scrollToBottom();
        syncMessages([{ role: 'user', content: text }, { role: 'assistant', content: reply }]);
      } catch (err) {
        aiTyping.value = false;
        showToast(err.message || 'API error', 'error');
      }
    }

    function buildChatMessages() {
      return messages.value.map(m => ({
        role: m.role,
        content: m.content
      }));
    }

    async function callClaude(msgs, systemOverride = null) {
      const system = systemOverride || `You are an expert personal brand video strategist and content creator.
The user is ${profile.name}, working in the ${profile.niche} niche.
They want to create personal brand videos WITHOUT showing their face — using illustrated caricature-style images.
Your job is to:
1. Chat naturally, ask questions to understand their message, audience, and story
2. Help them craft a compelling video concept
3. When they ask to create a video (or when you have enough info), suggest creating it
4. When creating a video script, structure scenes clearly
Be concise, warm, and actionable. Use markdown for formatting when helpful.`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-7',
          max_tokens: 1500,
          system,
          messages: msgs,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      return data.content[0].text;
    }

    // ── Video Creation ─────────────────────────────────────────────────────
    async function triggerVideoCreation() {
      aiTyping.value = true;
      showVideoPanel.value = true;
      scrollToBottom();

      try {
        const scriptJson = await generateVideoScript();
        videoProject.title = scriptJson.title;
        videoProject.topic = scriptJson.topic;
        videoProject.scenes = scriptJson.scenes.map(s => ({
          ...s,
          imageUrl: null,
          generating: false,
        }));

        aiTyping.value = false;

        const summary = `🎬 **Video script created!** "${scriptJson.title}"

I've written **${scriptJson.scenes.length} scenes** for your video:
${scriptJson.scenes.map((s, i) => `${i + 1}. **${s.title}** — ${s.narration.slice(0, 60)}…`).join('\n')}

Tap the **🎬 button** above to see your scenes and generate illustrated images for each one. Ready?`;

        messages.value.push({ role: 'assistant', content: summary, suggestCreate: false });
        scrollToBottom();
        syncScenes(scriptJson.scenes);
        syncMessages([{ role: 'assistant', content: summary }]);
      } catch (err) {
        aiTyping.value = false;
        showToast(err.message || 'Script generation failed', 'error');
      }
    }

    async function generateVideoScript() {
      const chatHistory = buildChatMessages();

      const system = `You are a professional video script writer specializing in personal brand videos.
The creator is ${profile.name} in the ${profile.niche} niche.
Based on the conversation, create a compelling short video script (60-90 seconds total, 4-6 scenes).

IMPORTANT: Respond ONLY with valid JSON, no markdown, no explanation. Format:
{
  "title": "Video title",
  "topic": "One sentence topic",
  "scenes": [
    {
      "title": "Scene title",
      "narration": "Voiceover text for this scene (2-3 sentences)",
      "imagePrompt": "Detailed prompt for a caricature illustration of ${profile.name || 'the creator'} — warm, professional, fun cartoon style. Describe: pose, expression, background, what they're doing. Scene context: ...",
      "duration": 15,
      "mood": "inspiring"
    }
  ]
}`;

      const msgs = [
        ...chatHistory,
        {
          role: 'user',
          content: 'Based on our conversation, please create the video script JSON now. Respond ONLY with the JSON object.'
        }
      ];

      const raw = await callClaude(msgs, system);

      // Extract JSON from response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse video script from AI response');

      return JSON.parse(jsonMatch[0]);
    }

    // ── Image Generation ───────────────────────────────────────────────────
    async function generateAllImages() {
      generatingAll.value = true;
      const pending = videoProject.scenes
        .map((s, i) => ({ scene: s, index: i }))
        .filter(({ scene }) => !scene.imageUrl);

      for (const { scene, index } of pending) {
        await generateSceneImage(index);
      }
      generatingAll.value = false;
      showToast('All images generated!');
    }

    async function generateSceneImage(index) {
      const scene = videoProject.scenes[index];
      if (scene.imageUrl || scene.generating) return;

      scene.generating = true;

      try {
        const replicateUrl = await callReplicate(scene.imagePrompt, profile.photoBase64);
        scene.imageUrl = await uploadSceneImage(replicateUrl, scene.id);
        scene.generating = false;
      } catch (err) {
        scene.generating = false;
        showToast(`Scene ${index + 1}: ${err.message}`, 'error');
      }
    }

    async function callReplicate(prompt, photoBase64 = null) {
      const fullPrompt = `${prompt}, caricature illustration style, digital art, vibrant colors, warm and professional, personal brand, high quality, 16:9 aspect ratio`;

      const input = {
        prompt: fullPrompt,
        negative_prompt: 'realistic photo, photography, blurry, low quality, nsfw',
        width: 1280,
        height: 720,
        num_outputs: 1,
        scheduler: 'K_EULER',
        num_inference_steps: 30,
        guidance_scale: 7.5,
      };

      if (photoBase64) {
        input.image = `data:image/jpeg;base64,${photoBase64}`;
        input.strength = 0.65;
      }

      const startRes = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
          input,
        }),
      });

      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.detail || `Image API error ${startRes.status}`);
      }

      const prediction = await startRes.json();
      return await pollReplicate(prediction.id);
    }

    async function pollReplicate(predictionId, maxAttempts = 60) {
      for (let i = 0; i < maxAttempts; i++) {
        await sleep(2000);
        const res = await fetch(`/api/image/${predictionId}`);
        const data = await res.json();

        if (data.status === 'succeeded') {
          return Array.isArray(data.output) ? data.output[0] : data.output;
        }
        if (data.status === 'failed') {
          throw new Error(data.error || 'Image generation failed');
        }
      }
      throw new Error('Image generation timed out');
    }

    // ── Video Assembly ─────────────────────────────────────────────────────
    async function assembleVideo() {
      if (!allImagesReady.value) return;

      showToast('Assembling video with canvas…');

      try {
        const url = await buildVideoFromImages(videoProject.scenes);
        videoUrl.value = url;
        showToast('Video ready!');
        nextTick(() => { if (previewContent.value) previewContent.value.scrollTop = 0; });
      } catch (err) {
        showToast('Video assembly failed: ' + err.message, 'error');
      }
    }

    async function buildVideoFromImages(scenes) {
      const W = 1280, H = 720, FPS = 30;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(FPS);
      const chunks = [];
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.start();

      for (const scene of scenes) {
        const img = await loadImage(scene.imageUrl);
        const duration = (scene.duration || 5) * 1000;
        const framesTotal = Math.floor((duration / 1000) * FPS);

        for (let f = 0; f < framesTotal; f++) {
          const progress = f / framesTotal;

          // Ken Burns effect: gentle pan/zoom
          const scale = 1 + 0.05 * progress;
          const tx = -(W * (scale - 1)) / 2 * 0.3 * progress;
          const ty = -(H * (scale - 1)) / 2;

          ctx.save();
          ctx.translate(tx, ty);
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, W, H);
          ctx.restore();

          // Narration text overlay
          drawTextOverlay(ctx, scene.narration, W, H, progress);

          // Scene title at start
          if (f < FPS * 2) {
            const alpha = Math.min(1, f / (FPS * 0.5)) * (1 - Math.max(0, (f - FPS * 1.5) / (FPS * 0.5)));
            drawSceneTitle(ctx, scene.title, W, H, alpha);
          }

          await new Promise(r => setTimeout(r, 1000 / FPS));
        }

        // Fade transition between scenes
        for (let f = 0; f < FPS * 0.5; f++) {
          const alpha = f / (FPS * 0.5);
          ctx.fillStyle = `rgba(0,0,0,${alpha})`;
          ctx.fillRect(0, 0, W, H);
          await new Promise(r => setTimeout(r, 1000 / FPS));
        }
      }

      recorder.stop();

      return new Promise(resolve => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          resolve(URL.createObjectURL(blob));
        };
      });
    }

    function drawTextOverlay(ctx, text, W, H, progress) {
      // Bottom gradient
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Wrap text
      ctx.font = `bold ${W * 0.027}px Segoe UI, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center';

      const maxW = W * 0.8;
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      const lineH = W * 0.033;
      const totalH = lines.length * lineH;
      const startY = H - 60 - totalH;

      lines.forEach((l, i) => {
        ctx.fillText(l, W / 2, startY + i * lineH);
      });
    }

    function drawSceneTitle(ctx, title, W, H, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(124,92,252,0.85)';
      const barH = 48;
      ctx.fillRect(0, H * 0.08 - barH / 2, W * 0.6, barH);
      ctx.font = `bold ${W * 0.025}px Segoe UI, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(title, W * 0.025, H * 0.08 + 8);
      ctx.restore();
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    // ── Utilities ──────────────────────────────────────────────────────────
    function renderMarkdown(text) {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<strong>$1</strong>')
        .replace(/^## (.+)$/gm, '<strong>$1</strong>')
        .replace(/^# (.+)$/gm, '<strong>$1</strong>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
    }

    function scrollToBottom() {
      nextTick(() => {
        if (messagesWrap.value) {
          messagesWrap.value.scrollTop = messagesWrap.value.scrollHeight;
        }
      });
    }

    function autoResize(e) {
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    function resetTextarea() {
      if (chatInput.value) {
        chatInput.value.style.height = 'auto';
      }
    }

    function showToast(message, type = 'success') {
      toast.message = message;
      toast.type = type;
      toast.show = true;
      setTimeout(() => { toast.show = false; }, 3500);
    }

    function sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    // ── Init ───────────────────────────────────────────────────────────────
    onMounted(() => {
      loadAll();
      watch([() => ({ ...profile }), messages, () => ({ ...videoProject, scenes: videoProject.scenes.map(s => ({ ...s })) })], saveAll, { deep: true });
    });

    return {
      screen, showVideoPanel, aiTyping, generatingAll,
      videoUrl, selectedScene, inputText, photoInput, chatInput, messagesWrap, previewContent,
      profile, messages, toast, videoProject, userId, sessionId,
      canStart, allImagesReady,
      triggerPhotoUpload, onPhotoSelected, startChat, clearSession,
      sendMessage, triggerVideoCreation,
      generateAllImages, generateSceneImage,
      assembleVideo, renderMarkdown, autoResize,
    };
  }
}).mount('#app');
