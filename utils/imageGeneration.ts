/** Replicate models + illustration prompts for scene / flipbook generation */

export const REPLICATE_MODELS = {
  /** Pose edits, scene placement, and hero stylization — single model for all frames */
  kontext: 'black-forest-labs/flux-kontext-pro',
} as const

/** Single source of truth for art style — used in every prompt so every frame looks the same */
export const ILLUSTRATION_STYLE =
  'semi-realistic vector illustration: sharp clean linework, bold flat colors with minimal gradient shading, professional editorial character art, consistent warm color palette, crisp defined edges, 2.5D infographic look, NOT photorealistic, NOT anime, NOT cartoon'

export const ILLUSTRATION_NEGATIVE =
  'photorealistic DSLR photograph, hyperrealistic, anime, chibi, cartoon, mascot, 3d render, pixar, plastic doll, watermark, blurry, different face, different person, wrong identity, plain white void, generic studio backdrop'

export function imageDataUri(base64: string, mime: 'image/jpeg' | 'image/png' = 'image/png') {
  if (base64.startsWith('data:')) return base64
  return `data:${mime};base64,${base64}`
}

export function buildHeroPrompt(name: string, niche: string, characterDescription: string) {
  return [
    `Art style: ${ILLUSTRATION_STYLE}.`,
    'Convert this person into that illustration style.',
    characterDescription || `Professional ${niche} expert, ${name}.`,
    'Preserve exact face structure, hair color, skin tone, and identity — subtle flattering caricature proportions only.',
    'Head and shoulders portrait, clean neutral gradient background, 16:9.',
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
    `Place this character into a new scene: ${imagePrompt}`,
    `Character (keep identical — same face, skin tone, hair, outfit): ${characterDescription}`,
    `Pose: ${pose}. Mood: ${mood}.`,
    'Full environment and background clearly visible. Wide cinematic 16:9 framing.',
  ].join(' ')
}

export function buildPoseEditPrompt(pose: string) {
  return [
    `Change ONLY the character's body pose and expression to: ${pose}.`,
    `Preserve EXACTLY: illustration style (${ILLUSTRATION_STYLE}), background, room, furniture, props, lighting, colors, camera angle, character face, hair, skin tone, and outfit.`,
    'Do not alter anything except the pose and expression.',
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
