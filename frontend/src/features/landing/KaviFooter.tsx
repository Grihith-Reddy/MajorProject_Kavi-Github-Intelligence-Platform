import { KaviMark } from '../../components/KaviMark'
import { ThemeToggle } from '../theme/ThemeToggle'
import { useResolvedDark } from '../theme/theme'
import { TearFooter } from './TearFooter'
import './tearFooter.css'

const REPO = 'https://github.com/Grihith-Reddy/MinorProject_Kavi-Github-Intelligence-Platform_Grihith'

/** KAVI's footer: the pushpin tear footer with KAVI's links, call to action and day/night colours. */
export function KaviFooter({ onStart, onAnchor, onRoute }: { onStart: () => void; onAnchor: (id: string) => void; onRoute: (path: string) => void }) {
  const dark = useResolvedDark()
  const colours = dark
    ? { sheet: '#0f4c70', paper: '#0f1315', sheetInk: '#eaf3f9', paperInk: '#dbe6ee' }
    : { sheet: '#15aeea', paper: '#f2f3f1', sheetInk: '#ffffff', paperInk: '#181d1f' }

  return (
    <TearFooter
      {...colours}
      brand="KAVI"
      name="pull-request memory"
      logo={<KaviMark size={34} title="KAVI" />}
      logoHref="#main-content"
      socials={[{ icon: 'github', label: 'Source on GitHub', href: REPO }]}
      topAction={<ThemeToggle className="tpf-ib tpf-theme" />}
      cta={{ label: 'your codebase has memory now', button: 'Get started', onClick: onStart }}
      status={{ label: 'free to use, no paid plans' }}
      mark="KAVI / 2.0"
      timeLabel="Your time"
      columns={[
        {
          title: 'product',
          links: [
            { label: 'About', href: '#about' },
            { label: "What's new", href: '#new' },
            { label: 'How it works', href: '#how' },
          ],
          cta: { label: 'start.', href: '/login' },
        },
        {
          title: 'learn',
          links: [
            { label: 'Impact', href: '#impact' },
            { label: 'Security', href: '#trust' },
            { label: 'FAQ', href: '#faq' },
          ],
          cta: { label: 'ask.', href: '/chat' },
        },
      ]}
      chat={{ label: 'ask kavi', href: '/chat' }}
      sideLinks={[
        { icon: 'shield', label: 'security', href: '#trust' },
        { icon: 'doc', label: 'faq', href: '#faq' },
      ]}
      copyright="© 2026 KAVI"
      credit="memory for engineering teams"
      handle={{ label: 'source on github', href: REPO }}
      onAnchor={onAnchor}
      onRoute={onRoute}
    />
  )
}
