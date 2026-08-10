import { MindmapTree } from '../components/mindmap'
import type { MindmapNode } from '../types'

const DEMO_TREE: MindmapNode[] = [
  { id: 'electromenager', label: 'Electromenager', color: '#B8963E', children: [
    { id: 'cafetiere', label: 'Cafetiere' },
    { id: 'aspirateur', label: 'Aspirateur' },
    { id: 'lave-vaisselle', label: 'Lave-vaisselle' },
    { id: 'lave-linge', label: 'Lave-linge' },
    { id: 'robot-cuiseur', label: 'Robot cuiseur' },
    { id: 'friteuse', label: 'Friteuse' },
  ]},
  { id: 'seche-linge', label: 'Seche-linge', color: '#2c6e9b', children: [
    { id: 'condenseur', label: 'Condenseur' },
    { id: 'pompe-chaleur', label: 'Pompe a chaleur' },
  ]},
  { id: 'cuisson', label: 'Four / Cuisson', color: '#a0522d', children: [
    { id: 'four-encastrable', label: 'Four encastrable' },
    { id: 'micro-ondes', label: 'Micro-ondes' },
  ]},
]

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 4rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{
          fontSize: '.68rem', fontWeight: 600, letterSpacing: '.2em',
          textTransform: 'uppercase' as const, color: 'var(--gold)',
          display: 'flex', alignItems: 'center', gap: '.8rem', marginBottom: '1rem'
        }}>
          <span style={{ width: 20, height: 1, background: 'var(--gold)', display: 'inline-block' }} />
          Phase 1 — React + Vite
        </div>
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: '2.2rem',
          fontWeight: 400, color: 'var(--night)', marginBottom: '.5rem'
        }}>
          Hub<sup style={{ color: 'var(--red)', fontSize: '.6em' }}>4</sup>Fix
        </h1>
        <p style={{ fontSize: '.88rem', color: 'var(--earth)', lineHeight: 1.7 }}>
          Composant <code style={{ background: 'var(--cream)', padding: '2px 6px', borderRadius: 4, fontSize: '.8em' }}>&lt;MindmapTree /&gt;</code> generique — le meme code sert pour le selecteur d'imprimante, le selecteur filament, la sidebar compte, et le dropdown nav.
        </p>
      </div>

      <div style={{
        background: 'white', border: '1px solid var(--cream)',
        borderRadius: 16, padding: '1.5rem', marginBottom: '2rem'
      }}>
        <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--stone)', marginBottom: '.8rem', letterSpacing: '.1em', textTransform: 'uppercase' as const }}>
          Demo : interaction hover + alignement vertical + SVG organique
        </div>
        <MindmapTree
          tree={DEMO_TREE}
          direction="ltr"
          interaction="hover"
          debounceMs={200}
          alignToParent
          organic
          onSelect={(_node: MindmapNode, path: MindmapNode[]) => {
            console.log('Selected:', path.map((n: MindmapNode) => n.label).join(' > '))
          }}
        />
      </div>

      <div style={{
        background: 'white', border: '1px solid var(--cream)',
        borderRadius: 16, padding: '1.5rem'
      }}>
        <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--stone)', marginBottom: '.8rem', letterSpacing: '.1em', textTransform: 'uppercase' as const }}>
          Demo : interaction click (mode sidebar)
        </div>
        <MindmapTree
          tree={DEMO_TREE}
          direction="ltr"
          interaction="click"
          alignToParent
          organic={false}
          onSelect={(node: MindmapNode) => {
            console.log('Clicked:', node.label)
          }}
        />
      </div>
    </main>
  )
}
