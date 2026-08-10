import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MindmapTree } from '../mindmap'
import type { MindmapNode } from '../../types'
import styles from './Nav.module.css'

const NAV_TREE: MindmapNode[] = [
  { id: 'compte', label: 'Mon compte', color: '#B8963E', children: [
    { id: 'profil', label: 'Profil', href: '/compte#profil' },
    { id: 'commandes', label: 'Commandes', href: '/compte#commandes' },
    { id: 'tokens', label: 'Tokens', badge: '5', href: '/compte#tokens' },
    { id: 'bibliotheque', label: 'Bibliotheque', href: '/compte#bibliotheque' },
    { id: 'alertes', label: 'Alertes', href: '/compte#alertes' },
    { id: 'parametres', label: 'Parametres', href: '/compte#parametres' },
  ]},
  { id: 'partenaire', label: 'Partenaire', color: '#6b5b95', children: [
    { id: 'postuler-printer', label: 'Devenir Printer', href: '/compte#postuler-printer' },
    { id: 'postuler-modelisateur', label: 'Devenir Modelisateur', href: '/compte#postuler-modelisateur' },
  ]},
  { id: 'espace-printer', label: 'Printer', color: '#2c6e9b', children: [
    { id: 'missions', label: 'Missions', href: '/compte#missions' },
    { id: 'gains', label: 'Gains', href: '/compte#gains' },
  ]},
  { id: 'espace-modeler', label: 'Modelisateur', color: '#a0522d', children: [
    { id: 'fichiers', label: 'Fichiers', href: '/compte#fichiers' },
    { id: 'hotlist', label: 'Hot List', href: '/compte#hotlist' },
    { id: 'royalties', label: 'Royalties', href: '/compte#royalties' },
  ]},
]

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuOpen])

  return (
    <nav className={styles.nav}>
      <Link to="/" className={styles.brand}>
        <span className={styles.wordmark}>Hub<sup>4</sup>Fix</span>
      </Link>

      <div className={styles.right}>
        <div className={styles.account} ref={accountRef}>
          <button
            className={styles.accountBtn}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          >
            <svg className={styles.accountIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/>
            </svg>
            <span className={styles.tokenBadge}>5</span>
          </button>

          {menuOpen && (
            <div className={styles.overlay}>
              <div className={styles.header}>
                <div className={styles.avatar}>JD</div>
                <div>
                  <div className={styles.name}>Julien D.</div>
                  <div className={styles.email}>demo@hub4fix.com</div>
                </div>
              </div>
              <MindmapTree
                tree={NAV_TREE}
                direction="rtl"
                interaction="hover"
                debounceMs={180}
                alignToParent
                organic
                onSelect={(node: MindmapNode) => {
                  if (node.href) {
                    window.location.href = node.href
                    setMenuOpen(false)
                  }
                }}
              />
              <Link to="/login" className={styles.logout} onClick={() => setMenuOpen(false)}>
                Deconnexion
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
