/**
 * Skill invocation and skill discovery are Mini-owned in the SSH SKU. Keep the
 * stream invalidation hook callable without registering the draft provider or
 * fetching the skill catalog.
 */
export function invalidateSkillSuggestionIndex(): void {}
