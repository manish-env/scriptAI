/** Replicate models + illustration prompts for scene / flipbook generation */

export const REPLICATE_MODELS = {
  /** Identity + new scene/background from reference photo */
  character: 'sdxl-based/consistent-character',
  /** Pose edits & hero stylization while keeping face + scene */
  kontext: 'black-forest-labs/flux-kontext-pro',
} as const

export const ILLUSTRATION_STYLE =
  'editorial vector caricature, professional magazine illustration, clean confident linework, subtle realistic proportions, refined portrait art, adult sophisticated look'

export const ILLUSTRATION_NEGATIVE =
  'chibi, anime, childish cartoon, mascot, 3d pixar, plastic doll, grotesque, overly cute, big cartoon eyes, photorealistic DSLR photograph, different person, different face, wrong identity, duplicate, blurry, watermark, plain white void, generic grey studio'

export function imageDataUri(base64: string, mime: 'image/jpeg' | 'image/png' = 'image/png') {
  if (base64.startsWith('data:')) return base64
  return `data:${mime};base64,${base64}`
}

export function buildSceneEstablishPromptKontext(
  imagePrompt: string,
  characterDescription: string,
  pose: string,
  mood: string,
) {
  return [
    `Place this exact person in this location: ${imagePrompt}`,
    `Character (keep identity): ${characterDescription}`,
    `Pose: ${pose}. Mood: ${mood}.`,
    ILLUSTRATION_STYLE,
    'Wide cinematic shot, full environment and background clearly visible, 16:9, not a plain studio backdrop.',
  ].join(' ')
}

export function buildHeroPrompt(name: string, niche: string, characterDescription: string) {
  return [
    `Transform this person into ${ILLUSTRATION_STYLE}.`,
    characterDescription || `Professional ${niche} expert named ${name}.`,
    'Same person, identical face, hair, and skin tone, flattering subtle caricature exaggeration only.',
    'Head and shoulders portrait, soft neutral background, 16:9 composition.',
  ].join(' ')
}

export function buildSceneEstablishPromptCharacterModel(
  imagePrompt: string,
  characterDescription: string,
  pose: string,
  mood: string,
) {
  return [
    `LOCATION (draw this exact place): ${imagePrompt}`,
    characterDescription,
    `Pose: ${pose}. Mood: ${mood}.`,
    ILLUSTRATION_STYLE,
    'Wide shot showing full environment, cinematic 16:9 framing.',
  ].join(' ')
}

export function buildPoseEditPrompt(pose: string) {
  return [
    `Change only this person's body pose and expression to: ${pose}.`,
    'Keep the exact same background, room, furniture, props, lighting, colors, camera angle, and illustration style.',
    'Keep the same face, hair, skin tone, outfit, and identity — do not change the environment.',
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
