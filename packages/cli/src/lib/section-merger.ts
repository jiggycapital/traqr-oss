/**
 * Section Merger — Additive render for CLAUDE.md and other mergeable files.
 *
 * Uses HTML comment markers to delineate Traqr-managed sections:
 *   <!-- traqr:start:section-name -->
 *   ...traqr-managed content...
 *   <!-- traqr:end:section-name -->
 *
 * User content between/above/below markers is preserved on re-render.
 */

export interface ParsedSegment {
  type: 'user' | 'traqr'
  /** Section name (only for traqr segments) */
  name?: string
  /** Full content including markers for traqr segments */
  content: string
}

export interface MergeResult {
  content: string
  sectionsUpdated: string[]
  sectionsAdded: string[]
  userSegmentsPreserved: number
}

const MARKER_START_RE = /<!-- traqr:start:([a-z0-9-]+) -->/
const MARKER_END_PREFIX = '<!-- traqr:end:'

/**
 * Parse a file into alternating user/traqr segments.
 * User content between markers is preserved as separate segments.
 */
export function parseMarkedFile(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  const lines = content.split('\n')
  let cursor = 0

  while (cursor < lines.length) {
    // Look for next start marker
    let startIdx = -1
    let sectionName = ''
    for (let i = cursor; i < lines.length; i++) {
      const match = lines[i].match(MARKER_START_RE)
      if (match) {
        startIdx = i
        sectionName = match[1]
        break
      }
    }

    if (startIdx === -1) {
      // No more markers — rest is user content
      const remaining = lines.slice(cursor).join('\n')
      if (remaining.length > 0) {
        segments.push({ type: 'user', content: remaining })
      }
      break
    }

    // Capture user content before this marker
    if (startIdx > cursor) {
      const userContent = lines.slice(cursor, startIdx).join('\n')
      if (userContent.trim().length > 0) {
        segments.push({ type: 'user', content: userContent })
      }
    }

    // Find matching end marker
    const endMarker = `${MARKER_END_PREFIX}${sectionName} -->`
    let endIdx = -1
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].trim() === endMarker) {
        endIdx = i
        break
      }
    }

    if (endIdx === -1) {
      // Corrupted: start without end — treat rest as user content
      const remaining = lines.slice(startIdx).join('\n')
      segments.push({ type: 'user', content: remaining })
      break
    }

    // Capture traqr section (including markers)
    const sectionContent = lines.slice(startIdx, endIdx + 1).join('\n')
    segments.push({ type: 'traqr', name: sectionName, content: sectionContent })

    cursor = endIdx + 1
  }

  return segments
}

/**
 * Extract named sections from rendered template content.
 * Returns a map of section-name → full content (with markers).
 */
export function parseRenderedSections(rendered: string): Map<string, string> {
  const sections = new Map<string, string>()
  const segments = parseMarkedFile(rendered)

  for (const seg of segments) {
    if (seg.type === 'traqr' && seg.name) {
      sections.set(seg.name, seg.content)
    }
  }

  return sections
}

/**
 * Merge rendered Traqr sections into an existing file,
 * preserving all user content between/around markers.
 *
 * Three cases:
 * 1. Existing has markers → replace traqr sections, keep user content
 * 2. Existing has no markers → append all traqr sections at end
 * 3. New sections in rendered not in existing → append at end
 */
export function mergeMarkedSections(
  existingContent: string,
  renderedContent: string
): MergeResult {
  const renderedSections = parseRenderedSections(renderedContent)
  const existingSegments = parseMarkedFile(existingContent)

  const hasExistingMarkers = existingSegments.some(s => s.type === 'traqr')

  if (!hasExistingMarkers) {
    // Case 2: Legacy file with no markers — append everything
    const separator = existingContent.trim().length > 0 ? '\n\n---\n\n' : ''
    const allSections = Array.from(renderedSections.values()).join('\n\n')

    return {
      content: existingContent.trimEnd() + separator + allSections + '\n',
      sectionsUpdated: [],
      sectionsAdded: Array.from(renderedSections.keys()),
      userSegmentsPreserved: existingContent.trim().length > 0 ? 1 : 0,
    }
  }

  // Case 1 & 3: Existing has markers — replace matching, append new
  const usedSections = new Set<string>()
  const sectionsUpdated: string[] = []
  const parts: string[] = []

  for (const seg of existingSegments) {
    if (seg.type === 'user') {
      parts.push(seg.content)
    } else if (seg.type === 'traqr' && seg.name) {
      usedSections.add(seg.name)
      const newContent = renderedSections.get(seg.name)
      if (newContent) {
        parts.push(newContent)
        sectionsUpdated.push(seg.name)
      } else {
        // Section no longer in rendered output — keep existing
        parts.push(seg.content)
      }
    }
  }

  // Append any new sections not in existing file
  const sectionsAdded: string[] = []
  for (const [name, content] of renderedSections) {
    if (!usedSections.has(name)) {
      parts.push('')
      parts.push(content)
      sectionsAdded.push(name)
    }
  }

  const userCount = existingSegments.filter(s => s.type === 'user').length

  return {
    content: parts.join('\n') + '\n',
    sectionsUpdated,
    sectionsAdded,
    userSegmentsPreserved: userCount,
  }
}
