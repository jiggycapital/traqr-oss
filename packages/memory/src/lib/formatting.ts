/**
 * Memory Formatting - Shared emoji maps and formatting helpers
 *
 * Single source of truth for category/source emoji across the codebase.
 */

// Category emoji for display (Unicode for UI/terminal contexts)
export const CATEGORY_EMOJI: Record<string, string> = {
  gotcha: '\u26a0\ufe0f',
  pattern: '\ud83d\udd04',
  fix: '\ud83d\udd27',
  insight: '\ud83d\udca1',
  question: '\u2753',
  preference: '\ud83c\udfa8',
  convention: '\ud83d\udccf',
}

// Slack-compatible category emoji (for Slack message formatting)
export const CATEGORY_EMOJI_SLACK: Record<string, string> = {
  gotcha: ':warning:',
  pattern: ':repeat:',
  fix: ':wrench:',
  insight: ':bulb:',
  question: ':grey_question:',
  preference: ':art:',
  convention: ':straight_ruler:',
}

// Text-only category markers (for plain text contexts like agent logs)
export const CATEGORY_EMOJI_TEXT: Record<string, string> = {
  gotcha: '|!|',
  pattern: '->',
  fix: '[+]',
  insight: '*',
  question: '?',
  preference: '~',
  convention: '#',
}

// Source type emoji for visual differentiation
export const SOURCE_TYPE_EMOJI: Record<string, string> = {
  pr: '\ud83d\udd00',
  plan: '\ud83d\udccb',
  manual: '\u270d\ufe0f',
  extracted: '\ud83e\udd16',
  bootstrap: '\ud83c\udfd7\ufe0f',
  advisor_session: '\ud83d\udcad',
  web_research: '\ud83c\udf10',
  session: '\ud83d\udcbb',
  codebase_analysis: '\ud83d\udd0d',
}

/**
 * Get category emoji with fallback for unknown categories
 */
export function getCategoryEmoji(
  category: string | undefined,
  style: 'unicode' | 'slack' | 'text' = 'unicode'
): string {
  const map = style === 'slack'
    ? CATEGORY_EMOJI_SLACK
    : style === 'text'
      ? CATEGORY_EMOJI_TEXT
      : CATEGORY_EMOJI
  const fallback = style === 'unicode' ? '\ud83d\udcdd' : style === 'slack' ? ':memo:' : '?'
  return map[category || ''] || fallback
}
