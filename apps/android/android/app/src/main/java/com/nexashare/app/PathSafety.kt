package com.nexashare.app

object PathSafety {
  private val reserved = setOf(
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
  )
  private val unsafe = Regex("[<>:\"|?*\\x00-\\x1f]")

  fun sanitizeRelativePath(input: String): String {
    if (input.isEmpty() || input.length > 400) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    val normalized = input.replace('\\', '/')
    if (normalized.startsWith("/") || Regex("^[a-zA-Z]:").containsMatchIn(normalized)) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    val parts = normalized.split('/').filter { it.isNotEmpty() }
    if (parts.isEmpty()) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    return parts.joinToString("/") { sanitizeSegment(it) }
  }

  fun sanitizeSegment(segment: String): String {
    if (segment == "." || segment == "..") {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    if (unsafe.containsMatchIn(segment) || segment.isEmpty() || segment.length > 180) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    val stem = segment.substringBefore('.')
    if (reserved.contains(stem.uppercase())) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    return segment
  }

  fun uniqueName(original: String, attempt: Int): String {
    if (attempt == 0) {
      return original
    }
    val slash = original.lastIndexOf('/')
    val dir = if (slash == -1) "" else original.substring(0, slash + 1)
    val base = if (slash == -1) original else original.substring(slash + 1)
    val dot = base.lastIndexOf('.')
    return if (dot <= 0) "$dir$base ($attempt)" else "$dir${base.substring(0, dot)} ($attempt)${base.substring(dot)}"
  }
}
