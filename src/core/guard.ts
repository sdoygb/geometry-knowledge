/**
 * guard.ts — 会话级阅读防护（对标中间层 VIEW-GUARD）。
 * 记录每篇文章的已读区间，检测顺序翻页与累计读取上限。
 */

export interface ReadRange {
  start: number
  end: number
}

const _readRanges = new Map<string, Map<string, ReadRange[]>>() // sessionKey -> fname -> ranges
const _readChars = new Map<string, Map<string, number>>() // sessionKey -> fname -> 累计字符

export const VIEW_CHAR_LIMIT = 25000 // 单文章累计读取上限（与中间层一致）

/**
 * 记录一次读取并返回防护提示（若触发）。
 * @returns 空串 = 正常；非空 = 防护提示文本
 */
export function recordRead(
  sessionKey: string,
  fname: string,
  start: number,
  end: number,
): string {
  if (!sessionKey || !fname) return ''
  const total = Math.max(end - start, 0)

  // 累计字符
  let chars = _readChars.get(sessionKey)
  if (!chars) {
    chars = new Map()
    _readChars.set(sessionKey, chars)
  }
  const prevChars = chars.get(fname) ?? 0
  const newChars = prevChars + total
  chars.set(fname, newChars)
  if (newChars > VIEW_CHAR_LIMIT) {
    return (
      `⚠️ 你已累计读取本文 ${newChars} 字符，超过单篇文章上限 ${VIEW_CHAR_LIMIT} 字符。` +
      `请停止继续翻页读取全文。基于已读内容直接推进推导；如确需特定章节，用 section='章节关键词' 精准跳转；` +
      `或用 geo_search 搜索相关段落。`
    )
  }

  // 已读区间 + 顺序翻页检测
  let ranges = _readRanges.get(sessionKey)
  if (!ranges) {
    ranges = new Map()
    _readRanges.set(sessionKey, ranges)
  }
  const fileRanges = ranges.get(fname) ?? []
  const isPaging = fileRanges.some(
    (r) =>
      (r.start <= start && start <= r.end + 2000) ||
      (r.start <= end && end <= r.end + 2000) ||
      (start <= r.start && r.start <= end + 2000),
  )
  fileRanges.push({ start, end })
  ranges.set(fname, fileRanges)

  if (isPaging && fileRanges.length >= 2) {
    return (
      `⚠️ 检测到你正在顺序翻页读取本文（已读 ${fileRanges.length} 段，累计 ${newChars} 字符）。` +
      `如需读完整篇请直接设 whole=true 一次获取，比逐段翻页省 token；` +
      `如果只是找特定内容，请用 section='章节关键词' 精准定位。`
    )
  }
  return ''
}

/** 清理会话阅读状态 */
export function resetReadState(sessionKey: string): void {
  _readRanges.delete(sessionKey)
  _readChars.delete(sessionKey)
}
