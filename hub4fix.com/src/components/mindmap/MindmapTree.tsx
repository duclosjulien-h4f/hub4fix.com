import { useState, useRef, useCallback, useEffect } from 'react'
import type { MindmapProps } from '../../types'
import styles from './MindmapTree.module.css'

/* ── SVG helpers ── */
function svgCurve(x1: number, y1: number, x2: number, y2: number, color: string, opacity: number, organic?: boolean): string {
  const dx = x2 - x1
  const cp = Math.min(Math.abs(dx) * 0.45, 40)
  const jy1 = organic ? (Math.random() - 0.5) * 8 : 0
  const jy2 = organic ? (Math.random() - 0.5) * 8 : 0
  const delay = organic ? (Math.random() * 0.3).toFixed(2) : '0'
  return `<path d="M${x1},${y1} C${x1 + cp},${y1 + jy1} ${x2 - cp},${y2 + jy2} ${x2},${y2}" stroke="${color}" opacity="${opacity}" style="animation-delay:${delay}s"/>`
}

function svgDot(x: number, y: number, r: number, color: string): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`
}

/* ── Align child column to parent ── */
function alignColumn(colEl: HTMLElement | null, parentEl: HTMLElement | null) {
  if (!colEl) return
  colEl.style.paddingTop = ''
  if (!parentEl || !colEl.firstElementChild) return
  const pR = parentEl.getBoundingClientRect()
  const cR = (colEl.firstElementChild as HTMLElement).getBoundingClientRect()
  const diff = (pR.top + pR.height / 2) - (cR.top + cR.height / 2)
  if (diff > 4) {
    colEl.style.paddingTop = (parseFloat(getComputedStyle(colEl).paddingTop) + diff) + 'px'
  }
}

export default function MindmapTree({
  tree,
  direction = 'ltr',
  interaction = 'hover',
  debounceMs = 200,
  alignToParent = true,
  organic = false,
  onSelect,
  className = '',
}: MindmapProps) {
  const [activeLevel0, setActiveLevel0] = useState<number | null>(null)
  const [activeLevel1, setActiveLevel1] = useState<number | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const col2Ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeNode0 = activeLevel0 !== null ? tree[activeLevel0] : null
  const children1 = activeNode0?.children ?? []
  const color0 = activeNode0?.color ?? 'var(--gold)'

  /* ── Draw SVG wires ── */
  const drawWires = useCallback(() => {
    const svg = svgRef.current
    const map = mapRef.current
    if (!svg || !map) return
    const box = map.getBoundingClientRect()
    let p = ''

    // Find active level-0 pill
    const activePill = map.querySelector(`.${styles.pill0}.${styles.active}`) as HTMLElement | null
    if (activePill) {
      const aR = activePill.getBoundingClientRect()
      const isRtl = direction === 'rtl'
      const ax = isRtl ? (aR.left - box.left) : (aR.right - box.left)
      const ay = aR.top + aR.height / 2 - box.top
      const col = activePill.dataset.color ?? '#B8963E'

      p += svgDot(ax, ay, 2.5, col)

      // Wires to level-1 pills
      map.querySelectorAll<HTMLElement>(`.${styles.pill1}`).forEach(el => {
        const eR = el.getBoundingClientRect()
        if (eR.height === 0) return
        const ex = isRtl ? (eR.right - box.left) : (eR.left - box.left)
        const ey = eR.top + eR.height / 2 - box.top
        if (isRtl) {
          p += svgCurve(ex, ey, ax, ay, col, 0.3, organic)
        } else {
          p += svgCurve(ax, ay, ex, ey, col, 0.3, organic)
        }
        p += svgDot(ex, ey, 1.5, col)
      })
    }
    svg.innerHTML = p
  }, [direction, organic])

  /* ── Align + redraw on level change ── */
  useEffect(() => {
    if (alignToParent && col2Ref.current) {
      const activePill = mapRef.current?.querySelector(`.${styles.pill0}.${styles.active}`) as HTMLElement | null
      alignColumn(col2Ref.current, activePill)
    }
    drawWires()
  }, [activeLevel0, activeLevel1, alignToParent, drawWires])

  /* ── Resize handler ── */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onResize = () => { clearTimeout(timer); timer = setTimeout(drawWires, 200) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [drawWires])

  /* ── Interaction handlers ── */
  function handleLevel0(index: number) {
    if (tree[index].locked) return
    setActiveLevel0(index)
    setActiveLevel1(null)
  }

  function handleLevel1(index: number) {
    const node = children1[index]
    setActiveLevel1(index)
    if (onSelect && !node.branch && !node.children?.length) {
      onSelect(node, [activeNode0!, node])
    }
  }

  function makeEnterHandler(handler: (i: number) => void, index: number) {
    if (interaction === 'click') return undefined
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => handler(index), debounceMs)
    }
  }

  function makeLeaveHandler() {
    if (interaction === 'click') return undefined
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }

  function makeClickHandler(handler: (i: number) => void, index: number) {
    if (interaction === 'hover') return undefined
    return () => handler(index)
  }

  /* ── Render ── */
  const gridClass = [
    styles.grid,
    direction === 'rtl' ? styles.rtl : '',
    className,
  ].filter(Boolean).join(' ')

  const col0Class = [styles.col, activeLevel0 !== null ? styles.hasSel : ''].filter(Boolean).join(' ')

  // Level-0 pills (branches)
  const level0Pills = tree.map((node, i) => {
    const isActive = activeLevel0 === i
    const pillClass = [
      styles.pill0,
      isActive ? styles.active : '',
      node.locked ? styles.locked : '',
    ].filter(Boolean).join(' ')

    return (
      <div
        key={node.id}
        className={pillClass}
        data-color={node.color}
        style={{
          borderColor: isActive ? node.color : (node.color + '30'),
          background: isActive ? node.color : '',
          color: isActive ? 'white' : node.color,
        }}
        onMouseEnter={makeEnterHandler(handleLevel0, i)}
        onMouseLeave={makeLeaveHandler()}
        onClick={makeClickHandler(handleLevel0, i)}
      >
        {node.label}
        {node.locked && <span className={styles.lock}>&#x1F512;</span>}
      </div>
    )
  })

  // Level-1 pills (leaves)
  const level1Pills = children1.map((node, i) => {
    const isActive = activeLevel1 === i
    const pillClass = [
      styles.pill1,
      isActive ? styles.active : '',
    ].filter(Boolean).join(' ')

    const leafColor = color0

    return node.href ? (
      <a
        key={node.id}
        href={node.href}
        className={[pillClass, styles.anim].join(' ')}
        style={{
          animationDelay: `${i * 80}ms`,
          borderColor: leafColor + '40',
          color: leafColor,
          background: leafColor + '18',
        }}
      >
        {node.label}
        {node.badge && <span className={styles.badge}>{node.badge}</span>}
      </a>
    ) : (
      <div
        key={node.id}
        className={[pillClass, styles.anim].join(' ')}
        style={{
          animationDelay: `${i * 80}ms`,
          borderColor: leafColor + '40',
          color: leafColor,
          background: leafColor + '18',
        }}
        onMouseEnter={makeEnterHandler(handleLevel1, i)}
        onMouseLeave={makeLeaveHandler()}
        onClick={makeClickHandler(handleLevel1, i)}
      >
        {node.label}
        {node.badge && <span className={styles.badge}>{node.badge}</span>}
      </div>
    )
  })

  return (
    <div className={styles.map} ref={mapRef}>
      <svg className={styles.svg} ref={svgRef} />
      <div className={gridClass}>
        <div className={col0Class}>{level0Pills}</div>
        <div className={styles.col} ref={col2Ref}>{level1Pills}</div>
      </div>
    </div>
  )
}
