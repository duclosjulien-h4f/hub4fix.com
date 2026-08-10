import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MindmapTree } from '../src/components/mindmap'
import type { MindmapNode } from '../src/types'

const MOCK_TREE: MindmapNode[] = [
  { id: 'a', label: 'Branch A', color: '#B8963E', children: [
    { id: 'a1', label: 'Leaf A1' },
    { id: 'a2', label: 'Leaf A2' },
  ]},
  { id: 'b', label: 'Branch B', color: '#2c6e9b', children: [
    { id: 'b1', label: 'Leaf B1' },
  ]},
]

describe('MindmapTree', () => {
  it('renders level-0 branches', () => {
    render(<MindmapTree tree={MOCK_TREE} />)
    expect(screen.getByText('Branch A')).toBeDefined()
    expect(screen.getByText('Branch B')).toBeDefined()
  })

  it('does not render level-1 leaves initially', () => {
    render(<MindmapTree tree={MOCK_TREE} />)
    expect(screen.queryByText('Leaf A1')).toBeNull()
  })

  it('renders locked state', () => {
    const locked: MindmapNode[] = [
      { id: 'x', label: 'Locked', color: '#000', locked: true, children: [] },
    ]
    render(<MindmapTree tree={locked} />)
    expect(screen.getByText('Locked')).toBeDefined()
  })

  it('applies RTL direction class', () => {
    const { container } = render(<MindmapTree tree={MOCK_TREE} direction="rtl" />)
    const grid = container.querySelector('[class*="rtl"]')
    expect(grid).toBeDefined()
  })
})
