'use client'

import { LogoMark } from '@/components/reelforge/bits'
import { Button } from '@/components/ui/button'
import { HERO_POSTER, HERO_VIDEO, SHOWCASE } from '@/lib/showcase'
import { CREDITS_PER_SEC, DEFAULT_CREDITS, REFRAME_CREDITS, CAMERA_CREDITS } from '@/lib/pricing'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowRight,
  Camera,
  Coins,
  Images,
  PenLine,
  Play,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'

/* ------------------------------------------------------------------ nav */

function Nav() {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`rf-safe-top fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? 'rf-glass border-b' : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Reelforge home">
          <LogoMark className="size-9 shrink-0 rounded-xl" />
          <span className="text-lg font-bold tracking-tight">Reelforge</span>
        </Link>
        <nav aria-label="Primary" className="ml-6 hidden items-center gap-6 md:flex">
          <Link href="/" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            Create
          </Link>
          <a href="#showcase" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Showcase
          </a>
          <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Pricing
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Button
            asChild
            size="sm"
            className="h-10 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 font-semibold text-zinc-950 shadow-lg shadow-orange-500/25 transition-transform hover:scale-[1.02]"
          >
            <Link href="/studio">
              Open Studio
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      {/* R10 mobile cinema pass: section shortcut chips so phone users can
          jump between landing sections without a hamburger menu. */}
      <nav
        aria-label="Section shortcuts"
        className="rf-no-scrollbar mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-4 pb-2.5 pt-2 sm:px-6 md:hidden"
      >
        {[
          ['Create', '/'],
          ['Showcase', '#showcase'],
          ['Features', '#features'],
          ['Pricing', '#pricing'],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="whitespace-nowrap rounded-full border border-white/15 bg-zinc-950/50 px-3.5 py-1.5 text-xs font-medium text-zinc-200 backdrop-blur-sm transition-colors hover:border-orange-500/40 hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>
    </header>
  )
}

/* ----------------------------------------------------------------- hero */

function Hero() {
  const reduce = useReducedMotion()
  const heroRef = React.useRef<HTMLElement | null>(null)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  /* R12: subtle scroll-linked parallax — media drifts down as the hero
     exits, content fades up. Transform-only, so it stays cheap. */
  const mediaY = useTransform(scrollYProgress, [0, 1], ['0%', '16%'])
  const contentOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0.1])
  const contentY = useTransform(scrollYProgress, [0, 0.75], [0, -48])

  return (
    <section
      ref={heroRef}
      className="rf-vignette relative flex min-h-svh flex-col justify-end overflow-hidden"
    >
      <motion.div
        className="absolute inset-0"
        style={reduce ? undefined : { y: mediaY, scale: 1.06 }}
        aria-hidden="true"
      >
        <video
          className="h-full w-full object-cover"
          src={HERO_VIDEO}
          poster={HERO_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
      </motion.div>
      <div className="rf-hero-fade absolute inset-0" aria-hidden="true" />
      <motion.div
        className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-12 pt-40 sm:px-6 sm:pb-24 sm:pt-44 md:pt-32"
        style={reduce ? undefined : { opacity: contentOpacity, y: contentY }}
      >
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-orange-300 sm:mb-5"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Prompt-to-video studio
        </motion.p>
        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08 }}
          className="rf-display-glow max-w-4xl text-balance text-[2.65rem] font-extrabold leading-[1.06] tracking-tight sm:text-6xl sm:leading-[1.04] lg:text-7xl"
        >
          Forge cinematic video from a{' '}
          <span className="rf-gradient-text">single sentence</span>.
        </motion.h1>
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16 }}
          className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:mt-6 sm:text-xl"
        >
          Describe a shot, pin optional start and end frames, and let the forge
          render a playable MP4 — then re-crop, add camera moves, and edit it
          in natural language. Every credit is metered, every render is yours.
        </motion.p>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24 }}
          className="mt-6 flex w-full flex-col gap-3 sm:mt-9 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
        >
          <Button
            asChild
            size="lg"
            className="h-13 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 px-7 text-base font-bold text-zinc-950 shadow-xl shadow-orange-500/30 transition-transform hover:scale-[1.03] sm:w-auto"
          >
            <Link href="/studio">
              Open the Studio
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-13 w-full rounded-2xl border-white/15 bg-white/5 px-7 text-base font-semibold text-foreground backdrop-blur-sm transition-colors hover:bg-white/10 sm:w-auto"
          >
            <a href="#showcase">
              <Play className="size-4" aria-hidden="true" />
              Watch the forge
            </a>
          </Button>
        </motion.div>
        <motion.dl
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="mt-8 grid grid-cols-3 gap-x-3 gap-y-4 text-sm sm:mt-12 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-3"
        >
          {[
            ['16:9 · 9:16 · 1:1', 'Delivery formats'],
            ['5–15 seconds', 'Clip length'],
            ['H.264 MP4', 'Output, streamable'],
          ].map(([value, label]) => (
            <div key={label} className="flex flex-col">
              <dt className="order-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 sm:text-xs">{label}</dt>
              <dd className="order-1 text-sm font-semibold tracking-tight text-foreground/90 sm:text-base">{value}</dd>
            </div>
          ))}
        </motion.dl>
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------ showcase */

function ShowcaseCard({
  entry,
  index,
}: {
  entry: (typeof SHOWCASE)[number]
  index: number
}) {
  const reduce = useReducedMotion()
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = React.useState(false)

  const play = React.useCallback(() => {
    const v = videoRef.current
    if (!v) return
    void v.play().then(() => setPlaying(true)).catch(() => undefined)
  }, [])

  const stop = React.useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = 0
    setPlaying(false)
  }, [])

  const toggle = React.useCallback(() => {
    if (playing) stop()
    else play()
  }, [play, playing, stop])

  return (
    <motion.figure
      initial={reduce ? undefined : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay: Math.min(index * 0.05, 0.25) }}
      className={`group relative w-[82vw] max-w-[420px] shrink-0 snap-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 sm:w-auto sm:max-w-none sm:shrink ${
        entry.featured ? 'sm:col-span-2' : ''
      }`}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={`Play clip: ${entry.prompt}`}
        className="block w-full cursor-pointer"
      >
        <video
          ref={videoRef}
          className="aspect-video w-full object-cover"
          src={`/showcase/${entry.video}`}
          poster={`/showcase/${entry.poster}`}
          muted
          loop
          playsInline
          preload="none"
        />
      </button>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/40 to-transparent p-4 pt-10"
        aria-hidden="true"
      >
        <blockquote className="text-sm italic leading-snug text-zinc-100/90">
          “{entry.prompt}”
        </blockquote>
        <figcaption className="mt-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
          <span className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-orange-300">
            {entry.tier}
          </span>
          <span className="tabular-nums">{entry.seconds}s</span>
          {/* Touch has no hover: keep the affordance always visible on
              phones, hover-reveal on pointer devices. */}
          <span className="ml-auto sm:hidden">tap to play</span>
          <span className="ml-auto hidden opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
            hover to play
          </span>
        </figcaption>
      </div>
    </motion.figure>
  )
}

function Showcase() {
  return (
    <section id="showcase" className="relative scroll-mt-20 py-20 sm:py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <SectionHeading
          kicker="Showcase"
          title="Forged in the studio"
          blurb="Every clip below was generated by Reelforge's own pipeline — a
          prompt, a few credits, and an ffmpeg render. Tap or hover any tile
          to watch it move."
        />
        {/* R10: phones get an edge-to-edge snap rail (tiles bleed to the
            viewport edge with a peek of the next one); ≥sm keeps the grid.
            R12: tiles reveal individually with a capped stagger. */}
        <div
          className="rf-no-scrollbar -mx-4 mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
        >
          {SHOWCASE.map((entry, i) => (
            <ShowcaseCard key={entry.video} entry={entry} index={i} />
          ))}
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          Like one?{' '}
          <Link href="/studio" className="font-medium text-primary underline-offset-4 hover:underline">
            Open the Studio
          </Link>{' '}
          and remix the recipe yourself.
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- features */

const FEATURES = [
  {
    icon: Images,
    title: 'Keyframe pinning',
    body: 'Pin a start frame, an end frame, or both. The forge interpolates between your images so the shot lands exactly where you pictured it — the classic first-and-last-frame trick, built in.',
  },
  {
    icon: PenLine,
    title: 'Natural-language edits',
    body: '“Shift to dusk light with drifting snow.” Edit threads re-render a clip from your instruction and keep the full version history, so every cut stays reversible.',
  },
  {
    icon: Camera,
    title: 'Camera moves & re-crops',
    body: 'Push in, drift, orbit — or re-crop the same render to 9:16 for social without paying for a new generation. Flat-rate transforms, no provider call.',
  },
  {
    icon: Coins,
    title: 'Metered economics',
    body: 'An atomic, append-only credit ledger sits under every action. You see the cost before you commit, the refund when a render fails, and the full unit economics in Insights.',
  },
]

function Features() {
  const reduce = useReducedMotion()
  return (
    <section id="features" className="scroll-mt-20 border-t border-white/5 py-20 sm:py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <SectionHeading
          kicker="Features"
          title="Direct every frame"
          blurb="The studio is built around a working editor's loop: cheap
          drafts, precise control, and honest numbers."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              initial={reduce ? undefined : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="ember-glow group rounded-2xl border border-white/10 bg-card/60 p-6 transition-colors hover:border-orange-500/30"
            >
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-400">
                <f.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-bold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- how it works */

const STEPS = [
  {
    n: '01',
    title: 'Describe the shot',
    body: 'One or two sentences is enough — subject, light, motion, mood. A safety filter reviews the prompt before any credits are reserved.',
  },
  {
    n: '02',
    title: 'Pin and tune',
    body: 'Optionally upload start and end keyframes, pick a tier, duration, and aspect ratio, and watch the exact credit cost update live.',
  },
  {
    n: '03',
    title: 'Forge and share',
    body: 'The pipeline renders a streamable MP4 in seconds. Extend it, edit it with words, re-crop it — or mint an unlisted share page with video metadata for social.',
  },
]

function HowItWorks() {
  const reduce = useReducedMotion()
  return (
    <section className="border-t border-white/5 py-20 sm:py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <SectionHeading
          kicker="Workflow"
          title="Three moves to a finished clip"
          blurb=""
        />
        <ol className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.li
              key={s.n}
              initial={reduce ? undefined : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="relative border-l border-white/10 pl-6"
            >
              <span className="absolute -left-px top-0 h-8 w-0.5 bg-gradient-to-b from-orange-500 to-amber-400" />
              <span className="font-mono text-xs font-semibold tracking-widest text-orange-400/80">{s.n}</span>
              <h3 className="mt-2 text-lg font-bold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- pricing */

function Pricing() {
  const reduce = useReducedMotion()
  const tiers = [
    {
      name: 'Draft',
      tagline: 'Fast storyboard pass for ideation',
      rate: CREDITS_PER_SEC.draft,
      fiveSec: CREDITS_PER_SEC.draft * 5,
      provider: '$0.08 / 5s',
      highlight: false,
      points: [
        '10 credits per second of video',
        'Full pipeline: frames, moderation, MP4 render',
        'All transforms available at flat rates',
      ],
    },
    {
      name: 'Quality',
      tagline: 'Richer keyframes for closer-to-final looks',
      rate: CREDITS_PER_SEC.quality,
      fiveSec: CREDITS_PER_SEC.quality * 5,
      provider: '$0.40 / 5s',
      highlight: true,
      points: [
        '40 credits per second of video',
        'Denser, more cinematic keyframe passes',
        'Same editor, same share flow, better clay',
      ],
    },
  ]
  return (
    <section id="pricing" className="scroll-mt-20 border-t border-white/5 py-20 sm:py-24 lg:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <SectionHeading
          kicker="Pricing"
          title="What a credit buys"
          blurb="No seats, no subscriptions in this build — a metered ledger
          you can audit line by line. You start with play-money credits and
          every charge is shown before you commit."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:mx-auto lg:max-w-4xl">
          {tiers.map((t, i) => (
            <motion.div
              key={t.name}
              initial={reduce ? undefined : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className={`relative rounded-2xl border p-6 sm:p-8 ${
                t.highlight
                  ? 'border-orange-500/50 bg-gradient-to-b from-orange-500/10 to-transparent shadow-xl shadow-orange-500/10'
                  : 'border-white/10 bg-card/60'
              }`}
            >
              {t.highlight && (
                <span className="absolute right-6 top-6 rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Cinematic
                </span>
              )}
              <h3 className="text-xl font-bold tracking-tight">{t.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.tagline}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight tabular-nums">{t.fiveSec}</span>
                <span className="text-sm text-muted-foreground">credits / 5s clip</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground/80">
                {t.rate} credits per second · {t.provider} reference provider cost
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-orange-400" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Flat-rate transforms: re-crop {REFRAME_CREDITS} credits · camera move {CAMERA_CREDITS} credits ·
          failed renders refund in full. New accounts start with {DEFAULT_CREDITS} credits — play money in
          this build.
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- cta band */

function CtaBand() {
  const reduce = useReducedMotion()
  return (
    <section className="ember-glow relative overflow-hidden border-t border-white/5 py-20 sm:py-28">
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6 }}
        className="mx-auto w-full max-w-4xl px-4 text-center sm:px-6"
      >
        <h2 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
          Your next shot is one <span className="rf-gradient-text">sentence</span> away.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-muted-foreground sm:text-lg">
          Open the studio, describe the frame in your head, and watch the forge
          cut it. No signup wall — the anvil is already hot.
        </p>
        <Button
          asChild
          size="lg"
          className="mt-9 h-13 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 px-8 text-base font-bold text-zinc-950 shadow-xl shadow-orange-500/30 transition-transform hover:scale-[1.03]"
        >
          <Link href="/studio">
            Start forging
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        </Button>
      </motion.div>
    </section>
  )
}

/* -------------------------------------------------------------- footer */

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-zinc-950/60 pb-safe">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight">Reelforge</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            An original, clean-room prompt-to-video studio. Every clip on this
            page was forged by the product itself; no third-party assets
            anywhere in the build.
          </p>
        </div>
        <nav aria-label="Product">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Product</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">Create</Link></li>
            <li><Link href="/explore" className="text-muted-foreground transition-colors hover:text-foreground">Explore</Link></li>
            <li><Link href="/models" className="text-muted-foreground transition-colors hover:text-foreground">Models</Link></li>
            <li><Link href="/history" className="text-muted-foreground transition-colors hover:text-foreground">History</Link></li>
            <li><Link href="/studio" className="text-muted-foreground transition-colors hover:text-foreground">Studio</Link></li>
            <li><a href="#showcase" className="text-muted-foreground transition-colors hover:text-foreground">Showcase</a></li>
            <li><a href="#pricing" className="text-muted-foreground transition-colors hover:text-foreground">Pricing</a></li>
            <li><a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">Features</a></li>
          </ul>
        </nav>
        <nav aria-label="Under the hood">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Under the hood</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li className="text-muted-foreground">Pluggable providers (demo, fal.ai, self-hosted)</li>
            <li className="text-muted-foreground">ffmpeg H.264 renders, range-streamable</li>
            <li className="text-muted-foreground">Atomic credit ledger, fail-closed moderation</li>
            <li className="text-muted-foreground">Unlisted share pages with video metadata</li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/5 py-5">
        <p className="text-center text-xs text-muted-foreground/70">
          © 2026 Reelforge · Clean-room build · Credits are play money in this deployment
        </p>
      </div>
    </footer>
  )
}

/* --------------------------------------------------------------- shared */

function SectionHeading({
  kicker,
  title,
  blurb,
}: {
  kicker: string
  title: string
  blurb: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? undefined : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55 }}
      className="max-w-2xl"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-400/90">{kicker}</p>
      <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {blurb ? <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">{blurb}</p> : null}
    </motion.div>
  )
}

/* ----------------------------------------------------------------- page */

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#rf-landing-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Nav />
      <main id="rf-landing-main">
        <Hero />
        <Showcase />
        <Features />
        <HowItWorks />
        <Pricing />
        <CtaBand />
      </main>
      <Footer />
    </div>
  )
}
