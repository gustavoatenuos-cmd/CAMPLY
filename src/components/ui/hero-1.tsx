import { ReactNode } from "react"
import { ChevronRight } from "lucide-react"

interface HeroProps {
  eyebrow?: string
  title: string
  subtitle: string
  children?: ReactNode
}

export function Hero({
  eyebrow = "Innovate Without Limits",
  title,
  subtitle,
  children
}: HeroProps) {
  return (
    <section
      id="hero"
      className="relative mx-auto w-full pt-20 px-6 text-center md:px-8 
      min-h-screen overflow-hidden 
      bg-[linear-gradient(to_bottom,#fff,#ffffff_50%,#e8e8e8_88%)] 
      dark:bg-[linear-gradient(to_bottom,#000,#0000_30%,#172133_78%,#111827_99%_50%)]"
    >
      {/* Grid BG */}
      <div
        className="absolute -z-10 inset-0 opacity-80 h-[100%] w-full 
        bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] 
        dark:bg-[linear-gradient(to_right,#333_1px,transparent_1px),linear-gradient(to_bottom,#333_1px,transparent_1px)] 
        bg-[size:6rem_5rem] 
        [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]"
      />

      {/* Radial Accent */}
      <div
        className="absolute left-1/2 top-[calc(100%-90px)] lg:top-[calc(100%-150px)] 
        h-[500px] w-[700px] md:h-[500px] md:w-[1100px] lg:h-[750px] lg:w-[140%] 
        -translate-x-1/2 rounded-[100%] border-[#B48CDE] bg-white dark:bg-black 
        bg-[radial-gradient(closest-side,#fff_82%,#000000)] 
        dark:bg-[radial-gradient(closest-side,#000_82%,#22C55E_20%,#ffffff)] 
        animate-fade-up opacity-40 dark:border-[#22C55E]"
      />

      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center">
        {/* Eyebrow */}
        {eyebrow && (
          <a href="#" className="group mb-8">
            <span
              className="text-sm text-gray-600 dark:text-brand-green font-geist mx-auto px-5 py-2 
              bg-gradient-to-tr from-zinc-300/5 via-gray-400/5 to-transparent 
              border-[2px] border-gray-300/20 dark:border-brand-green/30 dark:bg-brand-green/10
              rounded-3xl w-fit tracking-tight uppercase flex items-center justify-center"
            >
              {eyebrow}
              <ChevronRight className="inline w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </a>
        )}

        {/* Title */}
        <h1
          className="animate-fade-in -translate-y-4 text-balance 
          bg-gradient-to-br from-black from-30% to-black/40 
          bg-clip-text pb-6 text-5xl font-semibold leading-none tracking-tighter 
          text-transparent opacity-0 sm:text-6xl md:text-7xl lg:text-8xl 
          dark:from-white dark:to-white/40"
        >
          {title}
        </h1>

        {/* Subtitle */}
        <p
          className="animate-fade-in mb-8 -translate-y-4 text-balance 
          text-lg tracking-tight text-gray-600 dark:text-gray-400 
          opacity-0 md:text-xl max-w-2xl mx-auto"
        >
          {subtitle}
        </p>

        {/* Login Box injected here */}
        <div className="w-full animate-fade-up opacity-0 delay-200 mt-2">
          {children}
        </div>
      </div>

      {/* Bottom Fade */}
      <div
        className="animate-fade-up relative mt-32 opacity-0 [perspective:2000px] 
        after:absolute after:inset-0 after:z-50 
        after:[background:linear-gradient(to_top,hsl(var(--background))_10%,transparent)]"
      />
    </section>
  )
}
