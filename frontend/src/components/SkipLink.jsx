export default function SkipLink() {
  return <a href="#main-content"
    className="fixed left-4 top-3 z-[3000] -translate-y-24 rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white shadow-lg focus:translate-y-0"
    onClick={event => {
      const main = document.getElementById('main-content')
      if (!main) return
      event.preventDefault()
      main.focus({ preventScroll: true })
      main.scrollIntoView({ block: 'start', behavior: 'instant' })
    }}>Skip to main content</a>
}
