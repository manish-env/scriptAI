/** Replicate models + illustration prompts for scene / flipbook generation */

export const REPLICATE_MODELS = {
  /** Pose edits, scene placement, and hero stylization — single model for all frames */
  kontext: 'black-forest-labs/flux-kontext-pro',
  /** Image-to-video generation for Video Mode scenes (~5s clips) — version hash required */
  videoI2VVersion: 'e2870aa4965fd9ddfd87c16a3c8ab952c18e745e63f3f3b123c2dc8b538ad2b5',
} as const

/** Single source of truth for art style — used in every prompt so every frame looks the same */
export const ILLUSTRATION_STYLE =
  'semi-realistic digital illustration: cinematic 3D shading and lighting, realistic face proportions with slight illustration stylization, rich color depth, detailed environment and props, professional brand illustration quality, like high-end animated series concept art or editorial brand storytelling art — NOT flat, NOT vector, NOT cartoon exaggeration'

export const ILLUSTRATION_NEGATIVE =
  'photorealistic DSLR photograph, flat vector art, 2D cartoon, bold outlines, cel shading, anime, chibi, mascot, caricature with exaggerated proportions, watercolor, sketch lines, 3D CGI plastic render, pixar style, watermark, blurry, wrong face, different person, plain white studio void'

export function imageDataUri(base64: string, mime: 'image/jpeg' | 'image/png' = 'image/png') {
  if (base64.startsWith('data:')) return base64
  return `data:${mime};base64,${base64}`
}

export function buildHeroPrompt(name: string, niche: string, characterDescription: string) {
  return [
    `Art style: ${ILLUSTRATION_STYLE}.`,
    'Convert this person into that illustration style while preserving their exact identity.',
    characterDescription || `Professional ${niche} expert, ${name}.`,
    'Keep exact face structure, skin tone, hair color, eye shape — realistic proportions, no exaggeration.',
    'Head and shoulders portrait, soft studio lighting, clean gradient background, 16:9.',
  ].join(' ')
}

export function buildSceneEstablishPromptKontext(
  imagePrompt: string,
  characterDescription: string,
  pose: string,
  mood: string,
) {
  return [
    `Art style: ${ILLUSTRATION_STYLE}. Maintain this exact illustration style from the input image.`,
    `Scene: ${imagePrompt}. Rich detailed background with realistic depth, props and lighting.`,
    `Character (keep identical — same face, skin tone, hair, outfit): ${characterDescription}`,
    `Pose: ${pose}. Expression and mood: ${mood}. Realistic body proportions.`,
    'Full environment clearly visible. Cinematic 16:9 wide framing. Character interacts naturally with the environment.',
  ].join(' ')
}

export function buildPoseEditPrompt(pose: string) {
  return [
    `Change ONLY the character's body pose and facial expression to: ${pose}.`,
    'Preserve EXACTLY: the illustration style, background scene, all furniture and props, lighting, colors, camera angle, character face, hair, skin tone, and outfit.',
    'The result must look like the same frame with only the pose changed — nothing else moves.',
  ].join(' ')
}

export function pickPollOutput(output: string | string[] | null | undefined): string {
  if (!output) throw new Error('Empty model output')
  if (Array.isArray(output)) {
    const first = output.find(u => typeof u === 'string' && u.length > 0)
    if (!first) throw new Error('Empty model output array')
    return first
  }
  return output
}
