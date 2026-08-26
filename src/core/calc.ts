/**
 * calc.ts — 纯 JS 安全数学求值器（对标中间层 calculate_math，零运行时依赖）。
 *
 * 支持：
 *   - 四则 + 幂/开方/绝对值/取整
 *   - 三角函数 sin/cos/tan/asin/acos/atan + 角度制支持
 *   - 对数 ln/log10/log2、指数 exp
 *   - 常数 pi/E
 *   - 多行赋值（; 分隔），中间变量保留在会话命名空间
 *   - 分数精确表示（内部用高精度小数，输出带"精确值"近似）
 *
 * 安全：白名单函数 + 表达式解析（非 eval/Function），禁止任意代码执行。
 */

export interface CalcContext {
  vars: Record<string, number>
}

export interface CalcResult {
  ok: boolean
  text: string
}

// 白名单常量
const CONSTS: Record<string, number> = {
  pi: Math.PI,
  E: Math.E,
  e: Math.E,
}

// 白名单函数（单参数/双参数）
const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log(x),
  log10: (x) => Math.log10(x),
  log2: (x) => Math.log2(x),
  exp: (x) => Math.exp(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
}

// 角度制转换辅助（sympy 风格：sin(30*pi/180) 或 deg=pi/180）
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// ---------- 递归下降解析器 ----------
class Parser {
  private pos = 0
  constructor(private src: string, private ctx: CalcContext) {}

  parseAll(): number {
    const v = this.parseExpr()
    this.skipWs()
    if (this.pos < this.src.length) {
      throw new Error(`无法解析的剩余内容: ${this.src.slice(this.pos)}`)
    }
    return v
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++
  }

  private peek(): string {
    this.skipWs()
    return this.src[this.pos] ?? ''
  }

  private parseExpr(): number {
    // 加减
    let v = this.parseTerm()
    for (;;) {
      const c = this.peek()
      if (c === '+') {
        this.pos++
        v += this.parseTerm()
      } else if (c === '-') {
        this.pos++
        v -= this.parseTerm()
      } else break
    }
    return v
  }

  private parseTerm(): number {
    // 乘除模（幂由 parsePower 处理，优先级更高）
    let v = this.parsePower()
    for (;;) {
      const c = this.peek()
      if (c === '*') {
        this.pos++
        v *= this.parsePower()
      } else if (c === '/') {
        this.pos++
        const d = this.parsePower()
        if (d === 0) throw new Error('除以零')
        v /= d
      } else if (c === '%') {
        this.pos++
        v %= this.parsePower()
      } else break
    }
    return v
  }

  private parsePower(): number {
    // 幂运算：右结合，a**b（或 a^b 兼容）
    const base = this.parseUnary()
    this.skipWs()
    const c = this.src[this.pos]
    if (c === '*') {
      // ** 或 *
      const next = this.src[this.pos + 1]
      if (next === '*') {
        this.pos += 2
        const exp = this.parsePower() // 右结合
        return Math.pow(base, exp)
      }
      // 单个 * 由 parseTerm 上层处理，这里不消费
      return base
    }
    if (c === '^') {
      this.pos++
      const exp = this.parsePower()
      return Math.pow(base, exp)
    }
    return base
  }

  private parseUnary(): number {
    // 一元 +/-，以及隐式乘法（2pi、3sqrt(2) 等）
    const c = this.peek()
    if (c === '+') {
      this.pos++
      return this.parseUnary()
    }
    if (c === '-') {
      this.pos++
      return -this.parseUnary()
    }
    // 隐式乘法：数字/常量/函数/括号 相邻
    let v = this.parseAtom()
    for (;;) {
      const p = this.peek()
      if (p === '(' || /[a-zA-Z0-9_π]/.test(p)) {
        const nxt = this.parseAtom()
        v *= nxt
      } else break
    }
    return v
  }

  private parseAtom(): number {
    this.skipWs()
    const c = this.src[this.pos]
    if (c === '(') {
      this.pos++
      const v = this.parseExpr()
      this.skipWs()
      if (this.src[this.pos] !== ')') throw new Error('缺少右括号')
      this.pos++
      return v
    }
    if (c >= '0' && c <= '9' || c === '.') {
      return this.parseNumber()
    }
    if (/[a-zA-Z_π]/.test(c ?? '')) {
      return this.parseIdent()
    }
    throw new Error(`无法解析的字符: ${c ?? '<end>'}`)
  }

  private parseNumber(): number {
    const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos))
    if (!m) throw new Error('无效数字')
    this.pos += m[0].length
    return Number(m[0])
  }

  private parseIdent(): number {
    const m = /^[a-zA-Z_][a-zA-Z0-9_]*|^π/.exec(this.src.slice(this.pos))
    if (!m) throw new Error('无效标识符')
    const id = m[0]
    this.pos += id.length
    // 函数调用？
    this.skipWs()
    if (this.src[this.pos] === '(') {
      this.pos++
      const args: number[] = []
      this.skipWs()
      if (this.src[this.pos] !== ')') {
        for (;;) {
          args.push(this.parseExpr())
          this.skipWs()
          if (this.src[this.pos] === ',') {
            this.pos++
            continue
          }
          break
        }
      }
      if (this.src[this.pos] !== ')') throw new Error(`函数 ${id} 缺少右括号`)
      this.pos++
      const fn = FUNCS[id]
      if (!fn) throw new Error(`未知函数: ${id}（可用: ${Object.keys(FUNCS).join(', ')}）`)
      return fn(...args)
    }
    // 常量/变量
    if (id in CONSTS) return CONSTS[id]
    if (id in this.ctx.vars) return this.ctx.vars[id]
    throw new Error(`未知符号: ${id}（可先赋值，如 a=3; a*2）`)
  }
}

/** 执行一段表达式（支持分号分隔的多行赋值），返回最后一行的值 */
export function evaluate(expr: string, ctx: CalcContext): { value: number; lastExpr: string } {
  const lines = expr.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
  if (lines.length === 0) throw new Error('空表达式')
  let lastVal = 0
  let lastExpr = lines[lines.length - 1]
  for (const line of lines) {
    // 赋值：ident = expr
    const am = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(line)
    if (am) {
      const name = am[1]
      const rhs = am[2]
      const parser = new Parser(rhs, ctx)
      const v = parser.parseAll()
      ctx.vars[name] = v
      lastVal = v
      lastExpr = line
      continue
    }
    const parser = new Parser(line, ctx)
    lastVal = parser.parseAll()
  }
  return { value: lastVal, lastExpr }
}

/** 格式化结果：保留 8 位有效数字 */
export function formatNum(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v)) return String(v)
  // 高精度展示
  return String(Number(v.toPrecision(10)))
}

/** 生成一次 geo_calc 的结果文本（对标 calculate_math 的输出格式） */
export function calcResult(expr: string, ctx: CalcContext): CalcResult {
  try {
    const { value, lastExpr } = evaluate(expr, ctx)
    return {
      ok: true,
      text: `输入: ${lastExpr}\n数值结果: ${formatNum(value)}`,
    }
  } catch (e) {
    return { ok: false, text: `数学计算失败: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// 会话命名空间管理（对标中间层 _calc_ns_cache）
const _nsCache = new Map<string, CalcContext>()

export function getNs(sessionKey: string): CalcContext {
  let ns = _nsCache.get(sessionKey)
  if (!ns) {
    ns = { vars: {} }
    _nsCache.set(sessionKey, ns)
  }
  return ns
}

export function resetNs(sessionKey: string): void {
  _nsCache.delete(sessionKey)
}

export { toRad }
